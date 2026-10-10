# Monitoring Architecture V2 — auditoria e plano de simplificação

Status: **AUDITORIA + PLANO (nenhum código alterado)**. Data: 2026-09-29. Base: commit `5e5a6ba` (V1.7.4 encerrada).

Princípio: **a IA entende a chamada; o código garante que ela só possa afirmar o que consegue sustentar. Fatos rígidos, linguagem livre.**

Fontes desta auditoria: leitura do código (`reliable-feedback/domain`, `agents/domain`, `knowledge/domain`, `indicator-diagnosis/domain`),
o histórico V1.7.1 → V1.7.4 (CLAUDE.md) e **medição somente leitura** dos 69 artefatos de monitoria de processo gravados no dev
(227 etapas avaliadas, 201 itens, 52 rascunhos de narrativa).

---

## 1. Pipeline atual real (monitoria por Flag)

| # | Etapa | Módulo | LLM | Regex/léxico | Altera significado | Bloqueia/QA | Fallback | Persiste |
|---|---|---|---|---|---|---|---|---|
| P0 | Recuperação + cobertura do fechamento + processo primário | `knowledge/application/retrieve-knowledge.ts`, `primary-process.ts`, `section-roles.ts` | não | título da seção (léxico) | não | não | não | rastro |
| P1 | Catálogo de etapas `[CP-…]`, MUST_ASSESS, marcação no prompt | `checkpoint-catalog.ts`, `knowledge-list.ts` | não | marcadores de lista | não (identidade) | não | não | não |
| S1 | **Especialista** (avaliação de processo, contrato V4) | `run-agent.ts` / `run-specialist-tool.ts` | **sim** | — | **sim (a interpretação)** | — | — | agent_runs |
| S2 | Contrato + retry técnico (JSON, matriz status×evidência, teto, refs) | `process-assessment-contract.ts`, `structured-output-retry.ts` | retry | não | não | falha fechada | não | validation |
| S3 | Reparo de cobertura + **reparo semântico** (1 chamada) | `assessment-coverage-repair.ts`, `assessment-semantic-repair.ts` | **sim** | gatilho vem de S4f (regex) | sim | não | não | validation |
| S4a | Evidência literal por turno + falante + dono | `verifyEvidenceUnit`, `ownershipOf` | não | não (literal) | rebaixa | — | não | — |
| S4b | Identidade da etapa (checkpointRef) + match da citação | `sourceQuoteMatchOf` | não | normalização | não | QA se ambígua | não | — |
| S4c | Regra da base literal/publicada/apresentada + **âncora léxica ≥ 2 termos** | `verifyKnowledgeQuote` | não | **sim (termos)** | aplicabilidade | **QA** | não | — |
| S4d | Elegibilidade (seção executável × contexto) | `checkpoint-eligibility.ts` | não | título da seção | sim (NOT_APPLICABLE) | — | não | — |
| S4e | **Conduta** (checagem, proibição, papel declarado) | `evidence-conduct.ts` | não | **CHECK_ACT, abstenção, "sem validar"** | sim (NOT_OBSERVABLE) | — | não | — |
| S4f | Comportamento canônico (vocabulário fechado) | `canonical-behavior.ts` | não | sim | identidade analítica | — | não | — |
| S4g | **Polaridade** (prazo/protocolo) | `evidence-polarity.ts` | não | **6 regex** | sim | QA | não | — |
| S4h | **Âncora estruturada** (12 caminhos: seleção, ação, desvio, "evitar", item perguntado, entendimento…) | `structured-anchor.ts`, `action-semantics.ts`, `portuguese-verbs.ts` | não | **famílias de verbo/objeto, flexão** | aplicabilidade | **QA** | não | — |
| S4i | **Âncora de conduta semântica** (paráfrase) | `semanticConductAnchorOf` | não | termos/classes | aplicabilidade | QA | não | — |
| S4j | Conflito da mesma etapa canônica | inline | não | não | aplicabilidade | QA | não | — |
| S4k | Omissão verificada (condição, janela, oportunidade, contraprova) | `verified-omission.ts`, `step-semantics.ts` | não | condição (estrutura) + contraprova (termos) | sim | QA | não | — |
| S4l | Etapa pulada (pré-requisito "X antes de Y") | `prerequisiteSkipOf` | não | termos | sim | — | não | — |
| S4m | Regra operacional + backfill + segmentos + exemplos da seção | `rule-selection.ts`, `knowledge-segments.ts` | não | papel do segmento | não (apresentação/segurança) | QA se regra = exemplo | não | — |
| S4n | Aplicabilidade de produto | `applicability-resolution.ts` | não | produto no texto | sim | — | não | — |
| S4o | **Etapa composta + subitens tipados** | `composite-checkpoint.ts`, `subitem-semantics.ts` | não | **47 testes regex (dinheiro, prazo, canal…)** | sim (PARCIAL) | QA | não | — |
| S4p | Âncora por itens da composta | inline | não | detectores tipados | aplicabilidade | — | não | — |
| S4q | Completude da etapa obrigatória (momento da recapitulação) | `requiredCompletionOf` | não | marcador "Resumindo…" | cria etapa do sistema | QA | não | — |
| S4r | Mesma fala × violação na seção | inline | não | não | sim | — | não | — |
| S4s | Dependência de pré-requisito (V1.7.4) | `prerequisiteDependencyOf` | não | termos | sim | — | não | — |
| S4t | Convergência por comportamento canônico | `behavior-convergence.ts` | não | não | fonte primária × apoio | QA em conflito | não | — |
| S5 | Itens (seção, prioridade, rótulo, frase de comportamento) | `process-items.ts`, `behavior-presentation.ts` | não | flexão/nominalização | não (apresentação) | QA rótulo | não | artefato |
| S6 | Ponto de atenção de produto | `applicability-items.ts` | não | não | não | não | texto do sistema | artefato |
| S7 | **Redator de itens** (V6: observed/why/what/exemplo) | `reliable-writer-prompts.ts` | **sim** | — | redação | — | — | writer_raw |
| S8 | **Validadores do redator** + degradação por campo + **fallback V5** | `reliable-writer.ts`, `effect-claims.ts`, `typed-number-grounding.ts`, `suggested-response.ts` | não | **GENERIC_WORDING, UNGROUNDED_*, vocabulários** | substitui texto | **QA** | **sim** | artefato |
| S9 | Política READY/HOLD/BLOCKED | `reliable-feedback-item.ts` | não | não | não | sim | não | decisão |
| S10 | **Redator de narrativa** (V4) | `supervisor-narrative-prompt.ts` | **sim** | — | redação | — | — | artefato |
| S11 | **Validadores da narrativa** + **narrativa determinística** | `supervisor-narrative.ts`, `feedback-presentation.ts` | não | **NARRATIVE_VOCABULARY, GAP_MARKER, PRAISE, termos sem base** | substitui texto | não | **sim (template)** | artefato |
| S12 | Composição V1.7.2 / apresentação legada (abertura/fechamento) | `supervisor-presentation.ts`, `feedback-presentation.ts` | não | vocabulário fechado | não | não | sim | — |
| S13 | View model ("Entenda este feedback") | `feedback-view.ts` | não | não | não | não | não | snapshot |
| S14 | Defesas finais da publicação (efeito, exemplo, apresentação) | `publish-reliable-feedback.ts` | não | sim | não | recusa | não | — |
| S15 | ProcessObservations + prontidão analítica | `process-patterns.ts`, `observation-readiness.ts` | não | não | não | analytics | não | **tabela** |

