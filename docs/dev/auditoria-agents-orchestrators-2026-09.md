# Auditoria conceitual e técnica — Agents × Orchestrators (2026-09-16)

Auditoria SOMENTE-LEITURA (nenhuma alteração funcional). Evidência: banco `inia` (agents,
assistant_orchestrators, assistant_orchestrator_specialists, agent_knowledge_documents, agent_runs,
qa_runs.trace.aiCalls, assistant_interactions.tool_calls), código do runtime
(`run-orchestrated-reply.ts`, `orchestrator-executor.ts`, `run-agent.ts`, `run-specialist-tool.ts`,
`validate-workflow-for-publish.ts`, `orchestrator-policy.ts`), fixtures dos 22 modelos e catálogo
oficial, formulários de Agent/Orquestrador e páginas da Wiki.

## 1. Resumo executivo

- **Agent** hoje é exatamente "um prompt + fontes autorizadas + contrato de saída, executado numa
  única request". A definição "especialista que recebe contexto, consulta conhecimento autorizado e
  produz uma análise especializada" está **correta** — com um adendo: quando chamado direto pelo
  Workflow o Agent também é a única peça com **contrato verificado por código** (evidência literal,
  `PROCESS_AUDIT`); quando chamado por um Orchestrator, essa verificação **não existe**.
- **Orchestrator** hoje é "um agente-coordenador com function calling de UMA rodada: escolhe 0..N
  especialistas, roda-os em paralelo e faz uma síntese" — OU, no pós-JOIN, "uma única request de
  síntese sem tool nenhum". São dois comportamentos distintos sob o mesmo nome.
- Dos 8 Orchestrators ativos, **só 2 exercem coordenação real observada**: o multidomínio (Modelo
  08 — roteou Faturamento + Retenção e sintetizou) e o do chat/voz (37 respostas com tool, 6
  especialistas distintos escolhidos dinamicamente). O **Gerencial nunca chama especialista** (por
  construção do runtime). Os **4 de domínio e o Transversal não têm nenhum uso** em Workflow,
  QA ou runtime depois da fronteira de domínio — e, pela política, só podem acionar 1 especialista
  de processo (+ Experiência).
- As cinco `policy_kind` misturam quatro dimensões: **fronteira de coordenação** (DOMAIN/
  MULTIDOMAIN), **especialidade do Agent** (TRANSVERSAL), **caso de uso/ponto do grafo**
  (MANAGERIAL = pós-JOIN) e **onde é acionado** (INTERACTIVE = `invocation_mode`).
- Modelo mental mais simples que a implementação já suporta em 90%: *Agent = sabe/analisa um
  assunto ou dimensão; Orchestrator = coordena Agents; KB = conhecimento do Agent; Workflow =
  quando*. O que falta para os 10%: (a) permitir `Chamar agente` depois de `Consolidar resultados`
  (hoje só o node Orquestrador aceita esse contexto — limitação de implementação), (b) reduzir a
  política a `routingPolicy ∈ {DOMAIN, MULTIDOMAIN}` + `invocationMode`, (c) mover "transversal"
  e "gerencial/síntese" para onde pertencem (Agent).

## 2. Definição real de Agent hoje (código)

`agents` = nome, `agent_type` (CALL_FEEDBACK/INDICATOR_FEEDBACK/DIAGNOSTICS/HR/CUSTOM/ORCHESTRATOR),
objetivo, descrição, `context_prompt`, escopo (Grupo/Subgrupo), `specialty` (053), KBs
(`agent_knowledge_documents`), tópicos proibidos. Execução:

- **Via Workflow (`Chamar agente`, `run-agent.ts`)**: 1 request; prompt = sistema > instruções do
  Agent > trechos de KB recuperados (BM25, 8 trechos/9.000 chars) > entrada; saída **estruturada e
  validada por código** (`parseStructuredFeedback`: `evidenceFound` precisa existir literalmente na
  transcrição; `PROCESS_AUDIT` rebaixa CONFORME/NAO_CONFORME sem citação). Resultado vira
  `nodeOutputs.<node>` (`kind: monitoring|indicator`) e só o node Output publica.
