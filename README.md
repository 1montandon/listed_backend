# Listed Backend

API do MVP do Listed. Este repositório contém apenas o backend; o documento-base do produto está no projeto `listed`.

**Etapa atual:** 2 de 6 — autenticação e perfil. Wishlists, extração e produtos serão implementados nas próximas etapas.

## O que já foi entregue

- Express 5 com prefixo de API `/api/v1`, respostas JSON e tratamento central de erros.
- Configuração de ambiente validada na inicialização.
- PostgreSQL local via Docker Compose, com volume e healthcheck.
- Prisma ORM 7.10.1 com modelos iniciais e migração versionada.
- `GET /api/v1/health` para verificar que o processo HTTP responde.
- `GET /api/v1/ready` para verificar também a conexão com o banco.
- Build TypeScript para JavaScript executável com Node.
- Cadastro, login, renovação de sessão, logout e consulta/edição do próprio perfil.
- `tsconfig.json` comentado opção por opção para facilitar o estudo.

O Prisma 7 foi escolhido por ser a versão estável da linha atual; o Prisma 8 ainda é release candidate em 08/11/2026. `prisma` e `@prisma/client` estão fixados em `7.10.1`, pois `npm install prisma` sem versão pode instalar a linha 8. O Prisma 7 com PostgreSQL usa o driver adapter `@prisma/adapter-pg`.

## Pré-requisitos e início local

- Node.js 26 e npm.
- Docker com Docker Compose.

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d
npm run db:generate
npm run db:deploy
npm run dev
```

A migração inicial já está versionada. Em uma cópia nova do projeto, `db:deploy` aplica migrações existentes; `db:migrate` fica para criar a próxima migração durante o desenvolvimento.

Abra `http://localhost:3333/api/v1/health` e `http://localhost:3333/api/v1/ready`. A primeira rota retorna `{ "status": "ok" }` se a API responder. A segunda retorna a mesma resposta quando o PostgreSQL também estiver acessível.

Para conferir tipos e build:

```powershell
npm run typecheck
npm test
npm run build
$env:DATABASE_URL = "postgresql://listed:listed_dev@localhost:5433/listed?schema=public"
$env:FRONTEND_ORIGIN = "http://localhost:5173"
$env:JWT_SECRET = "um-segredo-aleatorio-com-pelo-menos-32-caracteres"
npm start
```

O `dev` usa `tsx watch` e reinicia a API após alterações. O `build` gera o cliente Prisma e compila o TypeScript em `dist/`. O `start` executa JavaScript compilado, sem `tsx` em produção, e recebe as variáveis de ambiente do processo. O Node 26 executa TypeScript com remoção de tipos, mas isso não substitui a checagem de `tsc` nem considera todas as opções do `tsconfig`.

## Estrutura e fluxo

```text
prisma/schema.prisma       modelos e relações do banco
prisma/migrations/         histórico de mudanças do banco
prisma.config.ts           conexão usada pelos comandos Prisma
src/config/env.ts          valida e tipa variáveis de ambiente
src/db/prisma.ts           cria uma única instância do cliente Prisma
src/app.ts                 configura rotas e middlewares HTTP
src/server.ts              inicia e encerra o processo
tsconfig.json              escolhas de TypeScript comentadas no próprio arquivo
tsconfig.test.json         inclui os testes na checagem de tipos, sem incluí-los no build
src/shared/http/           erro HTTP e tradução para resposta JSON
src/shared/auth/           assinatura e verificação do access token
src/modules/auth/          cadastro, login e sessões refresh; auth.routes.ts monta as camadas
src/modules/users/         perfil; users.routes.ts monta as camadas
tests/                    fluxo HTTP de autenticação e perfil
src/generated/prisma/      cliente gerado; não editar nem versionar
```

Em uma requisição, o Express escolhe a rota em `app.ts`. A rota de prontidão usa o cliente em `db/prisma.ts` para consultar o PostgreSQL. Se ocorrer erro, o middleware em `shared/http/error-handler.ts` transforma erros conhecidos em respostas estáveis e evita expor detalhes internos no erro 500.

Os módulos de negócio seguem este fluxo:

```text
routes → controller → service → repository → Prisma
```

`routes` define URL e middlewares; `controller` valida HTTP e forma a resposta; `service` aplica regras de negócio; `repository` concentra consultas ao banco. Se uma camada não tiver responsabilidade real, ela não será criada só para completar o desenho.

### Classes e instâncias compartilhadas

