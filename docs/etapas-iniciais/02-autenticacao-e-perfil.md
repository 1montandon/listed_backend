# Revisão da etapa 2 — Autenticação e perfil

## O que foi implementado

Cadastro, login, renovação, logout e consulta e edição do próprio perfil. As rotas de sessão ficam em `auth` e as de perfil em `users`. [Rotas de sessão](../../src/modules/auth/auth.routes.ts) · [Rotas de perfil](../../src/modules/users/users.routes.ts)

## Como funciona

O cadastro normaliza o e-mail e armazena o hash Argon2id da senha. Cadastro e login devolvem um JWT de acesso que dura 15 minutos. O frontend envia esse JWT como Bearer e `withUser` verifica o token antes de passar o ID autenticado ao controller.

O refresh token é aleatório e chega ao navegador no cookie `listed_refresh`, com `HttpOnly`, `SameSite=Lax`, caminho `/api/v1/auth` e `Secure` em produção. O servidor guarda o hash e o prazo da sessão de 30 dias. Renovar revoga a sessão anterior e cria outra na mesma transação. Logout revoga a sessão refresh e limpa o cookie. O JWT de acesso emitido anteriormente continua válido até expirar.

As rotas usam `/api/v1`. Cadastro, login, refresh e logout conferem `Origin` contra `FRONTEND_ORIGIN`. No navegador, envie as requisições que usam o cookie com `credentials: "include"`.

| Rota | Entrada | Resultado |
| --- | --- | --- |
| `POST /auth/register` | `name`, `email`, `password` | 201 com usuário, JWT e cookie. |
| `POST /auth/login` | `email`, `password` | 200 com usuário, JWT e cookie. |
| `POST /auth/refresh` | Cookie refresh | 200 com usuário, novo JWT e novo cookie. |
| `POST /auth/logout` | Cookie refresh, se houver | 204. |
| `GET /me` | Bearer | 200 com o próprio perfil. |
| `PATCH /me` | Bearer e `{ "name": "Novo nome" }` | 200 com o perfil atualizado. |

O corpo de cadastro, login e refresh traz `user`, `accessToken`, `tokenType: "Bearer"` e `expiresIn: 900`. E-mail duplicado recebe 409, credenciais inválidas recebem 401 e origem recusada recebe 403.

## Decisões técnicas

- O JWT curto permite verificar as chamadas autenticadas com a assinatura e os prazos do token. A sessão refresh persistida permite revogar a credencial usada para renovar o acesso.
- A rotação usa uma transação e uma escrita condicionada à sessão ainda ativa. Isso evita que duas renovações consumam o mesmo token com sucesso.
- O cookie `HttpOnly` limita o acesso ao refresh pelo JavaScript da página. A checagem de origem protege as rotas que alteram o cookie.

## O que ler

1. Acompanhe quais rotas exigem a origem configurada e quando o controller grava o cookie. [auth.routes.ts](../../src/modules/auth/auth.routes.ts) · [auth.controller.ts](../../src/modules/auth/auth.controller.ts) · [auth.cookies.ts](../../src/modules/auth/auth.cookies.ts)
2. Compare hash de senha, hash do refresh e assinatura do JWT. [auth.tokens.ts](../../src/modules/auth/auth.tokens.ts) · [access-token.ts](../../src/shared/auth/access-token.ts)
3. Siga login e rotação até a transação. Depois veja como o ID autenticado chega à rota de perfil. [auth.service.ts](../../src/modules/auth/auth.service.ts) · [auth.repository.ts](../../src/modules/auth/auth.repository.ts) · [with-user.ts](../../src/shared/http/with-user.ts)

## Como testar

Com o ambiente do [README](../../README.md#rodar-localmente) preparado, rode o teste que cria uma conta temporária e exercita perfil, rotação, reutilização do token antigo, origem ausente e logout.

```powershell
node --env-file=.env --import tsx --test tests/auth.integration.test.ts
```

## Pendências

A etapa 6 cobre recuperação de senha, limites de tentativas e revisão de cookies e CORS para os domínios reais. [Plano](../../PLAN.md)
