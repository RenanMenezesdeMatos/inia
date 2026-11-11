# Goldfish Review Report — Estágios 5/8 (Zoom Out)

**Target:** `docs/designs/ciencia-com-concordancia/design_draft.md` v1 (arquivo inteiro)
**Reviewer:** `egm-zoom-out` (subagente novo, só leitura) · **Status:** completed

| Id | Sev. | Escopo | Resumo |
| --- | --- | --- | --- |
| ZO-1 | Blocker | §2, D3, D4, §5; `docs/security/README.md:53` | A revisão das contestações é o controle do LGPD art. 20; ciências anteriores ao deploy (e quem concordou e depois quer contestar) ficam sem caminho. Permitir registrar a concordância uma vez nas ciências sem concordância, ou registrar a decisão em docs/security |
| ZO-2 | Major | D1, D2, A1 | `ratingsHistorySql` é um helper único: o filtro seria um ponto só. Reavaliar A1 com `kind`; se D1 ficar, pôr a união num lugar só (visão `feedback_contestations`) |
| ZO-3 | Major | D4, D6 | Toda fonte é abrangida: a função de abrangência sempre devolve verdadeiro; GET fica órfão; `rateFeedback`, `listMyRatings`, `sameRating` viram código morto. Retirar as rotas (ou 410 fixo no router) |
| ZO-4 | Major | G2, D1, A2 | Motivos de utilidade ("Não me ajudou a melhorar"…) sob "Não concordo" reintroduzem a mistura; registrar a tensão ou definir textos próprios |
| ZO-5 | Nit | D5 | `listMyFeedbackDeliveries` só recebe a porta `deliveries`: enriquecer no router; citar a flag `INIA_INTERACTION_FEEDBACK_PIPELINE` (OFF por padrão) |
| ZO-6 | Nit | D6 | Usar o `footer` do `IniaFeedItem` (sempre visível) no lugar do Joinha |
| ZO-7 | Nit | D3 × G3 | "Nada é gravado" contradiz a auditoria e o evento CONFIRMED com `alreadyConfirmed` de hoje: manter os dois |
| ZO-8 | Nit | D1 `account_id` | Conta já está no evento e na auditoria |
| ZO-9 | Nit | §2 | Métricas de utilidade e etapa RATED caem a zero sem aviso: marcar como congeladas no dicionário |
| ZO-10 | Nit | D2, plano | Altitude: nomes de funções/colunas só no plano |
