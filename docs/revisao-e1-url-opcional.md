# Revisão E1.1 — Produto manual sem URL

**Data:** 18/11/2026. **Estado:** backend implementado, verificado e validado pelo usuário para commit. Migração aplicada ao PostgreSQL local. Frontend ainda não adaptado. E1.2 (movimentação) não foi iniciado.

## 1. Objetivo e o que foi implementado

Agora é possível cadastrar um produto apenas com `name`, dentro de uma wishlist própria identificada por `wishlistId`. URL, imagem, preço, moeda e loja podem ficar ausentes. Os endpoints e as permissões são os mesmos da [etapa 5](revisao-produtos-salvos.md); esta revisão descreve somente a mudança de URL obrigatória para opcional.

| Arquivo | Alteração |
| --- | --- |
| [prisma/schema.prisma](../prisma/schema.prisma) | `SavedProduct.url` passou de `String` para `String?`. |
| [migration.sql](../prisma/migrations/20261118000000_saved_product_url_optional/migration.sql) | Retira a restrição `NOT NULL` da coluna existente. |
| [saved-products.schema.ts](../src/modules/products/saved-products.schema.ts) | Aceita URL omitida ou null; valida o endereço quando informado. |
| [saved-products.repository.ts](../src/modules/products/saved-products.repository.ts) | Converte ausência em null na criação. O PATCH já preservava campos omitidos. |
| [saved-products.integration.test.ts](../tests/saved-products.integration.test.ts) | Exercita cadastro sem URL, edição, limpeza, persistência, erros e acesso entre contas. |
| [saved-products-url-migration.test.ts](../tests/saved-products-url-migration.test.ts) | Aplica as migrações sobre um produto antigo e verifica preservação dos dados. |

Controller, service e scraper não precisaram de uma nova implementação. Os tipos de entrada continuam inferidos pelo Zod e o tipo de resposta acompanha o modelo gerado pelo Prisma; não adicionamos outra definição de produto para manter manualmente.

## 2. Comportamento e fluxo

As rotas abaixo continuam sob `/api/v1` e exigem `Authorization: Bearer <accessToken>`.

Criação com o mínimo necessário, em `POST /products`:

```json
{
  "wishlistId": "b2e3ba34-b9c1-4f46-99bc-705c79e10225",
  "name": "Presente de aniversário"
}
```

A resposta continua sendo `201` com `{ "product": ... }`. O produto contém os IDs e datas habituais, `name: "Presente de aniversário"` e `url`, `imageUrl`, `price`, `currency`, `storeName` como `null`.

| Entrada referente a `url` | Criação | Edição por PATCH |
| --- | --- | --- |
| Campo omitido | Salva null. | Preserva o valor atual. |
| `null` | Salva null. | Remove a URL atual. |
| URL HTTP/HTTPS válida | Salva o endereço. | Substitui o endereço. |
| `""`, espaços, número ou endereço inválido | 400, sem criar. | 400, sem alterar o produto. |

Exemplos de `PATCH /products/:id`:

```json
{ "name": "Novo nome, mantendo a URL atual" }
```

```json
{ "url": "https://loja.example/produto" }
```

```json
{ "url": null }
```

O fluxo real é:

1. A rota autentica o pedido; o controller recebe `userId` e valida o corpo pelo schema Zod.
2. O schema aceita a ausência ou null em `url`. Quando recebe texto, mantém trim, limite de 2048 caracteres e validação de HTTP/HTTPS.
3. O service chama o repository com os dados já validados e o usuário autenticado.
4. Na criação, `input.url ?? null` transforma uma propriedade ausente em null. Na edição, o `if (input.url !== undefined)` existente só inclui a coluna na escrita quando o pedido enviou o campo, inclusive quando enviou null.
5. O Prisma grava e lê a coluna anulável. A resposta inclui `url: null` quando não existe endereço. Listagem e consulta individual usam esse mesmo formato.

O vínculo com a wishlist continua obrigatório. Uma lista ausente ou de outra conta resulta em 404; consulta, edição e exclusão de produto alheio também retornam 404.

**Extração continua exigindo URL:** `POST /products/extract` não é o cadastro manual. Sem URL não há página para buscar. O schema dessa operação ficou intacto e pedidos com `{}`, `{ "url": null }` ou `{ "url": "" }` continuam recebendo 400.

## 3. Conceitos e decisões técnicas

### Ausência, undefined e null

JSON não possui o valor `undefined`. Quando o pedido não inclui uma propriedade, acessar essa propriedade em JavaScript produz `undefined`. Já `null` é um valor que o cliente pode enviar explicitamente.

Essa diferença é útil no PATCH: não mandar `url` significa “não mexa”; mandar `url: null` significa “limpe”. Na criação, ambos significam que o novo produto não terá URL.

No Zod, `.nullish()` aceita essas duas situações além do valor validado pelo schema original. O tipo inferido para a entrada passa a permitir `string | null | undefined`. No retorno persistido, a URL é `string | null`: o repository normaliza a ausência antes de gravar.

`??` significa usar o valor da direita somente quando o da esquerda é null ou undefined. Não é um mecanismo de validação: uma string vazia já é rejeitada pelo Zod antes de chegar ao repository. Optamos por manter esse erro, em vez de converter silenciosamente qualquer campo vazio. O frontend deverá transformar a intenção de limpar o campo em `null`.

