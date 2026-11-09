-- Registro da conversão do arquivo em texto (PDF → Markdown): versão do conversor, cobertura por página e onde cada página começa no
-- conteúdo. Fica fora de `content`, para quem lê o texto continuar recebendo Markdown limpo. Versão antiga fica com null: nada é reescrito,
-- e quem quiser a conversão nova reprocessa o arquivo original, o que cria um rascunho.
alter table knowledge_versions add column extraction jsonb;

-- O registro acompanha o conteúdo: também não muda fora do rascunho.
create or replace function knowledge_version_content_immutable() returns trigger language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if old.status not in ('DRAFT', 'APPROVED')
     and (new.content is distinct from old.content or new.content_hash is distinct from old.content_hash
       or new.config is distinct from old.config or new.file_id is distinct from old.file_id
       or new.text_status is distinct from old.text_status or new.version is distinct from old.version
       or new.document_id is distinct from old.document_id or new.organization_id is distinct from old.organization_id
       or new.origin is distinct from old.origin or new.reverted_from_version_id is distinct from old.reverted_from_version_id
       or new.extraction is distinct from old.extraction) then
    raise exception 'Versão de base de conhecimento publicada é imutável.' using errcode = 'P0001';
  end if;
  return new;
end $$;
