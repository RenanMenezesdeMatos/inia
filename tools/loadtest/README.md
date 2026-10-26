# Teste de carga da INIA

Roteiro para medir a INIA com centenas de pessoas ao mesmo tempo, **sem gastar IA**: o servidor roda em modo produção contra
uma cópia do banco de desenvolvimento, e as chamadas de IA são respondidas na própria máquina com a latência real.

## O que é simulado

| Perfil | Comportamento (registrado num navegador real em 14/10/2026) |
| --- | --- |
| Operador | login → tela inicial (SSR, JS/CSS, modelo 3D, imagem de cenário e foto — uma vez por navegador) → 9 chamadas da tela → polling (caixa da INIA a cada 30 s; sino e convite a cada 60 s) → mensagens ao chat da INIA (média `LT_CHAT_MEAN_S`) |
| Supervisor | login → `/supervisor` + 6 chamadas → polling → a cada ~2 min uma aba (Equipe, Indicadores, Calendário ou próxima página do Acompanhamento) |
| Administrador | Resultados do Workflow de monitoria (30 s), Conversas com a INIA (20 s), visão geral da Central de Dados (30 s) e a ingestão de chamadas que disparam monitoria (`LT_INGEST_PER_MIN` + rajada `LT_BURST`) |

A IA falsa (`fake-ai.mjs`, carregada com `--import`) troca só a resposta do provedor: gateway, limitador de vagas, registro de
uso e custo rodam como em produção. Latências (lognormal, banco de dev, 30 dias até 14/10/2026): análise do motor mediana 26 s /
p95 97 s; redação 2,5 s / 34,5 s; resposta estruturada do chat 8 s / 14 s; texto 4,1 s / 5,6 s. A chave de IA da pilha é falsa:
se algo escapar, o provedor recusa — nada é cobrado.

## Como rodar

```bash
# 1. Banco do teste (cópia do dev; não toca no dev)
pg_dump -Fd -j 4 -d inia -f /tmp/inia-dump && dropdb --if-exists inia_loadtest && createdb inia_loadtest && pg_restore -j 6 -d inia_loadtest /tmp/inia-dump
# A conta administradora usada pelo teste precisa entrar com a senha demo (só no clone):
psql -d inia_loadtest -c "update user_accounts set password_hash = (select password_hash from user_accounts where email = 'operador0001.demo@inia.local') where email = 'carla.nunes@inia.com'"

# 2. Builds de produção
(cd backend && npm run build)
(cd frontend && NEXT_PUBLIC_INIA_API_URL=http://127.0.0.1:3433 npx next build --webpack)

# 3. Pilha (API 3433, worker 3434, interface 3110) e o teste
tools/loadtest/start-stack.sh
LT_OPERATORS=570 LT_SUPERVISORS=30 LT_RAMP_S=180 LT_STEADY_S=600 LT_BURST=200 LT_LABEL=600u node tools/loadtest/run-load.mjs
tools/loadtest/stop-stack.sh
```

Duas APIs (como a web farm do IIS): `LT_API_INSTANCES=2 tools/loadtest/start-stack.sh` e `LT_API_PORTS=3433,3435` no teste
(os usuários virtuais alternam as instâncias). Outras opções no topo de `run-load.mjs` e `start-stack.sh`.

Resultado em `tools/loadtest/out/result-<rótulo>-<data>.json` (latência por rota e fase, CPU/memória por processo a cada 5 s,
event loop e pool da API, progresso do processamento) e o resumo no terminal.

## Cuidados

- Feche testes e servidores de outras sessões e confira `memory_pressure` antes: em 08/10 a máquina em swap distorceu a medição.
- O gerador de carga roda na mesma máquina e disputa CPU com o servidor — os números são de uma máquina só, não do servidor
  Windows da instalação.
- A ingestão grava interações e monitorias no `inia_loadtest`; recrie o clone para repetir a partir do mesmo estado.

## Chat: latência por turno e prioridade durante disparos em massa (21/10/2026)

Mede o que a pessoa vê no chat de texto — **tempo até o primeiro texto da resposta** (evento `chunk` não vazio; o progresso
`status` não conta) e o total — em duas situações, sempre num banco de medição (cópia do dev, nunca o `inia`):

