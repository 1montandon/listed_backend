# Revisão E4.2 — Totais em uma moeda, sem câmbio

**Estado.** Backend validado e aprovado para commit. A migração de preços para centavos inteiros foi aplicada ao PostgreSQL local.

## Objetivo

Calcular separadamente o valor de **todos** os produtos da wishlist e o valor dos que **faltam comprar**, em uma moeda escolhida por consulta. Não buscamos cotações nem convertemos preços neste checkpoint. Quando faltam dados ou há outra moeda, o resultado informa que a soma é parcial.

Arquivos: [rota](../../../src/modules/wishlists/wishlists.routes.ts), [schema da consulta](../../../src/modules/wishlists/wishlists.schema.ts), [controller](../../../src/modules/wishlists/wishlists.controller.ts), [service e cálculo](../../../src/modules/wishlists/wishlists.service.ts), [repository](../../../src/modules/wishlists/wishlists.repository.ts) e [teste HTTP](../../../tests/wishlist-totals.integration.test.ts).

## Contrato

Chame `GET /api/v1/wishlists/:id/totals?currency=BRL` com `Authorization: Bearer <accessToken>`. A moeda é obrigatória e aceita `BRL`, `USD` ou `EUR`, em maiúsculas. O cálculo não usa automaticamente a preferência do perfil nesta etapa.

Exemplo: uma lista possui um item de R$ 0,10 ainda não comprado, um de R$ 0,20 já comprado e outro com preço sem moeda. A resposta contém:

```json
{
  "totals": {
    "currency": "BRL",
    "all": {
      "amountCents": 30,
      "productCount": 3,
      "included": 2,
      "excluded": { "missingPrice": 0, "missingCurrency": 1, "otherCurrency": 0 },
      "isComplete": false
    },
    "remaining": {
      "amountCents": 10,
      "productCount": 2,
      "included": 1,
      "excluded": { "missingPrice": 0, "missingCurrency": 1, "otherCurrency": 0 },
      "isComplete": false
    }
  }
}
```

- `all` considera todos os produtos; `remaining` considera somente os não comprados. Cada seção tem seus próprios contadores.
- `amountCents` é um número inteiro em centavos na moeda solicitada. Ele soma somente os itens incluídos naquela seção.
- `productCount` é o número de itens na seção; `included` conta os que entraram na soma. Preço `0` é um valor válido e é incluído.
- `excluded` explica os produtos que não entraram: sem preço (`missingPrice`), com preço mas sem moeda (`missingCurrency`) ou com preço e moeda diferente (`otherCurrency`). Os motivos são exclusivos nessa ordem: um item sem preço e sem moeda conta apenas em `missingPrice`. Assim, `included + missingPrice + missingCurrency + otherCurrency = productCount`.
- `isComplete` é `true` quando todos os itens da seção entraram na soma. Se a seção estiver vazia, o total é `0` e a soma está completa. Se o total for `0` e houver itens excluídos, ele representa apenas os itens incluídos.

Moedas legadas diferentes de BRL, USD e EUR, por exemplo `JPY`, contam como `otherCurrency` quando têm preço; não são interpretadas como BRL. Se o preço não tem moeda, também não adivinhamos. Lista alheia ou inexistente recebe 404; falta de autenticação recebe 401; moeda inválida ou ausente recebe 400.

## Como o backend trata dinheiro

O PostgreSQL guarda `price_cents` como `BIGINT` e o Prisma lê esse campo como `bigint`. O tipo de 64 bits preserva a faixa da coluna anterior, que chegava a `9.999.999.999,99`. Um inteiro de 32 bits suportaria apenas `21.474.836,47` na mesma escala.

O cadastro e a edição recebem `priceCents` como número inteiro. Depois que o Zod valida a faixa, o repository converte esse valor para `bigint` e grava no banco. A extração precisa interpretar primeiro o valor publicado pela loja. Ela converte `"12.3"` em `1230n` juntando os dígitos da parte inteira e os das casas decimais. Os totais somam diretamente os inteiros vindos do banco.