### Por que há uma migração

Mudar TypeScript ou Zod não altera as regras do PostgreSQL. A coluna tinha `NOT NULL`, que faria o banco rejeitar a gravação sem URL mesmo que a API aceitasse o pedido. `String?` no modelo Prisma expressa a coluna anulável; a migração aplica a mudança ao banco:

```sql
ALTER TABLE "saved_products" ALTER COLUMN "url" DROP NOT NULL;
```

Não recriamos a tabela e não atualizamos o conteúdo dos produtos. O teste monta o esquema antigo, insere uma linha com URL, imagem, preço e moeda, aplica esse SQL e compara a linha inteira antes/depois. Depois confirma criação sem URL e limpeza da URL antiga.

O teste usa um schema PostgreSQL temporário dentro de uma transação. `search_path` direciona as migrações a esse espaço, e `ROLLBACK` desfaz suas tabelas e fixtures ao terminar. Isso permite exercitar a migração antiga sem resetar o banco de desenvolvimento.

O rollback da migração em produção não seria apenas restaurar `NOT NULL`: depois de cadastrar produtos sem URL, eles não satisfazem a restrição antiga. Seria necessário decidir como tratar esses dados antes de voltar. Nesta entrega só aplicamos a migração local, sem reset ou exclusão de registros.

## 4. O que ler, em ordem

1. `SavedProduct` no [modelo Prisma](../prisma/schema.prisma) e o [SQL da migração](../prisma/migrations/20261118000000_saved_product_url_optional/migration.sql): regra do banco.
2. `productFields.url` no [schema](../src/modules/products/saved-products.schema.ts): contrato recebido pela API e tipo inferido pelo Zod.
3. `createInOwnedWishlist` e `updateOwned` no [repository](../src/modules/products/saved-products.repository.ts): conversão de ausência e diferença entre criar/editar.
4. Trecho E1.1 no [teste HTTP](../tests/saved-products.integration.test.ts): exemplos de pedidos e resultados, incluindo requisições feitas por outra conta.
5. [Teste de migração](../tests/saved-products-url-migration.test.ts): preservação de produto antigo e isolamento das tabelas de teste.

O controller e o service continuam seguindo o fluxo explicado na revisão da etapa 5. Não é preciso reaprender o módulo inteiro para acompanhar esta mudança.

## 5. Como testar e resultados

Na raiz do backend, com Docker e dependências instaladas:

```powershell
docker compose up -d --wait postgres
npm run db:deploy
npm run db:generate
node --env-file=.env --import tsx --test tests/saved-products.integration.test.ts tests/saved-products-url-migration.test.ts
npm run typecheck
npm run build
npm test
```

Verificações executadas em 18/11/2026:

- Teste da migração sobre dados existentes: passou antes da aplicação ao banco local.
- `db:deploy`: aplicou `20261118000000_saved_product_url_optional` ao PostgreSQL local.
- Typecheck e build da árvore local: passaram.
- Suíte local: **67/68 passaram**. O CRUD e a migração passaram; falhou o teste preexistente de cancelamento DNS.
- Cópia de validação de `94194ba` mais os seis arquivos de implementação/teste de E1.1, em `artifacts/e1-url-validation/`: **68/68 testes**, typecheck e build passaram. Essa cópia exclui as alterações locais preexistentes de scraping, sem editar seus arquivos originais.

A falha local vem de `console.log(await lookupResult)` antes de `Promise.race` em `network/url-policy.ts`: a espera pelo DNS acontece antes de iniciar a corrida com o cancelamento. Não alteramos esse debug neste checkpoint nem declaramos que a suíte da árvore local está inteiramente verde. Os registros locais de teste ficam em `artifacts/e1-local-tests.log` e `artifacts/e1-url-validation/validation-tests.log`.

Roteiro pela API, usando uma conta de desenvolvimento e uma lista própria:

1. Envie apenas `wishlistId` e `name` no POST. Confira 201 e `url: null`.
2. Consulte o produto e a lista em novas requisições. Confira que o produto permaneceu salvo sem URL.
3. Adicione uma URL válida por PATCH. Depois altere só o nome: a URL deve permanecer.
4. Envie `url: null`. Consulte novamente e confira a remoção persistida.
5. Tente `url: ""` ou FTP: espere 400 e os dados anteriores intactos.
6. Tente consultar ou editar esse produto com outra conta: espere 404.
7. Chame a extração sem URL: espere 400.

## 6. Pendências e limites

- Commit do backend aprovado pelo usuário; a integração com o frontend permanece pendente.
- Adaptar o frontend após a revisão do contrato: `products.schemas.ts` ainda exige URL na resposta e no formulário; `ProductActions.vue` ainda exibe o link. Um produto sem URL pode fazer o cliente atual rejeitar a resposta da lista. Não considerar a funcionalidade integrada concluída antes dessa adaptação e validação.
- Preservar e revisar separadamente o debug de DNS, que continua afetando a suíte local.
- E1.2 (movimentação) permanece planejado, sem rota, transação ou interface implementada aqui.
