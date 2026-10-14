# AI Providers, Modelos, Roteamento e Custos — guia de desenvolvimento

Arquitetura e decisões: `docs/architecture/ADR-008-ai-providers-routing-e-custos.md`. Wiki (produto):
`/wiki/administracao/ia-modelos`. Tela: `Administração › IA / Modelos` (`/admin/ai`).

## Onde está cada peça

| Camada | Arquivos |
|---|---|
| Contrato do roteador (shared) | `backend/src/shared/application/model-routing/` — `llm-gateway.ts` (ponto único; policy → legado), `ai-runtime.ts` (porta + contexto de organização), `ai-use-cases.ts`, `ai-errors.ts` |
| Domínio | `backend/src/modules/ai-management/domain/` — `ai-provider-catalog.ts`, `ai-capabilities.ts`, `ai-routing-policy.ts` (plano PINNED/FALLBACK_CHAIN/AUTO, validação), `ai-pricing.ts`, `decimal.ts`, `ai-budget.ts`, `ai-health.ts`, `ai-permissions.ts` |
| Aplicação | `application/ai-runtime-service.ts` (implementação da porta), `ai-runtime-store.ts` (consultas do runtime), `ai-connection-service.ts`, `ai-model-service.ts`, `ai-policy-service.ts`, `ai-budget-service.ts`, `ai-budget-alerts.ts`, `ai-usage-service.ts`, `ai-secrets.ts` (reusa a AES-GCM da Central de Dados) |
| Adapters | `infrastructure/adapters/` — `google-genai-adapter.ts`, `openai-chat-adapter.ts` (OpenAI, xAI, LM Studio, Ollama, compatível), `anthropic-messages-adapter.ts`, `http.ts` (timeout, categorização, redação), `adapter-registry.ts` |
| HTTP | `presentation/ai-management-router.ts` → `/api/v1/admin/ai` (montado em `main/app.ts`) |
| Migration | `backend/migrations/076_ai_providers.sql` |

## Como o gateway decide

1. `generateForRoute` deriva o Use Case do `RoutePurpose` (+ tag `stage:*` da análise semântica).
2. Se há runtime registrado **e** organização no contexto (`requireAuth` ou motor de Workflow): policy ACTIVE → executa por ela.
3. Sem policy: `assertLegacyCallAllowed` (hard limit) → caminho legado de sempre → evento de uso `LEGACY`. O custo do
   evento legado vem da **tabela de preços da organização** quando o MESMO modelo (provider + id, ex.: `GOOGLE_GENAI` +
   `gemini-3.8-flash`) está cadastrado com preço vigente naquele instante (`pricing_source = TABLE`); o mesmo id em
   duas conexões = ambíguo → sem preço; sem cadastro → `INIA_MODEL_PRICING` (ambiente) → senão UNKNOWN. Só
   contabilidade: a rota continua a do ambiente.
   - Propósito sem mapeamento para Use Case vira `UNCLASSIFIED` (interno, nunca roteável): o uso é registrado e o
     orçamento global vale — nenhuma chamada sai sem evento.
4. Sem runtime registrado (testes, `scripts/poc-tools/*`): exatamente o comportamento anterior — nenhum evento de uso.

O runtime só é registrado em `main/server.ts` (`createApp(pool, { registerAiRuntime: true })`). Testes que criam o app
com `createApp(db)` ficam no legado.

## Capacidade: limitador de chamadas (2026-10-08, migrations 121/122)

Antes, cada chamada saía direto para o provedor: um lote de monitorias ocupava a cota e o 429 derrubava o chat na hora.
Agora toda chamada do gateway (`generateForRoute`, `createChatStreamer`, `createVoiceSessionStarter`,
`createSpeechSynthesizer`) passa por UM limitador por processo — `model-routing/ai-call-limiter.ts` — antes da policy/legado:

- **Classe** (`classifyAiCall`, determinística, pelo Use Case + contexto assíncrono — nunca pelo modelo): `CHAT`,
  `VOICE_REALTIME`, `SPEECH_SYNTHESIS`, `MODEL_TEST` são INTERATIVAS sempre; dentro de um nó de Workflow (motor,
  `runWithAiWorkflowCorrelation`) = LOTE; QA Lab = INTERATIVA; request de uma pessoa (`requireAuth` marca
  `origin: "USER_REQUEST"`) = INTERATIVA (inclui "Testar diagnóstico"); o resto (scripts, jobs) = LOTE. O mesmo
  especialista/Orquestrador é interativo no chat e lote num Workflow.
- **Vagas**: `INIA_AI_MAX_CONCURRENT_CALLS` (16) por processo, das quais `INIA_AI_RESERVED_INTERACTIVE_CALLS` (4) o lote
  nunca usa; na fila, interativa passa à frente. Chamada aninhada usa a vaga da de fora (nunca trava esperando por si mesma).
  Interativa que fica `INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS` (20 s) sem vaga desiste com `AI_CAPACITY_BUSY` (503, nada saiu).