Na saída, o backend converte `bigint` em número JSON somente dentro da faixa de inteiros seguros. Um total de `1230n + 20n` sai como `amountCents: 1250`. Se um total ultrapassar a faixa, a rota responde 422 com `TOTAL_OUT_OF_RANGE` para evitar publicar um valor arredondado. A escala é fixa em 100, inclusive para moedas legadas, para preservar a representação usada pelo Listed.

### Migração dos valores salvos

A migração converte a coluna existente em uma transação. O PostgreSQL multiplica o decimal por 100 antes de transformá-lo em `BIGINT`. `279.90` vira `27990`, `0.00` vira `0` e um preço ausente continua `NULL`. O teste compara também os outros campos do produto, incluindo seu ID, wishlist, moeda e estado de compra. [Migração SQL](../../../prisma/migrations/20261118030000_product_price_cents/migration.sql) · [Teste da migração](../../../tests/product-price-cents-migration.test.ts)

## Fluxo do código

1. A rota chama o controller autenticado. O schema Zod valida o ID e a moeda informada na query.
2. O service pede ao repository os produtos da wishlist do próprio usuário. O repository começa pela wishlist: isso permite distinguir uma lista vazia de outra que não existe ou é de outra conta.
3. São selecionados apenas `priceCents`, `currency` e `isPurchased`. O service calcula primeiro para todos e depois para os não comprados.
4. Para cada conjunto, percorre os produtos, classifica os excluídos, soma os incluídos em centavos inteiros e produz os contadores e `isComplete`.
5. O controller devolve o resultado. Não salvamos totais no banco, não modificamos preços e não chamamos serviço externo.

Esta primeira implementação lê os campos necessários de todos os produtos da lista para somar na aplicação. Não foi medida em listas grandes; agregação no banco ou paginação podem ser avaliadas caso se tornem necessárias. A resposta não inclui identificadores individuais dos excluídos, apenas quantidades.

## O que ler

1. [wishlists.schema.ts](../../../src/modules/wishlists/wishlists.schema.ts), [rotas](../../../src/modules/wishlists/wishlists.routes.ts) e [controller](../../../src/modules/wishlists/wishlists.controller.ts): entrada e saída HTTP.
2. `findProductsForTotals` no [repository](../../../src/modules/wishlists/wishlists.repository.ts): filtro pelo dono e campos selecionados.
3. `getTotals` no [service](../../../src/modules/wishlists/wishlists.service.ts): classificação dos itens e soma em centavos.
4. [Teste de integração](../../../tests/wishlist-totals.integration.test.ts): lista vazia, zero, decimais, dados ausentes, moeda diferente, comprado e acesso alheio.
5. `decimalToCents` para acompanhar a conversão dos preços publicados pelas lojas. [cents.ts](../../../src/shared/money/cents.ts)

## Como testar

Com o PostgreSQL e as migrações locais disponíveis:

```powershell
npm run db:deploy
npm run db:generate
node --env-file=.env --import tsx --test tests/wishlist-totals.integration.test.ts tests/product-price-cents-migration.test.ts
npm run typecheck
npm run build
npm test
```

Typecheck, build e **77/77 testes** passaram. A suíte cobre a migração de dados antigos, a persistência de `24990` a partir do JSON `{ "priceCents": 24990 }`, a soma `10 + 20 = 30` e o erro para um total fora da faixa segura. A migração foi aplicada ao banco local depois de passar no teste isolado.

Para testar manualmente, crie produtos com preços em BRL e USD, marque um como comprado e consulte a URL com `?currency=BRL`. Compare os dois valores e os contadores. Depois consulte com `?currency=USD`: os itens em BRL passam a ser contabilizados como outra moeda, sem conversão.

## Pendências

- O frontend ainda não integra E1.1 a E4.2. Será necessário mostrar claramente quando o valor é parcial.
- E4.3 escolherá o provedor e a política de câmbio com você; E4.4 definirá conversão, arredondamento e integração. Não há taxa fixa ou conversão nesta entrega.
