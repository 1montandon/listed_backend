# Plano do backend do Listed

## 1. Visão geral e escopo

O backend do MVP gerencia contas, sessões, perfil e wishlists privadas. A pessoa pode colar o link de um produto, revisar a prévia e salvar os dados, ou preencher o formulário manualmente. A API permite consultar, editar e remover os itens salvos. A recuperação de senha e as verificações operacionais completam a preparação para usuários reais.

Cada produto salvo guarda o preço informado no cadastro ou na edição. URLs duplicadas são permitidas. Monitoramento automático de preço e compra pela aplicação ficam fora do escopo do backend; marcar comprado apenas registra um estado, sem processar uma compra.

**Ampliação de escopo definida em 17/11/2026:** produto manual sem URL, movimentação transacional, miniaturas, perfil ampliado, moeda preferida, comprado e totais convertidos, imagens no Cloudflare R2, recuperação/segurança e compartilhamento. Consulte o [plano de evolução do backend](docs/evolucao/plano.md) para requisitos, ordem e checkpoints. São funcionalidades planejadas, não contratos já implementados. A relação continua sendo uma wishlist para muitos produtos; cada produto pertence a uma única lista.

## 2. Stack e justificativas

| Escolha | Motivo |
| --- | --- |
| Node.js 26, Express 5 e módulos ES | Runtime da API e roteamento HTTP com suporte aos handlers assíncronos do projeto. |
| TypeScript em modo estrito e Zod | O compilador checa o código e o Zod valida, em execução, os dados recebidos pelo HTTP e as variáveis de ambiente. |
| `tsx watch` em desenvolvimento, `tsc` no build | O desenvolvimento recarrega a API ao editar arquivos. O build entrega JavaScript para execução direta com Node. |
| PostgreSQL 17 via Docker Compose e Prisma 7.10.1 | Migrações versionam o esquema e chaves estrangeiras protegem as relações. O projeto fixa o CLI, o cliente e o adaptador PostgreSQL na linha 7 escolhida para esta base. |
| Argon2id, JWT com `jose` e cookie `HttpOnly` | Argon2id protege senhas armazenadas. O JWT autentica requisições de acesso e a sessão refresh persistida permite rotação e revogação. |
| Undici, Cheerio e Playwright com Chromium | Undici controla o download e a conexão. Cheerio lê os dados no HTML recebido. O navegador permite esperar conteúdo montado por JavaScript quando a política de fallback autoriza. |
| Runner de testes do Node | Executa testes de parser, rede, navegador e integração HTTP/PostgreSQL no mesmo projeto. |

## 3. Arquitetura e pastas

```text
README.md            instalação, comandos e mapa da API
PLAN.md              escopo, etapas e decisões pendentes
docs/etapas-iniciais/ revisões numeradas das etapas originais
docs/evolucao/       plano e revisões por etapa de evolução
prisma/              esquema e migrações
scripts/             diagnóstico de extração
src/
  app.ts             composição da API Express
  server.ts          entrada do processo HTTP
  config/            configuração validada
  db/                cliente Prisma compartilhado
  shared/            autenticação e tratamento de erros HTTP
  modules/
    auth/            cadastro, login e sessões
    users/           perfil
    wishlists/       listas privadas
    products/        extração e produtos salvos
      network/       política de destino e proxy do Chromium
tests/               testes e dados de exemplo
```

Em rotas persistidas, o fluxo é `router → controller → service → repository → Prisma`. O router liga os middlewares às operações. O controller valida a entrada uma vez e entrega dados tipados ao service. O repository contém as consultas e converte tipos do banco para a resposta pública. Os arquivos de rota instanciam suas dependências na carga do módulo.

A prévia de produto segue `router → controller → service → loader → parser`. O loader obtém o HTML, o parser interpreta os dados e o service escolhe a prévia. A operação de salvar pertence ao mesmo módulo e passa pelo repository. Funções puras, como os parsers, ficam como funções.

O schema Zod concentra o contrato de entrada. Quando há transformação ou coerção, `z.output<typeof schema>` descreve os dados depois da validação. O service recebe esse resultado e o `userId` autenticado como argumentos. Os tipos gerados pelo Prisma ficam nas consultas e nos mapeadores. Os campos públicos são definidos na saída dessas camadas.

## 4. Etapas e critérios de conclusão

| Etapa | Objetivo | Critérios de conclusão | Estado |
| --- | --- | --- | --- |
| 1. Fundação e banco | Preparar API, ambiente local e esquema inicial. | API inicia, `/health` e `/ready` respondem, migração inicial aplica em banco novo, build e tipos passam. | Commitada em `c7cf2d6`. [Revisão](docs/etapas-iniciais/01-fundacao-e-banco.md) |
| 2. Autenticação e perfil | Implementar cadastro, login, refresh, logout e edição do próprio perfil. | Validar e-mail único, acesso protegido, guarda de origem, rotação, revogação e rejeição do token refresh reutilizado. | Commitada em `51b5be5`. [Revisão](docs/etapas-iniciais/02-autenticacao-e-perfil.md) |
| 3. Wishlists | Gerenciar listas privadas. | Exercitar o CRUD com duas contas, contagem de produtos e exclusão em cascata. | Commitada em `a3f57b2`. [Revisão](docs/etapas-iniciais/03-wishlists.md) |
| 4. Extração de produto | Gerar prévia autenticada por URL. | Cobrir respostas completas, parciais e falhas, bloquear destinos privados e verificar fallback, variantes e sugestão de nome. | Commitada em `884de93`. [Revisão](docs/etapas-iniciais/04-extracao-de-produtos.md) |
| 5. Produtos salvos | Salvar dados revisados ou manuais e gerenciar os itens da lista. | Cobrir campos mínimos, preços decimais, duplicatas, edição, exclusão e permissões com duas contas. | Validada em 18/11/2026 e commitada em `94194ba`. [Revisão](docs/etapas-iniciais/05-produtos-salvos.md) |
| 6. Recuperação de senha e preparação para uso real | Marco original desdobrado em E6 (recuperação/segurança) e E8 (produção). | Critérios e pausas no plano de evolução; recuperação continua obrigatória antes da abertura pública. | Planejada; seguir a sequência E1–E8 abaixo. |

