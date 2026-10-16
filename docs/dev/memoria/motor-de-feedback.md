# Memória — Motor de feedback (FEEDBACK_ENGINE_V1)

> Seções movidas sem edição do `CLAUDE.md` em 07/10/2026. Critérios e mapa completo em [README.md](README.md).
>
> O primeiro item da seção diz que o motor substitui seções “mantidas abaixo” no `CLAUDE.md`. Elas agora estão em [historico-feedback-v15-v16.md](historico-feedback-v15-v16.md) e [historico-monitoria-v17.md](historico-monitoria-v17.md). A exceção é “Feedback por Flag V2”, que está em [experiencia-do-colaborador.md](experiencia-do-colaborador.md).
>
> Ver também: [feedback-engine.md](../feedback-engine.md), [diagnostic-bootstrap.md](../diagnostic-bootstrap.md).

### Motor de feedback — FEEDBACK_ENGINE_V1 (2026-09-30, migration 102) — caminho ATUAL de "Gerar feedback"

**Substitui** o caminho confiável/QA descrito nas seções V1.5.x–V1.7.x, Checkpoint Registry, Feedback por Flag V2 e Monitoring
Architecture V2 (histórico, mantido abaixo para leitura de artefatos antigos). Doc: `docs/dev/feedback-engine.md`. Regras:
**primeiro diagnosticar, depois comunicar; sem fila de QA e sem aprovação de checkpoint; incerteza → mais evidência, conclusão
restrita ou abstenção com motivo — nunca espera humana (exceto nó explícito de Revisão humana do grafo).**
- Módulo `backend/src/modules/feedback-engine`: `analyzeCall` (contexto COMPLETO do procedimento com handles D/S/L, uma chamada
  ao modelo gemini-3.8-flash com Use Case `FEEDBACK_ANALYSIS`, verificação por código — citação por turno/falante, intenção ≠
  execução, omissão só com transcrição completa, proibição por ausência, conflito de regra nunca acusa —, cobertura do caminho +
  encerramento (do processo e de checklist transversal de encerramento) com UM reparo, desfecho USABLE/PARTIAL/INSUFFICIENT);
  `investigateIndicator` (oficial intacto; onde mudou por assunto/dia, mix × dentro, piora escondida; até 8 análises de chamada;
  padrões com denominador; grupo de referência com privacidade 4/3/5; "mudança sem causa sustentada" é conclusão válida);
  `generateFeedback` (brief → redator → verificador semântico → lacunas de utilidade → `FEEDBACK_VIEW_V1`; abstenção com motivo).
- Critérios da base com identidade automática `KC-<hash>` e reconciliação entre versões (`knowledge_criteria`) — ninguém aprova.
- Memória (102): `feedback_analysis_runs`, `call_assessments`, `call_criterion_assessments`, `indicator_investigations`,
  `feedback_engine_messages`, `feedback_material_recommendations`; supersessão em dois passos, `as_of` impede leitura tardia de
  sobrescrever, claim com lease para concorrência; memória gravada mesmo sem mensagem/Output; texto nunca é evidência.
- Workflow: grafos inalterados; "Chamar agente" (Avaliação de processo / Diagnóstico de indicador / fechamentos) e especialista
  do Orquestrador em Avaliação de processo passam pelo motor; "Gerar feedback" PUBLISHABLE → Output, ABSTAINED → encerra.
  Output FOLLOW_UP publica com `context_snapshot.feedbackEngine.feedbackView` (leitores fazem coalesce com `reliableFeedback`);
  emissão idempotente com `workflow_output_emissions.engine_message_id`. Resultados do Workflow: kind `ENGINE`.
- Retenções antigas: `scripts/feedback-engine/legacy-holds.ts` (dry-run padrão; REPROCESS | CLOSE com motivo; nunca aprova;
  itens saem da fila de QA). Dev 30/09: 11 retenções de smokes, NÃO aplicado.
- Diagnóstico da liderança: `/diagnostics` real (memória do motor, filtros, drill-down até a transcrição, CSV; investigação de indicador em diálogo amplo com a chamada AO LADO — `indicator-investigation-dialog.tsx`, nunca Sheet empilhado; detalhe da chamada em abas Pontos · Cenário · Transcrição em formato de conversa, `call-assessment-detail.tsx`) sobre
  `/api/v1/diagnostics/memory/*` no escopo do leitor. "Testar diagnóstico" da estratégia do indicador roda o motor.
- Provas: `feedback-engine-domain.test.ts`, `generate-feedback.test.ts`, `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run
  feedback-engine-workflow-proof`; bateria com modelo real em `backend/scripts/feedback-engine/evaluation/` (gabarito separado).
  Provas antigas `reliable-feedback-workflow-proof`, `prv-closing-diagnosis-proof`, `direct-indicator-diagnosis-proof` = `describe.skip` (aposentadas).
- **Correção de 30/09 (noite) — contrato de confiança, identidade e evidência** (sem migration): (1) `FEEDBACK_COMPOSITION_V2`:
  justificativa, orientação e "por que importa" do modelo são LEITURA, nunca fato; o verificador recebe só fatos (fala literal,
  regra literal, status verificado, números do sistema) e confere na mesma chamada as frases e as leituras (`G-A*`, `W-S*`); o
  sistema só completa com regra literal/status verificado/leitura aprovada; reescrita do verificador nunca é aceita sem nova
  verificação; trava final `contentLeaksOf` (conteúdo recusado em nenhuma superfície); nada seguro → `NO_SAFE_MESSAGE`; o mesmo
  comportamento vira um ponto (`memberFindingKeys`). Regressões: `composition-trust.test.ts`. (2) `KNOWLEDGE_CRITERIA_V2`:
  equivalência só quando a sequência estrutural é idêntica (ordem, condição, modalidade, negação, responsável, canal, prazo,
  objeto → MODIFIED com motivo) — SUBSTITUÍDA em 05/10 (lista de palavras saiu; identidade = chave da linha; sentido = prática).
  (3) `INDICATOR_INVESTIGATION_V2`: chave de EVIDÊNCIA (chamadas + assinatura da transcrição, memória, base, lógica, pares), reuso
  pela chave pós-execução, revisão quando algo relevante muda, `UNLOCATED` = só a memória existente, regra alterada não orienta;
  memória lida por `currentMemory` + `domain/memory-queries.ts` e memória SOBREPOSTA (`overlay-feedback-memory-store.ts`) no QA
  Lab/"Testar diagnóstico"/ensaios; `peerCallAnalyses: false` e `allowCollaborator` (trava de sujeito). (4) Avaliador por
  dimensão `evaluation/scoring.ts` (estrutural × auxiliar léxico × inspeção humana; sem "mensagem correta"; casos que ajustaram a
  implementação = regressão — os 9 da bateria de 30/09). (5) Ensaio focal pago da Larissa Monteiro com trava de orçamento na
  fronteira HTTP (`evaluation/paid-budget.ts`, `evaluation/larissa/`): 12/12 requisições, US$ 0,50; achou "Estorno" acusado com a
  mesma fala que provava a alternativa escolhida → `CALL_ANALYSIS_LOGIC_V3` (`SAME_EVIDENCE_PROVES_SIBLING`) + regra sempre com a
  frase que abre a lista e os itens irmãos avaliados (prompts de composição V4 / verificação V3); texto final pós-correção NÃO
  validado com modelo (orçamento esgotado). Detalhes em `docs/dev/feedback-engine.md › Validação focal`.
