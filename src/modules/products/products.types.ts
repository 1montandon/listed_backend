export type ProductField = "name" | "imageUrl" | "price" | "currency" | "storeName";

// Um contrato único de completude, usado pelo service e pela espera do navegador.
export const PRODUCT_FIELDS: ProductField[] = ["name", "imageUrl", "price", "currency", "storeName"];

export interface ProductPage {
  html: Buffer;
  finalUrl: string;
  contentType: string;
}

// O service conhece estas operações, sem receber objetos internos do Playwright.
// O loader real e os objetos controlados dos testes seguem este mesmo contrato.
export interface PageLoader {
  validateUrl(url: string): void;
  fetch(url: string): Promise<ProductPage>;
  render(url: string): Promise<ProductPage>;
}

export interface ExtractedProduct {
  url: string;
  name: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  storeName: string | null;
}

export type ExtractionFailure =
  | "FETCH_FAILED"
  | "REMOTE_ACCESS_DENIED"
  | "REMOTE_RATE_LIMITED"
  | "REMOTE_VERIFICATION_REQUIRED"
  | "TIMEOUT"
  | "UNSAFE_TARGET"
  | "UNSAFE_REDIRECT"
  | "TOO_MANY_REDIRECTS"
  | "PAGE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT"
  | "NO_PRODUCT_DATA"
  | "BROWSER_BUSY"
  | "BROWSER_UNAVAILABLE";

export interface ExtractionSummary {
  product: ExtractedProduct;
  missingFields: ProductField[];
  // O ? indica que o campo pode estar ausente. Quando aparece, é um texto
  // lido da URL para revisão manual, separado dos dados coletados da página.
  suggestedName?: string;
}

// & combina os campos comuns com uma das duas formas de resultado. O TypeScript
// só permite acessar reason depois de confirmar que status é "failed".
export type ExtractionResult = ExtractionSummary & (
  | { status: "complete" | "partial" }
  | { status: "failed"; reason: ExtractionFailure }
);
