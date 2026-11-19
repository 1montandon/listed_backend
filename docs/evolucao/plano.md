# Evolução do Listed — backend

**Planejamento:** 17/11/2026. **Atualizado:** 18/11/2026. **Estado:** E1.1 commitado; E1.2 commitado no backend; E2 commitado em `a4d6d71`; E3 commitado em `51097f0`; E4.1 commitado em `7c99bdf`; E4.2 commitado em `ba211c9`; E4.3 em definição. Integração com o frontend pendente. O [PLAN.md](../../PLAN.md) é o índice principal. Este documento detalha o trabalho do backend; os mesmos IDs organizam o plano de evolução no repositório `listed_frontend`.

## 1. Como executar e revisar

A etapa 5 do backend foi validada e commitada em `94194ba` em 18/11/2026. Coordenar a integração E1.1 com a revisão da etapa 6 do frontend. Preservar alterações locais de extração e outras entregas; não misturá-las em commits novos.

Sequência: **E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8**. Recuperação pode ser antecipada se houver decisão de abrir o produto a usuários reais antes de terminar a sequência. Dependências essenciais: moeda de E3 antes dos totais de E4; infraestrutura de e-mail de E6 antes dos convites de E7; regras de acesso de E7 consideradas no desenho de imagens de E5.

Cada checkpoint segue: explicar objetivo/contrato → implementar somente a parte autorizada → verificar → escrever `docs/evolucao/etapa-<NN>-<nome>/<NN>-<checkpoint>.md` → apresentar arquivos/resultados/limitações → aguardar leitura e validação → corrigir → obter aprovação explícita para commit e avanço → commit seletivo → próxima parte autorizada. Planejamento e contratos propostos não são endpoints existentes.

Backend e frontend têm entregas e commits separados. Revisar primeiro o contrato do backend; integrar apenas esse contrato no frontend e validar o fluxo completo antes de encerrar o checkpoint funcional. Uma entrega de backend isolada não comprova conclusão da funcionalidade.

**Quatro blocos especiais:** E4 (comprado/câmbio), E5 (R2), recuperação de E6 e E7 (compartilhamento/autorização). Explicar conceitos antes de introduzi-los, limitar o tamanho do código e pausar em cada checkpoint. E7 será ainda mais acompanhado: antes de cada trecho, combinar se o usuário implementará com orientação ou acompanhará o agente. Não antecipar o restante do módulo nem terminar exercícios pelo usuário. Checkpoints podem ser subdivididos novamente durante a revisão.

Revisões devem conter: objetivo; comportamento; decisões/alternativas; arquivos e ordem de leitura; conceito novo com exemplo; testes executados e resultados reais; roteiro para o usuário; pendências; estado de leitura/aprovação/commit. Só registrar execução e aprovação quando ocorrerem.

## 2. Requisitos definidos

- Cada produto pertence a uma única wishlist. Não haverá muitos para muitos entre produtos e listas. Registros semelhantes em listas distintas são independentes.
- Produto manual exige apenas nome como dado do produto, dentro de uma wishlist válida. URL, imagem, preço/moeda e loja são opcionais; extração continua exigindo URL.
- Mover atualiza o vínculo do mesmo produto para a lista de destino. Só o dono pode mover entre listas próprias. O ID e a data de criação permanecem; a data de atualização muda.
- Comprado significa marcar/desmarcar; não há valor pago separado nem compra processada pela aplicação.
- Mostrar separadamente falta comprar (não comprados) e total da lista (todos). Preservar valores originais. Preferência de moeda inicialmente BRL, opções BRL/USD/EUR. Escolher provedor de câmbio com o usuário.
- Username obrigatório no cadastro, único sem distinguir maiúsculas/minúsculas e editável no perfil. Não cria perfil público. Bio opcional; e-mail permanece somente leitura neste recorte.
- Imagens de produtos aceitam URL com preview e upload. Avatar e banner usam Cloudflare R2 com SDK compatível com S3. Foto opcional no cadastro; banner configurado depois. Sem banner, usar avatar ampliado/recortado; sem ambos, iniciais e fundo neutro.
- Segurança: recuperar senha, alterar senha com senha atual e encerrar outras sessões. Sem alteração de e-mail ou exclusão de conta nesta evolução. Preferências apenas de moeda.
- Visualização da lista por link sem conta. Edição exige autenticação e convite individual enviado por e-mail, inclusive para pessoas sem conta, que se cadastram com o e-mail convidado e aceitam.
- Termos e privacidade precisam de conteúdo/destinos aprovados antes da publicação. Não presumir consentimento nem fabricar documentos finais.

