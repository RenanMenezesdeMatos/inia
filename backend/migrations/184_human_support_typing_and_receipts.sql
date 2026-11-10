-- Apoio com Anjo — "digitando", entregue e lido na conversa operador ↔ Anjo (2026-11-10).
--
-- Uma linha por pedido, criada na primeira marca. Os recibos são CURSORES sobre o `seq` das mensagens do pedido (sem lacunas):
-- até onde cada lado já RECEBEU as mensagens no aplicativo (entregue) e até onde já as VIU na tela (lida). Só avançam, nunca passam da
-- última mensagem, e lida implica entregue. São do pedido (não do atendimento): se outro Anjo assume, o que o primeiro já leu continua
-- lido. "Digitando" é só um prazo curto (`*_typing_until`, renovado pela tela enquanto a pessoa escreve); passou do prazo, ninguém
-- está digitando. Nenhum texto em digitação é gravado.
create table if not exists human_support_conversation_marks (
  request_id uuid primary key references human_support_requests(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  operator_delivered_seq integer not null default 0,
  operator_read_seq integer not null default 0,
  anjo_delivered_seq integer not null default 0,
  anjo_read_seq integer not null default 0,
  operator_typing_until timestamptz,
  anjo_typing_until timestamptz,
  updated_at timestamptz not null default now(),
  check (operator_read_seq >= 0 and operator_read_seq <= operator_delivered_seq),
  check (anjo_read_seq >= 0 and anjo_read_seq <= anjo_delivered_seq)
);
