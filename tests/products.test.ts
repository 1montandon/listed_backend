import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Response } from "undici";
import { app } from "../src/app.ts";
import { createAccessToken } from "../src/shared/auth/access-token.ts";
import { PageFetchError } from "../src/modules/products/products.errors.ts";
import { suggestProductName } from "../src/modules/products/products.name-suggestion.ts";
import { ProductPageLoader } from "../src/modules/products/products.page-loader.ts";
import { ProductUrlPolicy } from "../src/modules/products/network/url-policy.ts";
import { parseProductPage } from "../src/modules/products/products.parser.ts";
import { ProductsService } from "../src/modules/products/products.service.ts";
import type { PageLoader } from "../src/modules/products/products.types.ts";

const originalUrl = "https://www.lojasrenner.com.br/p/camisa";

// Estes testes isolam o caminho fetch. O adaptador conserva a interface única
// do loader, mas impede que uma regressão abra Chromium ou acesse uma loja.
function httpOnly(loader: ProductPageLoader): PageLoader {
  return {
    validateUrl: (url) => loader.validateUrl(url),
    fetch: (url) => loader.fetch(url),
    async render() { throw new PageFetchError("BROWSER_UNAVAILABLE"); },
  };
}

// Fixtures pequenas, escritas para os testes a partir dos formatos do Schema.org.
// Não são cópias do HTML completo nem comprovam acesso às lojas mencionadas.
function htmlWithJsonLd(data: unknown): Buffer {
  return Buffer.from(`<meta charset="utf-8"><script type="application/ld+json">${JSON.stringify(data)}</script>`);
}

test("extração preserva zero e só publica preços na faixa inteira do cadastro", () => {
  for (const [price, expected] of [
    ["0", 0],
    ["9999999999.99", 999_999_999_999],
    ["10000000000.00", null],
  ] as const) {
    const html = htmlWithJsonLd({
      "@type": "Product",
      name: "Livro",
      offers: { "@type": "Offer", price, priceCurrency: "BRL" },
    });
    const product = parseProductPage(html, originalUrl, originalUrl);
    assert.equal(product.priceCents, expected, price);
    assert.equal("price" in product, false);
  }
});

test("Mad Enlatados: bloco fornecido pelo usuário produz nome, imagem, 209.00 e BRL", async () => {
  // import.meta.url é o endereço deste arquivo. new URL resolve a fixture ao lado
  // dele, sem depender de qual pasta estava aberta ao executar o comando.
  const jsonText = await readFile(new URL("./fixtures/mad-enlatados.product.json", import.meta.url), "utf8");
  const pageUrl = "https://madenlatados.com.br/products/camiseta-gummo-preto";
  const product = parseProductPage(htmlWithJsonLd(JSON.parse(jsonText)), pageUrl, pageUrl);
  assert.deepEqual(product, {
    url: pageUrl,
    name: "CAMISETA GUMMO (PRETO)",
    imageUrl: "https://madenlatados.com.br/cdn/shop/files/MG_6211copiar.jpg?v=1789588151&width=1920",
    priceCents: 20900, currency: "BRL", storeName: "madenlatados.com.br",
  });
});

test("AliExpress: bloco fornecido pelo usuário recupera inclusive 220.34 e BRL", async () => {
  const jsonText = await readFile(new URL("./fixtures/aliexpress.product.json", import.meta.url), "utf8");
  const pageUrl = "https://pt.aliexpress.com/item/1005012524162015.html";
  const product = parseProductPage(htmlWithJsonLd(JSON.parse(jsonText)), pageUrl, pageUrl);
  assert.equal(product.name, "Mouse Gamer Sem Fio KYSONA Jupiter X Ultra PAW3950 8000Hz 54L15 MCU Fibra de Carbono Composta Tri-Mode 61g Ergonômico Omron 70M - AliExpress");
  assert.equal(product.imageUrl, "https://ae-pic-a1.aliexpress-media.com/kf/S9e1b7641b5964297a6210195dee8ccddL.jpg");
  assert.equal(product.priceCents, 22034);
  assert.equal(product.currency, "BRL");
});

