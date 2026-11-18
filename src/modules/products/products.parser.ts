/**
 * HTML → PRODUTO
 *
 * Recebe os bytes que ProductPageLoader.fetch ou render já obteve e devolve
 * nome, imagem, preço, moeda e loja. Não faz rede nem executa JavaScript.
 *
 * A transformação principal tem cinco etapas numeradas. Comece por
 * parseProductPage e depois acompanhe os auxiliares conforme são chamados.
 * Exemplo do caminho: <script>{"name":"Camisa"}</script> → texto → objeto.
 * A explicação de Cheerio/JSON-LD e o exemplo completo estão em:
 * docs/etapas-iniciais/04-extracao-de-produtos.md#lendo-o-produto e #conceitos-de-typescript.
 */
// * as cheerio reúne as funções exportadas pelo pacote sob esse nome.
// Por isso chamamos cheerio.loadBuffer, em vez de importar só loadBuffer.
import * as cheerio from "cheerio";
import type { ExtractedProduct } from "./products.types.ts";

// Record<string, unknown> = objeto com chaves string e valores ainda não
// conhecidos. Ex.: { name: "Camisa", price: 10 } cabe nesse tipo. Ele não afirma
// que existe name ou que name é string. Dados de outro site precisam de checagem.
type JsonObject = Record<string, unknown>;

// O preço e sua moeda viajam juntos para não misturar ofertas diferentes.
interface OfferDetails {
  price: string | null;
  currency: string | null;
  isPriceRange: boolean; // Impede que uma faixa vire preço exato via meta tag global.
}

interface VariantSelection {
  parameter: "variant" | "skucode";
  id: string;
}

/**
 * Recebe: bytes do HTML, URL colada, URL após redirects e Content-Type HTTP.
 * Devolve: objeto com nome/imagem/preço/moeda/loja; ausências viram null.
 * As URLs são diferentes porque uma loja pode redirecionar /p/antigo a /p/novo.
 * Usamos a final para completar /foto.jpg e preservamos a original na saída.
 */
