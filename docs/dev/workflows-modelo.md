# Workflows-modelo oficiais (catálogo)

Os 20 modelos conceituais (22 instâncias — o Modelo 18 tem uma por Base de Conhecimento) vivem no
banco como **rascunhos** (`workflows.draft_graph`, `active_version_id is null`), criados e mantidos
pela UI/contrato do editor. Nunca publicados: publicar é decisão explícita de operação.

## DRAFT válido

"DRAFT válido" = rascunho que passa **100% na mesma validação do botão Publicar** sem ser publicado.
A validação é uma função só, `backend/src/modules/workflows/application/validate-workflow-for-publish.ts`,
usada por `POST /admin/workflows/:id/publish` (valida e grava a versão) e por
`POST /admin/workflows/:id/validate` (dry-run: `{ valid, error: { code, message, nodeId } | null }`,
zero escrita). O editor espelha as mesmas regras em `frontend/src/schemas/admin/workflow-validation.ts`
(lista completa, por nó) — o rodapé "Não é possível publicar — N problemas" e o dry-run precisam
concordar.

## Fixture compartilhada

`backend/src/modules/workflows/testing/official-model-workflows.json` é uma exportação literal dos
22 rascunhos (id, nome, trigger, abrangência, estrutura, grafo). É a única fonte que os testes de
catálogo consomem:

- `backend/.../testing/official-model-workflows.test.ts` — schema, validação de publicação inteira,
  toda saída com aresta, destinatário × contexto, Revisão humana (3 decisões com destino), fan-out/
  fan-in, Agent/Orquestrador, cobertura por beneficiário, multidomínio, nenhum destinatário fixo.
- `frontend/src/schemas/admin/official-model-workflows.test.ts` — validador do editor com 0
  problemas, handles ↔ arestas, matriz de contexto.

Depois de alterar um modelo pela UI, reexporte:

```bash
psql inia -Atc "select json_agg(json_build_object('key', substring(name from 'Modelo · ([0-9]+[a-c]?)'), 'id', id, 'name', name, 'trigger', trigger_config, 'scopeType', scope_type, 'teamId', team_id, 'subteamId', subteam_id, 'consolidatedStructure', consolidated_structure, 'populationFilter', population_filter, 'graph', draft_graph) order by name) from workflows where name like 'Modelo · %'" | python3 -c "import json,sys; json.dump(json.load(sys.stdin), open('backend/src/modules/workflows/testing/official-model-workflows.json','w'), ensure_ascii=False, indent=2)"
```

e o catálogo de IA (orquestradores + especialistas + fronteira de domínio):

```bash
psql inia -Atc "select json_build_object('orchestrators', (select json_agg(json_build_object('id', o.id, 'name', o.name, 'invocationMode', o.invocation_mode, 'active', o.active, 'scopeType', o.scope_type, 'coordinatorAgentId', o.orchestrator_agent_id, 'policyKind', o.policy_kind, 'policyDomains', o.policy_domains, 'routingPolicy', o.routing_policy, 'routingDomains', o.routing_domains, 'specialistAgentIds', (select coalesce(json_agg(s.agent_id order by a.name), '[]') from assistant_orchestrator_specialists s join agents a on a.id=s.agent_id where s.orchestrator_id=o.id)) order by o.name) from assistant_orchestrators o where o.name like 'Orquestrador ·%'), 'agents', (select json_agg(json_build_object('id', a.id, 'name', a.name, 'agentType', a.agent_type, 'active', a.active, 'scopeType', a.scope_type, 'specialty', a.specialty, 'specialtyKind', a.specialty_kind, 'domain', a.domain, 'capability', a.capability, 'consolidatedInput', a.consolidated_input) order by a.name) from agents a where a.name like 'Especialista de %' or a.name like 'Coordenação ·%'))" | python3 -c "import json,sys; json.dump(json.load(sys.stdin), open('backend/src/modules/workflows/testing/official-ai-catalog.json','w'), ensure_ascii=False, indent=2)"
```

e revise `frontend/src/components/wiki/ai-catalog-data.ts` (`WORKFLOW_TEMPLATES` — campos
estruturais, beneficiário, estrutura e "quem recebe o quê" são derivados do grafo real; nunca
expõe UUID).

## Template × instância

