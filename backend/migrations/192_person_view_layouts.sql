-- Disposição personalizada das telas por pessoa (pedido do responsável em 2026-11-12; primeiro uso: Painel dos Anjos — Indicadores,
-- Monitoria Online e Jornada e atendimentos). Cada pessoa guarda, por visão (`view_key`), a ordem das áreas, a ordem e o tamanho em
-- blocos dos cards e o que escondeu. Fica no servidor (não no navegador) para acompanhar a pessoa em qualquer máquina. A tela junta o
-- que está salvo com o catálogo atual: card que deixou de existir é ignorado e card novo entra no fim da área com o tamanho padrão.
-- Só acrescenta; sem disposição salva, a tela usa o padrão.
create table if not exists person_view_layouts (
  organization_id uuid not null references organizations(id),
  person_id uuid not null references people(id) on delete cascade,
  view_key text not null check (view_key ~ '^[a-z][a-z0-9.-]{2,79}$'),
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 65536),
  updated_at timestamptz not null default now(),
  primary key (organization_id, person_id, view_key)
);
