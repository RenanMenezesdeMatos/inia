# INIA — diagnóstico e arquitetura evolutiva

Status: proposta arquitetural, sem implementação de código  
Data da análise: 03/09/2026  
Escopo analisado: repositório local `inia`, com foco em reaproveitamento e evolução incremental

## 0. Resumo executivo e premissas

A INIA atual é um protótipo frontend funcional, rico em componentes de operador, supervisor, alertas e feedbacks, mas ainda não é uma plataforma operacional integrada. O melhor caminho não é reescrever: é preservar a experiência e os contratos visuais atuais, substituir gradualmente os mocks por contratos HTTP estáveis e adicionar um backend como **monólito modular** em Node.js/Express/TypeScript. Os motores de alertas, regras, evidências e correlação devem nascer como módulos internos assíncronos, com fronteiras claras, e só virar serviços independentes se volume ou organização justificarem.

A arquitetura alvo trata a INIA como um **Supervisor Digital orientado a casos**, não como chatbot. A unidade central de negócio será o `SupervisionCase`, que percorre a jornada:

`Detecção → Diagnóstico → Evidência → Recomendação → Acompanhamento → Escalonamento/Encerramento`

Premissas e limites desta análise:

- Os requisitos de Miras RQ-M01 a RQ-M09 são a prioridade máxima e estão integralmente contemplados.
- O repositório não contém o texto normativo de RF01–RF32, RN01–RN14 e RT01–RT10. Portanto, não é seguro afirmar cobertura individual nem inventar seu conteúdo. Eles entram no plano como um *gate* obrigatório de rastreabilidade antes do desenvolvimento.
- O diretório `backend/` está vazio e não há schema, migrations ou configuração de banco versionados. “Preservar o banco existente” significa usar migrações somente aditivas e adaptadores, após inventário do banco real. O modelo abaixo é lógico, não autorização para substituir o banco.
- “Chat IA” pode permanecer como interface auxiliar de consulta contextual, mas não é o núcleo do produto e não pode criar decisões sem evidências rastreáveis.

## 1. Diagnóstico da arquitetura atual

### 1.1 Estrutura e stack encontrada

| Área | Estado atual | Avaliação |
|---|---|---|
| Frontend | Next.js 16.2.9, React 19.2.4, TypeScript, Tailwind 4, ShadCN/Radix | Base moderna e reaproveitável |
| Dados remotos | TanStack Query presente | Uso ainda parcial, concentrado em operador |
| Validação | Zod presente | Boa base, mas contratos cobrem somente parte do domínio |
| Formulários | React Hook Form não está instalado | Lacuna frente à stack requerida |
| Backend | Diretório vazio | Não implementado neste repositório |
| Banco | Nenhum schema/migration encontrado | Estrutura real precisa ser inventariada |
| Autenticação | Telas de login/recuperação simuladas | Sem sessão, RBAC ou integração real evidentes |
| Testes | Sem scripts ou suíte de testes | Débito crítico para evolução segura |
| CI/CD e observabilidade | Não encontrados | Lacuna operacional |

Rotas existentes:

- `/auth/login`
- `/auth/forgot-password`
- `/` (home autenticada simulada)
- `/operator`
- `/supervisor`

O frontend possui cerca de 13 mil linhas em `.ts/.tsx`. O lint atual retorna 10 erros e 6 avisos, principalmente atualizações síncronas de estado dentro de efeitos, dependências de hooks, imagens não otimizadas e compatibilidade com React Compiler. O build foi bloqueado pela indisponibilidade de rede ao buscar a fonte Geist; não foi identificado erro de tipo antes desse bloqueio.

### 1.2 Arquitetura frontend observada

O desenho atual segue, informalmente:

`App Router → componentes de página → services → mocks → Zod`

Pontos positivos:

- `src/services/operator` já cria uma fronteira substituível entre UI e fonte de dados.
- `src/schemas/operator` e `src/schemas/app` validam payloads em runtime.
- `src/queries/operator` já estabelece query keys e hooks do TanStack Query.
- O App Router separa layouts autenticados e de autenticação.
- O shell autenticado, sistema de alertas, acessibilidade, tema e biblioteca `ui` são ativos reaproveitáveis.
- As telas de operador já expressam indicadores, PRV, recomendações, histórico e feedback narrado.
- As telas de supervisor já expressam priorização, criticidade, reincidência, evidências, histórico, visão por equipe e recomendação.

Fragilidades:

- Existem duas implementações de supervisor (`components/supervisor` e `components/supervisor-v2`) com modelos incompatíveis e duplicação funcional.
- Supervisor consome mock diretamente, sem `service`, Zod, query keys ou hooks.
- Home e alertas também acessam mocks diretamente em alguns fluxos.
- Tipos de domínio vivem dentro de componentes (`supervisor-types.ts`, `supervisor-v2/types.ts`) e estão acoplados à apresentação.
- O mesmo conceito possui vocabulários divergentes: `high/medium/info`, `P1/P2/P3`, `attention/warning/critical`, além de ações em strings livres.
- Vários valores são formatados na origem (`"6m21s"`, `"84%"`), dificultando cálculo, comparação e internacionalização.
- Datas relativas e relógio-base estão fixos em mocks.
- Ações de UI não representam comandos persistentes, auditoria ou máquina de estados.
- Não há fronteira explícita entre dados brutos, fatos derivados por regra e conteúdo gerado por IA.

### 1.3 Componentes que devem ser preservados

