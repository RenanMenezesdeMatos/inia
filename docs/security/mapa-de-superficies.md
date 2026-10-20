# Mapa de superfícies e matriz de cobertura (08/10/2026, segunda rodada em 17/10/2026 — seção 6)

## 1. Arquitetura e fronteiras de confiança

```
Navegador ──HTTPS/HTTP──▶ IIS (ARR, endereço único) ──▶ Interface Next.js 16 (127.0.0.1:3000)
   │                                   └──── /api, /health ──▶ API Express 5 (127.0.0.1:3333) ──▶ PostgreSQL interno
   │                                                                  │
   │                                                                  ├──▶ Bancos externos do cliente (SQL Server, PostgreSQL, MySQL/MariaDB) — só leitura
   │                                                                  ├──▶ APIs HTTP e SFTP do cliente (Central de Dados)
   │                                                                  ├──▶ Provedores de IA (Gemini e conexões cadastradas: OpenAI-compatível, Anthropic, Ollama)
   │                                                                  └──◀ API Push do cliente (token próprio, sem sessão)
   └──WSS──▶ Gemini Live (voz, com token efêmero emitido pela API)
```

| Fronteira | Quem é confiável de cada lado | Controle |
|---|---|---|
| Navegador → API | Nada vindo do navegador: ids, organização, escopo, papel, instruções de IA | Sessão (JWT HS256 em cookie httpOnly, conferida no banco a cada request: conta, pessoa, versão, revogação), permissão + escopo por recurso, guarda de origem (CSRF), limites por IP/conta, zod |
| Organização × organização | Instalação mono-organização; organização sempre da sessão nas rotas revistas | Ver R-01 (constante ainda presente em módulos) |
| Pessoa × pessoa | Colaborador vê o que é dele; líder, a estrutura (reports_to); papéis ampliam por escopo | `loadViewerScope`, `getManageableScopes`, `checkDelegation`, `checkCredentialCustody` |
| API → destinos externos | Configuração feita por administrador de organização | Política de destinos de saída, credencial vinculada ao destino, TLS/host key, limites de tempo e volume |
| Dados de integração → INIA | Nunca confiáveis | Contratos de dados, quarentena, CSV/XLSX com guarda de ZIP, CSV exportado neutralizado |
| Modelo de IA → INIA | Nunca confiável (texto ≠ evidência) | Saída validada por contrato, evidência literal conferida por código, ferramentas só leitura amarradas ao sujeito, renderização sem HTML |
| Interface → navegador | — | CSP, X-Frame-Options, Permissions-Policy, renderização sem HTML cru |

## 2. Entradas

- **HTTP**: 47 routers (`backend/src/modules/*/presentation`), montados em `backend/src/main/app.ts`.
- **Cookies e cabeçalhos**: `inia_session`; `Origin`/`Sec-Fetch-Site` (CSRF); `X-Forwarded-For` (só de proxy confiável);
  `Authorization: Bearer` e `Idempotency-Key` (API Push); `Content-Type`/`Content-Length`.
- **Arquivos**: Base de Conhecimento (PDF, DOCX, TXT, JSON — 15 MB), Central de Dados (CSV/XLSX — 50 MB), fotos e capa do perfil,
  imagens de cenário.
- **Integrações**: respostas HTTP de APIs do cliente, arquivos SFTP, linhas de bancos externos, API Push.
- **IA e voz**: respostas de modelos (texto, JSON estruturado, chamadas de ferramenta), transcrições de voz relatadas pelo
  navegador, áudio sintetizado.
- **Configuração**: `backend/.env`, `frontend/.env.local`, scripts de instalação (`scripts/install`), IIS (`deploy/windows`).

## 3. Saídas

- JSON da API (`Cache-Control: no-store`), páginas da interface (cabeçalhos de segurança).
- Downloads: arquivo original da base (anexo, sandbox), CSV do Diagnóstico, da Monitoria de usabilidade e de rejeições da Central
  (fórmulas neutralizadas), áudio de recados e da apresentação de feedback.
- Logs (pino/console — sem corpo, cookie, senha ou segredo), `audit_logs`, notificações (sino), pendências.
- Chamadas externas: provedores de IA, Gemini Live/TTS, destinos da Central de Dados.

## 4. Processos em segundo plano (`backend/src/main/server.ts`)

| Processo | Frequência | Entrada | Observação de segurança |
|---|---|---|---|
| Motor de Workflow (`workflow-worker`) | contínuo (2 s) | matrículas | Organização da matrícula; destinatário fixo restrito à organização; Agents/Orquestradores validados na publicação |
| Checador de agenda | 1 min | Workflows publicados | Escopo da abrangência do Workflow |
| Projeção de situação funcional | 1 min | dados de pessoas | Sem entrada externa direta |
| Central de Dados (`runDataHubTick`) | 15 s | feeds vencidos, fila, retenção | Política de destinos, guarda de ZIP, limites de volume |
| Reconciliação de calendário e alerta de horizonte | 5 min | escala/presença | Determinístico, sem IA |
| Entrega de feedback de atendimento | contínuo (com a flag) | itens prontos | Idempotente |
| Monitoria de usabilidade | contínuo (com a flag) | eventos de uso | Ator sempre da sessão na ingestão |

