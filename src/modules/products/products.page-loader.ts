/**
 * CARREGAR HTML — DUAS FORMAS, UM CONTRATO DE SAÍDA
 *
 * Comece pelos métodos públicos. fetch baixa o corpo da resposta HTTP com
 * Undici. render navega com Chromium e captura a árvore atual da página.
 * Os dois devolvem ProductPage, com HTML, URL final e tipo de conteúdo.
 * ProductsService decide quando tentar o navegador e qual página aproveitar.
 *
 * Leia nesta ordem: validateUrl → fetch e seus auxiliares → render.
 * Detalhes de URL/DNS/proxy ficam em network/. Os comentários explicam
 * as APIs no ponto de uso. A teoria e um exemplo completo ficam no roteiro:
 * README.md#carregando-o-html e README.md#rede-e-proxy.
 */
import { setTimeout as delay } from "node:timers/promises";
import { Agent, fetch } from "undici";
import type { Response } from "undici";
import { chromium } from "playwright";
import type { Browser, LaunchOptions } from "playwright";
import { BrowserProxy } from "./network/browser-proxy.ts";
import { ProductUrlPolicy } from "./network/url-policy.ts";
import { isProductVerificationPage, PageFetchError } from "./products.errors.ts";
import { parseProductPage } from "./products.parser.ts";
import { PRODUCT_FIELDS } from "./products.types.ts";
import type { PageLoader, ProductPage } from "./products.types.ts";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const HTTP_TIMEOUT_MS = 10_000;
const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];

type LaunchBrowser = (options: LaunchOptions) => Promise<Browser>;
interface PageLoaderOptions {
  // Guardamos funções que serão chamadas durante a coleta. Um teste pode
  // entregar uma resposta pronta ou controlar a abertura do navegador.
  fetchPage?: typeof fetch;
  launchBrowser?: LaunchBrowser;
  browserTimeoutMs?: number;
}

export class ProductPageLoader implements PageLoader {
  private readonly policy: ProductUrlPolicy;
  private readonly fetchPage: typeof fetch;
  private readonly launchBrowser: LaunchBrowser;
  private readonly browserTimeoutMs: number;
  // O router compartilha uma instância deste loader. Duas requisições podem
  // baixar HTML por HTTP, mas só uma pode usar o Chromium dessa instância.
  private busy = false;

  constructor(policy: ProductUrlPolicy = new ProductUrlPolicy(), options: PageLoaderOptions = {}) {
    this.policy = policy;
    this.fetchPage = options.fetchPage ?? fetch;
    this.launchBrowser = options.launchBrowser ?? ((settings) => chromium.launch(settings));
    this.browserTimeoutMs = options.browserTimeoutMs ?? 25_000;
  }

  /** Só interpreta/valida o endereço escrito. Não consulta DNS nem abre conexão. */
  validateUrl(rawUrl: string): void {
    this.policy.parseUrl(rawUrl);
  }

  /**
   * PRIMEIRO CAMINHO: pedir HTML por HTTP.
   * A função fetch do Undici entrega a resposta assim que chegam os cabeçalhos.
   * readHtmlBody consome o corpo em partes e verifica o limite durante a leitura.
   */
  async fetch(rawUrl: string): Promise<ProductPage> {
    // 1. Separa e valida a URL. Isso não acessa a internet.
    let currentUrl = this.policy.parseUrl(rawUrl);

    // 2. AbortSignal é um aviso de cancelamento. timeout cria um sinal que
    // dispara após 10s. Criamos UMA vez: redirects compartilham o mesmo prazo.
    // Sem esse prazo, uma loja lenta poderia prender a tentativa por muito tempo.
    const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);

    // A primeira requisição tem zero redirects. Podemos seguir mais três.
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      // 3. Descobre um IP permitido e prepara a conexão para usar exatamente ele.
      const publicAddress = await this.policy.resolvePublicAddress(currentUrl.hostname, signal);
      const agent = this.createAgent(publicAddress);

