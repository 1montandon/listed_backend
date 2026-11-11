import type { ExtractionFailure } from "./products.types.ts";

/**
 * Falha conhecida durante a coleta de uma página.
 * O service traduz reason para a resposta da API, sem expor erros internos de rede.
 */
export class PageFetchError extends Error {
  public readonly reason: ExtractionFailure;

  constructor(reason: ExtractionFailure) {
    super(reason); // Inicializa Error.message com o motivo conhecido.
    // name identifica esta classe ao inspecionar um erro; não é um campo do produto.
    this.name = "PageFetchError";
    this.reason = reason;
  }
}

/**
 * Reconhece URLs de verificação observadas após redirects. A página de bloqueio
 * pode responder HTTP 200 e até ter um og:title da loja, como vimos na Shopee.
 * Conferimos o domínio junto do caminho, pois outro site pode usar a mesma rota.
 */
export function isProductVerificationPage(page: URL): boolean {
  // pathname contém só o caminho, sem ?next=... e sem #fragmento. O replace
  // aceita o mesmo endereço com ou sem uma barra no final.
  const path = page.pathname.replace(/\/$/, "");
  const hostname = page.hostname;
  if (hostname === "br.shein.com") {
    return path === "/risk/action/limit" || path === "/risk/challenge";
  }
  if (hostname === "shopee.com.br" || hostname === "www.shopee.com.br") {
    return path === "/verify/traffic/error";
  }
  // O ponto antes do domínio permite subdomínios como www.mercadolivre.com.br
  // sem confundir outro domínio como falsomercadolivre.com.br.
  const isMercadoLivre = hostname === "mercadolivre.com.br" || hostname.endsWith(".mercadolivre.com.br");
  if (!isMercadoLivre) {
    return false;
  }
  return path === "/gz/account-verification" || path.startsWith("/gz/account-verification/");
}
