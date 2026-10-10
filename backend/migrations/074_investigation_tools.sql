-- TOOLS DE INVESTIGAÇÃO OPERACIONAL para Agents (2026-09-17).
--
-- Regra arquitetural: TOOL consulta/calcula fatos determinísticos; AGENT decide o que investigar,
-- formula hipóteses e interpreta; ORQUESTRADOR escolhe especialistas e sintetiza; WORKFLOW define
-- objetivo/escopo e pode RESTRINGIR as capacidades disponíveis naquela execução; CHAT/AVATAR
-- acionam Orquestrador + Agents sem Workflow.
--
-- 1. O Agent é DONO das ferramentas: `investigation_capabilities` guarda as capacidades amigáveis
--    habilitadas (catálogo em investigation/domain/capabilities.ts — INDICATOR_ANALYSIS,
--    SEGMENTATION, OPERATIONAL_COMPARISON, INTERACTION_ANALYSIS, WORK_CONTEXT, KNOWLEDGE,
--    SUPPORT_MATERIALS). Cada capacidade libera Tools internas específicas. Vazio = o Agent
--    responde como sempre (uma chamada, contexto pré-montado) — nada muda em silêncio.
alter table agents add column if not exists investigation_capabilities text[] not null default '{}'::text[];
comment on column agents.investigation_capabilities is
  'Capacidades de investigação habilitadas (catálogo da aplicação). Vazio = sem ferramentas. O Workflow só pode restringir (interseção), nunca conceder.';

-- 2. Trace SEGURO das ferramentas usadas em cada execução (ToolInvocationTrace): ferramenta,
--    resumo dos argumentos, resumo do resultado, proveniência/qualidade, início/fim. Nunca prompt
--    secreto, nunca cadeia de raciocínio — só fatos/ações observáveis, o suficiente para auditar
--    que o Agent realmente investigou. No chat o trace já vai em assistant_interactions.tool_calls.
alter table agent_runs add column if not exists tool_trace jsonb;
comment on column agent_runs.tool_trace is
  'Ferramentas de investigação usadas na execução (ToolInvocationTrace[]). Null = execução sem ferramentas.';
