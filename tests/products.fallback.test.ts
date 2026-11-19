import assert from "node:assert/strict";
import { test } from "node:test";
import { Response } from "undici";
import { PageFetchError } from "../src/modules/products/products.errors.ts";
import { ProductPageLoader } from "../src/modules/products/products.page-loader.ts";
import { ProductUrlPolicy } from "../src/modules/products/network/url-policy.ts";
import { ProductsService } from "../src/modules/products/products.service.ts";
import type {
  PageLoader,
  ProductPage,
} from "../src/modules/products/products.types.ts";

const productUrl = "https://shop.example/products/mouse";
const sheinProductUrl = "https://br.shein.com/Mouse-Gamer-p-12345678.html";
const nikeProductUrl = "https://www.nike.com.br/chuteira-society-nike-tiempo-ligera-pro-095178.html?cor=51";

// Cada teste fornece HTML pequeno que controla exatamente os campos presentes.
// Não abrimos navegador nem acessamos internet: verificamos a decisão do service.
function pageWithProduct(fields: Record<string, unknown>): ProductPage {
  const json = JSON.stringify({ "@type": "Product", ...fields });
  return {
    html: Buffer.from(`<meta charset="utf-8"><script type="application/ld+json">${json}</script>`),
    finalUrl: productUrl,
    contentType: "text/html; charset=utf-8",
  };
}

const completePage = pageWithProduct({
  name: "Mouse Gamer",
  image: "/mouse.jpg",
  offers: { "@type": "Offer", price: "220.34", priceCurrency: "BRL" },
});

const partialPage = pageWithProduct({ name: "Mouse Gamer", image: "/mouse.jpg" });

const emptyPage: ProductPage = {
  html: Buffer.from("<html><head><title>Carregando</title></head><body></body></html>"),
  finalUrl: productUrl,
  contentType: "text/html; charset=utf-8",
};

function createScenario(httpResult: ProductPage | PageFetchError, browserResult: ProductPage | PageFetchError) {
  const calls = { http: 0, browser: 0 };

  // O contrato único tem os dois caminhos. O service decide qual método usar,
  // sem conhecer fetch/Undici, Playwright ou os detalhes destas funções falsas.
  const loader: PageLoader = {
    validateUrl() {},
    async fetch() {
      calls.http++;
      if (httpResult instanceof PageFetchError) throw httpResult;
      return httpResult;
    },
    async render() {
      calls.browser++;
      if (browserResult instanceof PageFetchError) throw browserResult;
      return browserResult;
    },
  };

  return { service: new ProductsService(loader), calls };
}

test("fallback: uma prévia HTTP completa não abre o navegador", async () => {
  const scenario = createScenario(completePage, new PageFetchError("BROWSER_UNAVAILABLE"));
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.priceCents, 22034);
  assert.deepEqual(scenario.calls, { http: 1, browser: 0 });
});

test("fallback: prévia parcial tenta o navegador uma vez e aceita produto mais completo", async () => {
  const scenario = createScenario(partialPage, completePage);
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.url, productUrl);
  assert.equal(result.product.priceCents, 22034);
  assert.equal(result.product.currency, "BRL");
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(scenario.calls, { http: 1, browser: 1 });
});

test("fallback: HTML sem dados de produto também tenta renderizar", async () => {
  const scenario = createScenario(emptyPage, completePage);
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.name, "Mouse Gamer");
  assert.deepEqual(scenario.calls, { http: 1, browser: 1 });
});

test("fallback: falha de rede, timeout e 429 permitem uma tentativa", async () => {
  const failures = [
    new PageFetchError("FETCH_FAILED"),
    new PageFetchError("TIMEOUT"),
    new PageFetchError("REMOTE_RATE_LIMITED"),
  ];

  for (const failure of failures) {
    const scenario = createScenario(failure, completePage);
    const result = await scenario.service.extract({ url: productUrl });

    assert.equal(result.status, "complete", failure.reason);
    assert.deepEqual(scenario.calls, { http: 1, browser: 1 }, failure.reason);
  }
});

