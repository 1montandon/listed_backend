import { HttpError } from "../../shared/http/http-error.ts";
import { isProductVerificationPage, PageFetchError } from "./products.errors.ts";
import { suggestProductName } from "./products.name-suggestion.ts";
import { parseProductPage } from "./products.parser.ts";
import { PRODUCT_FIELDS } from "./products.types.ts";
import type { ExtractProductInput } from "./products.schema.ts";
import type {
  ExtractedProduct,
  ExtractionFailure,
  ExtractionResult,
  ExtractionSummary,
  PageLoader,
  ProductPage,
} from "./products.types.ts";

/**
 * ORQUESTRAÇÃO: este service decide QUANDO buscar de outra forma.
 * O loader carrega páginas; Cheerio lê os dados; o service escolhe o resultado.
 * Roteiro de estudo em docs/etapas-iniciais/04-extracao-de-produtos.md#fluxo-da-extracao.
 */
export class ProductsService {
  constructor(private readonly pages: PageLoader) {}

  async extract(input: ExtractProductInput): Promise<ExtractionResult> {
    const originalUrl = input.url;
    // 1. A entrada já passou pelo Zod. Aqui aplicamos as regras de destino
    // antes de qualquer coleta. O loader volta a conferir o destino ao conectar.
    try {
      this.pages.validateUrl(originalUrl);
    } catch {
      throw new HttpError(400, "INVALID_PRODUCT_URL", "Use uma URL pública HTTP ou HTTPS.");
    }

    let bestProduct: ExtractedProduct = {
      url: originalUrl,
      name: null,
      imageUrl: null,
      priceCents: null,
      currency: null,
      storeName: null,
    };
    let fetchError: PageFetchError | null = null;

    // 2. Tentativa HTTP. O loader pode seguir redirecionamentos e retorna o HTML final.
    try {
      const fetchedPage = await this.pages.fetch(originalUrl);
      bestProduct = this.readProductFromPage(fetchedPage, originalUrl);
    } catch (error) {
      // Só erros conhecidos de coleta entram nas regras de fallback. Um erro
      // inesperado de código segue para o tratamento geral de erros da API.
      if (!(error instanceof PageFetchError)) {
        throw error;
      }
      fetchError = error;
    }

    const hasAllProductFields = PRODUCT_FIELDS.every((field) => bestProduct[field] !== null);
    if (hasAllProductFields) {
      return this.toResult(bestProduct);
    }

    // 3. Uma tentativa de fallback quando faltam dados ou houve falha recuperável.
    // 401/403/verificação não são interpretados como "precisa executar JS".
    // Exceção do MVP: 429 do fetch permite UMA coleta alternativa com Chromium.
    // Isso pode antecipar o Retry-After pedido pela loja; não é uma regra geral
    // de retry HTTP. Se o navegador também recusar, não há nova tentativa.
    if (fetchError !== null && !this.canTryBrowser(fetchError.reason)) {
      return this.toResult(bestProduct, fetchError.reason);
    }

    let failureReason: ExtractionFailure = fetchError?.reason ?? "NO_PRODUCT_DATA";
    try {
      const renderedPage = await this.pages.render(originalUrl);
      const renderedProduct = this.readProductFromPage(renderedPage, originalUrl);

      // Trocamos a prévia inteira para manter os dados da mesma página juntos.
      // Se o navegador encontrou mais campos, ainda conferimos o nome para
      // reduzir a chance de trocar o item original por uma recomendação.
      const fetchedFieldCount = PRODUCT_FIELDS.filter((field) => bestProduct[field] !== null).length;
      const renderedFieldCount = PRODUCT_FIELDS.filter((field) => renderedProduct[field] !== null).length;
      const renderedHasMoreFields = renderedFieldCount > fetchedFieldCount;
      if (renderedHasMoreFields && this.namesAreCompatible(bestProduct.name, renderedProduct.name)) {
        bestProduct = renderedProduct;
      }
    } catch (error) {
      if (!(error instanceof PageFetchError)) {
        throw error;
      }
      failureReason = error.reason;
      // Navegador ocupado/indisponível/timeout não apaga a prévia HTTP útil.
    }

    return this.toResult(bestProduct, failureReason);
  }

  private readProductFromPage(page: ProductPage, originalUrl: string): ExtractedProduct {
    // A loja pode redirecionar para uma tela de verificação que responde 200 e
    // tem seu próprio título. Aplicamos a mesma regra antes do parser nas duas fontes.
    const finalUrl = new URL(page.finalUrl);
    if (isProductVerificationPage(finalUrl)) {
      throw new PageFetchError("REMOTE_VERIFICATION_REQUIRED");
    }
    return parseProductPage(page.html, originalUrl, page.finalUrl, page.contentType);
  }

  private canTryBrowser(reason: ExtractionFailure): boolean {
    return reason === "FETCH_FAILED"
      || reason === "TIMEOUT"
      || reason === "NO_PRODUCT_DATA"
      || reason === "REMOTE_RATE_LIMITED";
  }

  private namesAreCompatible(fetchedName: string | null, renderedName: string | null): boolean {
    if (fetchedName === null) {
      return true;
    }
    if (renderedName === null) {
      return false;
    }
    // Depois de converter para minúsculas, aceitamos que um nome contenha o
    // outro. Qualquer página pode acrescentar um sufixo como " - AliExpress".
    const normalizedFetchedName = fetchedName.toLowerCase();
    const normalizedRenderedName = renderedName.toLowerCase();
    return normalizedFetchedName.includes(normalizedRenderedName)
      || normalizedRenderedName.includes(normalizedFetchedName);
  }

  private toResult(product: ExtractedProduct, reason: ExtractionFailure = "NO_PRODUCT_DATA"): ExtractionResult {
    const missingFields = PRODUCT_FIELDS.filter((field) => product[field] === null);
    const responseFields: ExtractionSummary = { product, missingFields };
    // Só sugerimos no fim, depois de escolher a melhor página. Se preenchêssemos
    // product.name antes, a sugestão poderia contar como campo extraído ou
    // impedir a escolha de um nome real com outra grafia ou idioma.
    // product.url guarda o link colado, que pode ter o nome perdido no redirect.
    if (product.name === null) {
      const suggestedName = suggestProductName(product.url);
      if (suggestedName !== null) {
        responseFields.suggestedName = suggestedName;
      }
    }

    // Só loja ou só moeda ainda não identificam um produto para revisão.
    const hasProductData = product.name !== null || product.imageUrl !== null || product.priceCents !== null;
    if (!hasProductData) {
      return { status: "failed", ...responseFields, reason };
    }
    if (missingFields.length === 0) {
      return { status: "complete", ...responseFields };
    }
    return { status: "partial", ...responseFields };
  }
}
