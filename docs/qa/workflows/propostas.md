# Propostas — mudanças maiores em Workflows

P1, P5b e P5c foram implementadas. As demais mudam modelo mental, navegação ou backend e precisam de decisão. Cada uma traz antes, depois, impactos e critérios de aceite.

## P1 · Rascunho aceita etapa incompleta (implementada e conferida na tela com o backend real em 04/11/2026)

**Decisão:** aprovada. Implementada como no "Depois" abaixo: `backend/src/modules/workflows/domain/draft-graph.ts` (`parseDraftGraph` ao salvar, `parseCompleteGraph` ao publicar, no dry-run e no QA Lab), sem migration. O schema completo continua sendo um só. Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-incomplete-draft-proof`.

**Conferência integrada:** adicionar etapa em branco, salvar, recarregar, completar e publicar, com a API real e o banco de desenvolvimento. Editar o rascunho de um workflow no ar não alterou a versão publicada. Resultado em [relatorio-2026-11-04.md](relatorio-2026-11-04.md#10-conferência-integrada-da-p1).

- **Antes:** o `PUT /:id/draft` aplica o schema completo. Etapa nova sem agente, conteúdo, orquestrador, política, origem ou variável é recusada, e não dá para salvar e continuar depois.
- **Depois:** um schema tolerante para o rascunho aceita esses campos vazios, e só a publicação exige o completo. A Wiki já promete esse comportamento.
- **Impactos:**
  - Tudo que lê o rascunho precisa tolerar campos vazios: `validateWorkflowForPublish`, QA Lab "Testar rascunho" e as rotas de variável.
  - O schema de publicação continua igual, e o runtime só lê versões publicadas.
  - Toca `backend/src`, o que reinicia a API de desenvolvimento compartilhada ao salvar.
- **Aceite:**
  - Salvar com qualquer etapa recém-criada funciona, e reabrir mostra o mesmo.
  - O dry-run aponta a etapa em vez de responder 400.
  - O QA Lab recusa rascunho incompleto com mensagem clara.
  - `published` nunca aceita campo vazio.

## P2 · Um só modelo de salvamento, sem Sheet

- **Antes:** gatilho salva sozinho, nome salva ao sair do campo, Abrangência tem botão, modo de avaliação tem outro botão, e o canvas tem "Salvar rascunho". As configurações ficam numa Sheet com 4 seções.
- **Depois (duas alternativas):**
  - **A, salvamento automático (recomendada):** tudo vai para o rascunho sozinho, com indicação "Salvo há instantes". Publicar é a única ação com efeito, como no [n8n](https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows). A P1, já implementada, era o pré-requisito.
  - **B, salvamento explícito:** tudo aguarda "Salvar rascunho".
- **Organização:** Abrangência, Alvo e População viram uma seção no próprio nó Gatilho, chamada "Quando e para quem". O formulário só mostra o que vale para o gatilho escolhido. Não propomos assistente em passos, pois essas escolhas dependem umas das outras ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/) aponta esse limite do "staged disclosure").
- **Impactos:** concorrência fica mais sensível (ver P5); muda testes de `workflow-settings-sheet` e do gatilho.
- **Aceite:** nenhuma ação de configuração depende de um botão diferente; recarregar a página nunca perde edição; a Sheet some.
- **Validação:** teste de compreensão com 5 administradores.

## P3 · Começar por um modelo, e duplicar

- **Antes:** "Novo workflow" abre sempre um fluxo vazio. Os 22 modelos existem como rascunhos no banco de demonstração, e adaptar altera o próprio modelo. Não há duplicar.
- **Depois:**
  - "Novo workflow" pergunta o objetivo: **"Partir de um modelo"** (lista por objetivo: feedback de monitoria, indicador em queda, resumo à liderança…) ou **"Começar do zero"**.
  - Escolher um modelo cria uma cópia e guia só o que depende do ambiente, usando `structureRequirement` de `official-model-templates.json`: grupo, pessoa-âncora, agente.
  - Lista e editor ganham **Duplicar**, que cria um rascunho desativado.
- **Impactos:**
  - Rota nova `POST /:id/duplicate`, ou criação a partir de template.
  - Definir onde os templates moram em produção.
  - Duplicar não copia execuções.
  - Decidir teste para admin de grupo, pois hoje `qa_lab.use` só existe no Administrador geral.
- **Aceite:** do clique em Novo até um rascunho válido sem abrir o canvas, em modelo sem dependência específica; duplicar nunca nasce ativo.
- **Validação:** H1; indicador "uso de modelos e sucesso na adaptação".

## P4 · Fluxos grandes e telas menores

- **Antes:** modelo de 12 etapas numa coluna fica com zoom 0,21 a 1440×900, e 280 px acima do canvas são cabeçalhos. Sem desfazer.
- **Depois:**
  - **Organizar** automático em camadas, com ramos lado a lado. Usar biblioteca própria de layout exige avaliação (dagre ou elkjs).
  - **Modo foco:** canvas em tela cheia, recolhendo o menu lateral e o cabeçalho.
  - **Desfazer e refazer** no canvas (Ctrl+Z).
  - **Buscar etapa** pelo nome.
- **Decisão:** telefone é uso real? `regras-produto-ui-ux.md` pede responsividade em toda tela. Hoje o editor mostra um aviso e empilha paleta e canvas.
- **Aceite:** modelo de 12 etapas legível sem zoom manual em 1440×900; Ctrl+Z restaura uma etapa removida.

## P5 · Correções de backend para fechar os defeitos

Agrupadas para rodadas com prova em banco de teste. P5b e P5c vieram primeiro, pois eram as que deixavam um fluxo publicado falhar em silêncio.

**Estado em 04/11/2026:** **P5b, P5c e WF-41 implementados e validados em ambiente local isolado**, e juntados a `admin-list-standardization` em 04/11/2026, sem push e sem implantação. Resultado em [relatorio-2026-11-04.md](relatorio-2026-11-04.md#11-implementação-da-p5b-p5c-e-wf-41). **Falta a [verificação anterior à implantação](#verificação-anterior-à-implantação).** Os itens a, d, e, f, g e h seguem sem implementação.

| Item | Mudança | Achado | Ordem |
|---|---|---|---|
| b | Publicação recusa origem de etapa removida ou fora do caminho | WF-07, WF-41 | **implementado** |
| c | Revisão sem revisor resolvido bloqueia com motivo, em vez de esperar para sempre | WF-08 | **implementado** |
| a | Dry-run acumula todos os problemas e devolve a lista | WF-24 | depois |
| d | `DELETE` mapeia a FK para 409 com mensagem, grava auditoria e avalia `on delete set null` | WF-06 | depois |
| e | `PUT /draft` confere a revisão e responde 409 em gravação concorrente | WF-29 | depois |
| f | Decisão em workflow inativo avisa que a retomada depende de reativar | WF-12 | depois |
| g | Execuções trazem o colaborador e buscam por nome da pessoa | WF-16 | depois |
| h | Mensagens do backend sem enum nem termos internos | WF-25 | depois |

**Os números abaixo são do banco de desenvolvimento em 04/11/2026.** Eles orientaram a proposta, mas não substituem a verificação anterior à implantação.

### P5b · Referência quebrada aceita pela API

**Como era antes da implementação** (leitura de código, salvo onde indicado). O editor já bloqueava etapa removida, mas quem publicava pela API passava, e versões antigas podem ter a referência:

| Campo | Publicar | Ao rodar, se a origem não existir ou não tiver rodado |
|---|---|---|
| Output `source` | Aceita (`publish-validation/outputs.ts:92-93`, `reliable-feedback.ts:84-85`) | Acompanhamento do colaborador, Chat e Avatar falham. **Notificação ou Acompanhamento para outra pessoa entregam um aviso vazio**: "Um workflow gerou uma saída relacionada a…" (`output-executor.ts:173`) |
| Condição `sourcePath`, simples ou em grupo | Aceita fora de `structuredResult.` (`conditions.ts:263-292`) | Falha com "Não foi possível resolver…" (`node-handlers.ts:224,355-359`) |
| Revisão `contentSource` | Aceita (`outputs.ts:96`) | **Pede a decisão sem mostrar o conteúdo** (`human-review-executor.ts:71-77`) |
| Escalonar `contentSource` | Aceita (`outputs.ts:97`) | Escala sem o conteúdo (`escalate-executor.ts:80`) |
| Definir variável, Política, Gerar feedback, revisão anterior | **Já recusa** (`actions.ts:58-62`, `intervention-policy.ts:16`, `reliable-feedback.ts:46`, `review-escalation.ts:17-25`) | — |

**Origem em variável (WF-41, reproduzido em teste).** A tela oferecia "Variável: X" como conteúdo, mas Output, Revisão e Escalonar só liam `nodeOutputs` (`resolveSource`). O valor nunca chegava: o aviso saía como "Um workflow gerou uma saída relacionada a…". O mesmo acontecia com um campo de texto escolhido do resultado estruturado. Sem corrigir isso, a regra do item 2 abaixo faria esses fluxos pararem.

**Comportamento esperado**

1. **Publicar e dry-run recusam** quando Output, Condição (também nas regras de grupo), Revisão ou Escalonar apontam para uma etapa que não existe ou que não vem antes no fluxo.
   - A resposta é 422, com a etapa em `details.nodeId` e os mesmos códigos do editor: `WORKFLOW_INVALID_OUTPUT`, `WORKFLOW_INVALID_CONDITION`, `WORKFLOW_INVALID_HUMAN_REVIEW`, `WORKFLOW_INVALID_ACTION`.
   - Mensagem: "O conteúdo de "X" vem de uma etapa que não existe mais" ou "…que não vem antes dela no fluxo".
   - `variables.<id>` e `nodeOutputs.trigger` continuam válidos.
   - Uma regra só, num arquivo novo (`publish-validation/node-references.ts`). O editor ganha a mesma regra de "fora do caminho", e o teste de paridade garante que as duas continuem iguais.
2. **Ao rodar, conteúdo ausente nunca vira entrega vazia.** Vale para versões já publicadas e para o limite da regra acima: "vem antes" significa haver um caminho, não que a etapa rodou neste ramo.
   - Output ou Escalonar com origem configurada e `undefined`: falha sem entregar nada, com o motivo registrado e sem repetir (a versão é fixa).
   - Revisão com `contentSource` configurado e `undefined`: bloqueia como em P5c, com o motivo `HUMAN_REVIEW_CONTENT_MISSING`. Ninguém decide sem ver o conteúdo.
3. **Origem em variável funciona** em Output, Revisão e Escalonar, com a mesma leitura que Condição e Definir variável já usam (`resolveContextValue`), respeitando tipo e disponibilidade:
   - **Tipo:** texto como está, número no formato brasileiro, verdadeiro/falso como Sim/Não. `false` e `0` são valores, nunca ausência.
   - **Disponibilidade:** a publicação exige que a variável exista e que uma etapa anterior a defina, e o seletor só oferece essas. Sem valor na hora de rodar, vale o item 2, com o motivo explícito.
   - **Onde não serve:** no Acompanhamento do próprio colaborador, que precisa do resultado inteiro de uma análise. A publicação recusa, como a tela já não oferecia.

**Compatibilidade com workflows existentes**

- **Versões publicadas não mudam:** o grafo é o mesmo e a publicação não revalida o que já está no ar. Religar um workflow não passa pela validação de publicação (só `publish-workflow.ts:46` e o dry-run a chamam).
- **Execuções em andamento** continuam na versão em que começaram. Só a regra do item 2 as alcança, na próxima etapa que visitarem.
- **Republicar** um rascunho com referência quebrada passa a ser recusado. É o desejado, e a tela aponta a etapa.
- **Levantamento em dev:** nas 32 versões no ar (59 referências) e nos 63 rascunhos (144 referências), **nenhuma ausente e nenhuma fora do caminho**. Só 2 versões antigas de "SMOKE · Workflow Outputs V1" têm referência ausente, sem execução em andamento e desligadas.
- **Os 22 modelos oficiais** estão entre os rascunhos e não têm referência quebrada. `official-model-workflows` precisa continuar passando.
- **Risco aceito no item 2 (D2):** um fluxo com ramos que hoje entrega o aviso vazio no ramo sem a origem passa a parar com motivo. O levantamento não detecta esse caso, pois depende do ramo seguido.
- **Item 3:** quem usa origem em variável passa a receber o valor, em vez do aviso sem conteúdo. O levantamento conta esses casos (`origemEmVariavel`); em dev são 0.

**Testes**

- `node-references.parity.test.ts`: Output, Condição simples, regra de grupo, Revisão e Escalonar, ausente e fora do caminho, com o mesmo código nos dois lados; variável apagada, não definida antes e no Acompanhamento; controles com a origem certa, `nodeOutputs.trigger` e `variables.<id>`.
- `official-model-workflows`: os 22 modelos continuam publicáveis.
- Prova `workflow-broken-reference-proof` (API real e banco de teste):
  - rascunho com referência quebrada salva;
  - `/validate` responde `valid:false` com `nodeId`;
  - `/publish` responde 422 e não cria versão;
  - versão já publicada com a referência roda até a etapa e para com o motivo, sem aviso, em Output, Escalonar e Revisão;
  - origem presente e `variables.<id>` entregam o valor, em cada tipo, no aviso, no Chat, na Revisão e no detalhe de Pendências;
  - variável sem valor ou em branco para com o motivo;
  - QA Lab com rascunho de origem ausente mostra a falha com o motivo.
- Continuam verdes: `workflow-incomplete-draft-proof`, `workflow-draft-configuration-proof`, `manual-run-proof` e `workflow-engine`.

### P5c · Revisão humana sem revisor

**Como era antes da implementação** (leitura de código). `notifyHumanReviewPending` não notificava ninguém e a etapa entra em espera até 2999, sem motivo registrado (`human-review-executor.ts:36-47,68-69`, `node-handlers.ts:43,560`). Como a pendência nasce do aviso (`reviewAlertsCte` em `pending-actions-repository.ts`), ninguém é avisado e nada aparece em Pendências. Só a aba Execuções mostra a espera.

| Caso | Hoje | Em dev |
|---|---|---|
| Ninguém com o cargo acima do colaborador | Espera para sempre, sem aviso | Sem Supervisor: **24 de 2.290** operadores ativos. Sem Coordenador: **1.151**. Sem Gerente: 17 |
| Revisor relativo sem decisão anterior (o ramo pulou a revisão) | Espera para sempre; `human-review-executor.test.ts:87` registra como "best-effort" | Não medido |
| Revisor encontrado, mas inativo (`resolveByRoleChain` não olha `active`; pessoa fixa só é conferida ao publicar) | Avisa quem não entra mais; espera para sempre | 0 operadores com esse caso |
| Só o próprio colaborador | Lança erro e falha como não classificado (achado C16) | — |

Escalonar já não falha em silêncio (`escalate-executor.ts:50-53`). A revisão é a única que fica parada sem dizer.

**Comportamento esperado: "Bloqueada — sem revisor"**

- Na primeira visita à etapa, sem revisor ativo, além do próprio colaborador, **nenhum aviso é criado** e a execução fica `blocked`, com `blocked_reason = HUMAN_REVIEW_NO_REVIEWER`, a etapa e o caso em `blocked_details` (`NO_ONE_IN_CHAIN`, `PREVIOUS_REVIEW_NOT_DECIDED`, `REVIEWER_INACTIVE`, `ONLY_THE_COLLABORATOR`), sem nomes. O evento é `node_blocked`.
- **Por que bloquear, e não encerrar com falha como Escalonar:** o defeito é de cadastro ou de configuração. Repetir sozinho não adianta, e encerrar jogaria fora o que já foi pago de IA. O bloqueio já existe (PEN-073): mantém os resultados e aceita "Nova tentativa" confirmada, que continua da etapa bloqueada na mesma versão (`workflow-retry.ts:185,268`), sem nova chamada de IA.
- **Tela de Execuções:** "Bloqueada — sem revisor", com o caso em linguagem clara ("Este colaborador não tem Supervisor na hierarquia") e a orientação "Ajuste a hierarquia ou o revisor da etapa e solicite uma nova tentativa".
- **Nova tentativa:** a prévia confere o revisor de novo. Se continuar sem, mostra um impedimento e não deixa confirmar, pois em versão diferente a tentativa recomeça do gatilho e gastaria IA à toa.
- **Consolidado:** `consolidate-results-executor.ts:58,78` já conta `blocked` como resultado que não chegou.
- **Pendências e sino:** a definição de pendente não muda. Bloqueada não é pendência.
- **Revisor do cargo inativo (D3):** bloqueia, sem subir na cadeia. Mudar quem decide é decisão de negócio, e a pessoa inativa como gestora é dado a corrigir.
- **Quem é avisado (D1):** quem publicou a versão vigente (`workflow_versions.created_by`) **e mantém acesso ao workflow**, pelo sino, **mesmo sendo o colaborador da execução**. O destinatário decorre da responsabilidade pela publicação.
  - No máximo um aviso por workflow e etapa por dia, com a chave `workflow_execution_blocked:<workflow>:<etapa>:<data civil da organização>`.
  - **Quem perdeu a permissão não recebe.** Ao bloquear, a permissão `workflows.manage` no alcance do workflow é conferida; sem ela, nenhum aviso é criado.
  - **A perda de permissão vale também para o aviso já criado.** A linha gravada é genérica, sem workflow, etapa ou colaborador. Na leitura, o sino acrescenta workflow, etapa e destino só se a pessoa ainda tiver acesso; sem isso, o aviso some da lista e da contagem de não lidos.
  - **O nome do colaborador nunca aparece no aviso.** A rota de Execuções continua conferindo a permissão por conta própria.
  - Vale para os dois motivos de revisão (`HUMAN_REVIEW_NO_REVIEWER` e `HUMAN_REVIEW_CONTENT_MISSING`). O bloqueio por agente continua sem aviso, pois ficou fora desta decisão.
- **Versão sem publicador ativo, ou publicador sem acesso:** ninguém é avisado, e nada escolhe outra pessoa no lugar. Em dev, 6 das 32 versões no ar não têm autor. Por isso a lista de workflows mostra a contagem de execuções bloqueadas, para todos os casos.
- **Nunca:** escolher outro revisor sozinho, aprovar sozinho ou deixar o colaborador revisar o próprio resultado.
- **Escalonar** continua falhando como hoje, mas o filtro de pessoa ativa fica em `resolveHierarchicalTargetIds`, compartilhado, e também evita avisar quem está inativo.

**Compatibilidade com workflows existentes**

- **Execuções já em espera não mudam:** a notificação só ocorre na primeira visita (`status = 'active'`, `node-handlers.ts:545`), e elas não são retomadas pelo motor. Nada é migrado sozinho. Quem estiver parado sem aviso continua podendo ser decidido em Execuções; o levantamento lista os casos.
- **Em dev:** 1 execução em espera (massa demo), com aviso vivo; nenhuma parada sem aviso. Há 2 revisões em versões no ar, ambas para o Supervisor do colaborador, 1 em workflow ligado.
- **Versões publicadas:** o grafo não muda; muda o que acontece nas próximas visitas à etapa.
- **Banco:** `blocked_reason` (migration 164) e `alerts.alert_type` são texto livre, e `alerts.case_id` aceita vazio, então não é preciso alterar estrutura. O comentário da coluna `blocked_reason` (166) lista os valores; atualizá-lo é opcional.
- **Backend e frontend precisam ir juntos:**
  - `blockReasonOf` (`enrollment-format.ts:61`) trata motivo desconhecido como "agente inativo", e diria algo falso;
  - "Bloqueada na etapa do agente" (`enrollment-format.ts:34`);
  - "bloqueada por agente inativo" (`workflow-retry.ts:229`);
  - `blockedNode.agentName` na prévia;
  - o destino novo do sino (`build-notification-summary.ts`, `notifications/domain/view-models.ts`, `notifications.schema.ts` e `notification-bell.tsx`): o tipo `WORKFLOW_EXECUTION_BLOCKED` abre `/admin/workflows/<id>` na aba Execuções.
- **Lista de workflows:** a contagem atual só soma `active` e `waiting` (`workflow-router/shared.ts:47`) e continua igual. A de bloqueadas é um campo novo, sem efeito nos filtros existentes.
- **Limite:** a publicação não avisa quantos colaboradores ficariam sem revisor. Exigiria percorrer a hierarquia de todos os elegíveis, e fica como evolução de `publish-impact`, fora desta rodada.

**Testes**

- Prova `workflow-human-review-no-reviewer-proof` (API real, banco de teste, motor real, sem IA):
  - um teste por caso da tabela, com estado `blocked`, motivo, etapa, evento, `node_outputs` preservados, sem `next_eval_at` em 2999, sem aviso de revisão e sem nome de pessoa no motivo;
  - D3: revisor inativo com outro do mesmo cargo acima não sobe na cadeia;
  - controles: revisor ativo avisa igual, execução que já esperava não é tocada, e Escalonar sem ninguém continua falhando;
  - Escalonar não avisa quem está inativo;
  - nova tentativa: sem correção, a prévia mostra o impedimento; corrigida a hierarquia, o aviso sai, o resultado anterior é mantido, e a decisão termina o fluxo. Corrigir a hierarquia não cria tentativa sozinho.
- `enrollment-format.p5c`: motivo certo na tela, sem citar agente; motivo desconhecido deixa de virar "agente inativo"; execução antiga sem motivo continua como antes.
- O teste "best-effort" de `human-review-executor.test.ts` mudou de propósito: agora exige o bloqueio.
- Na mesma prova: Consolidar resultados contando a filha bloqueada, com o motivo; filha bloqueada na revisão, na mesma versão e em versão nova; QA Lab mostrando "sem revisor" e o aviso como efeito simulado; nova tentativa em versão diferente; conteúdo ausente na nova tentativa.
- `manual-run-dialog`: diálogo de Executar agora com o motivo real.
- O aviso de D1 não vira pendência: nem na lista de Pendências, nem na contagem do sino. Os contadores da Equipe usam a mesma definição de pendente.
- Aviso de D1 (`human-review-executor` ou `engine`):
  - chega a quem publicou, uma vez por workflow, etapa e dia, mesmo com várias execuções bloqueadas;
  - volta a avisar no dia seguinte;
  - não traz o nome do colaborador;
  - sem autor ou com autor inativo, nenhum aviso e nenhum erro: a execução bloqueia igual;
  - quem publicou recebe mesmo sendo o colaborador da execução, com o mesmo conteúdo.
- Permissões atuais, pela API do sino:
  - com permissão: workflow, etapa, motivo e destino, sem o colaborador;
  - sem permissão, com permissão só em outro grupo, ou sem conta ativa: nenhum aviso é criado;
  - permissão revogada depois do aviso: o aviso some da lista e da contagem de não lidos;
  - controle: a rota de Execuções recusa quem não tem permissão.
- `notification-target.p5c`: destino novo no contrato e a rota da aba Execuções; `workflow-editor-page`: abertura pela aba de `?tab=`.
- Contagem de bloqueadas na API, no cartão e na tabela (`workflows-page.p5c`).
- Aviso fora do Acompanhamento, com um aviso de controle que continua lá.
- Prova nova `workflow-human-review-no-reviewer-proof` (API real, banco de teste, efeitos falsos): operador sem Supervisor → `blocked`; ajustar `reports_to` → nova tentativa → aviso → decisão → fluxo termina; execução antiga em espera não é tocada.
- Continuam verdes: `manual-run-proof`, `workflow-engine` e `agent-lifecycle-proof`.
- Wiki: `wiki/workflows/human-review` e `erros-limitacoes` descrevem o novo estado.

### Decisões tomadas (04/11/2026)

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Quem é avisado de "Bloqueada — sem revisor"? | Quem publicou a versão vigente e mantém acesso ao workflow, pelo sino, com um aviso por workflow e etapa por dia, mesmo sendo o colaborador da execução. Quem perdeu a permissão não recebe. O aviso não traz o nome do colaborador. Versão sem publicador ativo não avisa ninguém, e a contagem de bloqueadas na lista cobre esses casos |
| D2 | Ramo que chega ao Output sem a origem: parar ou manter o aviso vazio? | Parar com motivo. Vale para Output, Escalonar e Revisão já na 1ª rodada |
| D3 | Revisor do cargo inativo: bloquear ou subir na cadeia? | Bloquear, sem subir na cadeia |

### Verificação anterior à implantação

**O levantamento em homologação deixou de ser condição para desenvolver (decisão de 04/11/2026). Ele é obrigatório antes de implantar P5b e P5c.** Os números de desenvolvimento não substituem esta verificação.

**Estado: não executado.** Nesta etapa o Azure não foi acessado.

**O que falta para rodar** (conferido em 04/11/2026)

A aplicação de homologação responde (`/health` 200), mas o banco fica dentro da máquina virtual `inia-app`: a porta 5432 não responde de fora, e esta sessão não tem Azure CLI nem acesso à máquina.

| Falta | Quem providencia |
|---|---|
| Uma sessão no portal do Azure com permissão de "Executar comando" na `inia-app` (grupo `rg-inia-homolog`), ou Bastion | Quem tem a conta entra no próprio navegador. **Nenhuma senha passa pelo chat** |
| Autorização para rodar o script nessa máquina, onde o comando executa como SYSTEM, ainda que só leia | O dono do ambiente |
| Decidir quem executa: a própria pessoa cola e roda, ou o agente opera no navegador dela, com aprovação de cada ação. O modo automático já recusou ações administrativas nessa máquina | O dono do ambiente |

**Prazo:** pelas anotações do projeto, o crédito do Azure termina em 13/11/2026. Depois disso, a máquina pode não estar disponível.

**Como rodar, sem credencial no chat.** O script não está na máquina, pois é mais novo que o último commit implantado (anotações do projeto, 30/10/2026). No "Executar comando", em PowerShell:

1. Grave o script na máquina, colando o conteúdo de `levantamento-p5.mjs` entre as marcas:

   ```powershell
   @'
   (conteúdo de levantamento-p5.mjs)
   '@ | Set-Content -Encoding utf8 "$env:TEMP\levantamento-p5.mjs"
   ```

2. Rode. Ele lê o endereço do banco no `.env` da própria máquina, abre a conexão como somente leitura e não imprime o endereço:

   ```powershell
   $env:INIA_BACKEND_DIR = 'C:\inia\backend'
   node --env-file=C:\inia\backend\.env "$env:TEMP\levantamento-p5.mjs"
   ```

3. Apague o script e traga a saída para cá. Ela tem contagens e nomes de workflows e etapas; o script não consulta nomes de pessoas nem imprime o endereço do banco. Em dev a saída teve 1,6 KB, abaixo dos 4 KB que o portal mostra.

   ```powershell
   Remove-Item "$env:TEMP\levantamento-p5.mjs"
   ```

**O que cada resultado muda**

| Resultado | O que fazer antes de implantar |
|---|---|
| `ausente` ou `fora do caminho` em versão no ar | Passar a lista ao dono do workflow: com a P5b, esses ramos param com motivo |
| Execuções em andamento em versão com referência quebrada | Decidir o que fazer com elas: a regra de execução as alcança na próxima etapa |
| `origemEmVariavel` acima de 0 | Avisar: esses fluxos hoje entregam sem o valor e passarão a entregar o valor |
| `sem_aviso_vivo` acima de 0 | Execuções paradas hoje: decidir em Execuções, pois nada é migrado sozinho |
| `sem_na_cadeia` alto em cargo usado por revisão no ar | Prever quantas execuções vão bloquear e corrigir a hierarquia, ou aceitar o volume de avisos |
| Versões `sem autor` | Não haverá aviso para elas: só a contagem na lista |
| Poucos workflows publicados | Registrar: o levantamento prova pouco nesse caso, e o resultado precisa ser repetido antes de produção |

**Registro**

| Data | Quem rodou | Última migration do banco | Resultado | Decisão |
|---|---|---|---|---|
| — | — | — | Não executado | Implantação aguardando |

### Aplicação

- **Implantar:** passar pela [verificação anterior à implantação](#verificação-anterior-à-implantação). Backend e frontend precisam ir juntos: o sino valida o destino novo, e o motivo novo de bloqueio só aparece certo com a tela nova.
- **Pendência:** a verificação acima, descrita no [registro](registro-de-achados.md#pendências-da-p5). A contagem do sino (WF-43) foi corrigida e juntada em `10cc428f`. A migration 170 só melhora o desempenho, e `npm run update` a aplica na implantação.
- **Depois:** itens a, d, e, f, g e h, cada um com teste. (d) pode exigir migration.

## P6 · Onde se decide uma revisão humana

- **Antes:** a aba Execuções decide por qualquer gestor do escopo, sem mostrar o conteúdo, e Pendências decide pelo revisor designado, com conteúdo. Agora há confirmação em Execuções, mas continua sem conteúdo.
- **Alternativas:**
  - **A (recomendada):** Execuções só mostra "Aguardando revisão de <pessoa>" e leva a Pendências; gestor assume com ação explícita "Decidir no lugar do revisor", com conteúdo e auditoria.
  - **B:** manter como está, com a confirmação.
- **Impacto:** A muda quem decide na prática; decisão de produto.
- **Aceite (A):** nenhuma decisão sem conteúdo visível; decisão por outra pessoa fica registrada como tal.

## P7 · Versões visíveis

- **Antes:** a versão aparece só no detalhe de uma execução. Não há número da versão vigente, histórico nem volta.
- **Depois:** o cabeçalho mostra "No ar · versão N, publicada em <data> por <pessoa>". Um histórico mostra as versões e permite "Abrir como rascunho", como o [Zapier](https://help.zapier.com/hc/en-us/articles/9693520498445-Create-Zap-drafts-and-versions) faz. Restaurar nunca altera o que está no ar até publicar.
- **Impactos:** `GET /:id/versions`; a tabela `workflow_versions` já guarda grafo e configuração.
- **Aceite:** é possível ver o que mudou entre versões e voltar sem afetar produção.

## P8 · Vocabulário

**Decisão de produto**, pois aparece em Wiki, testes, mensagens e materiais. Sugestão a validar com H5:

| Hoje | Proposta | Motivo |
|---|---|---|
| Output | Entregar resultado | Termo em inglês; diz a ação |
| Nó | Etapa | A tela nova já usa "etapa"; a Wiki e as mensagens ainda usam "nó" |
| Flag de canal | Sinal da interação | "Flag" é jargão técnico; confirmar com a operação |
| Abrangência, Alvo, População | Onde vale, Quem é avaliado | Três termos próximos |
| Agent | Agente | Mistura de idiomas |
