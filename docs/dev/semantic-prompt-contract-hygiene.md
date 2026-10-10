# Semantic Prompt Contract Hygiene (V1.4.6.8 → V1.4.6.9)

> **Princípio:** um exemplo num prompt de produção nunca usa um valor que também possa ser um identificador válido de
> execução.

Para `interactionRef`, o exemplo é sempre o placeholder canônico `EXAMPLE_INTERACTION_REF = "<INTERACTION_REF>"`,
definido em `investigation/domain/frame-contract.ts`. Os handles reais só entram pelas regiões dinâmicas: a lista da
Fase A e as entradas renderizadas da Fase B e do sidecar. O teste transversal é
`investigation/domain/prompt-hygiene.test.ts`.

Nota técnica sobre o contrato da **Fase A** da investigação: a extração de `SemanticFrame`, um frame por interação.

## 1. Exemplos nunca usam um ID que pode ser real

O contrato ilustra o formato do JSON com um frame de exemplo, uma `UNIT` de evidência e o cabeçalho
`"=== … ==="`. Até a V1.4.6.7, esses exemplos usavam **`I6`**, um handle que também existe em requests reais.

Os experimentos V1.4.6.5–V1.4.6.7 (`backend/scripts/poc-tools/holdout-v2/dev-regression-v146{5,6,7}-*`) mostraram:

- a saída do Gemini começava em `I6` em 19 de 19 respostas parseáveis;
- a do Qwen batch, em 4 de 4;
- `I6` era duplicado e `I10`, a posição 1, desaparecia;
- com o `I6` de exemplo trocado por um placeholder, o Qwen passou a seguir a ordem real (1 run por braço, indicativo).

**Regra:**

- Os handles de EXEMPLO são o placeholder `EXAMPLE_INTERACTION_REF = "<INTERACTION_REF>"`, definido em
  `investigation/domain/frame-contract.ts`. Ele não casa o formato de handle `/^I\d+$/`, então nunca pode ser uma
  referência válida de execução.
- Os IDs reais chegam **só** pelas listas dinâmicas de `renderFrameExtractionInstructions(handles)`:
  - "As referências válidas nesta análise são SOMENTE: …";
  - "OBRIGATÓRIO: devolva EXATAMENTE N frame(s), um para cada referência (…), nessa ordem".

**Fail-closed:**

- Um frame com o placeholder, ou com qualquer ref fora do conjunto apresentado (`I0`, `I2` inventados), é descartado
  pelo verifier (`frameForUnknownInteraction`).
- Uma evidência que cita o placeholder dentro de um frame real é rejeitada (`WRONG_INTERACTION`).
- Nenhum ref inesperado vira evidência de outra interação.

**Testes:** `frame-contract.test.ts` cobre conjuntos arbitrários de handles e verifica que:

- a parte estática não tem valor com formato de handle;
- cada handle real aparece só nas 2 regiões dinâmicas, na ordem dada;
- o placeholder aparece nos 4 exemplos;
- a renderização é determinística.

`holdout-phase-a-single.test.ts` prova que, no request conhecido (I10…I3), a única diferença entre o prompt antigo e
o novo é `I6` → `<INTERACTION_REF>` nas 4 posições de exemplo.

Reproduções históricas usam `legacyFrameExtractionInstructions`, que fica só no harness e nunca no runtime.

## 2. JSON válido não implica contrato completo

`assessFrameContract(frames, expectedRefs)` mede por código, sem LLM:

| campo | significado |
|---|---|
| `expectedInteractionRefs` / `returnedInteractionRefs` | refs apresentados × devolvidos (com repetição, na ordem) |
| `missingInteractionRefs` (**MISSING_FRAME**) | esperado que não apareceu em nenhum frame |
| `emptyInteractionRefs` (**EMPTY_FRAME**) | esperado cujo 1º frame não declara nenhuma observação |
| `duplicateInteractionRefs`, `duplicateFrameCount`, `duplicateFrameObservationsDropped` | frames excedentes do mesmo ref e o que o descarte "primeiro vence" leva embora |
| `unexpectedInteractionRefs`, `exampleRefEchoed` | refs fora do conjunto, incluindo o eco do placeholder |
| `frameCoveragePercent` | esperados devolvidos ÷ esperados |
| `status` | `COMPLETE` só com cada esperado exatamente 1 vez, sem ausente, duplicado ou inesperado; senão `INCOMPLETE` |

**Decisão:** um frame **vazio** continua estruturalmente presente e não torna o contrato `INCOMPLETE`. Ele é
contado à parte, porque é qualidade de conteúdo e não estrutura. MISSING e EMPTY nunca se misturam na telemetria.

**Onde aparece:**

- `SemanticTelemetry.frameContract = { initial, retryAttempted, afterRetry }`, medido na resposta que parseou, antes
  do retry dirigido, e de novo depois dele;
- a soma por execução em `InvestigationSummary.semantic.frameContract`, só contagens;
- o QA Lab, na linha "Contrato de frames".

## 3. O que NÃO mudou

- O retry dirigido: 1 vez, só para os ausentes.
- O descarte do verifier: ref desconhecido cai fora; se houver duplicado, fica o primeiro.
- O batch size, os tetos de saída e o schema semântico.
- O `responseSchema` por provider, que é uma decisão separada:
  - o Gemini usa `responseMimeType: "application/json"` sem schema;
  - o Ollama usa `json_object` sem schema;
  - "exatamente um frame por ref" continua sendo instrução textual, agora **medida**.

## 4. Varredura V1.4.6.9 — outros contratos de produção

| contrato (arquivo · função) | etapa | antes → depois |
|---|---|---|
| `interaction-semantic-frame.ts` · `renderPatternSynthesisInstructions` | Fase B | `"interactionRef":"I6"`, `findingRefs ["I6/F1","I4/F2"]` → placeholder (3×) |
| `interaction-tools.ts` · `TEMPORAL_ANALYSIS_INSTRUCTIONS` | adendo temporal da Fase B e dos pares | `evidenceRefs ["I4","I9"]` → placeholder (2×) |
| `interaction-tools.ts` · `ANALYSIS_INSTRUCTIONS` | contrato de padrões dos pares (V1.3.x) | `(ex.: I1)` → placeholder (1×) |
| `outcome-attribution.ts` · `renderSidecarInstructions` | sidecar de atribuição | `"interactionRef":"I6"` → placeholder (2×) |

Nenhum desses contratos recebe uma lista de handles no system prompt: os refs reais vêm só da entrada.

Revertendo o placeholder para o valor antigo, cada arquivo volta a ser idêntico ao da V1.4.6.8. A semântica
(findings, patterns, atribuição, pontes, temporal) não mudou, e nenhum harness reproduz esses prompts.

**FUTURE_HYGIENE:** mesmo princípio, fora do escopo desta varredura.

- **Descrições de ferramentas do planejamento:**
  - `tool-catalog.ts` `interactionIds` (`ex.: ["I1","I2"]`);
  - `tool-declarations.ts` (`referências I1, I2…`);
  - a mensagem de `UNKNOWN_HANDLE` em `handle-registry.ts`.
  - Nesses casos o exemplo ensina o formato de um argumento que o modelo precisa preencher com um handle real. Trocar
    por placeholder muda a instrução de chamada de ferramenta, e isso pede uma auditoria própria.
- **Outros espaços de identificador:**
  - `turnRef` `T3`/`T12` nos contratos de extração;
  - `K1`/`K2` na extração de regras da base (`procedural-semantics.ts`);
  - refs do ledger `["F1","F4"]` no contrato de síntese (`evidence-gating.ts`; o flash-lite já copiou esse exemplo uma vez).