### Bases propostas para detalhamento técnico

Manter listas privadas por padrão; dono ativa/desativa/renova o link público e gerencia participantes. Editor pode gerenciar produtos e marcar comprado, mas não mover, excluir a lista ou conceder acesso. Visitante só lê. Totais compartilhados usam a moeda do dono. Essas bases, discutidas na conversa, serão convertidas em contratos na revisão de E7.1; prazos e detalhes ainda não foram escolhidos.

Ao mover, preservar o registro e todos os dados de negócio, inclusive comprado e imagem quando existirem. Falha de foto não deve desfazer cadastro válido. Itens sem preço/moeda/cotação não devem ser tratados como zero nem produzir total completo enganoso. Definir a apresentação dos totais parciais em E4.

## 3. Entregas e critérios

### E1 — Cadastro manual e movimentação (normal)

| Checkpoint | Implementação | Critérios de aceite |
| --- | --- | --- |
| E1.1 — URL opcional | Migração preservando registros; schema, persistência e resposta com URL anulável. Manter URL obrigatória na extração. | Criar só com nome em lista própria; editar/remover URL; distinguir omissão de null; rejeitar URL inválida quando enviada; regressão da extração e isolamento entre contas. |
| E1.2 — Mover | Definir operação única de movimentação e contrato com destino; validar propriedade das duas listas e atualizar o vínculo. Manter relação 1:N. | Origem alheia, destino alheio/inexistente e destino igual rejeitados; movimento válido preserva ID e criação e atualiza contagens. Testar tentativas concorrentes. |

A regra de movimento permanece restrita ao dono mesmo após E7. Quando E4/E5 adicionarem campos/referências, confirmar que o movimento preserva esses dados e não dispara limpeza de imagem.

**Andamento E1.1:** backend implementado, testado, validado pelo usuário e commitado em `678aab2`, com migração aplicada ao banco local. [Revisão e contrato](etapa-01-produto-manual/01-url-opcional.md). `url` omitida/null na criação resulta em null; no PATCH, omissão preserva e null remove. Extração continua exigindo URL. O frontend ainda exige URL no schema de produto; adaptar e validar a integração antes de encerrar E1.1 como funcionalidade.

**Andamento E1.2:** backend validado e commitado em `5d57dd7`. [Revisão e contrato](etapa-01-produto-manual/02-mover-produto.md). A integração no frontend permanece pendente.

### E2 — Miniaturas (normal)

Adicionar ao resumo de `GET /wishlists` até quatro miniaturas com ordem determinística alinhada à ordem de produtos. Implementação para revisão: campo `thumbnails`, com os quatro primeiros produtos, preservando posições sem imagem com null. Não são as quatro primeiras imagens não nulas.

Validar lista vazia, menos de quatro, mais de quatro, imagem ausente, contagem total independente do limite, isolamento e atualização após criar/editar/remover/mover. Buscar apenas campos necessários ao resumo, sem carregar todos os produtos de cada lista. Adaptar autorização do resumo em E7.

**Andamento E2:** backend commitado em `a4d6d71`; [revisão do contrato](etapa-02-miniaturas/01-resumo-de-wishlist.md). Frontend ainda não integrado.

### E3 — Perfil e preferências (normal)

Ampliar cadastro/perfil com username e bio e persistir moeda preferida. Unicidade de username deve resistir a cadastros/edições concorrentes e diferenças de caixa. Regras definidas com o usuário: 3–30 letras sem acento, números ou `_`, salvas em minúsculas. Contas existentes recebem username derivado do nome, com sufixo numérico em conflitos. Não há nomes reservados nesta etapa.

Moeda padrão BRL; escolhas BRL/USD/EUR. Definir como responder a clientes antigos e como atualizar os dados do usuário em sessão/perfil. Testar cadastro obrigatório, conflito, edição pelo dono, campo omitido versus limpo, moeda inválida e default. Alteração de moeda não modifica moeda/preço de produtos existentes. Revisão: `docs/evolucao/etapa-03-perfil/01-perfil.md`.

**Andamento E3:** backend commitado em `51097f0`; [revisão de perfil](etapa-03-perfil/01-perfil.md) documenta o contrato. Migração aplicada localmente; frontend ainda não adaptado.

### E4 — Comprado, totais e câmbio (didático)

