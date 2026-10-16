-- ALIAS DE ASSUNTO PELO PAR MOTIVO + SUBMOTIVO (2026-10-16, `SUBJECT_RESOLUTION_V2`).
--
-- Desde a 145 a interação tem MOTIVO (`reason`, genérico: "Fatura") e SUBMOTIVO (`sub_reason`, específico: "Segunda via").
-- O assunto das comparações passa a ser o SUBMOTIVO quando a fonte o informou (o motivo continua como um nível a mais de
-- recorte). Um submotivo genérico ("Outros", "Dúvida") pode existir em vários motivos e significar coisas diferentes em cada
-- um; por isso o alias pode ser restrito a um motivo:
--   - `raw_reason` nulo  → alias do TEXTO (vale para o submotivo e, quando não há submotivo, para o motivo) — o de sempre;
--   - `raw_reason` preenchido → alias do PAR: só o submotivo `raw_subject` DENTRO do motivo `raw_reason`.
-- Precedência na resolução (interaction-subject.ts): par > texto do submotivo; sem submotivo, texto do motivo.
-- O texto continua comparado ignorando caixa/espaços. Um mesmo par (ou texto, sem motivo) tem no máximo UM alias.
-- Nenhuma linha existente muda: todos os aliases atuais ficam com `raw_reason` nulo, que é exatamente o comportamento anterior.

alter table interaction_subject_aliases add column if not exists raw_reason text check (raw_reason is null or length(btrim(raw_reason)) > 0);

drop index if exists interaction_subject_aliases_raw_unique;
create unique index if not exists interaction_subject_aliases_reason_raw_unique on interaction_subject_aliases (organization_id, lower(btrim(coalesce(raw_reason, ''))), lower(btrim(raw_subject)));

comment on column interaction_subject_aliases.raw_reason is 'Motivo (interactions.reason) a que o alias se restringe: nulo = alias do texto (submotivo ou, sem submotivo, motivo); preenchido = só o submotivo raw_subject dentro deste motivo.';
comment on table interaction_subject_aliases is 'Assunto bruto → assunto canônico. raw_subject = texto do submotivo (ou do motivo, quando a interação não tem submotivo); raw_reason restringe o alias a um motivo. Um bruto ambíguo não tem alias.';