export function parseProductPage(
  html: Buffer,
  originalUrl: string,
  finalUrl: string,
  contentType = "text/html", // Valor padrão quando quem chama não fornece isto.
): ExtractedProduct {
  const pageUrl = new URL(finalUrl);

  // 1. BYTES → HTML CONSULTÁVEL
  // Um byte é um número de 0 a 255. Texto é representado por sequências desses
  // números. Charset é a regra de conversão (UTF-8, Windows-1252...). Usar a
  // regra errada pode transformar "Café" em "CafÃ©". Ainda não chamamos toString
  // no Buffer: deixamos Cheerio considerar o charset HTTP e o meta charset HTML.
  const encoding: { defaultEncoding: string; transportLayerEncodingLabel?: string } = {
    defaultEncoding: "utf8",
  };
  // O tipo acima descreve opções da biblioteca. ? indica propriedade opcional.
  // transportLayerEncodingLabel é o nome da opção para o charset vindo do HTTP.
  // Ex.: "text/html; charset=utf-8" deve fornecer "utf-8".
  const charsetMatch = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType);
  // Essa regex aceita espaços em torno de =, aspas opcionais e captura o nome
  // até espaço/;/aspas. O grupo capturado fica em [1]; exec retorna null sem match.
  const httpCharset = charsetMatch?.[1];
  if (httpCharset !== undefined) {
    try {
      new TextDecoder(httpCharset); // Verifica se Node reconhece essa codificação.
      // Não usamos este decoder para ler o HTML: Cheerio considera também BOM
      // (marca de codificação no começo dos bytes) e meta charset dentro do HTML.
      encoding.transportLayerEncodingLabel = httpCharset;
    } catch {
      // Cabeçalho errado não inutiliza a página: Cheerio ainda verifica o HTML.
    }
  }

  // document é uma FUNÇÃO de consulta retornada pelo Cheerio. É comum chamá-la
  // de $, mas usamos document para não parecer uma sintaxe especial de JS.
  const document = cheerio.loadBuffer(html, { encoding });

  // 2. HTML → TEXTO JSON → PRODUTO OU VARIANTE PEDIDA NO LINK
  // searchParams lê os parâmetros depois do ?. Ex.: ?variant=222 pede uma
  // variante no Shopify e ?skucode=ABC identifica um tamanho na Shein Brasil.
  const hasSheinSku = pageUrl.hostname === "br.shein.com" && pageUrl.searchParams.has("skucode");
  const variantParameter = hasSheinSku ? "skucode" : "variant";
  const requestedVariantId = pageUrl.searchParams.get(variantParameter);
  // get retorna null quando o parâmetro está ausente. Com ?variant= o valor
  // é "", que ainda conta como seleção e precisa corresponder a um link.
  let selection: VariantSelection | null = null;
  if (requestedVariantId !== null) {
    selection = { parameter: variantParameter, id: requestedVariantId };
  }

  // Seletor CSS: script = tag; [type*=...] = atributo type CONTÉM esse texto.
  // toArray transforma o resultado da busca em array comum para percorrermos.
  const scripts = document('script[type*="ld+json"]').toArray();
  let product: JsonObject | null = null;

  for (const script of scripts) {
    // document(script) permite usar métodos Cheerio naquele elemento.
    // .text() lê o conteúdo entre <script> e </script>, sem as tags.
    const jsonText = document(script).text();
    try {
      // JSON.parse transforma string JSON em valor JavaScript. Uma string
      // inválida lança erro. Não é eval: nenhum JavaScript do site é executado.
      const json: unknown = JSON.parse(jsonText);
      const foundProduct = findProductEntity(json, pageUrl, selection);
      if (foundProduct !== null) {
        product = foundProduct;
        break; // Regra do MVP: usar o primeiro Product encontrado.
      }
    } catch {
      // Pode haver vários scripts, incluindo um malformado. Tentamos o próximo.
    }
  }

  // 3. ESCOLHER A OFERTA DO PRODUTO
  // Lojas não publicam preço sempre no mesmo caminho. readOfferDetails trata
  // Offer.price, priceSpecification e AggregateOffer com ofertas internas.
  // A função abaixo explica cada formato com exemplos. No ProductGroup,
  // a escolha da variante já ocorreu na etapa 2, antes de ler a oferta.
  let offerValue = product?.offers;
  // A Mad enviada usa Product com várias offers, sem ProductGroup. Nessa forma,
  // ?variant também deve escolher a oferta certa em vez da primeira da lista.
  if (selection !== null && Array.isArray(offerValue)) {
    const offers = offerValue.filter(isJsonObject);
    offerValue = offers.find((item) => matchesVariant(item, selection, pageUrl));
  }
  const offer = readOfferDetails(offerValue);

  // 4. LER OS CAMPOS E COMPLETAR AUSÊNCIAS COM META TAGS
  // Open Graph (og:...) é usado em prévias de links. Exemplo:
  // <meta property="og:title" content="Camisa">. Para ler "Camisa", pegamos
  // content com attr. A vírgula combina os seletores property e name, e first
  // escolhe a primeira tag que corresponder a qualquer um deles.
  const readMetaContent = (key: string): string | undefined => {
    const selector = `meta[property="${key}"], meta[name="${key}"]`;
    return document(selector).first().attr("content");
  };

  let name = readText(product?.name);
  if (name === null) {
    name = readText(readMetaContent("og:title"));
  }
  if (name === null) {
    // <title> é o texto da aba, que também pode dizer "Access Denied" ou trazer
    // o nome da loja. Só usamos esse texto se já houver um sinal de produto:
    // um Product/ProductGroup no JSON-LD ou <meta property="og:type" content="product">.
    const metaPageType = readMetaContent("og:type");
    const pageType = readText(metaPageType)?.toLowerCase();
    const hasProductEvidence = product !== null || pageType === "product";
    if (hasProductEvidence) {
      name = readText(document("title").first().text());
    }
  }

  let imageUrl = normalizeImageUrl(product?.image, finalUrl);
  if (imageUrl === null) {
    imageUrl = normalizeImageUrl(readMetaContent("og:image"), finalUrl);
  }

  let price = offer.price;
  let currency = offer.currency;
  // A meta global pode descrever a variante padrão ou o menor valor de uma
  // faixa. Só usamos esse preço quando o link não escolhe uma variante e o
  // JSON-LD não indica faixa de preços.
  if (selection === null && !offer.isPriceRange) {
    const metaPrice = normalizePrice(readMetaContent("product:price:amount"));
    const metaCurrency = normalizeCurrency(readMetaContent("product:price:currency"));
    if (price === null && metaPrice !== null) {
      // Ao escolher preço da meta, sua moeda deve vir do mesmo contexto.
      price = metaPrice;
      currency = metaCurrency;
    } else if (currency === null && (price === null || metaPrice === price)) {
      // Preço direto 100 não pode receber USD de uma meta que informa 50 USD.
      // Sem preço em lugar algum, a moeda pode ser conhecida independentemente.
      currency = metaCurrency;
    }
  }

  // Sem nome da loja, usamos o domínio. Não usamos product.brand: no exemplo,
  // Marfinno é a marca da camisa; Renner é a loja que vende a camisa.
  const metaStoreName = readMetaContent("og:site_name");
  let storeName = readText(metaStoreName);
  if (storeName === null) {
    storeName = pageUrl.hostname.replace(/^www\./, "");
  }

  // 5. MONTAR A SAÍDA PREVISÍVEL DO LISTED
  // A loja pode ter centenas de propriedades; a API devolve somente estas.
  // null informa "não encontramos". O service decide complete/partial/failed.
  return { url: originalUrl, name, imageUrl, price, currency, storeName };
}