## 5. Matriz de cobertura por módulo

Legenda: ✅ revisado sem achado aberto · 🔧 achado corrigido nesta auditoria (ver `relatorio-de-achados.md`) · ⚠️ pendência
(ver `pendencias-e-riscos.md`). O detalhe rota a rota (estado ANTES das correções) está em `anexos/`.

| Módulo / superfície | Rotas e entradas | Autenticação e autorização | Resultado | Testes |
|---|---|---|---|---|
| auth | login, logout, senha do primeiro acesso, `/me` | sessão no banco, trava por e-mail + limite por IP, revogação por `jti`, HS256 fixo, pessoa ativa, nível ao vivo | 🔧 SEC-10, 11, 19, 06 | `http-security.test.ts`, `auth-*.test.ts` |
| access | papéis, atribuições, habilitar, senha temporária, desabilitar | delegação + custódia + estrutura liderada | 🔧 SEC-08 · ⚠️ R-05, R-06 | `access-*-proof.test.ts`, `user-account-router.security.test.ts` |
| users (`/admin/users`) | cadastro, nível, Grupo, e-mail, situação, jornada | `people.manage` + escopo + custódia | 🔧 SEC-06, 07 | `user-account-router*.test.ts` |
| profile-preferences | foto, capa, nome | pessoa da sessão, assinatura de imagem, SVG recusado | ✅ | existentes |
| supervision-cases | lista e detalhe de casos | escopo de analytics ∪ `agents.manage` | 🔧 SEC-01 | `case-router.test.ts` |
| feedbacks | publicar | mesma visibilidade do caso | 🔧 SEC-16 | `scoped-admin-security.test.ts` |
| reporting (operator/supervisor) | Acompanhamento, ficha | escopo de analytics | 🔧 SEC-31 (só publicados) · ⚠️ R-17 | existentes |
| performance-analytics, org-structure (pessoa) | Indicadores, Equipe, Estrutura | `resolveSubject`, escopo | ✅ (nível hierárquico agora ao vivo) | existentes |
| org-structure (admin) | Grupos, Subgrupos, assuntos | `configuration.manage` + escopo | 🔧 SEC-17 | `scoped-admin-security.test.ts` |
| people (calendário) | calendário da equipe, exceções, classificações, calendário operacional | `calendar.manage` + escopo; operacional = organização | 🔧 SEC-31, SEC-17 | existentes + integração |
| pending-actions, notifications | pendências, sino | destinatário da sessão | ✅ | existentes |
| diagnostics | memória do motor, exportação | líder ou `indicators.view` + escopo | 🔧 SEC-30, SEC-31 (período) | existentes |
| knowledge (admin e leitor) | bases, arquivo, prévia, upload | `knowledge.manage` + escopo; leitor pelo alcance | 🔧 SEC-02, 03, 29 | `knowledge-router.security.test.ts`, `zip-guard.test.ts` |
| checkpoint-registry | checkpoints | `knowledge.manage` (governança de organização) | ✅ | existentes |
| agents | CRUD, teste | `agents.manage` + escopo | 🔧 SEC-24, SEC-31 (bases/assuntos) | existentes |
| assistant (orquestradores, conversas monitoradas) | CRUD, leitura de conversas | `agents.manage` + escopo; `assistant_conversations.view` + escopo | ✅ | existentes |
| workflows | CRUD, rascunho, publicação, execuções, resultados, executar agora, prévia de agenda | `workflows.manage` + escopo | 🔧 SEC-25, 26, 31 | paridade + `validate-workflow-for-publish*.test.ts` |
| qa-lab | simulações | `qa_lab.use` de organização | 🔧 SEC-24 (teto) · ⚠️ R-01 | existentes |
| ai-management | provedores, conexões, modelos, roteamento, orçamento, uso | `ai.view`/`ai.manage` de organização para escrita | 🔧 SEC-27, 28 | `ai-providers-proof.test.ts`, `outbound-destination-policy.test.ts` |
| governance, business-domains, channel-flags, indicator-rules, diagnostic-strategy, employee-performance, argument-scripts, call-expectations | catálogos e configurações | `configuration.manage`; escrita de catálogo = organização | 🔧 SEC-17, 18 | `scoped-admin-security.test.ts` |
| inia-scenes | cenário | `inia_experience.manage` de organização | ✅ | existentes |
| data-hub | fontes, feeds, cargas, segredos, tokens, uploads, testes, amostras | `data_hub.manage` de organização | 🔧 SEC-04, 05, 13, 14, 22, 29, 30, 31 · ⚠️ R-03, R-08, R-09, R-10, R-12, R-18 | `secret-binding.test.ts`, `data-hub-proof.test.ts` |
| data-ingestion (API Push) | `POST /:source/:feed` | token de push (hash SHA-256), limite por IP e por token | 🔧 SEC-22 | `http-security.test.ts` |
| ingestion (legada) | medições, interações | `data_hub.manage` de organização | 🔧 SEC-23 | `scoped-admin-security.test.ts` |
| realtime (chat e voz) | sessão de voz, mensagens, ferramentas, turnos de voz, conversas | sessão + dono da conversa; teto por conta | 🔧 SEC-15, 10 · ⚠️ R-04, R-13 | `realtime-router*.test.ts` |
| conversational-delivery | recados (áudio), conversas de Workflow | destinatário da sessão; teto de áudio | ✅ (+ teto) | existentes |
| feedback-application, read-confirmations, feedback-rating, feedback-review/delivery | aplicação de feedback, ciência com senha, avaliações, QA | dono/escopo; ciência serializada | 🔧 SEC-20 | `read-confirmation-proof.test.ts` |
| usage-analytics | ingestão do navegador, painel, exportação | sessão; `usability.*` + escopo | 🔧 SEC-21 | `usability-identified-scope.test.ts` |
| Plataforma HTTP (app.ts) | CORS, CSRF, cabeçalhos, erros, cache, proxy | — | 🔧 SEC-09, 10, 31 | `http-security.test.ts` |
| Interface (Next.js) | páginas, proxy de redirecionamento, renderização | API é a autoridade; renderização sem HTML cru | 🔧 SEC-33 · ⚠️ R-07 | testes da interface + navegador |
| Instalação e implantação | `env-init`, IIS, serviços, `.env.example` | — | 🔧 SEC-12 · ⚠️ R-11 | — |
| Dependências | backend e frontend | — | 🔧 SEC-32 · ⚠️ R-14 | `npm audit` |
| Segredos no repositório | arquivos versionados e histórico | — | ✅ | varredura por padrões |

