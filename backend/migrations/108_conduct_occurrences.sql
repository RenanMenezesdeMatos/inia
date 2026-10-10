-- OCORRÊNCIA DE CONDUTA na memória do motor de feedback (`CONDUCT_OCCURRENCE_V1`).
--
-- Uma linha de `call_criterion_assessments` continua sendo uma REGRA avaliada numa chamada (cobertura e contagem por regra não
-- mudam). A ocorrência diz quantas CONDUTAS distintas essas regras julgaram: a ausência do protocolo antes de transferir pode
-- contrariar duas regras e ser UMA omissão naquela chamada. A ligação vem da revisão da análise (`sameConductAs`) e só é aceita
-- quando a estrutura confirma (as duas regras confirmadas, mesmo desfecho, mesmo momento da conversa) — nunca por texto parecido.
--
--   occurrence_key    OC-<hash> da chamada + regras do grupo: as regras ligadas compartilham a chave; nunca une chamadas.
--   occurrence_basis  REVIEW_SAME_CONDUCT = a revisão ligou esta regra a outra (mesma conduta, mesmo momento);
--                     SINGLE_RULE         = a revisão podia ligar e não ligou: ocorrência própria;
--                     null                = NÃO DETERMINÁVEL (leitura anterior a esta versão, contrato sem a ligação ou sem revisão).
--
-- Aditiva, sem backfill: registros antigos ficam null e as consultas os mostram como "sem ligação determinável" — nunca como
-- ocorrências únicas nem como repetidas.

alter table call_criterion_assessments
  add column occurrence_key text check (occurrence_key ~ '^OC-[0-9a-f]{12}$'),
  add column occurrence_basis text check (occurrence_basis in ('REVIEW_SAME_CONDUCT', 'SINGLE_RULE'));

alter table call_criterion_assessments
  add constraint call_criterion_assessments_occurrence_check check ((occurrence_key is null) = (occurrence_basis is null));