**Etapas que interpretam ou reinterpretam semântica hoje: 22** (S1, S3, S4c, S4d, S4e, S4f, S4g, S4h, S4i, S4k, S4l, S4n, S4o, S4p, S4q, S4r, S4s, S5, S7, S8, S10, S11). **Chamadas de LLM por feedback: 3–4** (especialista, reparo opcional, redator de itens, redator de narrativa).

## 2. O que os dados reais mostram

| Medição (69 artefatos, 227 etapas) | Valor |
|---|---|
| Status mudado pela verificação | **12 de 227 (5%)** — COMPOSITE_PARTIAL 2, OMISSION_NOT_OBSERVABLE 6, EVIDENCE_ACTION_MISMATCH 3, NO_EVIDENCE 1 |
| Etapas VERIFIED pela âncora léxica ≥ 2 termos | 95 |
| Etapas VERIFIED por algum dos 12 caminhos de âncora estruturada/semântica | 64 |
| Etapas só literais (vão ao QA) | 42 |
| Motivos de HOLD_FOR_QA | **KNOWLEDGE_APPLICABILITY_UNVERIFIED 39**, WRITER_FALLBACK_USED 21, WRITER_VALIDATION_FAILED 21, outros 14 |
| Rascunhos de narrativa descartados | **42 de 52 (81%)** — 40 por PRESENTATION_UNSUPPORTED_CLAIM (termo fora da lista) |
| Golden Demo (11 artefatos V174F/G) | narrativa do redator exibida em **3**; nas outras 8 o colaborador leu o **template do sistema** |

Leitura: a verificação quase não muda conclusões; o que ela faz é **decidir QA por léxico** (a âncora ≥ 2 termos e os 12 caminhos que
existem para compensá-la). E o texto "engessado" não é culpa do redator: **o validador léxico descarta 81% das narrativas** e o
template assume.

## 3. Bugs prevenidos × causados (histórico real)

