-- Leitura das páginas digitalizadas de um PDF de base (OCR), em segundo plano. Ler uma página leva segundos, e um PDF digitalizado pode ter dezenas:
-- isso não cabe no envio do arquivo. O envio cria o rascunho e esta fila; o processamento lê uma página por vez e, no fim, grava o texto no MESMO
-- rascunho, só se ele continuar como estava (mesmo arquivo, mesmo texto). Nada é publicado sozinho: quem enviou confere e publica.
create table knowledge_ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version_id uuid not null references knowledge_versions(id) on delete cascade,
  file_id uuid not null references knowledge_files(id) on delete cascade,
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED')),
  -- READING = lendo as páginas; PRINTS = cortando os prints e lendo de novo as páginas que têm print. As contagens são da etapa em curso.
  stage text check (stage in ('READING', 'PRINTS')),
  pages_total integer not null default 0 check (pages_total >= 0),
  pages_done integer not null default 0 check (pages_done >= 0),
  attempts integer not null default 0,
  lease_until timestamptz,
  -- O texto do rascunho quando a leitura foi pedida: o resultado só entra se ele não mudou.
  base_content_hash text not null,
  result jsonb,
  error_code text,
  error_message text,
  requested_by uuid,
  requested_by_name text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Uma leitura em andamento por rascunho.
create unique index knowledge_ocr_jobs_one_active on knowledge_ocr_jobs (version_id) where status in ('QUEUED', 'RUNNING');
create index knowledge_ocr_jobs_queue on knowledge_ocr_jobs (created_at) where status in ('QUEUED', 'RUNNING');
create index knowledge_ocr_jobs_document on knowledge_ocr_jobs (document_id, created_at desc);