test("fallback: recusa de acesso, verificação e destinos proibidos não abrem navegador", async () => {
  // REMOTE_ACCESS_DENIED representa tanto HTTP 401 quanto HTTP 403 no cliente.
  const reasons = [
    "REMOTE_ACCESS_DENIED",
    "REMOTE_VERIFICATION_REQUIRED",
    "UNSAFE_TARGET",
    "UNSAFE_REDIRECT",
    "TOO_MANY_REDIRECTS",
    "UNSUPPORTED_CONTENT",
    "PAGE_TOO_LARGE",
  ] as const;

  for (const reason of reasons) {
    const scenario = createScenario(new PageFetchError(reason), completePage);
    const result = await scenario.service.extract({ url: productUrl });

    assert.equal(result.status, "failed", reason);
    if (result.status === "failed") assert.equal(result.reason, reason);
    assert.deepEqual(scenario.calls, { http: 1, browser: 0 }, reason);
  }
});

test("Shein: redirecionamento do fetch para /risk/action/limit exige verificação", async () => {
  const verificationPage = { ...completePage, finalUrl: "https://br.shein.com/risk/action/limit" };
  const scenario = createScenario(verificationPage, completePage);
  const result = await scenario.service.extract({ url: sheinProductUrl });

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "REMOTE_VERIFICATION_REQUIRED");
  assert.equal(result.product.url, sheinProductUrl);
  assert.deepEqual(scenario.calls, { http: 1, browser: 0 });
});

test("Shein: /risk/challenge no navegador exige verificação após fetch sem dados", async () => {
  const verificationPage = { ...completePage, finalUrl: "https://br.shein.com/risk/challenge" };
  const scenario = createScenario({ ...emptyPage, finalUrl: sheinProductUrl }, verificationPage);
  const result = await scenario.service.extract({ url: sheinProductUrl });

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "REMOTE_VERIFICATION_REQUIRED");
  assert.equal(result.product.url, sheinProductUrl);
  assert.deepEqual(scenario.calls, { http: 1, browser: 1 });
});

test("Shein: caminho de verificação em outro domínio segue a extração normal", async () => {
  const otherSite = { ...completePage, finalUrl: "https://br.shein.com.shop.example/risk/action/limit" };
  const scenario = createScenario(otherSite, new PageFetchError("BROWSER_UNAVAILABLE"));
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.priceCents, 22034);
  assert.deepEqual(scenario.calls, { http: 1, browser: 0 });
});

test("Nike: recusa HTTP preserva a falha e oferece sugestão de nome pela URL", async () => {
  const scenario = createScenario(new PageFetchError("REMOTE_ACCESS_DENIED"), completePage);
  const result = await scenario.service.extract({ url: nikeProductUrl });

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "REMOTE_ACCESS_DENIED");
  assert.equal(result.suggestedName, "Chuteira Society Nike Tiempo Ligera Pro");
  assert.equal(result.product.name, null);
  assert.equal(result.product.url, nikeProductUrl);
  assert.deepEqual(result.missingFields, ["name", "imageUrl", "priceCents", "currency", "storeName"]);
  assert.deepEqual(scenario.calls, { http: 1, browser: 0 });
});

test("Shopee: verifica a URL final e usa o next do link original para a sugestão", async () => {
  const verificationUrl = "https://shopee.com.br/verify/traffic/error";
  const next = "https://shopee.com.br/Mouse-Gamer-Sem-Fio-i.123456789.987654321";
  const originalUrl = `${verificationUrl}?next=${encodeURIComponent(next)}`;
  // Mesmo com HTML aparentemente completo, o endereço final é uma verificação.
  // Só a URL original tem next, então dela deve vir a sugestão do nome.
  const scenario = createScenario({ ...completePage, finalUrl: verificationUrl }, completePage);
  const result = await scenario.service.extract({ url: originalUrl });

  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "REMOTE_VERIFICATION_REQUIRED");
  assert.equal(result.suggestedName, "Mouse Gamer Sem Fio");
  assert.equal(result.product.name, null);
  assert.equal(result.product.url, originalUrl);
  assert.deepEqual(result.missingFields, ["name", "imageUrl", "priceCents", "currency", "storeName"]);
  assert.deepEqual(scenario.calls, { http: 1, browser: 0 });
});