| Ativo atual | Reuso recomendado |
|---|---|
| `components/ui/*` | Design system base para todos os módulos |
| `AuthenticatedAppShell`, top bar e menu | Shell comum com navegação por perfil e RBAC |
| Central/popover de alertas | Evoluir para caixa de entrada real, leitura, filtros e deep links |
| Dashboard do operador | Manter layout; trocar DTOs de mock por BFF/API progressivamente |
| Cards de indicador e PRV | Reusar com valores numéricos + formatter na UI |
| Feedback card, mensagens e player | Reusar como apresentação de feedback estruturado e acessível |
| `supervisor-v2` | Eleger como composição visual canônica após validação de produto |
| Tabela, board e painel do operador no supervisor | Reusar para fila priorizada e detalhe de caso |
| Versão anterior de supervisor | Migrar recursos exclusivos e descontinuar somente após paridade comprovada |
| Zod schemas | Mover gradualmente para pacote/área de contratos compartilhados |
| Services e query keys de operador | Replicar padrão por módulo, sem alterar consumidores de uma vez |
| Accessibility e Theme providers | Preservar integralmente |
| Mocks | Transformar em fixtures de testes, Storybook e biblioteca de casos simulados |

### 1.4 Débitos técnicos priorizados

| Prioridade | Débito | Impacto | Tratamento incremental |
|---|---|---|---|
| P0 | Ausência de especificação RF/RN/RT versionada | Risco de produto e aceite | Importar catálogo e criar matriz de rastreabilidade |
| P0 | Backend e persistência ausentes no repo | Produto não operacional | Criar monólito modular e substituir mocks rota a rota |
| P0 | Sem autenticação/RBAC/auditoria | Risco de segurança e LGPD | Sessão real, escopo por operação/equipe e audit log |
| P0 | Feedback sem contrato obrigatório de evidência | Viola Miras | Tornar evidência e procedimento invariantes de domínio |
| P1 | Dois supervisores e tipos duplicados | Divergência e manutenção cara | Canonicalizar DTOs; migração por adaptadores |
| P1 | Sem testes | Alto risco de regressão | Contract, unit, integration e E2E desde a Fase 1 |
| P1 | Lint quebrado | Reduz segurança de mudança | Corrigir baseline antes de novas features |
| P1 | Dados formatados e enums dispersos | Bloqueia análises confiáveis | Normalizar unidades e taxonomias no backend |
| P1 | IA sem governança/versionamento | Baixa explicabilidade | Prompt/model run versionados, avaliação e aprovação |
| P2 | README genérico e sem ADRs | Onboarding fraco | Documentar setup, domínio e decisões |
| P2 | Artefatos temporários (`apagar`, zip, `.DS_Store`) | Ruído e risco de fonte duplicada | Inventariar e remover em mudança separada e aprovada |

### 1.5 Lacunas contra Miras

| Requisito | Sinal presente | Lacuna para produção |
|---|---|---|
| M01 causa operacional | Textos simulam diagnósticos | Sem motor, causalidade, confiança ou vínculo a procedimento |
| M02 evidências | Supervisor v2 possui `evidences` | Evidências genéricas; contrato não as torna obrigatórias |
| M03 correlação | UI combina indicadores/histórico | Sem modelo temporal/correlacional ou provenance |
| M04 conhecimento | Alertas simulam comunicados | Sem ingestão, versionamento, busca e citação de trechos |
| M05 proatividade | Alertas e prioridades existem visualmente | Sem scheduler/eventos, regras, deduplicação e SLA |
| M06 evolução | Tendência aparece na UI | Sem séries históricas dia/semana/mês e baseline |
| M07 desenvolvimento | Ações sugeridas em strings | Sem plano, tarefas, conteúdo, prazo, dono e eficácia |
| M08 jornada completa | Fragmentos de alerta/feedback/escalonamento | Sem entidade de caso e máquina de estados ponta a ponta |
| M09 simulação | Mocks ricos podem virar sementes | Sem sandbox, cenários versionados, execução e critérios de sucesso |

## 2. Arquitetura alvo

### 2.1 Decisão principal

Adotar um **monólito modular orientado a domínio**, com API Express e worker no mesmo repositório e módulos independentes no código. Isso reduz complexidade operacional no estágio atual, preserva transações e permite extração futura de motores com base em métricas reais.

```text
Next.js (BFF/UI)
  ├─ Dashboards por perfil
  ├─ Central de casos, feedbacks e alertas
  └─ Administração e conhecimento
          │ REST/SSE
Express API ─────────────────────────────────────────────┐
  ├─ Identity & Access                                   │
  ├─ Operations / People / Indicators                    │
  ├─ Interactions / Quality Monitoring                    │
  ├─ Knowledge                                            │
  ├─ Supervision Cases (orquestrador da jornada)          │
  ├─ Evidence / Correlation / Rules                       │
  ├─ Feedback / Development Plans / Escalation            │
  ├─ Alerts / Notifications                               │
  ├─ Prompt & AI Governance                               │
  └─ Simulation                                           │
          │ transação + outbox                            │
Banco existente + extensões aditivas ── Outbox ── Worker ┘
          │                                  │
          ├─ Object storage (áudio/documentos)
          ├─ Busca textual/vetorial, se suportada
          └─ Provedor de IA via interface substituível
```

### 2.2 Princípios obrigatórios

