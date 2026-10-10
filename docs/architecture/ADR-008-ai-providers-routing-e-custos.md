# ADR-008 — AI Providers, Modelos, Roteamento e Custos (V1)

**Status:** aceito (2026-09-22) · **Migration:** `076_ai_providers.sql` · **Módulo:** `backend/src/modules/ai-management` + `backend/src/shared/application/model-routing`

## Contexto

Até a V1.3 a INIA tinha um roteador provider-agnostic (`route-policy.ts` + `llm-gateway.ts`), mas a configuração
vivia no **ambiente**: perfis por tier (`INIA_MODEL_PROFILES`), uma única credencial (`GEMINI_API_KEY`), preço por
`INIA_MODEL_PRICING` (float) e um único adapter (Gemini). Trocar de modelo exigia editar `.env` e reiniciar; não havia
uso persistido, custo por Use Case, orçamento, modelo local nem isolamento de configuração por organização.

A regra de produto é **plug and play**: o administrador conecta uma IA com a própria chave, testa, descobre/cadastra
modelos, decide qual modelo executa cada função da INIA, configura fallback/roteamento automático, acompanha tokens,
custo, latência e erros e define orçamentos — sem deploy, sem restart, sem `.env`.

## Auditoria do que existia (antes desta entrega)

| Peça | Onde | Observação |
|---|---|---|
| Roteador | `model-routing/route-policy.ts` | tier por propósito (`RoutePurpose`) + sinais; modos CURRENT/EFFICIENCY; nunca LLM decide |
| Gateway | `model-routing/llm-gateway.ts` → `generateForRoute` | ponto único de saída (Agent, especialista, Orquestrador, análise semântica, pós-JOIN) |
| Adapter | `assistant/infrastructure/gemini-provider-adapter.ts` | único; usa os clientes `gemini-agent-client`/`gemini-function-calling-client` com `GEMINI_API_KEY` |
| Telemetria | `llm-telemetry.ts` (ALS) | só existia DENTRO do QA Lab; produção não persistia uso |
| Custo | `model-pricing.ts` | `INIA_MODEL_PRICING` (JSON, float), status `ESTIMATED_PROVIDER_COST` |
| Segredos | `data-hub/infrastructure/aes-secret-store.ts` | AES-256-GCM, chave `DATA_HUB_SECRET_KEY` fora do banco |
| Bypasses | `gemini-text-client.ts` (chat em streaming sem Orquestrador), `gemini-realtime-client.ts` (voz Live) | fora do gateway |
| Retry | clientes Gemini | 2 tentativas só em HTTP 503, 600 ms |
| Erros | clientes Gemini | `details.body` com o corpo cru do provider chegava ao navegador pelo error handler |

## Decisão

**Evoluir o roteador existente — nunca criar um segundo.** O gateway continua o ÚNICO ponto de saída. Ele passa a
consultar uma **porta** (`AiRuntime`, `model-routing/ai-runtime.ts`) antes do caminho legado:

```
regra de negócio ──(RoutePurpose + classificação)──► generateForRoute
                                                         │
                         Use Case = useCaseForPurpose(purpose, stage)
                                                         │
             ┌───────────── policy ACTIVE da organização p/ o Use Case? ─────────────┐
             │ sim                                                                     │ não
   plano determinístico (PINNED / FALLBACK_CHAIN / AUTO)                   caminho LEGADO (perfis por tier + ENV)
   → capacidade, contexto, custo, orçamento                                  → hard limit do orçamento
   → adapter da CONEXÃO (segredo decifrado só aqui)                          → adapter legado (idêntico a antes)
   → fallback só em erro elegível                                            │
             └──────────────────────► evento de uso (ai_usage_events) ◄──────┘
```

### Conceitos (nunca misturados)

