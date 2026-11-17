-- COMUNICADOS — o autor edita ou retira o que publicou (16/11/2026). Ver docs/dev/memoria/experiencia-do-colaborador.md.
-- Editar troca título, conteúdo e categorias (o público não muda: ele foi fixado na publicação) e guarda a versão anterior em
-- `communication_revisions` — o que os destinatários leram antes nunca se perde. Retirar é exclusão lógica (`deleted_at`, 199).
-- Quem retirou segue o padrão do catálogo de Itens excluídos (`deleted_by_person_id`): o comunicado retirado aparece em
-- Consultar dados › Itens excluídos com quem retirou e quando (rastreio pedido pelo usuário em 16/11/2026).
alter table communications rename column deleted_by to deleted_by_person_id;

alter table communications
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references people(id);

create table if not exists communication_revisions (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references communications(id),
  organization_id uuid not null references organizations(id),
  title text not null,
  content_html text not null,
  plain_text text not null,
  tags text[] not null,
  -- Instante em que esta versão deixou de valer e quem a substituiu.
  replaced_at timestamptz not null default now(),
  replaced_by uuid not null references people(id)
);

create index if not exists communication_revisions_by_communication on communication_revisions (communication_id, replaced_at desc);