| Camada | Preveniu (real) | Causou (real) |
|---|---|---|
| S4a literal/turno/falante | citação inventada, fala do cliente como conduta, pares concatenados | — |
| S4c âncora léxica ≥ 2 termos | — (nunca foi o que barrou um erro) | **P0 V1.7.4**: aceitou "essa opção está disponível" como verificação; 39 HOLDs por paráfrase |
| S4e conduta | **P0**: resultado afirmado ≠ verificação; proibição "cumprida" sem prova | depende de regex CHECK_ACT; gatilho do reparo semântico |
| S4g polaridade | "não sei te dizer um prazo" como prazo informado | 6 regex; conflito → QA |
| S4h âncora estruturada | compensou S4c em 64 etapas | V1.7.1k/l/m/o: cada smoke reprovado criou um caminho novo (checklist em 1ª pessoa, item perguntado, entendimento…) |
| S4k omissão | acusação de ausência com transcrição cortada / etapa condicional | contraprova por termos |
| S4o composta/subitens | "Recapitulei" como recapitulação completa | V1.7.1l canal de retorno × telefone de contato (falso positivo), detectores por tipo |
| S4s dependência | chamada 10: oferta de pacote como força | depende de termo em comum |
| S8 validadores do redator | efeito garantido, exemplo como fato, número sem base, ação declarada como executada | GENERIC_WORDING/UNGROUNDED em paráfrase correta → 42 HOLDs, "dúvida × entendimento" (V1.7.1o) |
| S11 validadores da narrativa | call 4 (elogio inventado, depois de 5e5a6ba) | **81% das narrativas descartadas**; "prazos" num ajuste correto recusado |
| S12 composição/apresentação | — | "Na próxima chamada, na próxima oportunidade", frases repetidas, "o ponto X precisa de ajuste" |

## 4. Classificação

| Categoria | Camadas |
|---|---|
| **A. Segurança factual** | S4a, S4e (ônus da prova positiva), S4k (omissão), S4m (exemplo ≠ fato), S8 parte objetiva (efeito/causa, número tipado, ação declarada, exemplo sem base, dado pessoal, ref interna), S9, S14 |
| **B. Integridade de dados** | P1, S2, S4b, S4c (parte literal/publicada/apresentada), S4f, S4j, S4t, S15 |
| **C. Interpretação semântica** (deveria estar no especialista) | S1, S4d, S4n, S4o, S4q, S4s |
| **D. Interpretação duplicada** | **S4c (âncora ≥ 2 termos), S4g, S4h, S4i, S4l, S4p, S4r**, S3-semântico, S8 parte léxica (GENERIC_WORDING, UNGROUNDED_*), S11 parte léxica (vocabulário, termos sem base, GAP_MARKER) |
| **E. Apresentação** | S5, S6, S7, S10, S12, S13 |
| **F. Legado** | S12 abertura/fechamento (`FEEDBACK_PRESENTATION_V1`), composição V1.7.2, redator de itens V1–V5 (congelados, só leitura) |

## 5. Plano de simplificação (menor conjunto)

Nenhum agregado novo: o **Trusted Assessment é o `VerifiedProcessAssessment` que já existe**; ProcessObservations e feedback já derivam
dele. A mudança é tirar dele as reinterpretações léxicas e dar ao especialista a responsabilidade semântica explícita.

### 5.1 Especialista — contrato V5 (nova versão; V4 congelado)
- **MOVE (de S4e/S4g/S4h/S4i para S1)**: por etapa FOLLOWED/NOT_FOLLOWED, `conductEvidence {role, relation}` passa a **obrigatório** (hoje opcional).
- **MOVE (de S4s/S4l)**: `dependsOn: checkpointRef | null` — a etapa só vale se o pré-requisito foi cumprido (declarado, não inferido por termo).
- **MOVE (de S4o)**: etapa composta devolve `items[{text, covered: true|false|null, evidence}]` — o especialista diz o que foi coberto; o código confere a fala.
- **ADD (contexto, §15/§16)**: `interaction {customerNeed, situation, path}` e, por etapa, `summary` + `recommendedBehavior` — interpretação (nunca evidência), fonte do texto dos detalhes.

### 5.2 Verificação — Safety Gate fino (`verifyProcessAssessments`)
| Ação | O quê |
|---|---|
| **KEEP** | S4a literal/turno/falante/dono; S4b identidade; literal/publicado/apresentado da regra; S4d elegibilidade; S4k omissão (sem a contraprova léxica); S4m exemplo ≠ fato; S4n produto; S4q completude obrigatória; S4t convergência (analytics); S4j conflito |
| **SIMPLIFY** | S4e conduta → **matriz de papel** (checagem cumprida exige QUESTION_ASKED/CONDITION_VALIDATED com "?" ou ato de checagem declarado; RESULT_ASSERTED nunca cumpre checagem; proibição nunca vira força por ausência) — sem regex de conteúdo; S4o composta → itens declarados + fala verificada; S4s → `dependsOn` declarado |
| **REMOVE** | **S4c âncora ≥ 2 termos** (aplicabilidade = identidade do catálogo + regra literal + processo aplicável + papel compatível); **S4h âncora estruturada** (12 caminhos); **S4i âncora semântica**; **S4g polaridade** (substituída pelo papel); **S4l etapa pulada por termos** (vira `dependsOn`); **S4p âncora por itens**; **S4r** (coberta por `dependsOn` + papel) |
| **Continua QA (incerteza real)** | citação de OUTRA etapa, conflito da mesma etapa, regra que é exemplo, composta sem cobertura declarada, omissão não verificável, análise PARCIAL, papel incompatível após o reparo |