| Conceito | O que é | Onde vive |
|---|---|---|
| **Provider** | TIPO de integração (metadata + protocolo) | código: `ai-provider-catalog.ts` (só existe se houver adapter) |
| **Adapter** | fala UM protocolo: `testConnection`, `listModels`, `execute`, `stream?` + normalização de uso/erro | `infrastructure/adapters/*` — `GOOGLE_GENAI`, `OPENAI_CHAT_COMPLETIONS`, `ANTHROPIC_MESSAGES` |
| **Connection** | conexão configurada pela organização (endpoint, credencial, timeout, local/remoto) | `ai_connections` + `ai_connection_secrets` |
| **Model** | modelo utilizável por UMA conexão (`providerModelId` imutável, alias, capacidades com ORIGEM, janela, tier declarado) | `ai_models` |
| **Pricing** | preço por milhão, VERSIONADO por vigência | `ai_model_pricing` |
| **Use Case** | função estável da INIA que a regra de negócio pede | código: `ai-use-cases.ts` (derivado da auditoria dos pontos reais de chamada) |
| **Routing Policy** | como um Use Case escolhe modelo (DRAFT → ACTIVE → ARCHIVED) | `ai_routing_policies` + `ai_routing_policy_models` (a "regra") |
| **Usage Event** | uma TENTATIVA de chamada (sem prompt/resposta/segredo) | `ai_usage_events` |
| **Budget** | orçamento mensal com moeda (GLOBAL / USE_CASE / PROVIDER) | `ai_budgets` |

xAI, LM Studio, Ollama e "servidor compatível com OpenAI" são **entradas de catálogo** sobre o mesmo adapter de Chat
Completions — provider novo com protocolo conhecido = uma entrada no catálogo; protocolo novo = um adapter novo
registrado em `adapter-registry.ts`. Nenhum `if (provider === …)` fora dos adapters.

### Use Cases (auditados, não inventados)

`INVESTIGATION_PLANNING` (PLANNING/NOTES, exige Tools) · `SEMANTIC_EXTRACTION` · `PATTERN_SYNTHESIS` ·
`OUTCOME_ATTRIBUTION` (as três etapas da análise semântica distinguidas pela tag `stage:*` da classificação) ·
`AGENT_RESPONSE` · `SPECIALIST_RESPONSE` · `ORCHESTRATOR_ROUTING` (exige Tools) · `ORCHESTRATOR_SYNTHESIS` ·
`MANAGERIAL_SYNTHESIS` (pós-JOIN) · `FEEDBACK_ANALYSIS` (análise do motor de feedback) · `FEEDBACK_WRITER` (redação e verificação
do feedback; não roteável de V1.5.1 até 2026-10-08 — ver adendo) · `CHAT` (streaming preferido) · `VOICE_REALTIME` (não
roteável) · `SPEECH_SYNTHESIS` (voz do recado; roteável desde 2026-10-08 — ver adendo) · `MODEL_TEST` (interno). Todo `RoutePurpose` tem mapeamento (teste); propósito desconhecido nunca escolhe policy por palpite.

### Prioridade de resolução

1. **Policy ACTIVE da organização** para o Use Case.
2. **Configuração legada do ambiente** (perfis por tier + `GEMINI_API_KEY`), exatamente como antes.

Não existe "policy de plataforma" no banco na V1 — a configuração do ambiente cumpre esse papel. A migration não insere
nenhuma linha e **nenhum segredo de ambiente é copiado para o banco**: depois do deploy, nenhum modelo muda até o
admin ativar uma policy. Sem runtime registrado (testes unitários, scripts de benchmark), o gateway é byte a byte o
anterior; o runtime só é registrado pelo servidor real (`createApp(pool, { registerAiRuntime: true })`).

A organização da chamada vem da **sessão verificada** (`requireAuth` → `runWithAiOrganization`) ou da matrícula do
Workflow (`engine.ts › processEnrollment`); nunca do corpo/URL. Sem organização no contexto → legado (não existe
"organização padrão").

### Modos de roteamento

- **PINNED** — exatamente um modelo; sem fallback.
- **FALLBACK_CHAIN** — 2–5 modelos em ordem; o próximo só é tentado em erro **elegível e permitido pela policy**.
- **AUTO** — ordenação DETERMINÍSTICA entre os modelos permitidos (até 8): `COST_FIRST` (preço vigente), `LATENCY_FIRST`
  (mediana real de sucesso nos últimos 7 dias, ≥ 3 amostras), `BALANCED` (soma dos postos), `QUALITY_FIRST` (**tier
  declarado pelo admin** — não existe benchmark de qualidade medido, então não há número mágico por vendor). Empate =
  ordem configurada. Nunca um LLM escolhe outro LLM.