- **429 / 503**: LOTE espera backoff exponencial com jitter (`INIA_AI_BATCH_BACKOFF_BASE_MS` 2 s → teto
  `INIA_AI_BATCH_BACKOFF_MAX_MS` 60 s), com o **Retry-After como mínimo** (cabeçalhos `retry-after-ms`/`Retry-After` nos
  adapters — `http.ts` — e o `RetryInfo.retryDelay` do corpo do 429 do Google no legado), até `INIA_AI_BATCH_MAX_RETRIES`
  (5) novas tentativas; depois devolve o erro ORIGINAL (a política de retentativa do nó do Workflow decide). Um 429 também
  **pausa o início de novas chamadas de lote** deste processo pelo tempo pedido — sobra cota para o chat. INTERATIVA tenta no máximo UMA
  vez a mais, rápido (≤ 2 s, mesmo com Retry-After maior), e falha com `AI_RATE_LIMIT` 429 e mensagem clara
  (`INTERACTIVE_RATE_LIMIT_MESSAGE`). O cliente legado já repete o 503 uma vez: a interativa não empilha outra.
- **Nunca repete**: credencial, pedido inválido, orçamento, QA Lab bloqueado, `transport.retries: 0` (Feedback Writer — o
  pipeline decide a falha), stream de chat que já entregou texto e chamada CANCELADA (quem pediu foi embora:
  `runWithAiCancellation` → sai da fila/backoff, fetch interrompido, `AI_CALL_CANCELLED`, nunca fallback).
- **Fallback da policy continua por dentro**: FALLBACK_CHAIN troca de modelo na hora dentro da mesma vaga; o limitador só
  repete quando a rota INTEIRA devolveu 429/503 — repete a policy (mesmo `correlation_id`), nunca cai no legado.
- **Telemetria**: `ai_usage_events` ganhou `call_priority`, `call_priority_reason`, `queue_wait_ms`, `queue_reason`
  (NONE | CAPACITY | PROVIDER_COOLDOWN | RETRY_BACKOFF) e `limiter_attempt` (migration 121; o evento continua UM por
  tentativa, sem prompt/resposta; `attempt`/`fallback_index` continuam sendo o fallback). Log estruturado: `ai_call_queued`
  (espera ≥ 250 ms), `ai_call_retry`, `ai_call_capacity_busy`. O `/health` do processo de processamento mostra a fila.
- `INIA_AI_LIMITER=OFF` = sai direto, como antes (a classe continua gravada, com espera 0).
- **Por processo**: com API e processamento separados (`INIA_PROCESS_ROLE`), a API só tem interativas e o processamento só
  lote (até `max − reservadas`).
- **Por CONEXÃO, em todas as instâncias (13/10/2026 — `provider-call-gate.ts`, migrations 127 + 135)**: quem tem cota é o
  ACESSO (a conexão desta tela, com a própria chave), não cada processo. Cada conexão tem **Chamadas simultâneas**
  (`ai_connections.max_concurrent_calls`; em branco = sem teto próprio) — vagas divididas por N APIs + M workers numa tabela
  UNLOGGED com prazo renovado (`ai_call_slot_leases`); ¼ do teto (≥ 1) é reservado à interativa; interativa espera no máximo
  20 s (`AI_CAPACITY_BUSY`), lote espera o quanto precisar. Um 429/503 da conexão grava a pausa dela em `ai_provider_cooldowns`
  (Retry-After ou 5 s/2 s, ≤ 60 s) ANTES de o erro voltar; os lotes de todas as instâncias esperam naquela conexão e, numa
  FALLBACK_CHAIN que permite RATE_LIMIT, vão direto para o próximo modelo (`FALLBACK_RATE_LIMIT`, nada sai para a conexão
  pausada). A interativa nunca é pausada. Rota do ambiente (sem policy): chave `legacy:<provedor>`, só a pausa. Nada no
  portão conhece provedor específico. Banco fora = a chamada sai sem vaga compartilhada (aviso no log).
- Exceção: "Testar modelo" do admin chama o adapter direto (sonda sem repetição) — fora da fila.

Prova/demonstração (provider falso com latência 300 ms e cota de 6 simultâneas; lote de 12 matrículas × 4 chamadas + chat
de 10 mensagens): `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run ai-call-limiter-proof`. Resultado de 2026-10-08:

| Braço | Chat (10 msgs) | Lote (48) | 429 no provider |
|---|---|---|---|
| Limitador desligado (como antes) | 6/10 — 4 com `AI_RATE_LIMIT` | 23/48 — 25 falharam | 29 |
| Ligado (6 vagas, 2 do chat) | 10/10 · p95 309 ms | 48/48 · 3,7 s · 44 esperaram vaga (média 585 ms) | 0 · pico 5 |
| Ligado acima da cota (10 vagas, lote até 8) | 10/10 · p95 1,5 s (1 usou a nova tentativa) | 48/48 · 8,7 s · 22 repetidas após o Retry-After | 23 |

Unitários: `model-routing/ai-call-limiter.test.ts` (relógio falso) e `ai-call-limiter-gateway.test.ts` (gateway + fallback).

