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
