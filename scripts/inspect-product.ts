/**
 * Diagnóstico do fluxo OFICIAL: npm run inspect:product -- "https://loja/produto"
 * Chama ProductsService, incluindo fallback quando elegível, sem Express/banco.
 * Registra qual fonte foi usada; não imprime cookies nem o HTML completo.
 */
import * as cheerio from "cheerio";
import { fetch } from "undici";
import { PageFetchError } from "../src/modules/products/products.errors.ts";
import { ProductPageLoader } from "../src/modules/products/products.page-loader.ts";
import { ProductsService } from "../src/modules/products/products.service.ts";
import { ProductUrlPolicy } from "../src/modules/products/network/url-policy.ts";
import type { ExtractionFailure, ProductPage, PageLoader } from "../src/modules/products/products.types.ts";

interface PageInfo {
  finalUrl: string;
  bytes: number;
  title: string;
  jsonLdBlocks: number;
}

const url = process.argv[2];
if (!url) {
  console.error('Uso: npm run inspect:product -- "https://loja.example/produto"');
  process.exitCode = 1;
} else {
  const requests: { url: string; status: number; location: string | null; retryAfter: string | null }[] = [];
  const pages: { fetch?: PageInfo; playwright?: PageInfo } = {};
  let browserAttempted = false;
  let browserFailure: ExtractionFailure | null = null;
  const policy = new ProductUrlPolicy();
  const loader = new ProductPageLoader(policy, {
    fetchPage: async (input, options) => {
      const response = await fetch(input, options);
      requests.push({ url: String(input), status: response.status, location: response.headers.get("location"),
        retryAfter: response.headers.get("retry-after") });
      return response;
    },
  });

  // Este adaptador apenas observa os dois caminhos do loader e guarda um resumo.
  // A decisão sobre chamar o navegador continua dentro de ProductsService.
  const observedLoader: PageLoader = {
    validateUrl: (value) => loader.validateUrl(value),
    async fetch(value) {
      const page = await loader.fetch(value);
      pages.fetch = describePage(page);
      return page;
    },
    async render(value) {
      browserAttempted = true;
      try {
        const page = await loader.render(value);
        pages.playwright = describePage(page);
        return page;
      } catch (error) {
        if (error instanceof PageFetchError) browserFailure = error.reason;
        throw error;
      }
    },
  };

  try {
    const result = await new ProductsService(observedLoader).extract({ url });
    console.info(JSON.stringify({ requests, browserAttempted, browserFailure, pages, result }, null, 2));
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Erro inesperado no diagnóstico.");
    process.exitCode = 1;
  }
}

/** Resumo da página já recebida. O charset deve ser o mesmo usado pelo parser. */
function describePage(page: ProductPage): PageInfo {
  const encoding: { defaultEncoding: string; transportLayerEncodingLabel?: string } = { defaultEncoding: "utf8" };
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(page.contentType)?.[1];
  if (charset !== undefined) {
    try { new TextDecoder(charset); encoding.transportLayerEncodingLabel = charset; }
    catch { /* Cheerio ainda verifica a codificação dentro do próprio HTML. */ }
  }
  const document = cheerio.loadBuffer(page.html, { encoding });
  return {
    finalUrl: page.finalUrl, bytes: page.html.length, title: document("title").text(),
    jsonLdBlocks: document('script[type*="ld+json"]').length,
  };
}
