import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import type { Browser, LaunchOptions } from "playwright";
import { ProductPageLoader } from "../src/modules/products/products.page-loader.ts";
import { PageFetchError } from "../src/modules/products/products.errors.ts";
import { parseProductPage } from "../src/modules/products/products.parser.ts";
import { ProductUrlPolicy } from "../src/modules/products/network/url-policy.ts";

const fixtureUrl = "https://render.example/product?busca=caf%C3%A9";

// Os testes reais precisam do Chromium instalado por npm run browser:install.
// Ele roda headless e sem perfil pessoal. Toda navegação é respondida por uma
// fixture local; esta política também veta qualquer tentativa de conexão externa.
const noNetworkPolicy = new ProductUrlPolicy(async () => {
  throw new Error("Este teste não permite resolver destinos de rede.");
});

function hasReason(reason: string): (error: unknown) => boolean {
  return (error) => error instanceof PageFetchError && error.reason === reason;
}

test("browser: falha de lançamento é UNAVAILABLE e libera a próxima tentativa", async () => {
  let launches = 0;
  const loader = new ProductPageLoader(noNetworkPolicy, {
    launchBrowser: async () => {
      launches++;
      throw new Error("Lançamento simulado indisponível.");
    },
  });

  await assert.rejects(loader.render(fixtureUrl), hasReason("BROWSER_UNAVAILABLE"));
  await assert.rejects(loader.render(fixtureUrl), hasReason("BROWSER_UNAVAILABLE"));
  assert.equal(launches, 2); // A segunda chegou ao launcher, em vez de ficar BUSY.
});

test("browser: tentativa concorrente é BUSY e rejeição do lançamento libera a instância", async () => {
  let signalStarted = () => {};
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  let rejectLaunch = (_error: Error) => {};
  const pendingLaunch = new Promise<Browser>((_resolve, reject) => { rejectLaunch = reject; });
  const loader = new ProductPageLoader(noNetworkPolicy, {
    launchBrowser: () => {
      signalStarted();
      return pendingLaunch;
    },
  });

  // Registramos a expectativa de rejeição imediatamente para não criar Promise
  // rejeitada sem tratamento quando o teste mandar o launcher falhar.
  const firstAttempt = assert.rejects(loader.render(fixtureUrl), hasReason("BROWSER_UNAVAILABLE"));
  await started;
  try {
    await assert.rejects(loader.render(fixtureUrl), hasReason("BROWSER_BUSY"));
  } finally {
    rejectLaunch(new Error("Fim do lançamento controlado pelo teste."));
    await firstAttempt;
  }

  await assert.rejects(loader.render(fixtureUrl), hasReason("BROWSER_UNAVAILABLE"));
});

/**
 * O PageLoader recebe a função de lançamento como dependência. Aqui ainda
 * lançamos Chromium de verdade, mas substituímos newContext SÓ NESTE TESTE para
 * instalar a resposta HTML antes de a aba existir. O handler da produção usa
 * route.fallback(), então esta fixture atende o pedido antes de chegar à rede.
 */
function launchWithHtml(html: string, browsers: Browser[], fixtureAddress = fixtureUrl): (options: LaunchOptions) => Promise<Browser> {
  return async (options) => {
    const browser = await chromium.launch(options);
    browsers.push(browser);
    const originalNewContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await originalNewContext(contextOptions);
      await context.route("**/*", async (route) => {
        if (route.request().url() === fixtureAddress) {
          await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
        } else {
          await route.abort(); // Inclui favicon e qualquer recurso não declarado.
        }
      });
      return context;
    };
    return browser;
  };
}

test("browser: Chromium executa JS que insere JSON-LD depois do HTML inicial", { timeout: 15_000 }, async () => {
  const browsers: Browser[] = [];
  const product = {
    "@type": "Product",
    name: "Café e Mouse Gamer",
    image: "https://cdn.example/mouse.jpg",
    offers: { "@type": "Offer", price: "220.34", priceCurrency: "BRL" },
  };
  const html = `<html><head><meta charset="utf-8"></head><body>
    <script>
      setTimeout(() => {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(${JSON.stringify(product)});
        document.head.appendChild(script);
      }, 100);
    </script>
  </body></html>`;
  const loader = new ProductPageLoader(noNetworkPolicy, {
    browserTimeoutMs: 5_000,
    launchBrowser: launchWithHtml(html, browsers),
  });

  try {
    const page = await loader.render(fixtureUrl);
    const extracted = parseProductPage(page.html, fixtureUrl, page.finalUrl, page.contentType);
    assert.equal(extracted.url, fixtureUrl);
    assert.equal(extracted.name, "Café e Mouse Gamer");
    assert.equal(extracted.imageUrl, "https://cdn.example/mouse.jpg");
    assert.equal(extracted.price, "220.34");
    assert.equal(extracted.currency, "BRL");
    assert.equal(page.contentType, "text/html; charset=utf-8");
    assert.ok(page.html.toString("utf8").includes("Café e Mouse Gamer"));
    assert.equal(browsers.length, 1);
    assert.equal(browsers[0]?.isConnected(), false); // finally da produção fechou o processo.
  } finally {
    // Limpeza defensiva do teste se uma assertion falhar antes da checagem acima.
    await Promise.all(browsers.map((browser) => browser.close()));
  }
});

test("browser: Shopee em rota de verificação encerra antes de usar metatags", { timeout: 15_000 }, async () => {
  const verification = "https://shopee.com.br/verify/traffic/error";
  const html = '<meta property="og:title" content="Shopee Brasil | Ofertas incríveis">';
  const browsers: Browser[] = [];
  const loader = new ProductPageLoader(noNetworkPolicy, {
    browserTimeoutMs: 5_000,
    launchBrowser: launchWithHtml(html, browsers, verification),
  });

  try {
    await assert.rejects(loader.render(verification), hasReason("REMOTE_VERIFICATION_REQUIRED"));
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
});

test("browser: prazo com HTML parcial preserva a página, fecha Chromium e libera outra chamada", { timeout: 15_000 }, async () => {
  const browsers: Browser[] = [];
  const html = '<html><head><meta charset="utf-8"><meta property="og:title" content="Café parcial"></head><body></body></html>';
  const loader = new ProductPageLoader(noNetworkPolicy, {
    browserTimeoutMs: 3_000,
    launchBrowser: launchWithHtml(html, browsers),
  });

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = await loader.render(fixtureUrl);
      const product = parseProductPage(page.html, fixtureUrl, page.finalUrl, page.contentType);
      assert.equal(product.name, "Café parcial");
      assert.equal(product.price, null);
      assert.equal(product.currency, null);
      assert.equal(browsers[attempt]?.isConnected(), false);
    }
    assert.equal(browsers.length, 2); // A segunda chamada não ficou presa em BUSY.
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
});
