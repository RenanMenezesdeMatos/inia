-- Política EXPLÍCITA de especialistas por Orquestrador (rodada de hardening 2026-09-16, Parte D).
--
-- Antes, "Orquestrador de domínio" era só um nome + um array de agent_ids que qualquer admin
-- podia montar como quisesse (Faturamento com Retenção dentro) e a fronteira vivia no prompt do
-- coordenador — prompt não é segurança. Agora:
--
-- - `agents.specialty` classifica o Especialista: um domínio de PROCESSO (FATURAMENTO, RETENCAO,
--   SUPORTE, CADASTRO), CROSS_CUTTING (transversal — Experiência, Qualidade, Eficiência: fala de
--   COMO o atendimento foi feito, em qualquer assunto) ou PERFORMANCE (indicadores/PRV/
--   reconhecimento, chamados direto por Workflow). NULL = sem classificação (legado/coordenador).
-- - `assistant_orchestrators.policy_kind` + `policy_domains`: DOMAIN (um domínio), TRANSVERSAL,
--   MULTIDOMAIN (domínios explicitamente autorizados) ou MANAGERIAL (pós-Join, sem especialista).
--   NULL = orquestrador não classificado (legado/teste) — sem restrição, documentado como tal.
--
-- A lista `assistant_orchestrator_specialists` continua sendo a autorização explícita (um
-- transversal só entra se for adicionado); o que a política acrescenta é o que NÃO pode entrar,
-- validado no backend (assistant-router.ts) na criação/edição — nunca só no runtime.
alter table agents
  add column if not exists specialty text
    check (specialty in ('FATURAMENTO', 'RETENCAO', 'SUPORTE', 'CADASTRO', 'CROSS_CUTTING', 'PERFORMANCE'));

alter table assistant_orchestrators
  add column if not exists policy_kind text
    check (policy_kind in ('DOMAIN', 'TRANSVERSAL', 'MULTIDOMAIN', 'MANAGERIAL')),
  add column if not exists policy_domains text[] not null default '{}';