Filtros sempre aplicados: conexão/modelo habilitados, provider disponível, tipo GENERATIVE, capacidades exigidas pelo Use
Case **declaradas como suportadas** (ausente = desconhecido = inelegível), janela de contexto, limite de custo por
requisição (só a ENTRADA é estimável antes da chamada — limitação documentada), orçamento com hard limit. Rate limit
nos últimos 60 s empurra o modelo para o fim da fila quando há alternativa.

### Fallback e erros

Categorias normalizadas: `AUTH`, `RATE_LIMIT`, `TIMEOUT`, `NETWORK`, `INVALID_REQUEST`, `MODEL_UNAVAILABLE`,
`CONTEXT_LIMIT`, `PROVIDER_ERROR`, `BUDGET_EXCEEDED`, `ROUTE_UNAVAILABLE`, `UNKNOWN`. Fallback permitido (configurável por
policy): RATE_LIMIT, TIMEOUT, NETWORK, PROVIDER_ERROR, MODEL_UNAVAILABLE; **AUTH só por opt-in explícito**;
INVALID_REQUEST/CONTEXT_LIMIT/UNKNOWN nunca (trocar de provider não resolve). Falhas de validação da INIA (parse,
Evidence Gating) acontecem depois da resposta e nunca viram "falha de provider". Policy sem candidato elegível =
`AI_ROUTE_UNAVAILABLE` com os motivos — **nunca** troca silenciosa para o legado.

**Retry:** os adapters novos não repetem; a única repetição é o fallback da policy (máx. 5 tentativas) — evita "SDK 3× +
router 3× + fallback". O caminho legado mantém o retry que já tinha (1 retry em 503). Tentativas de uma mesma chamada
compartilham o `correlation_id`. (Adendo 2026-10-08: o limitador de chamadas repete a rota inteira em 429/503 — ver abaixo.)

### Uso, custo e orçamento

Um evento por tentativa: Use Case, propósito/fase/origem (RUNTIME/QA_LAB/ADMIN_TEST), provider, conexão, modelo, tokens
**informados** (input/output/reasoning/cached/total — ausente = null, nunca 0), duração, status, categoria de erro, modo,
motivo da rota, fallback. Custo = uso real × preço vigente no instante, em **ponto fixo** (`decimal.ts`, BigInt escala 12;
`numeric` no banco), guardando `pricing_id` → custo histórico reproduzível mesmo depois de um preço novo (que FECHA o
anterior, nunca o sobrescreve). `cost_status`: ESTIMATED | UNKNOWN (sem preço/sem uso) | EXACT (reservado — nenhum
provider V1 informa o valor cobrado). Local: preço zerado = "custo de API 0", custo computacional **não medido** —
nunca "grátis". Moedas nunca são convertidas (não há FX): orçamento só compara gasto da mesma moeda.

Orçamento mensal (fuso da organização) com limiares 70/90/100 (alertas no Sino existente, dedupe por orçamento × mês ×
limiar) e hard limit opcional: chamada paga do escopo é recusada com `AI_BUDGET_EXCEEDED` (e registrada como BLOCKED).
O gasto é lido por uma consulta agregada em cache de 15 s — janela de ultrapassagem documentada.

Adendo (fechamento operacional, 2026-09-22): o uso LEGADO (sem policy) passa a ser precificado pela tabela da
organização quando o mesmo modelo (provider + id) está cadastrado com preço vigente — o hard limit passa a enxergar o
tráfego real que ainda não tem policy. Só contabilidade; a rota não muda. Raciocínio: `reasoningPerMillion` só é
preenchido quando o provider informa o raciocínio FORA da saída (Gemini `thoughtsTokenCount`, cobrado ao preço de
saída). Componentes de preço não modelados (áudio, armazenamento de cache por hora) ficam documentados, nunca somados
em entrada/saída.

