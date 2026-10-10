-- Data da última atualização da base de conhecimento (título, tipo, conteúdo, status ou alcance).
-- Fica nula em registros antigos que nunca foram alterados — não inventamos uma data para eles.
-- Único backfill é a partir de um fato já registrado: quem recebeu uma versão > 1 foi de fato
-- atualizado no created_at dessa versão.
alter table knowledge_documents
  add column updated_at timestamptz;

update knowledge_documents d
set updated_at = v.last_update
from (
  select document_id, max(created_at) last_update
  from knowledge_versions
  where version > 1
  group by document_id
) v
where v.document_id = d.id;
