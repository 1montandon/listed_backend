# Revisão da etapa 3 — Wishlists

## O que foi implementado

Criação, listagem, consulta, renomeação e exclusão de wishlists privadas. O módulo inclui schema, controller, service e repository, ligados pelo router. A suíte inclui um teste de integração com duas contas. [Módulo](../../src/modules/wishlists) · [Teste](../../tests/wishlists.integration.test.ts)

## Como funciona

As rotas usam o prefixo `/api/v1` e exigem Bearer. O controller valida UUID e nome. O repository usa o `userId` autenticado para filtrar cada leitura ou escrita. A resposta tem `id`, `name`, `productCount`, `createdAt` e `updatedAt`.

| Rota | Entrada | Resultado |
| --- | --- | --- |
| `POST /wishlists` | `{ "name": "Presentes" }` | 201 com `{ "wishlist": ... }`. |
| `GET /wishlists` | — | 200 com `{ "wishlists": [...] }`, da mais recente para a mais antiga. |
| `GET /wishlists/:id` | UUID | 200 com `{ "wishlist": ... }`. |
| `PATCH /wishlists/:id` | UUID e novo `name` | 200 com a lista atualizada. |
| `DELETE /wishlists/:id` | UUID | 204. |

O nome deve ter de 1 a 120 caracteres depois de remover espaços nas pontas. Entrada inválida recebe 400. Uma lista ausente ou de outra conta recebe 404.

## Decisões técnicas

- Consultas e mutações verificam a propriedade junto da operação. Assim, saber o UUID da lista é insuficiente para acessá-la.
- `_count.products` calcula a contagem na consulta. A remoção dos itens vinculados usa a cascata definida no esquema do banco.

## O que ler

1. Compare as rotas com a validação de ID e nome. [wishlists.routes.ts](../../src/modules/wishlists/wishlists.routes.ts) · [wishlists.schema.ts](../../src/modules/wishlists/wishlists.schema.ts)
2. Veja como o service transforma ausência em 404 e como as consultas filtram o dono e calculam a contagem. [wishlists.service.ts](../../src/modules/wishlists/wishlists.service.ts) · [wishlists.repository.ts](../../src/modules/wishlists/wishlists.repository.ts)

## Como testar

Com o ambiente do [README](../../README.md#rodar-localmente) preparado, rode o teste de integração. Ele tenta acessar a lista de uma conta com o token da outra e confere a contagem e a exclusão em cascata.

```powershell
node --env-file=.env --import tsx --test tests/wishlists.integration.test.ts
```

## Pendências

A exclusão remove a lista e seus itens. A confirmação antes da chamada de exclusão fica no fluxo do frontend.
