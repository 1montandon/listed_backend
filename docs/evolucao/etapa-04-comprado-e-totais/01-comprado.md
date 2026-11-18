# Revisão E4.1 — Marcar produto como comprado

**Estado:** backend implementado, verificado e validado para commit. A migração foi aplicada ao PostgreSQL local. O frontend ainda não foi adaptado.

## Objetivo

Guardar se um produto foi marcado como comprado. Esse campo registra uma escolha da pessoa: o Listed não processa uma compra, não armazena valor pago nem calcula totais neste checkpoint.

Arquivos principais: [modelo Prisma](../../../prisma/schema.prisma), [migração](../../../prisma/migrations/20261118020000_product_purchased/migration.sql), [schema Zod](../../../src/modules/products/saved-products.schema.ts), [repository](../../../src/modules/products/saved-products.repository.ts), [teste HTTP](../../../tests/product-purchased.integration.test.ts) e [teste da migração](../../../tests/product-purchased-migration.test.ts).

## Conceito: boolean e estado desejado

Um boolean só tem dois valores: `true` ou `false`. O campo `isPurchased` representa “está marcado como comprado?”. Novos produtos começam em `false`.

A API recebe o **estado desejado**. Para marcar, envie:

```http
PATCH /api/v1/products/:id
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{ "isPurchased": true }
```

Para desmarcar, envie `{ "isPurchased": false }`. A resposta é `200` com `{ "product": ... }` e o campo atualizado. Os retornos de criação, consulta, listagem e movimentação de produtos também passam a incluir `isPurchased`.

Enviar `true` duas vezes deixa o produto em `true`; enviar `false` duas vezes deixa em `false`. Essa propriedade é chamada **idempotência quanto ao estado**. É útil quando um cliente repete o pedido depois de uma falha de rede: repetir não inverte o estado. O `updatedAt` pode mudar em cada escrita, portanto as respostas completas não precisam ser idênticas.

O campo omitido no PATCH preserva o valor. Valores como `"true"`, `1` ou `null` recebem 400; a API aceita somente booleanos. O campo não é aceito no cadastro nesta etapa: a criação sempre começa com `false`. Um produto de outra conta continua inacessível e retorna 404.

## Como funciona

1. O controller valida o corpo com o schema Zod de edição. `z.boolean()` aceita apenas `true` ou `false`; `.partial()` permite omitir o campo em outras edições.
2. O service encaminha o usuário e os dados validados ao repository.
3. O repository inclui `isPurchased` na atualização somente quando ele não é `undefined`. Isso é diferente de `if (input.isPurchased)`: como `false` é um valor falsy, essa condição impediria desmarcar o produto.
4. A escrita mantém o filtro pelo dono da wishlist. O Prisma devolve o produto atualizado e `toView` continua formatando o preço, sem alterar o boolean.
5. Ao mover, E1.2 atualiza apenas o vínculo da wishlist no mesmo registro. Por isso, o estado de comprado permanece.

## Migração dos produtos antigos

O modelo Prisma usa `Boolean @default(false)` e a migração adiciona `is_purchased BOOLEAN NOT NULL DEFAULT false` ao PostgreSQL. Produtos existentes passam a ter `false`, pois não havia informação anterior sobre compra; nenhum produto é presumido comprado. Os demais campos são preservados.

O teste de migração cria o esquema antigo e um produto em um schema PostgreSQL isolado, executa o SQL novo e compara os campos antes/depois. A transação de teste termina em rollback para não deixar fixtures no banco. O `db:deploy` aplicou a migração separadamente ao banco local de desenvolvimento.

## O que ler

1. [schema.prisma](../../../prisma/schema.prisma) e [migration.sql](../../../prisma/migrations/20261118020000_product_purchased/migration.sql): tipo e valor inicial no banco.
2. `updateSavedProductSchema` em [saved-products.schema.ts](../../../src/modules/products/saved-products.schema.ts): validação e inferência dos tipos.
3. `updateOwned` em [saved-products.repository.ts](../../../src/modules/products/saved-products.repository.ts): diferença entre `false` e campo omitido, mais filtro de propriedade.
4. [Teste HTTP](../../../tests/product-purchased.integration.test.ts): marcar, repetir, consultar, mover e desmarcar.
5. [Teste da migração](../../../tests/product-purchased-migration.test.ts): dados antigos preservados e valor inicial.

## Como testar

Com PostgreSQL local configurado:

```powershell
npm run db:deploy
npm run db:generate
node --env-file=.env --import tsx --test tests/product-purchased-migration.test.ts tests/product-purchased.integration.test.ts
npm run typecheck
npm run build
npm test
```

Nesta entrega: teste da migração sobre dados antigos passou antes da aplicação local; `db:deploy`, typecheck e build passaram; a suíte completa passou com **74/74 testes**. O teste HTTP também verifica acesso de outra conta, entrada inválida e estado após movimentação.

Para testar manualmente, crie um produto, confira `isPurchased: false`, marque com o PATCH acima e consulte novamente. Repita o PATCH com `true`, mova o produto para outra lista própria e confira que permanece marcado. Depois envie `false` e consulte de novo.

## Pendências

- E4.1 foi validado pelo usuário para commit.
- Adaptar o frontend para mostrar e alterar o estado e validar o fluxo integrado. E1.1, E1.2, E2 e E3 também seguem pendentes no frontend.
- E4.2 (totais), E4.3 (escolha do câmbio) e E4.4 (conversão) não foram implementados. Na próxima etapa, definir como apresentar produtos sem preço ou moeda, sem tratá-los como zero.
