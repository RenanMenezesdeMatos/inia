# Ciclo de vida dos agentes — exclusão, desativação, versões, orquestradores e nova tentativa

Implementado em 03/11/2026 no ambiente de desenvolvimento (migrations 164, 165 e 166). **Não publicado em produção**: a publicação exige autorização separada.

> **Revisão aprovada da PEN-002 e da PEN-076 (03/11/2026) — atualização automática.** Substitui a fixação de versões de agente em Workflows e orquestradores, que este documento descrevia antes.
> - Publicar torna a versão vigente para as próximas execuções de **todos** os consumidores, sem republicá-los.
> - Cada execução resolve e registra a vigente no início e fica nela até terminar.
> - Versões de Workflow continuam preservando etapas, destinos e aprovações; versões do orquestrador, a configuração dele.
> - Condição de segurança: a autorização é conferida a cada execução (seção 2.1) e a prévia da publicação mostra o impacto.

Decisões funcionais implementadas (ESP-INIA-03 §4.1; matriz por critério em ESP-INIA-03 §4.3):

- **PEN-001**: exclusão só sem uso nem dependências; desativação; inativos restritos a administradores. Complementos **PEN-065 a PEN-075**.
- **PEN-002**: rascunho, publicação, versões imutáveis e reversão.
- **PEN-049**: teste do rascunho salvo ou de uma versão publicada.
- **PEN-050**: conflito de edição sem sobrescrita silenciosa.
- **PEN-076**: versões do orquestrador.
- **PEN-047**, só o ponto "não publicado".

**PEN-032** (perfis da Vivo) e **PEN-059** continuam abertas.

## 1. Modelo de dados (migration 164)

| Objeto | O que é |
|---|---|
| `agents` (colunas de sempre + `agent_knowledge_documents`) | A **versão vigente**. Agente nunca publicado: a linha acompanha o rascunho, mas nada o executa fora do teste. |
| `agents.current_version_id` | Versão vigente. `null` significa nunca publicado: só testes (PEN-047). |
| `agents.draft_config` + `draft_revision` + `draft_updated_at/by_name` | O rascunho, com a configuração inteira (`AgentConfig`, `agents/domain/agent-config.ts`). `draft_revision` é a trava otimista da PEN-050. |
| `agent_versions` | Versões **imutáveis**: número sequencial, `config` (mesmo formato do rascunho), origem (`MIGRATION`/`PUBLISH`/`REVERT`), quem publicou e quando. O gatilho `inia_published_version_immutable` recusa UPDATE e DELETE direto. Só sai em cascata, quando o próprio agente é excluído, e a exclusão só acontece sem uso. |
| `agent_runs.agent_version_id` / `run_target` / `tested_config` | Versão usada em cada execução. Teste do rascunho: `run_target = DRAFT` e o conteúdo testado em `tested_config` (PEN-049). |
| `assistant_interaction_agents` | Agentes que atuaram em cada mensagem do chat ou da voz: papel, versão, orquestrador e versão dele, e resultado (`EXECUTED`/`BLOCKED_INACTIVE`). É histórico de uso (PEN-065) e alimenta "Ver histórico desta conversa". |
| `assistant_orchestrator_versions` + `assistant_orchestrators.current_version_id` | Versões imutáveis da **configuração** do orquestrador: especialistas, política, resultado estruturado e materiais. Desde a 166 não registram versão de agente; as gravadas antes mantêm o que registraram, como histórico. |
| `assistant_orchestrator_specialists.agent_version_id`, `assistant_orchestrators.orchestrator_agent_version_id` | Sem uso desde a 166 (anulados e comentados). Os agentes rodam na vigente. |
| Grafo do Workflow: `orchestratorVersionId` (Orquestrador) | Versão da **configuração** do orquestrador referenciada pela etapa (PEN-076). A `agentVersionId` em "Chamar agente" é legado: a 166 a tirou dos rascunhos, versões publicadas antigas a mantêm como histórico, e o motor a ignora. |
| `workflow_enrollments.status = 'blocked'` + `blocked_*` + `retry_*` | "Bloqueada — agente inativo" e nova tentativa vinculada (PEN-073 a PEN-075). |

Migration 165: o índice único do slot de agenda (`workflow_id, scheduled_subject_id, scheduled_for`) deixa de valer para tentativas (`retry_of_enrollment_id is not null`). A tentativa é uma execução nova do mesmo colaborador e horário; a original nunca é alterada.