- **Via Orchestrator (`run-specialist-tool.ts`)**: 1 request por especialista, mesmo prompt/KB,
  mas saída **texto livre** (sem verificação de evidência) devolvida ao coordenador.
- Um Agent **nunca chama outro Agent** (não há tools no `runSpecialistTool`; `generateWithTools(…,
  [])`). Hierarquia confirmada: Orchestrator → Agent → KB.

## 3. Definição real de Orchestrator hoje (código)

`assistant_orchestrators` = agente-coordenador (Agent do tipo ORCHESTRATOR: só prompt, sem KB),
lista explícita de especialistas (tools), `invocation_mode`, `policy_kind/policy_domains`, escopo,
`output_instructions/output_schema`.

- **Modo roteamento** (`runOrchestratedReply`, usado pelo chat/voz e pelo node Orquestrador em
  contexto EMPLOYEE): request 1 = coordenador com tools → devolve texto (0 especialistas) ou N
  function calls; requests 2..N+1 = especialistas em paralelo (contexto compartilhado + pergunta
  reescrita); request N+2 = síntese do coordenador. **Uma rodada só** — não há re-roteamento.
- **Modo consolidado** (`executeOrchestratorConsolidated`, pós-JOIN): **1 request, sem tools**
  ("`generateWithTools(contents, systemPrompt, [])`"), sobre um texto que descreve os N resultados
  individuais. Não seleciona, não coordena — sintetiza.
- Resultado: `text` + `results[]` (respostas cruas) + `structuredResult` opcional. Ao publicar
  FOLLOW_UP ao operador vira `createOrchestratorFeedback` **sem** checagem verbatim (trade-off
  documentado em `output-executor.ts`).

## 4. Agents ativos (32)

| Grupo | Nome | specialty | KBs | usado por |
|---|---|---|---|---|
| Domínio | Especialista de Faturamento | FATURAMENTO | 3 (Contestação, Segunda Via, Negociação) | Modelo 18a (direto, PROCESS_AUDIT); Orq. Faturamento; Orq. multidomínio |
| Domínio | Especialista de Retenção e Cancelamento | RETENCAO | 1 (Cancelamento) | Modelos 17 (fan-out), 18b (direto); Orq. Retenção; Orq. multidomínio |
| Domínio | Especialista de Suporte Técnico | SUPORTE | 2 (Reparo BL, Troca de chip) | Modelo 18c (direto); Orq. Suporte; Orq. multidomínio |
| Domínio | Especialista de Cadastro e Titularidade | CADASTRO | 2 (Dados do gestor, Titularidade) | nenhum Workflow; Orq. Cadastro; Orq. multidomínio |
| Transversal | Especialista de Experiência do Cliente | CROSS_CUTTING | 2 (Jeito de Atender, Checklist) | Modelos 01, 02 (direto); autorizado em 6 orquestradores |
| Transversal | Especialista de Qualidade de Atendimento | CROSS_CUTTING | 2 (idem) | Modelos 05, 09, 14 (direto); Orq. Qualidade e Experiência |
| Transversal | Especialista de Eficiência Operacional | CROSS_CUTTING | 0 | Modelo 07 (direto); Orq. Qualidade e Experiência |
| Performance | Especialista de Performance Individual | PERFORMANCE | 0 | Modelos 03, 04, 15, 16, 20 + pendência demo |
| Performance | Especialista de PRV | PERFORMANCE | 0 | Modelo 06 |
| Performance | Especialista de Reconhecimento | PERFORMANCE | 0 | Modelos 11, 12 |
| Performance | Especialista de Disponibilidade Operacional | PERFORMANCE | 1 (Política de jornada) | Modelo 10 |
| Coordenador | Coordenação · Faturamento / Retenção / Suporte / Cadastro / Qualidade e Experiência / Atendimento multidomínio / Gerencial (7) | — | 0 | um Orquestrador cada |
| Coordenador legado | Agente Orquestrador da INIA | — | 0 | `ORQUESTRADOR` (chat/voz) + 5 TESTE inativos |
| Legado chat | Agente de Indicadores (73 runs; 20 chamadas no chat), Agente de Feedback de Chamadas (119 runs, **12 KBs**), Agente de Processos (10 KBs; 5 chamadas), AGENTE DE RH (5 KBs; 6), Analista de Evolução de Desempenho (4), Agente de Diagnóstico (1) | — | — | especialistas do `ORQUESTRADOR` |
| TESTE (7) | Feedback de Chamadas (373 runs), Diagnóstico de Atendimento (56 runs), Classificador, Conduta e Risco, Processos e Aderência, Temas de RH, Feedback de Indicadores | — | — | só orquestradores TESTE inativos |

