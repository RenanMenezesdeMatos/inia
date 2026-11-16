-- Novo tipo de documento das bases de conhecimento: "IT - Instrução de trabalho".
alter table knowledge_documents drop constraint if exists knowledge_documents_document_type_check;
alter table knowledge_documents add constraint knowledge_documents_document_type_check
  check (document_type in ('PROCEDURE', 'MANUAL', 'FAQ', 'RULE', 'FLOW', 'WORK_INSTRUCTION'));
