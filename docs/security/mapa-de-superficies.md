# Mapa de superfícies e matriz de cobertura (08/10/2026)

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
