-- Execution Context genérico do motor de workflow: cada nó (agente, orquestrador, etc.) passa
-- a poder gravar sua saída estruturada, disponível para nós posteriores (ex.: uma Condition
-- avaliando nodeOutputs.diagnosis.severity, não só o valor bruto do trigger).
alter table workflow_enrollments
  add column node_outputs jsonb not null default '{}'::jsonb;