```bash
# Banco da medição (cópia do dev) e a senha demo para a administradora (só na cópia)
pg_dump -Fd -j 4 -d inia -f /tmp/inia-dump && dropdb --if-exists inia_chatbench && createdb inia_chatbench && pg_restore -j 6 -d inia_chatbench /tmp/inia-dump
psql -d inia_chatbench -c "update user_accounts set password_hash = (select password_hash from user_accounts where email = 'operador0001.demo@inia.local') where email = 'carla.nunes@inia.com'"
(cd backend && npm run build)

# 1) Turnos um de cada vez com a IA REAL (só a API, sem worker — nenhum Workflow gasta IA): as mesmas perguntas em cada versão
LT_CODE=$PWD/backend LT_PORT=3452 LT_AI=real tools/loadtest/start-bench.sh real
LT_API=http://127.0.0.1:3452 LT_LABEL=real node tools/loadtest/chat-turns.mjs
tools/loadtest/stop-bench.sh real

# 2) Matriz: sem disparos × volume esperado × sobrecarga, versão ANTES × DEPOIS, IA falsa com a cota do provedor COMPARTILHADA
#    entre API e worker (fake-quota.mjs: tokens/min e chamadas/min numa janela de 60 s → 429 com RetryInfo, como o Gemini)
LT_BEFORE=<backend compilado antes> LT_AFTER=$PWD/backend LT_OPERATORS=10 LT_CHAT_MEAN_S=40 tools/loadtest/chat-priority-matrix.sh
```

- `chat-client.mjs`: login + pergunta pelo SSE, só tempos e nomes de evento (nenhum conteúdo nos resultados).
- `fake-ai.mjs` responde como o modelo: com ferramentas e a pergunta por último, aciona um especialista; com as respostas das
  ferramentas, escreve; o planejador do esclarecimento devolve NOT_APPLICABLE (o caso comum). Latências do banco de dev (30 dias
  até 21/10): roteamento 4,6/13,2 s, esclarecimento 7,1/19,1 s, especialista 13,3/28,4 s, síntese 9,4/15,1 s (p50/p95). Em fluxo,
  o 1º pedaço chega em `LT_STREAM_FIRST_RATIO` da duração (0,8 medido ao vivo em 21/10: o raciocínio do modelo vem antes).
- Cada turno do servidor também registra `chat_turn_timing` no log (etapas, chamadas ao modelo com fila e 1º pedaço, ferramentas)
  e soma em `/internal/metrics` → `chat` (p50/p95/p99 por caminho).

### Esclarecimento pelas bases que responde (22/10/2026)

Perguntas de procedimento que as bases de teste respondem (mesmas em cada versão) e o resumo por turno — rodadas do planejador
(`clarificationCalls` no `chat_turn_timing`: `PLANNER READ +1B +4K > PLANNER ANSWER > ANSWER OK`), a redação e, em fluxo, quando
chegou o 1º pedaço dela:

```bash
LT_QUESTIONS="Como faço para registrar a contestação da fatura de um cliente?|Qual é o prazo para responder uma reclamação de cobrança indevida?|Quais são os passos para um reparo técnico na casa do cliente?|Como faço a mudança de endereço da banda larga mantendo a mesma tecnologia?|Como fazer a troca de titularidade de PJ para PJ por falecimento do empresário individual?" \
  LT_API=http://127.0.0.1:3462 LT_LABEL=esc LT_REPEAT=2 node tools/loadtest/chat-turns.mjs
node tools/loadtest/turn-timing.mjs tools/loadtest/out/bench-<rótulo>-api.log
```

Tokens e duração de cada chamada ficam em `ai_usage_events` do banco de medição (`use_case = 'KNOWLEDGE_CLARIFICATION'`; entrada
< 5 mil tokens = redação, o resto = planejador). A variação do planejador entre rodadas (raciocínio de 200 a 6.400 tokens por
chamada) é maior que a maioria dos ganhos: compare dentro da mesma rodada (1º texto × total do turno) antes de comparar rodadas.

Variante por etapa do raciocínio do esclarecimento (padrão: só a redação com raciocínio menor): defina antes de subir a API, ex.
`INIA_CLARIFICATION_LOW_REASONING=PLANNER,ANSWER LT_CODE=$PWD/backend LT_PORT=3462 LT_AI=real tools/loadtest/start-bench.sh rapido`
(`off` = raciocínio padrão nas duas). Compare decisão e seções citadas por pergunta em `assistant_interactions.tool_calls`
(`knowledge_clarification` → `state.status`, `state.sources`), não só o tempo.
