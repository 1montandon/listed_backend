# Revisão E3 — Username, bio e moeda preferida

**Estado:** backend implementado, testado e validado pelo usuário para commit. A migração foi aplicada ao PostgreSQL local. O frontend ainda precisa ser adaptado.

## O que mudou

A conta agora tem `username` obrigatório e único, `bio` opcional e `preferredCurrency`, com valor inicial `BRL`. No cadastro, o usuário escolhe seu username. No perfil, pode editar nome, username, bio e moeda; o e-mail continua somente leitura.

Arquivos principais: [modelo Prisma](../../../prisma/schema.prisma), [migração](../../../prisma/migrations/20261118010000_profile_username/migration.sql), [validações compartilhadas](../../../src/shared/validation/user-fields.ts), [cadastro](../../../src/modules/auth/auth.schema.ts), [perfil](../../../src/modules/users/users.schema.ts), [repository de autenticação](../../../src/modules/auth/auth.repository.ts) e [repository de perfil](../../../src/modules/users/users.repository.ts).

## Contratos

`POST /api/v1/auth/register` agora exige `username`:

```json
{
  "name": "João Silva",
  "username": "joaosilva",
  "email": "joao@example.com",
  "password": "uma-senha-de-teste-segura"
}
```

Username aceita de 3 a 30 caracteres: letras sem acento, números e `_`. Espaços nas pontas são removidos, letras maiúsculas viram minúsculas e a unicidade é verificada no banco. O `@` não faz parte do valor salvo. Tentar usar um username já ocupado retorna 409 com `USERNAME_ALREADY_EXISTS`; e-mail duplicado continua retornando `EMAIL_ALREADY_EXISTS`.

O nome de exibição aceita letras Unicode, marcas de acento e espaços, com até 120 caracteres. Números e símbolos não são aceitos em novos cadastros ou edições de nome. A regra não altera nomes antigos durante a migração. O nome pode continuar com maiúsculas e acentos.

`PATCH /api/v1/me` aceita um ou mais campos:

```json
{ "username": "joao_silva", "bio": "Gosto de livros", "preferredCurrency": "USD" }
```

Campos omitidos são preservados. Para limpar a bio, envie `"bio": null`; ela aceita até 500 caracteres após remover espaços das pontas. As moedas aceitas são `BRL`, `USD` e `EUR`. A preferência não converte nem altera os preços salvos; conversão será tratada em E4. `GET /me` e as respostas de cadastro, login e refresh incluem os novos campos. Nenhuma resposta expõe o hash da senha.

## Migração das contas existentes

Antes de exigir username no banco, a migração percorre as contas por data de criação e ID e gera um valor a partir do nome:

1. Converte para minúsculas e separa letras dos acentos usando normalização Unicode NFD.
2. Remove marcas de acento e caracteres fora de `a-z`, `0-9` e `_`, incluindo espaços.
3. Limita a 30 caracteres. Se restarem menos de três, usa `usuario` como base.
4. Se a base já estiver em uso, acrescenta `2`, `3` etc., encurtando a base quando necessário para caber no limite.
5. Define bio como `null` e moeda como `BRL`. Nome, ID, e-mail, senha e datas permanecem iguais.

Exemplos: `Eduardo Montandon` → `eduardomontandon`; `João Silva` → `joaosilva`; outro `Joao Silva` → `joaosilva2`. O usuário poderá trocar esse valor no perfil. Nomes antigos muito curtos ou sem letras aproveitáveis usam a base `usuario` com sufixos quando necessário. Nomes de outros alfabetos que não se decomponham em letras ASCII também usam o resultado disponível ou essa base; o nome de exibição original é preservado.

A migração cria um índice único e regras de formato no PostgreSQL. Assim, mesmo que duas requisições cheguem juntas, o banco aceita apenas uma delas. Ela também exige uma das três moedas. Username não cria perfil público; não adicionamos uma lista de nomes reservados nesta etapa.

## Como o código funciona

1. Os schemas Zod validam os dados de entrada. `usernameSchema` normaliza e valida em um único lugar, compartilhado por cadastro e perfil; os tipos usados nos services continuam inferidos dos schemas.
2. O controller chama o service com os dados validados. No cadastro, o repository salva conta e sessão em uma transação já existente.
3. Na edição, o repository monta `data` apenas com campos presentes. Um `null` na bio é mantido para apagá-la; `undefined` significa ausência e não é enviado ao Prisma.
4. O índice único do banco é a fonte de verdade para conflitos. O repository converte a falha de unicidade em erro de domínio e o service escolhe a resposta HTTP 409. No cadastro, após o conflito, consulta se o e-mail já está em uso para distinguir as mensagens.
5. A preferência é salva na própria conta. Os produtos preservam seu preço e sua moeda originais.

### O que ler

1. [user-fields.ts](../../../src/shared/validation/user-fields.ts) para as regras comuns. A regex com `\p{L}` reconhece letras Unicode; `\p{M}` aceita marcas usadas para formar letras acentuadas.
2. [auth.schema.ts](../../../src/modules/auth/auth.schema.ts) e [users.schema.ts](../../../src/modules/users/users.schema.ts) para o contrato de cada rota e os tipos inferidos.
3. [users.repository.ts](../../../src/modules/users/users.repository.ts) e [users.service.ts](../../../src/modules/users/users.service.ts) para omissão, null e conflito.
4. [migration.sql](../../../prisma/migrations/20261118010000_profile_username/migration.sql) e [profile-migration.test.ts](../../../tests/profile-migration.test.ts) para entender a transformação das contas antigas.
5. [profile.integration.test.ts](../../../tests/profile.integration.test.ts) para os pedidos HTTP e a disputa concorrente por username.

## Como testar

Com PostgreSQL local configurado:

```powershell
npm run db:deploy
npm run db:generate
node --env-file=.env --import tsx --test tests/profile-migration.test.ts tests/profile.integration.test.ts
npm run typecheck
npm run build
npm test
```

Executado nesta entrega: o teste da migração passou antes de sua aplicação local; `db:deploy`, geração do cliente, typecheck e build passaram; a suíte completa passou com **72/72 testes**. O teste da migração usa um schema isolado dentro de uma transação desfeita ao final. O teste HTTP cobre regras de nome e username, conflitos, bio, moedas e duas edições concorrentes.

Para testar manualmente, cadastre uma conta com username maiúsculo e confira a resposta em minúsculas. Tente o mesmo username com outro e-mail, edite bio e moeda via `PATCH /me`, limpe a bio com null e consulte `GET /me`. Experimente nomes com acento e rejeite um nome com número.

## Pendências e impacto no frontend

- E3 foi validado pelo usuário para commit.
- **O cadastro atual do frontend ainda não envia username:** com este backend, ele recebe 400 até ser adaptado. O frontend também precisa apresentar e editar os campos novos e tratar conflito de username. A integração ainda não foi executada.
- E1.1, E1.2 e E2 também aguardam integração coordenada no frontend. Nenhum preço foi convertido.
- Reverter a migração de produção exige planejar o tratamento dos dados adicionados; não executamos rollback nem deploy.