1. **Evidence-first:** nenhuma recomendação acionável ou feedback pode ser publicado sem indicador, evidência, comportamento, procedimento e recomendação.
2. **IA propõe; domínio valida:** LLM gera hipótese e texto, mas regras determinísticas validam schema, escopo, citações, confiança e permissões.
3. **Proveniência total:** cada conclusão aponta para fatos imutáveis, versões de procedimentos e execução do modelo/regra que a originou.
4. **Human-in-the-loop por risco:** baixa confiança ou alto impacto exige revisão; automação depende de política configurável.
5. **Temporalidade explícita:** fatos carregam janela, timezone, fonte e instante de ingestão.
6. **Idempotência e deduplicação:** ingestão, detecção e alertas precisam resistir a reprocessamento.
7. **Segregação por organização/operação/equipe:** aplicada no repositório e testada, nunca somente na UI.
8. **Compatibilidade progressiva:** DTOs v1 preservam as telas; adaptadores convertem o modelo novo durante a migração.

### 2.3 Módulos e responsabilidades

| Módulo | Responsabilidade | Reaproveitamento |
|---|---|---|
| Identity & Access | Usuários, papéis, escopos, sessão | Telas de auth e shell |
| Operations | Organizações, operações, equipes, operadores | Filtros e perfis existentes |
| Indicators | Catálogo, metas, medições, agregações e tendência | Cards, KPIs e PRV |
| Interactions | Chamadas, canais, transcrição, segmentos | Feedback e monitoria existentes |
| Quality Monitoring | Formulários, avaliações, achados | Eventos `monitoria_*` dos mocks |
| Knowledge | Documentos, versões, trechos, regras e busca | Comunicados atuais viram conteúdo versionado |
| Rules | Regras versionadas, condições e resultados | Classificações/prioridades hoje hardcoded |
| Evidence | Fatos normalizados e pacotes de evidência | Painel de evidências do supervisor v2 |
| Correlation | Hipóteses causais, vínculos e confiança | Resumos INIA existentes como apresentação |
| Supervision Cases | Jornada e estado do caso | Une alertas, feedbacks, histórico e escalonamento |
| Feedback | Rascunho, revisão, publicação, ciência e eficácia | Central/card/player atuais |
| Development | Planos, ações, conteúdos e checkpoints | `recommendedAction` atual |
| Alerts | Detecção proativa, inbox, SLA, leitura e resolução | Central de alertas atual |
| Escalation | Políticas, níveis, destinatários e decisões | Status existentes |
| AI Governance | Prompts, modelos, execuções, avaliações e guardrails | Novo, necessário para operação segura |
| Simulation | Cenários, datasets fictícios, execuções e score | Mocks atuais como fixtures iniciais |
| Reporting | Visões operador/supervisor/gerente | Dashboards atuais + novo gerente |
| Audit | Trilha imutável das mudanças sensíveis | Novo e transversal |

### 2.4 Eventos internos mínimos

`IndicatorMeasurementRecorded`, `GoalRiskDetected`, `InteractionTranscribed`, `MonitoringCompleted`, `KnowledgeVersionPublished`, `DeviationDetected`, `EvidenceBundleBuilt`, `RootCauseHypothesisCreated`, `SupervisionCaseOpened`, `FeedbackPublished`, `FeedbackAcknowledged`, `CheckpointDue`, `NoEvolutionDetected`, `CaseEscalated`, `RelevantImprovementDetected`.

Começar com outbox no banco e worker com filas lógicas. Um broker externo só deve ser introduzido quando throughput, retries ou isolamento justificarem.

## 3. Estrutura completa de pastas proposta

Estrutura alvo incremental; pastas atuais permanecem enquanto cada feature migra:

```text
inia/
├── docs/
│   ├── architecture/
│   │   ├── adr/
│   │   ├── context.md
│   │   └── traceability.md
│   ├── api/openapi.yaml
│   └── requirements/{miras,rf,rn,rt}.md
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/
│   │   │   └── (app)/
│   │   │       ├── operator/
│   │   │       ├── supervisor/
│   │   │       ├── manager/
│   │   │       ├── cases/
│   │   │       ├── feedbacks/
│   │   │       ├── alerts/
│   │   │       ├── monitoring/
│   │   │       ├── knowledge/
│   │   │       ├── simulations/
│   │   │       └── admin/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── dashboards/
│   │   │   ├── indicators/
│   │   │   ├── supervision-cases/
│   │   │   ├── alerts/
│   │   │   ├── evidence/
│   │   │   ├── feedbacks/
│   │   │   ├── development-plans/
│   │   │   ├── monitoring/
│   │   │   ├── interactions/
│   │   │   ├── knowledge/
│   │   │   ├── escalations/
│   │   │   ├── prompts/
│   │   │   └── simulations/
│   │   │       ├── api/
│   │   │       ├── components/
│   │   │       ├── hooks/
│   │   │       ├── schemas/
│   │   │       └── mappers/
│   │   ├── components/{ui,layout}/
│   │   ├── contracts/          # gerados de OpenAPI ou pacote compartilhado
│   │   ├── lib/{api,query,auth,formatting,accessibility}/
│   │   └── mocks/              # somente dev/test; derivados dos atuais
│   └── tests/{unit,integration,e2e}/
├── backend/
│   ├── src/
│   │   ├── main/{server.ts,worker.ts,container.ts}
│   │   ├── shared/
│   │   │   ├── domain/{entity,value-object,domain-event}/
│   │   │   ├── application/{use-case,ports}/
│   │   │   └── infrastructure/{db,http,queue,ai,storage,telemetry}/
│   │   ├── modules/
│   │   │   ├── identity-access/
│   │   │   ├── operations/
│   │   │   ├── indicators/
│   │   │   ├── interactions/
│   │   │   ├── quality-monitoring/
│   │   │   ├── knowledge/
│   │   │   ├── rules/
│   │   │   ├── evidence/
│   │   │   ├── correlation/
│   │   │   ├── supervision-cases/
│   │   │   ├── feedbacks/
│   │   │   ├── development/
│   │   │   ├── alerts/
│   │   │   ├── escalation/
│   │   │   ├── ai-governance/
│   │   │   ├── simulation/
│   │   │   ├── reporting/
│   │   │   └── audit/
│   │   │       ├── domain/
│   │   │       ├── application/
│   │   │       ├── infrastructure/
│   │   │       └── presentation/http/
│   │   └── contracts/
│   ├── migrations/
│   └── tests/{unit,integration,contract}/
├── packages/
│   ├── contracts/              # opcional; schemas sem dependência de UI/DB
│   ├── eslint-config/
│   └── tsconfig/
└── infra/{docker,observability}/
```

