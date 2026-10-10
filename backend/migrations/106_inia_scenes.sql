-- Cenários da INIA — o fundo atrás do avatar (palco da aplicação de feedback e painel da INIA), por organização.
--
-- Aditiva: duas tabelas novas. Só o Administrador geral (permissão `inia_experience.manage`, escopo de organização) cria,
-- troca e agenda; o colaborador só VÊ o cenário que está valendo. Regra de qual cenário vale HOJE (data local da organização):
--   1. um cenário AGENDADO cujo período cobre hoje (os períodos nunca se sobrepõem — a aplicação recusa ao salvar);
--   2. senão o cenário PADRÃO (`inia_scene_settings.default_scene_id`);
--   3. senão nenhum — o palco roxo de sempre.
-- Quando o período acaba, volta sozinho ao padrão: nada é "desligado" por job.
--
-- Imagem em `bytea` (o mesmo armazenamento das imagens de perfil): validada pelo CONTEÚDO (JPEG/PNG/WebP, paisagem, mínimo
-- 1280×640); trocar a imagem troca o sha256, que vai na URL (cache longo sem servir a imagem antiga).

create table inia_scenes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea not null,
  -- Período (datas locais da organização, inclusivas). Os dois ou nenhum.
  schedule_start date,
  schedule_end date,
  created_at timestamptz not null default now(),
  created_by_person_id uuid references people(id),
  updated_at timestamptz not null default now(),
  updated_by_person_id uuid references people(id),
  check ((schedule_start is null) = (schedule_end is null)),
  check (schedule_end is null or schedule_end >= schedule_start)
);

create unique index inia_scenes_name_unique on inia_scenes (organization_id, lower(btrim(name)));
create index inia_scenes_schedule_idx on inia_scenes (organization_id, schedule_start) where schedule_start is not null;

create table inia_scene_settings (
  organization_id uuid primary key references organizations(id),
  -- Cenário fora dos períodos agendados. Nulo = palco padrão (sem imagem). Excluir o cenário volta a nulo.
  default_scene_id uuid references inia_scenes(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by_person_id uuid references people(id)
);