/**
 * AUXILIAR DA ETAPA 2: encontra Product dentro dos formatos comuns de JSON-LD.
 * Recebe unknown porque JSON.parse poderia produzir objeto, lista, null ou string.
 * Devolve Product, dados do ProductGroup com sua variante ou null se não houver.
 *
 * Formatos de exemplo:
 *   { "@type": "Product", "name": "Camisa" }
 *   [{ "@type": "Organization" }, { "@type": "Product", ... }]
 *   { "@graph": [{ "@type": "Product", ... }] }
 * @graph é uma lista de entidades descritas juntas; não é tabela do nosso banco.
 */
function findProductEntity(value: unknown, pageUrl: URL, selection: VariantSelection | null): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      // Recursão = chamar esta mesma função com um pedaço menor dos dados.
      // A lista externa pode conter objetos ou outras listas. Cada chamada
      // retorna Product/null; só paramos de procurar quando houver Product.
      const product = findProductEntity(item, pageUrl, selection);
      if (product !== null) return product;
    }
    return null;
  }

  if (!isJsonObject(value)) return null;
  // Shopify e Shein podem publicar um ProductGroup. O grupo reúne campos
  // compartilhados e hasVariant lista versões do produto, como os tamanhos.
  // No exemplo da Shein, cada tamanho tem nome, imagem e preço próprios.
  if (hasEntityType(value, "ProductGroup")) {
    const variantValues = Array.isArray(value.hasVariant) ? value.hasVariant : [value.hasVariant];
    // filter mantém só os itens que passaram pela checagem de objeto.
    const variants = variantValues.filter(isJsonObject);
    // Sem seleção usamos a primeira variante publicada. Com seleção, find
    // retorna a primeira variante cujo link tem o código pedido.
    let selectedVariant = variants[0];
    if (selection !== null) {
      selectedVariant = variants.find((variant) => matchesVariant(variant, selection, pageUrl));
    }

    if (selectedVariant === undefined) {
      if (selection === null) {
        return value;
      }
      // O link escolheu uma variante que não aparece no JSON-LD. Mantemos
      // os dados gerais, deixando a oferta em aberto.
      return { name: value.name, image: value.image };
    }

    // A variante herda nome e imagem do grupo quando esses campos faltam.
    // A oferta geral só vale quando o link não pede uma variante específica.
    let offers = selectedVariant.offers;
    if (selection === null) {
      offers = offers ?? value.offers;
    }
    return {
      name: selectedVariant.name ?? value.name,
      image: selectedVariant.image ?? value.image,
      offers,
    };
  }
  if (hasEntityType(value, "Product")) return value;
  if (value["@graph"] !== undefined) return findProductEntity(value["@graph"], pageUrl, selection);
  return null;
}

/**
 * Identifica uma variante comparando o parâmetro da página com os do JSON-LD.
 * O link pode estar em Product.url, Offer.url ou @id, que também pode ser uma URL.
 * Ex.: na Shein, uma página ?skucode=ABC usa a oferta cujo link tem skucode=ABC.
 */
function matchesVariant(variant: JsonObject, selection: VariantSelection, pageUrl: URL): boolean {
  const urls: unknown[] = [variant.url, variant["@id"]];
  const offers = Array.isArray(variant.offers) ? variant.offers : [variant.offers];
  for (const offer of offers) {
    if (isJsonObject(offer)) urls.push(offer.url, offer["@id"]);
  }
  for (const value of urls) {
    if (typeof value !== "string") continue;
    try {
      // O segundo argumento completa links relativos, como /vestido?skucode=ABC.
      const variantUrl = new URL(value, pageUrl);
      const variantId = variantUrl.searchParams.get(selection.parameter);
      if (variantId === selection.id) return true;
    } catch {
      // Um link inválido não deve interromper a procura nos demais links.
    }
  }
  return false;
}