`official-model-templates.json` é a definição **conceitual** de cada modelo: o requisito
organizacional (`structureRequirement`) — `GENERIC` (Todos os grupos, individual),
`PERSON_ANCHOR` (escolha a pessoa com o cargo: Supervisor/Gerente/Diretor), `GROUP` (um Grupo do
domínio, Abrangência = Estrutura) ou `GROUP_SCOPE` (Abrangência num Grupo do domínio, individual).
Nunca carrega UUID, nome de Grupo ou pessoa de um ambiente (teste anti-acoplamento, backend e
Wiki). Os 22 rascunhos de `official-model-workflows.json` são a **instância** demo, com ids
concretos `de00…`; o teste confere que cada instância satisfaz o requisito do seu template
(`instanceSatisfiesRequirement`, domínio do Grupo lido de `GroupSpec.domain` da massa). Ainda não
existe UX de "criar a partir de modelo": ao instalar num cliente, o binding é feito no editor
(Abrangência/Estrutura Consolidada) seguindo o texto da Wiki (`describeStructureRequirement`).

## Política de especialistas dos Orquestradores

Persistida (migrations 053/054): `agents.specialty` (FATURAMENTO/RETENCAO/SUPORTE/CADASTRO,
CROSS_CUTTING, PERFORMANCE ou null) e `assistant_orchestrators.policy_kind` + `policy_domains`
(DOMAIN/TRANSVERSAL/MULTIDOMAIN/MANAGERIAL/INTERACTIVE). Regra única em
`assistant/domain/orchestrator-policy.ts`, aplicada em `POST/PATCH /admin/assistant-orchestrators`
(422 `ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY`, `ORCHESTRATOR_POLICY_INVALID`,
`ORCHESTRATOR_POLICY_REQUIRED`) e cobrada pelo teste do catálogo
(`EXPECTED_ORCHESTRATOR_POLICIES`/`EXPECTED_SPECIALTIES`/`EXPECTED_CROSS_CUTTING`). A lista de
especialistas continua sendo a autorização explícita — um transversal só entra se adicionado.

Evolução da taxonomia (migration 057, 2026-09-16 — ver `docs/dev/auditoria-agents-orchestrators-2026-09.md`):
forma alvo **aditiva**, com dual-read (novo primeiro, legado como fallback) e dual-write (o legado
continua gravado): `agents.specialty_kind` (DOMAIN | CROSS_CUTTING | PERFORMANCE | SYNTHESIS) +
`domain` (só DOMAIN) + `capability` (só CROSS_CUTTING) + `consolidated_input` (aceita o resultado
consolidado pós-JOIN — SYNTHESIS sempre); `assistant_orchestrators.routing_policy` (DOMAINS | OPEN) +
`routing_domains` (1..N quando DOMAINS). Backfill determinístico: DOMAIN/MULTIDOMAIN → DOMAINS,
INTERACTIVE → OPEN; TRANSVERSAL/MANAGERIAL ficam `routing_policy` null (legado, regra antiga).
Regra em `agents/domain/agent-specialty.ts` + `assistant/domain/orchestrator-policy.ts`
(`resolveRoutingPolicy`, `checkSpecialistAgainstRouting`, `legacyPolicyFor`). Pós-JOIN: "Chamar
agente" com Agent que aceita consolidado (`synthesis-agent-executor.ts`, reutiliza
`buildConsolidatedSummary`, 1 request, contrato estruturado, papel `agent_synthesis`; publish recusa
`WORKFLOW_AGENT_NOT_CONSOLIDATED` / `WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN`); os modelos 04/05/11/14/
16/17/20 usam o **Especialista de Síntese Gerencial**; o Orquestrador pós-JOIN legado continua
executável. Especialista acionado por Orquestrador com transcrição compartilhada responde no MESMO
contrato do Agent direto (`runSpecialistTool` → `parseStructuredFeedback`, evidência literal
verificada); sem transcrição (chat/voz) ou legado sem especialidade → texto (adapter). Campos
legados (`specialty`, `policy_kind`, `policy_domains`) podem ser removidos quando nenhum leitor os
usar (hoje: frontend legado `AGENT_SPECIALTY_LABELS`, constraint da 054, catálogo `policyKind`).
Fase 6: orquestradores de domínio/transversal sem referência foram DESATIVADOS (não apagados);
Gerencial continua ativo por compatibilidade com Workflows de QA que o referenciam.

Saneamento (migration 054): **Orquestrador ativo nunca fica sem política** — constraint
`active ⇒ policy_kind not null`; `null` só é aceito em registro inativo (legado à espera de
classificação; a lista mostra "Sem política" e o switch de ativo fica travado até classificar no
editor). `INTERACTIVE` = Assistente interativo (o orquestrador do chat/voz): multiassunto por
definição, a lista é a autorização, e só existe com `invocation_mode = 'INTERACTIVE'` (constraint) —
nunca roda em Workflow (a publicação já recusa orquestrador "Só chat/voz"). O backfill da migration
não infere nada: só `INTERACTIVE` sem política vira `INTERACTIVE`; `BOTH`/`WORKFLOW` sem política é
desativado. O catálogo oficial (`official-ai-catalog.json`) contém só orquestradores "Só workflows"
classificados (teste do catálogo).