Cada `*.routes.ts` cria o router e monta **uma** instância de repository, service e controller, passando dependências pelo construtor. `app.ts` importa os routers já montados:

```text
app.ts
  ├─ auth.routes.ts → AuthRepository → AuthService → AuthController → authRouter
  └─ users.routes.ts → UsersRepository → UsersService → UsersController → usersRouter
```

A classe, sozinha, **não garante singleton**: chamar `new AuthService(...)` outra vez criaria outra instância. O compartilhamento vem do cache de módulos ES do Node: o código no topo de cada `*.routes.ts` roda uma vez por processo e todas as requisições usam os objetos criados ali. Se no futuro houver vários processos ou réplicas, cada um terá suas próprias instâncias; o estado compartilhado de sessões continua no PostgreSQL. As dependências das classes permanecem visíveis nos construtores.

`auth.tokens.ts` mantém funções para hash, geração de tokens e cálculo de expiração. `access-token.ts` também exporta funções, com a chave do JWT carregada uma vez pelo módulo ES. Seus comentários explicam o `jose`, as claims e a verificação da assinatura.

## Política de tipos e Zod

Esta é uma regra de implementação para evitar tipos duplicados ou inferência espalhada entre módulos:

1. O schema Zod define o formato de entrada HTTP. O controller faz `parse` **uma vez**, na fronteira da API.
2. Tipos de entrada são derivados com `z.output<typeof schema>` quando o schema usa transformação ou coerção. O service recebe valores já validados e não recebe `Request` do Express.
3. Contratos entre módulos recebem nomes explícitos e pequenos quando têm significado de negócio. Não exportamos o schema de uma rota como tipo público de outro módulo.
4. Tipos gerados pelo Prisma ficam no repository e nos mapeadores. O service recebe e devolve objetos de domínio ou DTOs claros, sem propagar tipos complexos de consultas Prisma.
5. Evitamos `any`, assertions desnecessárias e cópias manuais de tipos que Zod ou Prisma já descrevem. Se houver uma conversão, ela será uma função nomeada e testável.

Em `auth` e `users`, o controller recebe `request.body` como `unknown`, chama o schema Zod uma vez e entrega o resultado tipado ao service. O repository devolve `AuthUserRecord` ou `UserProfile`, ambos pequenos e explícitos. O campo `passwordHash` é removido pela função `toPublicUser` antes de formar a resposta. `withUser` entrega `userId` como argumento ao controller, sem alterar globalmente os tipos do Express. Os comentários em `tsconfig.json` explicam as escolhas de compilação.

## Modelos do banco

| Modelo | Finalidade | Relações e observações |
| --- | --- | --- |
| `User` | Conta, e-mail, nome e hash da senha | O schema Zod remove espaços e normaliza o e-mail para minúsculas antes de gravar. |
| `RefreshSession` | Sessão de renovação revogável | Guarda **hash** do token, expiração e revogação. O token bruto só é enviado em cookie `HttpOnly`. |
| `Wishlist` | Lista privada de um usuário | Exclusão em cascata de seus produtos. |
| `SavedProduct` | Produto revisado e salvo | Nome, URL e wishlist obrigatórios. Imagem, preço, moeda e loja opcionais. Links duplicados são permitidos. |

`price` usa `Decimal(12,2)` no PostgreSQL. A futura API representará preços como strings decimais, evitando perda de precisão em números JavaScript. `currency` guardará o código da moeda identificado. O esquema não cria uma entidade para extração, porque a tentativa de extrair dados não precisa ser persistida no MVP.

## Convenções operacionais

- `.env` é local e ignorado pelo Git; `.env.example` documenta apenas valores de desenvolvimento.
- O banco local escuta só em `127.0.0.1:5433`; dentro do contêiner usa a porta 5432.
- Em produção, usar HTTPS, segredo e credenciais próprios, backups do PostgreSQL e `npm run db:deploy` antes de iniciar uma nova versão da API.
- Respostas de erro têm formato `{ "error": { "code": "...", "message": "..." } }`.

## Autenticação: decisões e fluxo

