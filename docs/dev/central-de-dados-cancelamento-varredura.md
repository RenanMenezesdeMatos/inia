# Cancelamento de registros: varredura de dependências

Levantamento de 06/11/2026, a partir do erro do TMA na VM da empresa (indicador cadastrado como Soma, 15 medições aceitas, fechamento recusado, indicador travado). O código lido é o do commit `1e03bbb8`; os testes rodaram na cópia descartável `inia_consulta`, dentro de transações desfeitas no fim.

A fase 1 foi implementada no mesmo dia: como ficou está em [central-de-dados-consulta.md](central-de-dados-consulta.md#cancelar-registros). Este documento continua como a análise que levou a ela. Duas decisões mudaram ao implementar: a carga grava direto em `<tabela>_all`, porque usa `xmax`, que não existe em visão; e reativar não repete as regras de valor da carga (item 6 abaixo).

Pedido: um "excluir" virtual na Consultar dados. O dado continua no banco, aparece como cancelado na tela e sai da lógica. A varredura responde onde um objeto depende de outro dado, se esse dado está visível na consulta e se o cancelamento resolve.

## Conclusão

- **Resolve o caso do TMA** e o beco sem saída registrado em `docs/dev/memoria/indicadores-e-estrutura.md`, além de dar saída a medição, meta e fechamento gravados com a chave errada, que hoje não têm nenhuma.
- **Não é uma solução geral.** A maioria das travas vem de configuração (Workflow, Agent, política) ou de histórico que não deve ser cancelado, como feedback, execução e auditoria.
- **É melhor que o SQL usado na VM.** `workflow_enrollments.indicator_measurement_id` é `ON DELETE CASCADE`: apagar a medição apaga a execução ligada a ela (`data-lifecycle/domain/retention-catalog.ts:35`). E a evidência aponta para a medição sem chave estrangeira (`evidences.source_id`), então ficaria apontando para nada. Na cópia de dev, 22 evidências apontam para medições.
- **Sem mudar a carga, ele cria um erro silencioso.** Ver a prova abaixo.

## Prova na cópia do banco

Com a coluna `cancelled_at` e uma visão que esconde os cancelados, em 1,6 milhão de medições:

| Teste | Resultado |
|---|---|
| Cancelar uma medição | Some da leitura normal, continua na base e o read model é avisado (o gatilho de `update` marca a pessoa) |
| Carga com o mesmo valor, upsert atual | Nenhuma linha afetada: **continua cancelada, sem aviso** |
| Carga com valor novo, upsert atual | Valor sobrescrito e **continua cancelada**: a carga dá certo e o dado não aparece |
| Carga com upsert ajustado | Reativa o registro |
| `for update`, `update` e upsert pela visão | Funcionam |
| Excluir fisicamente um indicador com tudo cancelado | O banco recusa pela chave estrangeira (a recusa do teste veio de `goals`) |
| Consulta quente pela visão | Usa o mesmo índice da tabela, com um filtro a mais |

Não houve teste do motor de Workflow nem das telas com registro cancelado.

## Travas: dado, visibilidade e efeito do cancelamento

### Cancelar resolve

| Trava | Dado que trava | Aparece na consulta? | Ressalva |
|---|---|---|---|
| `INDICATOR_SEMANTIC_LOCKED` (`indicator-definition-service.ts:118`) | Medições, Metas, Fechamentos oficiais | Sim | Workflow que cita o código continua travando; não aparece na consulta |
| `INDICATOR_CORRECTION_BLOCKED` (`indicator-correction-service.ts:271`), parte das medições | Medições sem componentes, incoerentes ou fora da unidade | Sim | É o beco sem saída: hoje a mensagem manda a equipe técnica remover (`indicator-correction.ts:113`). Workflow ativo incompatível continua bloqueando |
| Sem rota: medição, meta, fechamento ou PRV com chave errada (período, pessoa, indicador) | As próprias tabelas | Sim | Só o upsert muda essas linhas, e ele casa pela chave. A carga certa cria outra linha e a errada fica |
| Sem rota: dia de escala ou turno com chave errada | As próprias tabelas | Sim | Segunda fase |

### Cancelar não resolve

| Trava | Dado que trava | Aparece na consulta? | O que fazer |
|---|---|---|---|
| `INDICATOR_HAS_DEPENDENTS` | As mesmas linhas, presas por FK física | Sim | Continua barrada, com mensagem própria; senão vira erro 500. Desativar já existe |
| `CHANNEL_FLAG_HAS_DEPENDENTS` | `interaction_flags`, FK física | Sim | Desativar já existe |
| `DATA_FEED_CONTRACT_LOCKED` | Cargas do feed | Sim | Criar outro feed. Carga é auditoria |
| `DATA_PUSH_IDEMPOTENCY_CONFLICT` | Cargas | Sim | Chave nova |
| Arquivo repetido | `data_processed_files` | Não | Reprocessar a carga (`run-service.ts:81`) enquanto o conteúdo bruto estiver retido |
| SFTP com o mesmo conteúdo | `data_processed_files` | Não | Pula sem aviso; alternativa não localizada. Depois de um cancelamento, a origem precisa mandar arquivo diferente |
| `PERSON_FIELD_MANAGED_BY_SOURCE` | `data_lineage` e feed vivo | Não | Corrigir na base |
| `PERSON_MATRICULA_IN_USE`, `PERSON_LINK_*`, `PERSON_ALREADY_LINKED` | Pessoas, contas, auditoria | Só Colaboradores | Pessoa não entra no cancelamento. Matrícula errada segue sem saída |
| `EMPLOYMENT_STATUS_CONFLICT` e aviso de carga | Períodos de situação | Sim, com máscara | Fluxo próprio. Situação funcional é decisão humana restrita (`CLAUDE.md`) |
| `DATA_SCHEDULE_EXCEPTION_CONFLICT` | Exceções | Sim | Prevalece o Supervisor; o cancelamento já existe (`schedule-exception-service.ts:149`) |
| `AGENT_DELETE_BLOCKED` | `agent_runs`, `assistant_interactions`, `feedback_analysis_runs`, Workflows | Só `agent_runs` | Histórico. Desativar |
| `ARGUMENT_SCRIPT_IN_USE`, `PRODUCT_CRITERION_IN_USE` | Avaliações de chamada | Não | Histórico. Desativar ou encerrar |
| Checkpoint provisório | `process_checkpoint_observations` | Não | Status operacional INACTIVE |
| Excluir pessoa, Grupo ou Subgrupo | Sem rota; cerca de 128 e 43 referências nas migrations | Sim | Fora do cancelamento |
| Configuração: `AI_CONNECTION_IN_USE`, `AI_MODEL_IN_USE*`, `BUSINESS_DOMAIN_*`, `WORKFLOW_VARIABLE_IN_USE`, `STRUCTURED_OUTPUT_IN_USE_*`, `PRODUCT_NODE_*`, `PRODUCT_CODE_LOCKED`, `*_SCOPE_LOCKED`, `*_DRAFT_ONLY`, `COMPETENCY_KEY_LOCKED`, `DATA_SOURCE_KIND_IMMUTABLE`, `CHECKPOINT_OFFICIAL_RULE_READ_ONLY`, `DATA_FEED_KEY_CONFLICT`, `DATA_FEED_AUTHORITATIVE_CONFLICT`, `ACCESS_LAST_TENANT_ADMIN`, `PERSON_HIERARCHY_REQUIRES_SOURCE` | Tabelas de configuração, grafo de Workflow ou regra fixa | Não | Corrigir na tela de cada objeto |

### Erro 500 hoje, sem relação com o cancelamento

Excluir estes objetos estoura a chave estrangeira sem tratamento. Workflow e Orchestrator foram confirmados no banco; a rota de Workflow não tem checagem e o `errorHandler` responde 500 (`main/app.ts:438`). A rota em si não foi executada.

| Excluir | FK que estoura |
|---|---|
| Workflow | `interaction_feedback_generations.workflow_id` e `workflow_version_id` |
| Orchestrator | `assistant_interaction_support_materials.orchestrator_id` |
| Domínio de negócio | `argument_scripts` e `checkpoint_scopes`, fora da checagem de uso (só catálogo e leitura) |
| Indicador, caso residual | `indicator_investigations`, `workflow_enrollments.indicator_diagnostic_strategy_version_id`, `operator_diagnostics` (só leitura) |

## Os 21 conjuntos da consulta

Leituras contadas por `from`/`join` no código de produção.

| Conjunto | Decisão | Leituras | Motivo |
|---|---|---|---|
| Medições | Fase 1 | 31 arquivos, 50 linhas | Caso do TMA |
| Metas | Fase 1 | 11, 14 | Faz parte da mesma trava do indicador |
| Fechamentos oficiais | Fase 1 | 14, 29 | Idem. A PRV nunca é recalculada: cancelar um fechamento não muda a PRV do cliente |
| Fechamentos de PRV | Fase 1 | 7, 11 | Chave errada não tem outra saída |
| Dias de escala | Fase 2 | 5, 7 | Saída para chave errada |
| Turnos | Fase 2 | 9, 11 | Idem; a tela de regime também grava aqui |
| Interações, Transcrições, Flags | Fase 2, só sem derivados | 42, 81; 15, 23; 10, 17 | 15 tabelas dependem de interação, e o gatilho de atividade diária conta qualquer linha |
| Exceções de calendário | Já tem cancelamento | 9, 12 | Reaproveitar |
| Períodos de situação | Não | 3, 9 | Decisão humana restrita, com fluxo e precedência próprios |
| Colaboradores, Grupos, Subgrupos | Não | - | Identidade, acesso e hierarquia |
| Casos, Feedbacks | Não | - | Conteúdo entregue, ciência com senha, evidência |
| Execuções de Workflow e de Agent, Uso de IA | Não | - | Histórico e custo |
| Cargas, Rejeições | Não | - | Auditoria da própria carga |

## O que precisa mudar para não dar erro

1. **Leitura.** As 50 leituras de medições não precisam ser alteradas uma a uma. Recomendação: renomear a tabela para `<tabela>_all` e criar com o nome antigo uma visão que esconde os cancelados. Quem esquecer o filtro no futuro não vê cancelado por engano. Custo: migration futura que adiciona coluna precisa recriar a visão, e o erro aparece na hora. Filtrar consulta por consulta deixa o erro silencioso se uma for esquecida.
2. **Histórico continua vendo o cancelado.** 12 leituras buscam a medição pelo id para mostrar resultado passado: `ai-usage-ranking-service`, `conversation-monitoring`, `feedback-origins`, `diagnostic-strategy-service:277`, `postgres-feedback-review-reader`, `pending-actions-repository` (2), `manual-run:577`, `usage-analytics-reader` (2), `workflow-results-reader` (2). Essas passam a ler `<tabela>_all` e mostram "cancelado".
3. **Carga reativa.** Os upserts precisam limpar o cancelamento e tratar registro cancelado como mudança: `performance-writers.ts` (3), `master-data-writers.ts:762` e o `ingestion-router.ts:45`, ainda montado.
4. **Execução em andamento.** Motor e diagnóstico buscam a medição pelo id durante a execução (`enrollment-subject`, `action-executors:661`, `load-peer-practice-data`, `load-diagnosis-plan`, `publish-reliable-feedback`). Regra adotada: recusar enquanto o motor ainda for rodar a execução daquele registro, como a correção faz com Workflow ativo. Execução bloqueada ou pausada não barra: pode nunca sair daí.
5. **Excluir indicador.** A contagem passa a ignorar cancelados, mas a FK continua. A exclusão precisa olhar a tabela real e recusar com mensagem própria.
6. **Reativar não traz de volta o valor errado.** Depois de trocar Soma por Média, reativar a medição antiga traria de volta o valor da regra anterior, e nada no registro denuncia isso. Na prova com dados reais, repetir as regras de valor da carga recusou medições válidas e impediu desfazer um cancelamento feito por engano. Por isso o lote guarda código, unidade, direção e estratégia do indicador, e só a mudança deles barra, junto com indicador inativo, que não aceita mais o dado, ou com medição ativa no mesmo período.
7. **Prévia antes de confirmar.** Mostra quantas linhas, execuções e evidências estão ligadas e quantos feedbacks vieram daquele dado. Feedback entregue não é desfeito: fica para decisão humana.
8. **Carga dispara Workflow de novo.** `enrollIndicatorWorkflows` não tem deduplicação: registro reativado conta como alterado, gera execução nova e pode gastar IA. A prévia precisa avisar.
9. **Segurança.** A consulta continua somente leitura, na transação `READ ONLY`. O cancelamento é outra rota, com permissão própria, motivo obrigatório, limite de linhas e auditoria sem valores. O código exige organização inteira, como a consulta.
10. **Nome.** "Cancelar", nunca "excluir": o dado continua no banco e isso não atende a um pedido de eliminação pela LGPD.

## Fluxo do TMA depois da fase 1

1. Em Consultar dados, filtrar Medições pelo indicador e cancelar, com motivo.
2. Corrigir a estratégia do indicador, agora sem histórico vivo.
3. Reprocessar a carga, se o conteúdo bruto estiver retido, ou enviar um arquivo novo. Os registros voltam com o valor certo.

## Dependências para implementar

- Correção de indicador: `1674192a`, em `admin-list-standardization`, ainda não está neste branch.
- Papel Administrador de dados: `0dd54bc2`.
- Consultar dados: sem commit, em `claude/consulta-dados-central`.
- A VM roda `e0fccf4b`: nada disto chega lá sem merge, `npm run github:publish` e o roteiro IT-015.

## Não verificado

- Motor de Workflow e telas com registro cancelado (o efeito em execução vem da leitura do código).
- Classificação das leituras das outras tabelas, além de medições: só há contagem.
- Respostas 500 pela rota: conferidas no banco e no código, sem chamada HTTP.
- `feedback-*`, `pending-actions`, `realtime` e `best-practices` só passaram por busca de padrões de erro. Frontend não entrou.