### 5.3 Redação — um redator de composição
| Ação | O quê |
|---|---|
| **REMOVE** | Redator de itens S7 como chamada separada + fallback V5 + degradação por campo (S8 léxico). Os detalhes passam a mostrar `summary`/`recommendedBehavior` do especialista (validados pelas mesmas checagens objetivas) + fala + regra. **−1 chamada de LLM** |
| **SIMPLIFY** | Redator de narrativa → **redator de composição V5**: recebe o assessment (contexto, forças, achados, regra, orientação permitida) e devolve **frases com vínculo**: `[{text, stance: CONTEXT\|STRENGTH\|FINDING\|GUIDANCE, refs: [SF-n/SD-n]}]` + card. Estrutura, ordem e extensão livres; nenhuma seção obrigatória |
| **KEEP (objetivo)** | efeito/causa, número tipado, ação declarada ≠ executada, exemplo sem base, códigos internos, nome/tratamento, dado pessoal, ref interna |
| **REPLACE vocabulário por vínculo** | STRENGTH só com ref de força; FINDING só com ref de achado; todo achado referenciado; nenhuma ref inexistente — substitui `PRESENTATION_UNSUPPORTED_CLAIM`, `NARRATIVE_VOCABULARY`, `GAP_MARKER`, `NEGATIVE_FACT`, `GAP_OMITTED` por radical. Rede de segurança mantida: elogio em frase CONTEXT/GUIDANCE (lista PRAISE, bug real da chamada 4) |
| **KEEP** | Narrativa determinística só como último recurso (redator falhou/recusado) — sem "Você conduziu bem" sem força |
| **REMOVE (legado)** | composição V1.7.2 e abertura/fechamento `FEEDBACK_PRESENTATION_V1` no caminho novo (artefatos antigos continuam lidos pelo código congelado) |

### 5.4 Reparo e política
- Reparo semântico: **gatilho = papel incompatível com o status** (inconsistência do especialista), não regex de conduta. Continua 1 chamada.
- Retry técnico: inalterado (1×).
- HOLD_FOR_QA: sai `KNOWLEDGE_APPLICABILITY_UNVERIFIED` por léxico e `WRITER_FALLBACK_USED/VALIDATION_FAILED` (não há mais redator de itens); ficam os motivos de incerteza real acima.

### 5.5 Complexidade
| | Antes | Depois (plano) |
|---|---|---|
| Etapas semânticas | 22 | **10** (S1, S3, S4d, S4e-matriz, S4k, S4n, S4o-declarada, S4q, redator de composição, validador de vínculo) |
| Chamadas de LLM por feedback | 3–4 | **2–3** |
| Módulos removidos do caminho | — | `structured-anchor`, `action-semantics` (âncora), `evidence-polarity`, `subitem-semantics` (detecção), `portuguese-verbs` (se só usado aqui), `behavior-presentation` (fallback), `supervisor-presentation`, grande parte de `reliable-writer` (léxico) |

## 6. O que NÃO muda
ProcessObservations (identidade canônica, status, completude, lineage da base, versão, prontidão analítica, privacidade, `checkpoint_ref`),
READY/HOLD/BLOCKED, idempotência, versionamento (V4/V6/V4-narrativa congelados; artefatos antigos lidos como estão), Indicator
Diagnosis/TMA (usa o contrato V4 e fica nele), Rechamada, Chat/Avatar, dados publicados.

## 7. Como vai ser provado
1. **Replay sem especialista novo**: as 11 avaliações reais (V174F/G) passam pelo Safety Gate novo (contrato V4 lido como está —
   papéis declarados onde existem) → diff de status/aplicabilidade/QA × antigo, sem IA.
2. **Redator de composição sobre as 11 avaliações gravadas**: ~11 chamadas pagas pequenas (≈ US$ 0,01) → OLD × NEW lado a lado, com os
   13 critérios SIM/NÃO do §38 (factualidade por checagem determinística; qualidade para inspeção humana).
3. Testes: WRITER CANNOT CREATE FACTS (§50), riscos reais (§49), TMA/Rechamada, prova de banco.
4. **Contrato V5 do especialista só é exercitável ao vivo**: no máximo 3 chamadas (uma positiva, uma de desenvolvimento, uma mista).

---

## 8. Resultado da implementação (2026-09-30)

Commits: `937de9e` (fase 1 — contrato V5), `074d9c3` (fase 2 — Safety Gate fino), `e979118` + `6dbf9d6` (fase 3 — redator de composição).