Observações: todos ALL_TEAMS; `agent_runs` = 0 para todos os 11 especialistas oficiais (só rodaram
no QA Lab — os runs persistidos são dos legados/TESTE). `agent_type` é uma terceira taxonomia
(contrato de entrada × assunto "RH") que convive com `specialty`.

## 5. Agents de domínio

Quatro, um por domínio de processo. Cada um "entende O QUE deveria acontecer" e audita contra o
procedimento (prompt: PAPEL/OBJETIVO/FONTES; fora do escopo explicitado). Amplitude: Faturamento
cobre 3 subassuntos com 3 KBs; Suporte 2/2; Cadastro 2/2; Retenção 1/1. Nenhum faz roteamento
interno; a escolha do subassunto é feita **pelo retrieval** (trechos por BM25).

## 6. Agents transversais

Três (CROSS_CUTTING): Experiência (rechamada/detrator — fricção na condução), Qualidade (conduta ×
checklist), Eficiência (TMA/TMT — só números, sem KB). "Entendem COMO o atendimento foi conduzido"
— o prompt de Qualidade diz literalmente que "procedimentos de processo específicos não são sua
régua". Confirmado: **não são super-agents** — competência específica aplicável a qualquer domínio;
2 deles compartilham as mesmas 2 KBs de conduta.

## 7. Knowledge Bases por Agent

16 bases publicadas. Especialistas: Faturamento 3, Suporte 2, Cadastro 2, Retenção 1, Experiência 2,
Qualidade 2, Disponibilidade 1, Eficiência/Performance/PRV/Reconhecimento 0 (só números do
Workflow). Coordenadores 0 (correto: quem consulta KB é o especialista). Legados: Feedback de
Chamadas 12 e Processos 10 — o padrão "um Agent dono de tudo" que a camada nova substituiu.

## 8. Granularidade atual dos Agents

Um Agent por domínio de processo (4) + um por dimensão transversal (3) + um por tipo de análise de
performance (4). É granularidade por **régua de avaliação**, não por procedimento — coerente com os
contratos de saída (`FEEDBACK`/`PROCESS_AUDIT` para chamada; `indicator` para números).

## 9. Faturamento: amplo demais ou adequado?