test("Shein: ProductGroup usa o skucode da oferta quando o link escolhe um tamanho", async () => {
  // Recorte do JSON-LD enviado pelo usuário. Mantém XL primeiro e XS depois.
  const jsonText = await readFile(new URL("./fixtures/shein.product.json", import.meta.url), "utf8");
  const data = JSON.parse(jsonText);
  const groupUrl = data[0].url;
  const html = htmlWithJsonLd(data);
  const defaultProduct = parseProductPage(html, groupUrl, groupUrl);
  assert.match(defaultProduct.name ?? "", /Tamanho XL$/);
  assert.equal(defaultProduct.priceCents, 10712);

  const xsUrl = data[0].hasVariant[1].offers.url;
  const selectedProduct = parseProductPage(html, xsUrl, xsUrl);
  assert.match(selectedProduct.name ?? "", /Tamanho XS$/);
  assert.equal(selectedProduct.imageUrl, data[0].hasVariant[1].image[0]);
  assert.equal(selectedProduct.priceCents, 9916);
  assert.equal(selectedProduct.currency, "BRL");

  const unknownUrl = new URL(groupUrl);
  unknownUrl.searchParams.set("skucode", "desconhecido");
  const withGlobalPrice = Buffer.concat([html, Buffer.from(`
    <meta property="product:price:amount" content="107.12">
    <meta property="product:price:currency" content="BRL">`)]);
  const unknownProduct = parseProductPage(withGlobalPrice, unknownUrl.href, unknownUrl.href);
  assert.equal(unknownProduct.name, data[0].name);
  assert.equal(unknownProduct.priceCents, null);
  assert.equal(unknownProduct.currency, null);
});

test("Product com offers em lista também respeita ?variant, sem precisar de ProductGroup", () => {
  const pageUrl = "https://shop.example/products/camiseta?variant=222";
  const html = htmlWithJsonLd({ "@type": "Product", name: "Camiseta", offers: [
    { "@type": "Offer", url: "/products/camiseta?variant=111", price: "10", priceCurrency: "USD" },
    { "@type": "Offer", url: "/products/camiseta?variant=222", price: "20", priceCurrency: "BRL" },
  ] });
  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, 2000);
  assert.equal(product.currency, "BRL");
});

test("extrai Product JSON-LD do exemplo Renner sem confundir marca com loja", () => {
  const html = Buffer.from(`<html><head>
    <meta property="og:site_name" content="Renner">
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org/", "@type": "Product",
      name: " Camisa Oversized em Linho ", image: ["//img.lojasrenner.com.br/item/931454799/zoom/3.jpg"],
      brand: { "@type": "Brand", name: "Marfinno" },
      offers: { "@type": "Offer", priceCurrency: "BRL", price: "279.90" },
    })}</script></head></html>`);
  assert.deepEqual(parseProductPage(html, originalUrl, originalUrl), {
    url: originalUrl, name: "Camisa Oversized em Linho",
    imageUrl: "https://img.lojasrenner.com.br/item/931454799/zoom/3.jpg",
    priceCents: 27990, currency: "BRL", storeName: "Renner",
  });
});

test("lê arrays, @graph, ofertas em lista e ignora JSON-LD quebrado", () => {
  const html = Buffer.from(`<script type="application/ld+json">{quebrado</script>
    <script type="application/ld+json">${JSON.stringify([
      { "@type": "BreadcrumbList" },
      { "@graph": [{ "@type": ["Thing", "Product"], name: "Tênis", image: "/foto.jpg",
        offers: [{ "@type": "Offer", price: "1.299,90", priceCurrency: "brl" }] }] },
    ])}</script>`);
  const product = parseProductPage(html, "https://shop.example/p/1", "https://shop.example/p/1");
  assert.equal(product.name, "Tênis");
  assert.equal(product.imageUrl, "https://shop.example/foto.jpg");
  assert.equal(product.priceCents, 129990);
  assert.equal(product.currency, "BRL");
  assert.equal(product.storeName, "shop.example");
});

test("usa Open Graph como fallback quando JSON-LD não informa campos", () => {
  const html = Buffer.from(`<title>Bolsa na loja</title>
    <meta property="og:type" content="product">
    <meta property="og:title" content="Bolsa Azul">
    <meta property="og:image" content="https://cdn.example/bolsa.jpg">
    <meta property="product:price:amount" content="39,90">
    <meta property="product:price:currency" content="BRL">`);
  const product = parseProductPage(html, "https://shop.example/p/2", "https://shop.example/p/2");
  assert.equal(product.name, "Bolsa Azul");
  assert.equal(product.priceCents, 3990);
  assert.equal(product.imageUrl, "https://cdn.example/bolsa.jpg");
});