## Feedback por outro provedor — Use Case FEEDBACK_WRITER roteável (2026-10-08)

Antes, a redação e a verificação do feedback ficavam presas ao Gemini (decisão do piloto V1.5.1: `FEEDBACK_WRITER` com
`routable: false` e `AI_USE_CASE_NOT_ROUTABLE` no admin). Sem `GEMINI_API_KEY`, nenhum feedback saía. Agora o Use Case é
configurável por policy da organização, como os outros. **Sem policy ativa, nada muda**: as rotas fixas de sempre, o mesmo pedido
ao cliente Gemini (provado byte a byte em `feedback-engine/infrastructure/gateway-engine-model.test.ts`) e zero retry onde a etapa
pede `transport.retries: 0`.

**Uma policy FEEDBACK_WRITER atende todas estas etapas** (o nome da tela é "Redação e verificação do feedback"):

| Etapa (tag `stage:*`) | Rota fixa sem policy | Schema da saída | Teto de saída | Tempo | Retries |
|---|---|---|---|---|---|
| Redação do motor (`ENGINE_COMPOSITION`) | gemini-3.8-flash | sim | 8.192 | 120 s | 0 |
| Verificação e coerência do motor (`ENGINE_VERIFICATION`) | gemini-3.8-flash | sim | 8.192 | 120 s | 0 |
| Redatores do feedback confiável (monitoria e indicador) | gemini-3.1-flash-lite | sim | — | 30 s | 0 |
| Narrativa de supervisor (`SUPERVISOR_NARRATIVE`) | gemini-3.1-flash-lite | sim | — | 30 s | 0 |
| Narrativa do fechamento mensal (`PRV_DIAGNOSIS_NARRATIVE`) | gemini-3.1-flash-lite | sim | — | 30 s | 0 |
| Verificação semântica da narrativa (`NARRATIVE_FACTUALITY`) | gemini-3.8-flash | sim | — | 60 s | 1 |
| Redator do feedback por interação (piloto) | gemini-3.1-flash-lite | não (só JSON) | — | 30 s | 0 |

A análise do motor (análise, revisão, confirmação, planejamento da investigação, práticas e temas) é o Use Case
`FEEDBACK_ANALYSIS`, que já era roteável: **para gerar feedback sem Gemini, a organização precisa das DUAS policies**
(`FEEDBACK_ANALYSIS` e `FEEDBACK_WRITER`). Um Workflow que também chama Agent/Orquestrador precisa das policies dessas funções
(`AGENT_RESPONSE`, `SPECIALIST_RESPONSE`, `ORCHESTRATOR_ROUTING` e `INVESTIGATION_PLANNING` exigem Tools; `ORCHESTRATOR_SYNTHESIS`,
`MANAGERIAL_SYNTHESIS`, as etapas da análise semântica e `CHAT`). Função sem policy cai no legado, que sem `GEMINI_API_KEY` falha
com erro claro (`AGENT_EXECUTION_NOT_CONFIGURED`, `ASSISTANT_NOT_CONFIGURED` — 503), nunca em silêncio.

### O que a policy respeita de cada etapa

Antes desta entrega, o caminho por policy ignorava o schema, o teto de saída e o tempo pedidos pela etapa (só o legado os
recebia) — valia para `FEEDBACK_ANALYSIS` também. Agora o gateway os leva até o adapter (`PolicyExecutionRequest`):

- **Saída estruturada**: `structuredOutput` (já ia) + o `responseSchema` da etapa. Google: `generationConfig.responseSchema`, como
  no cliente legado. OpenAI e compatíveis: `response_format: json_schema` (ver abaixo). Anthropic: ignorado (saída por instrução).
  O parser de cada etapa continua sendo a validação de verdade — resposta fora do contrato segue o caminho de sempre (reescrita
  guiada, texto do sistema, QA).
- **Teto de saída**: o da etapa, limitado pelo `maxOutputTokens` cadastrado no modelo (acima dele o provider recusaria); etapa
  sem teto = o do modelo; nenhum = o padrão do provider (`effectiveMaxOutputTokens`).
- **Tempo**: o da etapa é o PISO (foi calibrado no legado — a conexão nasce com 60 s e a análise precisa de 240 s); o timeout do
  modelo/conexão só ESTENDE (o admin pode dar mais tempo a um modelo lento, nunca menos que a etapa pede — `effectiveTimeoutMs`).
- **Repetição**: `transport.retries: 0` faz o limitador nunca repetir (já valia para os dois caminhos); os adapters nunca
  repetem. Na policy, `FALLBACK_CHAIN` troca de modelo em erro elegível — para reproduzir o "sem fallback" do piloto, use PINNED.
- **Proveniência**: os redatores (`WriterProvenance`) passam a gravar `provider`/`requestedModel` da policy e `route`
  (modo, provider, conexão, modelo, tentativa de fallback); sem policy, o registro é o de antes. Falha antes de haver resposta não
  traz rota — a tentativa fica no evento de uso. As narrativas e o motor já gravam o modelo devolvido pelo provider.

