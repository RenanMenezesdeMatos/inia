-- Marcador da INSTALAÇÃO — uma linha só, gravada por `npm run setup` (primeira instalação).
--
-- Diz que este banco é uma instalação da INIA (e não um banco de desenvolvimento antigo), qual organização ela atende
-- (uma instalação = uma organização), se recebeu dados de demonstração e quem foi o primeiro administrador.
-- `npm run update` só aplica migrations pendentes e anota a última atualização aqui; nunca apaga dado.
-- Bancos criados antes desta migration continuam sem linha (o update funciona igual; o setup se recusa a rodar neles).

create table if not exists installation_info (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null references organizations(id),
  installed_at timestamptz not null default now(),
  installed_version text not null,
  demo_data boolean not null default false,
  first_admin_account_id uuid references user_accounts(id) on delete set null,
  last_update_at timestamptz,
  last_update_version text
);

-- O papel do primeiro administrador nasce da instalação (sem ator humano): origem própria, rastreável.
alter table access_role_assignments drop constraint if exists access_role_assignments_source_check;
alter table access_role_assignments add constraint access_role_assignments_source_check
  check (source in ('MANUAL', 'MIGRATION_LEGACY_ADMIN', 'MIGRATION_FEEDBACK_QA_GRANT', 'INSTALLATION'));