Cobre 3 subassuntos (contestação, segunda via, negociação de débito). Evidência de retrieval nos
traces: no caso de **contestação** (Modelo 08) 7/8 trechos vieram do documento certo; no caso de
**segunda via** (18a, 1ª execução) só 2/8 vieram de "Segunda Via de Conta" — 5/8 vieram de
"Contestação" e eram seções genéricas ("Encerramento", "Apresentação do operador", "Confirmação de
entendimento"). Ou seja: o retrieval separa o subassunto **quando os termos são distintivos**, mas
as seções boilerplate compartilhadas entre procedimentos vencem no BM25. Diagnóstico: o Agent é
**adequado**; o ponto fraco é a **qualidade do retrieval entre documentos de estrutura parecida**,
não a amplitude do Agent. Decompor em 3 Agents resolveria isso por força bruta (cada um com 1 KB)
ao custo de exigir um roteador antes (um Orchestrator de Faturamento "de verdade") — ver §34/§35.

## 10. Orchestrators ativos (8)

| Nome | policy | modo | especialistas | uso real |
|---|---|---|---|---|
| Orquestrador · Faturamento | DOMAIN[FATURAMENTO] | WORKFLOW | Faturamento, Experiência | 0 Workflows; 1 QA run manual (2026-09-15, **antes** da fronteira: roteou Faturamento + Retenção) |
| Orquestrador · Retenção e Cancelamento | DOMAIN[RETENCAO] | WORKFLOW | Retenção, Experiência | Modelo 17 **pós-JOIN** (modo consolidado — sem tools); 0 traces com IA |
| Orquestrador · Suporte Técnico | DOMAIN[SUPORTE] | WORKFLOW | Suporte, Experiência | nenhum |
| Orquestrador · Cadastro e Titularidade | DOMAIN[CADASTRO] | WORKFLOW | Cadastro, Experiência | nenhum |
| Orquestrador · Qualidade e Experiência | TRANSVERSAL | WORKFLOW | Qualidade, Experiência, Eficiência | nenhum |
| Orquestrador · Atendimento multidomínio | MULTIDOMAIN[4] | WORKFLOW | 4 de domínio + Experiência | Modelo 08; 1 trace real (roteou 2 de 5) |
| Orquestrador · Gerencial (consolidado) | MANAGERIAL | WORKFLOW | nenhum | Modelos 04, 05, 11, 14, 16, 20 (pós-JOIN); 3 traces reais (1 request cada) |
| ORQUESTRADOR (chat/voz) | INTERACTIVE | INTERACTIVE | 5 legados | chat: 76 respostas, 37 com tool (sempre **1** tool), 6 agentes distintos |

## 11. Auditoria individual

**Faturamento / Suporte / Cadastro (DOMAIN)** — A: coordenar "os especialistas do domínio"; B:
ninguém (0 Workflows); C: transcrição + instrução; D: 2 autorizados (1 de processo + Experiência);
E: sem uso pós-fronteira — o único trace (pré-fronteira) chamou 2, sendo um deles de OUTRO domínio
(hoje proibido); F: sim (function calling); G/H/I: 0/1/2 possíveis; J: sim; K: texto livre sem
verificação vs. contrato verificado do Agent; L: Workflow → Especialista do domínio direto (é o que
18a/b/c já fazem); M: perde-se só a possibilidade de anexar Experiência na mesma passada; N:
**ganha** governança (evidência verificada); O: −2 requests, −latência (~13→~4 s por especialista).
**Conclusão: LIKELY_DIRECT_AGENT.**

**Retenção e Cancelamento (DOMAIN)** — igual aos anteriores, com um agravante: seu único uso
(Modelo 17) é pós-JOIN, onde o runtime **ignora os especialistas** (modo consolidado). A política
DOMAIN não influencia nada ali; ele funciona como um "Gerencial de Retenção". **NEEDS_REDESIGN**
(na prática é um Agent de síntese pós-JOIN com prompt de domínio).

**Qualidade e Experiência (TRANSVERSAL)** — A: "combinar conduta × experiência × eficiência"; B:
ninguém; D: 3 transversais; E: sem uso; F/G/H/I: possíveis; J: sim; L: os 3 já são chamados direto
(01, 02, 05, 07, 09, 14) — o Workflow sempre sabe qual dimensão quer; M: perde-se uma análise
"3 em 1" que nenhum modelo pediu; N: ganha; O: −2..−4 requests. **LIKELY_DIRECT_AGENT.**

**Atendimento multidomínio (MULTIDOMAIN)** — A: ligação com mais de um assunto; B: Modelo 08
(gatilho `contestacao`); C: transcrição; D: 5; E: 2 (trace real); F: **sim — escolheu Faturamento
+ Retenção e NÃO Suporte/Cadastro/Experiência**; G/H/I: 0/1/N; J: sim (síntese com "domínios
identificados / não acionados e por quê"); K: sim — resultado combinado que nenhum Agent produz
sozinho; L: um Agent direto perderia o outro domínio ou exigiria 2 nodes fixos + Join; M: sim;
N: perde-se a verificação verbatim (ponto a corrigir no runtime, não no conceito); O: 4 requests,
~25–28k tokens, 33–43 s. **KEEP_ORCHESTRATOR.**

**Gerencial (consolidado) (MANAGERIAL)** — A: síntese executiva de N resultados; B: 6 modelos
pós-JOIN; C: texto estruturado com N resultados; D: 0; E: 0 (por construção); F: não; G: sempre
0; J: é só síntese; K: é um Agent de síntese com outro nome; L: `Chamar agente` pós-JOIN com o
mesmo `describeConsolidatedContext` — comportamento idêntico; M: nenhuma; N: nenhuma (poderia até
ganhar contrato de saída); O: 0 (já é 1 request). **NEEDS_REDESIGN** (é um Agent; a única razão de
ser Orchestrator é `findIndividualOnlyConflict` aceitar só `orchestrator` em CONSOLIDATED_RESULT).

**ORQUESTRADOR chat/voz (INTERACTIVE)** — A: atender o colaborador em qualquer assunto; B: chat e
voz; C: pergunta + contexto do operador; D: 5 legados; E: 0 ou 1 (37 de 76 respostas com tool;
nunca 2); F: **sim** (6 agentes distintos escolhidos pelo assunto); G/H: sim; I: possível, nunca
observado; J: sim; K: sim (resposta conversacional); L: sem coordenador o chat teria que saber o
assunto antes — impossível; M: sim; N: n/a; O: 3 requests por pergunta com tool. **KEEP_ORCHESTRATOR**
— mas a policy `INTERACTIVE` não descreve coordenação, descreve onde é acionado (§16).

## 12. DOMAIN — 4 orquestradores; 3 sem qualquer uso; 1 usado só em modo consolidado. Pela
política só podem escolher entre "o especialista do domínio" e "Experiência": a única decisão
possível é *anexar ou não a análise de experiência*, e nenhum Workflow-modelo precisou dela.

## 13. TRANSVERSAL — 1 orquestrador sem uso. Os 3 Agents transversais são chamados direto em 6
modelos. Não existe caso real de "Qualidade + Experiência + Eficiência coordenados".

## 14. MULTIDOMAIN — 1 orquestrador, o único com roteamento comprovado (2 de 5, com justificativa
na síntese). É a categoria conceitual necessária: "fronteira = vários domínios autorizados".

## 15. MANAGERIAL — 1, usado em 6 modelos, 3 traces reais. Nunca coordena; é síntese. A exigência
"Orchestrator depois de Consolidar resultados" é **limitação de implementação**
(`validate-workflow-for-publish.ts:654` + `node-handlers.ts:439-450`): o executor consolidado monta
um texto e faz 1 request sem tools — um `Chamar agente` receberia o mesmo contexto sem mudança de
runtime além de aceitar o contexto CONSOLIDATED_RESULT e escolher o contrato de saída
(`kind: "consolidated"` ou texto livre). Um Gerencial **seria** Orchestrator de verdade no desenho
"Join → Gerencial → {Performance, Qualidade, PRV, Eficiência} → síntese" — mas isso exige
especialistas multi-operador (hoje todo tool é single-operator; documentado no executor).

## 16. INTERACTIVE — repete `invocation_mode`. O que ela acrescenta de fato: "a lista é a
autorização, sem fronteira de domínio" — que é exatamente MULTIDOMAIN com todos os domínios (ou
"sem fronteira"). O chat multiassunto observado (Indicadores, RH, Processos, Evolução, Diagnóstico)
confirma: **routingPolicy = MULTIDOMAIN (ou OPEN) + invocationMode = INTERACTIVE** representa
melhor o conceito. A restrição "INTERACTIVE ⇒ só chat/voz" (054) é útil e continua válida como
regra de `invocation_mode`, não de policy.