- **Correção de 30/09 (fim do dia) — integridade ≠ interpretação, ferramentas, composição livre e orçamento** (sem migration;
  zero chamada de IA na implementação): (1) `CALL_ANALYSIS_LOGIC_V4` (`domain/call-review.ts`): a análise PROPÕE; integridade por
  código prova só que a citação existe; uma REVISÃO independente por chamada analisada (etapa `CALL_REVIEW`, transcrição inteira,
  regra com abertura da lista + irmãos + condição, foco calculado por código: omissão, condicional, irmão cumprido, mesma fala,
  ação declarada, cumprimento por ausência) confirma/refuta/deixa incerto; `decideConfirmation` decide por código (alternativa
  cumprida = refutada; condicional exige a condição verificada; desvio com irmão cumprido só com leitura CUMULATIVE/SEQUENCE).
  Sem revisão nada é confirmado. A revisão absorveu o reparo de cobertura (2 chamadas por chamada analisada). Status efetivo
  (`effectiveCriterionStatusSql`): só CONFIRMED conta em histórico, investigação e liderança; leituras anteriores = inconclusivas.
  Resposta crua da análise/revisão em `provenance.modelResponses`. (2) `KNOWLEDGE_CRITERIA_V3`: abertura da lista é parte da
  regra e da identidade; máximo × mínimo × exato; sem truncar palavras; revisão da extração V2→V3 com proveniência
  (`summary.extractionRevision`, nunca une identidades). (3) `INDICATOR_INVESTIGATION_V3` + `ENGINE_INVESTIGATION_TOOLS_V1`
  (`domain/investigation-toolbox.ts`, `infrastructure/catalog-tool-runner.ts`): 15 Tools do catálogo reutilizadas pelo mesmo
  `executeTool` + `read_call_memory`/`analyze_calls` (MESMA análise da monitoria)/`reference_practices`; capacidades = Agent, senão
  base da estratégia, senão legado — Workflow só restringe; perguntas abertas determinísticas, planejador (`INVESTIGATION_PLANNING`)
  só com pergunta material, modo FIXO da estratégia sem planejador; ferramenta sem dado = limitação; sinais por código
  (`NO_INDIVIDUAL_GAP`, dado insuficiente) e fatos no brief. (4) `FEEDBACK_COMPOSITION_V3` (prompts V5/V4 + coerência V1): nenhuma
  frase do sistema na conversa ("Ponto principal"/"a etapa não aparece"/"O procedimento orienta" removidos), organização livre,
  conjunto reconferido quando frases saem, abstenção `NO_SAFE_MESSAGE:<motivo>`, só pontos comunicados contam. (5) `ENGINE_BUDGET_V1`
  (`application/engine-meter.ts`): medidor único por execução (todas as etapas, retries transitórios contados, uso desconhecido =
  reserva, gateway sem retry). Testes com `testing/no-external-ai.ts`: `diagnosis-confirmation`, `engine-investigation-tools`,
  `composition-freedom`. Replay sem custo da Larissa: `evaluation/larissa/replay-v4.ts` (nenhuma proposta da rodada paga é
  confirmada sem revisão). Qualidade com modelo real NÃO validada; plano mínimo (C07: 1 revisão + composição) na doc.
