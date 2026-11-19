# Revisão da etapa 4 — Extração de produto

## O que foi implementado

O endpoint autenticado `POST /api/v1/products/extract` devolve uma prévia para revisão. A etapa também inclui um script de diagnóstico e testes com HTML, DNS e navegador controlados. [Módulo products](../../src/modules/products) · [inspect-product.ts](../../scripts/inspect-product.ts)

## Como funciona

O service tenta carregar o HTML com Undici e passa os dados ao Cheerio. Se a primeira tentativa deixar dados incompletos ou falhar por um motivo elegível, o service tenta o Chromium. A resposta inclui a URL original, os campos encontrados e o status da coleta. Quando falta o nome, alguns links permitem sugerir um texto para revisão. A persistência começa na etapa seguinte do fluxo, em [Produtos salvos](05-produtos-salvos.md).

## Decisões técnicas

- O caminho HTTP tem prioridade para economizar a abertura de um navegador. O Chromium ajuda quando scripts da loja precisam montar os dados.
- Undici e Chromium usam a mesma política de destino público. O primeiro fixa o IP com um Agent. O segundo encaminha as conexões por um proxy local que aplica a política.
- Preço e moeda vêm da mesma prévia. A sugestão baseada no endereço é um campo separado do nome extraído.

## O que ler

