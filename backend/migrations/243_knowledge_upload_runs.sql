-- Andamento do processamento de um arquivo enviado para uma base de conhecimento (19/11/2026).
-- A leitura do arquivo (conferência, texto, imagens, Markdown e gravação) roda dentro da requisição do envio, e nada guardava em que ponto ela
-- estava: quem enviava um PDF grande via só "Enviando…". Uma linha por envio, escrita pela própria requisição a cada etapa, para a tela mostrar o
-- estado real e para a pessoa sair e voltar depois. A leitura das páginas digitalizadas (OCR) continua em `knowledge_ocr_jobs` (179): aqui fica
-- só o id da leitura pedida, e o estado dela é lido de lá. Registro de acompanhamento, não histórico da base: o da própria conta, por 30 dias.
create table if not exists knowledge_upload_runs (
  -- Gerado pela tela antes do envio (vem no formulário), para ela acompanhar enquanto a requisição ainda não respondeu.
  id uuid primary key,
  organization_id uuid not null references organizations(id),
  account_id uuid not null references user_accounts(id) on delete cascade,
  -- CREATE = base nova com arquivo; REPLACE_FILE = arquivo novo no rascunho de uma base existente.
  kind text not null check (kind in ('CREATE', 'REPLACE_FILE')),
  document_id uuid references knowledge_documents(id) on delete set null,
  version_id uuid references knowledge_versions(id) on delete set null,
  ocr_job_id uuid references knowledge_ocr_jobs(id) on delete set null,
  title text,
  filename text not null,
  source_type text not null check (source_type in ('PDF', 'DOCX', 'TXT', 'JSON')),
  size_bytes bigint not null check (size_bytes >= 0),
  -- PROCESSING = a requisição ainda está lendo; DONE = o rascunho foi gravado (o OCR pode continuar na fila); FAILED = o arquivo não entrou.
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'DONE', 'FAILED')),
  -- Lista das etapas na ordem da tela: [{ key, state, detail, warning, errorCode, errorMessage, startedAt, finishedAt }].
  stages jsonb not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists knowledge_upload_runs_account on knowledge_upload_runs (account_id, created_at desc);
create index if not exists knowledge_upload_runs_document on knowledge_upload_runs (document_id, created_at desc) where document_id is not null;