### Adapter OpenAI (Chat Completions) — como cada exigência vira request, e o que ele NÃO suporta

| Exigência | Request |
|---|---|
| Saída estruturada com schema | `response_format: { type: "json_schema", json_schema: { name: "inia_response", strict: false, schema } }` — schema convertido para JSON Schema (`toJsonSchema`: tipos em minúsculas, `nullable` → união com `null`, sem `propertyOrdering`) |
| Saída estruturada sem schema | `response_format: { type: "json_object" }` (a API exige a palavra "JSON" nas mensagens — todos os prompts estruturados da INIA a têm; conferido em 2026-10-08) |
| Teto de saída | provider **OpenAI**: `max_completion_tokens` (os modelos de raciocínio recusam `max_tokens`); demais (xAI, Ollama, LM Studio, compatível): `max_tokens` |
| Tempo | `AbortSignal` do `http.ts` (o `fetch` do Node desiste de esperar cabeçalhos aos ~300 s — ver `long-request-timeout.proof.test.ts`) |
| Motivo de término | `finish_reason` → vocabulário do legado (`length` = `MAX_TOKENS`, `stop` = `STOP`, `content_filter` = `SAFETY`) |

Não suportado / limitações conhecidas:

- **Schema não é garantido**: o modo estrito (`strict: true`) não é usado porque exige todo campo obrigatório e
  `additionalProperties: false`, e os contratos da INIA têm campos opcionais. O modelo recebe o formato, mas a API não o impõe.
- **Modelos sem Structured Outputs** (ex.: gpt-3.5-turbo, gpt-4-turbo) recusam `json_schema` com 400 → `INVALID_REQUEST`, sem
  fallback. Use modelo com Structured Outputs (gpt-4o-2024-08-06 ou mais novo, famílias gpt-4.1/gpt-5/o) e declare
  STRUCTURED_OUTPUT nele só depois de validar.
- **Servidores compatíveis**: suporte a `json_schema` varia (Ollama ≥ 0.5 e LM Studio aceitam; gateways internos, conferir). O
  teto vai como `max_tokens`: um gateway/Azure servindo modelo de raciocínio pela entrada "compatível" pode recusá-lo.
- **Azure OpenAI**: não há entrada própria no catálogo. Caminho provável (NÃO validado): conexão do tipo **OpenAI** com endpoint
  `https://<recurso>.openai.azure.com/openai/v1` (API v1 da Azure, aceita a chave como Bearer) e o nome do *deployment* como id do
  modelo. A API antiga com `?api-version=` e cabeçalho `api-key` não é suportada pelo adapter.
- **Raciocínio**: `reasoning_effort` não é enviado (vale o padrão do modelo). O teto da etapa inclui o raciocínio
  (`completion_tokens`) — um modelo que raciocina muito pode bater `MAX_TOKENS` numa etapa calibrada para o Gemini; o motivo
  aparece no registro (`finishReason`).
- **Cache**: o cache explícito de prompt (`INIA_PROMPT_CACHE=EXPLICIT`) só existe no legado Gemini; o cache automático da
  OpenAI aparece em `cached_tokens` e entra no custo pelo preço de cache cadastrado.
- **Calibração**: tempos e tetos foram medidos no Gemini. A qualidade e a estabilidade do motor com outro modelo **não foram
  medidas** (esta entrega não fez nenhuma chamada paga) — rodar uma bateria pequena antes de liberar para a operação.

### Configurar (POC)

Administração › IA / Modelos: Nova conexão → OpenAI (ou "compatível" com o endpoint do SDK da operação) → chave → Testar →
Sincronizar modelos → declarar STRUCTURED_OUTPUT (e TOOLS, se o modelo for usado em planejamento/roteamento) e o preço →
Roteamento: `FEEDBACK_ANALYSIS` e `FEEDBACK_WRITER` em PINNED → "Testar roteamento" (zero chamada) → Ativar. Some a cota da chave
com o limitador (`INIA_AI_MAX_CONCURRENT_CALLS` por processo).

### Prova

```bash
cd backend && INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-writer-policy-proof
```

Runtime, adapters, policy (criada pela API do admin), limitador e registro de uso reais; provider OpenAI falso em 127.0.0.1
(`testing/fake-openai-compatible-server.ts`, opção `respond` roteirizada) e adapter Gemini falso no legado. Resultado de
2026-10-08 (7/7): sem policy a composição e a verificação do motor saem pelo Gemini fixo (3.8 Flash, 120 s, retries 0) e nada vai
à OpenAI; modelo sem STRUCTURED_OUTPUT declarado não ativa; com policy PINNED saem pela OpenAI falsa com `json_schema` da etapa e
`max_completion_tokens` 8.192, a MESMA mensagem, eventos `PINNED`/`OPENAI`/`BATCH`, Gemini não chamado; o redator do piloto
segue a policy e a proveniência grava a rota; 503 pela policy = uma chamada só; desativar volta ao Gemini. Controle negativo:
com `routable: false` a prova falha em `AI_USE_CASE_NOT_ROUTABLE`. Provas de banco desta área usam a mesma organização: rode
uma por vez (em paralelo, a limpeza de uma apaga as policies da outra).