Migration 166 (revisão):
- tira `agentVersionId` dos rascunhos de Workflow;
- anula e comenta as colunas de fixação do orquestrador;
- acrescenta o resultado `BLOCKED_UNAUTHORIZED` às participações;
- documenta o motivo `AGENT_ACCESS_NOT_AUTHORIZED` do bloqueio;
- refaz o índice único do envio coletivo (`parent_enrollment_id, fan_out_node_id, scheduled_subject_id`) sem as tentativas.

**Defeito encontrado e corrigido junto:** os dois `on conflict` (agenda e envio coletivo) passaram a repetir a condição do índice parcial; sem ela, o Postgres não reconhece o índice.
- O da agenda tinha deixado de reconhecer depois da 165.
- O do envio coletivo nunca tinha rodado contra o banco real: não havia nenhuma execução filha no desenvolvimento.

### Estratégia de transição (aplicada pela migration 164)

- Cada agente existente ganha a **versão 1** (origem `MIGRATION`), com a configuração em uso, e passa a tê-la como vigente. Nada é apagado e nenhum agente desativado é reativado.
- Cada orquestrador ganha a versão 1, com as versões vigentes dos agentes. Desde a 166 essas versões de agente ficam só como histórico.
- Conversas antigas viram participações (`assistant_interaction_agents`), lidas de `assistant_interactions.agent_id` e das ferramentas `agent_<id>` gravadas.
- Só os **rascunhos** dos Workflows receberam `agentVersionId`/`orchestratorVersionId` explícitos. Versões já publicadas de Workflow não foram reescritas. *(Revisão, 166: a `agentVersionId` saiu dos rascunhos e o motor a ignora; a `orchestratorVersionId` continua.)*
- Agentes inseridos fora da API depois da migration (scripts de dev) não têm versão. Precisam ser publicados pela tela para rodar fora do teste.

**Resultado no banco de desenvolvimento `inia` (03/11/2026)**:

- As migrations 163, 164 e 165 foram aplicadas.
- As contagens antes e depois são iguais: 58 agentes (1 inativo, que continua inativo), 158 vínculos com bases, 120 registros de histórico, 798 execuções, 18 orquestradores, 54 especialistas, 62 Workflows (13 ativos), 37 versões publicadas, 2.478 execuções de Workflow, 960 interações e 67 bases.
- Os hashes são idênticos para a configuração viva dos 58 agentes, os grafos das 37 versões publicadas de Workflow e as execuções encerradas.
- Todos os agentes e orquestradores têm versão vigente.
- As 54 etapas "Chamar agente" dos rascunhos foram fixadas. *(Revisão: a 166 tirou essas fixações.)*
- 112 participações em conversas foram recuperadas.

**Resultado da migration 166 no `inia` (03/11/2026):**
- Os hashes são idênticos antes e depois para: configuração viva dos agentes, `agent_versions`, versões dos orquestradores, `workflow_versions`, `agent_runs`, participações e os rascunhos (sem contar a `agentVersionId`).
- Continuam 57 agentes ativos e 1 inativo, 54 vínculos de especialista e 2.478 execuções de Workflow.
- Sobraram 0 `agentVersionId` nos rascunhos e 0 fixações nos orquestradores.

## 2. Servidor

- **Versões do agente**: `agents/application/agent-versions.ts` faz salvar rascunho, publicar, descartar, reverter e resolver a versão de uma execução. As rotas estão em `agents/presentation/agent-router.ts`:
  - `PATCH /:id` grava o **rascunho**. `expectedDraftRevision` diferente da atual devolve `409 AGENT_DRAFT_CONFLICT`. `active` vale na hora.
  - `POST /:id/publish`, `/:id/draft/discard`, `/:id/versions/:vid/revert`. Reverter com rascunho em andamento exige `discardDraft: true`; sem isso, devolve `409 AGENT_DRAFT_PENDING`.
  - `GET /:id/versions(/:vid)`, `/:id/runs/:runId` (conteúdo testado) e `/references?ids=` (nome, status e versões, inclusive de inativos, sem o cadastro).
  - `POST /:id/test`: `target: DRAFT | VERSION` e `versionId`.
