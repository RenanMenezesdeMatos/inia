-- PRÁTICAS da operação (`PRACTICE_IDENTITY_V1`): a unidade que a liderança acompanha e o feedback cobra.
--
-- Uma PRÁTICA é UMA conduta esperada do operador numa situação ("Informar o prazo da análise da contestação"). A mesma conduta
-- aparece em várias regras — outra seção, outro documento, checklist, argumentário, versão nova do texto — e cada uma continua
-- sendo uma regra avaliada (`call_criterion_assessments` não muda). A prática junta essas regras para:
--   - o Diagnóstico mostrar UM ponto por conduta, com as fontes, em vez da mesma coisa escrita de vários jeitos;
--   - o feedback contar a reincidência e a orientação anterior pela conduta (a mesma falha em duas linhas da base é a mesma falha);
--   - o histórico continuar quando a base é editada (digitação, sinônimo, seção renumerada não criam outro ponto).
--
-- Quem decide se duas regras pedem a mesma conduta é a LEITURA do modelo (nunca palavra, regex ou semelhança de texto), uma vez por
-- linha da base/argumentário, e a decisão fica registrada aqui. Ninguém aprova. Linha sem membro = ainda não organizada (as
-- consultas usam a identidade da própria linha, como antes). Na dúvida o modelo separa — juntar condutas diferentes mistura números.
--
--   knowledge_practices          a prática (chave KP-<hash>, título da conduta escrito pelo modelo — rótulo, nunca evidência).
--   knowledge_practice_members   uma LINHA da base ou do argumentário (chave de linha, estável enquanto o texto não muda) → prática.
--                                practice_key null = a linha não pede conduta do operador (contexto, definição, exemplo).
--
-- Aditiva. Sem backfill em SQL: organizar as linhas exige a leitura do modelo (script `scripts/feedback-engine/sync-practices.ts`).

create table knowledge_practices (
  organization_id uuid not null references organizations(id),
  practice_key text not null check (practice_key ~ '^KP-[0-9a-f]{12}$'),
  title text not null check (length(btrim(title)) > 0),
  identity_version text not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (organization_id, practice_key)
);

create table knowledge_practice_members (
  organization_id uuid not null references organizations(id),
  line_key text not null,
  practice_key text,
  basis text not null check (basis in ('SAME_AS_EXISTING', 'NEW_PRACTICE', 'NO_CONDUCT')),
  source_kind text not null check (source_kind in ('KNOWLEDGE', 'ARGUMENT_SCRIPT')),
  source_id uuid not null,
  source_version integer not null,
  source_title text not null,
  section_heading text,
  lead_in text,
  rule_text text not null,
  identity_version text not null,
  model text,
  assigned_at timestamptz not null default now(),
  primary key (organization_id, line_key),
  foreign key (organization_id, practice_key) references knowledge_practices (organization_id, practice_key),
  check ((practice_key is null) = (basis = 'NO_CONDUCT'))
);
create index knowledge_practice_members_practice_idx on knowledge_practice_members (organization_id, practice_key);