Regra de dependência no backend: `presentation → application → domain`; `infrastructure` implementa portas, nunca o contrário. Módulos acessam outros módulos por casos de uso públicos ou eventos, não por tabelas/repositórios privados.

## 4. Modelo de entidades

### 4.1 Núcleo organizacional

- `Organization`: tenant, políticas e configurações.
- `Operation`: produto/canal, timezone, calendários e regras aplicáveis.
- `Team`: pertence a uma operação e possui liderança temporal.
- `User`: identidade autenticável.
- `PersonProfile`: dados funcionais do operador/supervisor/gerente.
- `RoleAssignment`: papel + escopo + vigência; suporta RBAC por operação/equipe.

### 4.2 Desempenho e interações

- `IndicatorDefinition`: código, nome, unidade, direção desejada, fórmula e fonte.
- `Goal`: indicador, escopo, valor, janela e vigência.
- `IndicatorMeasurement`: valor numérico, granularidade, período, fonte e qualidade.
- `Interaction`: atendimento, canal, operador, cliente pseudonimizado, tempos e motivo.
- `Transcript`: versão, idioma, confiança e status.
- `TranscriptSegment`: intervalo, falante, texto e metadados.
- `MonitoringForm` / `MonitoringCriterion`: instrumento versionado.
- `MonitoringEvaluation` / `MonitoringFinding`: resultado e achado com referência à interação.

### 4.3 Conhecimento e regras

- `KnowledgeDocument`: identidade lógica, tipo (procedimento/manual/FAQ/regra/fluxo).
- `KnowledgeVersion`: conteúdo imutável, vigência, status de aprovação e hash.
- `KnowledgeChunk`: trecho endereçável para busca e citação.
- `RuleDefinition`: condição/ação versionada, prioridade e vigência.
- `RuleExecution`: entrada, resultado, versão e duração.
- `PromptTemplate`: finalidade, versão, schema de saída e política de aprovação.
- `AiRun`: modelo, prompt versionado, parâmetros, entradas referenciadas, saída, tokens, custo, latência e avaliação.

### 4.4 Supervisão digital

- `Deviation`: desvio detectado, indicador, severidade, janela e fonte.
- `Evidence`: fato atômico imutável; tipo, referência de origem, trecho/valor e instante.
- `EvidenceBundle`: pacote validado para uma conclusão; inclui evidências e citações.
- `Correlation`: relação entre fatos, método, direção, força e janela.
- `RootCauseHypothesis`: causa proposta, confiança, alternativas e procedimento associado.
- `SupervisionCase`: agregado central; sujeito, prioridade, estado, SLA, dono e motivo.
- `CaseTimelineEvent`: histórico imutável de transições e intervenções.
- `Recommendation`: ação estruturada, racional, impacto esperado e prazo.
- `Feedback`: conteúdo estruturado, estado, audiência, revisão, publicação e ciência.
- `DevelopmentPlan`: objetivo, período, responsável e status.
- `DevelopmentAction`: treinamento/conteúdo/reciclagem/coaching/checkpoint, prazo e evidência de conclusão.
- `FollowUpCheckpoint`: janela de comparação, resultado esperado e medido.
- `Escalation`: nível, política acionada, motivo, destino, status e resolução.
- `Alert`: evento proativo, severidade, dedupe key, destinatário, SLA e deep link.

### 4.5 Simulação

- `SimulationScenario`: cenário versionado, persona, contexto, objetivos e dados fictícios.
- `SimulationDataset`: indicadores, transcrições, monitorias e conhecimento isolados da produção.
- `SimulationRun`: execução contra versões específicas de regras/prompts.
- `SimulationExpectation`: causa/evidência/recomendação/estado esperados.
- `SimulationResult`: saída, score, diferenças e aprovação.

### 4.6 Invariantes de domínio

- `Feedback.publish()` falha se faltar qualquer item de M02.
- Evidência sempre referencia fonte existente, checksum e instante; texto gerado por IA não é evidência.
- Procedimento citado deve apontar para `KnowledgeVersion` vigente na data do fato.
- Caso só chega a `DIAGNOSED` com hipótese de causa e pacote de evidências validados.
- Toda transição de caso gera timeline e audit log.
- Escalonamento automático exige política versionada, idempotency key e justificativa.
- Dados simulados carregam `environment=SIMULATION` e jamais podem alimentar métricas produtivas.

## 5. Modelo de banco lógico

Sem acesso ao banco real, recomenda-se mapear as entidades acima sobre tabelas existentes por meio de repositórios/adaptadores e criar apenas estruturas faltantes. Convenções sugeridas: UUID, `organization_id`, `created_at`, `updated_at`, `version` para optimistic locking e timestamps em UTC.

Grupos de tabelas aditivas:

