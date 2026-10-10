-- Permite restringir um orquestrador a só um dos dois caminhos de invocação — interativo
-- (chat/voz do operador) ou motor de workflow (novo node "orchestrator") — ou ambos (padrão,
-- preserva o comportamento de todo orquestrador já cadastrado).
alter table assistant_orchestrators
  add column invocation_mode text not null default 'BOTH' check (invocation_mode in ('INTERACTIVE', 'WORKFLOW', 'BOTH'));
