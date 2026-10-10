create table channel_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel text not null default 'VOICE',
  flag_name text not null,
  value_type text not null check (value_type in ('BOOLEAN', 'NUMERIC')),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, channel, flag_name)
);

create table interaction_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  interaction_id uuid not null references interactions(id) on delete cascade,
  channel_flag_id uuid not null references channel_flags(id),
  value_boolean boolean,
  value_numeric numeric,
  received_at timestamptz not null default now(),
  unique (interaction_id, channel_flag_id),
  check (
    (value_boolean is not null and value_numeric is null) or
    (value_boolean is null and value_numeric is not null)
  )
);

create index idx_interaction_flags_interaction on interaction_flags (interaction_id);
create index idx_interaction_flags_flag on interaction_flags (channel_flag_id, received_at desc);

insert into channel_flags (organization_id, channel, flag_name, value_type, description) values
  ('00000000-0000-4000-8000-000000000001', 'VOICE', 'rechamada', 'BOOLEAN', 'Chamada identificada como novo contato sobre o mesmo motivo de uma chamada anterior.'),
  ('00000000-0000-4000-8000-000000000001', 'VOICE', 'nota_ura', 'NUMERIC', 'Nota de satisfação respondida na URA ao final da chamada.');