test("usa o título da aba só com sinal de produto e depois do JSON-LD", () => {
  const title = Buffer.from("<title>Chuteira de exemplo</title>");
  const jsonLdWithoutName = htmlWithJsonLd({ "@type": "Product" });
  const productType = Buffer.from('<meta property="og:type" content="product">');
  const namedProduct = htmlWithJsonLd({ "@type": "Product", name: "Chuteira Society" });

  assert.equal(parseProductPage(title, originalUrl, originalUrl).name, null);
  for (const signal of [jsonLdWithoutName, productType]) {
    const html = Buffer.concat([title, signal]);
    assert.equal(parseProductPage(html, originalUrl, originalUrl).name, "Chuteira de exemplo");
  }
  const html = Buffer.concat([title, namedProduct]);
  assert.equal(parseProductPage(html, originalUrl, originalUrl).name, "Chuteira Society");
});

test("sugere o nome de slugs da Shein e da Shopee, preservando acentos e códigos", () => {
  const shein = "https://br.shein.com/Travachic-Vacation-Petal-Embroidery-Cami-Dress-p-569913033.html?mallCode=1";
  assert.equal(suggestProductName(shein), "Travachic Vacation Petal Embroidery Cami Dress");

  const product = "https://shopee.com.br/Caixa-de-Som-Amvox-ACA2201-Pesad%C3%A3o-II-i.1060724397.18999309937";
  const verification = new URL("https://shopee.com.br/verify/traffic/error");
  // set codifica o endereço inteiro como parâmetro. O % de %C3%A3 vira %25
  // nessa camada. A função precisa recuperar o endereço e depois o acento.
  verification.searchParams.set("next", product);
  const expectedName = "Caixa de Som Amvox ACA2201 Pesadão II";
  assert.equal(suggestProductName(product), expectedName);
  assert.equal(suggestProductName(verification.href), expectedName);
});

test("sugestão ignora slugs inválidos e next da Shopee fora do formato aceito", () => {
  const verification = new URL("https://shopee.com.br/verify/traffic/error");
  for (const next of [
    "https://shopee.com.br.example/Produto-i.1.2",
    "https://shopee.com.br:8443/Produto-i.1.2",
    "https://usuario@shopee.com.br/Produto-i.1.2",
    "https://shopee.com.br/verify/traffic/error?next=%2FProduto-i.1.2",
    "https://shopee.com.br/product/1/2",
  ]) {
    verification.searchParams.set("next", next);
    assert.equal(suggestProductName(verification.href), null, next);
  }
  for (const url of [
    "https://br.shein.com/Produto%FF-p-123.html",
    "https://br.shein.com/Produto%2FOutro-p-123.html",
    "https://br.shein.com/Produto%0AOutro-p-123.html",
    "https://www.nike.com.br/1234-095178.html",
  ]) {
    assert.equal(suggestProductName(url), null, url);
  }
});

test("respeita charset informado pelo servidor", () => {
  const html = Buffer.from('<meta property="og:title" content="Café">', "latin1");
  const product = parseProductPage(html, originalUrl, originalUrl, "text/html; charset=iso-8859-1");
  assert.equal(product.name, "Café");
});

test("moeda das meta tags só completa preço JSON-LD quando os valores correspondem", () => {
  const pageUrl = "https://shop.example/p/caderno";
  for (const metaPrice of ["50", "100"]) {
    const html = htmlWithJsonLd({
      "@type": "Product", name: "Caderno",
      offers: { "@type": "Offer", price: "100" },
    });
    const withMetaOffer = Buffer.concat([html, Buffer.from(`
      <meta property="product:price:amount" content="${metaPrice}">
      <meta property="product:price:currency" content="USD">`)]);

    const product = parseProductPage(withMetaOffer, pageUrl, pageUrl);
    assert.equal(product.priceCents, 10000, `meta price ${metaPrice}`);
    // Não podemos juntar o preço 100 do JSON-LD com a moeda da oferta de 50.
    // Se a meta confirma os mesmos 100, sua moeda pode completar o campo.
    assert.equal(product.currency, metaPrice === "100" ? "USD" : null, `meta price ${metaPrice}`);
  }
});