- **Execução por versão**: quem inicia a execução resolve a versão e roda dentro de `agents/application/agent-runtime-context.ts` (AsyncLocalStorage).
  - Em produção é sempre a **vigente** (revisão): Workflow (`workflow-agent-version.ts`), orquestrador na montagem (`resolve-orchestrator.ts`) e especialista de novo na hora da chamada (`specialist-availability.ts`, no chat e na voz).
  - No teste manual: o rascunho salvo ou a versão escolhida. Prompt (`build-system-prompt.ts`), bases (`retrieve-knowledge.ts`, `feedback-engine/infrastructure/postgres-engine-loaders.ts`), limites (`agent-guardrails.ts`), especialista (`run-specialist-tool.ts`) e síntese lêem a versão do contexto. Fora dele, as colunas vivas, que são a vigente.
- **Autorização na hora de começar** (PEN-070):
  - `runAgent` e `withWorkflowAgent` lançam `AgentInactiveError` para agente inativo e `AGENT_NOT_PUBLISHED` para agente sem versão.
  - O motor (`engine.ts → markBlocked`) deixa a execução `blocked`, com evento `node_blocked` e sem tentativa automática.
  - No chat, o especialista desativado durante a resposta não roda: o colaborador recebe só a explicação de que aquela parte está indisponível, e a participação fica gravada como `BLOCKED_INACTIVE`.
  - Chamada já monitorada continua sendo pulada antes da autorização, porque a execução do agente nunca começa.
- **Exclusão** (`agents/application/agent-deletion.ts`):
  - Conta como uso qualquer `agent_runs` (inclusive pendente), participação em conversa e análise de feedback.
  - Conta como dependência: Workflow (rascunho, versão vigente ou versão de execução em andamento) e orquestrador (ativo ou inativo).
  - Referência fora do alcance aparece só como aviso.
  - A exclusão trava a linha do agente (`FOR UPDATE`) e o registro de execução a trava em `FOR SHARE` (`effect-sink.ts`). Nunca fica execução registrada para agente excluído.
- **Inativos**: listar, ler, consultar histórico, execuções e versões, reativar e excluir exigem a permissão nova `agents.inactive.manage` no alcance do agente. Hoje ela está nos papéis ADMINISTRADOR_GERAL e ADMINISTRADOR. Quais perfis da Vivo a terão é a PEN-032. Sem a permissão, o servidor devolve `403 AGENT_INACTIVE_RESTRICTED` e a lista nunca traz inativos.
- **Orquestrador** (`assistant/application/orchestrator-versions.ts`):
  - Toda gravação publica uma versão nova da configuração (`specialists: [{agentId, toolName}]`), sem versão de agente.
  - A tela mostra a versão vigente de cada agente; publicar um agente muda o que o orquestrador executa sem gravar o orquestrador.
  - Agente nunca publicado devolve `422 ORCHESTRATOR_AGENT_NOT_PUBLISHED`.
  - `expectedVersionId` desatualizado devolve `409 ORCHESTRATOR_VERSION_CONFLICT`.
- **Workflow**:
  - A publicação fixa só a versão do orquestrador onde a etapa não tinha (`pinGraphReferences`).
  - A validação recusa agente não publicado (`WORKFLOW_AGENT_NOT_PUBLISHED`) e versão de outro orquestrador.
  - "Executar agora" recusa também agente cuja vigente não cobre o alcance do Workflow (`WORKFLOW_AGENT_NOT_AUTHORIZED`).
- **Nova tentativa** (`workflows/application/workflow-retry.ts`; `GET|POST /admin/workflows/:id/enrollments/:eid/retry`):
  - A prévia mostra a versão publicada e vigente do Workflow, a versão **vigente** de cada agente (também os do orquestrador), os destinos e as aprovações.
  - Valem os mesmos impedimentos do "Executar agora", mais o Workflow desligado (mensagem da PEN-075).
  - A confirmação leva a impressão digital do que foi visto. Se algo mudou, devolve `409 WORKFLOW_RETRY_RECONFIRM` e nada começa.
  - Só uma tentativa por vez por cadeia.
  - Mesma versão do Workflow: continua da etapa bloqueada com os resultados anteriores. Versão diferente: recomeça do Gatilho e reavalia tudo.
  - Na hora da chamada, a vigente é resolvida e conferida de novo. Se alguém publicou depois da confirmação, a execução registra as duas: a apresentada (no evento da confirmação) e a usada (em `agent_runs`).
  - **Execução filha de envio coletivo** (revisão): aceita tentativa, que vira filha da mesma execução principal (`parent_enrollment_id`, `fan_out_node_id`) e herda o colaborador. Versão diferente recomeça no nó seguinte ao envio (`AFTER_FAN_OUT`). A original deixa de contar na barreira e no consolidado (`consolidate-results-executor.ts › NOT_SUPERSEDED`).
  - Entregas já feitas pela cadeia não se repetem (`priorChainDelivery`, só para tentativas).
