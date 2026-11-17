-- ASSUNTOS DA BASE DE CONHECIMENTO = ASSUNTOS CANÔNICOS DAS CHAMADAS (17/11/2026, decisão do usuário).
--
-- Antes: `knowledge_document_subject_scopes.subject_id` apontava para `subjects` (lista fixa, sem tela de cadastro). Agora aponta para o
-- mesmo catálogo dos "Pedidos do cliente relacionados" dos Alinhamentos operacionais: `interaction_subject_definitions` (o assunto com
-- que as chamadas são classificadas), cadastrável pela própria tela da Base. `subjects` continua existindo para quem ainda a usa
-- (Regras de chamada, Argumentários).
--
-- Nenhum fluxo de IA lia esses assuntos (chat, busca nas bases, esclarecimento e agentes não consultam a tabela): a mudança é de catálogo,
-- não de comportamento. Vínculos preservados um a um:
--  1. cada assunto de `subjects` usado por uma base (na configuração em uso OU em qualquer versão gravada) encontra o assunto canônico de
--     mesmo nome (sem diferença de maiúsculas/espaços) ou de mesmo código gerado do nome; sem nenhum, o canônico é criado (sem apelidos:
--     não passa a classificar chamadas até a carga de assuntos trazer o de-para);
--  2. o de/para fica gravado em `knowledge_subject_canonical_map` (rastro da migração);
--  3. "Todos os assuntos" continua "Todos os assuntos"; base sem nenhum assunto continua sem nenhum (ausência nunca vira "todos");
--  4. as versões gravadas (`knowledge_versions.config.subjectScopes`) NÃO são reescritas (versão publicada é imutável, gatilho da 167):
--     continuam com o id antigo, e o código traduz pelo mapa ao ler (`knowledge-subjects.ts › canonicalSubjectScopes`) — publicar,
--     reverter ou reativar uma versão antiga grava o vínculo com o assunto canônico correspondente.

create table if not exists knowledge_subject_canonical_map (
  legacy_subject_id uuid primary key references subjects(id),
  organization_id uuid not null references organizations(id),
  interaction_subject_id uuid not null references interaction_subject_definitions(id),
  created_canonical boolean not null,
  migrated_at timestamptz not null default now()
);

create temporary table kb_used_subjects on commit drop as
select s.id, s.organization_id, s.name,
       -- Código no formato do catálogo (`^[a-z][a-z0-9_]{1,39}$`), gerado do nome como a tela dos Alinhamentos gera.
       (select case when c ~ '^[a-z][a-z0-9_]{1,39}$' then c else rtrim(left('assunto_' || c, 40), '_') end
          from (select rtrim(left(btrim(regexp_replace(translate(lower(btrim(s.name)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', '_', 'g'), '_'), 40), '_') c) g) code
  from subjects s
 where exists (select 1 from knowledge_document_subject_scopes ss where ss.subject_id = s.id)
    or exists (select 1 from knowledge_versions v cross join lateral jsonb_array_elements(case when jsonb_typeof(v.config -> 'subjectScopes') = 'array' then v.config -> 'subjectScopes' else '[]'::jsonb end) e
                where v.organization_id = s.organization_id and e ->> 'subjectId' = s.id::text);

-- 1. Canônico de mesmo nome ou código; sem ele, cria.
create temporary table kb_subject_match on commit drop as
select u.id legacy_subject_id, u.organization_id, u.name, u.code,
       coalesce(
         (select d.id from interaction_subject_definitions d where d.organization_id = u.organization_id and lower(btrim(d.name)) = lower(btrim(u.name)) order by d.active desc, d.created_at limit 1),
         (select d.id from interaction_subject_definitions d where d.organization_id = u.organization_id and d.code = u.code order by d.active desc, d.created_at limit 1)
       ) interaction_subject_id
  from kb_used_subjects u;

insert into interaction_subject_definitions (organization_id, code, name, description)
select distinct on (m.organization_id, m.code) m.organization_id, m.code, btrim(m.name), 'Incluído pela migração dos assuntos da Base de conhecimento (224).'
  from kb_subject_match m
 where m.interaction_subject_id is null
on conflict (organization_id, code) do nothing;

-- 2. Rastro do de/para.
insert into knowledge_subject_canonical_map (legacy_subject_id, organization_id, interaction_subject_id, created_canonical)
select m.legacy_subject_id, m.organization_id,
       coalesce(m.interaction_subject_id, (select d.id from interaction_subject_definitions d where d.organization_id = m.organization_id and d.code = m.code)),
       m.interaction_subject_id is null
  from kb_subject_match m
on conflict (legacy_subject_id) do nothing;

-- 3. Vínculos em uso: a coluna passa a apontar para o catálogo canônico.
alter table knowledge_document_subject_scopes drop constraint if exists knowledge_document_subject_scopes_subject_id_fkey;
update knowledge_document_subject_scopes ss
   set subject_id = map.interaction_subject_id
  from knowledge_subject_canonical_map map
 where ss.subject_id = map.legacy_subject_id;
alter table knowledge_document_subject_scopes
  add constraint knowledge_document_subject_scopes_subject_id_fkey foreign key (subject_id) references interaction_subject_definitions(id);
-- Vínculos repetidos (o cadastro antigo não deduplicava; dois assuntos antigos podem cair no mesmo canônico) barrariam o índice
-- único e a migração inteira voltaria: fica uma linha por (base, tipo, assunto). Tabela de ligação, não objeto de negócio (run-6 CB-01).
delete from knowledge_document_subject_scopes a
 using knowledge_document_subject_scopes b
 where a.knowledge_document_id = b.knowledge_document_id and a.scope_type = b.scope_type
   and a.subject_id is not distinct from b.subject_id and a.ctid > b.ctid;
create unique index if not exists knowledge_document_subject_scopes_unique
  on knowledge_document_subject_scopes (knowledge_document_id, scope_type, coalesce(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));