test("Shopify: ProductGroup fornece nome/imagem e a variante fornece preço unitário", () => {
  const pageUrl = "https://shop.example/products/camiseta";
  const html = htmlWithJsonLd({
    "@type": "ProductGroup",
    name: "Camiseta do grupo",
    image: ["/camiseta.jpg"],
    hasVariant: [{
      "@type": "Product",
      offers: {
        "@type": "Offer",
        priceSpecification: { "@type": "UnitPriceSpecification", price: "89.9", priceCurrency: "BRL" },
      },
    }],
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.name, "Camiseta do grupo");
  assert.equal(product.imageUrl, "https://shop.example/camiseta.jpg");
  assert.equal(product.priceCents, 8990);
  assert.equal(product.currency, "BRL");
});

test("Shopify: ?variant escolhe a variante pelo Product.url ou Offer.url", () => {
  // Repetimos o caso para os dois lugares onde o link de variante pode aparecer.
  for (const urlLocation of ["product", "offer"] as const) {
    const pageUrl = "https://shop.example/products/camiseta?variant=222";
    const selectedOffer = {
      "@type": "Offer",
      price: "120",
      priceCurrency: "BRL",
      ...(urlLocation === "offer" ? { url: "/products/camiseta?variant=222" } : {}),
    };
    const html = htmlWithJsonLd({
      "@type": "ProductGroup",
      name: "Camiseta",
      hasVariant: [
        {
          "@type": "Product", name: "Camiseta P", url: "/products/camiseta?variant=111",
          offers: { "@type": "Offer", price: "20", priceCurrency: "USD" },
        },
        {
          "@type": "Product", name: "Camiseta G",
          ...(urlLocation === "product" ? { url: "/products/camiseta?variant=222" } : {}),
          offers: selectedOffer,
        },
      ],
    });

    const product = parseProductPage(html, pageUrl, pageUrl);
    assert.equal(product.name, "Camiseta G", urlLocation);
    assert.equal(product.priceCents, 12000, urlLocation);
    assert.equal(product.currency, "BRL", urlLocation);
  }
});

test("Shopify: variante pedida desconhecida não usa o preço de outra variante", () => {
  const pageUrl = "https://shop.example/products/camiseta?variant=999";
  const html = htmlWithJsonLd({
    "@type": "ProductGroup", name: "Camiseta", image: "/camiseta.jpg",
    offers: { "@type": "Offer", price: "80", priceCurrency: "BRL" },
    hasVariant: [{
      "@type": "Product", url: "/products/camiseta?variant=111",
      offers: { "@type": "Offer", price: "20", priceCurrency: "USD" },
    }],
  });

  // Mesmo com preço global da página, não podemos usá-lo para a variante 999.
  const withGlobalMeta = Buffer.concat([html, Buffer.from(`
    <meta property="product:price:amount" content="80">
    <meta property="product:price:currency" content="BRL">`)]);
  const product = parseProductPage(withGlobalMeta, pageUrl, pageUrl);
  assert.equal(product.name, "Camiseta");
  assert.equal(product.imageUrl, "https://shop.example/camiseta.jpg");
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, null);
});

test("Shopify: variante encontrada sem oferta não herda o preço geral do grupo", () => {
  const pageUrl = "https://shop.example/products/camiseta?variant=222";
  const html = htmlWithJsonLd({
    "@type": "ProductGroup", name: "Camiseta", image: "/camiseta.jpg",
    offers: { "@type": "Offer", price: "89", priceCurrency: "BRL" },
    hasVariant: [{
      "@type": "Product", name: "Camiseta G", url: "/products/camiseta?variant=222",
    }],
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.name, "Camiseta G");
  assert.equal(product.imageUrl, "https://shop.example/camiseta.jpg");
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, null);
});

test("AggregateOffer preserva moeda, mas uma faixa de preços não vira preço exato", () => {
  const pageUrl = "https://market.example/p/monitor";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Monitor",
    offers: { "@type": "AggregateOffer", lowPrice: "90", highPrice: "120", priceCurrency: "BRL" },
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, "BRL");
});

test("AggregateOffer com faixa não usa meta tag do menor valor como preço exato", () => {
  const pageUrl = "https://market.example/p/monitor";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Monitor",
    offers: { "@type": "AggregateOffer", lowPrice: "90", highPrice: "120", priceCurrency: "BRL" },
  });
  const withMetaOffer = Buffer.concat([html, Buffer.from(`
    <meta property="product:price:amount" content="90">
    <meta property="product:price:currency" content="BRL">`)]);

  const product = parseProductPage(withMetaOffer, pageUrl, pageUrl);
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, "BRL");
});