| Checkpoint | Conceito e pequena entrega | Validação antes da pausa |
| --- | --- | --- |
| E4.1 — Comprado | Estado persistido por produto, default não comprado; marcar e desmarcar com estado desejado explícito. | Repetir a mesma alteração não inverte indevidamente o estado; reload, permissões, migração de registros e movimento preservando estado. |
| E4.2 — Totais sem câmbio | Separar falta comprar e total; trabalhar primeiro com uma moeda e centavos inteiros. Definir contrato de totais e itens não incluídos. | Lista vazia, zero, valores ausentes, todos comprados, mistura de moedas ainda sem conversão e precisão da soma. |
| E4.3 — Escolha e consulta de câmbio | Comparar provedores com o usuário e documentação atual: BRL/USD/EUR, licença de uso, atualização, limites e custo. Definir consulta, cache e falhas antes de integrar. | Origem/data da cotação observáveis; nenhuma cotação estática do Figma; validar resposta externa e conversão identidade sem chamada desnecessária. |
| E4.4 — Conversão e integração | Converter para moeda preferida; definir precisão, arredondamento, atualização e apresentação de totais parciais. | Taxa/direção com exemplos conhecidos, indisponibilidade, ausência de moeda/taxa, troca de preferência, comprado alterando só falta comprar e preço original preservado. |

**Andamento E4.1:** backend commitado em `7c99bdf`; [revisão de comprado](etapa-04-comprado-e-totais/01-comprado.md) documenta o contrato. Migração aplicada localmente. Frontend não integrado.

**Andamento E4.2:** backend commitado em `ba211c9`. [Revisão dos totais](etapa-04-comprado-e-totais/02-totais-sem-cambio.md). Preço sem moeda e moeda diferente são informados como exclusões, sem presumir BRL. Usar fixture identificada para testes de taxas e registrar separadamente a consulta real. Chave de provedor não deve ir para o frontend. Em E4.2, a agregação ocorre no service e é exposta pela rota de totais; o provedor de câmbio ainda será escolhido.

### E5 — Imagens R2 (didático)

| Checkpoint | Conceito e pequena entrega | Validação antes da pausa |
| --- | --- | --- |
| E5.1 — Desenho | Explicar bucket, objeto, chave, credencial e URL; escolher upload via API ou autorização temporária e política de leitura. Definir tipos, tamanhos, domínio/CORS e custos. | Diagrama/percurso revisado; credenciais só no servidor; resolver acesso privado e impacto de revogar compartilhamento antes de implementar. |
| E5.2 — Primeiro arquivo | Configurar integração R2 com SDK S3 e enviar um arquivo autorizado de ponta a ponta. | Conteúdo/tipo/tamanho válidos, falha de rede, autorização e acesso ao resultado; não confiar só na extensão/nome enviado pelo cliente. |
| E5.3 — Produto | Associar imagem enviada; manter URL externa; permitir troca/remoção com referência verificável e propriedade. | Não aceitar chave de outra conta; substituir/remover sem apagar objeto ainda referenciado; cancelamento e registros de upload incompleto. |
| E5.4 — Avatar e banner | Reutilizar upload no perfil e foto opcional após cadastro autenticado; suporte à remoção e fallback. | Cadastro sem foto; falha da foto não invalida a conta; troca de avatar atualiza fallback do banner; banner próprio prevalece. |
| E5.5 — Ciclo de vida | Revisar limpeza de arquivos não associados, exclusão de produtos/listas e movimentação; definir coordenação entre banco e armazenamento. | Falha de exclusão externa tem tratamento; transação do banco não é tratada como transação do R2; sem perda de imagem no movimento. |

Não presumir que uma URL de imagem fica privada porque a wishlist é privada. Definir limites da revogação de URLs/caches; acesso direto às imagens e URL externa são partes explícitas da decisão de E5.1. E7 revisitará upload por editor e referência pertencente a lista de outro dono.

### E6 — Recuperação e segurança

| Checkpoint | Conceito e pequena entrega | Validação antes da pausa |
| --- | --- | --- |
| E6.1 — Fluxo e e-mail (didático) | Escolher provedor/remetente com usuário, definir links confiáveis, expiração, limites e política de sessões. Preparar envio reutilizável por convites. | Configuração local/produção clara; nenhum segredo ou token nos logs; entrega real só declarada quando testada. |
| E6.2 — Solicitação (didático) | Token aleatório de validade curta, hash persistido e envio de link; resposta uniforme para conta existente ou inexistente. | Uniformidade de resposta, limites, falha de envio, reenvio e tratamento de tokens anteriores conforme regra revisada. |
| E6.3 — Redefinição (didático) | Validar token e alterar senha com consumo atômico de uso único; aplicar regra de revogação das sessões. | Token inválido, expirado, reutilizado e dois consumos concorrentes; login com nova senha e rejeição da antiga; fluxo completo com frontend. |
| E6.4 — Segurança autenticada (normal, separada) | Alterar senha exigindo a atual e encerrar as outras sessões preservando a atual. | Senha atual incorreta, identificação segura da sessão atual e outras sessões impedidas de renovar. Definir/testar também a validade restante dos access tokens. |