## 6. Segunda rodada (17/10/2026) — inventário atualizado e cobertura

### O que entrou desde a primeira rodada

- **Módulos novos ou muito alterados**: `interventions` (políticas de acompanhamento, 54 rotas em `/api/v1/interventions` e
  `/api/v1/admin/intervention-policies`, todas atrás de `requireAuth` com a permissão decidida dentro), `reports` (reports
  recorrentes: rotas, agenda e fila no worker), `leadership-analytics` (`/api/v1/leadership` e ferramentas do chat de liderança),
  `data-lifecycle` (retenção — políticas desligadas), pacote de configuração (`backend/scripts/config-transfer`, cliente da API de
  outra instalação), multi-instância (limites, pausa da IA e avisos no PostgreSQL; `/ready`, `/internal/metrics`, `/health` do
  worker), Central de Dados com SQL Server real, submotivo e fechamento oficial com numerador/denominador.
- **Processos em segundo plano novos**: `report-schedule`, `report-runs`, `report-analysis-retry`, `analytics-rollup`,
  `data-retention`, `rate-limit-purge` e — nesta rodada — `login-attempts-purge` (`server.ts`).
- **Entradas novas**: cookie `inia_device` (login), pacote de configuração (`pacote.json`, `arquivos/`, `imagens/`), feeds
  `EMPLOYEES@2`/`INTERACTIONS@2`/`OFFICIAL_INDICATOR_PERFORMANCE@2`, ferramentas do chat de liderança (argumentos do modelo).
- **Rotas HTTP**: ≈ 440 declarações em 57 arquivos de router (`grep -E "\.(get|post|put|patch|delete)\(\"/"`).

### Matriz de cobertura

Legenda como na seção 5. A tabela rota a rota de cada frente está nos anexos (`anexos/rodada-2026-10-17/A1…A4`).