test("AggregateOffer com extremos equivalentes informa um preço único normalizado", () => {
  const pageUrl = "https://market.example/p/monitor";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Monitor",
    offers: { "@type": "AggregateOffer", lowPrice: "99.9", highPrice: "99.90", priceCurrency: "BRL" },
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, 9990);
  assert.equal(product.currency, "BRL");
});

test("AggregateOffer usa uma oferta concreta sem pegar moeda de outra oferta", () => {
  const pageUrl = "https://market.example/p/monitor";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Monitor",
    offers: {
      "@type": "AggregateOffer",
      offers: [
        { "@type": "Offer", priceCurrency: "USD" },
        { "@type": "Offer", price: "199.9", priceCurrency: "BRL" },
      ],
    },
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, 19990);
  assert.equal(product.currency, "BRL");
});

test("priceSpecification aceita objeto ou lista e ignora frete/preço riscado", () => {
  const pageUrl = "https://shop.example/p/caderno";
  const unitPrice = { "@type": "UnitPriceSpecification", price: "39.90", priceCurrency: "BRL" };
  const specifications = [
    unitPrice,
    { "@type": "PriceSpecification", price: "39.90", priceCurrency: "BRL" },
    [
      { "@type": "DeliveryChargeSpecification", price: "10", priceCurrency: "USD" },
      { "@type": ["PriceSpecification", "DeliveryChargeSpecification"], price: "10", priceCurrency: "USD" },
      {
        "@type": "UnitPriceSpecification", price: "59.90", priceCurrency: "BRL",
        priceType: "https://schema.org/StrikethroughPrice",
      },
      unitPrice,
    ],
  ];

  for (const priceSpecification of specifications) {
    const html = htmlWithJsonLd({
      "@type": "Product", name: "Caderno",
      offers: { "@type": "Offer", priceSpecification },
    });
    const product = parseProductPage(html, pageUrl, pageUrl);
    assert.equal(product.priceCents, 3990);
    assert.equal(product.currency, "BRL");
  }
});

test("priceSpecification mantém preço/moeda da mesma especificação", () => {
  const pageUrl = "https://shop.example/p/caderno";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Caderno",
    offers: {
      "@type": "Offer",
      priceSpecification: [
        { "@type": "UnitPriceSpecification", priceCurrency: "USD" },
        { "@type": "UnitPriceSpecification", price: "39.90", priceCurrency: "BRL" },
      ],
    },
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, 3990);
  assert.equal(product.currency, "BRL");
});

test("preço direto só recebe moeda de especificação com o mesmo valor", () => {
  const pageUrl = "https://shop.example/p/caderno";
  const html = htmlWithJsonLd({
    "@type": "Product", name: "Caderno",
    offers: {
      "@type": "Offer", price: "39.90",
      priceSpecification: [
        { "@type": "UnitPriceSpecification", price: "59.90", priceCurrency: "USD" },
        { "@type": "UnitPriceSpecification", price: "39.9", priceCurrency: "BRL" },
      ],
    },
  });

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.priceCents, 3990);
  assert.equal(product.currency, "BRL");
});

test("AliExpress: meta tags sem preço deixam preço/moeda ausentes, sem inferir USD", () => {
  const pageUrl = "https://pt.aliexpress.com/item/123.html";
  const html = Buffer.from(`<meta charset="utf-8">
    <meta property="og:title" content="Mouse de exemplo">
    <meta property="og:image" content="https://cdn.example/mouse.jpg">
    <meta property="og:site_name" content="AliExpress">
    <script>window.runParams = {}; var currency = 'USD';</script>`);

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.name, "Mouse de exemplo");
  assert.equal(product.imageUrl, "https://cdn.example/mouse.jpg");
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, null);
});

test("Mercado Livre: página de verificação não é confundida com dados de produto", () => {
  const pageUrl = "https://www.mercadolivre.com.br/p/MLB123";
  const html = Buffer.from(`<meta charset="utf-8"><title>Verifique seu navegador</title>
    <h1>Precisamos verificar que você é uma pessoa</h1>
    <script>window.verificationRequired = true;</script>`);

  const product = parseProductPage(html, pageUrl, pageUrl);
  assert.equal(product.name, null);
  assert.equal(product.imageUrl, null);
  assert.equal(product.priceCents, null);
  assert.equal(product.currency, null);
});