Siga [o roteiro de estudo](#estudar-a-extracao). A leitura começa pelo service, passa pelo carregamento e pelo parser, e termina nas regras de rede.

## Como testar

Prepare o ambiente descrito no [README](../../README.md) e rode a suíte de extração. O teste com Chromium usa uma página controlada.

```powershell
node --env-file=.env --import tsx --test tests/products.test.ts tests/products.fallback.test.ts tests/products.proxy.test.ts tests/products.browser.test.ts
```

Para investigar uma URL real, use o [script de diagnóstico](#verificar-a-extracao).

## Pendências

- Lojas podem devolver CAPTCHA, verificação de conta ou HTTP 403. A prévia pode ficar parcial ou falhar, com opção de cadastro manual. Em verificações anteriores, Mercado Livre exigiu acesso adicional e Shein, Shopee e Nike retornaram bloqueios. Para esses três últimos links, a API retornou uma sugestão pelo endereço.
- O teste de cancelamento de DNS pode falhar com a alteração local `console.log(await lookupResult)` em [url-policy.ts](../../src/modules/products/network/url-policy.ts). Esse `await` espera o DNS antes de chegar a `Promise.race`. O commit da etapa contém a corrida direta entre DNS e cancelamento.

## Guia de estudo

As seções abaixo preservam o material de leitura de HTML, variantes, TypeScript e rede. Use o roteiro para abrir o trecho de código junto de cada explicação.

<a id="estudar-a-extracao"></a>
## Estudar a extração

O objetivo é preencher um formulário a partir de um link: **nome, imagem, preço, moeda e loja**, para o usuário revisar. *Web scraping* é obter esses dados lendo conteúdo publicado em páginas. Não temos uma integração oficial com cada loja.

Para não saltar entre explicações, siga esta ordem:

| Leia aqui | Depois abra o código | Pergunta que deve conseguir responder |
| --- | --- | --- |
| [Fluxo da extração](#fluxo-da-extracao) | [`products.service.ts`](../../src/modules/products/products.service.ts), método `extract` | Quando usamos cada tentativa e qual resultado escolhemos? |
| [Carregando o HTML](#carregando-o-html) | [`products.page-loader.ts`](../../src/modules/products/products.page-loader.ts), métodos `fetch` e `render` | Como o endereço vira HTML, primeiro sem e depois com navegador? |
| [Lendo o produto](#lendo-o-produto) | [`products.parser.ts`](../../src/modules/products/products.parser.ts), função `parseProductPage` | Como HTML vira JSON e depois os campos do Listed? |
| [Sugestão de nome pela URL](#sugestao-de-nome-pela-url) | [`products.name-suggestion.ts`](../../src/modules/products/products.name-suggestion.ts), função `suggestProductName` | Como sugerimos um nome para revisão quando nenhum foi encontrado? |
| [Conceitos de TypeScript](#conceitos-de-typescript) | Consulte ao encontrar uma anotação desconhecida | O que é tipo e o que realmente executa? |
| [Rede e proxy](#rede-e-proxy) | [`url-policy.ts`](../../src/modules/products/network/url-policy.ts), depois [`browser-proxy.ts`](../../src/modules/products/network/browser-proxy.ts) | Por que validamos IPs e como os dois caminhos usam o destino aprovado? |
| [Verificar a extração](#verificar-a-extracao) | `inspect-product.ts` e testes | Como distinguir falha de download, ausência de dados e falha de leitura? |

Os três arquivos centrais são **service → page-loader → parser**. A pasta `network` é apoio de transporte. Primeiro entenda o caminho de entrada/saída de cada etapa; depois acompanhe a implementação da rede. Os comentários locais explicam o motivo das APIs e das condições, enquanto a teoria completa fica aqui.

<a id="fluxo-da-extracao"></a>
## Fluxo da extração

Há dois pedidos diferentes: o navegador do usuário envia JSON/JWT ao Listed; nosso backend pede a página à loja. O JWT e os cookies pessoais do usuário não são repassados à loja.

```text
POST /api/v1/products/extract { url }
  → withUser verifica o JWT
  → controller valida a entrada com Zod
  → ProductsService.extract
      1. Validar a URL inicial
      2. loader.fetch(url) → conferir URL final → parseProductPage
      3. Prévia completa ou falha sem fallback? Encerrar a coleta
      4. Senão, loader.render(url) → conferir URL final → mesmo parser
         Escolher uma prévia inteira pelo número de campos e pelo nome
  → toResult classifica a prévia e tenta sugerir um nome pela URL original
  → { status, product, missingFields, reason?, suggestedName? }
```

O loader retorna `ProductPage` com os bytes do HTML, a URL final e o tipo de conteúdo. `readProductFromPage` confere se o endereço final é de uma tela de verificação antes de entregar esse HTML a `parseProductPage`. Isso evita ler o título de uma tela de bloqueio como se fosse o nome do item. O parser devolve `ExtractedProduct`, e `toResult` decide o status da prévia.

| Primeira tentativa | Decisão do service |
| --- | --- |
| Os cinco campos foram encontrados | Responder sem iniciar Chromium. |
| Dados parciais ou HTML sem produto | Tentar o navegador uma vez. |
| `FETCH_FAILED`, `TIMEOUT` ou HTTP 429 | Permitir uma tentativa pelo navegador. |
| HTTP 401/403 ou página de verificação identificada | Encerrar a coleta. |
| URL/IP proibido, conteúdo não HTML ou página acima do limite | Encerrar sem navegador. |

**A regra de 429 é uma exceção deliberada do MVP.** `Retry-After` é o cabeçalho com que a loja pede uma espera em segundos ou até uma data. A Mad respondeu 429/`Retry-After: 60` ao fetch, mas entregou o produto ao Chromium. Permitimos uma navegação alternativa inclusive antes dessa espera; isso não implementa respeito ao Retry-After. Se Chromium também receber 429, encerra. Não há laço de retries, cooldown ou cache entre chamadas.

### Como escolhemos a prévia?

O service mantém o resultado HTTP e avalia o candidato do navegador. Só substitui quando o candidato tem mais campos e confirma o nome conhecido: comparação sem diferença entre maiúsculas/minúsculas, aceitando um nome contido no outro, como um sufixo “ - AliExpress”. É uma checagem simples do MVP, não identificação universal de SKU/variante.

Escolhemos **um objeto inteiro**. Se a primeira página informa `100` sem moeda e outra informa `50 USD`, não juntamos os dois para inventar `100 USD`. Uma falha ou ocupação do navegador também não apaga dados úteis da primeira tentativa.

O resultado é `complete` com todos os campos, `partial` com dados úteis e campos ausentes ou `failed` sem dados úteis/por falha de coleta. Campos ausentes são `null` e aparecem em `missingFields`; `failed` inclui um `reason` conhecido. O HTTP 200 da nossa API significa que a tentativa foi respondida, não que todos os campos foram encontrados. Entrada/URL inicial inválida recebe 400; falta de JWT recebe 401.

Se a prévia final tiver `product.name: null`, a resposta pode incluir `suggestedName` separado para revisão manual. Nessa situação, `name` continua em `missingFields`, e a resposta conserva o status, o motivo de falha quando presente e a URL original. Veja [Sugestão de nome pela URL](#sugestao-de-nome-pela-url) para acompanhar essa etapa.

Exemplo didático de chamada e resposta:

```http
POST /api/v1/products/extract
Authorization: Bearer <accessToken>
Content-Type: application/json

{"url":"https://loja.example/produto/camisa"}
```

```json
{
  "status": "complete",
  "product": {
    "url": "https://loja.example/produto/camisa",
    "name": "Camisa Preta",
    "imageUrl": "https://loja.example/images/camisa.jpg",
    "priceCents": 27990,
    "currency": "BRL",
    "storeName": "Loja Exemplo"
  },
  "missingFields": []
}
```

`.example` é usado apenas nos exemplos, não representa uma loja de teste online. **Agora leia `ProductsService.extract` do começo ao fim.** Acompanhe a variável que guarda a prévia e observe que o service recebe um contrato `PageLoader`, sem tipos de abas ou conexões. Depois volte para o próximo capítulo.

<a id="carregando-o-html"></a>
## Carregando o HTML

`ProductPageLoader` reúne as duas formas de obter a página: `fetch` baixa o HTML entregue na resposta HTTP; `render` abre o Chromium e obtém o HTML da árvore atual após JavaScript. Os dois devolvem `ProductPage`, para a etapa seguinte não depender de qual caminho foi usado.

### Primeiro caminho: `fetch`

Uma versão mínima seria `const response = await fetch(url)`. `fetch` envia o pedido HTTP e devolve uma Promise, um resultado que chegará depois. `await` espera esse resultado ou lança um erro se a Promise rejeitar. Quando fetch devolve `response`, os cabeçalhos já chegaram, mas o corpo ainda pode estar chegando.

A resposta tem três partes:

```text
status: 200
headers: Content-Type: text/html; charset=utf-8
body: <html>...</html>
```

- **Status** informa o resultado HTTP. `response.ok` é verdadeiro para 200–299; um 404 não faz fetch rejeitar automaticamente, por isso conferimos o status.
- **Headers/cabeçalhos** são informações separadas do corpo. `Content-Type` descreve seu formato; `Location` informa o destino de um redirect.
- **Body/corpo** contém os dados, neste caso o HTML.

Usamos o fetch do pacote Undici. O Node já possui fetch global baseado em Undici; a importação direta permite manter cliente, tipos e configurações de conexão no mesmo pacote versionado. `Agent` configura a conexão usada pelo pedido, passado na opção chamada `dispatcher`. Ele garante que o pedido conecte ao IP público que conferimos; a explicação e o que perderíamos sem ele estão em [Rede e proxy](#rede-e-proxy).

O método valida a URL, resolve o domínio, cria o Agent e faz o pedido. `redirect: "manual"` impede seguir outro endereço automaticamente: a cada redirect repetimos as verificações. Aceitamos até três. O objeto `URL` interpreta o texto e resolve destinos relativos, como `new URL("/p/novo", currentUrl)`; essa operação sozinha não acessa a rede.

Por exemplo, se `https://loja.example/p/antigo` responder 302 com `Location: /p/novo`, o loader cancela a leitura do corpo da primeira resposta. Em seguida resolve o caminho relativo, volta ao laço e valida o destino antes de criar a próxima conexão. O endereço colado continua em `product.url`. O endereço final serve para interpretar informações da página, como uma imagem em `/fotos/item.jpg`.

**Por que não chamar só `response.text()`?** Isso aguardaria e carregaria o corpo inteiro antes de podermos rejeitar uma página grande. O corpo é um *stream*: uma sequência de pedaços que chegam com o tempo. `for await` espera cada pedaço; `Buffer.from` o representa como bytes do Node, e `Buffer.concat` junta os pedaços aprovados na ordem de chegada. Interrompemos acima de 2 MiB. `Content-Length` não basta: pode faltar ou indicar conteúdo comprimido.

Um **byte** é uma unidade de dados com valor entre 0 e 255. Contar bytes não é contar letras: um caractere acentuado pode ocupar mais de um byte. Mantemos `Buffer` até o parser escolher a codificação, para não estragar acentos convertendo cedo demais para texto.

`AbortSignal.timeout(10_000)` cria um aviso de cancelamento após dez segundos. O mesmo sinal cobre a tentativa HTTP, inclusive seus redirects. Sem prazo, uma loja poderia manter a tentativa pendente por muito tempo. O Agent é fechado em `finally`, tanto em sucesso quanto em erro. A leitura do corpo precisa ser aguardada antes de sair do `try`, para não fechar a conexão enquanto ainda chegam bytes.

**Agora leia `ProductPageLoader.fetch` e seus auxiliares HTTP.** Ao chegar à política de destino, entenda por enquanto sua entrada/saída — URL/domínio → IP aprovado — e continue o fluxo. A implementação dessa política tem um capítulo próprio abaixo.

### Segunda forma: `render`

Playwright é a biblioteca Node que controla o programa Chromium. *Headless* significa sem janela visível; ele ainda interpreta HTML, executa JavaScript e realiza pedidos de dados. Cheerio não faz isso: ele só lê o HTML que lhe entregamos.

Três objetos aparecem nessa parte:

| Objeto | Responsabilidade |
| --- | --- |
| `Browser` | O processo do Chromium, iniciado por `chromium.launch`. |
| `Context` | Uma sessão isolada, com cookies e armazenamento próprios. |
| `Page` | Uma aba dessa sessão, onde fazemos `goto` e lemos o conteúdo. |

A instância do loader é compartilhada no router, mas Chromium não fica permanentemente aberto. Cada fallback inicia um navegador e uma sessão nova, que são fechados ao terminar. Não reutilizamos o perfil pessoal do Chrome nem a sessão de outro usuário.

`page.goto(url, { waitUntil: "domcontentloaded" })` espera o HTML inicial ser interpretado. Isso ainda não afirma que produto/preço chegaram. Depois, a cada intervalo, `page.content()` entrega a árvore HTML atual e o mesmo parser procura os campos. O sucesso depende dos dados, não apenas de existir um script JSON-LD — ele poderia descrever somente a navegação ou a organização. Não usamos `networkidle`: analytics pode manter pedidos acontecendo continuamente.

Um evento `response` do Playwright também pode corresponder a um script ou a um pedido de dados. Guardamos o status somente para navegações no *frame* principal, a área que contém o documento da aba. Isso impede que um 403 de um recurso auxiliar seja interpretado como um 403 da página inteira. A URL também é verificada a cada leitura, pois JavaScript pode iniciar outra navegação.

O HTML de `page.content()` já é texto decodificado pelo navegador. Quando o transformamos em Buffer UTF-8, informamos UTF-8 ao parser; reaplicar o charset antigo do HTTP nesse texto poderia corrompê-lo.

Bloqueamos imagem, fonte e mídia para reduzir trabalho: queremos o link da imagem, não baixar a imagem. Permitimos JavaScript, CSS, XHR/fetch porque podem produzir os dados. `route.fallback()` nessa API do Playwright significa deixar um pedido seguir o próximo handler ou a rede; não é a decisão de fallback do service. *Service workers*, scripts capazes de atender pedidos/cache em segundo plano, ficam desativados para previsibilidade; isso pode afetar algumas páginas.

O estado `busy` permite um fallback por processo da API, sem fila ilimitada. Outro pedido recebe `BROWSER_BUSY`; se já tinha prévia HTTP parcial, ela permanece. Em várias réplicas, cada processo terá seu próprio limite. Isso limita concorrência, não quantidade de pedidos por minuto para uma loja.

O prazo do render é de 25 segundos. `AbortController` permite disparar cancelamento; o timer cancela conexões do proxy e fecha o navegador, interrompendo trabalho pendente. `finally` libera navegador/proxy e o estado ocupado mesmo em falha. Lançamento e limpeza têm custo: não é uma promessa de duração idêntica em toda máquina. Se já havia HTML parcial quando o prazo acabou, ele pode ser avaliado pelo service.

O limite de 2 MiB é do HTML serializado entregue ao parser, não de toda a memória ou tráfego do Chromium. `BROWSER_UNAVAILABLE` informa que ele não pôde iniciar, por exemplo por binário ausente. O MVP não faz login nem resolve verificações de conta.

**Agora leia `ProductPageLoader.render` inteiro.** Observe o `try/finally`, a criação da sessão e a condição que encerra a espera. Deixe a implementação do proxy para [Rede e proxy](#rede-e-proxy). Depois siga para a leitura dos dados.

<a id="lendo-o-produto"></a>
## Lendo o produto

A entrada de `parseProductPage` é o HTML já carregado. Sua saída é um objeto com os seis campos da API, incluindo a URL original. A função não acessa rede ou banco. Para acompanhar cada transformação, use este HTML didático:

```html
<meta charset="utf-8">
<meta property="og:site_name" content="Loja Exemplo">
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "Camisa Preta",
  "image": ["/images/camisa.jpg"],
  "brand": { "@type": "Brand", "name": "Marca Exemplo" },
  "offers": { "@type": "Offer", "price": "279.90", "priceCurrency": "BRL" }
}
</script>
```

### De bytes a uma árvore consultável

**Charset** é a regra que transforma bytes em texto, como UTF-8 ou Windows-1252. Usar a regra errada pode transformar `Café` em `CafÃ©`. `cheerio.loadBuffer` considera a codificação do cabeçalho HTTP, indicações no HTML e o padrão UTF-8 escolhido pelo projeto. `TextDecoder` é usado para verificar se o nome do charset HTTP é reconhecido; o Cheerio faz a decodificação efetiva.

Cheerio interpreta HTML e constrói uma árvore de elementos consultável, semelhante ao DOM do navegador. DOM é essa representação estruturada de tags e seus atributos. O retorno de `loadBuffer` é uma função de consulta, chamada `document` no código; muitas documentações usam o nome `$`, que não é uma sintaxe especial.

### De uma tag a um objeto JavaScript

```text
HTML:   <script type="application/ld+json">{"@type":"Product","name":"Camisa"}</script>
texto:  '{"@type":"Product","name":"Camisa"}'
objeto: { "@type": "Product", name: "Camisa" }
```

`document('script[type*="ld+json"]')` usa um seletor CSS: procura tags `script` cujo atributo `type` contém `ld+json`. `toArray()` transforma a seleção em array comum para percorrermos. `document(script).text()` lê o conteúdo entre as tags. Só então `JSON.parse` transforma a string em valor JavaScript. Isso não executa código do site; não usamos `eval`.

JSON-LD é JSON que descreve entidades com um vocabulário comum. Schema.org define nomes como `Product`, `Offer`, `price` e `priceCurrency`. `@context` identifica esse vocabulário; o parser não baixa o endereço informado nele. `@type` diz que entidade o objeto descreve. Um `<script type="application/ld+json">` guarda dados; esse atributo HTML também é diferente da chave JSON `@type`.

Uma página pode ter objetos de organização, navegação e produto em scripts diferentes. Procuramos `Product` ou `ProductGroup` em objeto único, lista ou `@graph` — uma lista de entidades agrupadas. `findProductEntity` usa recursão: aplica a mesma busca a cada parte menor dos dados. Script inválido é ignorado para permitir tentar os seguintes. O MVP usa o primeiro produto/grupo encontrado; não identifica universalmente todo produto principal entre recomendações.

### Do objeto aos campos do Listed

| Campo | Leitura e transformação do exemplo |
| --- | --- |
| `name` | `Product.name` vira texto limpo: `Camisa Preta`. |
| `imageUrl` | Pega a primeira imagem; `/images/camisa.jpg` com a URL final vira `https://loja.example/images/camisa.jpg`. Não baixa a imagem. |
| `priceCents` | Lê a oferta e converte para centavos inteiros. `"279.90"` vira `27990`. |
| `currency` | Lê a moeda da oferta e padroniza três letras maiúsculas: `BRL`. |
| `storeName` | Lê `og:site_name`: `Loja Exemplo`; sem essa tag, usa o domínio final. |
| `url` | Preserva o endereço original colado pelo usuário, mesmo após redirects. |

`brand` é a marca, não a loja. No exemplo, `Marca Exemplo` fabrica o produto; `Loja Exemplo` é quem o vende. Uma imagem pode ser string, lista ou objeto com `url`/`contentUrl`. `new URL(image, finalUrl)` também completa endereços começando com `//`, como `//cdn.example/foto.jpg`, usando o protocolo da página. Só devolvemos links HTTP/HTTPS.

Se faltar dado de JSON-LD, tentamos meta tags Open Graph, padrão usado em previews de links: `og:title`, `og:image`, `og:site_name`, além de `product:price:amount`/`currency`. Em `<meta property="og:title" content="Camisa">`, o valor está no atributo `content`, então usamos `.attr("content")`, não `.text()`. `.first()` escolhe a primeira tag; a vírgula no seletor combina alternativas `property` ou `name`.

Para o nome, a ordem é JSON-LD → `og:title` → texto da tag HTML `<title>`. Essa última tag normalmente aparece na aba do navegador e pode conter um texto genérico da loja. O parser só a usa quando encontra uma entidade `Product`/`ProductGroup` ou a meta tag `og:type` com valor `product`. O service identifica as rotas conhecidas de verificação pela URL final antes de chamar o parser.

### Ofertas, variantes e dinheiro

`offers` pode ser um objeto ou lista. `readOfferDetails` procura uma oferta concreta com preço válido, mantendo preço/moeda do mesmo contexto. Não calculamos automaticamente o menor preço.

- `Offer.price`/`priceCurrency` é o formato direto.
- `Offer.priceSpecification` pode guardar `PriceSpecification` ou `UnitPriceSpecification`. Aceitamos preço unitário; ignoramos frete (`DeliveryChargeSpecification`) e preço riscado (`StrikethroughPrice`).
- `AggregateOffer` pode conter ofertas concretas em `offers`, que percorremos. Se só trouxer uma faixa `lowPrice`/`highPrice`, fornecemos preço exato apenas se os extremos normalizados forem iguais. `90–120` não vira silenciosamente `90`.
- `ProductGroup.hasVariant` reúne variações com campos compartilhados no grupo. Selecionamos `?variant=` pela URL do produto/oferta ou a primeira variante sem seleção explícita. Herdamos nome/imagem ausentes; uma variante explícita sem oferta não herda preço geral do grupo.
- Também selecionamos `?variant=` quando o formato é `Product` com lista de `offers`, como no bloco real da Mad. Sem correspondência, não usamos o preço de outra variante. Meta tags globais não completam preço/moeda de link com `?variant`, pois podem pertencer à variante padrão.
- Na Shein Brasil, o parâmetro de variante é `skucode`. O JSON-LD do vestido é uma lista com um `ProductGroup` que tem nome e imagem. Cada um dos cinco tamanhos em `hasVariant` tem uma oferta própria. O parser compara o `skucode` da URL final com o parâmetro em `Offer.url` e lê `price` e `priceCurrency` da oferta correspondente. O link sem seleção usa o nome e o preço da primeira variante publicada (XL, `107.12 BRL`). O link que aponta para XS usa `99.16 BRL`. Se o código não corresponder a uma variante, preço e moeda ficam ausentes. O [teste com um recorte do JSON-LD](../../tests/products.test.ts) cobre os três casos.

Quando completamos moeda por outra especificação/meta, o preço precisa corresponder: oferta `100` sem moeda e meta `50 USD` não podem produzir `100 USD`. O indicador interno `isPriceRange` também impede que uma meta com o menor valor transforme uma faixa em preço exato.

`parsePriceCents` trabalha com os dígitos do preço recebido. `1.299,90` vira `129990n` internamente e `129990` no JSON. A conversão evita perder os centavos, como aconteceria com `parseFloat("279,90")`. Formatos desconhecidos e valores acima do limite do cadastro retornam `priceCents: null` para revisão manual. Quando faltar o preço, `missingFields` inclui `priceCents`. O código da moeda continua vindo da loja.

**Agora leia `parseProductPage` em suas cinco etapas e depois seus auxiliares na ordem em que aparecem.** Use os exemplos de `tests/products.test.ts` para mudar mentalmente uma entrada: remover `offers` deve deixar preço/moeda ausentes sem meta tags; trocar imagem por `/foto.jpg` deve completar o domínio final. Se uma anotação TS atrapalhar, consulte [Conceitos de TypeScript](#conceitos-de-typescript).

<a id="sugestao-de-nome-pela-url"></a>
## Sugestão de nome pela URL

`suggestProductName(url)` recebe o link original e trabalha só com seu texto. A função é pura. Ela devolve a mesma sugestão para a mesma URL, sem consultar a rede ou alterar outros dados. O service a chama após escolher a prévia final, quando o nome ainda está ausente.

Um *slug* é o trecho legível do caminho, como `vestido-floral`. A função primeiro confere o domínio da loja. Depois usa uma expressão regular, ou *regex*, para reconhecer o formato do caminho e separar o trecho legível do identificador numérico. Veja exemplos de caminhos aceitos.

| Loja | Caminho de exemplo | Trecho usado |
| --- | --- | --- |
| Shein Brasil | `/vestido-floral-p-12345678.html` | `vestido-floral` |
| Nike Brasil | `/camiseta-nike-sportswear-123456.html` | `camiseta-nike-sportswear`, antes do ID de seis dígitos |
| Shopee Brasil (`shopee.com.br`) | `/calca-preta-i.123.456` | `calca-preta`, antes dos IDs de loja e item |

Se o domínio ou o formato não for reconhecido, a resposta vem sem `suggestedName`. A função também descarta trechos sem palavras legíveis e limita a sugestão a 160 caracteres. Ela conserva a grafia do endereço e só ajusta as iniciais quando o trecho inteiro vem em minúsculas. Por isso um slug em inglês da Shein continua em inglês.

Uma URL de verificação da Shopee em `/verify/traffic/error` pode carregar o endereço do produto no parâmetro `next`. A função lê `next` uma vez e só usa esse endereço se ele tiver a mesma origem HTTPS da Shopee, com porta padrão e sem usuário ou senha. Origem é a combinação de protocolo, domínio e porta. O endereço interno serve apenas para ler o slug. A API continua devolvendo o link original em `product.url`.

Existem duas camadas de codificação porque um endereço foi colocado dentro de outro. Em `next=https%3A%2F%2Fshopee.com.br%2FCal%25C3%25A7a-Preta-i.123.456`, a leitura do parâmetro devolve `https://shopee.com.br/Cal%C3%A7a-Preta-i.123.456`. Repare que `%25` virou o caractere `%`. Depois de conferir o endereço interno e separar o identificador, a função decodifica apenas o slug. `Cal%C3%A7a-Preta` vira `Calça-Preta`, e os hífens dão lugar a espaços para formar `Calça Preta`.

**Agora abra [`suggestProductName`](../../src/modules/products/products.name-suggestion.ts)** e acompanhe o endereço de exemplo até o texto de saída. Volte a `ProductsService.toResult` para ver onde a sugestão é adicionada à resposta.

<a id="conceitos-de-typescript"></a>
## Conceitos de TypeScript usados no código

TypeScript descreve formatos para o compilador; a maior parte dessas anotações desaparece no JavaScript final. Ele não valida automaticamente JSON recebido de outra página. Por isso mantemos valores externos como `unknown` e fazemos verificações reais antes de usá-los.

| Sintaxe | Significado neste módulo |
| --- | --- |
| `Promise<ProductPage>` | A função concluirá depois com uma página ou erro. `await` aguarda essa conclusão. |
| `ProductPage[]` | Array de páginas; `string[]`, array de textos. |
| `Record<string, unknown>` | Objeto de chaves string e valores ainda desconhecidos; não garante que `name` existe ou é string. |
| `JsonObject \| null` | A função pode devolver objeto ou ausência; o chamador precisa tratar os dois. |
| `value is JsonObject` | Anotação de uma função de checagem: quando retorna true, TS trata aquele valor como o tipo comprovado. |
| `private readonly` | Propriedade só acessível pela classe e não reatribuída depois da inicialização. É uma restrição de tipagem; não congela profundamente um objeto. |
| `fetchPage?: ...` | Propriedade/parâmetro opcional; pode não ser fornecido. |
| `typeof fetch` numa anotação | Copia a assinatura da função para aceitar outra equivalente nos testes; não executa fetch. |
| `implements PageLoader` | O compilador confere que a classe oferece os métodos exigidos pelo contrato. |
| `a ?? b` | Usa `b` apenas se `a` for null/undefined; string vazia não aciona essa alternativa. |
| `a?.b` | Acessa `b` apenas se `a` existir; caso contrário resulta em undefined. |
| `...objeto` | Copia propriedades; as escritas depois substituem as anteriores. Não é uma cópia profunda de tudo. |

`<...>` fornece parâmetros para um tipo genérico: `Promise<string>` descreve qual valor chegará depois; `Record<string, unknown>` descreve o tipo das chaves e dos valores. A assinatura `(hostname: string) => Promise<string[]>` descreve uma função, não a executa.

```ts
const value: unknown = JSON.parse('{"name":"Camisa"}');
// value.name não é permitido aqui: value ainda pode ser qualquer formato.
if (isJsonObject(value)) {
  // Agora sabemos que é objeto, mas value.name continua unknown.
  const name = readText(value.name); // readText comprova texto/número simples.
}
```

`isJsonObject` confere `null`, `typeof` e array em runtime. A anotação `value is JsonObject` comunica ao TS o que a função comprovou; escrevê-la sem implementar a checagem correta não protege os dados.

Três nomes que parecem relacionados, mas têm tarefas distintas: `"@type": "Product"` é dado JSON-LD presente na página; `import type` importa só uma descrição de tipo e some do build; `@types/node` é um pacote de declarações das APIs Node. Cheerio/Undici já fornecem seus próprios tipos. `import * as cheerio` reúne as funções exportadas sob um nome, por isso chamamos `cheerio.loadBuffer`.

Uma **callback** é uma função passada a outra para receber um resultado/evento. O `lookup` da conexão usa a convenção Node `callback(erro, resultado, família)`: `null` no primeiro lugar significa sem erro; `4`, IPv4. Outra forma de operação assíncrona é Promise: seu executor recebe `resolve` (entrega valor) e `reject` (faz await lançar erro). `Promise.race` entrega a primeira que concluir, mas não cancela automaticamente as demais.

Nos testes, fornecemos funções equivalentes ao fetch/launcher ou um objeto que implementa `PageLoader`. Assim testamos decisões sem depender de uma loja online. Em produção, o router monta as implementações reais. Esses contratos pequenos evitam espalhar tipos internos do Playwright e do Express pelos serviços.

**Volte ao trecho que estava lendo.** Para entender por que a conexão usa IP conferido, prossiga ao aprofundamento abaixo; ele corresponde aos dois arquivos de `network/`.

<a id="rede-e-proxy"></a>
## Rede e proxy

### Como um nome se torna uma conexão?

Considere `https://www.loja.example:443/produto/123`:

| Parte | Papel |
| --- | --- |
| `https:` | Protocolo HTTP sobre uma conexão protegida por TLS. |
| `www.loja.example` | Hostname, o nome do destino. |
| `443` | Porta, identifica o serviço no destino; padrão HTTPS. HTTP usa 80. |
| `/produto/123` | Caminho do recurso solicitado. |

Para conectar, o sistema precisa de um **IP**, não apenas do nome. IPv4 usa quatro números, como `93.184.215.14`; IPv6 usa outro formato. O MVP aceita conexões IPv4. **DNS** é o mecanismo de resolução de nomes: perguntar quais IPs correspondem ao domínio. Um nome pode ter vários endereços e mudar de resultado. `lookup` usa o resolvedor do sistema operacional, que considera DNS e configurações locais.

`new URL(...)` só interpreta o texto. `ProductUrlPolicy.parseUrl` confere protocolo, credenciais, porta e forma do nome; `resolvePublicAddress` consulta os endereços e escolhe um permitido. O cliente que abrir a conexão precisa usar exatamente esse IP.

Um **socket** é o recurso de comunicação aberto para um endereço e uma porta. HTTP organiza pedidos/respostas nessa comunicação. HTTPS usa TLS para criptografar o tráfego e conferir o certificado do domínio. Certificado é um documento digital usado na verificação da identidade apresentada pelo servidor: o cliente confere validade/confiança e correspondência com o nome pedido. O cabeçalho `Host` informa qual domínio foi solicitado, pois vários sites podem compartilhar um IP.

### Por que não aceitamos qualquer destino?

Quem acessa o link é nosso backend. `localhost` aponta ao ambiente dele, não ao computador de quem colou a URL. Se aceitássemos links para serviços internos, a API poderia virar um caminho indevido de acesso a banco, painel ou outro serviço da rede. Essa classe de problema é chamada SSRF.

| Destino | Motivo do bloqueio |
| --- | --- |
| `localhost`, `127.0.0.1` | Loopback: o próprio ambiente do backend. |
| `10.x.x.x`, `192.168.x.x`, `172.16.x.x` até `172.31.x.x` | Redes privadas usadas em empresas, casas ou infraestrutura. |
| `169.254.x.x` | Link-local, incluindo serviços locais de algumas infraestruturas. |
| Outras faixas especiais | Reservadas ou inadequadas para buscar lojas públicas; `ipaddr.js` faz a classificação. |

Uma faixa é um conjunto, não um endereço exato. A política permite domínio HTTP/HTTPS, portas padrão, sem credenciais/IP literal e conexão a IPv4 fora das categorias especiais. Um nome com aparência de loja pode resolver para `10.0.0.2`; conferir só o texto não basta. `ipaddr.js` chama o IPv4 comum restante de `unicast`; esse rótulo específico não comprova loja legítima, conteúdo confiável ou servidor online.

O resolvedor não aceita nosso AbortSignal. A política aguarda duas Promises: resolução DNS e aviso `abort`; `Promise.race` entrega o primeiro resultado/erro. Um **listener** é a função registrada para reagir ao aviso. `finally` a remove quando não precisamos mais ouvi-la. A consulta no sistema pode continuar após timeout, mas seu resultado tardio não será usado para conectar.

**Agora abra `network/url-policy.ts`.** Leia `parseUrl` e `resolvePublicAddress`, relacionando cada condição à tabela. Depois acompanhe como cada carregamento usa o endereço escolhido.

### O Agent fixa o destino do fetch

Sem configuração, poderíamos conferir um resultado DNS público e, ao conectar, deixar o cliente consultar DNS outra vez. Um domínio controlado por outra pessoa poderia devolver um IP privado nessa segunda consulta. Isso é DNS rebinding: a conexão deixa de corresponder ao destino que aprovamos.

```text
Sem amarrar as etapas: verificar DNS → IP público; conectar com novo DNS → outro IP
Com Agent:            verificar DNS → IP público; conectar → aquele IP aprovado
```

`Agent` configura/administra conexões do Undici. `connect.lookup` é o ponto em que fornecemos o endereço já escolhido via callback. Mantemos o domínio original na URL para preservar `Host` e a verificação do certificado HTTPS. Não substituímos a URL por um IP.

Na prática, o loader primeiro espera `resolvePublicAddress` devolver um IPv4 permitido. A função passada em `lookup` fica guardada no Agent até o momento em que o cliente abre a conexão. Nesse momento, ela chama `callback(null, endereçoAprovado, 4)`. Os três argumentos representam ausência de erro, o IP já escolhido e a família IPv4. `dispatcher: agent` liga essa configuração ao pedido específico do Undici.

Sem o Agent, um download básico ainda poderia funcionar; perderíamos a garantia de usar o mesmo destino aprovado. O Agent não faz scraping e não controla as conexões do Chromium. Você pode voltar aos auxiliares HTTP de `products.page-loader.ts` para ver essa configuração antes de seguir.

### O proxy aplica a política às conexões do Chromium

O navegador tem sua própria rede. Além da página inicial, ele pode pedir scripts/APIs, abrir frames e seguir redirects. Passar um Agent ao fetch não configura esses pedidos; conferir só a URL inicial ou instalar `context.route` não fixa seus destinos de conexão.

Um **proxy** é um intermediário. `BrowserProxy` abre uma porta temporária no loopback do próprio backend. Configuramos o Chromium para enviar as conexões HTTP/HTTPS a essa porta; o proxy valida e resolve cada destino antes de conectar ao IP público aprovado.

```text
Chromium → proxy local → política de domínio/porta/DNS → IP público escolhido → loja
```

Não é um serviço de proxy residencial contratado. `listen` em `127.0.0.1` restringe a escuta ao ambiente local; porta `0` pede uma porta livre ao sistema. Os destinos pedidos através dele continuam proibidos se forem locais/privados.

**HTTP:** o proxy recebe uma URL absoluta, verifica o destino, abre pedido ao IP público na porta 80 e preserva o domínio em `Host`. Encaminha corpo/cabeçalhos apropriados, removendo cabeçalhos que descrevem apenas a conexão do proxy (*hop-by-hop*).

**HTTPS:** Chromium envia `CONNECT loja.example:443`, pedindo uma conexão até o destino. O proxy valida domínio/porta, resolve o IP e abre um túnel **TCP**. TCP transporta um fluxo de bytes ordenado; túnel aqui é encaminhar bytes nos dois sentidos. `200 Connection Established` confirma o túnel aberto, não o sucesso de uma página de produto. `pipe` conecta o fluxo de leitura de um lado ao de escrita do outro.

No código, a conexão que chega do Chromium e a conexão que sai para a loja são sockets distintos. No túnel, `client.pipe(remote)` encaminha os bytes do navegador à loja e `remote.pipe(client)` traz a resposta. O navegador só recebe a confirmação do túnel após o socket remoto conectar. Se a tentativa termina com algum socket ainda aberto, `close` encerra as duas pontas rastreadas para liberar a porta e as conexões.

Os bytes TLS passam pelo túnel sem serem descriptografados pelo proxy. Chromium continua negociando HTTPS e validando o certificado da loja. O proxy decide para onde conectar, preservando cookies e protocolos do navegador sem ler o conteúdo criptografado. Ele rastreia os sockets abertos e os fecha no cancelamento/fim; `close` pode ser chamado mais de uma vez com segurança, isto é, é idempotente.

`bypass: "<-loopback>"` remove a exceção automática do Chromium que poderia enviar pedidos locais sem proxy. O proxy é local por necessidade; um pedido da página para um destino local continua passando pela política e sendo recusado.

<details>
<summary>Aprofundamento: por que as opções de UDP e service workers aparecem?</summary>

UDP é outro transporte, baseado em mensagens em vez do fluxo TCP. QUIC, usado no HTTP/3, e certas comunicações WebRTC podem usar UDP fora dos túneis deste proxy. A configuração desabilita QUIC e bloqueia WebRTC UDP sem proxy, mantendo o tráfego web no caminho que controlamos. Service workers são desativados para previsibilidade da leitura/roteamento; podem atender conteúdo de cache em segundo plano.

Essas opções não transformam uma página em confiável nem protegem contra qualquer bug do navegador/sistema. A implementação confere e fixa destinos das conexões encaminhadas pelo proxy. Ela não é uma quota de memória do sistema operacional para Chromium.

</details>

**Agora abra `network/browser-proxy.ts` nesta ordem:** `start`, `forwardHttp`, `openTunnel`, `close`. Observe validação antes da conexão, encaminhamento e limpeza. Depois retorne ao `render` do loader: o proxy já tem um papel definido, não é uma API que apareceu sem motivo.

<a id="verificar-a-extracao"></a>
## Verificar e depurar a extração

Para observar a regra oficial sem abrir Express ou conectar ao banco:

```powershell
npm run inspect:product -- "https://madenlatados.com.br/products/camiseta-gummo-preto"
```

Use aspas em URLs com `&` para o shell tratar o endereço como um argumento. O script chama `ProductsService`, não um quarto caminho de coleta. `requests` mostra pedidos HTTP/status/redirects e `retryAfter`; `browserAttempted` informa se houve render; `browserFailure` registra sua falha conhecida; `pages.fetch`/`pages.playwright` resumem as páginas obtidas; `result` é a resposta do mesmo fluxo da API. Tentar Chromium não significa que seu candidato foi escolhido.

Ao investigar, siga **status → URL final → presença de JSON-LD → formato dos campos**. O painel Elements do navegador mostra a árvore depois de possíveis mudanças por JavaScript. Isso não comprova que o mesmo bloco existia na resposta recebida pelo fetch. O backend também pode receber uma página diferente por sessão, região ou política da loja.

No teste com a Shein, a URL do produto redirecionou por HTTP 302 para `/risk/action/limit`. O HTTP 200 era da página de bloqueio, que chegou sem JSON-LD. O fallback Chromium chegou a `/risk/challenge`, uma página de CAPTCHA também sem JSON-LD. O parser só consegue ler o HTML que recebe. Após o ajuste, o service reconhece as duas rotas pelo domínio e caminho da URL final. Quando o fetch já encontra uma delas, encerra a extração sem abrir o navegador. No teste com o endpoint real, o HTTP 200 da API trouxe `status: "failed"` e `reason: "REMOTE_VERIFICATION_REQUIRED"` no corpo da resposta.

Na Shopee, a rota `/verify/traffic/error` veio com um título genérico. A checagem compartilhada em `products.errors.ts` identifica essa URL como `REMOTE_VERIFICATION_REQUIRED`. O service checa a página devolvida pelo fetch, e o loader checa a URL durante a renderização, pois JavaScript pode mudar o endereço depois de abrir a página.

Os testes cobrem parser, decisões de fallback, rede/proxy e Chromium com HTML controlado. O teste de navegador insere JSON-LD por JavaScript depois de 100 ms; toda a navegação é respondida por fixture local, sem depender de lojas. Outros cenários verificam timeout, processo fechado, `BROWSER_BUSY`, destinos privados recusados e preservação de dados HTTP. As fixtures JSON reais enviadas no chat ficam em `tests/fixtures/`; elas comprovam a leitura desses dados, não o acesso à página online.

## Referências

- [Node.js — fetch e dispatcher](https://nodejs.org/api/globals.html#fetch) e [DNS lookup](https://nodejs.org/api/dns.html#dnspromiseslookuphostname-options).
- [Cheerio — carregar HTML](https://cheerio.js.org/docs/basics/loading/).
- [Schema.org — Product](https://schema.org/Product), [ProductGroup](https://schema.org/ProductGroup) e [AggregateOffer](https://schema.org/AggregateOffer).
- [Playwright — Page](https://playwright.dev/docs/api/class-page), [BrowserContext](https://playwright.dev/docs/api/class-browsercontext) e [rede](https://playwright.dev/docs/network).
- [TypeScript — refinamento de tipos](https://www.typescriptlang.org/docs/handbook/2/narrowing.html).
- [OWASP — prevenção de SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