test("sugestão de nome mantém a prévia parcial e seus campos ausentes", async () => {
  const httpPage = { ...pageWithProduct({ image: "/chuteira.jpg" }), finalUrl: nikeProductUrl };
  const scenario = createScenario(httpPage, new PageFetchError("TIMEOUT"));
  const result = await scenario.service.extract({ url: nikeProductUrl });

  assert.equal(result.status, "partial");
  assert.equal("reason" in result, false);
  assert.equal(result.suggestedName, "Chuteira Society Nike Tiempo Ligera Pro");
  assert.equal(result.product.name, null);
  assert.equal(result.product.url, nikeProductUrl);
  assert.equal(result.product.imageUrl, "https://www.nike.com.br/chuteira.jpg");
  assert.deepEqual(result.missingFields, ["name", "priceCents", "currency"]);
  assert.deepEqual(scenario.calls, { http: 1, browser: 1 });
});

test("nome extraído pelo navegador tem prioridade sobre a sugestão da URL", async () => {
  const browserPage = pageWithProduct({
    name: "Chuteira Tiempo Pro",
    image: "/chuteira.jpg",
    offers: { "@type": "Offer", price: "399.90", priceCurrency: "BRL" },
  });
  const scenario = createScenario(
    { ...emptyPage, finalUrl: nikeProductUrl },
    { ...browserPage, finalUrl: nikeProductUrl },
  );
  const result = await scenario.service.extract({ url: nikeProductUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.name, "Chuteira Tiempo Pro");
  assert.equal(result.product.url, nikeProductUrl);
  assert.equal(Object.hasOwn(result, "suggestedName"), false);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(scenario.calls, { http: 1, browser: 1 });
});

test("fallback: 429 com Retry-After permite uma única alternativa com navegador", async () => {
  // Política deliberada do MVP: há uma alternativa de renderização, não um
  // laço de novas requisições HTTP. A resposta real inclui Retry-After, mas o
  // fetch é simulado e não há acesso externo durante este teste.
  const calls = { http: 0, browser: 0 };
  const realLoader = new ProductPageLoader(new ProductUrlPolicy(async () => ["8.8.8.8"]), {
    fetchPage: async () => {
      calls.http++;
      return new Response("Aguarde", { status: 429, headers: { "retry-after": "60" } });
    },
  });
  const loader: PageLoader = {
    validateUrl: (url) => realLoader.validateUrl(url),
    fetch: (url) => realLoader.fetch(url),
    async render() { calls.browser++; return completePage; },
  };
  const result = await new ProductsService(loader).extract({ url: productUrl });

  assert.equal(result.status, "complete");
  assert.equal(result.product.priceCents, 22034);
  assert.deepEqual(calls, { http: 1, browser: 1 });
});

test("fallback: navegador ocupado, ausente ou lento preserva os dados HTTP parciais", async () => {
  for (const reason of ["BROWSER_BUSY", "BROWSER_UNAVAILABLE", "TIMEOUT"] as const) {
    const scenario = createScenario(partialPage, new PageFetchError(reason));
    const result = await scenario.service.extract({ url: productUrl });

    assert.equal(result.status, "partial", reason);
    assert.equal(result.product.name, "Mouse Gamer", reason);
    assert.equal(result.product.imageUrl, "https://shop.example/mouse.jpg", reason);
    assert.equal(result.product.priceCents, null, reason);
    assert.equal(result.product.currency, null, reason);
    assert.deepEqual(result.missingFields, ["priceCents", "currency"], reason);
    assert.deepEqual(scenario.calls, { http: 1, browser: 1 }, reason);
  }
});

test("fallback: sem dados HTTP, a falha do navegador é informada sem perder a URL original", async () => {
  for (const reason of ["BROWSER_BUSY", "BROWSER_UNAVAILABLE", "TIMEOUT"] as const) {
    const scenario = createScenario(emptyPage, new PageFetchError(reason));
    const result = await scenario.service.extract({ url: productUrl });

    assert.equal(result.status, "failed", reason);
    if (result.status === "failed") assert.equal(result.reason, reason);
    assert.equal(result.product.url, productUrl);
    assert.equal(result.product.name, null);
    assert.equal(result.product.priceCents, null);
    assert.deepEqual(scenario.calls, { http: 1, browser: 1 }, reason);
  }
});

test("fallback: candidato com mais campos é usado inteiro, sem juntar campos das duas páginas", async () => {
  const browserPage = pageWithProduct({
    name: "Mouse Gamer KYSONA",
    // Há preço/moeda, mas não há imagem. Mesmo assim são mais campos que HTTP.
    offers: { "@type": "Offer", price: "220.34", priceCurrency: "BRL" },
  });
  const scenario = createScenario(partialPage, browserPage);
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "partial");
  assert.equal(result.product.name, "Mouse Gamer KYSONA");
  assert.equal(result.product.priceCents, 22034);
  assert.equal(result.product.currency, "BRL");
  // A imagem HTTP existia. Se aparecesse aqui, teria ocorrido uma mistura.
  assert.equal(result.product.imageUrl, null);
  assert.deepEqual(result.missingFields, ["imageUrl"]);
});