## 17–20. Contagens

- Selecionam dinamicamente (evidência): **2** (multidomínio, chat).
- Já chamaram múltiplos especialistas: **1** pós-fronteira (multidomínio; o Faturamento fez isso
  só antes da fronteira, cruzando domínio).
- Sempre chamam um único: chat (37/37 com tool → 1 tool); os 4 DOMAIN e o TRANSVERSAL: sem
  evidência de uso (0).
- Não chamam nenhum: **Gerencial** (por construção) e **Retenção quando usado pós-JOIN** (Modelo 17).

## 21. Agent direto possível — Faturamento, Suporte, Cadastro, Retenção (modo EMPLOYEE), Qualidade
e Experiência; Gerencial (como Agent de síntese pós-JOIN).
## 22. Orchestrator indispensável — Atendimento multidomínio; chat/voz.

## 23. Os 22 modelos × IA

| Modelo | Caminho |
|---|---|
| 01, 02 | Flag → **Agent** Experiência → Revisão |
| 03 | Agenda → **Agent** Performance → Revisão |
| 04 | Ranking → fan-out → **Agent** Performance → Revisão → Join → **Orq. Gerencial** |
| 05 | Ranking → fan-out → **Agent** Qualidade → Revisão → Join → **Orq. Gerencial** |
| 06 | Agenda → **Agent** PRV → Revisão |
| 07 | Indicador → **Agent** Eficiência |
| 08 | Flag → **Orq. multidomínio** → Revisão |
| 09 | Agenda → **Agent** Qualidade → Revisão |
| 10 | Indicador → **Agent** Disponibilidade |
| 11 | Ranking → fan-out → **Agent** Reconhecimento → Join → **Orq. Gerencial** |
| 12 | Ranking → fan-out → **Agent** Reconhecimento (Output direto) |
| 13, 19 | sem IA |
| 14 | Selecionar ×2 → fan-out → **Agent** Qualidade → Revisão → Join → **Orq. Gerencial** |
| 15 | Selecionar ×2 → fan-out → **Agent** Performance → Revisão → Join → Output (sem IA pós-JOIN) |
| 16 | Selecionar → fan-out → **Agent** Performance → Join → **Orq. Gerencial** |
| 17 | Selecionar → fan-out → **Agent** Retenção → Join → **Orq. Retenção (consolidado)** |
| 18a/b/c | Flag → **Agent** de domínio (PROCESS_AUDIT) → Revisão |
| 20 | Selecionar → fan-out → **Agent** Performance → Revisão → Join → **Orq. Gerencial** |