```text
iam:        organizations, operations, teams, users, person_profiles, role_assignments
metrics:    indicator_definitions, goals, indicator_measurements
calls:      interactions, transcripts, transcript_segments
quality:    monitoring_forms, monitoring_criteria, monitoring_evaluations, monitoring_findings
knowledge:  knowledge_documents, knowledge_versions, knowledge_chunks
rules_ai:   rule_definitions, rule_executions, prompt_templates, ai_runs
supervision:deviations, evidences, evidence_bundles, evidence_bundle_items,
            correlations, root_cause_hypotheses, supervision_cases,
            case_timeline_events, recommendations
action:     feedbacks, feedback_evidence_items, development_plans,
            development_actions, follow_up_checkpoints, escalations, alerts
simulation: simulation_scenarios, simulation_datasets, simulation_runs,
            simulation_expectations, simulation_results
platform:   outbox_events, idempotency_keys, audit_logs
```

Relacionamentos críticos:

- `supervision_case 1—N deviation`, `1—N recommendation`, `1—N feedback`, `1—N checkpoint`, `1—N escalation`.
- `evidence_bundle N—N evidence` por `evidence_bundle_items`.
- `root_cause_hypothesis N—1 evidence_bundle` e `N—1 knowledge_version`.
- `feedback N—N evidence` e `N—1 recommendation`; o snapshot publicado deve ser imutável.
- `indicator_measurements` deve ter unicidade por tenant + indicador + sujeito + período + fonte.
- `alert` deve ter unicidade lógica pela `dedupe_key` durante a janela configurada.

Índices prioritários:

- medições por `(organization_id, subject_type, subject_id, indicator_definition_id, period_start desc)`;
- casos por `(organization_id, assignee_id, status, priority, sla_due_at)`;
- alertas por `(recipient_id, status, created_at desc)` e `dedupe_key`;
- interações por operador, início e motivo;
- chunks de conhecimento por documento/versão; índice textual e vetorial somente se suportado;
- timeline/audit por agregado e data.

Retenção e privacidade:

- separar PII de fatos analíticos; pseudonimizar cliente em datasets analíticos;
- criptografia em trânsito e repouso, URLs assinadas para mídia e redaction de transcrições;
- políticas de retenção por tipo de dado e tenant;
- proibir conteúdo sensível em logs/prompts sem mascaramento;
- registrar acesso a transcrição, áudio, feedback e exportações.

## 6. Endpoints REST v1

Prefixo: `/api/v1`. Listagens usam cursor, `limit`, filtros e ordenação; comandos aceitam `Idempotency-Key`; erros seguem um envelope estável com `code`, `message`, `details` e `traceId`.

### 6.1 Sessão, pessoas e dashboards

```text
POST   /auth/sessions
DELETE /auth/sessions/current
GET    /me
GET    /operations
GET    /teams?operationId=
GET    /operators?teamId=&status=
GET    /dashboards/operator/:operatorId?period=
GET    /dashboards/supervisor?teamIds=&period=
GET    /dashboards/manager?operationIds=&period=
```

Os três endpoints de dashboard funcionam inicialmente como BFF/DTOs compatíveis com as telas atuais, compostos pelos módulos de domínio.

### 6.2 Indicadores, interações e monitoria

```text
GET/POST        /indicator-definitions
GET/PATCH       /indicator-definitions/:id
GET/POST        /goals
POST            /indicator-measurements:batch
GET             /operators/:id/indicator-series?indicatorId=&granularity=day|week|month
POST/GET        /interactions
GET             /interactions/:id
POST            /interactions/:id/transcripts
GET             /interactions/:id/transcript
POST/GET        /monitoring-evaluations
GET             /monitoring-evaluations/:id
```

### 6.3 Conhecimento, regras e IA

```text
GET/POST        /knowledge/documents
GET/PATCH       /knowledge/documents/:id
POST            /knowledge/documents/:id/versions
POST            /knowledge/versions/:id:publish
GET             /knowledge/search?q=&effectiveAt=&operationId=
GET/POST        /rules
GET/PATCH       /rules/:id
POST            /rules/:id:test
GET/POST        /prompts
POST            /prompts/:id/versions
POST            /prompts/versions/:id:evaluate
GET             /ai-runs/:id
```

### 6.4 Casos, evidências e correlação

```text
GET/POST        /supervision-cases
GET/PATCH       /supervision-cases/:id
GET             /supervision-cases/:id/timeline
POST            /supervision-cases/:id:diagnose
POST            /supervision-cases/:id:assign
POST            /supervision-cases/:id:transition
GET             /supervision-cases/:id/evidence-bundle
POST            /supervision-cases/:id/evidences
POST            /supervision-cases/:id:correlate
GET             /operators/:id/evolution?from=&to=&granularity=
```

### 6.5 Feedback, desenvolvimento, alertas e escalonamento

```text
GET/POST        /feedbacks
GET/PATCH       /feedbacks/:id
POST            /feedbacks/:id:submit-review
POST            /feedbacks/:id:approve
POST            /feedbacks/:id:publish
POST            /feedbacks/:id:acknowledge
GET/POST        /development-plans
GET/PATCH       /development-plans/:id
POST            /development-plans/:id/actions
POST            /development-actions/:id:complete
POST            /supervision-cases/:id/checkpoints
GET             /alerts?status=&severity=&type=
POST            /alerts/:id:read
POST            /alerts/:id:resolve
POST            /supervision-cases/:id:escalate
POST            /escalations/:id:resolve
GET             /events/stream
```

### 6.6 Simulação e auditoria

