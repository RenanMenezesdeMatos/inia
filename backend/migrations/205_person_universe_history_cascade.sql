-- O histórico de universo da pessoa (197) é preenchido por gatilho a cada pessoa criada; com a FK sem `on delete`, nenhuma pessoa
-- podia mais ser apagada fisicamente (limpeza das provas, apagamento de dados pessoais a pedido do titular): quem apaga não sabe
-- que o gatilho gravou a linha. O histórico é um atributo derivado da pessoa (como a disposição de tela da 192): vai junto com ela.
-- Pessoas continuam com exclusão lógica no produto; isto só afeta o apagamento físico. Idempotente.
alter table person_operating_universe_history drop constraint if exists person_operating_universe_history_person_id_fkey;
alter table person_operating_universe_history
  add constraint person_operating_universe_history_person_id_fkey foreign key (person_id) references people(id) on delete cascade;