- **Históricos contextuais** (PEN-071), cada um visível só para quem vê o contexto, nunca o cadastro do inativo:
  - `GET /admin/workflows/:id/enrollments/:eid/agent-records`
  - `GET /admin/assistant-conversations/:id/agent-records`, com o motivo "Agente inativo" e a orientação, só para quem lê a conversa
  - `GET /supervision-cases/:id/agent-records`

### 2.1 Condição de segurança da revisão (`agents/application/agent-execution-authorization.ts`)

Em cada execução, no contexto dela:
- **Organização:** a versão só é lida na organização do agente.
- **Alcance:** a versão vigente precisa cobrir o alcance do consumidor. No "Chamar agente", o consumidor é o Workflow; para os especialistas e o agente orquestrador, é o orquestrador.
- **Bases:** toda base existente da versão precisa ser da organização e continuar autorizada para o alcance da versão.

Se a conferência falhar:
- **Workflow:** a execução fica `blocked` com o motivo `AGENT_ACCESS_NOT_AUTHORIZED`, sem o agente executar. O motivo é genérico: "alcance" ou "bases", sem nomes.
- **Especialista do orquestrador:** sai das ferramentas e fica um registro em `audit_logs` (`AGENT_EXECUTION_BLOCKED`, uma vez por agente × versão × consumidor × motivo).
- **Chamada no chat ou na voz:** o colaborador vê ou ouve que a parte está indisponível, e a participação fica como `BLOCKED_UNAUTHORIZED`.
- **"Executar agora" e nova tentativa:** recusam pelo mesmo motivo (`WORKFLOW_AGENT_NOT_AUTHORIZED`).

Ferramentas: as da versão continuam limitadas pela restrição da etapa (`effectiveCapabilities`) e investigam só o sujeito e a organização da execução. Publicar não concede permissão a ninguém.

**Prévia da publicação** (`GET /admin/agents/:id/publish-impact`, `agent-publish-impact.ts`):
- consumidores visíveis, com `losesAccess` quando o alcance novo deixaria de atendê-los;
- o aviso de consumidores restritos, sem dados deles;
- as mudanças em bases, ferramentas, alcance, limites e outros campos.

## 3. Telas

- **Agente** (`components/admin/agents/`, partes em `agent-lifecycle/`):
  - Barra de situação: versão vigente, "Não publicado", rascunho pendente, *Publicar*, *Descartar rascunho*.
  - *Publicar* (`publish-dialog.tsx`) e *Reverter* (`versions-panel.tsx`) mostram a prévia de impacto antes de confirmar: consumidores visíveis, "Perde o acesso", aviso dos restritos, e as mudanças em bases, ferramentas, alcance e limites. Sem a prévia carregada, o botão de confirmar fica desabilitado.
  - *Salvar rascunho*; aviso de conflito com "Atualizar e guardar minhas alterações" e depois "Reaplicar minhas alterações".
  - Aba *Versões* (ver configuração, reverter com confirmação do rascunho e a prévia da versão escolhida contra a vigente: `publish-impact?versionId=`).
  - Teste com escolha de rascunho ou versão e o aviso de alterações não salvas; execuções com a versão ou "Teste do rascunho" e "Ver conteúdo testado".
  - Exclusão com explicação, referências visíveis com link, aviso de referências restritas e oferta de desativar.
  - A lista abre em *Ativos*; o filtro de status só aparece para quem administra inativos.
