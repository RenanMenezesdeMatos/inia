# Investigação V1.4.x — fechamento formal (2026-09-23)

Encerra a linha de investigação sobre **omissão de comunicação** feita no H1 DEV do DIAGNOSTIC_HOLDOUT_V2 (V1.4.8 → V1.4.8g).

Este documento é só de registro:
- 0 chamadas de modelo;
- H2 selada, nunca lida nem executada;
- nenhuma mudança funcional;
- nenhuma investigação nova iniciada aqui.

Artefatos em `backend/scripts/poc-tools/holdout-v2/dev-regression-v148*` e commits citados abaixo.

## 1. Status final por componente

| componente | status | onde vive | evidência |
|---|---|---|---|
| **Fase A** (extração de frames semânticos) | **IMPLEMENTED** (runtime, caminho padrão). A representação de pedido informacional como QUESTION ficou **BLOCKED_BY_EVIDENCE** (Gate 1 = STOP); a variante de prompt não foi adotada. | `src/modules/investigation/domain/interaction-semantic-frame.ts` | Gate 1 V1.4.8b: freeze `e17a0ac`, RAW `72064a6`, avaliação `2aa13a1` (STOP, G1-1 0/3). O pedido informacional vira CUSTOMER_NEED (0/504 co-localizado com QUESTION, V1.4.8c `73d3f03`). Instruções byte-idênticas desde então (hash testado). |
| **SemanticRoleEvidence** (papéis conservadores) | **EXPERIMENTAL** | só em scripts: `holdout-v148d-semantic-roles-lib.ts` (`SEMANTIC_ROLE_EVIDENCE_V0_1…`) | V1.4.8d `f35dc41`. Não deriva intenção nem conclusão de ato dos campos atuais; 0 ausências falsas no contrafactual. A intenção da necessidade vem só da anotação needKind (`1242ef4`). |
| **needKind** (sidecar `SIDECAR_NEED_KIND_V1`) | **IMPLEMENTED + VALIDATED** (feasibility) · ativação **DEFERRED** | `src/modules/investigation/domain/need-kind-sidecar.ts`, fiação em `interaction-tools.ts` | G-NK1: prompt `819e7e6`, rótulos `7765d94`, RAW `741d140`, avaliação `784fe37` = **GO** (18/18 chamadas, 0 erro crítico, 0 malformado, 24/24 estáveis). Implementação `1242ef4` reproduz o gate byte a byte. **Nenhum consumidor de runtime**; flag OFF. |
| **DECLARED_COMPLETION** | **EXPERIMENTAL — PROTOTYPE_ONLY** | só em scripts (`DECLARED_COMPLETION_DERIVATION_STATUS`) | V1.4.8e `9931c2f` / `819e7e6`. A derivação por `actionKind` é ampla demais e não é candidata a runtime. A classificação semântica explícita da fala do colaborador fica **DEFERRED**. |
| **NeedCommunicationBoundary** (declaração RELEVANTE à necessidade) | **BLOCKED_BY_EVIDENCE** (`INSUFFICIENT_DEV_EVIDENCE`) | só relatório | V1.4.8g `3837796`: 9 pares positivos independentes, de 2 pessoas. A relevância no H1 parece artefato de composição do gerador. |
| **Omissão end-to-end** | **DEFERRED** | — | Depende de intenção (needKind: validado), boundary relevante (bloqueada) e política de MIXED (inexistente). Nenhum finding ou claim de omissão existe no runtime. |

**Classificação consolidada:**

| status | componentes |
|---|---|
| IMPLEMENTED | Fase A; needKind (atrás de flag) |
| VALIDATED | needKind (feasibility G-NK1) |
| EXPERIMENTAL | SemanticRoleEvidence; DECLARED_COMPLETION (PROTOTYPE_ONLY) |
| BLOCKED_BY_EVIDENCE | NeedCommunicationBoundary; representação QUESTION de pedido informacional (Gate 1) |
| DEFERRED | ativação do needKind; classificação explícita de DECLARED_COMPLETION; omissão end-to-end |

## 2. Flags e runtime

- `INIA_NEED_KIND_SIDECAR`: `z.enum(["OFF","ON"]).default("OFF")` (`backend/src/config/env.ts`). Nenhum `.env` do repositório a define, então vale **OFF**.
  - Com OFF, a análise faz exatamente as chamadas anteriores (teste de fiação).
  - Manter OFF até existir consumidor de produção.