```text
GET/POST        /simulations/scenarios
GET/PATCH       /simulations/scenarios/:id
POST            /simulations/scenarios/:id/runs
GET             /simulations/runs/:id
GET             /simulations/runs/:id/results
POST            /simulations/runs/:id:approve
GET             /audit-logs?entityType=&entityId=&actorId=
```

## 7. Hooks do TanStack Query

Manter o padrão atual de query factories e estendê-lo por feature. Hooks propostos:

```text
Sessão:       useMeQuery, useOperationsQuery, useTeamsQuery, useOperatorsQuery
Dashboards:   useOperatorDashboardQuery, useSupervisorDashboardQuery,
              useManagerDashboardQuery
Indicadores:  useIndicatorDefinitionsQuery, useIndicatorSeriesQuery,
              useGoalsQuery, useUpsertGoalMutation
Casos:        useSupervisionCasesQuery, useSupervisionCaseQuery,
              useCaseTimelineQuery, useDiagnoseCaseMutation,
              useAssignCaseMutation, useTransitionCaseMutation
Evidências:   useEvidenceBundleQuery, useAddEvidenceMutation,
              useCorrelateCaseMutation
Feedbacks:    useFeedbacksQuery, useFeedbackQuery, useCreateFeedbackMutation,
              useSubmitFeedbackMutation, useApproveFeedbackMutation,
              usePublishFeedbackMutation, useAcknowledgeFeedbackMutation
Desenvolv.:   useDevelopmentPlanQuery, useCreatePlanMutation,
              useCompleteDevelopmentActionMutation
Alertas:      useAlertsQuery, useMarkAlertReadMutation,
              useResolveAlertMutation, useAlertStream
Interações:   useInteractionsQuery, useInteractionQuery,
              useTranscriptQuery, useMonitoringEvaluationQuery
Conhecimento: useKnowledgeDocumentsQuery, useKnowledgeSearchQuery,
              useCreateKnowledgeVersionMutation, usePublishKnowledgeMutation
Admin/IA:     useRulesQuery, useTestRuleMutation, usePromptsQuery,
              useEvaluatePromptMutation, useAiRunQuery
Simulação:    useSimulationScenariosQuery, useSimulationRunQuery,
              useStartSimulationMutation, useApproveSimulationMutation
```

Convenções:

- Query keys devem incluir tenant/escopo, filtros e versão do contrato.
- Mutations invalidam somente agregados afetados; atualizações simples usam optimistic update com rollback.
- SSE atualiza cache de alertas/casos e não substitui refetch periódico de reconciliação.
- Zod valida payloads na borda até que contratos gerados eliminem duplicação.
- Erros preservam `traceId`; telas distinguem vazio, carregando, stale, erro e acesso negado.
- Os hooks atuais de operador continuam válidos; internamente, os services passam de mock para HTTP por feature flag.

## 8. Fluxos de negócio

### 8.1 Jornada principal Miras (M01–M08)

1. Conectores registram indicadores, interações, transcrições e monitorias de forma idempotente.
2. O motor de regras avalia metas, tendência, recorrência, melhoria e criticidade.
3. Um desvio relevante abre ou atualiza um `SupervisionCase`; deduplicação evita casos paralelos para o mesmo fenômeno/janela.
4. O motor de evidências reúne fatos do indicador, trechos de transcrição, achados de monitoria, feedbacks anteriores e versões vigentes do conhecimento.
5. O motor de correlação avalia sequência temporal e coocorrência, produz hipóteses com confiança e alternativas; correlação não é rotulada automaticamente como causalidade sem critério configurado.
6. A IA redige diagnóstico e recomendação em schema estruturado. Guardrails rejeitam saída sem os cinco itens de M02, sem citação válida ou com informação não suportada.
7. A política decide entre publicação automática, revisão do supervisor ou bloqueio por baixa confiança/alto risco.
8. O feedback publicado cria ciência do operador e, quando aplicável, um plano de desenvolvimento com ação, conteúdo, dono, prazo e checkpoint.
9. No checkpoint, novas medições são comparadas com baseline diário, semanal, mensal e histórico.
10. Evolução fecha ou reduz prioridade; estabilidade mantém acompanhamento; regressão/reincidência recalcula prioridade e pode escalar.

### 8.2 Alertas proativos (M05)

- Entrada: evento novo ou varredura agendada.
- Regra: limiar + tendência + janela + contexto + supressão.
- Deduplicação: `tenant+sujeito+tipo+regra+janela`.
- Priorização: severidade, impacto, urgência, confiança, reincidência e prazo de meta.
- Saída: alerta com explicação, evidências, ação, dono, SLA e link para caso.
- Ciclo: `OPEN → SEEN → ACKNOWLEDGED → RESOLVED | EXPIRED`, sempre auditado.

### 8.3 Plano de desenvolvimento (M07)

- Recomendação aprovada sugere ações do catálogo, nunca apenas texto livre.
- Supervisor ajusta dono, prazo e conteúdo; operador recebe e confirma ciência.
- A conclusão exige evidência (presença, leitura, avaliação ou registro de coaching).
- Checkpoint mede indicadores-alvo contra baseline e registra eficácia.
- Ações ineficazes alimentam nova hipótese, não repetição cega do mesmo feedback.

### 8.4 Casos simulados (M09)

- Autor cria cenário exclusivamente fictício e define entradas + resultados esperados.
- Execução congela versões de regra, conhecimento e prompt.
- Pipeline normal roda com `environment=SIMULATION`, isolado de alertas e KPIs reais.
- Resultado pontua detecção, causa, cobertura de evidência, procedimento, recomendação e transição esperada.
- Versão só é promovida após critérios mínimos e aprovação; resultado fica reproduzível.

