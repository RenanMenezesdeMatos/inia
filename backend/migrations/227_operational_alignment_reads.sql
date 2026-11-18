-- Alinhamento operacional no Acompanhamento do operador (18/11/2026, decisão do usuário).
-- Leitura simples ("Li o alinhamento", sem senha — não é a ciência dos feedbacks): uma linha por pessoa × VERSÃO, só inserção.
-- Nova versão pede leitura de novo. Não muda a avaliação das chamadas nem o chat. O aviso no sino usa `alerts` (sem tabela nova).
create table if not exists operational_alignment_reads (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id),
  alignment_id uuid not null references operational_alignments(id),
  version_id uuid not null references operational_alignment_versions(id),
  read_at timestamptz not null default now(),
  primary key (person_id, version_id)
);
create index if not exists operational_alignment_reads_version on operational_alignment_reads (organization_id, version_id);

-- Só inserção: a leitura é registro histórico (a liderança vai contar quem leu cada versão).
create or replace function operational_alignment_reads_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'operational_alignment_reads é só inserção';
end $$;
drop trigger if exists operational_alignment_reads_no_update on operational_alignment_reads;
create trigger operational_alignment_reads_no_update before update or delete on operational_alignment_reads
  for each row execute function operational_alignment_reads_immutable();