- **Seletores de agente** (`workflows/agent-picker.tsx`): "Não publicado" aparece desabilitado nos seletores de produção. O QA Lab testa o rascunho.
- **Editor de Workflow**: a etapa diz que usa sempre a versão vigente do agente (`node-config/agent-version-field.tsx`); a etapa com agente inativo ou não publicado fica destacada. A etapa Orquestrador mostra a versão da configuração e oferece usar a vigente.
- **Execuções do Workflow** (`workflows/enrollments/`): o status mostra o motivo ("Bloqueada — agente inativo" ou "— acesso não autorizado"); a nova tentativa mostra a versão vigente de cada agente (também os do orquestrador) e, na execução filha, o vínculo com a principal; o detalhe distingue "confirmada com a versão N; executada na versão M". O "Executar agora" mostra o motivo do bloqueio (`blockedReason` na resposta).
- **Orquestrador** (`assistant/orchestrator-editor/`): cada agente mostra a versão vigente, "Agente inativo" ou "Não publicado"; a gravação não envia versão de agente.
- **Conversa**: o histórico do agente aceita "Chamada impedida — acesso não autorizado".

## 4. Como rodar

```bash
cd backend && npm run db:migrate          # banco de desenvolvimento (aplica 164 e 165)
cd backend && npm run db:migrate:test     # banco de teste
cd backend && INIA_DB_PROOF=1 npx vitest run agent-lifecycle-proof   # prova contra o banco de teste (zero chamada paga)
cd backend && npx vitest run src/modules/agents src/modules/assistant src/modules/workflows src/modules/qa-lab
cd frontend && npx vitest run src/components/admin/agents src/components/admin/workflows src/components/admin/assistant
```

A prova `agent-lifecycle-proof` acrescenta **só nela** um papel de teste com `agents.manage` e sem `agents.inactive.manage`, para provar a restrição no servidor. Nenhum papel de sistema tem essa combinação hoje: a PEN-032 vai definir os perfis.

## 5. Limitações conhecidas

- **Agente orquestrador inativo** continua atendendo: a PEN-047 só foi decidida no ponto "não publicado".
- **Duplicar** copia o rascunho exibido como agente novo, que nasce não publicado.
- **Tentativa de filha numa versão nova:** recomeça no nó seguinte ao envio, ligada à mesma execução principal. Entra no consolidado só se a execução principal ainda estiver esperando.
- **Voz direto no especialista:** a ferramenta do especialista chamada direto pela voz (sessão sem `self_ask`) só tem testes de unidade. A voz do operador passa pelo `self_ask`, que foi validado com o provedor real.
- **Desempenho:** sem meta enquanto a PEN-031 estiver aberta.

## 6. Validação com o provedor real (03/11/2026)

Feita no desenvolvimento, pela API e pelo worker reais, com pessoas, contas e dados de teste (prefixo "QA Validação · "), todos removidos depois. Ficaram só o registro de custo (`ai_usage_events`) e a auditoria. Custo: US$ 0,034 em 31 chamadas, das quais 11 falharam pelo provedor.

- **Chat:** o especialista foi desativado, ou ganhou uma versão restrita publicada, 1,5 s depois do início da resposta.
  - A participação ficou `BLOCKED_INACTIVE` ou `BLOCKED_UNAUTHORIZED` com a versão vigente na hora da chamada (inclusive a recém-publicada).
  - O especialista não foi chamado.
  - A resposta diz só que a orientação está indisponível.
- **Voz (Gemini Live):** o mesmo cenário, durante a ferramenta `self_ask`. A transcrição do áudio confirma que a explicação foi falada, e o turno ficou gravado.
- **Publicação:** o "Executar agora" rodou antes e depois de publicar a versão 2 do agente. Registrou a versão 1 e depois a 2, com resposta estruturada completa e evidência literal.
- **Filha em versão nova:**
  - a filha foi bloqueada por agente inativo, e reativar o agente não a retomou;
  - publicar o Workflow com o agente inativo é recusado (`WORKFLOW_AGENT_INACTIVE`), então primeiro o agente foi reativado e depois veio a versão 2;
  - a tentativa rodou na versão 2 do Workflow e do agente, ligada à mesma principal e à original, aprovada pela revisora indicada;
  - entregou um único feedback; a segunda confirmação foi recusada.
- **Tempos:** estão na matriz (ESP-INIA-03 §4.3). As conferências de autorização custam frações de milissegundo; o tempo é do modelo.

Roteiros (fora do repositório, refeitos se preciso): sessão HTTP com cookies e CSRF, cliente do Gemini Live igual ao do navegador e limpeza por levantamento de chaves estrangeiras.

As provas: `agent-lifecycle-proof` (9 casos) e `agent-auto-update-proof` (11 casos; provedor simulado na fronteira do gateway).

```bash
cd backend && INIA_DB_PROOF=1 npx vitest run agent-auto-update-proof
```
