# Revisão E1.2 — Mover produto entre listas

**Estado:** backend implementado e verificado; validado pelo usuário e aprovado para commit. A integração no frontend permanece pendente.

## O que foi implementado

Uma operação autenticada altera a wishlist de um produto existente. O produto continua sendo o mesmo: preserva seu ID, `createdAt` e os demais campos; `wishlistId` muda para a lista de destino e `updatedAt` registra a atualização. Nenhuma migração é necessária.

A decisão anterior de excluir e recriar o produto foi substituída pela atualização do vínculo, conforme sua revisão. Isso também preserva futuras referências associadas à identidade do produto.

Arquivos: [rota](../../../src/modules/products/products.routes.ts), [schema](../../../src/modules/products/saved-products.schema.ts), [controller](../../../src/modules/products/saved-products.controller.ts), [service](../../../src/modules/products/saved-products.service.ts), [repository](../../../src/modules/products/saved-products.repository.ts) e [teste de integração](../../../tests/saved-products-move.integration.test.ts).

## Contrato

Com `Authorization: Bearer <accessToken>`, envie `POST /api/v1/products/:id/move`:

```json
{ "destinationWishlistId": "b2e3ba34-b9c1-4f46-99bc-705c79e10225" }
```

O ID na URL identifica o produto. O ID no corpo identifica a lista de destino. A resposta de sucesso é **200**, com `{ "product": ... }` contendo o produto atualizado, com o mesmo ID.

| Situação | Resposta |
| --- | --- |
| Corpo ou IDs inválidos | 400 `VALIDATION_ERROR` |
| Destino igual à lista atual | 400 `SAME_WISHLIST` |
| Produto ausente ou alheio | 404 `PRODUCT_NOT_FOUND` |
| Destino ausente ou alheio | 404 `WISHLIST_NOT_FOUND` |
| Produto ou destino mudou durante a operação | 409 `MOVE_CONFLICT` |
| Sem autenticação | 401 |

A operação é permitida somente entre listas do dono. O produto é verificado primeiro para não revelar detalhes de um produto alheio.

## Como funciona

1. A rota autentica a pessoa. O controller valida o ID e o corpo usando Zod e chama o service.
2. O service pede ao repository a movimentação e transforma resultados conhecidos em erros HTTP.
3. Dentro de `$transaction`, o repository busca o produto pertencente ao usuário, verifica se a lista de destino é diferente e se também pertence ao usuário.
4. O Prisma executa `update` no produto, conectando a lista de destino. O filtro da escrita inclui o ID, o dono e a lista de origem observada anteriormente. O `connect` também exige o dono no destino.
5. O banco confirma a transação ao concluir. Se houver uma falha, as operações da transação não são confirmadas. O service retorna o produto atualizado.

### Por que atualizar o vínculo funciona

`wishlistId` é uma chave estrangeira: a coluna da tabela `saved_products` aponta para a linha da wishlist à qual o produto pertence. Como cada produto pertence a uma única lista, mudar essa referência já faz com que ele apareça na lista de destino. Não precisamos copiar os outros campos. O Prisma atualiza `updatedAt`; `createdAt` não muda.

`$transaction` agrupa as consultas e a escrita no banco. A validação da propriedade na própria escrita continua necessária: conferir permissões antes e depois escrever apenas por ID deixaria espaço para mudanças entre a consulta e a escrita.

### Requisições simultâneas

Duas movimentações podem ler a mesma origem. O filtro `wishlistId: original.wishlistId` faz a escrita depender da origem observada: se outra solicitação já mudou o vínculo, a escrita não encontra mais aquela condição e retorna conflito. Se a segunda requisição começar após a primeira concluir e apontar para o mesmo destino, ela recebe `SAME_WISHLIST`. Em ambos os casos, não há cópia de produto. O teste envia duas requisições juntas e aceita 400 ou 409 para a que não realizou a alteração, conforme a ordem em que chegaram ao banco.

Se o destino desaparecer ou a condição da escrita deixar de valer após a leitura, erros conhecidos de relação/registro são tratados como 409. Esse código informa que o cliente deve atualizar os dados antes de tentar novamente. Uma falha inesperada retorna 500 pelo tratamento geral da API.

## Decisões e leitura

- Mantivemos `POST /products/:id/move` como uma ação específica; o PATCH genérico continua sem aceitar `wishlistId`.
- A resposta é 200 porque atualizamos o produto existente. `createdAt` e ID são preservados; `updatedAt` muda. A ordem da lista continua baseada em `createdAt`, portanto mover não torna o produto recém-criado.
- Leia schema e rota, depois `move` no controller e service e finalmente `moveOwned` no repository. Em seguida acompanhe os cenários no teste de integração.

## Como testar

Com o PostgreSQL e as migrações locais disponíveis:

```powershell
node --env-file=.env --import tsx --test tests/saved-products-move.integration.test.ts
npm run typecheck
npm run build
npm test
```

O teste HTTP cobre autenticação, IDs inválidos, origem e destino alheios ou inexistentes, mesma lista, dados e ID preservados, datas, contagens, persistência e pedidos simultâneos. Para testar manualmente, crie duas listas próprias e um produto; envie o POST para a segunda lista e consulte novamente o mesmo ID. Ele deve aparecer no destino e deixar de aparecer na origem. Repetir o pedido para o mesmo destino retorna 400.

Verificações executadas nesta revisão: typecheck e build passaram; a suíte completa passou com **69/69 testes**.

## Pendências

- E1.2 foi validado e aprovado para commit.
- Adaptar o frontend ao contrato e validar o fluxo completo; E1.1 no frontend também permanece pendente.
- Quando E4/E5 adicionarem comprado ou imagens, testar que a atualização do vínculo preserva esses dados e não aciona limpeza indevida.
