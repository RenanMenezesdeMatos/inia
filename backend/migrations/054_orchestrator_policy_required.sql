-- Orquestrador ATIVO nunca fica sem política (saneamento 2026-09-16, Parte A).
--
-- A migration 053 introduziu a política explícita de especialistas, mas deixou `policy_kind`
-- NULL como "sem restrição" — um escape permanente para registros legados/teste que continuavam
-- ativos e utilizáveis (pelo chat/voz ou por node de Workflow) fora da regra. Esta migration
-- fecha o escape sem inventar classificação:
--
-- 1. Nova política `INTERACTIVE` (Assistente interativo): o orquestrador que atende o chat/voz do
--    colaborador é multiassunto por definição — a autorização é a lista explícita de especialistas
--    e, em troca, ele só existe com `invocation_mode = 'INTERACTIVE'` (nunca roda em Workflow).
-- 2. Backfill SEM inferência: registros já restritos a `INTERACTIVE` sem política viram
--    `INTERACTIVE` (é exatamente o que são). Todo o resto sem política (`BOTH`/`WORKFLOW`) é
--    DESATIVADO — o admin classifica e reativa conscientemente pela tela de Orquestradores (a UI
--    avisa "Sem política"). Nada de massa demo aqui; nenhuma linha é apagada.
-- 3. Constraints: ativo ⇒ política definida; INTERACTIVE ⇒ só chat/voz. NULL continua permitido
--    apenas em registro inativo (estado legítimo: legado à espera de classificação).
--
-- Idempotente: `drop constraint if exists` + `add constraint`; os updates só tocam linhas que
-- ainda violam a regra.
alter table assistant_orchestrators drop constraint if exists assistant_orchestrators_policy_kind_check;
alter table assistant_orchestrators
  add constraint assistant_orchestrators_policy_kind_check
    check (policy_kind in ('DOMAIN', 'TRANSVERSAL', 'MULTIDOMAIN', 'MANAGERIAL', 'INTERACTIVE'));

update assistant_orchestrators
   set policy_kind = 'INTERACTIVE', policy_domains = '{}', updated_at = now()
 where policy_kind is null and invocation_mode = 'INTERACTIVE';

update assistant_orchestrators
   set active = false, updated_at = now()
 where policy_kind is null and active;

alter table assistant_orchestrators drop constraint if exists assistant_orchestrators_active_requires_policy;
alter table assistant_orchestrators
  add constraint assistant_orchestrators_active_requires_policy
    check (not active or policy_kind is not null);

alter table assistant_orchestrators drop constraint if exists assistant_orchestrators_interactive_policy_mode;
alter table assistant_orchestrators
  add constraint assistant_orchestrators_interactive_policy_mode
    check (policy_kind <> 'INTERACTIVE' or invocation_mode = 'INTERACTIVE');