### 8.5 Escalonamento

- Gatilhos: gravidade, risco regulatório, reincidência, ausência de evolução, SLA vencido ou confiança abaixo do permitido.
- Política resolve nível, destinatário, prazo e necessidade de aprovação.
- Escalonamento carrega snapshot do caso e evidências, nunca somente um resumo gerado.
- Resolução registra decisão, responsável e próximos checkpoints.

## 9. Mapa de telas

| Área/rota | Perfil | Situação | Evolução proposta |
|---|---|---|---|
| `/` | Todos | Existente | Home por perfil com leituras diárias e ações pendentes |
| `/operator` | Operador | Existente | Preservar; adicionar evolução, ciência e plano ativo |
| `/operator/feedbacks/:id` | Operador | Nova | Feedback estruturado, evidências permitidas e ciência |
| `/operator/development` | Operador | Nova | Plano, conteúdo, prazos e checkpoints |
| `/supervisor` | Supervisor | Existente em duas versões | Canonicalizar v2 e incorporar lacunas da anterior |
| `/supervisor/cases` | Supervisor | Nova | Fila priorizada com SLA, confiança e estado |
| `/supervisor/cases/:id` | Supervisor | Nova | Jornada completa, timeline, causa, evidências e ações |
| `/supervisor/feedbacks` | Supervisor | Nova | Rascunhos, revisão, aprovação e publicados |
| `/manager` | Gerente | Nova | Risco por operação, tendência, causas e eficácia das ações |
| `/manager/escalations` | Gerente | Nova | Casos escalados, SLA e decisão executiva |
| `/alerts` | Todos por escopo | Dialog existente | Tornar rota endereçável e manter popover/dialog |
| `/monitoring` | Qualidade/Supervisor | Nova | Fila e resultados de monitoria IA |
| `/interactions/:id` | Autorizados | Nova | Áudio, transcrição, achados e evidências correlacionadas |
| `/knowledge` | Especialista/Admin | Nova | Busca e catálogo de procedimentos/FAQs/manuais |
| `/knowledge/:id` | Especialista/Admin | Nova | Versionamento, vigência, aprovação e impacto |
| `/simulations` | QA/Produto/Admin | Nova | Biblioteca de casos e regressões |
| `/simulations/:id` | QA/Produto/Admin | Nova | Editor, execução, comparação e aprovação |
| `/admin/rules` | Admin | Nova | Regras, prioridades, teste e vigência |
| `/admin/prompts` | Admin IA | Nova | Versões, avaliações, rollout e rollback |
| `/admin/indicators` | Admin | Nova | Catálogo, unidades, metas e fontes |
| `/admin/access` | Admin | Nova | Papéis e escopos |
| `/admin/audit` | Auditor/Admin | Nova | Trilha de ações sensíveis |

Navegação deve ser construída por capacidades (`canViewTeam`, `canApproveFeedback`, etc.), não por comparação direta de nomes de perfil.

## 10. Plano de implementação por fases

Cada fase deve entregar um incremento utilizável atrás de feature flags, sem remover fluxos antigos antes de paridade, telemetria e aceite.

### Pré-fase — baseline e rastreabilidade (obrigatória)

- Versionar o texto integral de RF01–RF32, RN01–RN14 e RT01–RT10.
- Criar matriz `Requisito → capacidade → entidade → endpoint → tela → teste → fase`.
- Inventariar banco, integrações, identidade, volumes, SLAs, LGPD e ambiente.
- Registrar ADRs: monólito modular, estratégia de eventos, contrato API e política de IA.
- Corrigir lint, adicionar testes de fumaça E2E e CI sem alterar comportamento.
- Eleger supervisor v2 como candidato canônico e documentar paridade com a versão anterior.

**Gate:** 100% dos requisitos oficiais classificados; banco real mapeado; baseline verde ou débitos formalmente aceitos.

### Fase 1 — MVP

Objetivo: retirar o produto do modo exclusivamente mockado preservando as telas.

- Backend base, sessão/RBAC, tenant/operação/equipe e audit log.
- Read APIs/BFF para operador, supervisor, home e alertas com DTOs compatíveis.
- Indicadores, metas, medições, histórico e alertas determinísticos básicos.
- `SupervisionCase` mínimo e timeline.
- Feedback estruturado com validação dos cinco campos de M02.
- Services/queries para supervisor e alertas; mocks viram fallback/fixtures.
- Observabilidade, idempotência, OpenAPI e testes de contrato.

**Aceite:** operador e supervisor usam dados persistidos; nenhum feedback é publicável sem evidência; telas atuais mantêm paridade.

### Fase 2 — Supervisor Digital

Objetivo: completar a jornada de diagnóstico e atuação.

- Motor de regras versionado e fila de casos priorizada.
- Pacotes de evidência e hipóteses de causa com confiança.
- Integração inicial com conhecimento aprovado e citações.
- Revisão/aprovação de feedback e políticas human-in-the-loop.
- Planos de desenvolvimento, ações, ciência e checkpoints.
- Dashboard gerente e escalonamento por política.

**Aceite:** caso atravessa detecção → diagnóstico → evidência → recomendação → acompanhamento → escalonamento com auditoria.

### Fase 3 — Monitoria Inteligente

Objetivo: incorporar interação e qualidade à supervisão.

- Ingestão de interações, áudio/metadados e transcrições.
- Formulários/critério de monitoria versionados e monitoria IA.
- Evidências por trecho temporal, reprodução contextual e redaction.
- Amostragem por risco, revisão humana e métricas de concordância.
- Casos simulados iniciais derivados dos mocks e cenários de monitoria.

