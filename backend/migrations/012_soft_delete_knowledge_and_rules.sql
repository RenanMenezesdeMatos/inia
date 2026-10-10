alter table knowledge_documents
  add column deleted_at timestamptz;

alter table indicator_calculation_rules
  add column deleted_at timestamptz;