| Fase | Replay (10 chamadas, gabarito) | Observação |
|---|---|---|
| Base (V4 gravado, código atual) | 10/10 | chamada 3 em QA (aplicabilidade só literal) |
| 1 — especialista V5 (14 requisições pagas, ≈ US$ 0,045 estimado) | 10/10 | conductEvidence 23/23, 0 etapa fora do contrato, contexto 10/10; chamada 3 sai de QA com evidência melhor ("Pronto, verifiquei") |
| 2 — Safety Gate fino (sem chamada) | 10/10, itens idênticos à fase 1 | a 1ª versão PIOROU (chamadas 6 e 8 perderam o gap) → etapa pulada mantida, justificada |
| 3 — composição (20 chamadas pagas) | classificação 10/10; narrativa do redator aceita 9/10 (base V174F: 3/11) | a recusada (chamada 4) omitia o ajuste principal — recusa correta |

Smoke ao vivo (3 chamadas, Workflow real, ≈ US$ 0,018): **mista** publicada correta; **positiva** com narrativa aceita e correta, mas em QA por
`GENERIC_WORDING` do redator de itens; **desenvolvimento** com defeito: o redator de composição tratou o ajuste principal como contexto
(recusado corretamente), o texto do sistema assumiu e reutilizou a frase do REDATOR DE ITENS "após confirmar a disponibilidade da opção"
(contradiz o gabarito) e repetiu a promessa de desbloqueio (dois pontos para o mesmo comportamento). Os 2 feedbacks publicados pelo smoke
foram ocultados (`MONITORING_V2_SMOKE`).

**Não feito do plano:** remoção do redator de itens (continua 1 chamada separada, com seus validadores e o texto de segurança) — está
acoplado à política do item (motivos WRITER_*) e ao QA; é a origem dos 2 problemas do smoke. Composição V1.7.2/apresentação legada
continuam no código para o histórico.

**Complexidade (caminho V5 da monitoria):** etapas semânticas 22 → 15; chamadas de LLM iguais (3–4, o redator de itens ficou). Os módulos
léxicos continuam no código porque o diagnóstico de indicador (V4) e os artefatos antigos dependem deles — saíram do caminho, não do repositório.

Veredito: **NOT READY** — não REJECTED (no replay a factualidade ficou igual e o defeito ao vivo vem de uma camada não alterada), mas
também não "factual igual ou melhor" comprovado ao vivo.

---

## 9. Fase 4 — redator de itens fora do V5 (2026-09-30)

Commit `bb91dca`. No contrato V5 (monitoria) o redator de itens **não é chamado**:

- **Texto de cada ponto** (detalhes, QA, fallback) = projeção determinística do assessment (regra verificada + falas verificadas + status),
  a mesma do texto do sistema (`monitoringFallbackWording`), com dois defeitos corrigidos: infinitivo coordenado ("orientou … e
  mencionou") e oração cortada na condição ("Você informou que." → formulação conservadora).
- **Um único redator**: composição, prompt `SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V6` (V1–V5 congelados). Mudanças em relação ao V5:
  - sem card;
  - a regra de que o que está em `adjustments` nunca é dito como feito;
  - positivo sem frase pronta.
- **Card** = sistema, derivado do assessment. A lacuna concreta ("faltou …") ou a regra não seguida vem literal da base. O card do
  redator só vale para rascunhos V5 antigos.
- **Nova checagem objetiva** `NARRATIVE_CONTRADICTS_FINDING`:
  - checagem NÃO feita dita como feita ("após confirmar a disponibilidade", "confirmou");
  - proibição violada dita como respeitada ("não prometeu", "evitou prometer").

  Tudo pela própria regra da etapa, nunca por lista de temas; orientação prospectiva não conta.
- **QA:** sai `GENERIC_WORDING` e todos os motivos `WRITER_*` do V5. Continuam os motivos de incerteza real (aplicabilidade, conflito,
  composta, dono, privacidade…).
- **Contrato V4** (histórico e diagnóstico de indicador) inalterado: continua com o redator de itens.

| Replay (mesmas 10 avaliações V5, 10 chamadas só de composição, ≈ US$ 0,0067) | Resultado |
|---|---|
| Classificação × gabarito | 10/10 (chamada 2 = MIXED com força independente) |
| Redator de itens | 0 chamadas |
| Disposição | 10/10 READY — nenhum QA por redação; chamada 3 READY pela evidência "Pronto, verifiquei" (DECLARED_CONDUCT) |
| Narrativa do redator aceita | 8/10 — recusas corretas: chamada 2 (elogio numa frase CONTEXT), chamada 4 (ajuste só no contexto); fallback do sistema factual, sem elogio |
| Falsa força / falso achado | 0 / 0 (chamada 10 sem força pela oferta de pacote) |

**Smoke ao vivo (3 chamadas, Workflow real, `-MW2P4`, 6 chamadas de IA, US$ 0,0112; fase 3: 10 chamadas, US$ 0,0176):**

- **Mista (2):** READY, narrativa do redator aceita e correta (força Vivo em Dia independente, ajuste da garantia de aprovação).
- **Desenvolvimento (4):** READY, factual, sem elogio.
  - O rascunho do redator estava correto, mas foi recusado por `GUARANTEED_EFFECT` ("para garantir a clareza").
  - Entrou o texto do sistema: "faltou avaliar se a funcionalidade… e não foi seguida a orientação “Não prometer desbloqueio imediato”".
- **Positiva (7): BLOQUEADA antes do redator** (`NO_EVIDENCED_PROCESS_CHECKPOINT`, nenhum feedback).
  - Na etapa 1, o especialista juntou em uma só citação duas falas do operador separadas por uma fala do cliente, e a checagem literal
    recusou (`EVIDENCE_NOT_VERIFIED`).
  - A etapa 2 tinha fala válida, mas declarou `dependsOn` da etapa 1 e caiu em cascata (`PREREQUISITE_NOT_MET`): um pré-requisito **não
    verificado** foi tratado como **não cumprido**.
  - Falha fechada (nenhum fato errado), mas o positivo não gerou feedback. Registrado, não corrigido (hard stop).

Feedbacks publicados pelo smoke ocultados por ID (`MONITORING_V2_PHASE4_SMOKE`); Workflows desligados; feed da Larissa com os mesmos 11.

**Complexidade (caminho V5):**

- Etapas semânticas: 15 → 13. Saem S7 (redator de itens) e S8 (validadores do redator de itens + texto de segurança como fallback de
  redação); a checagem de contradição fica dentro de S11.
- Chamadas de LLM por feedback: 3–4 → 2–3 (especialista, reparo opcional, composição).

**Veredito:** simplificado (um redator, uma fonte factual) e sem perda de segurança. **Ainda não pronto:** o smoke positivo não gerou
feedback. A causa é o tratamento de pré-requisito não verificado na camada de verificação, não a remoção do redator.

## 10. Fechamento (2026-09-30)

Commit `d165978`.

**1. Pré-requisito inconclusivo ≠ não cumprido.**
- Pré-requisito declarado (`dependsOn`) NOT_FOLLOWED, ou que caiu por um descumprido, continua derrubando a dependente (`PREREQUISITE_NOT_MET`).
- Pré-requisito inconclusivo (fala não verificada, não observável, ausente ou inaplicável):
  - a dependente MANTÉM status e evidência válida;
  - fica marcada `dependency.state = UNVERIFIED`;
  - não vira conformidade sozinha: bloqueio de autonomia `PREREQUISITE_UNVERIFIED` → QA, com explicação humana;
  - fica fora da analytics: observação NEEDS_REVIEW.
- Incerteza propaga incerteza, nunca falha. Nenhuma camada nova: é a mesma passagem de dependência.

**2. Contrato V5: trechos independentes por turno.**
- Cada item de `transcriptEvidence` (e de `items[].evidence`) é um trecho contínuo de UMA fala de UM interlocutor.
- Falas separadas, inclusive por uma fala do cliente, vão em itens separados.
- A verificação literal não mudou: o trecho costurado continua recusado. O V4 fica byte a byte.

**Replay da chamada 7 (sem modelo):**
- Avaliação real do smoke `-MW2P4` (trecho costurado + `dependsOn`): BLOCKED → **HOLD_FOR_QA**, com a fala válida da etapa dependente preservada.
- Avaliação da fase 1 (trechos separados): READY, 2 pontos fortes.

**Smoke ao vivo único (chamada 7, `-MW2P5`):**
- O especialista entregou 3 trechos independentes, todos verificados.
- 2 pontos fortes READY; narrativa do redator aceita e fiel à chamada.
- 2 chamadas de IA, US$ 0,0045.
- Feedback ocultado por ID (`MONITORING_V2_CLOSING_SMOKE`); Workflows desligados; feed da Larissa com os mesmos 11.

**Monitoring Architecture V2: FECHADA.**
- Especialista V5 → Trusted Assessment → Safety Gate fino → um redator (composição V6) → feedback.
- Card e fallback do sistema derivados do assessment.
- 2–3 chamadas de LLM por feedback; 13 etapas semânticas (antes 22).

## 11. Feedback Experience V2 — última milha (2026-09-30)

Commit `db3fab7`. Especialista, assessment, verificação, observações e política não mudaram.

- **Redator de composição, prompt V7** (V1–V6 congelados):
  - o tom vem da disposição decidida pelo código (POSITIVE / DEVELOPMENT / MIXED);
  - contexto primeiro quando ajuda, sem roteiro, sem elogio para equilibrar, tamanho proporcional, orientação acionável;
  - recebe as falas verificadas de cada ponto para parafrasear;
  - volta a escrever um card curto, preso às refs S/A pela mesma checagem; o card do sistema é a reserva.
- **Ajustes secundários:** o ajuste PRINCIPAL (A1) precisa ser dito como ajuste ou orientação; os demais podem ficar nos detalhes. A mesma regra vale para validar rascunhos antigos.
- **"Entenda este feedback" sem repetir a narrativa:**
  - "O que aconteceu" só sem fala;
  - "siga o que o procedimento orienta" sai de "Como melhorar";
  - "O que manter" = evidências.
- **Nome:** entra como vocativo natural ("Larissa, nesta chamada…").

**Replay** (Trusted Assessments reais das chamadas 1, 2, 4, 7 e 10; só o redator; 15 chamadas em 3 execuções, ≈ US$ 0,012):
- Versão final: 5/5 narrativas e cards do redator aceitos, disposição 5/5.
- Detalhe inventado persistente na chamada 4: "orientou o envio do comprovante" (a fala era "informar o pagamento pelo aplicativo"), em 2 de 3 execuções.

**Smoke ao vivo** (7, 2, 4; `-FX2`; 7 chamadas de IA, US$ 0,0132): 3/3 READY.
- 7 e 4 com narrativa do redator, factuais, com exageros leves ("todos os testes").
- 2 caiu no texto do sistema: reconhecimento rotulado como contexto → `NARRATIVE_UNSUPPORTED_STRENGTH`.
- Ocultados por ID (`FEEDBACK_EXPERIENCE_V2_SMOKE`); o nome exibido foi o preferido do perfil em dev ("Gabi Bender").

**Veredito:** texto claramente mais natural e contextual. Porém o redator ainda acrescenta detalhe não sustentado ao parafrasear ações ("comprovante", "todos os testes", "perfil do cliente"), o mesmo ponto cego do V6, que o gate fino não cobre por desenho. Pelo §46: **REJECTED** (não READY).

### 11.1 Correção de especificidade: a paráfrase pode abstrair, nunca especificar mais (2026-09-30)

Commits `38907e3` e `b37b84d`. Princípio: `writer_claim ⊆ supported_fact`. Nada de palavra literal; nenhuma camada nova.

- **Prompt V8** (V1–V7 congelados): o princípio fica explícito (sem objeto, ação, canal, etapa, resultado, completude, quantidade ou certeza novos). O reconhecimento pode vir numa frase de contexto, com a ref S-n.
- **Checagem objetiva já existente, sobre os fatos do ponto a que a frase se refere** (falas verificadas, contexto declarado, regra):
  - a lista fechada de conteúdo operacional do exemplo de condução passa a valer na narrativa, agora também com comprovante, boleto, nota fiscal, código de barras, PIX e visita. Vale em TODA frase e card: orientação também não traz objeto novo. Tempo continua com a checagem de número;
  - grau/certeza ("todos", "completo", "exaustivo", "com certeza"…) só nas frases que afirmam.
- **Chamada 2:** reconhecimento dentro de frase de contexto é aceito quando ligado a uma força (ref S-n ou o próprio conteúdo da força).
- **Emissão:** o contexto da chamada declarado pelo especialista entra na validação, como na geração.

**Replay** (só o redator; 5 chamadas + 3 repetições da 4 e 3 da 7; 11 chamadas, ≈ US$ 0,0093):
- Todos READY e factuais no texto entregue.
- O "comprovante" apareceu em 2 de 4 rascunhos da chamada 4. Numa delas estava numa frase de orientação e passou, porque a orientação estava isenta; a correção `b37b84d` fechou isso, e a revalidação offline dos mesmos rascunhos pega os dois.
- Chamada 7: 4/4 sem grau novo.
- Chamada 4: só 1/4 com a narrativa do redator (2 por especificidade, 1 pela checagem de efeito existente, "você garantiu…").

**Smoke ao vivo** (chamadas 4 e 7, `-FX3`, 5 chamadas de IA, US$ 0,0091): 2/2 READY, narrativa e card do redator, factuais.
- Nuance na 7: "a integridade dos cabos" para "o cabo está bem encaixado?" — troca de atributo em vocabulário aberto, fora das classes fechadas que o gate cobre.
- Ocultados por ID (`FEEDBACK_EXPERIENCE_V2_SPECIFICITY_SMOKE`).

**Veredito:** FEEDBACK EXPERIENCE V2 — READY, pelos critérios pedidos.

## 12. Feedback Experience V2.1 — fatualidade semântica, não léxica (2026-09-30)

**Problema da abordagem léxica (§11.1).** A correção de especificidade dependia de enumerar vocabulário: 6 objetos novos na lista fechada de conteúdo operacional (comprovante, boleto, nota fiscal, código de barras, PIX, visita), uma regex de 15 termos de grau/certeza e 3 exceções só para a narrativa. Cada paráfrase nova pedia uma palavra nova ("integridade dos cabos" passou), e as regex antigas erravam no sentido oposto: "você garantiu que o desbloqueio seria imediato" (relato fiel da promessa) caía como efeito garantido, e "o sinal não foi restabelecido" (o problema do cliente) caía como falha do colaborador.

**Nova verificação semântica** (`reliable-feedback/domain/narrative-factuality.ts`, `NARRATIVE_FACTUALITY_V1`; adapter `verifyNarrativeFactuality`):
- UMA chamada por rascunho do redator de composição, depois do redator: rota fixa `gemini-3.8-flash`, 60 s, 1 nova tentativa só de transporte, JSON com schema, Use Case FEEDBACK_WRITER com a tag `stage:NARRATIVE_FACTUALITY`.
- Recebe as frases (F-n) e o card, cada um com as refs S/A, e os FATOS dos pontos (conclusão do sistema, ação × declaração, falas verificadas, regra, orientação oficial, contexto declarado). Nunca a transcrição inteira: o Trusted Assessment continua sendo a fonte.
- Pergunta: o significado da frase está contido nos fatos? `SUPPORTED` | `GENERALIZATION` (aceitas) | `UNSUPPORTED_ADDITION` | `CONTRADICTION` | `UNCERTAIN` (recusadas), com o significado acrescentado e o motivo. O prompt ensina o princípio, sem nenhuma palavra dos casos de teste (teste garante).
- **Reparo único dentro da mesma chamada:** para frase recusada, o verificador devolve a mesma frase só retirando o acréscimo (ação só dita vira "informou que…"). A reescrita só vale se toda palavra de conteúdo dela estiver na frase original ou nos fatos daquela frase (contenção genérica, sem lista); senão a frase sai. Sem segunda verificação, sem laço.
- Aplicação (`compositionOutcome`, a mesma na geração e na emissão): frases aceitas ficam, reparadas trocam, recusadas saem; o resto passa pelo vínculo de sempre (ajuste principal coberto etc.). Card recusado → card do sistema. Veredito ausente, com erro ou de outro texto (hash) → nada do redator é entregue. Exigido a partir dos rascunhos V7 (paráfrase livre); V5/V6 históricos continuam com a regra da sua versão.

**Removido do caminho verificado:**
- as 6 entradas novas da lista fechada, a separação de "de volta", `unsupportedOperationalFactsIn`, as exceções da narrativa, `DEGREE_UPGRADE`, `factGroundingOf`, `specificityUpgradesIn` e as duas checagens (frase e card). `suggested-response.ts` voltou byte a byte ao estado anterior ao §11.1 (o exemplo de condução do V4 segue com a sua lista original);
- as checagens léxicas que a semântica decide melhor, num rascunho com veredito: efeito garantido, promessa de resultado, hábito ("costuma"), compreensão não observada, ação declarada escrita como feita, ajuste dito como feito, acerto dito como falha.

**Mantido (determinístico):** vínculo S/A e cobertura do ajuste principal, rede de elogio, forma, número tipado, linguagem de auditoria, placar, lacuna, nome/tratamento/culpa, ref interna/JSON, exemplo da base como fato. O indicador (TMA) e a Rechamada não passam por este caminho.

**Avaliação ao vivo do verificador** (`backend/scripts/dev/eval-narrative-factuality.ts`, casos em `testing/narrative-factuality-cases.ts`):
- Obrigatórios A–H (com A' e C'), 10 casos × 3: 30/30.
- Vocabulário novo, fora de qualquer lista e do prompt (firmware, viabilidade técnica, ressarcimento, código da transação, pós-pago…), 11 casos × 3: 33/33.
- Cobertura do que saiu das regex (efeito, causa, hábito, ajuste dito como feito, promessa relatada, negação sobre o cliente, ação em sistema só declarada), 7 × 3: 21/21 (o S5 teve a fixture corrigida — o cliente não perguntava nada nela e o verificador apontou isso).

**Replay** (mesmos Trusted Assessments; só redator + verificação):
- Rascunhos V8 antigos (os 11 do §11.1): os 2 com "comprovante" são pegos e reparados ("após o informe de pagamento"); nas chamadas 7, "antes de abrir o reparo" (o sistema só tem a declaração "Eu já abri a solicitação") vira "antes de informar a abertura do reparo".
- 13 execuções novas (1, 2, 10 + 5× chamada 4 + 5× chamada 7), código final: 13/13 READY, disposição correta, **13/13 com a narrativa e o card do redator**; 5 frases/cards reparados, nenhuma frase descartada. Antes da remoção das regex redundantes a mesma bateria dava 10/13 (as 3 quedas eram falsos positivos léxicos).
- Custo do replay final: redator US$ 0,0109 + verificador US$ 0,1160 (13 de cada); verificador com mediana de 5,4 s (máx. 21 s).

**Smoke ao vivo** (`-FX4`, chamadas 2, 4 e 7; 10 chamadas de IA, US$ 0,0436 — especialista 3, reparo de cobertura 1, redator 3, verificador 3):
- 3/3 READY e publicados com narrativa e card do redator.
- Reparos: chamada 4 "informar o valor" → "informar o pagamento"; chamada 7 "antes de abrir o reparo" → "antes de informar a abertura do reparo".
- Ocultados por ID (`FEEDBACK_EXPERIENCE_V21_SEMANTIC_SMOKE`); workflows desligados.

**Limites:** o verificador varia em nuances pequenas ("perfil do cliente" × "cliente": recusado numa execução, aceito em outras); custo por feedback de monitoria sobe de ≈ US$ 0,005 para ≈ US$ 0,015 (o verificador é ≈ 2/3 disso, por causa do raciocínio).

**Veredito:** FEEDBACK EXPERIENCE V2.1 — SEMANTIC AND READY.
