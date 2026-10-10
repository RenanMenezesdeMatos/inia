# Ground truth de lotes de demonstração — uso EXCLUSIVO de QA/benchmark

Cada pasta aqui é o gabarito de um lote importado pela massa demo (`backend/seeds/demo/…`):
padrões plantados por persona, casos-controle, métricas esperadas e evidências por segmento.

**Nunca** entra em `backend/src`, no seed, em bases de conhecimento, prompts, memória, contexto de
Agent/Orquestrador/Workflow, notas, feedbacks ou metadados de pessoas. A IA não pode saber de antemão
qual padrão foi plantado para quem, nem quais chamadas são controle — o objetivo é descobrir se ela
encontra (ou, corretamente, NÃO encontra) padrões sozinha. Provas: `ground-truth-isolation.test.ts`
e `diagnostic-calls-proof.test.ts` em `backend/src/infrastructure/database/demo-mass/`.

| Lote | Dados importados | Gabarito |
| --- | --- | --- |
| `inia_demo_90_v1` (30 × Mariana Alves, Rafael Cardoso, Camila Fonseca — junho/2026) | `seeds/demo/diagnostic-calls/inia_demo_90_v1.jsonl` | `inia_demo_90_v1/` (`GROUND_TRUTH.md`, `ground_truth_chamadas.jsonl`, `metricas_esperadas.json`, `validacao.json`, `manifest_sha256.json`) |

Forma esperada de um benchmark futuro (fora do model context): persona → `expectedPatterns`,
`negativeControls` (ids dos controles), `expectedNonConclusions` ("comportamento universal",
"causalidade sem cobertura"). Avaliar às cegas, congelar a resposta da INIA e só então abrir o gabarito.
