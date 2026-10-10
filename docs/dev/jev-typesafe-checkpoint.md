# FUTURE — JEV / TYPESAFE (checkpoint, 2026-09-22)

Registro de intenção. **Não há nada implementado e não há dependência de runtime**: nenhum módulo, Tool, prompt,
gateway, teste ou script da INIA referencia JEV/TypeSafe, e a ausência dele não muda nenhum comportamento.

**Estado hoje:** indisponível para novas inscrições. Por isso nenhum provider é implementado agora — escrever um
adapter para um serviço ao qual não se tem acesso só criaria código morto e uma dependência que a arquitetura hoje
não precisa.

**Por que o checkpoint existe.** A V1.4.6.1 mediu que a variância da camada semântica vem do MODELO
(mesmo request congelado → 0 a 70 observações em 20 repetições; ver
`backend/scripts/poc-tools/holdout-v2/dev-regression-v1461/REPORT.md`). Onde a INIA precisa de julgamento semântico
ela hoje usa um LLM generativo com validação determinística por cima (verifier literal, matriz procedimental, ponte de
atribuição, escopo de suporte). Um julgador tipado/verificável seria uma alternativa a AVALIAR — nunca a adotar sem
medição.

**POCs possíveis no futuro**, todos em pontos onde hoje existe um julgamento do modelo já cercado por regra determinística:

| Ponto | O que um julgador tipado poderia decidir | O que HOJE decide |
|---|---|---|
| Completude pergunta × resposta | se a resposta cobre o que a pergunta pede | o modelo declara `completeness` (V1.4.0); a V1.4.5 tentou derivar por componentes e custou observações |
| Atribuição de necessidade | de quê o resultado dependeu | sidecar declara + `resolveAgentBridge` exige ponte verificável (V1.4.6) |
| Classificação de finding | força / atrito / risco / resultado | kind declarado + regra de atribuição e ownership (V1.4.1/V1.4.6) |
| Materialidade | qual candidato vira afirmação | o modelo escolhe entre os `CC-n` projetados (V1.4.4) |
| Julgamento procedimental | afirmação × regra da base | `procedural-semantics.ts`, determinístico (V1.4.5) |

**Regras para quando/se isso for avaliado:** não substituir nenhuma regra determinística por julgamento de modelo; um
julgador entra como CANDIDATO medido contra o mesmo holdout, em pasta nova, com o mesmo protocolo de bateria única; e
nada disso toca a H2, que continua selada.
