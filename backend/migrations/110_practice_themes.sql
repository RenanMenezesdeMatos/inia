-- TEMAS das práticas da operação (`PRACTICE_THEMES_V1`): como a liderança lê os pontos do processo.
--
-- Uma prática (109) é UMA conduta esperada ("Informar o prazo da análise da contestação exibido na ferramenta"). Uma operação tem
-- dezenas delas; numa lista única o Diagnóstico vira um mural de frases longas. O TEMA junta as práticas do mesmo momento ou assunto
-- do atendimento ("Encerramento do atendimento", "Prazo e próximos passos") e cada prática ganha um NOME CURTO para a lista
-- ("Prazo da análise"); o título da conduta continua sendo a descrição completa do ponto.
--
-- Quem decide o tema e o nome curto é a LEITURA do modelo (nunca palavra, regex ou lista fixa de temas — os temas são dados da
-- organização), uma vez por prática, e a decisão fica registrada aqui. Ninguém aprova. Prática sem tema = ainda não agrupada (a tela
-- a mostra à parte, pelo próprio título).
--
--   knowledge_practice_themes   o tema (chave KT-<hash>, nome curto escrito pelo modelo — rótulo, nunca evidência).
--   knowledge_practices         + short_title / theme_key (os dois juntos), quando e com qual versão/modelo foram decididos.
--
-- Aditiva. Sem backfill em SQL: agrupar exige a leitura do modelo (script `scripts/feedback-engine/sync-practices.ts`).

create table knowledge_practice_themes (
  organization_id uuid not null references organizations(id),
  theme_key text not null check (theme_key ~ '^KT-[0-9a-f]{12}$'),
  title text not null check (length(btrim(title)) > 0),
  theme_version text not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (organization_id, theme_key)
);

alter table knowledge_practices
  add column short_title text check (short_title is null or length(btrim(short_title)) > 0),
  add column theme_key text,
  add column theme_version text,
  add column theme_model text,
  add column themed_at timestamptz,
  add constraint knowledge_practices_theme_fk foreign key (organization_id, theme_key) references knowledge_practice_themes (organization_id, theme_key),
  add constraint knowledge_practices_theme_pair check ((theme_key is null) = (short_title is null) and (theme_key is null) = (themed_at is null));

create index knowledge_practices_theme_idx on knowledge_practices (organization_id, theme_key);
