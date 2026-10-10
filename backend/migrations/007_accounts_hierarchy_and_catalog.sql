alter table people drop constraint people_role_check;
alter table people add constraint people_role_check
  check (role in ('OPERATOR', 'ADMIN', 'SUPERVISOR', 'MANAGER', 'SENIOR_MANAGER', 'DIRECTOR'));

create table subteams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  team_id uuid not null references teams(id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table user_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  person_id uuid not null unique references people(id),
  email text not null,
  password_hash text not null,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index idx_user_accounts_email on user_accounts (lower(email));
create index idx_subteams_team on subteams (organization_id, team_id);
create index idx_subjects_active on subjects (organization_id, active);
