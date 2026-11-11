# Goldfish Review Report — Estágio 7 (Critic: design + structural)

**Target:** `docs/designs/ciencia-com-concordancia/design_draft.md` v1 (FeatureRange 1–144)
**Reviewer:** `egm-design` + `egm-structural` (subagente novo, só leitura) · **Status:** completed

| Id | Lente | Sev. | Resumo |
| --- | --- | --- | --- |
| DC-1 | design | Blocker | Remove o canal de contestação depois da ciência (ciências antigas e quem concordou) — controle do LGPD art. 20; decidir e registrar; oferecer registro único da escolha nas ciências sem concordância |
| DC-2 | design | Major | "Nunca ciência sem escolha" só no código: instância antiga durante o deploy, seed demo; garantir no banco ou declarar ordem de deploy + reconciliação |
| DC-3 | design | Major | Já com ciência: manter evento, auditoria e conclusão da aplicação; mapear 23505 para `alreadyConfirmed` |
| DC-4 | design | Major | Motivos de utilidade como motivos de discordância; filtro por motivo mistura origens |
| DC-5 | design | Major | Entregas sem LIMIT: o "sem lista ilimitada" não vale para elas |
| DC-6 | design | Major | Privacidade: só montar `evaluation` quando viewer = destinatário; dizer que o revisor pode ser a liderança (MY_STRUCTURE) |
| DC-7 | structural | Major | Riscos sem mitigação; faltam privacidade, falha do aviso desfazendo a ciência, deploy/rollback |
| DC-8 | design | Nit | Justificativa só com espaços passa no check; imutabilidade só no código; `created_at` da entrega deve vir do `acknowledged_at` devolvido; consistência pessoa/fonte |
| DC-9 | design | Nit | Id da contestação sem origem; auditoria com `entity_type` fixo |
| DC-10 | design | Nit | Predicado de abrangência só no D4 |
| DC-11 | design | Nit | Tela antiga em laço "Tente de novo"; quando sai o GET |
| DC-12 | design | Nit | DOWN antigo + AGREE posterior sem contexto na fila |
| DC-13 | structural | Nit | "O que é contestação" em dois lugares; dependências entre módulos |
| DC-14 | structural | Nit | Alternativas: colunas na fonte; tabela única de contestações com carga |
| DC-15 | structural | Nit | Formatação (três ações, H3, linguagem dos blocos, docs/security) |