test("Mercado Livre: service identifica o redirecionamento de verificação e preserva a URL colada", async () => {
  const pageUrl = "https://www.mercadolivre.com.br/p/MLB123";
  let requests = 0;
  const loader = new ProductPageLoader(new ProductUrlPolicy(async () => ["8.8.8.8"]), {
    fetchPage: async () => {
      requests++;
      if (requests === 1) {
        return new Response(null, { status: 302, headers: { location: "/gz/account-verification?go=produto" } });
      }
      return new Response('<title>Mercado Libre</title><meta property="og:title" content="Verifique sua conta">', {
        headers: { "content-type": "text/html" },
      });
    },
  });

  const result = await new ProductsService(httpOnly(loader)).extract({ url: pageUrl });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.reason, "REMOTE_VERIFICATION_REQUIRED");
  assert.equal(result.product.url, pageUrl);
  assert.equal(result.product.name, null);
});

test("HTTP 429/401/403 viram motivos de falha específicos da loja", async () => {
  for (const status of [429, 401, 403]) {
    const loader = new ProductPageLoader(new ProductUrlPolicy(async () => ["8.8.8.8"]), {
      fetchPage: async () => new Response("Acesso recusado", { status, headers: { "content-type": "text/html" } }),
    });
    // Verificamos aqui a classificação HTTP. A decisão de tentar o navegador
    // depois de 429 tem testes próprios em products.fallback.test.ts.
    await assert.rejects(loader.fetch("https://shop.example/produto"), (error: unknown) =>
      error instanceof PageFetchError
      && error.reason === (status === 429 ? "REMOTE_RATE_LIMITED" : "REMOTE_ACCESS_DENIED"));
  }
});

test("retorna parcial ou falha sem salvar e preserva a URL original", async () => {
  class StubPageLoader extends ProductPageLoader {
    override async fetch() {
      return { html: Buffer.from('<script type="application/ld+json">{"@type":"Product","name":"Caderno"}</script>'), finalUrl: originalUrl, contentType: "text/html" };
    }
  }
  const result = await new ProductsService(httpOnly(new StubPageLoader())).extract({ url: originalUrl });
  assert.equal(result.status, "partial");
  assert.equal(result.product.url, originalUrl);
  assert.deepEqual(result.missingFields, ["imageUrl", "priceCents", "currency"]);

  const failed = await new ProductsService(
    httpOnly(new ProductPageLoader(new ProductUrlPolicy(async () => ["127.0.0.1"]))),
  )
    .extract({ url: originalUrl });
  assert.equal(failed.status, "failed");
  if (failed.status === "failed") assert.equal(failed.reason, "UNSAFE_TARGET");
});

test("bloqueia URL local, credenciais, porta customizada e DNS privado", async () => {
  const loader = new ProductPageLoader(new ProductUrlPolicy(async () => ["10.0.0.2"]));
  for (const url of ["http://localhost/", "http://127.0.0.1/", "http://user:pass@example.com/", "http://example.com:8080/"]) {
    assert.throws(() => loader.validateUrl(url), PageFetchError);
  }
  await assert.rejects(loader.fetch("https://example.com/p"), (error: unknown) =>
    error instanceof PageFetchError && error.reason === "UNSAFE_TARGET");
});

test("não segue redirecionamento para localhost", async () => {
  const loader = new ProductPageLoader(
    new ProductUrlPolicy(async () => ["8.8.8.8"]),
    { fetchPage: async () => new Response(null, { status: 302, headers: { location: "http://localhost/private" } }) },
  );
  await assert.rejects(loader.fetch("https://example.com/p"), (error: unknown) =>
    error instanceof PageFetchError && error.reason === "UNSAFE_REDIRECT");
});

test("recusa HTML maior que 2 MiB antes de analisar", async () => {
  const loader = new ProductPageLoader(
    new ProductUrlPolicy(async () => ["8.8.8.8"]),
    { fetchPage: async () => new Response("x".repeat(2 * 1024 * 1024 + 1), {
      status: 200, headers: { "content-type": "text/html" },
    }) },
  );
  await assert.rejects(loader.fetch("https://example.com/p"), (error: unknown) =>
    error instanceof PageFetchError && error.reason === "PAGE_TOO_LARGE");
});

test("rota HTTP exige JWT e devolve 400 para URL proibida", async () => {
  const server = app.listen(0);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/products/extract`;
  try {
    const unauthenticated = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost/private" }),
    });
    assert.equal(unauthenticated.status, 401);

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await createAccessToken("test-user")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://localhost/private" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_PRODUCT_URL");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