### Segurança

- Segredo: AES-256-GCM da Central de Dados (mesma função, mesma chave `DATA_HUB_SECRET_KEY`) em `ai_connection_secrets`;
  substituir revoga o anterior; a API devolve só `configured` + máscara (`••••••••abcd`, últimos 4 só com chave ≥ 16).
  Não existe rota que devolva o valor.
- Logs de erro do provider passam por `redactSecrets` (valor conhecido + padrões de chaves); exceções nunca carregam o
  corpo cru (o gateway também sanitiza o `details.body` dos clientes legados).
- Multi-tenant: toda consulta filtra pela organização da sessão; id de outra organização = 404 sem distinguir.
- Permissões derivadas do sistema existente (papel + escopo): admin GLOBAL da organização = `AI_CONFIG_READ/WRITE`,
  `AI_SECRETS_WRITE`, `AI_USAGE_READ`, `AI_BUDGET_WRITE`; admin de grupo = só leitura. Sem backdoor de plataforma.
- Endpoint: só http(s), sem credencial na URL, sem serviço de metadados de nuvem (169.254.x). `localhost` é o
  **servidor da INIA**, não o computador de quem usa o navegador.
- Auditoria (`audit_logs`, mesmo helper da Central): conexão criada/alterada/habilitada/desabilitada/excluída, segredo
  definido/substituído/removido, cabeçalhos, modelos sincronizados/criados/alterados, preço, rascunho/ativação/desativação
  de policy, orçamento — nunca com o segredo.

### Saúde

HEALTHY / DEGRADED / OFFLINE / UNKNOWN derivados do último teste explícito + telemetria real das últimas 24 h
(`ai-health.ts`). Sem polling.

### Adendo (2026-10-08) — limitador de chamadas: capacidade e prioridade

O gateway passou a ter UM limitador por processo (`model-routing/ai-call-limiter.ts`) na frente da policy e do legado —
não é um roteador paralelo: nada muda na escolha de modelo. Classe INTERATIVA × LOTE derivada do Use Case + contexto
(nó de Workflow = lote; chat/voz, QA Lab e request de pessoa = interativa); vagas reservadas ao chat; em 429/503 o LOTE
espera backoff exponencial com jitter respeitando o Retry-After (com teto) e repete a rota inteira — o fallback da policy
continua acontecendo antes, por dentro da vaga —, e a INTERATIVA tenta no máximo uma vez a mais, rápido, e falha com erro
claro. A regra "a única repetição é o fallback da policy" passa a ser: **o fallback troca de modelo; o limitador espera e
repete a rota inteira só em 429/503**, nunca em credencial/pedido inválido/orçamento e nunca com `transport.retries: 0`. O
evento de uso por tentativa ganhou a classe, a espera e o motivo da fila (migration 121). Detalhes em `docs/dev/ai-providers.md`.

### Adendo (2026-10-08) — Feedback Writer roteável; a policy respeita o que a etapa exige

`FEEDBACK_WRITER` (redação/verificação do motor de feedback, redatores do feedback confiável, narrativas, verificação semântica da
narrativa e o redator por interação) passou a ser roteável: a POC num cliente que só libera OpenAI não gerava feedback sem
`GEMINI_API_KEY`. Sem policy ativa, nada muda — as rotas fixas de sempre, com o mesmo pedido ao cliente Gemini e zero retry onde
a etapa pede. Com policy, UMA policy atende todas as etapas do Use Case.

Junto, corrigiu-se uma lacuna do caminho por policy que valia para todo Use Case: o schema da saída, o teto de saída e o tempo
pedidos pela etapa chegavam só ao legado. Agora chegam ao adapter: schema → `responseSchema` (Google) / `json_schema` não estrito
(OpenAI e compatíveis; Anthropic ignora); teto = o da etapa limitado pelo do modelo cadastrado; tempo = o da etapa como piso,
estendido pelo do modelo/conexão (o admin só estende). O adapter OpenAI manda `max_completion_tokens` à API oficial (modelos de
raciocínio recusam `max_tokens`) e normaliza `finish_reason`. A proveniência dos redatores grava a rota da policy. Detalhes, o que
o adapter não suporta e o levantamento do que continua exigindo Gemini (só a voz) em `docs/dev/ai-providers.md`.

