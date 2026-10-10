-- Cenários da INIA — várias imagens por cenário, com faixa de horário diária, e escurecimento do fundo.
--
-- 1. IMAGENS POR CENÁRIO (`inia_scene_images`). Cada cenário tem 1..8 imagens; cada imagem pode ter uma FAIXA de horário
--    diária no fuso da organização (`start_minute` inclusivo, `end_minute` exclusivo, em minutos desde a meia-noite local;
--    `end_minute < start_minute` = atravessa a meia-noite, ex.: 18:00–06:00). Exatamente UMA imagem é a PRINCIPAL: vale nos
--    horários sem faixa (e o dia inteiro quando o cenário só tem ela). As faixas de um cenário nunca se sobrepõem — a
--    aplicação recusa ao salvar (é uma regra sobre o círculo das 24 h, inclusive depois da meia-noite).
--    A imagem que estava no cenário vira a PRINCIPAL, sem faixa ("Principal"): cenários existentes continuam iguais o dia
--    inteiro. As colunas de imagem saem de `inia_scenes` (uma fonte só); os bytes são COPIADOS antes, na mesma transação.
--    "Exatamente uma principal" é garantido pelo banco no fim de cada transação (gatilho de restrição adiado): um cenário
--    nunca fica sem imagem nem com duas principais, mesmo se a escrita parar no meio.
-- 2. ESCURECIMENTO (`inia_scenes.background_dim`, 0–100 %): máscara preta sobre a imagem de fundo (abaixo da INIA, dos
--    textos e dos cards). 0 = nenhuma máscara adicional (a aparência de hoje), 100 = preto opaco. Existentes recebem 0.

alter table inia_scenes add constraint inia_scenes_id_organization_unique unique (id, organization_id);

create table inia_scene_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  scene_id uuid not null,
  -- Identificação para quem administra (ex.: "Dia", "Noite").
  label text not null check (char_length(btrim(label)) between 1 and 40),
  is_primary boolean not null default false,
  start_minute smallint check (start_minute between 0 and 1439),
  end_minute smallint check (end_minute between 0 and 1439),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 8388608),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  data bytea not null,
  created_at timestamptz not null default now(),
  created_by_person_id uuid references people(id),
  updated_at timestamptz not null default now(),
  updated_by_person_id uuid references people(id),
  -- A imagem pertence a um cenário da MESMA organização.
  foreign key (scene_id, organization_id) references inia_scenes(id, organization_id) on delete cascade,
  -- Faixa: os dois ou nenhum; início ≠ fim (faixa vazia não existe; o dia inteiro é "sem faixa").
  check ((start_minute is null) = (end_minute is null)),
  check (start_minute is null or start_minute <> end_minute)
);

create unique index inia_scene_images_one_primary on inia_scene_images (scene_id) where is_primary;
create unique index inia_scene_images_label_unique on inia_scene_images (scene_id, lower(btrim(label)));
create index inia_scene_images_scene_idx on inia_scene_images (organization_id, scene_id);

insert into inia_scene_images (organization_id, scene_id, label, is_primary, mime_type, byte_size, width, height, sha256, data, created_at, created_by_person_id, updated_at, updated_by_person_id)
select organization_id, id, 'Principal', true, mime_type, byte_size, width, height, sha256, data, created_at, created_by_person_id, updated_at, updated_by_person_id
  from inia_scenes;

alter table inia_scenes
  drop column mime_type,
  drop column byte_size,
  drop column width,
  drop column height,
  drop column sha256,
  drop column data;

alter table inia_scenes
  add column background_dim smallint not null default 0 check (background_dim between 0 and 100);

-- Todo cenário termina a transação com ≥ 1 imagem e exatamente uma principal. Adiado: dentro da transação a aplicação pode
-- trocar a principal e as identificações em mais de um passo.
create function inia_scene_images_consistency() returns trigger language plpgsql as $$
declare
  target uuid;
  total integer;
  primaries integer;
begin
  if tg_table_name = 'inia_scenes' then
    target := new.id;
  elsif tg_op = 'DELETE' then
    target := old.scene_id;
  else
    target := new.scene_id;
  end if;
  -- Cenário excluído (as imagens saem em cascata): nada a conferir.
  if not exists (select 1 from inia_scenes where id = target) then
    return null;
  end if;
  select count(*), count(*) filter (where is_primary) into total, primaries from inia_scene_images where scene_id = target;
  if total = 0 or primaries <> 1 then
    raise exception 'Cenário da INIA % precisa de pelo menos uma imagem e exatamente uma principal (imagens: %, principais: %).', target, total, primaries
      using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger inia_scene_images_consistency_on_images
  after insert or update or delete on inia_scene_images
  deferrable initially deferred
  for each row execute function inia_scene_images_consistency();

create constraint trigger inia_scene_images_consistency_on_scenes
  after insert on inia_scenes
  deferrable initially deferred
  for each row execute function inia_scene_images_consistency();
