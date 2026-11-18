# Revisão da etapa 5 — Produtos salvos

## O que foi implementado

A API salva dados revisados ou manuais, lista os produtos de uma wishlist e permite consultar, editar e remover cada item. As rotas foram ligadas em `app.ts` e `products.routes.ts`. A persistência usa os arquivos `saved-products.*.ts` e o modelo `SavedProduct` da migração inicial. [Rotas](../../src/modules/products/products.routes.ts) · [Teste](../../tests/saved-products.integration.test.ts)

## Como funciona

O frontend pode preencher o formulário com a prévia de `POST /api/v1/products/extract`. Depois de revisar os campos e escolher uma wishlist, envia o produto a `POST /api/v1/products`. Para cadastro manual, use o mesmo endpoint com `wishlistId`, `name` e `url`.

```json
{
  "wishlistId": "b2e3ba34-b9c1-4f46-99bc-705c79e10225",
  "name": "Camisa de linho",
  "url": "https://loja.example/produto",
  "imageUrl": "https://loja.example/camisa.jpg",
  "price": "279.90",
  "currency": "BRL",
  "storeName": "Loja Exemplo"
}
```

As rotas abaixo usam o prefixo `/api/v1` e exigem Bearer.

| Rota | Resultado |
| --- | --- |
| `POST /products` | 201 com `{ "product": ... }`. |
| `GET /wishlists/:id/products` | 200 com `{ "products": [...] }`, do mais recente para o mais antigo. |
| `GET /products/:id` | 200 com `{ "product": ... }`. |
| `PATCH /products/:id` | 200 com o produto atualizado. |
| `DELETE /products/:id` | 204. |

A resposta inclui `id`, `wishlistId`, `createdAt` e `updatedAt`. Imagem, preço, moeda e loja são opcionais. Campos opcionais ausentes retornam `null`. O `PATCH` preserva campos omitidos e aceita `null` para limpar um opcional, como `price`. O vínculo com a wishlist é definido na criação. Entrada inválida recebe 400. Recursos ausentes ou de outra conta recebem 404, com `WISHLIST_NOT_FOUND` ou `PRODUCT_NOT_FOUND`.

## Decisões técnicas

- O `connect` do Prisma vincula a wishlist usando o UUID e o ID do dono. Edição e exclusão incluem a propriedade na própria escrita. [Referência do Prisma](https://www.prisma.io/docs/orm/reference/prisma-client-reference#filter-on-non-unique-fields-with-userwhereuniqueinput)
- O schema aceita preço como string decimal não negativa, com até dez dígitos inteiros e duas casas. O repository devolve duas casas, por exemplo `"279.90"`, sem converter o decimal para `number`. A moeda aceita três letras e é convertida para maiúsculas.
- O salvamento usa os campos que o usuário revisou. Assim, ele funciona mesmo quando a loja bloqueia a extração.

## O que ler

1. Comece pelo schema para ver os campos obrigatórios e a diferença entre omissão e `null` no `PATCH`. [saved-products.schema.ts](../../src/modules/products/saved-products.schema.ts)
2. Siga do controller até o service. Veja de onde vem o `userId` e como a API escolhe os erros de recurso ausente. [saved-products.controller.ts](../../src/modules/products/saved-products.controller.ts) · [saved-products.service.ts](../../src/modules/products/saved-products.service.ts)
3. Acompanhe o filtro pelo dono, a relação com a wishlist e a serialização do preço. [saved-products.repository.ts](../../src/modules/products/saved-products.repository.ts)

## Como testar

Com o banco configurado conforme o [README](../../README.md#rodar-localmente), rode o teste com duas contas. Ele cobre dados mínimos, valores inválidos, URL duplicada, edição, exclusão e isolamento.

```powershell
node --env-file=.env --import tsx --test tests/saved-products.integration.test.ts
npm run typecheck
npm run build
```

Na entrega da etapa, o teste novo, o typecheck e o build passaram. A suíte chegou a 67/67 com as versões commitadas dos arquivos de autenticação e DNS, usando PostgreSQL 17 temporário.

Em 18/11/2026, antes do commit aprovado, build, typecheck e 67/67 testes passaram novamente com PostgreSQL 17 local. A validação usou uma cópia dos arquivos selecionados para o commit, criada pelo índice do Git em `artifacts/stage5-validation/`. Assim, as alterações locais de scraping, incluindo o debug que interfere no cancelamento DNS, não entraram no commit nem nessa validação. A cópia usa as dependências instaladas no projeto e gera seu próprio cliente Prisma.

## Pendências

Etapa validada pelo usuário em 18/11/2026, com aprovação explícita para commit e avanço. O próximo checkpoint autorizado é E1.1 (URL opcional); o contrato descrito nesta revisão é o da etapa 5, ainda com URL obrigatória. As novas entregas terão revisões próprias. [Plano](../../PLAN.md)