/**
 * AUXILIAR DA ETAPA 3 — LER UMA OFERTA, SEM INVENTAR UM PREÇO
 *
 * Formato direto: { "@type": "Offer", "price": "99.90", "priceCurrency": "BRL" }.
 * Outra forma: { "priceSpecification": { "price": "99.90", "priceCurrency": "BRL" } }.
 * AggregateOffer pode reunir ofertas em offers OU informar lowPrice/highPrice.
 *
 * Quando há várias ofertas concretas, usamos a primeira que informa preço válido.
 * Não calculamos menor preço e não pegamos moeda de uma oferta vizinha.
 * Uma faixa 90–120 não é preço exato: mantemos price null e preservamos a moeda.
 * Quando lowPrice e highPrice são iguais, há um único valor e podemos usá-lo.
 */
function readOfferDetails(value: unknown): OfferDetails {
  if (Array.isArray(value)) {
    let offerWithoutPrice: OfferDetails = { price: null, currency: null, isPriceRange: false };
    for (const item of value) {
      const details = readOfferDetails(item);
      if (details.price !== null) return details;
      // Sem um preço exato, guardamos o item inteiro quando ele indica
      // uma faixa ou quando o candidato anterior ainda não tem moeda.
      if (details.isPriceRange || offerWithoutPrice.currency === null) offerWithoutPrice = details;
    }
    return offerWithoutPrice;
  }
  if (!isJsonObject(value)) return { price: null, currency: null, isPriceRange: false };

  // 1. A oferta pode declarar preço e moeda diretamente.
  const directPrice = normalizePrice(value.price);
  let currency = normalizeCurrency(value.priceCurrency);

  // 2. priceSpecification também pode declarar um preço, como objeto ou lista.
  // Aceitamos especificações de preço unitário e deixamos de fora frete e
  // preço riscado, que descrevem outros valores da mesma oferta.
  const specifications = Array.isArray(value.priceSpecification)
    ? value.priceSpecification
    : [value.priceSpecification];
  for (const specification of specifications) {
    if (!isJsonObject(specification)) continue;
    const isUnitPrice = specification["@type"] === undefined
      || hasEntityType(specification, "UnitPriceSpecification")
      || hasEntityType(specification, "PriceSpecification");
    const priceType = readText(specification.priceType);
    const isCrossedOutPrice = priceType === "StrikethroughPrice"
      || priceType?.endsWith("/StrikethroughPrice") === true;
    const isDeliveryCharge = hasEntityType(specification, "DeliveryChargeSpecification");
    if (!isUnitPrice || isDeliveryCharge || isCrossedOutPrice) continue;

    const specificationPrice = normalizePrice(specification.price);
    if (specificationPrice === null) continue;
    if (directPrice === null) {
      // A primeira especificação com preço válido fornece o par. Quando ela
      // omite a moeda, a moeda declarada pela própria oferta serve de apoio.
      const specificationCurrency = normalizeCurrency(specification.priceCurrency);
      return { price: specificationPrice, currency: specificationCurrency ?? currency, isPriceRange: false };
    }
    if (specificationPrice === directPrice && currency === null) {
      // Ex.: a moeda de um preço 50 não completa o preço direto de 100.
      currency = normalizeCurrency(specification.priceCurrency);
    }
  }

  if (directPrice !== null) return { price: directPrice, currency, isPriceRange: false };
  if (!hasEntityType(value, "AggregateOffer")) return { price: null, currency, isPriceRange: false };

  // 3. AggregateOffer agrupa ofertas. Uma oferta interna pode informar um
  // valor exato. Se faltar esse valor, examinamos os extremos da faixa.
  const nestedOffer = readOfferDetails(value.offers);
  if (nestedOffer.price !== null) {
    return { price: nestedOffer.price, currency: nestedOffer.currency ?? currency, isPriceRange: false };
  }

  const aggregateCurrency = currency ?? nestedOffer.currency;
  const lowPrice = normalizePrice(value.lowPrice);
  const highPrice = normalizePrice(value.highPrice);
  if (lowPrice !== null && lowPrice === highPrice) {
    return { price: lowPrice, currency: aggregateCurrency, isPriceRange: false };
  }

  const isPriceRange = lowPrice !== null || highPrice !== null || nestedOffer.isPriceRange;
  return { price: null, currency: aggregateCurrency, isPriceRange };
}

/** BRL/brl → BRL. Confere três letras, sem inferir moeda pelo país ou símbolo $. */
function normalizeCurrency(value: unknown): string | null {
  const text = readText(value);
  if (text === null) return null;
  const currency = text.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  return currency;
}