A recuperação é requisito para publicação. Explicar que revogar refresh sessions pode não invalidar imediatamente um access token já emitido: definir e documentar a política antes de declarar “sessões encerradas”. E-mail editável, exclusão de conta, MFA e outras preferências não foram incluídos.

### E7 — Compartilhamento e autorização (mais pausado)

| Checkpoint | Pequeno objetivo | Exercício/validação |
| --- | --- | --- |
| E7.1 — Matriz de acesso | Diferenciar autenticação/autorização; revisar dono/editor/visitante e modelo de associação entre usuários e listas. | Usuário prevê quem pode realizar cada ação; mapear todas as rotas existentes antes de escrever permissões. |
| E7.2 — Leitura pública | Gerar link não previsível e leitura sem conta, apenas após ativação pelo dono. Resposta pública mínima. | Lista privada permanece inacessível; link inválido não revela dados; não expor e-mail, participantes ou configuração da conta. |
| E7.3 — Revogação | Desativar/renovar link e invalidar o anterior. | Link antigo deixa de autorizar novas leituras; revisar caches e imagens, sem prometer apagar conteúdo já visto ou copiado pelo visitante. |
| E7.4 — Convite por e-mail | Convite individual com prazo e cancelamento; envio pela infraestrutura E6. | Só dono convida; tratar duplicatas/reenvio e cancelamento; definir token e armazenamento antes do código. |
| E7.5 — Aceite | Aceite autenticado com e-mail correspondente, após login ou cadastro para convidado novo. | Acessar o link não concede permissão sozinho; rejeitar outra conta, expirado, cancelado e consumo concorrente; comprovar controle do e-mail pelo fluxo definido. |
| E7.6 — Edição colaborativa | Aplicar permissão a produtos, comprado, imagens e listagem de listas acessíveis. Manter movimento exclusivo do dono entre listas próprias. | Dono/editor/visitante/terceiro exercitam cada operação; editor não exclui lista, gerencia participantes ou move produto. Atualizar testes antes restritos ao dono. |
| E7.7 — Remover acesso | Dono remove colaborador; backend revalida permissão nas novas requisições. | Mesmo usuário ainda autenticado perde acesso; cobrir concorrência entre remoção e mutação conforme política revisada e resultados públicos com alterações reais. |

Revisar antes de E7.1: totais na moeda do dono; apresentação das listas compartilhadas na coleção; metadados públicos do dono; limites de convites; comportamento com edições simultâneas. Sem sincronização em tempo real, notificações extras, perfil público ou cópia de listas implicitamente incluídos. Os detalhes precisam de decisão, não de endpoints inventados no frontend.

### E8 — Termos, privacidade e produção (normal)

Solicitar conteúdo/destinos legais aprovados e refletir as integrações efetivas de e-mail, câmbio e imagens. Não criar um checkbox de consentimento sem requisito definido. Validar domínios, HTTPS, CORS/cookies, limites, backups, migrações com dados existentes e operação das integrações. Coordenar fluxos de usuário com o frontend, incluindo permissões públicas e colaborativas. Publicação depende de resolver recuperação e documentos legais; deploy requer autorização específica. Revisão: `docs/evolucao/etapa-08-producao/01-producao.md`.

## 4. Verificação e decisões em aberto

Executar testes relevantes por mudança e registrar comandos reais; backend usa testes de unidade/integração HTTP e PostgreSQL, typecheck e build. Migrações precisam cobrir banco com dados, não apenas banco vazio. Testes de autorização usam múltiplas contas e chamadas diretas à API. Não declarar testes executados durante planejamento.

Pendências técnicas ficam no checkpoint correspondente: formato da operação de mover; ordem/nulos de miniaturas; username legado/regras; moedas legadas; provedor/cache/arredondamento de câmbio; acesso/limites/limpeza R2; provedor de e-mail e prazos; efeito de revogação de sessão; contrato de convites e acesso público; conteúdo legal/domínios. Não reabrir decisões de produto já fechadas: 1:N, movimento por atualização do vínculo, username obrigatório, comprado binário e moedas BRL/USD/EUR.

**Próximo passo.** Escolher o provedor e a política de consulta de E4.3 com o usuário. [Comparação dos provedores](etapa-04-comprado-e-totais/03-consulta-de-cambio.md)