      try {
        // 4. fetch abre a conexão e faz um GET (método padrão). Quando ele
        // retorna, os cabeçalhos já chegaram; o corpo pode estar chegando ainda.
        const response = await this.fetchPage(currentUrl, {
          dispatcher: agent, // Nome que Undici dá ao gerenciador da requisição.
          redirect: "manual", // Não seguir outro destino sem validá-lo primeiro.
          signal,
          headers: {
            // Headers são informações sobre o pedido, separadas do corpo.
            accept: "text/html,application/xhtml+xml", // Queremos uma página HTML.
            "user-agent": "ListedBot/0.1 (+product-preview)", // Identifica o cliente.
          },
        });

        // 5. Status HTTP 301/302/... dizem "vá para outro endereço". O destino
        // vem no cabeçalho Location. Ex.: /p/1 → https://loja.example/p/1.
        if (REDIRECT_STATUS_CODES.includes(response.status)) {
          // O corpo do redirect não nos interessa. cancel interrompe sua leitura.
          // ?. só chama cancel se body existir; pode haver resposta sem corpo.
          await response.body?.cancel();
          if (redirectCount === MAX_REDIRECTS) {
            throw new PageFetchError("TOO_MANY_REDIRECTS");
          }

          const location = response.headers.get("location");
          if (location === null) throw new PageFetchError("FETCH_FAILED");

          try {
            // new URL aceita um segundo argumento como base para links relativos.
            const nextUrl = new URL(location, currentUrl);
            currentUrl = this.policy.parseUrl(nextUrl.href);
          } catch {
            throw new PageFetchError("UNSAFE_REDIRECT");
          }

          // Cada redirect inicia uma nova conexão depois de conferir o DNS do
          // próximo destino. O Agent desta conexão é encerrado pelo finally.
          continue;
        }

        // 6. Agora esperamos TODOS os bytes do HTML, respeitando o limite.
        // Este await é necessário antes de sair do try: finally só deve destruir
        // o Agent depois da leitura. Não devolvemos uma leitura ainda pendente.
        const html = await this.readHtmlBody(response);
        const contentType = response.headers.get("content-type") ?? "";
        return { html, finalUrl: currentUrl.href, contentType };
      } catch (error) {
        // Falhas que nós classificamos preservam seu motivo. As demais podem
        // vir de TLS, conexão recusada etc. Não enviamos esses detalhes à UI.
        if (error instanceof PageFetchError) throw error;
        if (signal.aborted) throw new PageFetchError("TIMEOUT");
        throw new PageFetchError("FETCH_FAILED");
      } finally {
        // finally roda em sucesso, erro, return e continue. Agent é um recurso
        // de rede: encerrá-lo evita deixar conexões abertas após a tentativa.
        await agent.destroy();
      }
    }

    throw new PageFetchError("TOO_MANY_REDIRECTS");
  }

  /**
   * ETAPA 3b: IP aprovado → Agent configurado. Ainda não há pedido HTTP.
   * O Agent fixa o endereço aprovado: uma segunda consulta DNS não pode mudá-lo.
   * A explicação completa está no README, seção Rede e proxy.
   * connect.lookup é um ponto de configuração fornecido por Undici/Node:
   * quando a conexão precisar do IP, ela chamará nossa função abaixo.
   */
  private createAgent(publicAddress: string): Agent {
    return new Agent({
      connect: {
        family: 4, // Escolhemos IPv4; não pedimos seleção automática IPv4/IPv6.
        lookup: (_hostname, _options, callback) => {
          // callback é uma função passada pelo Node para receber o resultado.
          // Esta API antiga usa (erro, resultado, família), em vez de Promise.
          // null = nenhum erro; publicAddress = resultado; 4 = IPv4.
          // _ marca argumentos que recebemos mas não usamos: o IP já foi escolhido.
          callback(null, publicAddress, 4);
        },
      },
    });
  }

  /**
   * ETAPA 6: resposta HTTP → bytes do HTML.
   * Uma resposta tem status (200/404...), headers (metadados) e body (conteúdo).
   * Content-Type informa o formato do body: HTML, JSON, imagem etc.
   *
   * response.text() seria suficiente para baixar uma página pequena, mas só
   * conseguiríamos verificar seu tamanho DEPOIS de carregá-la inteira. Aqui
   * lemos partes para interromper quando passar de 2 MiB. Content-Length não
   * basta: pode faltar e pode descrever o tamanho comprimido, não o expandido.
   */
  private async readHtmlBody(response: Response): Promise<Buffer> {
    // O servidor pode recusar a requisição antes de entregar o produto.
    // 429 pede redução de requisições; 401/403 indicam acesso não autorizado.
    // Separar esses casos impede confundir bloqueio com seletor JSON-LD errado.
    if (response.status === 429) {
      throw new PageFetchError("REMOTE_RATE_LIMITED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new PageFetchError("REMOTE_ACCESS_DENIED");
    }
    if (!response.ok) throw new PageFetchError("FETCH_FAILED"); // ok = status 200–299.

    const contentType = response.headers.get("content-type") ?? "";
    // "text/html; charset=utf-8" vira "text/html" antes da comparação.
    const [mediaTypeText] = contentType.split(";");
    const mediaType = mediaTypeText?.trim().toLowerCase();
    const isHtml = mediaType === "text/html" || mediaType === "application/xhtml+xml";
    if (!isHtml) throw new PageFetchError("UNSUPPORTED_CONTENT");
    if (response.body === null) throw new PageFetchError("FETCH_FAILED");

    const chunks: Buffer[] = []; // Array de pedaços; ainda não é um HTML único.
    let receivedBytes = 0;

    // Stream é conteúdo recebido aos poucos. for await espera cada pedaço
    // chegar; um for comum só percorreria valores que já estivessem disponíveis.
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk); // Converte o pedaço para Buffer do Node.
      receivedBytes += bytes.length; // length conta bytes, não letras.
      if (receivedBytes > MAX_HTML_BYTES) throw new PageFetchError("PAGE_TOO_LARGE");
      chunks.push(bytes);
    }

    // Junta os pedaços na ordem de chegada. A codificação (UTF-8 etc.) será
    // tratada pelo parser; não convertemos bytes para texto com encoding errado.
    return Buffer.concat(chunks);
  }

  /**
   * SEGUNDO CAMINHO — Obter uma captura do HTML depois de executar JavaScript.
   * Playwright controla Chromium. Browser é o navegador aberto, Context é a
   * sessão isolada e Page é a aba. Criamos os três para esta tentativa.
   * As quatro etapas abrem a sessão, navegam, aguardam os campos e fecham
   * os recursos. Detalhes de rede ficam em BrowserProxy.
   */
  async render(rawUrl: string): Promise<ProductPage> {
    this.policy.parseUrl(rawUrl);
    if (this.busy) throw new PageFetchError("BROWSER_BUSY");
    // Atribuímos antes do primeiro await. Assim outra chamada já vê busy=true
    // quando esta começar a aguardar a abertura do proxy ou do navegador.
    this.busy = true;

    const controller = new AbortController();
    const proxy = new BrowserProxy(this.policy);
    let browser: Browser | null = null;
    // Guardamos a última captura, mesmo incompleta, para que o service possa
    // avaliá-la se o prazo acabar antes de aparecerem todos os campos.
    let lastPage: ProductPage | null = null;
    const onTimeout = () => {
      // abort emite um aviso que cancela conexões do proxy e a pausa do laço.
      // close também interrompe uma navegação ou leitura pendente do Chromium.
      controller.abort();
      if (browser !== null) {
        // O callback do relógio não espera Promises. O finally abaixo também
        // garante o fechamento se o navegador ainda estava abrindo aqui.
        void browser.close().catch(() => {});
      }
    };
    // O prazo total começa antes de abrir o proxy. Os limites de launch e goto
    // controlam etapas específicas dentro desse mesmo prazo.
    const timer = setTimeout(onTimeout, this.browserTimeoutMs);

    try {
      // 1. ABRIR A SESSÃO. O endereço de proxy indica ao navegador por onde
      // enviar pedidos. O proxy verifica o IP a cada nova conexão encaminhada.
      const proxyUrl = await proxy.start(controller.signal);
      try {
        browser = await this.launchBrowser({
          headless: true, // Chromium abre sem janela visível.
          timeout: Math.min(10_000, this.browserTimeoutMs),
          proxy: { server: proxyUrl, bypass: "<-loopback>" },
          // <-loopback> retira a exceção automática para endereços locais.
          // Assim o pedido local também passa pelo proxy, que pode recusá-lo.
          args: [
            "--disable-quic",
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          ],
          // QUIC/WebRTC podem usar UDP, fora dos túneis TCP deste proxy.
          // Aqui mantemos o tráfego web no caminho de conexão que controlamos.
        });
      } catch {
        throw new PageFetchError(controller.signal.aborted ? "TIMEOUT" : "BROWSER_UNAVAILABLE");
      }
      if (controller.signal.aborted) throw new PageFetchError("TIMEOUT");

      // Um contexto novo separa cookies e dados da sessão por tentativa.
      // Bloqueamos service workers para que scripts de fundo do site não
      // controlem o roteamento, e recusamos downloads de arquivos.
      const context = await browser.newContext({
        locale: "pt-BR",
        viewport: { width: 1280, height: 800 },
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      const page = await context.newPage();
      // **/* seleciona pedidos do contexto. Abortar imagens, fontes e mídia
      // economiza tráfego. Os demais recursos podem seguir pelo proxy, inclusive
      // JavaScript e os dados que ele pedir para montar a página.
      await context.route("**/*", async (route) => {
        const resource = route.request().resourceType();
        if (["image", "font", "media"].includes(resource)) {
          await route.abort();
        } else {
          // fallback deixa o pedido seguir pelas regras de rede do contexto.
          await route.fallback();
        }
      });

      // 2. NAVEGAR. Um script pode redirecionar a aba depois que goto devolve
      // sua resposta. O evento response acompanha o status de cada navegação.
      // mainFrame é o documento principal. Imagens, scripts e documentos
      // incorporados (iframes) têm respostas HTTP próprias.
      let documentStatus: number | null = null;
      page.on("response", (response) => {
        const request = response.request();
        const isMainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (isMainNavigation) {
          documentStatus = response.status();
        }
      });
      // DOMContentLoaded indica que o navegador já interpretou o HTML inicial.
      // Dados que um script pede depois ainda podem estar a caminho.
      const response = await page.goto(rawUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(15_000, this.browserTimeoutMs),
      });
      if (response === null) throw new PageFetchError("FETCH_FAILED");
      const contentTypeHeader = response.headers()["content-type"];
      const mediaTypeText = contentTypeHeader?.split(";")[0];
      const mediaType = mediaTypeText?.trim().toLowerCase();
      if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") {
        throw new PageFetchError("UNSUPPORTED_CONTENT");
      }

      // 3. AGUARDAR OS CAMPOS. A cada captura, avaliamos o documento principal,
      // conferimos seu endereço e tentamos extrair a prévia da árvore atual.
      while (!controller.signal.aborted) {
        if (documentStatus === 429) throw new PageFetchError("REMOTE_RATE_LIMITED");
        if (documentStatus === 401 || documentStatus === 403) throw new PageFetchError("REMOTE_ACCESS_DENIED");
        if (documentStatus !== null && documentStatus >= 400) throw new PageFetchError("FETCH_FAILED");

        const finalUrl = this.policy.parseUrl(page.url());
        // A URL pode mudar depois que o JavaScript começa a rodar. Checamos
        // cada endereço antes de ler o HTML ou continuar esperando os campos.
        if (isProductVerificationPage(finalUrl)) throw new PageFetchError("REMOTE_VERIFICATION_REQUIRED");

        // page.content serializa a árvore atual em uma string HTML. Ela pode
        // conter elementos que JavaScript criou depois da resposta inicial.
        // Chromium já decodificou o texto. Ao recriar bytes UTF-8, informamos
        // essa codificação ao parser para que ele leia os bytes corretamente.
        const htmlText = await page.content();
        const html = Buffer.from(htmlText, "utf8");
        // Este limite protege a entrada do parser. Chromium já montou a árvore
        // e devolveu a string, diferente da leitura em partes do fetch.
        if (html.length > MAX_HTML_BYTES) throw new PageFetchError("PAGE_TOO_LARGE");
        lastPage = {
          html,
          finalUrl: finalUrl.href,
          contentType: "text/html; charset=utf-8",
        };
        const product = parseProductPage(html, rawUrl, lastPage.finalUrl, lastPage.contentType);
        const hasAllProductFields = PRODUCT_FIELDS.every((field) => product[field] !== null);
        if (hasAllProductFields) {
          return lastPage;
        }

        // O sucesso depende dos campos. Uma página pode continuar enviando
        // métricas mesmo depois de já mostrar os dados do produto.
        // A pausa de 500 ms evita capturas seguidas e termina se o prazo vencer.
        await delay(500, undefined, { signal: controller.signal });
      }
      if (lastPage !== null) return lastPage;
      throw new PageFetchError("TIMEOUT");
    } catch (error) {
      // Se o prazo acabou mas já havia um HTML parcial, o service ainda pode
      // aproveitá-lo. Erros de destino/bloqueio não são convertidos em sucesso.
      if (controller.signal.aborted) {
        if (lastPage !== null) return lastPage;
        throw new PageFetchError("TIMEOUT");
      }
      if (error instanceof PageFetchError) throw error;
      throw new PageFetchError("FETCH_FAILED");
    } finally {
      // 4. FECHAR. Paramos o relógio e liberamos navegador e proxy antes de
      // permitir outra tentativa. Cada finally protege a próxima limpeza.
      clearTimeout(timer);
      try {
        // Fecha contexto e abas também. O timeout pode já ter fechado a conexão
        // com Chromium; uma rejeição na limpeza não deve substituir a prévia útil.
        if (browser !== null) await browser.close().catch(() => {});
      } finally {
        try {
          await proxy.close();
        } finally {
          this.busy = false;
        }
      }
    }
  }
}