### Evolução após o MVP privado

Os IDs E1–E8 são compartilhados com o frontend. Preservam a numeração e as revisões das entregas anteriores. E1.1 foi implementado, validado e commitado no backend em `678aab2`. E1.2 foi validado e commitado em `5d57dd7`. E2 foi validado e aprovado para commit no backend; a integração com o frontend continua pendente.

| Ordem | Bloco | Ritmo |
| --- | --- | --- |
| E1 | Produto manual só com nome e mover pela atualização do vínculo com a lista. | Normal, duas entregas. |
| E2 | Até quatro miniaturas no resumo das wishlists. | Normal. |
| E3 | Username, bio e preferência de moeda. | Normal. |
| E4 | Marcar/desmarcar comprado, falta comprar, total e câmbio. | Didático, pausado. |
| E5 | Imagens de produto, avatar e banner no R2. | Didático, pausado. |
| E6 | Recuperação de senha, alteração de senha e encerramento das outras sessões. | Recuperação didática e pausada; segurança em entrega separada. |
| E7 | Link público de leitura, convites por e-mail e colaboradores. | Ainda mais pausado; participação do usuário no código. |
| E8 | Termos/privacidade e preparação de produção. | Normal; bloqueios de publicação explícitos. |

Consulte [requisitos, contratos a definir e critérios por checkpoint](docs/evolucao/plano.md) e a [revisão E1.1 — URL opcional](docs/evolucao/etapa-01-produto-manual/01-url-opcional.md). A etapa 5 e o backend de E1.1 foram commitados. Coordenar a integração E1.1 com a revisão da etapa 6 do frontend, sem tratar a entrega isolada do backend como funcionalidade integrada concluída.

### Fluxo obrigatório

1. Implementar a etapa.
2. Executar as verificações.
3. Criar `docs/etapas-iniciais/<NN>-<etapa>.md ou docs/evolucao/etapa-<NN>-<nome>/<NN>-<checkpoint>.md` e atualizar o estado no `PLAN.md`.
4. Apresentar as alterações e aguardar sua leitura e revisão.
5. Aplicar eventuais correções e verificar novamente o que mudou.
6. Obter sua aprovação explícita para o commit e o avanço.
7. Realizar o commit.
8. Seguir para a próxima etapa autorizada.

Cada revisão cobre o que foi implementado, como funciona, decisões técnicas, ordem de leitura, como testar e pendências. Registre decisões que afetam etapas futuras neste plano. A revisão de cada etapa concentra os detalhes específicos da implementação.

Nos blocos E4, E5, recuperação de E6 e E7, esse ciclo vale para **cada checkpoint pequeno**, não só para o bloco inteiro. Explicar o conceito antes do código e pausar de verdade após a entrega. Em E7, combinar antes de cada trecho se o usuário quer escrever com orientação ou acompanhar a implementação. Não preencher por ele um exercício em andamento. Revisões usam `docs/evolucao/etapa-<NN>-<nome>/<NN>-<checkpoint>.md` e cada repositório recebe seu próprio commit aprovado. Aprovação do planejamento não autoriza implementação integral, commits ou avanço automático.

## 5. Decisões pendentes de aprovação

| Decisão | Quando definir |
| --- | --- |
| Provedor de e-mail transacional e remetente, compartilhados por recuperação e convites. | E6, antes de integrar o envio; reutilizar em E7. |
| Domínios de produção do frontend e da API, incluindo origem e cookies. | Antes do envio de links reais em E6/E7 e da conclusão de E8. |
| API de câmbio, atualização/cache e tratamento de indisponibilidade. | Escolher com o usuário em E4.3; BRL, USD e EUR já confirmados. |
| Regras de username e migração das contas existentes; preços/moedas legados. | Definir antes das migrações de E3/E4, preservando dados. |
| Entrega e acesso às imagens, limites e limpeza de objetos R2. | E5.1, considerando desde o início listas privadas e links públicos revogáveis. |
| Validade dos convites, reenvio, aceite e efeito da revogação de sessões. | Revisões técnicas de E6/E7. |
| Conteúdo e destinos de termos e privacidade. | E8, antes da publicação; não fabricar documentos finais ou consentimento. |

E1.2 do backend foi commitado em `5d57dd7`. E2 do backend foi validado e aprovado para commit: [miniaturas](docs/evolucao/etapa-02-miniaturas/01-resumo-de-wishlist.md). A integração do frontend para E1.1, E1.2 e E2 permanece pendente.