## Regras que os modelos seguem (e que os testes cobram)

- "O próprio operador" só em contexto individual (EMPLOYEE). Fora do caminho individual (contexto
  STRUCTURE/CONSOLIDATED_RESULT) o Output vai para a gestão e o cargo é resolvido **pela estrutura**
  (`workflows/application/organizational-recipient.ts`): âncora-pessoa com o cargo → ela; senão a
  cadeia acima dela (linear) ou os descendentes com o cargo; Grupo/Subgrupo → ancestrais de TODOS os
  operadores membros. Exatamente uma pessoa → válido; nenhuma → `WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND`;
  duas ou mais → `WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS`. Nunca "um membro qualquer" (o
  `scheduled_subject_id` de Grupo/Subgrupo continua sendo só o carregador técnico da matrícula). A
  mesma função roda no publish (dry-run detecta ambiguidade com a estrutura de hoje), no runtime
  (`executeOutput` resolve de novo e FALHA o node em vez de descartar o alerta) e no QA Lab (o step
  mostra "Destinatário resolvido: Gerente Fulano" ou o motivo). Grupo/Subgrupo não têm
  `owner_id`/`manager_id` — quando existir, entra como fonte adicional no resolvedor, nunca como
  regra inventada. Modelo 17 é o exemplo ancorado em Grupo (B2C · Retenção → 1 Gerente).
- Superfícies: `FOLLOW_UP` (Acompanhamento) e `NOTIFICATION` (sino). `INBOX` ("Pendências") não tem
  leitor fora do QA Lab — Pendências real é só Revisão humana.
- Revisão humana: Aprovado → Output ao operador; Reprovado → não publica (num fan-out, segue ao
  Join só com a decisão registrada); Escalar → **Escalonar ao Gerente** com o conteúdo analisado
  (`END_BRANCH` em fluxo individual, `CONTINUE → Join` num fan-out). Nunca um branch solto.
- Fan-out com Join: TODAS as decisões da revisão convergem no MESMO "Consolidar resultados".
- Orquestrador em quatro papéis (política persistida — ver acima — e cobrada pelo teste contra a
  fixture `official-ai-catalog.json`): **de domínio** (Faturamento, Retenção,
  Suporte, Cadastro) coordena só o especialista do próprio domínio + transversais (Experiência,
  Qualidade, Eficiência); **transversal** (Qualidade e Experiência) só transversais;
  **multidomínio** (Orquestrador · Atendimento multidomínio) é o único que cruza domínios de
  processo — Modelo 08 (no QA com a interação canônica 010 acionou só Faturamento + Retenção);
  **gerencial** sintetiza pós-Join sem especialistas. Domínio conhecido = Agent direto.
- Alinhamento com a massa demo (`npm run db:seed:demo`): toda referência estrutural dos modelos
  (Abrangência, Estrutura Consolidada, Filtro) existe na estrutura demo regenerada em memória pelo
  teste (`generateStructure`), e os códigos de indicador são os medidos na massa
  (`MONITORIA_QUALIDADE`, nunca o `QUALIDADE` do seed antigo). Âncoras: Diretor João Lacerda
  (04/05/11/12/14/15 — toda a operação), Supervisora Daniela (16, B2C), Gerente Sueli (20, B2B, com
  Coordenador), Grupo B2C · Retenção (17), Grupos B2C de Faturamento/Retenção/Suporte (18a/b/c).
  Modelo genérico = Todos os grupos; modelo de domínio = Grupo do domínio, com o pré-requisito
  descrito na Wiki.
- Beneficiário é derivado de quem RECEBE Output (`classifyBeneficiary`): OPERADOR (só ao operador —
  a Revisão humana é salvaguarda), SUPERVISOR/LIDERANÇA (só gestão), MULTINÍVEL (os dois: 04, 05,
  11, 14, 15, 20). Conteúdo sensível ao operador (performance, qualidade, procedimento) passa por
  Revisão humana; reconhecimento e orientação operacional (07, 10, 12) são as entregas diretas.
- JOIN vazio (zero filhos) não gasta IA: o Orquestrador consolidado devolve um resultado
  determinístico (`skippedReason: "EMPTY_FAN_IN"`) e o Output entrega "nenhum caso neste período".