1. Cadastro e login validam a entrada com Zod. O e-mail é normalizado para minúsculas. A senha é armazenada com **Argon2id** (19 MiB, duas passagens, paralelismo 1); a senha original não vai para o banco.
2. O servidor responde com um **JWT de acesso** válido por 15 minutos. O frontend envia esse token no cabeçalho `Authorization: Bearer ...` e deve mantê-lo apenas em memória.
3. O servidor também cria um **refresh token aleatório** de 32 bytes. O navegador o recebe em cookie `HttpOnly`, `SameSite=Lax`, restrito ao caminho `/api/v1/auth`; `Secure` é ativado em produção. O banco guarda apenas SHA-256 do token aleatório, com validade de 30 dias.
4. `POST /auth/refresh` usa o cookie, revoga a sessão anterior e cria outra na mesma transação. Uma segunda tentativa de usar o token anterior recebe 401. `POST /auth/logout` revoga a sessão e remove o cookie.
5. As rotas que recebem ou alteram o cookie exigem `Origin` igual a `FRONTEND_ORIGIN`. O frontend deve chamar essas rotas com `credentials: "include"`. CORS aceita somente essa origem configurada.

O access token já emitido continua válido até expirar, mesmo após o logout; a revogação imediata vale para o refresh token. O frontend deve apagar o access token da memória ao sair. A recuperação de senha e o limite de tentativas entrarão antes da abertura para usuários reais, na etapa 6.

`SameSite=Lax` pressupõe frontend e API no mesmo *site* (podem estar em portas ou subdomínios diferentes). Quando os domínios de produção forem definidos, revisar cookie e CORS. A API de produção precisa de HTTPS e de `JWT_SECRET` aleatório, diferente do exemplo local.

## Rotas da etapa 2

O prefixo de todas as rotas abaixo é `/api/v1`. `POST /auth/*` exige o cabeçalho `Origin: http://localhost:5173` no ambiente local.

| Método e rota | Entrada | Resposta principal |
| --- | --- | --- |
| `POST /auth/register` | `{ "name": "Ana", "email": "ana@example.com", "password": "senha-com-12-ou-mais" }` | 201, usuário e access token; define cookie refresh. |
| `POST /auth/login` | `{ "email": "ana@example.com", "password": "..." }` | 200, usuário e access token; define cookie refresh. |
| `POST /auth/refresh` | Cookie refresh | 200, novo access token e novo cookie refresh. |
| `POST /auth/logout` | Cookie refresh, se houver | 204; revoga sessão e remove cookie. |
| `GET /me` | `Authorization: Bearer <accessToken>` | Dados da própria conta. |
| `PATCH /me` | Bearer e `{ "name": "Novo nome" }` | Dados atualizados da própria conta. |

As respostas de cadastro, login e refresh têm este formato, além do cabeçalho `Set-Cookie`:

```json
{
  "user": { "id": "uuid", "name": "Ana", "email": "ana@example.com" },
  "accessToken": "jwt",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

O refresh token nunca aparece nesse JSON. Erros comuns: 400 para dados inválidos, 401 para credenciais/token inválidos, 403 para `Origin` não permitido e 409 para e-mail já cadastrado.

## Verificações

- `prisma generate`: passou com Prisma 7.10.1.
- `prisma migrate dev --name init`: criou e aplicou `20261108040512_init` no PostgreSQL local.
- `tsc --noEmit` e `npm run build`: passaram.
- API compilada executada em Node 26.13.0 (contêiner temporário): `/api/v1/health` e `/api/v1/ready` retornaram `{ "status": "ok" }`.
- `npm run dev` com `tsx watch`: iniciou e as duas rotas também retornaram `{ "status": "ok" }` no host local.

O computador tem Node 24.20.0 instalado; a execução em Node 26 foi validada em contêiner. O repositório GitHub `1montandon/listed_backend` já está conectado como `origin`.

**Etapa 2:** `npm run typecheck` verificou código e teste; `npm test` cobriu cadastro, e-mail duplicado, senha incorreta, perfil, edição, rotação de refresh token (inclusive duas tentativas concorrentes), logout, acesso sem JWT e chamada sem `Origin`. O teste cria uma conta temporária e a remove ao terminar.

Também executei `npm ci`, `npm run build`, `npm run typecheck` e `npm test` em um contêiner **Node 26.13.0**; todos passaram. `npm test` usa o banco apontado pelo `.env`, portanto mantenha esse arquivo apontando para um banco de desenvolvimento ao rodá-lo.
A API compilada em Node 26 também retornou HTTP 200 em `/health` e `/ready`.

## Fontes técnicas

- Node e TypeScript: https://nodejs.org/api/typescript.html
- Prisma 7, instalação e adapter PostgreSQL: https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction
- Estado das versões Prisma: https://www.prisma.io/docs/orm/release-status
- Armazenamento de senha: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Gerenciamento de sessões: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet
- Cookies `HttpOnly`, `Secure` e `SameSite`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie
