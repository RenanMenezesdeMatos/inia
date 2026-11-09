-- Imagens de um PDF de base de conhecimento (prints de instruções de trabalho), extraídas no upload para aparecerem no texto e abaixo das
-- respostas. Pertencem ao arquivo, como o próprio PDF: cada imagem uma vez por arquivo, pelo hash dos pixels, e somem com ele. A posição de
-- cada uma no texto fica em `knowledge_versions.extraction.images`, junto do resto do registro da conversão. A IA não recebe estas imagens.
create table knowledge_file_images (
  knowledge_file_id uuid not null references knowledge_files(id) on delete cascade,
  hash text not null check (hash ~ '^[0-9a-f]{32}$'),
  mime_type text not null check (mime_type = 'image/webp'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  data bytea not null,
  created_at timestamptz not null default now(),
  primary key (knowledge_file_id, hash)
);
