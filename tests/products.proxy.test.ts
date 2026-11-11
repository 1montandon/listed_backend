import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { test } from "node:test";
import { BrowserProxy } from "../src/modules/products/network/browser-proxy.ts";
import { PageFetchError } from "../src/modules/products/products.errors.ts";
import { ProductUrlPolicy } from "../src/modules/products/network/url-policy.ts";

// Os testes só abrem a porta LOCAL do proxy. Nenhum endereço remoto é acessado:
// os pedidos proibidos são recusados antes de criar uma conexão com o destino.
async function sendToProxy(proxyAddress: string, request: string): Promise<string> {
  const proxy = new URL(proxyAddress);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: proxy.hostname, port: Number(proxy.port) });
    const chunks: string[] = [];
    socket.setEncoding("utf8");
    socket.setTimeout(2000, () => socket.destroy(new Error("Proxy não respondeu ao teste.")));
    socket.on("error", reject);
    socket.on("data", (chunk: string) => chunks.push(chunk));
    socket.on("end", () => resolve(chunks.join("")));
    socket.once("connect", () => socket.write(request));
  });
}

test("política compartilhada distingue URL escrita e endereço DNS privado", async () => {
  let lookups = 0;
  const policy = new ProductUrlPolicy(async () => { lookups++; return ["10.0.0.2"]; });
  for (const url of ["http://localhost/", "http://127.0.0.1/", "https://[::1]/", "https://user:pass@shop.example/", "https://shop.example:8443/"]) {
    assert.throws(() => policy.parseUrl(url), PageFetchError);
  }
  assert.equal(lookups, 0);
  assert.equal(policy.parseUrl("https://shop.example:443/product").hostname, "shop.example");
  await assert.rejects(policy.resolvePublicAddress("shop.example", AbortSignal.timeout(1000)), (error: unknown) =>
    error instanceof PageFetchError && error.reason === "UNSAFE_TARGET");
  assert.equal(lookups, 1);
});

test("política escolhe um IPv4 público e interrompe a espera por DNS no abort", async () => {
  const policy = new ProductUrlPolicy(async () => ["10.0.0.2", "169.254.169.254", "8.8.8.8"]);
  assert.equal(await policy.resolvePublicAddress("shop.example", AbortSignal.timeout(1000)), "8.8.8.8");

  const controller = new AbortController();
  const pending = new ProductUrlPolicy(() => new Promise<string[]>(() => {}));
  const result = pending.resolvePublicAddress("shop.example", controller.signal);
  controller.abort();
  await assert.rejects(result, (error: unknown) => error instanceof PageFetchError && error.reason === "TIMEOUT");
});

test("proxy recusa HTTP e CONNECT para loopback, credenciais e portas fora da política", async () => {
  let lookups = 0;
  const policy = new ProductUrlPolicy(async () => { lookups++; return ["8.8.8.8"]; });
  const proxy = new BrowserProxy(policy);
  const controller = new AbortController();
  const address = await proxy.start(controller.signal);
  try {
    const requests = [
      "GET http://127.0.0.1/private HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
      "GET https://shop.example/private HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n",
      "GET /not-an-absolute-url HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n",
      "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      "CONNECT [::1]:443 HTTP/1.1\r\nHost: [::1]\r\n\r\n",
      "CONNECT shop.example:8443 HTTP/1.1\r\nHost: shop.example\r\n\r\n",
      "CONNECT shop.example:443/private HTTP/1.1\r\nHost: shop.example\r\n\r\n",
    ];
    for (const request of requests) {
      const response = await sendToProxy(address, request);
      assert.match(response, /^HTTP\/1\.1 403 /);
    }
    assert.equal(lookups, 0);
  } finally {
    await proxy.close();
  }
});

test("proxy recusa domínio que resolve para IP privado em HTTP e CONNECT", async () => {
  let lookups = 0;
  const policy = new ProductUrlPolicy(async () => { lookups++; return ["192.168.0.10"]; });
  const proxy = new BrowserProxy(policy);
  const address = await proxy.start(new AbortController().signal);
  try {
    for (const request of [
      "GET http://shop.example/product HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n",
      "CONNECT shop.example:443 HTTP/1.1\r\nHost: shop.example\r\n\r\n",
    ]) {
      assert.match(await sendToProxy(address, request), /^HTTP\/1\.1 403 /);
    }
    assert.equal(lookups, 2);
  } finally {
    await proxy.close();
  }
});

test("abort fecha conexões abertas e close pode ser repetido", async () => {
  const proxy = new BrowserProxy(new ProductUrlPolicy());
  const controller = new AbortController();
  const address = new URL(await proxy.start(controller.signal));
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  await once(socket, "connect");
  const closed = once(socket, "close");
  controller.abort();
  await closed;
  await proxy.close();
  await proxy.close();
  assert.equal(socket.destroyed, true);
});

test("proxy com sinal já cancelado não inicia servidor", async () => {
  const controller = new AbortController();
  controller.abort();
  const proxy = new BrowserProxy(new ProductUrlPolicy());
  await assert.rejects(proxy.start(controller.signal), (error: unknown) =>
    error instanceof PageFetchError && error.reason === "TIMEOUT");
  await proxy.close();
});

test("pedido HTTP cancelado durante DNS não derruba o proxy", async () => {
  let started = () => {};
  const dnsStarted = new Promise<void>((resolve) => { started = resolve; });
  let finish = () => {};
  const dnsRelease = new Promise<void>((resolve) => { finish = resolve; });
  const policy = new ProductUrlPolicy(async () => {
    started();
    await dnsRelease;
    return ["10.0.0.2"]; // Mesmo se chegasse tarde, esse destino nunca seria acessado.
  });
  const proxy = new BrowserProxy(policy);
  const address = new URL(await proxy.start(new AbortController().signal));
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  try {
    await once(socket, "connect");
    socket.write("POST http://shop.example/data HTTP/1.1\r\nHost: shop.example\r\nContent-Length: 1000\r\n\r\nx");
    await dnsStarted;
    const closed = once(socket, "close");
    socket.destroy(); // Simula a aba fechando antes de terminar o envio do corpo.
    await closed;
    finish();
    const response = await sendToProxy(address.href,
      "GET http://127.0.0.1/private HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    assert.match(response, /^HTTP\/1\.1 403 /); // O servidor segue atendendo.
  } finally {
    finish();
    socket.destroy();
    await proxy.close();
  }
});

test("abort durante start rejeita a abertura e permite limpeza idempotente", async () => {
  const controller = new AbortController();
  const proxy = new BrowserProxy(new ProductUrlPolicy());
  const starting = proxy.start(controller.signal);
  controller.abort();
  await assert.rejects(starting, (error: unknown) =>
    error instanceof PageFetchError && error.reason === "TIMEOUT");
  await proxy.close();
});
