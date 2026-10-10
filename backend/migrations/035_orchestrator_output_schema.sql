-- Descrição tipada (opcional) do formato do resultado estruturado que output_instructions pede
-- ao modelo — grupos de campos com label/type/enumValues amigáveis. Não substitui
-- output_instructions (que continua sendo o texto injetado no prompt): este campo só existe
-- para o Workflow Builder conseguir montar um seletor "Diagnóstico › Severidade" em vez de pedir
-- o JSON path técnico ao admin. Nulo por padrão — orquestrador sem schema continua funcionando
-- exatamente como hoje (Condition cai no campo de texto livre com o path).
alter table assistant_orchestrators
  add column output_schema jsonb;