### Adendo (2026-10-08) — Voz do recado roteável (SPEECH_SYNTHESIS)

A voz do recado do avatar e do "Ouvir com a INIA" passou a aceitar policy: o texto exato é lido pelo modelo da policy com a voz e a
instrução de tom cadastradas NO MODELO (`ai_models.metadata.speech` — a voz é do provider, e uma cadeia de fallback pode ter vozes
diferentes). A porta do adapter ganhou `synthesizeSpeech` (opcional; hoje só Chat Completions — `/audio/speech` em PCM 24 kHz) e a
do runtime, `speechIdentityWithPolicy`/`synthesizeSpeechWithPolicy` (opcionais: runtime sem voz = legado). O gateway envolve a
composição de sempre (`createRoutedSpeechSynthesizer`): sem policy, o legado sem nenhuma mudança; com policy, limitador, orçamento,
fallback e uso como qualquer chamada por policy. O cache de áudio por entrega aceita a identidade da rota em vigor
(`speechCacheIdentity`) — trocar voz, modelo, instrução ou policy nunca serve o áudio antigo. A conversa por voz (Gemini Live no
navegador) continua fora do roteamento: com a policy, o recado pode ter voz diferente da conversa. A resposta binária não informa
tokens: custo UNKNOWN.

## Exceções documentadas

- **Voz em tempo real (Gemini Live):** sessão própria no navegador com token efêmero. O gateway aplica o hard limit antes
  de abrir a sessão e registra a sessão iniciada (tokens não informados). Não configurável na V1.
- **Propósito sem mapeamento:** vira o Use Case interno `UNCLASSIFIED` (não roteável) — uso registrado e orçamento global
  aplicado; nunca sai chamada sem evento. Provas estruturais em `model-routing/ai-call-sites.test.ts`.
- **Scripts de benchmark/POC:** não registram o runtime (sem evento de uso) — decisão da V1 para mantê-los byte a byte.
- **Chat sem Orquestrador:** era bypass; agora passa pelo gateway (`createChatStreamer`) — policy CHAT quando existe
  (stream do adapter se o modelo declara STREAMING; senão resposta única), legado caso contrário.

## Futuro — decision provider (JEV / TypeSafe)

Ver `docs/dev/jev-typesafe-checkpoint.md`. Serviço indisponível para novas inscrições; nada implementado. A arquitetura
já permite um provider/capability especializado sem abstração prematura: `AiModelKind` reserva `EMBEDDING`,
`CLASSIFICATION` e `DECISION` (só `GENERATIVE` é roteável), e um protocolo novo entra como adapter novo + entrada de
catálogo + Use Case específico. Qualquer POC futura entra como candidato medido, nunca substitui regra determinística.

## Consequências

- Trocar Gemini → GPT → Grok → local para uma função = configuração da organização; zero mudança em Agent/Workflow.
- Custo por Use Case expõe onde a arquitetura gasta (ex.: extração semântica × síntese de padrões).
- A suíte automática não chama API paga: adapters testados com `fetch` falso; a prova de banco usa um servidor
  compatível com OpenAI em 127.0.0.1 (`testing/fake-openai-compatible-server.ts`, também usado no QA manual via
  `scripts/dev/fake-ai-provider.ts`).

## Limitações V1

Anthropic sem streaming; saída estruturada da Anthropic por instrução; capacidades de modelos OpenAI/compatíveis não
vêm da API (o admin declara); estimativa de custo antes da chamada só da entrada; hard limit com janela de ~15 s;
custo EXACT não disponível; sem FX; sem policy de plataforma no banco; conversa por voz não roteável (a voz do recado é); o cache explícito de prompt
(V1.3) segue só no caminho legado Gemini; sem playground de chat; schema da saída na OpenAI só em modo não estrito (o modelo
recebe o formato, a API não o impõe — o parser da etapa continua decidindo); Azure OpenAI sem entrada própria no catálogo.
