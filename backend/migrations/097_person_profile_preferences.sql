-- Preferências pessoais do perfil — separadas do cadastro profissional
--
-- Aditiva: duas tabelas novas; nenhuma coluna de `people` muda. O CLIENTE fornece o cadastro profissional (`people`: nome
-- cadastral, matrícula, cargo, equipe, hierarquia, imagem corporativa em `people.avatar_url`); a PESSOA configura como quer
-- ser chamada, a foto e a capa. Por isso as preferências vivem fora de `people`: nenhuma carga da Central de Dados, importação
-- EMPLOYEES ou mapeamento escreve nestas tabelas (não são destino de contrato), e o upsert por matrícula preserva `people.id`
-- — a identidade estável a que elas se ligam (nunca o texto do nome nem o e-mail).
--
-- Imagens em `bytea` (o mesmo armazenamento persistente dos arquivos da Base de Conhecimento): a foto e a capa sobrevivem a
-- logout, outro dispositivo e reinício do servidor; nunca uma URL temporária de prévia. Uma imagem pertence a UMA pessoa e a
-- um uso (AVATAR | COVER); substituir ou remover apaga a anterior na mesma transação.

create table person_profile_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  usage text not null check (usage in ('AVATAR', 'COVER')),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea not null,
  created_at timestamptz not null default now()
);

create index person_profile_images_person_idx on person_profile_images (organization_id, person_id);

create table person_profile_preferences (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  -- Como a pessoa quer ser chamada. Nulo = sem preferência (vale o nome cadastral). Normalizado pela aplicação
  -- (espaços, forma NFC) e limitado a letras, acentos, espaço, apóstrofo, hífen e ponto.
  preferred_name text check (preferred_name is null or char_length(preferred_name) between 1 and 60),
  avatar_image_id uuid references person_profile_images(id) on delete set null,
  -- Capa: DEFAULT = capa padrão da INIA; PRESET = uma das capas predefinidas; CUSTOM = imagem enviada pela pessoa.
  cover_kind text not null default 'DEFAULT' check (cover_kind in ('DEFAULT', 'PRESET', 'CUSTOM')),
  cover_preset text check (cover_preset is null or cover_preset in ('inia', 'aurora', 'nature', 'neutral')),
  cover_image_id uuid references person_profile_images(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by_account_id uuid references user_accounts(id),
  primary key (organization_id, person_id),
  check (cover_kind <> 'PRESET' or cover_preset is not null),
  check (cover_kind <> 'CUSTOM' or cover_image_id is not null)
);
