# Listed Backend

API do MVP do Listed. Este repositório contém apenas o backend; o documento-base do produto está no projeto `listed`.

**Etapa atual:** 1 de 6 — fundação e banco. As rotas de autenticação, wishlists, extração e produtos serão implementadas após revisão desta etapa.

## O que esta etapa entrega

- Express 5 com prefixo de API `/api/v1`, respostas JSON e tratamento central de erros.
- Configuração de ambiente validada na inicialização.
- PostgreSQL local via Docker Compose, com volume e healthcheck.
- Prisma ORM 7.10.1 com modelos iniciais e migração versionada.
- `GET /api/v1/health` para verificar que o processo HTTP responde.
- `GET /api/v1/ready` para verificar também a conexão com o banco.
- Build TypeScript para JavaScript executável com Node.

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
npm run build
$env:DATABASE_URL = "postgresql://listed:listed_dev@localhost:5433/listed?schema=public"
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
src/shared/http/           erro HTTP e tradução para resposta JSON
src/generated/prisma/      cliente gerado; não editar nem versionar
```

Em uma requisição, o Express escolhe a rota em `app.ts`. A rota de prontidão usa o cliente em `db/prisma.ts` para consultar o PostgreSQL. Se ocorrer erro, o middleware em `shared/http/error-handler.ts` transforma erros conhecidos em respostas estáveis e evita expor detalhes internos no erro 500.

Nas próximas etapas, cada função de negócio ficará em `src/modules/<domínio>/` com este fluxo:

```text
routes → controller → service → repository → Prisma
```

`routes` define URL e middlewares; `controller` valida HTTP e forma a resposta; `service` aplica regras de negócio; `repository` concentra consultas ao banco. Se uma camada não tiver responsabilidade real, ela não será criada só para completar o desenho.

## Política de tipos e Zod

Esta é uma regra de implementação para evitar tipos duplicados ou inferência espalhada entre módulos:

1. O schema Zod define o formato de entrada HTTP. O controller faz `parse` **uma vez**, na fronteira da API.
2. Tipos de entrada são derivados com `z.output<typeof schema>` quando o schema usa transformação ou coerção. O service recebe valores já validados e não recebe `Request` do Express.
3. Contratos entre módulos recebem nomes explícitos e pequenos quando têm significado de negócio. Não exportamos o schema de uma rota como tipo público de outro módulo.
4. Tipos gerados pelo Prisma ficam no repository e nos mapeadores. O service recebe e devolve objetos de domínio ou DTOs claros, sem propagar tipos complexos de consultas Prisma.
5. Evitamos `any`, assertions desnecessárias e cópias manuais de tipos que Zod ou Prisma já descrevem. Se houver uma conversão, ela será uma função nomeada e testável.

Nesta etapa, `env.ts` demonstra o primeiro limite: Zod valida `process.env`, e o restante da aplicação usa `Env` já validado. Os schemas HTTP dos módulos serão adicionados com os respectivos módulos.

## Modelos do banco

| Modelo | Finalidade | Relações e observações |
| --- | --- | --- |
| `User` | Conta, e-mail, nome e hash da senha | O e-mail será normalizado no serviço de cadastro antes de gravar. |
| `RefreshSession` | Sessão de renovação revogável | Guarda **hash** do token, expiração e revogação. O token bruto só existirá no cookie na etapa 2. |
| `Wishlist` | Lista privada de um usuário | Exclusão em cascata de seus produtos. |
| `SavedProduct` | Produto revisado e salvo | Nome, URL e wishlist obrigatórios. Imagem, preço, moeda e loja opcionais. Links duplicados são permitidos. |

`price` usa `Decimal(12,2)` no PostgreSQL. A futura API representará preços como strings decimais, evitando perda de precisão em números JavaScript. `currency` guardará o código da moeda identificado. O esquema não cria uma entidade para extração, porque a tentativa de extrair dados não precisa ser persistida no MVP.

## Convenções operacionais

- `.env` é local e ignorado pelo Git; `.env.example` documenta apenas valores de desenvolvimento.
- O banco local escuta só em `127.0.0.1:5433`; dentro do contêiner usa a porta 5432.
- Em produção, usar HTTPS, segredo e credenciais próprios, backups do PostgreSQL e `npm run db:deploy` antes de iniciar uma nova versão da API.
- `POST`, `PATCH` e `DELETE` de domínio ainda não existem nesta etapa. Respostas de erro têm formato `{ "error": { "code": "...", "message": "..." } }`.

## Verificação desta etapa

- `prisma generate`: passou com Prisma 7.10.1.
- `prisma migrate dev --name init`: criou e aplicou `20261108040512_init` no PostgreSQL local.
- `tsc --noEmit` e `npm run build`: passaram.
- API compilada executada em Node 26.13.0 (contêiner temporário): `/api/v1/health` e `/api/v1/ready` retornaram `{ "status": "ok" }`.
- `npm run dev` com `tsx watch`: iniciou e as duas rotas também retornaram `{ "status": "ok" }` no host local.

O computador tem Node 24.20.0 instalado; a execução em Node 26 foi validada em contêiner. A criação do repositório GitHub ficará a cargo do proprietário do projeto após esta etapa.

## Fontes técnicas

- Node e TypeScript: https://nodejs.org/api/typescript.html
- Prisma 7, instalação e adapter PostgreSQL: https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction
- Estado das versões Prisma: https://www.prisma.io/docs/orm/release-status
