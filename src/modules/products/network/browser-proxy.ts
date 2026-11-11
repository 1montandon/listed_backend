/**
 * CONEXÕES DO CHROMIUM A DESTINOS PÚBLICOS
 *
 * Chromium fala com este servidor HTTP local. Para atender cada pedido, o
 * proxy escolhe um IP permitido e abre sua própria conexão até a loja.
 * forwardHttp repassa mensagens HTTP. openTunnel repassa bytes HTTPS para
 * que Chromium continue negociando TLS e verificando o certificado da loja.
 *
 * Leia README.md#rede-e-proxy para IP, DNS, sockets e TCP. Em seguida, veja
 * start para entender onde os pedidos entram, forwardHttp e openTunnel para
 * acompanhar cada caminho, e close para entender como encerramos os dois.
 */
import { createServer, request as requestHttp } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";
import { connect } from "node:net";
// Duplex é um fluxo de leitura e escrita. Um socket representa uma ponta da
// conexão e pode tanto receber quanto enviar bytes.
import type { Duplex } from "node:stream";
import { PageFetchError } from "../products.errors.ts";
import { ProductUrlPolicy } from "./url-policy.ts";

export class BrowserProxy {
  private readonly policy: ProductUrlPolicy;
  private server: Server | null = null;
  // Set guarda conexões sem duplicar a mesma referência. Inclui os sockets
  // recebidos do Chromium e os que abrimos para os destinos remotos.
  private readonly sockets = new Set<Duplex>();
  // A primeira chamada de close inicia a limpeza. As próximas podem esperar
  // a mesma Promise, inclusive enquanto o encerramento ainda está em curso.
  private closePromise: Promise<void> | null = null;
  private signal: AbortSignal | null = null;
  private onAbort: (() => void) | null = null;

  constructor(policy: ProductUrlPolicy) {
    this.policy = policy;
  }

  /** Abre o intermediário local e devolve o endereço que será passado ao Chromium. */
  async start(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new PageFetchError("TIMEOUT");
    if (this.server !== null || this.closePromise !== null) {
      throw new Error("Cada BrowserProxy deve ser iniciado apenas uma vez.");
    }

    // createServer recebe uma função para pedidos HTTP comuns. request é o
    // pedido do navegador e response é o canal para responder ao navegador.
    const server = createServer((request, response) => {
      // A aba pode cancelar um pedido enquanto esperamos DNS. Tratamos também
      // os erros dos streams locais, não só os erros da conexão com a loja.
      request.on("error", () => response.destroy());
      response.on("error", () => request.destroy());
      // O Node chama a função quando chega o pedido e segue sem esperar a
      // Promise. void marca a chamada em segundo plano e catch trata sua falha.
      void this.forwardHttp(request, response, signal).catch((error: unknown) => {
        this.rejectHttp(response, error);
      });
    });
    this.server = server;
    this.signal = signal;
    // Limita o número de conexões simultâneas aceitas pelo servidor local.
    server.maxConnections = 64;
    // connection ocorre para cada socket TCP que chega ao servidor. connect
    // abaixo é o evento do método HTTP CONNECT, usado para abrir um túnel.
    server.on("connection", (socket) => this.trackSocket(socket));
    server.on("connect", (request, socket, head) => {
      request.on("error", () => socket.destroy());
      void this.openTunnel(request, socket, head, signal).catch((error: unknown) => {
        const destinationWasBlocked = error instanceof PageFetchError && error.reason === "UNSAFE_TARGET";
        const status = destinationWasBlocked ? 403 : 502;
        if (!socket.destroyed) {
          // CONNECT usa o socket diretamente. Terminamos a resposta HTTP de
          // erro com uma linha vazia e encerramos o socket do navegador.
          socket.end(`HTTP/1.1 ${status} Proxy Error\r\nConnection: close\r\n\r\n`);
        }
      });
    });
    // Um pedido HTTP malformado encerra apenas sua conexão, não a API inteira.
    server.on("clientError", (_error, socket) => socket.destroy());
    // Um evento error sem tratador pode interromper o processo Node. Mantemos
    // um tratador geral e usamos a Promise abaixo para falhas ao abrir a porta.
    server.on("error", () => {});

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        this.onAbort = () => {
          reject(new PageFetchError("TIMEOUT"));
          void this.close();
        };
        signal.addEventListener("abort", this.onAbort, { once: true });
        server.once("error", onError);
        // port: 0 pede uma porta livre ao sistema. 127.0.0.1 restringe a
        // escuta ao ambiente local em que o processo está rodando. signal
        // também cancela uma abertura que ainda esteja em andamento.
        server.listen({ port: 0, host: "127.0.0.1", signal }, () => {
          // Este callback só roda com a porta aberta. A partir daqui start
          // pode entregar o endereço e Chromium pode usar o proxy.
          server.removeListener("error", onError);
          resolve();
        });
      });
      if (signal.aborted) throw new PageFetchError("TIMEOUT");
      // Agora sabemos qual porta o sistema reservou para este servidor TCP.
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("Proxy sem porta local.");
      return `http://127.0.0.1:${address.port}`;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  /**
   * Encerra as conexões dos dois lados e para de aceitar pedidos na porta.
   * O timeout e o finally podem pedir limpeza. Reusar a mesma Promise torna
   * close idempotente, ou seja, repetir a chamada não repete o encerramento.
   */
  close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    if (this.signal !== null && this.onAbort !== null) {
      this.signal.removeEventListener("abort", this.onAbort);
    }
    // server.close pode aguardar conexões existentes. Fechamos os sockets
    // antes para uma página lenta não segurar a limpeza do proxy.
    for (const socket of this.sockets) {
      socket.destroy();
    }
    const server = this.server;
    this.closePromise = new Promise<void>((resolve) => {
      if (server === null) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    return this.closePromise;
  }

  /**
   * Encaminha um pedido HTTP comum. Chromium pode pedir GET http://loja.example/p?cor=azul
   * ao proxy. A loja receberá GET /p?cor=azul e Host: loja.example, na conexão
   * ao IP que conferimos. Host identifica qual site queremos nesse endereço.
   */
  private async forwardHttp(request: IncomingMessage, response: ServerResponse, signal: AbortSignal): Promise<void> {
    const target = this.policy.parseUrl(request.url ?? "");
    if (target.protocol !== "http:") throw new PageFetchError("UNSAFE_TARGET");
    const address = await this.policy.resolvePublicAddress(target.hostname, signal);
    // O navegador pode ter fechado a aba enquanto aguardávamos DNS. Não
    // abrimos uma conexão tardia depois que a tentativa/proxy já terminou.
    if (this.closePromise !== null || signal.aborted) throw new PageFetchError("TIMEOUT");
    if (request.destroyed || response.destroyed) return;
    const headers = withoutProxyHeaders(request.headers);
    headers.host = target.host;

    const upstream = requestHttp({
      hostname: address, // O IP aprovado evita um segundo lookup de DNS.
      family: 4,
      port: 80,
      agent: false, // Abre uma conexão própria para este pedido.
      signal,
      path: target.pathname + target.search,
      method: request.method ?? "GET",
      headers,
    }, (remoteResponse) => {
      // Esta função é chamada quando a resposta da loja chega. writeHead
      // repassa status e cabeçalhos antes de pipe encaminhar o corpo em partes.
      response.writeHead(remoteResponse.statusCode ?? 502, withoutProxyHeaders(remoteResponse.headers));
      remoteResponse.on("error", () => response.destroy());
      remoteResponse.pipe(response);
    });
    upstream.on("socket", (socket) => this.trackSocket(socket));
    // A Promise de forwardHttp termina após configurar o encaminhamento. Os
    // eventos abaixo lidam com falhas e encerramentos durante o tráfego.
    upstream.on("error", (error) => this.rejectHttp(response, error));
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream); // Liga o corpo do pedido do Chromium ao pedido para a loja.
    // Redirecionamentos são entregues ao navegador. Seu próximo pedido passará
    // novamente por este proxy, inclusive se mudar domínio, protocolo ou porta.
  }

  /**
   * Atende CONNECT loja.example:443. O navegador está pedindo uma conexão TCP.
   * Após a confirmação, as mensagens TLS da sessão HTTPS passam como bytes
   * pelos sockets. O proxy não precisa decifrá-las para encaminhar o tráfego.
   */
  private async openTunnel(request: IncomingMessage, client: Duplex, head: Buffer, signal: AbortSignal): Promise<void> {
    const target = this.policy.parseUrl(`https://${request.url ?? ""}`);
    // CONNECT recebe só host:porta, nunca caminho/query/hash. parseUrl já veta
    // credenciais, IP literal e portas diferentes da porta HTTPS padrão.
    if (target.pathname !== "/" || target.search !== "" || target.hash !== "") {
      throw new PageFetchError("UNSAFE_TARGET");
    }
    const address = await this.policy.resolvePublicAddress(target.hostname, signal);
    if (this.closePromise !== null || signal.aborted) throw new PageFetchError("TIMEOUT");
    if (client.destroyed) return;
    // Antes da confirmação, ainda podemos responder HTTP 502 ao CONNECT.
    // Depois dela, o navegador espera bytes TLS e encerramos o túnel em erro.
    let established = false;
    const remote = connect({ host: address, family: 4, port: 443, signal });
    this.trackSocket(remote);
    remote.on("error", () => {
      if (client.destroyed) return;
      if (established) client.destroy();
      else client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    });
    client.on("close", () => remote.destroy());
    remote.on("close", () => {
      // Um fechamento normal já chama client.end pelo pipe. Não destruímos
      // nesse caso: end ainda pode estar escoando bytes no buffer de saída.
      if (!client.writableEnded) client.destroy();
    });
    // Aqui connect é um evento do socket remoto. Indica que a conexão TCP
    // com a loja abriu e podemos confirmar o túnel ao navegador.
    remote.once("connect", () => {
      if (client.destroyed || signal.aborted) {
        remote.destroy();
        return;
      }
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      // head é o Buffer que Node já leu depois dos cabeçalhos do CONNECT.
      // Esses bytes pertencem ao túnel e vão primeiro para manter a ordem.
      if (head.length > 0) remote.write(head);
      // Cada pipe encaminha em um sentido. Juntos permitem conversa de ida e volta.
      client.pipe(remote);
      remote.pipe(client);
    });
  }

  private trackSocket(socket: Duplex): void {
    socket.on("error", () => {}); // Falhas são tratadas pelos handlers do pedido/túnel.
    // Se um socket chegar enquanto fechamos o proxy, encerramos na hora.
    if (this.closePromise !== null) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
  }

  private rejectHttp(response: ServerResponse, error: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    // Se o status já foi enviado, uma nova resposta HTTP seria inválida.
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const destinationWasBlocked = error instanceof PageFetchError && error.reason === "UNSAFE_TARGET";
    const status = destinationWasBlocked ? 403 : 502;
    response.writeHead(status, { "content-type": "text/plain", connection: "close" });
    response.end("Destino recusado ou indisponível.");
  }
}

/**
 * Remove cabeçalhos que só valem para um trecho da conexão. Por exemplo,
 * Transfer-Encoding indica como o corpo foi enviado naquele trecho. O Node
 * prepara o envio para o trecho seguinte. Connection também pode listar
 * nomes a remover, como em Connection: keep-alive, x-exemplo.
 */
function withoutProxyHeaders(original: IncomingHttpHeaders): IncomingHttpHeaders {
  const headers = { ...original };
  const listedNames = original.connection?.split(",") ?? [];
  const connectionHeaders = listedNames.map((name) => name.trim().toLowerCase());
  const names = [
    "connection", "proxy-connection", "proxy-authorization", "keep-alive",
    "transfer-encoding", "upgrade", "te", "trailer",
    ...connectionHeaders,
  ];
  for (const name of names) delete headers[name];
  return headers;
}
