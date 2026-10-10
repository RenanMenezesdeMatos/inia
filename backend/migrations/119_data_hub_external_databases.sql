-- Central de Dados — BANCOS DE DADOS EXTERNOS (SQL Server, PostgreSQL, MariaDB, MySQL do cliente).
--
-- Nenhuma tabela nova: reaproveita a arquitetura de fontes × feeds.
--   * data_sources.kind = 'DATABASE' → config (motor, servidor, porta, banco, usuário, TLS, tempos-limite) em
--     data_sources.config (nunca segredo); a senha fica cifrada em data_secrets (purpose DATABASE_PASSWORD).
--   * Cada conjunto de dados (tabela/visão + sincronização) é um data_feed; a posição da leitura (checkpoint) fica em
--     data_feeds.checkpoint e só avança junto com a aplicação de cada página.
--   * trigger_kind = 'CONTINUATION': carga que segue, sozinha, do ponto aplicado pela anterior quando a origem tem mais
--     linhas que o limite por carga.
-- Aditiva: fontes, feeds e cargas existentes continuam exatamente como estão.

alter table data_sources drop constraint if exists data_sources_kind_check;
alter table data_sources add constraint data_sources_kind_check
  check (kind in ('FILE_UPLOAD', 'API_PULL', 'API_PUSH', 'SFTP', 'DATABASE'));

alter table data_ingestion_runs drop constraint if exists data_ingestion_runs_trigger_kind_check;
alter table data_ingestion_runs add constraint data_ingestion_runs_trigger_kind_check
  check (trigger_kind in ('MANUAL', 'SCHEDULE', 'PUSH', 'FILE_UPLOAD', 'REPROCESS', 'CONTINUATION'));

-- Retomada de carga interrompida: o tick procura cargas "em andamento" com a posse vencida.
create index if not exists idx_data_runs_active_lease on data_ingestion_runs (claimed_until)
  where status in ('CONNECTING', 'FETCHING', 'PARSING', 'MAPPING', 'VALIDATING', 'APPLYING');
