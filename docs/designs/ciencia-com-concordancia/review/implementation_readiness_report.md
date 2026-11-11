# Goldfish Review Report — Estágio 9 (Implementation Readiness + Codebase Details)

**Target:** `docs/designs/ciencia-com-concordancia/design_draft.md` v1 (DetailedRange 145–173, contra o tronco b2fca0dd)
**Reviewer:** `egm-implementation-readiness` + `egm-codebase-details` (subagente novo, só leitura) · **Status:** completed

| Id | Lente | Sev. | Resumo |
| --- | --- | --- | --- |
| IR-1 | codebase | Blocker | `operatorFeedbackRowSchema` (z.object) descarta `evaluation` e `mapOperatorFeedbackHistory` copia campo a campo: incluir os dois e validar no contrato da prova |
| IR-2 | codebase | Blocker | Testes que quebram sem plano: feedback-rating-proof, feedback-contestation-proof (rateFeedback/NONE), read-confirmation-proof (sem agreement), delivered-feedback.test, feedback-application.test, confirm-reading-control.test, feedback-contestations.test |
| IR-3 | codebase | Major | `listMyFeedbackDeliveries` só tem a porta `deliveries` (fake em memória): enriquecer no router |
| IR-4 | codebase | Major | Já com ciência: auditoria e evento CONFIRMED continuam (a prova exige 4) |
| IR-5 | readiness | Major | Contestação legada sem ciência sumiria (controle dentro de acordeão; só no estado confirmado): mostrar com ou sem ciência, fora do acordeão |
| IR-6 | codebase | Major | Catálogo de uso: manter as chaves antigas (legado), listar as novas, regenerar o JSON, atualizar o catálogo em docs |
| IR-7 | codebase | Major | O limitador HTTP da ciência conta todo ≥ 400 (inclusive o 400 de validação) |
| IR-8 | readiness | Major | Sem fases nem ordem de implantação; frontend novo × API antiga perde a escolha; `agreement` do resultado indefinido; reversão |
| IR-9 | readiness | Major | Como provocar a falha que desfaz a ciência; concorrência não determinística; revisor e limpeza na prova; app HTTP sem VALIDATION_ERROR |
| IR-10 | codebase | Major | `entity_type` da auditoria por origem; `organization_id` e junção por origem na união; assinatura do aviso |
| IR-11 | readiness | Major | Arquivos sem Criar/Alterar/Apagar; Wiki, wiki-reference e CLAUDE.md da raiz faltando |
| IR-12 | readiness | Nit | `source_kind` sem not null; defaults; 3..1000 do banco × UTF-16 do zod (usar 1..1000) |
| IR-13 | readiness | Nit | "Só SQL desta tabela aqui" contradiz os itens 4–5 |
| IR-14 | codebase | Nit | `assertRateableSource` não devolve `feedback_kind`; abrangência condicional × obrigatoriedade incondicional |
| IR-15 | readiness | Nit | Foco inicial, reabrir zera a escolha?, mensagem de `alreadyConfirmed` com `agreement: null`, mudança em `inia-feed.tsx` |
| IR-16 | readiness | Nit | Nomes dos testes do chat; teste do selo de origem; tipos por `z.infer` |