**Aceite:** todo achado de monitoria aponta para trecho verificável; precisão/concordância atendem limite definido por operação.

### Fase 4 — Correlação e Evidências

Objetivo: encontrar causa raiz de modo explicável.

- Correlação temporal entre indicador, transcrição, monitoria, procedimento e histórico.
- Busca híbrida no conhecimento, vigência temporal e gestão de versões.
- Evidência com provenance, confiança, hipóteses alternativas e avaliação offline.
- Suite de regressão com casos simulados cobrindo M01–M04 e M09.
- Painéis de qualidade da IA: cobertura de citação, suporte factual e falsos positivos.

**Aceite:** diagnósticos auditáveis com evidências recuperáveis e causa/procedimento validados em cenários de referência.

### Fase 5 — Gestão Proativa

Objetivo: antecipar risco e medir eficácia da gestão.

- Detecção de tendência, risco de meta, reincidência, melhoria e eventos críticos.
- Worker/outbox robustos, políticas de deduplicação, SLA e escalonamento multinível.
- Comparações dia/semana/mês/histórico e previsão com intervalos de confiança quando aplicável.
- Otimização da priorização por impacto e eficácia histórica das ações.
- Rollout controlado de automação por operação e nível de risco.

**Aceite:** alertas chegam dentro do SLA, têm baixa duplicidade, conduzem a ação rastreável e demonstram eficácia mensurável.

### Estratégia de migração sem breaking changes

1. Congelar contratos atuais com testes de caracterização.
2. Criar DTOs v1 iguais aos mocks consumidos hoje.
3. Implementar backend e adaptadores por endpoint.
4. Alternar `mock/http` por feature flag, rota e tenant.
5. Migrar tipos de componente para contratos canônicos com mappers.
6. Unificar supervisor somente após testes de paridade e aceite.
7. Remover mocks de runtime apenas quando telemetria provar estabilidade; mantê-los como fixtures.
8. Toda mudança de banco usa expand/migrate/contract: adicionar, popular, mudar leitura e só depois retirar legado em release separada.

## 11. Matriz de rastreabilidade de Miras

| Req. | Capacidades principais | Entidades | APIs/telas | Fase |
|---|---|---|---|---|
| M01 | Evidência + correlação + conhecimento | RootCauseHypothesis, EvidenceBundle | `:diagnose`, detalhe do caso | 2/4 |
| M02 | Contrato de feedback validado | Feedback, Evidence, Recommendation | `/feedbacks`, detalhe do feedback | 1 |
| M03 | Correlação multimodal/temporal | Correlation, Interaction, Monitoring | `:correlate`, detalhe do caso | 4 |
| M04 | Base versionada e citável | KnowledgeDocument/Version/Chunk | `/knowledge`, administração | 2/4 |
| M05 | Alertas iniciados por evento/schedule | Rule, Alert, SupervisionCase | `/alerts`, SSE, dashboards | 1/5 |
| M06 | Séries e checkpoints | IndicatorMeasurement, Checkpoint | `/evolution`, dashboards | 1/5 |
| M07 | Plano e ações estruturadas | DevelopmentPlan/Action | `/development-plans`, tela do operador | 2 |
| M08 | Máquina de estados do caso | SupervisionCase, Timeline, Escalation | `/supervision-cases`, detalhe | 1/2 |
| M09 | Sandbox e regressão | SimulationScenario/Run/Result | `/simulations`, biblioteca | 3/4 |

## 12. Critérios não funcionais e métricas de produto

Critérios a fechar na pré-fase com os RT oficiais:

- disponibilidade e latência por jornada, não apenas por endpoint;
- RPO/RTO, retenção e residência de dados;
- acessibilidade WCAG, responsividade e navegadores suportados;
- segurança OWASP, rate limiting, secrets, SAST/DAST e testes de autorização por escopo;
- observabilidade com trace distribuído entre ingestão, regra, AI run, caso e alerta;
- custo de IA por caso/tenant e limites de consumo;
- recuperação por replay seguro do outbox e idempotência.

Métricas recomendadas para provar valor do Supervisor Digital:

- precisão/recall de desvios e causas em casos validados;
- cobertura de evidência e taxa de citação válida;
- taxa de feedback rejeitado por genericidade ou baixa sustentação;
- tempo detecção→ação e percentual dentro do SLA;
- duplicidade e fadiga de alertas;
- reincidência pós-feedback e eficácia por tipo de ação;
- evolução do indicador no checkpoint versus baseline/grupo comparável;
- concordância IA–monitor humano;
- percentual de casos totalmente rastreáveis e auditáveis.

## 13. Próximas decisões necessárias

Antes de implementar, o time deve fornecer ou decidir:

1. Texto integral e critérios de aceite de RF01–RF32, RN01–RN14 e RT01–RT10.
2. Tecnologia/schema do banco existente e política de migração.
3. Fontes reais de indicadores, chamadas, transcrições e monitorias, incluindo volumes e frequência.
4. Provedor de identidade e matriz de permissões por perfil/escopo.
5. Política de automação: quais feedbacks/alertas podem ser automáticos e quais exigem aprovação.
6. Taxonomia oficial de indicadores, procedimentos, severidade, prioridade e causas.
7. Regras de privacidade, retenção, uso de áudio/transcrição e dados enviados ao provedor de IA.
8. SLOs, limites mínimos de confiança e critérios de promoção dos casos simulados.

Essas decisões não impedem o trabalho de baseline e contratos, mas impedem afirmar aderência completa ou automatizar decisões de alto impacto com segurança.