## Voz do recado por policy (Use Case SPEECH_SYNTHESIS, 2026-10-08)

A "Voz do recado do avatar" — o áudio do recado de Workflow (`GET /api/v1/inia-deliveries/avatar/:id/audio`) e do "Ouvir com a
INIA" (`GET /api/v1/feedback-applications/:id/audio`) — passou a ser configurável por policy da organização. **Sem policy, nada
muda**: a voz da conversa (Gemini Live no servidor, conferida pela transcrição) com o TTS do Gemini como reserva, a voz da INIA
(`config/inia-voice.ts`) e as mesmas identidades de cache (`acceptedRecadoModels`) — mesmo pedido, mesma consulta.

**Configurar** (Administração › IA / Modelos): conexão OpenAI (ou compatível) → modelo `gpt-4o-mini-tts` cadastrado à mão (a
listagem da OpenAI traz os ids, mas não diz o que é voz) → declarar a capacidade **Áudio** → em Configurar, **Voz** (nome da voz
do provider: `marin`, `cedar`, `coral`…) e, opcional, **Instrução de tom** → preço (opcional) → Roteamento › "Voz do recado do
avatar" → PINNED → Ativar. "Testar modelo" num modelo com voz lê uma frase curta (uma síntese real, ~US$ 0,001).

Como funciona:

- **Voz no MODELO**, não na policy: a voz é do provider ("marin" não existe no Gemini) e uma cadeia de fallback pode ter vozes
  diferentes. Fica em `ai_models.metadata.speech = { voice, instructions }` — sem migration; a sincronização de modelos preserva.
