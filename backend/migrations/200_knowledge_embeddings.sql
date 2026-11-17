-- Busca nas bases em escala (RAG): vetores dos trechos e do cartão de cada documento, gerados pelo modelo de embedding escolhido na tela
-- de IA (Use Case KNOWLEDGE_EMBEDDING). Sem extensão no PostgreSQL (decisão de 16/11/2026: nada a instalar na VM Windows) — o vetor fica
-- em bytea (float32, little-endian, já normalizado) e a similaridade é calculada na aplicação, sobre as bases do escopo da pergunta.
--
-- Chave = o TEXTO enviado (hash): a mesma seção em duas versões da base é gerada uma vez só, e só o que mudou é gerado de novo. Vetores de
-- modelos diferentes não se comparam, por isso a chave inclui o modelo. É dado derivado (refeito a partir das versões publicadas), não
-- objeto de negócio: não tem exclusão lógica nem aparece em Consultar dados.
create table knowledge_embedding_vectors (
  organization_id uuid not null references organizations(id),
  model_key text not null check (length(model_key) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  dimensions integer not null check (dimensions between 1 and 8192),
  vector bytea not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, model_key, content_hash),
  check (octet_length(vector) = dimensions * 4)
);

-- Andamento por versão publicada × modelo: o que já foi indexado e o que falhou (com nova tentativa espaçada). Versão sem linha aqui
-- ainda não foi indexada com o modelo atual — a busca usa só o índice de texto para ela até terminar.
create table knowledge_embedding_index (
  organization_id uuid not null references organizations(id),
  version_id uuid not null references knowledge_versions(id) on delete cascade,
  model_key text not null check (length(model_key) between 1 and 200),
  status text not null check (status in ('DONE', 'FAILED')),
  -- Textos da versão (trechos + cartão) e quantos precisaram de chamada (os demais já existiam por hash).
  texts integer not null default 0 check (texts >= 0),
  embedded integer not null default 0 check (embedded >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  error_code text,
  error_message text,
  next_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (version_id, model_key)
);

create index knowledge_embedding_index_org on knowledge_embedding_index (organization_id, model_key, status);
