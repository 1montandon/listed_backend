# Listed Backend

API REST do Listed para contas, wishlists privadas e produtos. O usuário pode gerar uma prévia a partir de um link, revisar os campos e salvar o item na sua lista. O cadastro também aceita dados preenchidos à mão.

## Rodar localmente

Requisitos: Node.js 26, npm e Docker com Compose. Execute os comandos abaixo na raiz do repositório, em PowerShell.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d --wait postgres
npm run db:generate
npm run db:deploy
npm run browser:install
npm run dev
```

O PostgreSQL local fica em `127.0.0.1:5433`. `browser:install` baixa o Chromium usado pela extração e pelos testes de navegador. O arquivo [`.env.example`](.env.example) reúne as variáveis de desenvolvimento. Ajuste `FRONTEND_ORIGIN` se o frontend local usar outra URL.

Com a API na porta padrão, verifique o processo HTTP e a conexão com o banco.

```powershell
curl.exe http://localhost:3333/api/v1/health
curl.exe http://localhost:3333/api/v1/ready
```

## API

As rotas usam o prefixo `/api/v1`. As operações privadas usam `Authorization: Bearer <accessToken>`. Os exemplos de requisição e resposta estão nas revisões.

Erros HTTP conhecidos retornam `{ "error": { "code": "...", "message": "..." } }`. A resposta da prévia tem seu próprio `status`, que indica quantos dados a coleta conseguiu obter.

| Recurso | Rotas |
| --- | --- |
| Sessão | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` |
| Perfil | `GET /me`, `PATCH /me` |
| Wishlists | `POST /wishlists`, `GET /wishlists`, `GET/PATCH/DELETE /wishlists/:id` |
| Prévia de produto | `POST /products/extract` |
| Produtos salvos | `POST /products`, `GET /wishlists/:id/products`, `GET/PATCH/DELETE /products/:id` |
| Movimentação | `POST /products/:id/move` |

## Comandos

| Comando | Uso |
| --- | --- |
| `npm run dev` | Executa a API com recarga automática. |
| `npm run typecheck` | Verifica os tipos da aplicação, dos testes e dos scripts. |
| `npm test` | Executa a suíte. Use um banco local de desenvolvimento com as migrações aplicadas e o Chromium instalado. |
| `npm run build` | Gera o cliente Prisma e compila a API em `dist/`. |
| `npm start` | Executa a API compilada com as variáveis do processo. Para usar o `.env` local, rode `node --env-file=.env dist/server.js`. |
| `npm run db:deploy` | Aplica as migrações versionadas. |
| `npm run db:migrate` | Cria e aplica uma migração durante o desenvolvimento. |

## Documentação

- [Plano do backend](PLAN.md) — escopo, arquitetura, andamento e decisões pendentes.

### Etapas iniciais

- [Fundação e banco](docs/etapas-iniciais/01-fundacao-e-banco.md) — ambiente, modelo inicial e verificações da API.
- [Autenticação e perfil](docs/etapas-iniciais/02-autenticacao-e-perfil.md) — JWT, cookies e rotas de conta.
- [Wishlists](docs/etapas-iniciais/03-wishlists.md) — CRUD privado e contagem de produtos.
- [Extração de produto](docs/etapas-iniciais/04-extracao-de-produtos.md) — contrato, roteiro de estudo e diagnóstico de HTML e rede.
- [Produtos salvos](docs/etapas-iniciais/05-produtos-salvos.md) — cadastro, edição e permissões.

### Evolução do produto

- [Plano de evolução](docs/evolucao/plano.md) — etapas E1 a E8 e seus checkpoints.
- [E1.1 — Produto sem URL](docs/evolucao/etapa-01-produto-manual/01-url-opcional.md) — contrato atual de cadastro manual, migração e diferença entre omitir e limpar campos.
- [E1.2 — Mover produto](docs/evolucao/etapa-01-produto-manual/02-mover-produto.md) — atualização do vínculo entre listas próprias.