- **Elegibilidade**: capacidade AUDIO declarada + protocolo com síntese de voz (`SPEECH_SYNTHESIS_ADAPTERS` = Chat Completions:
  OpenAI e compatíveis; Google/Anthropic ainda não) + voz cadastrada. Sem isso a policy não ativa ("voz não configurada no
  modelo"); a aba Roteamento mostra o motivo.
- **Gateway**: `createRoutedSpeechSynthesizer` envolve a composição de sempre (`createRecadoVoice` com os dois clientes Gemini já
  embrulhados por `createSpeechSynthesizer`): policy ACTIVE → `runtime.synthesizeSpeechWithPolicy` dentro do limitador (classe
  interativa), com orçamento, fallback e evento de uso como qualquer chamada por policy; sem policy → o legado, sem mudar nada.
- **Adapter**: `POST {endpoint}/audio/speech` com `{ model, input (texto exato), voice, response_format: "pcm", instructions? }`;
  a resposta é PCM16 mono 24 kHz little-endian — o mesmo formato que o avatar já toca (`X-Audio-Format: pcm16le`,
  `X-Sample-Rate`); o frontend não muda. Erros normalizados, sem retry no adapter.
- **Cache por entrega/aplicação**: a identidade aceita é calculada por pedido (`speechCacheIdentity`): sem policy, a de sempre;
  com policy, a voz do modelo primário + `providerModelId#hash12(instrução)` (`speechCacheModelKey`). Trocar de modelo, de voz ou
  de instrução — ou desativar a policy — gera áudio novo; nunca serve o áudio de outra voz. Áudio de um fallback com OUTRA voz não
  é reaproveitado (o primário tenta de novo). Policy ativa sem candidato = identidade que não casa com nada (a síntese falha com o
  erro claro da policy, nunca o áudio antigo).

Limitações:

- **A conversa por voz continua no Gemini** (Live no navegador): com a policy, o recado fala com uma voz e a conversa com outra.
- **Custo desconhecido**: a resposta binária do `/audio/speech` não traz tokens — o evento fica `cost_status = UNKNOWN`
  (`NO_USAGE`), nunca estimado. O uso com contagem existe só no modo SSE da OpenAI (`stream_format: "sse"`), não usado aqui porque
  o formato dos eventos não está documentado na referência consultada.
- **Texto até 4.096 caracteres** por síntese (limite da API); a instrução de tom não funciona com `tts-1`/`tts-1-hd`.
- **Servidores compatíveis**: precisam implementar `/v1/audio/speech` com `pcm` em 24 kHz; a taxa é fixa no adapter (não há
  cabeçalho para lê-la).
- Não validado com a chave real: qualidade da voz em PT-BR, pronúncia de números/protocolos e o tom.

Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run speech-synthesis-policy-proof` (rota HTTP real com sessão, runtime e cache
reais; clientes Gemini falsos no legado; OpenAI falsa com `/v1/audio/speech`). Resultado de 2026-10-08 (6/6): sem policy, voz da
conversa (falsa) e cache; modelo sem voz não ativa a policy e a sincronização preserva a voz; com policy, o áudio do Gemini guardado
deixa de servir, o recado é lido pela OpenAI falsa com a voz e o tom do modelo e o uso é PINNED (custo UNKNOWN); trocar tom/voz gera
áudio novo; desativar volta ao Gemini. Controle negativo: com `routable: false` 4 dos 6 falham. Unitários: `adapters.test.ts`,
`speech-routing-gateway.test.ts`, `ai-speech.test.ts`, `ai-routing-policy.test.ts`; tela: `ai-management.test.tsx`.

## O que continua exigindo Gemini (levantamento de 2026-10-08)

Sem `GEMINI_API_KEY`, o texto inteiro (chat, Agents, Orquestradores, Workflows, feedback) roda pela policy da organização. A voz
do recado e do "Ouvir com a INIA" também, desde a policy de "Voz do recado do avatar" (seção acima). Só a **conversa por voz**
continua presa ao Gemini. O levantamento original dos três lugares de voz:

| Recurso | Onde | Como usa o Gemini |
|---|---|---|
| Conversa por voz com o avatar | `realtime/infrastructure/gemini-realtime-client.ts` (token efêmero) + `frontend/src/lib/realtime/gemini-realtime-transport.ts` (~900 linhas: protocolo Live, microfone, interrupção, transcrição, ferramentas → `/tool-call`, áudio PCM 24 kHz para o lip-sync) | sessão Gemini Live (`gemini-2.5-flash-native-audio-latest`, voz "Kore") direto do navegador |
| Voz do recado do avatar | `conversational-delivery/infrastructure/gemini-live-speech-client.ts` (principal) e `gemini-tts-client.ts` (plano B) | sem policy: sessão Live curta no servidor lendo o texto exato (conferido pela transcrição) ou TTS (`INIA_AVATAR_TTS_MODEL`, padrão `gemini-3.8-flash-lite-tts`). **Com policy SPEECH_SYNTHESIS: o modelo/voz da policy** |
| "Ouvir com a INIA" (áudio do feedback aplicado) | `feedback-application/presentation/feedback-applications-router.ts` → o mesmo `iniaSpeech` do recado | idem (segue a mesma policy) |

Sem a chave, essas rotas respondem 503 com código claro (`REALTIME_NOT_CONFIGURED`, `SPEECH_NOT_CONFIGURED`) e o resto da
aplicação não é afetado (comportamento da tela sem áudio não foi verificado nesta entrega). As ferramentas que a voz aciona no
backend (`/tool-call` → especialista) já saem pelo gateway e seguem a policy. A busca na base de conhecimento é lexical (sem
embeddings): não depende de provedor.

Preços oficiais consultados em 2026-10-08 (USD por 1M tokens; [Gemini](https://ai.google.dev/gemini-api/docs/pricing),
[OpenAI](https://developers.openai.com/api/docs/pricing)). As estimativas por minuto são ordens de grandeza com premissas
explícitas — conferir na conta antes de decidir.

| Opção | Conversa por voz | Recado / "Ouvir" | Custo | Esforço |
|---|---|---|---|---|
| **A. Manter Gemini só para voz** | como hoje | como hoje | Live 2.5 Flash Native Audio: áudio 3,00 entrada / 12,00 saída; TTS 3.8 Flash-Lite: 6,00 saída até 31/12/2026, 12,00 depois (25 tokens/s ≈ US$ 0,009/min de recado; 0,018 em 2027). Conversa ≈ US$ 0,02–0,05/min (supondo 32 tokens/s de áudio e o contexto da sessão cobrado de novo a cada turno) | zero código; exige uma chave Gemini e aceitar que o áudio vá ao Google |
| **B. Voz em tempo real da OpenAI** | `gpt-realtime-2` (áudio 32 entrada / 64 saída; cache 0,40) ou `gpt-realtime-mini` (10 / 20); ou GPT-Live (`gpt-live-1`, US$ 0,05/min, sessões WebRTC com SDP repassado pelo servidor, ferramentas por "delegação" — produto novo, não avaliado) | TTS da opção C | Realtime-2 ≈ US$ 0,05–0,10/min; mini ≈ US$ 0,015–0,03/min (supondo ~10 tokens/s de entrada e ~20/s de saída — a página não publica a taxa) | alto: token efêmero no backend, um transporte novo no frontend do tamanho do atual (eventos, interrupção, transcrição, ferramentas), lip-sync (WebSocket entrega PCM 24 kHz como hoje; WebRTC exige ler o áudio da faixa), voz nova (não existe "Kore"), validar PT-BR |
| **C. Voz por etapas (texto no meio)** | microfone → transcrição (`gpt-4o-mini-transcribe` US$ 0,003/min) → chat de sempre (já roteável) → TTS | TTS da OpenAI (`gpt-4o-mini-tts`: 0,60 texto + 12,00 áudio ≈ US$ 0,015/min pela estimativa da OpenAI no lançamento; ou `tts-1`: US$ 15 / 1M caracteres ≈ US$ 0,01 por recado de 600 caracteres) | ≈ US$ 0,01/min de conversa (metade fala da pessoa, metade da INIA) + o texto do chat | médio: Use Cases de transcrição e síntese no gateway (orçamento/uso de graça), cliente TTS com `response_format: pcm` no lugar do Gemini, modo de voz por turnos no frontend; perde a fluidez (1,5–3 s por turno, sem interromper a fala) |
| **D. Desligar a voz na POC** | sem conversa por voz | recado e feedback só em texto | zero | só configuração (sem `GEMINI_API_KEY`), validar as telas sem áudio |

Para o recado e o "Ouvir com a INIA", a troca isolada já existe (policy de "Voz do recado do avatar", seção acima); a voz do
recado deixa de ser a da conversa enquanto a conversa continuar no Gemini — o motivo de o recado usar o Live sem policy
(`config/inia-voice.ts`). Exemplo de ordem de grandeza para 30 pessoas × 22 dias: um recado de
45 s por dia (≈ 500 min/mês) ≈ US$ 5–12/mês em qualquer das opções (Live do recado ≈ US$ 0,017/min de fala); 10 min de conversa por dia ≈ 6.600 min/mês → ~US$ 130–330 (Gemini Live) ou ~US$ 330–660
(`gpt-realtime-2`).

## Auditoria de call sites (fechamento 2026-09-22)

Todo uso de IA do backend sai por `generateForRoute` (Investigation planning/notas, extração semântica, síntese de
padrões, sidecar de atribuição, Agent — estruturado, texto livre e correção de evidência —, especialista,
Orquestrador — roteamento e síntese, chat/voz/Workflow —, síntese pós-JOIN) ou pelos dois embrulhos interativos
(`createChatStreamer` — chat sem Orquestrador, com streaming — e `createVoiceSessionStarter`). Cada chamada grava UM
evento de uso (sucesso, erro ou bloqueio). Provas:

- `model-routing/ai-call-sites.test.ts` — estrutural: só os clientes conhecidos têm o endereço de um provider; os
  clientes crus só são importados por quem os embrulha; o `app.ts` entrega chat e voz embrulhados.
- `model-routing/ai-runtime-gateway.test.ts` — "zero spend sem uso": cada `RoutePurpose` (com/sem organização,
  sucesso/erro) grava exatamente um evento; chat em streaming com erro grava evento e o hard limit bloqueia antes do
  stream.

Exceções documentadas:

- **Voz (Gemini Live)**: a conversa roda no navegador com token efêmero; o backend aplica o hard limit antes de abrir a
  sessão e registra a sessão (tokens não informados → custo UNKNOWN). Não é roteável na V1 — opções e custos em "O que continua
  exigindo Gemini".
- **Scripts de benchmark/POC** (`scripts/poc-tools/*`): não registram o runtime — nenhum evento é gravado (decisão da V1
  para manter os benchmarks byte a byte). Rodá-los com provider pago gasta sem evento no dashboard.
- **Falha ao gravar o evento** (banco indisponível): a chamada não é derrubada; a falha vai para o log
  (`ai_usage_record_failed`).
- **Criação de cache explícito do Gemini** (`INIA_PROMPT_CACHE=EXPLICIT`, desligado por padrão): o custo da criação
  entra só na estimativa legada por ambiente, não na precificação pela tabela.

## Configuração real deste ambiente (dev, 2026-09-22)

Cadastrado pelo AI Management (serviços da aplicação), **sem nenhuma policy ativa** — o comportamento continua o legado:

| Conexão | Modelo | Capacidades declaradas | Preço (USD / 1M) |
|---|---|---|---|
| IA INIA - GEMINI (`GOOGLE_GENAI`, chave real criptografada) | `gemini-3.1-flash-lite` — Gemini 3.1 Flash-Lite, tier BASIC | Tools, saída estruturada, raciocínio, cache de prompt | entrada 0,25 · saída 1,50 · cache 0,025 · raciocínio 1,50 (desde 22/09/2026) |
| | `gemini-3.8-flash` — Gemini 3.8 Flash, tier STANDARD | Tools, saída estruturada, raciocínio, cache de prompt | promocional até 31/12/2026: 0,75 · 3,75 · 0,075 · 3,75; a partir de 01/01/2027: 1,50 · 7,50 · 0,15 · 7,50 |
| Ollama Local — MacBook Air M5 (`OLLAMA`, `http://127.0.0.1:11434/v1`) | `qwen3:8b` — Qwen3 8B Local | Tools, saída estruturada, streaming (verificados por smoke local) | 0 (custo de API; computação local não medida) |

Fonte dos preços: página oficial "Gemini Developer API pricing" (paid tier, standard), verificada em 2026-09-22.

- **Raciocínio do Gemini**: a API informa `thoughtsTokenCount` FORA de `candidatesTokenCount` e cobra o thinking ao
  preço de saída — por isso `reasoningPerMillion = outputPerMillion` nos modelos Gemini. Em providers que já contam o
  raciocínio dentro da saída (OpenAI `completion_tokens`), o campo fica vazio.
- **Componentes de preço NÃO modelados** (`UNMODELED_PRICING_COMPONENT`): entrada de áudio (3.1 Flash-Lite: 0,50;
  cache de áudio 0,05) — o preço cadastrado é o de texto/imagem/vídeo, o único usado pela INIA fora da voz —; e
  armazenamento de cache por hora (3.1 Flash-Lite 1,00 / 1M tokens·h; 3.8 Flash 0,50 → 1,00 em 2027). Nada disso é
  somado em entrada/saída.
- **Voz**: `gemini-2.5-flash-native-audio-latest` está em uso pela sessão Live, mas não foi cadastrado (não roteável na V1,
  preço de áudio não modelado).

### Modelo local (Ollama)

- Instalação Homebrew (`brew install ollama`, serviço `brew services start ollama`); modelo `ollama pull qwen3:8b`
  (Q4_K_M, 8,19B parâmetros, pesos GGUF de 5,2 GB em `~/.ollama/models`, sem `remote_host` — não é Ollama Cloud).
- **Capacidade do modelo ≠ limite operacional.** O modelo anuncia 40.960 tokens de contexto (registrado em
  `contextWindow`). O servidor Ollama carrega com o contexto padrão dele (**4.096** neste Mac, ver `ollama ps`) e o
  endpoint `/v1` não permite escolher `num_ctx` por request: prompts maiores são TRUNCADOS pelo servidor. A INIA não tem
  campo de limite operacional separado na V1 — o limite é do servidor. Recomendação para 16 GB: `OLLAMA_CONTEXT_LENGTH=16384`
  no serviço (ex.: `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384 && brew services restart ollama`, ou na plist do serviço)
  antes de rotear qualquer Use Case com prompt grande para o modelo local.
- **Privacidade**: com uma policy apontando para esta conexão, o conteúdo da chamada vai para `127.0.0.1` e não sai da
  máquina POR CAUSA deste provider. Não vale para o resto da aplicação (outros Use Cases, voz, banco, etc.).
- Não há policy usando o modelo local; ativar uma é decisão explícita do admin.

## Adicionar um provider

- **Protocolo já suportado** (ex.: outro servidor compatível com OpenAI): só uma entrada em `AI_PROVIDERS`
  (`ai-provider-catalog.ts`) — a UI é montada pela metadata.
- **Protocolo novo**: um adapter que implemente `AiProviderAdapter` (`application/provider-adapter-port.ts`) + registro em
  `adapter-registry.ts` + um valor em `AI_ADAPTER_TYPES` + a entrada no catálogo. Normalize uso (ausente = null) e erro
  (use `rawRequest`/`requestJson` de `http.ts` para herdar timeout, categorias e redação). Adapter nunca repete requests.

## Testes

```bash
cd backend && npx vitest run src/modules/ai-management src/shared/application/model-routing
```

Prova de ponta a ponta contra o banco de teste (provider falso em 127.0.0.1; o cliente legado Gemini é substituído por
um fake — zero API paga):

```bash
cd backend && INIA_DB_PROOF=1 npx vitest run ai-providers-proof
```

## QA manual sem gastar API

Provider falso compatível com OpenAI (modelos `fake-ok`, `fake-json`, `fake-rate-limited`, `fake-down`,
`fake-unauthorized`, `fake-bad-request`, `fake-no-usage`, `fake-slow`):

```bash
cd backend && npx tsx scripts/dev/fake-ai-provider.ts
```

Com credencial obrigatória (para testar AUTH_ERROR com a chave errada):

```bash
cd backend && FAKE_AI_KEY=sk-qa-local-123456789 npx tsx scripts/dev/fake-ai-provider.ts
```

Na tela: Nova conexão → "Servidor compatível com OpenAI" → endpoint `http://127.0.0.1:4599/v1` → Testar → Sincronizar
modelos → declarar capacidades → preço → Roteamento. Chamadas reais da INIA (chat, Agents, Workflows) passam a usar o
modelo falso para o Use Case configurado — desative a política ao terminar.

## Operação

- Limitador de chamadas: `INIA_AI_LIMITER`, `INIA_AI_MAX_CONCURRENT_CALLS`, `INIA_AI_RESERVED_INTERACTIVE_CALLS`,
  `INIA_AI_INTERACTIVE_QUEUE_TIMEOUT_MS`, `INIA_AI_BATCH_MAX_RETRIES`, `INIA_AI_BATCH_BACKOFF_BASE_MS`,
  `INIA_AI_BATCH_BACKOFF_MAX_MS` (ver "Capacidade" acima). Fora isso, nenhuma variável de ambiente nova do AI Management. A criptografia usa `DATA_HUB_SECRET_KEY` (obrigatória em produção). Trocar essa
  chave invalida os segredos já gravados (a conexão passa a falhar com AUTH e a tela pede para substituir a chave).
- `GEMINI_API_KEY`, `INIA_MODEL_PROFILES`, `INIA_MODEL_PRICING`, `INIA_MODEL_ROUTING` continuam valendo para as funções
  sem política ativa (configuração legada). Nada é migrado automaticamente para o banco.
- Uso sem organização no contexto (ex.: um script) não é persistido quando o runtime não está registrado; com runtime
  registrado e sem organização, o evento é gravado com `organization_id` nulo (invisível a qualquer organização).