- **Correção de 01/10 — descobertas, recuperação da revisão e capacidades** (sem migration; zero IA): (1)
  `INDICATOR_INVESTIGATION_V4` + `domain/investigation-slices.ts`: resultados das ferramentas (pico de `detect_anomalies`,
  concentração de `segment_indicator`) abrem RECORTES R-n (dia, dia da semana, hora, canal, sinal, assunto e combinações) com
  chamadas compatíveis (`sliceInteractions`), memória lida antes de analisar e perguntas por recorte com estado ANSWERED/PARTIAL/
  OPEN/NO_DATA/NO_TOOL/BUDGET/NOT_MATERIAL (ferramenta que rodou sem esclarecer não responde); grupo comparável igual/melhor torna
  a pergunta das chamadas não material; recortes vão à evidência persistida, à conclusão, ao brief (escopo "Nas chamadas do recorte
  dia 14/08…") e ao verificador; `questionHistory`; investigação interrompida pelo orçamento não é reutilizada (chave liberada).
  (2) `CALL_ANALYSIS_CHECKPOINT_V1` (`domain/analysis-recovery.ts`): revisão com falha técnica/orçamento/contrato = execução
  SUSPENSA (FAILED + checkpoint, nada na memória), nunca INSUFFICIENT definitivo; chaves por etapa (proposta × execução), resposta
  paga reaproveitada por etapa, retomada paga só a revisão; erros `FEEDBACK_CALL_REVIEW_PENDING` (transitório → política do nó)
  e `FEEDBACK_INVESTIGATION_ANALYSIS_PENDING`; execuções pré-correção com `REVIEW_UNAVAILABLE` tratadas como pendentes (propostas
  reaproveitadas, mensagem abstida reaberta, fora da liderança via `reviewSettledSql`). (3) `ENGINE_INVESTIGATION_TOOLS_V2`: lista
  vazia de capacidades = NENHUMA ferramenta (contrato da coluna desde a 074; sem fallback por estratégia/legado), Workflow e
  estratégia só restringem, plano do CONTRATO da estratégia (`contractStepsOf`) separado das ferramentas; sem estratégia o contrato
  não analisa chamadas. Provas: `investigation-discovery`, `analysis-recovery`, `investigation-capabilities`, DB proof J.
  Validação mínima da C07 preparada (`evaluation/larissa/validate-c07.ts`, padrão = ensaio sem envio; `--execute` só com
  autorização; propostas pagas entram como análise suspensa → paga só revisão + composição).
- **Correção de 01/10 (tarde) — encerramento de recorte, título e C07 real** (sem migration): resultado do mês, comparação do mês
  com o grupo e qualidade do dado do período são CONTEXTO de uma pergunta de recorte, nunca o encerramento (`INDICATOR_INVESTIGATION_
  V5`); dia fora do padrão da medição diária abre recorte com o mês bom; recorte não examinado = `CHANGE_LOCATED_NOT_EXAMINED`;
  `FEEDBACK_HEADING_V1`: título = assunto do atendimento, data como subtítulo, neutro sem assunto confiável (reprojeção dos
  publicados com view model: `scripts/feedback-engine/reproject-feedback-headings.ts`, 69 no dev). C07 com propostas de 30/09
  (manhã, US$ 0,0733): correta mas genérica.
- **Correção de 01/10 (noite) — descartes, evidência que encerra, valor da mensagem, títulos legados e aberturas de lista** (sem
  migration; uma rodada paga, nenhuma outra): (1) `CALL_REVIEW_V2`/`CALL_ANALYSIS_LOGIC_V5`: a MESMA revisão confere os descartes
  (não se aplica/não observável/não exigência) das seções em jogo contra o cenário da análise; contestação → código decide
  (`decideExclusionChallenge`: sem fala = ignorada; ação interna ou "não dá para concluir" = reaberto/ponto em aberto, nunca
  "não cumprida"; reversão só com integridade + convergência com a análise); `itemNature`/`scenarioRole` (leitura que só ordena);
  notas técnicas em `auditNotes`. (2) `INVESTIGATION_CLOSURE_V2`: "resolvida" exige evidência que RESPONDE (análise/memória
  confirmada na cobertura pedida); flags/contexto de todas as chamadas = "não aprofundada" justificada; parcial/ausência de sinal =
  insuficiente (`RESOLVED_INSUFFICIENT`). (3) `STRENGTH_SELECTION_V3` (papel no caso, sem bônus de regra condicional), pontos em
  aberto `O-n`, `readerNotes` ("Para entender este retorno"; sai "Limites desta análise"), composição V6 / verificação V5 (avaliação
  da mensagem inteira, `addsInformation`, `lostInformation`, `NO_USEFUL_MESSAGE` por falta de valor). (4) Feedbacks antigos SEM view
  model: título na LEITURA (`legacyFeedbackHeadingOf` + `feedbacks/infrastructure/legacy-feedback-headings.ts`; snapshot →
  evidência única do caso; nunca base/agente/indicador impactado); dev: 179 → 156 com assunto, 23 neutros;
  `scripts/feedback-engine/legacy-heading-report.ts`. (5) Configuração das ferramentas documentada (Larissa = `[]`; mínimo
  INDICATOR_ANALYSIS + INTERACTION_ANALYSIS; nada alterado). (6) Rodada paga C07 com análise inicial NOVA (`validate-c07-fresh.ts`,
  4 requisições, US$ 0,102): **reprovada** — o ponto principal saiu "avalie estorno em vez de crédito" porque a análise deu
  conclusões a ABERTURAS de lista e a revisão as confirmou sem ver os itens; corrigido localmente em `CALL_REVIEW_V3` /
  `LIST_OPENING_V1` / `CALL_ANALYSIS_LOGIC_V6` (abertura vai com os itens, só confirma lida como lista, "parcial" de alternativas
  nunca, itens englobados viram alvos, pedido × resposta registrado, cobertura com teto de 40 e prioridade); replay sem custo das
  mesmas respostas: 0 ajustes, ponto em aberto "Corrigir o status". NÃO revalidado com modelo.
- **Correção de 01/10 (noite, 2) — aplicabilidade × evidência e Argumentários** (migration 105; zero chamada paga):
  - **Princípio:** a fonte define a obrigação; a evidência disponível define o que pode ser comprovado.
  - **Análise** (`SEMANTIC_AUDITABILITY_V1`, `CALL_ANALYSIS_LOGIC_V7`, prompt V5, revisão V4): quatro perguntas separadas e SEMÂNTICAS (ação exigida, aplicabilidade com condição e falas, onde o cumprimento acontece IN/OUTSIDE_CONVERSATION e a evidência necessária, conclusão). Nada é decidido por verbo, palavra-chave ou nome de sistema; o código (`assessUnit`) só aplica as consequências e a integridade:
    - aplicabilidade incerta ≠ não cumpriu;
    - execução fora da conversa nunca vira cumprido/descumprido (registros de sistema não integrados);
    - declaração e intenção ficam como `executionClaim` DECLARED/INTENDED;
    - regra composta é avaliada por PARTE literal (`L12.1…`, identidade `obligationCriterionKeyOf`).
  - **Heurísticas que deixaram de decidir:** condição por palavras (`ruleIsConditional` removido; vale a condição LIDA); título de seção virou pista (toda linha tem handle); oportunidade de encerramento não é mais preenchida pelo código.
  - **Redator:** execução em sistema vira limite de cobertura (`brief.coverageLimits` + nota neutra), nunca lembrete "se você ainda não…". Ponto em aberto só de etapa da conversa ligada ao caso por fala. Composição V7 / verificação V6.
  - **Argumentários** (`modules/argument-scripts`, `/admin/argument-scripts`, rota antiga redireciona): área responsável (domínio de negócio), escopo todos | Grupo | Subgrupo com `configuration.manage` no backend (inclusive "todos"), versões imutáveis, vigência nunca retroativa, encerrar/reativar.
    - Campos com significado preservado no motor (G-n): gatilho = situação; deve × pode; pontos "todos" × "alternativas" (uma exigência só); exemplo e referência nunca viram critério.
    - Versão vigente NA DATA DA CHAMADA no escopo do colaborador. Conflito com a base = `sourceConflicts`. Duplicidade exata não ganha handle.
    - `call_expectations` intacta: cada linha virou argumentário `LEGACY_UNSTRUCTURED`, que nunca cria critério até ser estruturado. O prompt legado dos Agents lê argumentários.
    - **Desativar × excluir (15/10/2026):** na tela, "Encerrar" virou **Desativar** (status `ARCHIVED`, rótulo "Inativo"; mesma rota `/archive`), com interruptor Ativo/Inativo e Excluir também na lista (`argument-script-lifecycle.tsx`, diálogo único da lista e do editor). Excluir vale até para publicado, desde que NENHUMA análise o tenha usado — `call_criterion_assessments.argument_script_id`, `call_assessments.argument_scripts[].scriptId` ou `feedback_analysis_runs.provenance.argumentScripts[].scriptId`; usado = 409 `ARGUMENT_SCRIPT_IN_USE` (o caminho é desativar). Versões saem só pela cascata do cadastro (o gatilho de imutabilidade da 105 recusa delete direto de versão publicada); conteúdo da última versão vai para `audit_logs` (`ARGUMENT_SCRIPT_DELETED`). Prova: `argument-scripts-proof`.
  - **Memória:** `call_criterion_assessments.source_kind/argument_script_*/applicability/observability/execution_claim/obligation/scope` e liderança com `outsideConversation`.
  - **Validação:** replay sem custo da C07 com tradução de handles (`replay-c07-v7.ts`). `validate-c07-v7.ts` aposentado (simulava vigência).
- **Correção de 02/10 — política de evidência única, duplicidade por sentido e rodada real V8** (sem migration):
  - **Política única** (`EVIDENCE_POLICY_UNIFIED_V1`, revisão V5, lógica V8): a revisão pode corrigir a leitura semântica, nunca manter "ação interna" e tratá-la como comprovada (`reviewedObservabilityOf`). Execução fora da conversa nunca fica cumprida, descumprida, parcial nem confirmada, venha a conclusão de onde vier: passada final em `verifyCallAnalysis` + brief.
  - **Duplicidade por sentido** (`DUPLICATE_BY_MEANING_V1`, prompt V6): texto igual nunca elimina exigência; vira anotação (`context.sameText`). Duplicidade só pela leitura que declara condição, finalidade, escopo e modalidade iguais, com a linha da base avaliada (`duplicateCheckOf`); aceita leva as duas origens (`alsoRequiredBy`).
  - **Argumentário em reavaliação**: `ArgumentScriptSource.perspective = CURRENT_RULE_REEVALUATION` (nunca fingir vigência).
  - **Rodada real V8** (`evaluation/larissa/evaluate-round-v8.ts`, gabarito prévio `round-v8-ground-truth.md`; 11 requisições, US$ 0,2486): **REPROVADA**, sem base para piloto ainda. A: abstenção. B: mensagem só de elogios. C: números certos, generalização sem base.
  - **Defeitos da rodada:**
    - foco da decisão ≠ foco enviado à revisão — corrigido depois (`REVIEW_FOCUS_AS_SENT_V1`, revisão V6, lógica V9), comprovado só por replay sem custo (`replay-round-v8.ts`), **não revalidado com modelo**;
    - itens de argumentário aplicável fora do pedido de cobertura — corrigido (`ARGUMENT_COVERAGE_PRIORITY_V1`), não revalidado;
    - declaração lida como conduta pelo modelo ("Abrir análise quando:") — semântico, só registrado.
  - Detalhes em `docs/dev/feedback-engine.md › Correções pontuais + rodada real V8`.
- **Correção de 02/10 (tarde) — obrigação completa, ausência de padrão e rodada real V9** (sem migration):
  - **Obrigação completa** (`OBLIGATION_READING_V1`; prompt da análise V7, lógica V10, revisão V7 / prompt V5): `lineRole` (ação ×
    condição da ação × conteúdo × opção); leituras contraditórias do modelo ficam com a mais restrita; fala como prova de execução fora
    da conversa = declaração; declaração e condição nunca são acerto; a revisora diz `evidenceReading` + `outsideDependency` e o código
    decide (`obligationReadingOf`); sem essas leituras nada é confirmado; decisão sobre `sentClaims` (pedido como enviado).
  - **Caminho** (`PATH_COMPLETENESS_V1`): "correto" só com todas as etapas do caminho verificáveis e confirmadas.
  - **Indicador** (`ABSENCE_OF_PATTERN_V1`, investigação V6, closure V3): ausência de padrão vira limite com universo/amostra/qualidade,
    nunca "sem desvios"; resultado bom não fecha "há recorte pior no mês?" quando o sistema não conseguiu localizar.
  - **Rodada V9** (`evaluate-round-v9.ts`, gabarito revisado `round-v9-ground-truth.md`; 15 requisições, US$ 0,3444): nenhum cenário
    passou — A sem o ponto material, B com acusação literal (fatura × parcelamento) e o protocolo não confirmado, C correto mas sem
    ferramenta efetiva. Corrigido depois, **não revalidado**: `SEGMENT_DIMENSION_DEFAULT_V1`, `CONDITION_TURNS_V1`. Nunca repetir a
    rodada V9. Detalhes em `docs/dev/feedback-engine.md › Correções pós-V8 + rodada real V9`.
- **Correção de 02/10 (noite) — contrato orientado ao caso, confirmação dos achados da revisão e argumentos das ferramentas** (sem
  migration):
  - **Análise** (`OBLIGATIONS_V1`, prompt `CALL_ANALYSIS_PROMPT_V8` CONGELADO como medido, lógica `CALL_ANALYSIS_LOGIC_V11`;
    `domain/obligation-analysis*.ts`, `obligation-verification.ts`): necessidade → fontes aplicáveis → obrigações materiais COMPLETAS
    (ação, condição e se vale, itens ALL/ANY/SEQUENCE, onde se cumpre, achado, papel de cada fala CONDUCT/DECLARATION/INTENTION/
    CONDITION/CUSTOMER, oportunidade, materialidade, orientação) + não avaliado. O código aplica consequências das leituras do PRÓPRIO
    modelo (declaração não prova conduta, alternativa feita, combinação indefinida…), nunca palavra-chave. Resposta antiga (linhas)
    continua lida (`parseAnalysisProposals`). Identidade pela ordem do documento das fontes.
  - **Revisão** (`OBLIGATION_REVIEW_V1`, `application/review-obligations.ts`) + **confirmação focal** (`REVIEW_DISCOVERY_CONFIRMATION_V1`,
    etapa `CALL_CONFIRMATION`): achado adverso só da revisora vai a UMA confirmação; sem orçamento/falha = inconclusivo com motivo;
    nunca descartado só por ser da revisora (vale também no pipeline por linha, revisão V8 / prompt V6).
  - **Ferramentas** (`TOOL_ARGUMENT_CONTRACT_V1`, planejador prompt V4): contrato dos argumentos no prompt e no schema; argumento
    ausente = configuração só com uma opção válida, senão recusa estruturada ao planejador; recusada ≠ respondida.
  - **Comparação + rodada V10** (orçamento global 16 req / US$ 0,3045; `round-v10-evaluation.md`): a alternativa achou sozinha o
    protocolo da B e parou as acusações literais; A ainda sem o cancelamento pendente; B sem mensagem na saída paga (abstenção por
    orçamento do reparo; replay com a correção posterior produz — **não revalidado**); C com 4 ferramentas executadas, recorte 04/08
    não examinado. Nenhum cenário passou por inteiro. Nunca repetir a comparação nem a V10. Detalhes em
    `docs/dev/feedback-engine.md › Contrato orientado ao caso + rodada real V10`.
- **Correção de 02/10 (tarde) — coerência do diagnóstico, ocorrências, listas em jogo, investigação adaptativa** (sem migration;
  zero chamada paga; `CALL_ANALYSIS_LOGIC_V12`, `OBLIGATION_REVIEW_PROMPT_V2`, `INDICATOR_INVESTIGATION_V7`,
  `ENGINE_INVESTIGATION_TOOLS_V3`, planejador prompt V5, `ENGINE_BUDGET_V2`):
  - **Caminho vigente** (`PATH_VIGENTE_V1`): leitura da análise que não se sustentou sai do caminho/justificativa vigentes (gerados
    das conclusões finais); a original fica em `scenario.analysisReading` (auditoria). Desvio de caminho exige etapa MATERIAL.
  - **Ocorrência** (`CONDUCT_OCCURRENCE_V1`): `sameConductAs` da revisão + conferência estrutural (ambas confirmadas, mesmo lado,
    mesmo momento) → uma ocorrência `OC-…`, duas regras; `coverage.occurrences` regras × ocorrências; um ponto na mensagem.
  - **Listas em jogo** (`LIST_COVERAGE_V2`): itens não avaliados das listas usadas vão à revisão como CONTEXTO (`listItemsInPlay`,
    rodízio, teto 60); ela aponta em `missed` só os que valiam e faltaram — nunca falta/"não avaliado" por estrutura (a V1 marcava 58
    na C07).
  - **Ferramentas** (`TOOL_RESULT_VIEW_V1`, `domain/tool-result-view.ts`): resultado por item inteiro com partes omitidas declaradas
    + `inspect_result`; estado explícito (só "ok" responde); perguntas do planejador H1–H3 (`PLANNER_QUESTIONS_V1`), resolvidas só
    com consulta ok; recorte por dia com desvio % e gravadas × volume medido (fatos, nunca decisão).
  - **Orçamento**: reserva de 2 chamadas (24 mil tokens de entrada ≈ 2× o maior par medido) para redação + verificação; reescrita
    só se ela e a verificação couberem. Replay V10 passa o USO gravado.
  - Provas `diagnosis-coherence.test.ts`, `investigation-adaptive.test.ts`. Replay V10 sem custo: A mesmo texto (caminho vigente sem a
    acusação do crédito), B publica, C com 04/08 = +6,6% e 1 de 31 gravadas. **Não revalidado com modelo.**
- **Correção de 02/10 (fim da tarde) — ocorrências na liderança, páginas no `inspect_result`, fatos da redação + rodada V11**
  (migration 108):
  - **Ocorrência de conduta até a tela**: `call_criterion_assessments.occurrence_key/occurrence_basis` (REVIEW_SAME_CONDUCT |
    SINGLE_RULE | null = não determinável; chave inclui a chamada). Consultas da liderança: contagens existentes continuam POR REGRA
    (mesmos nomes no CSV); `stats.occurrences` à parte, denominador próprio só com ligação determinável; tela com "Desvio por
    conduta" e aviso de análises antigas. Prova de banco caso K.
  - **`inspect_result` em páginas** (`TOOL_RESULT_VIEW_V2`, ferramentas V4, planejador V6): omissões com caminho e tipo
    ITEMS/CHARS; texto em janelas exatas com `continueWith`; lista continua no primeiro item não mostrado; página entregue inteira.
  - **Redação V9 / verificação V8**: `notVerifiableByRecording` (execução em sistema) e `notAssessedInSameList` (itens da mesma lista
    sem avaliação) como fatos — nunca base de elogio; elogio não se estende à lista inteira.
  - **Rodada real V11** (`evaluate-round-v11.ts`, avaliação `round-v11-evaluation.md`). Nunca repetir.
    - Setup: critérios `round-v11-ground-truth.md`; código congelado em `round-v11-freeze.json`; livro-razão próprio, 15 de 17
      requisições, US$ 0,2047.
    - **A reprovado**: "Verificar" do §21 confirmado como conduta (relato do resultado lido como consulta); cartão "localizou no
      histórico"; cancelamento pendente não apontado, embora os itens das listas chegassem à revisão.
    - **B aprovado com ressalvas**: protocolo confirmado e uma orientação; o modelo não ligou as regras (`sameConductAs` null) →
      2 ocorrências; acusação do e-mail evitada por duplicidade.
    - **C não aprovado na cobertura**: o roteiro deixou 0 análises e o recorte 04/08 fechou por orçamento, sem o planejador decidir.
    - `inspect_result` em páginas e a gravação de ocorrências não foram exercitados com modelo real.
- **Correção de 02/10 (noite) — relato × execução, divergência, necessidade central + rodada V12** (sem migration):
  - **Princípio:** a transcrição prova o que foi dito e a conduta observável, nunca a execução em sistema (relato ≠ execução).
  - **Revisão V3** (`OBLIGATION_SPEECH_EXECUTION_V1`, lógica `CALL_ANALYSIS_LOGIC_V13`): conclusões vão sem os rótulos da análise; a
    revisora lê o ato exigido na fonte (`actPlace` IN/OUTSIDE/MIXED + `judgedPart`); OUTSIDE (mesmo com veredito incerto) → fala como
    DECLARADA; MIXED → status só da parte da conversa (caminho "cumprida só na parte da conversa", liderança
    `stats.conversationPartOnly`); sem `actPlace` = incompleta. `listReading` obrigatório; teto da confirmação 16.384.
  - **Divergência** (`REVIEW_DIVERGENCE_V1`): análise × revisão na mesma obrigação → confirmação focal com as duas leituras; sem decisão
    = inconclusivo. Indeterminadas da análise vão à revisão (`undetermined`).
  - **Necessidade central** (`CENTRAL_NEED_V1`): `need` da revisão cruzado com as conclusões finais; em aberto → nota neutra + regras
    literais (`centralNeedOpen`), nunca o texto da revisora.
  - **Redação V11 / verificação V10:** `saidIn` liga o limite de execução declarada à fala que a relatou; cartão só com refs do corpo
    final (`FEEDBACK_COMPOSITION_V7`). **Investigação** `INVESTIGATION_CLOSURE_V4`: sem análise nova, o recorte fica aberto com as
    ferramentas sem IA; `BUDGET` só sem orçamento de IA.
  - Provas: `speech-execution-divergence.test.ts`, prova de banco L. Diagnóstico `round-v12-diagnosis.md`.
  - **Rodada V12** (`evaluate-round-v12.ts`, por etapas; decisões antes de cada chamada em `round-v12-decisions.md`; avaliação
    `round-v12-evaluation.md`; 8/8 requisições, US$ 0,2141). Nunca repetir. A: diagnóstico correto ("Verificar" fora da conversa,
    obrigação mista), necessidade central lida pelo ângulo errado (contida pelo código), mensagem NÃO validada (reescrita não coube);
    verificador V10 recusou "Ao identificar a pendência…" (n = 1). B: ligação feita pelo modelo mas sem efeito (`listReading` omitido);
    confirmação cortada → e-mail inconclusivo por falha técnica. C: planejador parou sem usar as ferramentas sem IA; código registrou
    honestamente. Correções pós-rodada (schema, teto, `saidIn` na redação completa) não revalidadas.
- **Correção de 02/10 (fim da noite) — boas práticas dos colegas no indicador, linha de base simples + rodada V13** (sem migration):
  - **Linha de base simples** (`baseline-simple-evaluation.md`, 7 req, US$ 0,0875): uma chamada + verificação NÃO foi melhor —
    reintroduziu acusação/execução em sistema/exagero. O que distorcia as rodadas era avaliação com exigência que nenhuma base tem;
    julgar só pelo que a base exige.
  - **`PRACTICE_ANCHOR_V1`**: padrões e práticas agregados pela LINHA-ÂNCORA da obrigação (identidade de linha da base,
    `knowledge_criteria` pela parte antes do `#` da `lineKey`; `MemoryRow.practiceKey`), uma leitura por chamada (`onePerInteraction`,
    a mais grave), texto modal; título da seção quando a regra começa por abertura de lista (`practiceTitleOf`). Antes: 159 leituras
    dos colegas → 0 práticas; depois 5.
  - **Investigação V10** (`REFERENCE_GROUP_V2`, `REFERENCE_STEP_V1`, `UNLOCATED_MEMORY_V2`): grupo de referência pelo assunto e, sem
    avaliações suficientes, pelo resultado OFICIAL (limitação dita); mínimos da estratégia só endurecem; contrastes novos
    REFERENCE_ALSO_MISSES (o grupo também quase não cumpre — nunca falha individual) e REFERENCE_ONLY (boa prática sem avaliação da
    pessoa); com a comparação ligada, `reference_practices` é PASSO do diagnóstico (só memória, sem modelo); a memória do período entra
    junto dos recortes descobertos quando nenhum assunto foi localizado.
  - **Composição V9 / prompt V13 / verificação V11** (`REFERENCE_PRACTICES_V1`): práticas como fatos agregados P-n (quantos colegas
    contribuíram, nunca o tamanho do grupo; `you` null nunca vira falta), P-n só em CONTEXT/GUIDANCE/VALUE; prática que orienta sem uso
    = lacuna de utilidade (reescrita, não bloqueia); `STRENGTH_WITH_GOOD_RESULT_V1` (conduta consistente reconhecível com resultado bom).
  - **Análise prompt V9**: pergunta 2 inclui regras acionadas por SITUAÇÕES — insuficiente na C07 (Jeito Vivo §19 continua fora;
    próximo passo estrutural em `round-v13-decisions.md`).
  - **Rodada V13** (`evaluate-round-v13.ts`, critérios `round-v13-criteria.md`, decisões `round-v13-decisions.md`, avaliação
    `round-v13-evaluation.md`; 15 req, US$ 0,258). Nunca repetir. A: C07 publicável e correta, §19 ausente. C: 8 consultas com
    ferramentas, mas texto só com o número (defeitos meus) → `C-compose` REPRODUZ a investigação paga (5/5 pedidos idênticos) e paga só a
    redação: resultado + conduta dela com denominador + prática dos colegas (6 de 6), ressalva de "cinco dias úteis/SMS" generalizado.
  - **Configuração (dev, 02/10, pela UI como Renan):** estratégia do TMA v4 publicada com "Comparação com pares" LIGADA (só isso
    mudou da v3; matrículas antigas seguem pinadas na v3) e as 7 ferramentas ligadas nos 4 especialistas usados pelo Workflow ativo
    (Faturamento, Cadastro e Titularidade, Retenção e Cancelamento, Suporte Técnico — nenhum está no chat/voz). Provas:
    `reference-practices.test.ts`.

- **Correção de 02–05/10 — firmeza do retorno, reincidência por prática, referência analisada, situações + rodada V14** (sem migration):
  - **Firmeza** (`domain/firmness.ts`, `FEEDBACK_FIRMNESS_V1`): ORIENT (regra publicada depois / primeira vez sem impacto alto) ·
    CORRECT (regra vigente e impacto alto ou mesma prática não cumprida em ≥ 2 chamadas) · INSIST (prática comunicada num retorno
    ENTREGUE antes e repetida, com a data — `FeedbackMemoryStore.deliveredPractices`, só pontos comunicados). Decidida pelo código;
    redator corrige sem amaciar e sem julgar a pessoa; verificador devolve `firmnessRespected`; ponto CORRECT/INSIST sem frase ADJUSTMENT
    ou amaciado = lacuna na reescrita (composição V11, prompt V14, verificação V12). Escalonar ao gestor fica fora.
  - **Histórico por PRÁTICA** (`practiceContextOf`): reincidência pela linha-âncora (antes por obrigação, fragmentada); ponto consolidado
    (caminho/seção) mantém prática, tom e histórico por prática. Falas de padrão do indicador = `exampleQuotes` (conteúdo só da chamada).
  - **Indicador** (investigação V12): `REFERENCE_GROUP_V3` (colegas analisados também no grupo pelo resultado oficial, em largura, com
    orçamento próprio `DEFAULT_MAX_PEER_CALL_ANALYSES` = 6, parada pela cobertura de cada prática em que a pessoa falha;
    grupo ≥ mínimo de colegas da estratégia), `REFERENCE_DURATION_V1` (duração no assunto pessoa × grupo, nunca causa),
    `PATTERN_CONFIRMATION_V1` (etapa que falhou na amostra abaixo do mínimo de padrão → mais chamadas do mesmo assunto, pelo contrato).
  - **Situações** (`SITUATION_SECTIONS_V1`, análise prompt V10, revisão prompt V4, lógica V15): a análise declara as seções acionadas por
    situação e se aconteceram (com fala); seção resolvida por identidade (`sectionsOfReference`); linhas não avaliadas vão à revisão
    (`situationsInPlay`, teto 30).
  - **Cenário de setembro da Larissa (dev)**: cópias de teste movidas para "Larissa Monteiro · QA (cópias de teste)"
    (`scripts/dev/larissa-scenario/move-test-copies.ts`, manifesto para desfazer); `tma-setembro.ts` (10 contestações com erros de regra
    vigente + 10 de colegas, medição diária, fechamento oficial de TMA de setembro do Subgrupo; Larissa 452 s, Q3; `--reset` por ids).
  - **Rodada V14** (`evaluate-round-v14.ts`, `round-v14-{criteria,decisions,evaluation}.md`; 28 req, US$ 0,96; nunca repetir): monitoria
    firme e correta (sem reincidência); indicador sem diagnóstico de conduta (3 de 11 chamadas analisadas). Validações V14B–D com
    REPRODUÇÃO HÍBRIDA (`evaluate-round-v14{b,c,d}.ts`: pedido idêntico byte a byte a um pago = resposta paga; o teto do motor tem de ser o
    mesmo, porque o saldo "modelCallsLeft" entra no pedido do planejador); total US$ 1,89. Resultado: TMA com 3 padrões reais e "colegas
    6 de 6 × você 1 de 4" no rascunho (publicação caiu por falha do provedor na última verificação); monitoria publicável e completa.
    Depois: referência consultada de novo após a confirmação de padrão; composição V12 (reincidente = ponto próprio; P-n "colegas
    cumprem e você não"); firmeza por reincidência dita com números (`dueTo`, prompt V15 / verificação V13) — NÃO revalidada.
    Limitação: a mesma prática em duas linhas-âncora da mesma seção ("35. Prazo da análise") ainda conta como duas práticas.
  - Provas: `firmness.test.ts`, `pattern-confirmation.test.ts`, `reference-practices.test.ts`, `obligation-contract.test.ts`, prova de
    banco M (insistência de ponta a ponta).

- **Correção de 05/10 — práticas da operação, fim das regras por palavra, Diagnóstico por ponto do processo** (migration 109):
  - **Prática** (`PRACTICE_IDENTITY_V1`, `domain/practice-identity.ts`, `application/resolve-practices.ts`): UMA conduta esperada; a
    mesma conduta em outra linha, seção, documento, checklist ou argumentário é a MESMA prática. Quem decide é o MODELO (etapa
    `PRACTICE_IDENTITY`, lista fechada P-n / N-n / NONE no esquema), uma vez por linha-âncora AVALIADA (nunca o documento inteiro:
    dev = 7.888 linhas × 78 âncoras); o código só confere a forma; na dúvida separa; ninguém aprova. `knowledge_practices` +
    `knowledge_practice_members`; sem decisão = a identidade da linha (como antes); retorno antigo com `KC-<linha>` conta para a prática.
    Produção liga (`createEngineDeps.organizePractices`); falha/orçamento nunca derruba a análise.
  - **Usos**: reincidência/firmeza/INSIST e padrões do indicador por prática (prazo 2+2 → 4 de 4), monitoria junta regras da mesma
    prática na chamada (composição V13), investigação V13 (regra em vigor = alguma linha atual da prática), Diagnóstico "Pontos do
    processo" (uma linha por prática, fontes, "Onde mais se erra/acerta", drill `practiceKey`), principais desvios por prática,
    materiais com pontos e SEÇÕES mais indicados, CSV.
  - **Sem regra por palavra**: identidade entre versões da base = só a chave da linha (`criteria-identity.ts`; listas de negação/
    modalidade/canais/prazos/flexão e o script de auditoria saíram); revisão sem pista `lookAt` por palavras (CALL_REVIEW_PROMPT_V7);
    repetição na redação só pelo verificador (`repeats`; Jaccard saiu). Ficam (não interpretam sentido): leitura de códigos que o
    sistema criou, formatação, trava de vazamento dos DETALHES montados pelo sistema e `prohibitedClaims` configurado na estratégia.
  - **Redação**: firmeza diz o QUE a pessoa precisa saber, sem receita por ponto (prompt V16 / verificação V14).
  - Obrigação que abre por uma lista: prática = a da 1ª linha da obrigação que pede conduta (`verification.sourceLineKeys`,
    `practiceOfRowSql`); lotes de 40, saída até 32 mil tokens, motivo da falha registrado.
  - Carga do já avaliado: `scripts/feedback-engine/sync-practices.ts` — EXECUTADA no dev em 05/10 (78 linhas → 54 práticas; 92% das
    leituras com prática). Provas: `practice-identity.test.ts`, prova de banco N, `diagnostics-page.test.tsx`. Feedback não
    revalidado com modelo.
  - **Temas (`PRACTICE_THEMES_V1`, migration 110)**: o modelo agrupa as práticas em TEMAS (momento/assunto do atendimento; dados da
    organização, nunca lista fixa) e dá um NOME CURTO a cada uma (etapa `PRACTICE_THEMES`, lista fechada T-n/N-n; nome curto > 60
    caracteres = sem tema, nunca cortado). Diagnóstico: temas fechados com resumo → abrir mostra os pontos (nome curto + conduta +
    fontes); "Ainda sem tema" por último; `/memory/processes` sem paginação. Tema é só leitura: reincidência/firmeza/padrão seguem a
    prática. **Obrigação composta** (identidade prompt V2): obrigação de várias linhas sem linha de conduta é organizada inteira pela
    chave com '#' (última candidata de `practiceOfRowSql`) — fim do texto cru de várias linhas no Diagnóstico. A análise faz os três
    passos (`organizePracticesOfAnalysis`); carga do dev (05/10, autorizada, 4 pedidos): 9 temas, 22 pontos no período jun–out.
    Visões da aba Processos (combináveis — clicar soma/tira): "Onde mais se erra" = só pontos com desvio, "Onde mais se acerta" = só
    com acerto, as duas = lista única com os dois números, "Gráficos" = dos pontos escolhidos (sozinho, todos; por tema, por ponto,
    volume × taxa); Materiais abre por documento nas seções mais avaliadas + gráficos. Cores dos gráficos
    validadas (desvio `#d03b3b`, acerto `#b266d9`, neutro azul — nunca vermelho × verde). "Ver chamadas" abre a REVISÃO do recorte
    (diálogo de duas colunas: números, quem/onde mais erra filtrando, situações com contagem, lista com o que aconteceu + fala, e a
    chamada escolhida com o ponto em destaque) — o painel lateral antigo saiu.
  - **Saudação (`FEEDBACK_GREETING_V1`, 05/10)**: o motor gera o view model com `greeting: null`; a ENTREGA monta "Olá, {tratamento}!"
    pelo sistema (`withRecipientGreeting` em `domain/feedback-view.ts`, chamado por `deliveredViewOf` na publicação no Acompanhamento,
    na projeção para Chat/Avatar e na simulação do QA Lab) — só o PRIMEIRO nome do tratamento (`feedbackGreetingNameOf`; decisão de
    produto: "Maria Clara" vira "Maria" na saudação); sem nome, "Olá!". A mesma regra na apresentação "Ouvir com a INIA" ("Olá,
    Larissa!" / "Oi, Larissa.") e no cumprimento do painel da INIA; o vocativo dentro das conversas segue o tratamento inteiro. O nome
    nunca vai ao modelo e a mensagem verificada não muda. Publicados antes: `scripts/feedback-engine/reproject-feedback-greetings.ts`
    (alinha à regra atual; ensaio padrão; `--apply` grava com presentationRevisions + audit `FEEDBACK_GREETING_REPROJECTED`;
    idempotente). Dev: os 2 feedbacks da Larissa de 05/10 alinhados ("Olá, Larissa!").
  - **Redação V17 / verificação V15 + `CONSOLIDATED_STEPS_V1` (05/10)**: ponto consolidado (caminho inadequado ou várias etapas da mesma
    seção/prática) leva `steps` — cada etapa com status confirmado, falas ou ausência e regra — ao redator e ao verificador (antes só o
    status do ponto e 2 falas: o texto orientava "ofereça o bloqueio preventivo" sem dizer que faltou, e etapas além das 4 primeiras
    regras sumiam). Redação: um assunto por parágrafo (o mesmo momento da chamada pode ficar junto), todo ajuste diz o que aconteceu
    nesta chamada antes do que fazer, "o cliente" (nunca "a pessoa"), aspas curvas, aproximação do indicador sem jargão. Histórico sem
    reincidência = "foi cumprida em todas". Prova paga só da redação sobre os diagnósticos de 05/10:
    `scripts/feedback-engine/evaluation/larissa/recompose-larissa.ts` (≈ US$ 0,10; nada publicado). Os 2 feedbacks já publicados não mudam.
  - **Exemplo de como dizer — redação V18 / verificação V16 / composição V15 + `SPEECH_EXAMPLE_V1` (05/10)**: o redator pode propor, por
    ponto de desenvolvimento (A-n), uma fala ao cliente (`examples`, no máximo uma por ponto, opcional); o MESMO verificador a confere
    (item E-A-n): conteúdo fora dos fatos (prazo, valor, canal, resultado), o que a regra pede para evitar, promessa e fala genérica, com
    lacuna ou instrução ao operador (`specific` false) são recusados; valem as checagens locais de frase (número fora dos fatos, código
    interno) e só ponto de desenvolvimento. Aceito → `FeedbackViewDevelopment.suggestedResponse` (a tela já mostra em "Entenda este
    feedback → Como melhorar", "Sugestão de como dizer — não é fala desta chamada"); nunca entra na narrativa nem no texto plano. Exemplo
    de ponto não comunicado não aparece; exemplo recusado sozinho não paga reescrita (só volta como motivo quando ela já acontece);
    decisão por exemplo em `composition.examples` (auditoria). Valor que não está nos fatos (o prazo da ferramenta) é apresentado sem ser
    inventado. Provas: `domain/speech-example.test.ts`. Validado com modelo real em 05/10 (TMA da Larissa: "As informações sobre a
    contestação ficaram claras ou ficou alguma dúvida em que eu possa ajudar?").
  - **Assuntos no "Entenda este feedback" do indicador — `INDICATOR_SUBJECTS_V1` (05/10)**: `subjectsOf` (indicator-brief.ts) leva ao
    brief a métrica das chamadas da pessoa POR ASSUNTO nos dois períodos da localização (valor, chamadas, direção pela meta, comparável
    ou não, assunto investigado, analisadas = evidência com a MESMA chave do assunto — o assunto localizado também é recorte R-n);
    `subjectsViewOf` (feedback-view.ts) formata (duração em min/s, variação só quando compara, motivo quando não compara, 8 linhas +
    "E mais N") em `FeedbackView.subjects`; a tela mostra "Seus assuntos no período" em lista (`feedback-narrative-view.tsx ›
    SubjectsDetail`). Números do sistema, nunca do modelo, nunca ao redator. Provas: `indicator-subjects.test.ts`,
    `feedback-narrative-view.test.tsx`.
  - **Rodada de 05/10 (noite) com estratégia + posse corrigidas**: TMA da Larissa 23 chamadas / US$ 0,79 (antes 63 / US$ 2,55 pela
    investigação duplicada), 8 de 11 chamadas do assunto analisadas e práticas dos colegas (9/9 × 1/6). LIMITE ENCONTRADO: com 8–14
    chamadas por mês a localização exige ≥ 10 nos dois períodos — sem localizar, nenhuma chamada é analisada e o feedback fica só
    com o número oficial (Denisy, Luana, Icaro) ou abstém (Fernanda). Gatilhos automáticos: "Feedback de monitoria" = Flag nota_ura +
    Condição ≤ 2; "Feedback de indicador" = Agenda mensal dia 10 às 08:00, população Subgrupo "Diagnóstico IA — Operadores com
    gravações". INCIDENTE: trocar o gatilho no editor grava NA HORA no Workflow ativo (sem publicar) — a agenda com população "todos"
    matriculou 2.264 operadores; encerradas como `dead` (evento `flow_dead` ACCIDENTAL_SCHEDULE_CANCELLED), custo US$ 0,10.
  - **Amostra do período — `PERIOD_SAMPLE_V1` (investigação V14, 05/10, zero chamada paga na implementação)**: resposta ao limite
    acima. Quando a localização por assunto não acontece POR VOLUME (`localizationVolumeGapOf`: `PERIOD_VOLUME` = algum período abaixo de
    `minimumOverallOf`; `SUBJECT_VOLUME` = nenhum assunto com o mínimo nos dois; nunca com assunto localizado, sem métrica de chamada
    ou com a segmentação fora do contrato; indicador com alvo e volume suficiente também fica fora — não é falta de volume), a análise de chamadas está autorizada pelo CONTRATO (`contract.callAnalysis`:
    estratégia publicada com a amostra ligada — a do nascimento, `STRATEGY_AT_BIRTH_V1` —, especialista no domínio, Workflow sem
    restringir) e a pessoa tem ≥ o mínimo da estratégia em chamadas COM TRANSCRIÇÃO no período, o motor analisa uma amostra
    DETERMINÍSTICA (`periodSampleOf`): o assunto com mais chamadas primeiro, depois os demais em rodízio (volume desc., chave), cada um
    na ordem do sistema (espalhada no tempo); memória existente conta (reaproveitada, sem custo); alvo = max(amostra da estratégia,
    mínimo), dentro do teto de análises (`maxInteractions`), do teto de consultas e do orçamento de IA. Roda depois do planejador e da
    confirmação de padrão, antes da referência — no plano do CONTRATO a referência vale para o assunto que a amostra escolheu; chamada
    de colega só com a comparação autorizada (`PEER_ANALYSIS_AUTHORIZATION_V1`). Evidência = UMA entrada do período (`UNLOCATED`,
    `sampleBasis: PERIOD_SAMPLE`, `segmentKey: PERIOD`, `periodSubjects` por assunto) no lugar das entradas por assunto: padrões são
    OBSERVAÇÃO do período, nunca causa (`ATTRIBUTION_LIMIT` e "não foi possível ligar isso à variação do indicador" mantidos; o brief
    não repete prática que um recorte descoberto já trouxe como ponto) e nunca contam como exame de um recorte que piorou (dia fora do
    padrão não examinado continua `CHANGE_LOCATED_NOT_EXAMINED`). Registro `tools.periodSample` (SAMPLED · MEMORY_SUFFICIENT ·
    NOT_ALLOWED · BELOW_MINIMUM · NO_ROOM · TOOL_BUDGET · MODEL_BUDGET, com motivo). Sem autorização: nada é listado nem analisado e a
    memória por assunto (`UNLOCATED_MEMORY_V2`) segue como antes. Provas: `period-sample.test.ts`. NÃO revalidado com modelo real
    (Denisy/Fernanda/Icaro precisam de nova execução — a V14 invalida o reuso das investigações V13).
  - **Sinal da população numérico e com sentido declarado — `POPULATION_SIGNAL_V2` (06/10)**: a estratégia aceita flag NUMÉRICA com
    condição declarada (`populationSignal.condition {operator LTE|LT|GTE|GT|EQ, value}`, ex.: `nota_ura` ≤ 2; sim/não nunca usa condição)
    e DECLARA o que a chamada sinalizada representa (`effect` ADVERSE = resultado ruim | FAVORABLE; obrigatório para publicar; ausente em
    versões antigas = o sentido do próprio indicador, como antes) — nunca deduzido do nome da flag. O motor resolve o sinal no catálogo
    (`resolveSignal`) e usa UM predicado SQL (`signalPredicateSql`, parâmetros ligados) em todas as consultas; a taxa de chamadas
    sinalizadas segue o sentido declarado do sinal (`proxyOf().direction`, também no grupo de referência por assunto): NOTA_URA é "maior
    é melhor", mas mais notas ≤ 2 é PIORA. A amostra do período (`PERIOD_SAMPLE_V1`) em indicador por sinal começa pelo assunto com mais
    chamadas sinalizadas e pelas próprias chamadas sinalizadas. Tela: seção "Sinal nas chamadas" na aba Diagnóstico com IA (flag ativa
    do catálogo, condição para numérica, "Resultado ruim/bom"; salvar o rascunho libera segmentação e análise). Provas:
    `population-signal.test.ts`, `indicator-diagnosis-v2.test.ts`, `indicator-diagnostic-strategy.test.tsx`. Dev (06/10, pela tela):
    NOTA_URA v1 (`nota_ura` ≤ 2, ruim) e REINCIDENCIA_7D v1 (`rechamada`, ruim — avalia a própria chamada de retorno, nunca a que gerou a
    reincidência), Aderência desativada; Workflows manuais "Feedback de indicador · Nota da URA / Reincidência (execução manual)";
    cenário da Larissa `scripts/dev/larissa-scenario/nota-ura-reincidencia/setembro.ts` (38 chamadas, fechamentos de setembro do
    Subgrupo, `--reset` pelos ids). Achados na 1ª execução real e corrigidos (investigação V15): `ZERO_BASELINE_MATERIALITY_V1` — variação a
    partir de 0 no período anterior é material (a taxa que saía de 0% nunca localizava o assunto: o foco ficava vazio e o motor caía em
    dias atípicos); organização das práticas (PRACTICE_IDENTITY/THEMES) com 240 s (com 120 s estourava em metade das análises, cada
    estouro consumindo a reserva do orçamento da execução). `CURRENT_RULES_AFTER_ANALYSIS_V1` (investigação V16): as regras em vigor são
    lidas DEPOIS das análises da execução — as práticas que essas análises organizam deixaram de parecer "regra que mudou na base"
    (`current-rules-after-analysis.test.ts`).
  - **Prazo conferido, fraseologia do argumentário e retorno oculto (06/10)**:
    - `SOURCE_DEFINED_CONTENT_V1` (análise prompt V11, revisão prompt V5, lógica `CALL_ANALYSIS_LOGIC_V16`): quando a fonte DEFINE o
      conteúdo a informar (prazo, valor, canal), a fala só cumpre se disser esse conteúdo — outro prazo, outra unidade ou prazo vago é
      NOT_MET; a orientação traz o valor da fonte (leitura do modelo, nunca número comparado pelo código). Composição V19 / verificação
      V17: o ajuste diz o que foi dito e o correto pela regra. A investigação reaproveita a leitura de uma chamada só pela versão da
      LÓGICA (`analyzedInteractionIds`) — versão nova da base não invalida a leitura (pela vigência ela não vale para a chamada antiga);
      por isso a mudança de lógica exige subir `CALL_ANALYSIS_LOGIC_VERSION`.
    - `ARGUMENT_PHRASING_V1`: a fraseologia sugerida do argumentário (`suggestedScript`, da MESMA versão que a análise usou) chega ao
      redator como fato do ponto de desenvolvimento (`BriefRule.phrasing` → `suggestedPhrasing`): base do "Sugestão de como dizer", com as
      lacunas preenchidas só pelos fatos (o prazo da regra); nunca critério. Monitoria (`argumentPhrasingsForRun`) e padrões de indicador
      vindos de argumentário (`argumentPhrasingsAt`, versões em vigor no fim do período). Prova: `argument-scripts-engine.test.ts`.
      Composição V20 / verificação V18: ponto comunicado com fraseologia e sem exemplo aceito = lacuna de utilidade
      (`missingPhrasingExample`, pede a reescrita; nunca bloqueia) — na 1ª rodada o redator recebeu a fraseologia e não a usou.
    - `ARGUMENT_SCRIPTS_ALL_IN_FORCE_V1` (lógica `CALL_ANALYSIS_LOGIC_V17`): orçamento de argumentários no prompt 30 mil → 100 mil
      caracteres. Com 30 mil eles entravam em ORDEM ALFABÉTICA até o corte (14 de 37 no dev) — "Respeito e acolhimento…" e "Troca de
      titularidade…" nunca chegavam à análise (a impaciência da operadora e a fraseologia de titularidade ficaram fora do retorno).
      Todos os vigentes no escopo entram; a aplicabilidade é a leitura da análise. Corte registrado em `omittedArgumentScripts`.
    - `CALL_IDENTIFIER_INTEGRITY_V1`: identificador longo (protocolo, telefone, documento — 8+ dígitos, juntos ou com ponto/hífen/espaço;
      datas fora) numa frase ou numa fala sugerida só vale se estiver numa FALA desta chamada (`IDENTIFIER_NOT_FROM_CALL`, checagem
      local de integridade; o verificador também recusa). O número no texto de uma regra é exemplo ilustrativo — a monitoria da L06
      sugeriu "seu protocolo é 202609130184", o número do exemplo da Contestação.
    - `CURRENT_PRACTICE_TITLE_V1`: o nome da prática que vai ao redator do indicador é o ATUAL do catálogo
      (`withCurrentPracticeTitles`) — a investigação reaproveitada carregava o nome da época. Lacuna conhecida (não corrigida): o
      organizador de práticas nunca generaliza o nome quando entra uma regra de outro documento ("…da solicitação de contestação…"
      aplicado à Segunda via fez a Nota da URA se abster por incoerência). Dev 06/10: 6 nomes corrigidos à mão (o de contestação e os
      que diziam "prazo exibido na ferramenta"/"informados pelo sistema").
    - `HIDDEN_ARTIFACT_NOT_DELIVERED_V1`: retorno oculto do Acompanhamento (artefato de desenvolvimento) não conta como ponto já
      entregue (`deliveredFindings`) nem como orientação anterior da firmeza (`deliveredPractices`) — o mesmo `engineMessageHiddenSql` da
      entrega única. Antes, refazer um feedback depois de ocultá-lo suprimia todos os pontos e o motor se abstinha
      (`NO_ACTIONABLE_DIAGNOSIS`). Prova de banco P.
    - Titularidade (06/10, composição V16 / prompt V21 / verificação V19, zero IA na correção): `RULE_SOURCES_V1` — a obrigação junta
      linhas de várias fontes; no brief cada origem (documento/argumentário + seção) é uma regra própria, lida da MESMA versão que a
      análise usou (`sourceLines` em `generate-feedback › procedureForRun`), e o item do campo "evitar" do argumentário é `avoid`
      (estrutura do cadastro): vai para "O procedimento pede evitar", nunca para "O processo orienta" (antes "Ler a lista da outra parte"
      e "Demonstrar impaciência" apareciam como orientação). Sem a origem de todas as linhas = regra única (como antes). O caminho só é
      ponto próprio com evidência própria (`pathEvidence`/`correctPath`): no contrato de obrigações o "Caminho do atendimento" juntava
      todas as condutas e as não comunicadas (recapitulação, contato anterior) eram marcadas como entregues. `PRACTICE_TITLE_V1`: título
      = nome curto da prática da linha PRINCIPAL (`lineTitles`); ponto de várias etapas de um argumentário leva o nome dele.
      `ALL_DEVELOPMENTS_V1`: ponto de desenvolvimento (monitoria) que nenhuma frase comunica é lacuna pedida na reescrita (não bloqueia).
      `STEP_DETAILS_V1`: nos detalhes, cada etapa de um ponto consolidado aparece com a própria fala/ausência e regras. Condição de item de
      argumentário = "Condição: …". Prova: `rule-sources.test.ts`.
    - `NARRATIVE_FORMATTING_V1` (prompt V21 / verificação V19): o texto do retorno sai com formatação que facilita a leitura — o redator
      marca a frase como item de lista (`format` BULLET/NUMBERED) e pode destacar a expressão essencial em **negrito**; o SISTEMA monta o
      markdown de cada parágrafo de `view.narrative` (`paragraphMarkdownOf`: texto corrido, listas "- "/"1. " separadas por linha em
      branco, lista de um item vira texto) e remove qualquer outra marca (`inlineMarkdownOf`: título, tabela, link, código, citação,
      negrito desbalanceado ou da frase inteira). Card = texto puro (`plainInlineOf`). A verificação continua frase a frase; a voz tira as
      marcas (`toSpeakable`). Tabela só nos detalhes, montada pelo sistema. O front renderiza a narrativa com RichContent (sessão
      "Reestruturação UI colaborador", combinado em 06/10). Prova: `narrative-formatting.test.ts`.
    - 2ª rodada da titularidade (06/10): `ADJUSTMENT_IN_CALL_V1` — ponto de desenvolvimento (monitoria, tom ORIENT, regra vigente) dito só
      como orientação para a próxima vez é lacuna pedida na reescrita (falta a frase ADJUSTMENT com o que aconteceu NESTA chamada);
      `OFFICIAL_PHRASING_V1` — sem exemplo do redator aceito, os detalhes mostram a fraseologia OFICIAL do argumentário, como está e
      identificada ("Como o argumentário “X” orienta dizer", `suggestedResponseSource`); com lacuna "[…]" ou número de 8+ dígitos, não.
      "Ouvir com a INIA" fala o feedback INTEIRO (`MAX_BODY_WORDS` 150 → 450 em `application-presentation.ts`): com 150 a voz parava
      no meio dos ajustes. Provas: `rule-sources.test.ts`, `feedback-application/domain/speech-length.test.ts`.
    - `OFFICIAL_RESULT_TABLE_V1` (composição V17): o feedback de INDICADOR traz, no texto, logo depois do primeiro parágrafo, uma tabela do
      resultado oficial montada pelo SISTEMA (`brief.officialTable` → `officialTableMarkdownOf`: um indicador = 2 colunas, resultado ×
      meta × período anterior; fechamento com vários = uma linha por indicador); a voz não lê a tabela (`application-presentation`).
      Reprocessar o texto dos feedbacks já publicados SEM refazer diagnóstico: `scripts/feedback-engine/recompose-published-feedbacks.ts`
      (paga só redação + verificação, teto 8 chamadas por feedback; anterior em `presentationRevisions` + audit
      `FEEDBACK_TEXT_RECOMPOSED`; atualiza também a mensagem do motor). Rodar o Workflow de novo refaria a investigação de indicador
      quando `CALL_ANALYSIS_LOGIC_VERSION` muda (a chave da investigação e a memória de chamadas são por versão da lógica).
    - Formatação sem engessar (composição V18 / prompt V23 / verificação V20): `LIST_CHECK_V1` — na mesma verificação, o verificador
      aponta frases com relação de 3+ itens em texto corrido (`unlistedRelation`, "vazio é o normal") → lacuna `missingList` pede a
      reescrita com a lista (nunca bloqueia); a reescrita recebe as frases aprovadas com a marca "[item de lista]". `BOLD_LIMIT_V1` —
      negrito com mais de 8 palavras volta a texto; um destaque por parágrafo de texto corrido (itens de lista podem ter o seu). A
      formatação nunca é obrigatória: texto corrido bem escrito é um bom retorno (prompt).
    - `SPOKEN_LISTS_V1` (`toSpeakable`, conversational-delivery): lista apresentada por uma frase terminada em ":" é falada como
      enumeração ("…os seguintes pontos: número a portar, próxima etapa e data da janela"); numerada vira "primeiro, …; segundo, …; e por
      fim, …"; sem a abertura, cada item continua sendo uma frase. Tabelas do RichContent (front) com moldura arredondada, cabeçalho no
      tom da marca (`bg-primary/10`), linhas alternadas e números tabulares — vale para toda superfície que usa RichContent.
    - Dev (06/10, autorizado pelo usuário, direto no banco): 13 procedimentos ganharam versão 2 com prazos concretos em dias úteis no
      lugar de "o prazo exibido na ferramenta" (vigência desde 01/07/2026) e os 36 argumentários publicados passaram a valer desde
      01/07/2026 (gatilho de imutabilidade desligado só na transação; antes: 05/10/2026 para 35 e 09/09/2026 para o legado; desfazer =
      apagar as versões 2 com `effective_from` 01/07 e voltar essas datas). Workflows manuais novos (pela tela):
      "Feedback de indicador · TMA (execução manual)" e "Feedback de monitoria (execução manual)" (interação, Orquestrador de monitoria).
  - **Entrega única — `ONE_MONITORING_PER_CALL_V1` + `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1` (05/10, decisão de produto)**: uma
    chamada recebe NO MÁXIMO uma monitoria (qualquer Workflow, qualquer sinal, qualquer caminho de publicação) e um indicador NO MÁXIMO
    um feedback por período oficial para a pessoa. "Entregue" = mensagem do motor com `delivered_at` ou, na monitoria, feedback
    PUBLICADO com evidência da chamada (caminhos anteriores ao motor contam); ocultado como artefato de desenvolvimento não conta
    (`domain/delivery-guards.ts`, SQL em `infrastructure/delivery-guards-sql.ts`, memória `deliveredMonitoringOf/
    deliveredIndicatorPeriods` nos três stores). Checagem ANTES de pagar ("Chamar agente"/Orquestrador com avaliação de processo
    devolvem `CALL_ALREADY_MONITORED` sem IA; a investigação pula indicador × período entregue → `PERIOD_ALREADY_DELIVERED`; o "Gerar
    feedback" se abstém com o motivo) e DENTRO da transação da publicação, com `pg_advisory_xact_lock` por chave (duas execuções
    concorrentes publicam uma só — prova O). Output: mensagem impedida não sai por NENHUMA superfície e `nodeOutput.notPublished
    {reason, text}` registra o motivo (não é falha). "Testar diagnóstico" ignora a regra (`skipDeliveredPeriods: false`).
    **`PRV_CLOSING_STRATEGY_SCOPE_V1`**: do fechamento do PRV só entram indicadores com estratégia PUBLICADA e ativa (versão em vigor no
    nascimento); nenhum → `NO_INDICATOR_WITH_STRATEGY`. Provas: `application/delivery-guards.test.ts`,
    `workflows/application/delivery-guards-workflow.test.ts`, `INIA_DB_PROOF=1 … feedback-engine-workflow-proof` (B, I, O).