- Nenhum módulo do runtime lê `needKind` além do próprio sidecar, do tipo e da fiação (teste estrutural em `need-kind-sidecar.test.ts`).
  - needKind não gera finding, pattern nem claim.
- Fase A, Fase B e sidecar de atribuição: instruções com hash fixado em teste, sem mudança nesta linha.

## 3. Dívidas conhecidas (nenhuma corrigida aqui)

| dívida | descrição | evidência |
|---|---|---|
| **Política de MIXED** | O protótipo de papéis trata MIXED como informacional para ausência. É regra do assistente, nunca validada. | G-NK1: MIXED reconhecido em 1 de 5 itens humanos (os demais viraram ACTION ou INFORMATION). |
| **Routing dedicado** | O estágio `stage:NEED_KIND` usa o Use Case e a policy `OUTCOME_ATTRIBUTION`. O custo aparece separado na telemetria, mas o roteamento não é independente. | `ai-use-cases.ts`. Separar antes de GA. |
| **Robustez de JSON** | Saída malformada sem `responseSchema`: objeto válido + fechamentos extras, vírgula faltando, caractere de controle. Sem parser leniente. | Gate 1: 4/30 (2 por braço). Histórico da Fase A: 10/86. G-NK1 (saída pequena): 0/18. `responseSchema` é decisão separada. |
| **Projeção / truncamento** | `projectTranscript` pula turnos que não cabem no orçamento **no meio** e renumera de forma contígua (lacuna invisível). `truncatedTurns` não é persistido em telemetria, trace, frame nem ledger. | V1.4.8a.1 (`dev-regression-v148a1-need-resolution/REPORT.md` §4). No Gate 1, as 5 interações escolhidas tinham 0 truncamento. |
| **Corpus naturalístico** | O H1 é sintético e composto por repertórios. Não sustenta relevância declaração ↔ necessidade nem diversidade de pessoas. | V1.4.8g. Pré-requisito para qualquer gate de boundary. |

Outras lacunas já registradas, que continuam abertas:
- ligação necessidade ↔ boundary (ordem temporal não basta);
- semântica do ato: PROMISED × DECLARED_EXECUTED × EXECUTED, onde EXECUTED exige evento ou log externo;
- COMMITMENT com evidência única para promessa e cumprimento;
- AGENT_ACTION que mistura atos de fala e de sistema;
- `isCustomerSide` ignorando `askedBy` (TELEMETRY_ONLY, V1.4.8c.1).

## 4. Fronteira recomendada para a V1.5

**Pertence à V1.5** (confiabilidade e pré-requisitos, sem novo claim de omissão):
1. **Robustez de JSON:** decidir `responseSchema` ou equivalente por experimento controlado, medindo a taxa de malformados contra a base (~12% na Fase A). Não usar parser leniente.
2. **Projeção:** persistir `truncatedTurns` e tornar a lacuna explícita, sem renumeração invisível. É mudança de contrato da projeção, com teste de compatibilidade.
3. **Routing dedicado para needKind:** Use Case próprio, só se e quando houver consumidor. Pré-requisito de qualquer ativação.
4. **Plano de corpus naturalístico:** governança, consentimento, privacidade e anotação humana. Só planejamento e aquisição; nenhum gate sobre ele na V1.5 sem um desenho aprovado.

**Fica fora da V1.5:**
- omissão end-to-end (finding, claim ou feedback de omissão);
- DECLARED_COMPLETION em runtime;
- gate de NeedCommunicationBoundary;
- ativar needKind em produção;
- política de MIXED, que depende de dados reais;
- semântica do ato / EXECUTED;
- novos benchmarks sintéticos ou alterações do H1;
- qualquer uso da H2. Ela continua selada para a avaliação final de generalização de um candidato de runtime, que hoje não existe.

## 5. Rastreabilidade (commits)

| passo | commits |
|---|---|
| Gate 1 V1.4.8b | `e17a0ac` · `72064a6` · `2aa13a1` |
| V1.4.8c (fronteira de papel) | `73d3f03` |
| V1.4.8c.1 / V1.4.8d (atribuição de QUESTION; papéis conservadores) | `f35dc41` |
| V1.4.8e (DECLARED_COMPLETION; pacote G-NK1; correção PROTOTYPE_ONLY) | `9931c2f` · `819e7e6` |
| G-NK1 (rótulos, RAW, avaliação) | `7765d94` · `741d140` · `784fe37` |
| needKind (implementação atrás de flag) | `1242ef4` |
| V1.4.8g (boundary: STOP) | `3837796` |