test("fallback: empate de campos mantém HTTP e não completa sua moeda com outra oferta", async () => {
  const httpPage = pageWithProduct({
    name: "Mouse Gamer", image: "/http-mouse.jpg",
    offers: { "@type": "Offer", price: "100" },
  });
  const browserPage = pageWithProduct({
    name: "Mouse Gamer", image: "/browser-mouse.jpg",
    offers: { "@type": "Offer", priceCurrency: "USD" },
  });
  const scenario = createScenario(httpPage, browserPage);
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "partial");
  assert.equal(result.product.imageUrl, "https://shop.example/http-mouse.jpg");
  assert.equal(result.product.priceCents, 10000);
  assert.equal(result.product.currency, null);
});

test("fallback: produto mais completo com nome divergente não substitui o produto HTTP", async () => {
  const otherProduct = pageWithProduct({
    name: "Teclado mecânico", image: "/teclado.jpg",
    offers: { "@type": "Offer", price: "500", priceCurrency: "BRL" },
  });
  const scenario = createScenario(partialPage, otherProduct);
  const result = await scenario.service.extract({ url: productUrl });

  assert.equal(result.status, "partial");
  assert.equal(result.product.name, "Mouse Gamer");
  assert.equal(result.product.imageUrl, "https://shop.example/mouse.jpg");
  assert.equal(result.product.priceCents, null);
  assert.equal(result.product.currency, null);
});

test("fallback: comparação de nomes ignora caixa e aceita um nome contido no outro", async () => {
  for (const browserName of ["MOUSE GAMER", "Mouse Gamer KYSONA", "mouse"]) {
    const browserPage = pageWithProduct({
      name: browserName, image: "/mouse.jpg",
      offers: { "@type": "Offer", price: "220.34", priceCurrency: "BRL" },
    });
    const scenario = createScenario(partialPage, browserPage);
    const result = await scenario.service.extract({ url: productUrl });

    assert.equal(result.status, "complete", browserName);
    assert.equal(result.product.name, browserName);
    assert.equal(result.product.priceCents, 22034);
  }
});