/**
 * Prova em runtime que um valor pode ser tratado como objeto de propriedades.
 * typeof null é "object" em JS; arrays também são objetos. Por isso os três testes.
 *
 * "value is JsonObject" é uma anotação TypeScript chamada type predicate:
 * antes do if, value.name não é permitido, pois value é unknown; dentro do if
 * verdadeiro, TS permite acessar value.name, que continua com tipo unknown.
 * A anotação NÃO valida nada sozinha. Os testes no return fazem a validação.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Verifica a propriedade JSON-LD @type (tipo da entidade, não tipo TypeScript).
 * Aceita "Product", ["Thing", "Product"] ou "https://schema.org/Product".
 * [] acessa a chave "@type" porque @ não cabe na sintaxe entity.@type.
 */
function hasEntityType(entity: JsonObject, expectedType: string): boolean {
  const declaredType = entity["@type"];
  const types = Array.isArray(declaredType) ? declaredType : [declaredType];
  // O ternário acima equivale a: se for array use-o; senão crie [declaredType].
  // Assim o laço trata igualmente um tipo único ou vários.
  for (const type of types) {
    if (typeof type !== "string") continue;
    const typeName = type.replace(/^.*[/#]/, ""); // Remove prefixo até a última / ou #.
    if (typeName.toLowerCase() === expectedType.toLowerCase()) return true;
  }
  return false;
}

/**
 * Converte texto/número simples em string limpa; outros formatos viram null.
 * Ex.: "  Camisa\n branca " → "Camisa branca"; { name: ... } → null.
 * Usamos a mesma regra nos campos do site, que ainda chegam como unknown.
 */
function readText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  // \s = espaço/tab/quebra de linha; + = uma ou mais ocorrências; g = todas.
  // replace reúne esses espaços; trim tira apenas os espaços das extremidades.
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text;
}

/**
 * Transforma imagem do site em URL completa, sem baixar a imagem.
 * Entrada pode ser "//cdn.example/a.jpg", ["/a.jpg", "/b.jpg"] ou { url: ... }.
 * Ex.: /a.jpg + https://loja.example/p/1 → https://loja.example/a.jpg.
 * O primeiro item é a escolha simples do MVP; não comparamos resoluções.
 */
function normalizeImageUrl(value: unknown, pageUrl: string): string | null {
  let image = value;
  if (Array.isArray(image)) image = image[0];
  if (isJsonObject(image)) {
    // ?? só tenta contentUrl se url for null/undefined, não por ser string vazia.
    image = image.url ?? image.contentUrl;
  }

  const text = readText(image);
  if (text === null) return null;
  try {
    const imageUrl = new URL(text, pageUrl);
    // Sem essa condição poderíamos devolver javascript:... ou data:... como imagem.
    // Só guardamos o link aqui. O navegador poderá pedi-lo depois no frontend.
    if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") return null;
    return imageUrl.href;
  } catch {
    return null;
  }
}

/**
 * Padroniza preço como string decimal: "1.299,90" → "1299.90".
 * O schema.org normalmente já fornece "279.90"; alguns sites usam vírgula.
 * Não usamos parseFloat: ele leria "279,90" como 279 e descartaria os centavos.
 * Não fazemos cálculos com number: floats têm aproximações (0.1 + 0.2, por exemplo).
 * Retornamos null para formatos que não reconhecemos, em vez de adivinhar.
 */
function normalizePrice(value: unknown): string | null {
  const text = readText(value);
  if (text === null) return null;
  let price = text;

  // Regex testa um formato. \d = dígito; {1,3} = 1 a 3 repetições;
  // \. = ponto literal; (...) + = grupo repetido; ^/$ = início/fim do texto.
  // Primeiro padrão: 1.299,90 ou 12.345.678,9. Segundo: 279,90.
  const hasThousandsAndComma = /^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(text);
  const hasDecimalComma = /^\d+,\d{1,2}$/.test(text);
  if (hasThousandsAndComma) {
    price = text.replaceAll(".", "").replace(",", ".");
  } else if (hasDecimalComma) {
    price = text.replace(",", ".");
  }

  // Aceita 279, 279.9 ou 279.90. O grupo (?:...) apenas agrupa sem capturar;
  // ? torna a parte decimal opcional. Texto como "R$ 279" não passa.
  const isDecimal = /^\d+(?:\.\d{1,2})?$/.test(price);
  if (!isDecimal) return null;
  // Uma forma única facilita comparar lowPrice="99.9" e highPrice="99.90".
  // split separa inteiro/centavos; padEnd completa casas sem calcular com float.
  const parts = price.split(".");
  const integer = (parts[0] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (parts[1] ?? "").padEnd(2, "0");
  return `${integer}.${fraction}`;
}
