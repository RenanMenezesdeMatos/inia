-- PEN-008, ajuste de 04/11/2026: os produtos ("Vale para") de uma base seguem o ciclo da versão. Alterar produtos grava no rascunho e só
-- passa a valer quando a versão entra em uso; `product_scope_assignments` continua sendo o registro do que valeu em cada data, e por isso os
-- leitores do motor de feedback não mudam. Argumentários continuam com a regra própria (fora da PEN-008).
--
-- Só acrescenta colunas e acerta o rascunho: nenhuma abrangência em vigor muda, e nenhuma versão muda de situação.

alter table knowledge_versions
  -- Quem pediu a publicação: autor da abrangência por produto aberta na transição, que pode acontecer na varredura, sem sessão.
  add column publish_requested_by uuid references people(id) on delete set null,
  -- Base arquivada só volta a valer com a confirmação explícita de quem publicou, reverteu ou tentou de novo. Sem ela, a transição não
  -- acontece: publicar nunca reativa em silêncio.
  add column reactivation_confirmed_at timestamptz,
  add column reactivation_confirmed_by_name text;

-- Até aqui, os produtos valiam na hora e o rascunho guardava só uma fotografia, possivelmente antiga. Daqui em diante, o que está no rascunho
-- é o que vai valer: ele precisa partir do que está valendo, senão publicar um rascunho antigo mudaria os produtos sem ninguém pedir.
-- Uma versão em PROCESSING ou FAILED não existe antes da 167 e não existia no banco de desenvolvimento nesta data.
update knowledge_versions v
   set config = jsonb_set(v.config, '{productNodeIds}', coalesce((
         select to_jsonb(s.node_ids) from product_scope_assignments s
          where s.organization_id = v.organization_id and s.source_kind = 'KNOWLEDGE_DOCUMENT' and s.source_id = v.document_id and s.effective_until is null
          limit 1
       ), '[]'::jsonb))
 where v.status in ('DRAFT', 'APPROVED') and v.config is not null;