Justificativa de cada Orchestrator: 08 = roteamento entre domínios (real); 04/05/11/14/16/20 =
síntese pós-JOIN (não há roteamento; é o único node aceito ali); 17 = idem, com prompt de domínio.
**Suspeitos**: 17 (Orquestrador de domínio usado só para sintetizar) e, por extensão, o padrão
"Orchestrator obrigatório pós-JOIN" dos outros 6. Nenhum modelo usa Orchestrator de domínio ou
transversal em contexto individual — o Workflow sempre soube qual especialista queria.

## 24. Modelo 08 — grafo `contestacao → Orquestrador · Atendimento multidomínio → Revisão →
Output/Escalonar`. Trace real (2026-09-16): routing 4.974/969 tokens, 5,6 s → function calls
Faturamento + Retenção → 2 especialistas em paralelo (RETRIEVAL 8 trechos cada, dos documentos
certos) → síntese 8.552/1.870 tokens, 12 s, com seção "domínios identificados / não acionados".
Houve roteamento, seleção, múltiplos especialistas e síntese. Valor real: sim. Custo: 4 requests,
~27k tokens, 33–43 s (vs. 1 request, ~5k, ~4 s de 18a).

## 25. Pós-JOIN — 7 modelos. Em todos o executor é `executeOrchestratorConsolidated`: **síntese
simples** (1 request, sem tools). Orquestração real: nenhuma.

## 26. Gerencial: Orchestrator × Agent — funcionalmente é um Agent de síntese. Mantê-lo como
Orchestrator só se serve como padrão-alvo para o desenho §15 (especialistas multi-operador).

## 27. Transversal: Orchestrator × Agent — "transversal" descreve o **Agent** (Qualidade,
Experiência, Eficiência). O orquestrador transversal não tem caso. Se um dia for preciso "conduta +
experiência" na mesma chamada, o multidomínio (ou um DOMAIN com Experiência) já cobre.

## 28. Interactive × invocationMode — duplicado; ver §16.
## 29. DOMAIN × MULTIDOMAIN — mesma pergunta ("quais domínios pode coordenar?") com cardinalidade
1 ou N. `MULTIDOMAIN` com 1 domínio ≡ `DOMAIN`. Uma única `routingPolicy` com lista de domínios
(1..N) resolve as duas.
## 30. Multidomínio × transversal — eixos diferentes: multidomínio é fronteira do coordenador;
transversal é competência do Agent que atravessa domínios. Não competem.
## 31. Agent → KB — confirmado (SQL por `agent_knowledge_documents`; retrieval por Agent).
## 32. Orchestrator → Agent — confirmado (tools = lista de especialistas; sem KB própria).
## 33. Agent não contém Agent — confirmado (`runSpecialistTool` e `run-agent` sem tools).

## 34. Quando decompor um Agent por subespecialidade — quando (a) os contratos de saída ou as
réguas divergem, (b) o retrieval **comprovadamente** mistura procedimentos (como no caso de segunda
via), (c) o volume de KB estoura o orçamento de 8 trechos, ou (d) a governança exige "só este
procedimento pode citar isso". Não decompor por (e) "um procedimento = um Agent".

## 35. Contestação / Segunda Via — estudo conceitual. Hipótese "Orq. Faturamento → {Contestação,
Segunda Via, Negociação}": só faz sentido se os subassuntos precisarem de **roteamento**. Hoje o
gatilho já discrimina (`contestacao` é uma flag) e o retrieval separa razoavelmente; o problema
observado (boilerplate de outro procedimento entrando) tem correção mais barata no retrieval
(pré-seleção de documento por assunto / dedup de seções genéricas) do que em 3 Agents + 1
coordenador (+3 requests por chamada). Recomendação: **não fragmentar agora**; instrumentar a
precisão do retrieval por documento antes de decidir.

## 36–38. Custo (telemetria real)

| Caminho | Requests | Tokens (in+out) | Latência |
|---|---|---|---|
| Agent direto (03, 07, 18a) | 1 | 1,3k–5,8k | 2,1–3,8 s |
| Orchestrator + 1 Agent | 3 (routing + 1 + síntese) | sem trace com telemetria (só chat, que não grava tokens) — estimativa ~10–14k | ~20 s (est.) |
| Orchestrator + 2 Agents (08, QA Faturamento) | 4 | 21k–44k | 27–43 s |
| Orchestrator consolidado (Gerencial) | 1 | 4k–6k | 8–14 s |

## 39. Complexidade adicional — cada Orchestrator = 1 Agent coordenador + 1 registro + lista de
tools + política; o texto do coordenador é síntese sem verificação; o QA precisa ler 3–4 chamadas
para auditar uma decisão.

## 40. Matriz das dimensões

| Dimensão | Pergunta | Hoje | Onde deveria viver |
|---|---|---|---|
| 1 | O que o Agent sabe? | `agents.specialty` (DOMAIN×4, CROSS_CUTTING, PERFORMANCE) + `agent_type` | Agent |
| 2 | Que domínios o Orchestrator pode coordenar? | `policy_kind` DOMAIN/MULTIDOMAIN + `policy_domains` | Orchestrator (`routingPolicy`) |
| 3 | Onde é acionado? | `invocation_mode` **e** `policy_kind = INTERACTIVE` | `invocation_mode` |
| 4 | Caso de uso / ponto do grafo | `policy_kind = MANAGERIAL` (pós-JOIN), TRANSVERSAL | Node do Workflow + specialty do Agent |

## 41. Problemas da taxonomia atual — (1) cinco valores, quatro perguntas; (2) TRANSVERSAL como
policy proíbe o especialista de domínio sem que exista caso de uso; (3) MANAGERIAL codifica um
ponto do grafo; (4) INTERACTIVE codifica `invocation_mode`; (5) `agent_type` (contrato) ×
`specialty` (assunto) não são ortogonais (HR é assunto, CALL_FEEDBACK é contrato); (6) a
verificação de evidência existe só no caminho Agent direto; (7) pós-JOIN só aceita Orchestrator.

## 42–49. Taxonomia futura recomendada (não implementar agora)

- **Agent**: `specialty ∈ {DOMAIN(domain), CROSS_CUTTING(capability), PERFORMANCE(kind),
  SYNTHESIS}` + `agent_type` reduzido a **contrato de entrada/saída** (chamada, indicador,
  consolidado, conversa). "Coordenador" deixa de ser tipo de Agent e passa a ser um campo do
  Orchestrator (prompt de coordenação).
- **Orchestrator**: `routingPolicy = { domains: ProcessDomain[] (1..N) | OPEN }` +
  `invocationMode ∈ {WORKFLOW, INTERACTIVE, BOTH}` + lista explícita de especialistas (autorização).
  Regra de código: especialista de domínio precisa estar em `domains`; transversal só se listado;
  performance só se `OPEN` (chat).
- **TRANSVERSAL** → some como policy; fica só como `specialty` do Agent.
- **MANAGERIAL** → vira Agent com `specialty = SYNTHESIS` chamado por `Chamar agente` pós-JOIN
  (runtime aceita CONSOLIDATED_RESULT para `Chamar agente`). Orchestrator pós-JOIN volta a existir
  só quando houver especialistas multi-operador.
- **INTERACTIVE** → só `invocationMode`; o chat vira `routingPolicy = OPEN` (ou lista de domínios).
- **DOMAIN** permanece como `domains.length === 1`; **MULTIDOMAIN** como `domains.length > 1`.

## 50–52. Orchestrators: permanecem — Atendimento multidomínio, chat/voz. Candidatos a Agent
direto — Faturamento, Suporte, Cadastro, Qualidade e Experiência (sem uso; o Workflow chama o
especialista). Redesign — Retenção (é síntese pós-JOIN no Modelo 17) e Gerencial (é Agent de
síntese).

## 53. Runtime futuro — (a) `findIndividualOnlyConflict`/`node-handlers` aceitarem `CALL_AGENT`
em CONSOLIDATED_RESULT com `describeConsolidatedContext`; (b) contrato de saída "consolidated" no
`run-agent`; (c) verificação de evidência também para os `results[]` dos especialistas acionados
por Orchestrator (`runSpecialistTool` → `parseStructuredFeedback`); (d) opcional: pré-seleção de
documento no retrieval.
## 54. Schema futuro — `assistant_orchestrators.policy_kind` → `routing_policy` (`OPEN` | lista de
domínios), remoção de TRANSVERSAL/MANAGERIAL/INTERACTIVE; `agents.specialty` ganha `SYNTHESIS`;
`agent_type` reduzido a contrato. Migração com backfill determinístico (INTERACTIVE→OPEN;
DOMAIN/MULTIDOMAIN→domains; MANAGERIAL→Agent de síntese; TRANSVERSAL→domains=[] + só transversais).
## 55. UI futura — Orquestrador: "Como coordena?" (○ um domínio ○ vários ○ qualquer assunto —
mostra domínios quando aplicável) separado de "Onde é acionado?"; especialistas incompatíveis
desabilitados como hoje. Agent: "Tipo de especialidade" (○ de domínio → escolhe o domínio ○
transversal → escolhe a capacidade ○ performance ○ síntese). Node `Chamar agente` pós-JOIN aceita
Agents de síntese.
## 56. Wiki futura — Orchestrators: "quatro papéis" vira "duas perguntas" (coordena o quê / onde);
Gerencial sai da lista de orquestradores e entra em Agents (síntese pós-JOIN); trechos de
implementação ("executeOrchestratorConsolidated", "só o node Orquestrador aceita…") saem das
páginas de escolha e ficam em Limitações; Agents: "transversal" explicado como competência, com a
tabela O QUE × COMO.
## 57. Risco de migração — baixo no dado (7 orquestradores oficiais, mapeamento determinístico);
médio no runtime (pós-JOIN em 7 modelos: precisa do node `Chamar agente` consolidado antes de
desativar o Gerencial); a fronteira de domínio continua aplicada pela mesma função.
## 58. Compatibilidade com os 22 Workflows — 08 intacto; 04/05/11/14/16/20/17 trocam o node
Orquestrador por `Chamar agente` (síntese) **depois** de (53a); 18a/b/c e os demais não mudam.
## 59. Chat/voz — intacto: `resolveOrchestratorForSubject` continua por escopo + `invocation_mode`.
## 60. Ordem — (1) runtime: `Chamar agente` pós-JOIN + contrato consolidado + verificação verbatim
nos especialistas; (2) Agent de síntese gerencial (mesmo prompt) e troca nos 7 modelos com dry-run;
(3) `routing_policy` + backfill + UI de duas perguntas; (4) desativar orquestradores sem uso
(Faturamento/Suporte/Cadastro/Qualidade) ou mantê-los como modelos "prontos" desativados; (5) Wiki.

## Regra final — a implementação já suporta o modelo mental "sei o especialista → Agent; preciso
escolher/coordenar/sintetizar → Orchestrator" em todos os casos **exceto** o pós-JOIN, onde o
runtime obriga um Orchestrator para fazer o que é trabalho de Agent. Corrigido isso, sobram
exatamente dois orquestradores com razão de existir, e a política se reduz a "quais domínios" +
"onde".