| Módulo / superfície | Revisado | Resultado nesta rodada | Testes de regressão |
|---|---|---|---|
| auth (login, logout, primeiro acesso, `/me`, cookie, JWT, worker de bcrypt) | Todas as rotas e o caminho completo da trava | 🔧 AUTH-1, 2, 3, 12, 14, 15 · ⚠️ R-19, R-20, R-22, R-26, R-33 | `auth-flows`, `known-device`, `password-hasher`, `login-throttle-proof`, `http-security` |
| access (papéis, delegação, custódia, habilitar/desabilitar) | Todas as rotas | ⚠️ AUTH-5 (R-05 ampliado), R-06 | provas existentes |
| users (`/admin/users`) | Todas as rotas | 🔧 AUTH-4, AUTH-6 | `user-account-router.identity`, `account-access-lifecycle-proof` |
| profile-preferences, inia-scenes (imagens) | Upload, validação, entrega | 🔧 AUTH-11, AUTH-17 (teto do perfil) | `image-metadata`, provas existentes |
| Plataforma (`app.ts`, CORS, CSRF, limites, erros, `/ready`, `/internal/metrics`, `trust proxy`) | Completa | 🔧 INFRA-1, AUTH-17 (`/0`) · ⚠️ R-26, R-33 | `http-security` |
| config (`env.ts`) e segredos | Completa | 🔧 AUTH-8 · ⚠️ R-25 | `http-security` |
| Pacote de configuração (`config:exportar/importar`) | Completo | 🔧 AUTH-9, AUTH-10 | `config-transfer.test.ts` |
| supervision-cases, feedbacks, reporting, performance-analytics, org-structure, people (calendários), pending-actions, notifications, diagnostics, feedback-application, ratings, read-confirmations, conversational-delivery, interaction-feedback, usage-analytics, workflow-results, ranking de IA | Todas as rotas (IDOR, listas, contagens, caches, tarefas) | ✅ sem IDOR · ⚠️ R-17 (decisão registrada) | existentes |
| interventions (líder e admin) | Todas as rotas e o serviço | 🔧 SCOPE-02 · ⚠️ R-27 | `condition-resolvers`, `interventions-proof` |
| reports | Rotas, worker e entregas | ✅ escopo recalculado a cada execução · 🔧 SCOPE-04 | `http-security` |
| leadership-analytics (rotas e ferramentas do chat) | Completo | ✅ escopo da sessão · 🔧 AI-01 (consulta de processo), AI-04, DATA-13 (Markdown) | `run-orchestrated-reply`, `management-metrics`, `leadership-tools-v3`, `query-table-markdown` |
| assistant (orquestradores, monitoramento de conversas) | Completo | 🔧 SCOPE-01/AI-03, AI-01 | `conversation-monitoring`, `assistant-conversations-proof` |
| realtime (chat SSE, voz, `/tool-call`, conversas) | Completo | ✅ dono da conversa; R-04 resolvido · 🔧 AI-09 · ⚠️ R-13, R-30 | `realtime-router`, `http-security` |
| agents, knowledge (recuperação, upload, prévia, leitor) | Completo | 🔧 AI-05, AI-07, DATA-1, DATA-13 (nome do arquivo) · ⚠️ R-24 | `agent-knowledge-scope-proof`, `zip-guard`, `pdf-guard`, `run-agent` |
| feedbacks (Orquestrador) e políticas (evidência) | Caminho Output → feedback → política | 🔧 AI-02 | `create-orchestrator-feedback.evidence`, `create-feedback-records` |
| indicator-diagnosis ("Testar diagnóstico") | Rotas | 🔧 AI-06 | `diagnostic-strategy-proof` |
| workflows, qa-lab, investigation, feedback-engine, reliable-feedback | Motor, nós, publicação, revisão humana, tools | ✅ sem `eval`/`vm`; tools só leitura presas ao sujeito; destinatário da configuração | existentes |
| ai-management e gateway de modelos | Adapters, destinos, segredos, limites | ✅ política de destinos, chave em cabeçalho, erro redigido · ⚠️ R-31 | existentes |
| data-hub (41 rotas, API Push, HTTP, SFTP, bancos, segredos, tokens, writers) | Completo, 1.373 interpolações de SQL varridas | 🔧 DATA-1…6, 9, 10, 11, AUTH-7, AUTH-13 · ⚠️ R-03, R-08, R-09, R-28, R-29, R-18 | `secret-binding`, `glob`, `api-pull-volume`, `outbound-destination-policy`, `person-identity-proof`, `data-hub-proof` |
| SQL dinâmico (todo o backend) | Varredura + revisão manual dos casos de risco | ✅ nenhum valor de requisição/integração interpolado; identificadores dos bancos externos citados por dialeto | existentes |
| Interface (Next.js: proxy/CSP, renderização de conteúdo, links) | `rich-content`, `dangerouslySetInnerHTML`, rotas `route.ts`, laboratório do avatar | 🔧 AI-08 · ⚠️ R-07, R-23 | `rich-content`, `follow-up-entry` |
| Instalação (env-init, doctor, Docker, IIS, serviços Windows) | Scripts e `web.config` | 🔧 INFRA-2 (parcial), INFRA-3 · ⚠️ R-32 | sem Windows/PowerShell aqui |
| Dependências | `npm audit` (com e sem dev) e caminho de cada alerta | ⚠️ R-14 atualizado | — |
| Segredos versionados | `git grep` por padrões de chave e histórico de `.env` | ✅ só valores falsos em testes; pacote de configuração da homologação (ignorado pelo git) sem segredos | — |
