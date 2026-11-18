# Revisão da etapa 1 — Fundação e banco

## O que foi implementado

O projeto ganhou uma API Express, configuração tipada de ambiente, tratamento de erros HTTP e scripts de desenvolvimento e build. O Docker Compose fornece o PostgreSQL local com volume persistente e healthcheck. A migração inicial criou as tabelas de usuários, sessões, wishlists e produtos salvos. [Compose](../../compose.yaml) · [Migração inicial](../../prisma/migrations/20261108040512_init/migration.sql)

## Como funciona

O servidor lê o ambiente na inicialização. A aplicação configura o Express e compartilha o cliente Prisma. `GET /api/v1/health` verifica se o processo HTTP responde. `GET /api/v1/ready` também executa `SELECT 1` e retorna 503 quando a conexão com o PostgreSQL falha.

O schema descreve as relações entre as tabelas. A migração registra em SQL como construir esse esquema em um banco novo. Por exemplo, a chave estrangeira de um produto aponta para sua wishlist, e o PostgreSQL remove os produtos vinculados quando a lista é excluída.

## Decisões técnicas

- `db:deploy` aplica a migração existente. `db:migrate` é o comando para criar a próxima mudança de esquema durante o desenvolvimento.
- A validação do ambiente na inicialização ajuda a detectar variáveis ausentes antes de receber requisições. A conexão com o banco é verificada pela rota de prontidão.

## O que ler

1. Veja como Zod transforma e valida valores de ambiente, como a porta recebida em texto. [env.ts](../../src/config/env.ts)
2. Siga a inicialização até a criação das rotas de saúde e prontidão. [server.ts](../../src/server.ts) · [app.ts](../../src/app.ts)
3. Compare os modelos Prisma com as tabelas, índices e chaves estrangeiras criados pela migração. [schema.prisma](../../prisma/schema.prisma) · [migration.sql](../../prisma/migrations/20261108040512_init/migration.sql)

## Como testar

Use os passos de instalação e as chamadas de saúde e prontidão do [README](../../README.md#rodar-localmente). Com o banco disponível, confira a migração, os tipos e o build.

```powershell
npm run db:status
npm run typecheck
npm run build
```

## Pendências

A configuração local usa credenciais de desenvolvimento. O ambiente real precisa de variáveis próprias e de um procedimento de backup e migração, previstos na etapa 6. [Plano](../../PLAN.md)
