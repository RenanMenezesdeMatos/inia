# Goldfish Annotated Review Report — Ciência com concordância

## Situação

* Rodada única sobre a v1 (173 linhas), com quatro revisores Goldfish novos e só leitura, despachados em paralelo (sem sintetizador). Cada um leu a persona oficial de `google/elephant-goldfish-model` (`agents/*.md`, baixadas em 10/11/2026) e o padrão de documento correspondente. O plugin EGM não está instalado: o isolamento do `CLAUDE.md` não foi garantido.
  * Estágios 5/8 — Zoom Out: [zoom_out_report.md](zoom_out_report.md)
  * Estágio 6 — Comprehension: [comprehension_report.md](comprehension_report.md)
  * Estágio 7 — Design Critic + Structural: [critic_report.md](critic_report.md)
  * Estágio 9 — Implementation Readiness + Codebase Details: [implementation_readiness_report.md](implementation_readiness_report.md)
* Todos os achados resolvidos pelo Elefante na v2. Sem re-auditoria do documento; no lugar, uma revisão Goldfish do CÓDIGO depois da implementação.
* Regra de resolução: detalhe técnico o Elefante resolve; o que muda experiência, regra de negócio ou conformidade fica marcado **→ confirmar** para o dono do produto.

## Resoluções

| Achado(s) | Sev. | Categoria | Resolução na v2 |
| --- | --- | --- | --- |
| ZO-1, DC-1 | Blocker | PROPOSE FIX | Ciência sem concordância (anterior à mudança) pode registrar a escolha UMA vez, pelo mesmo diálogo e com as mesmas credenciais (§4.8). Discordar depois de concordar não existe (escolha única). Registrado em `docs/security/README.md` **→ confirmar** |
| IR-1 | Blocker | PROPOSE FIX | `evaluation` no `operatorFeedbackRowSchema`, cópia no `mapOperatorFeedbackHistory`, contrato validado na prova |
| IR-2 | Blocker | PROPOSE FIX | Lista "Testes existentes" com a ação de cada arquivo (§9) |
| ZO-2, DC-13 | Major | PROPOSE FIX (parcial) | Tabela própria mantida, com a justificativa corrigida (o filtro seria um ponto só; os motivos que ficam: unicidade vigente da utilidade, imutabilidade, leitores futuros). A união mora numa VISÃO `feedback_contestations`, usada pela fila e pelo item do colaborador |
| ZO-3, DC-10, IR-14 | Major | PROPOSE FIX | Sem predicado de abrangência (toda fonte de ciência é abrangida). `POST /feedback-ratings` = 410 fixo; `GET` retirado; `rateFeedback`, `listMyRatings`, `sameRating` e o esquema de entrada removidos |
| ZO-4, DC-4, CP-1 | Major | PROPOSE FIX | Códigos dos motivos mantidos (pedido explícito). Rótulos e perguntas revistos para a discordância num catálogo único `CONTESTATION_REASON_COPY`. Selo e filtro de origem na fila |
| CP-2, ZO-6, IR-5 | Major | PROPOSE FIX | `ReadingEvaluation` no rodapé do item (o lugar do Joinha), sempre visível, com ou sem ciência |
| CP-3 | Major | PROPOSE FIX | Regra de junção: o `evaluation` do servidor vale quando traz a escolha; o mapa da sessão só cobre o intervalo. O cache das entregas recebe a escolha |
| CP-4 | Major | PROPOSE FIX | Escolha, motivo e justificativa ficam no controle até o sucesso (fechar e reabrir mantém) |
| CP-5 | Major | PROPOSE FIX | `max-h-[calc(100dvh-2rem)] overflow-y-auto` no diálogo; verificação em 375 px |
| CP-6, DC-6 | Major | PROPOSE FIX | Texto simples dizendo quem lê (quem revisa feedbacks da equipe, que pode ser a liderança) e onde a resposta aparece; título = a pergunta. `evaluation` só para o próprio destinatário (filtro pela pessoa da sessão + teste) |
| CP-7 | Major | PROPOSE FIX | Contestação antiga aparece com ou sem ciência; registro único resolve as ciências antigas |
| DC-2, IR-8 | Major | PROPOSE FIX | Fases com gate; ordem de implantação (migration e todas as APIs antes do frontend); reversão; consulta de reconciliação. Trigger entre módulos rejeitado (acoplamento; o seed e provas de outros módulos gravam `acknowledged_at` direto) |
| DC-3, ZO-7, IR-4 | Major | PROPOSE FIX | Já com ciência e com escolha: pula só a escolha e o aviso; auditoria, evento CONFIRMED e conclusão da aplicação continuam |
| DC-5 | Major | PROPOSE FIX | Limite herdado declarado: entregas não são paginadas hoje (fonte atrás de `INIA_INTERACTION_FEEDBACK_PIPELINE`, desligada por padrão) |
| DC-7 | Major | PROPOSE FIX | Riscos em tabela risco → impacto → mitigação |
| IR-3, ZO-5 | Major | PROPOSE FIX | Entregas enriquecidas no router (`feedback-delivery-router.ts`), fora do caso de uso |
| IR-6 | Major | PROPOSE FIX | Chaves antigas mantidas como legado; novas: `feedback.confirm_reading.agree`, `.disagree`, `.continue`, `.change`, `feedback.evaluation.details`, `feedback.evaluation.register`; JSON regenerado; catálogo atualizado |
| IR-7 | Major | PROPOSE FIX | Documentado: o limitador HTTP conta o 400; aba antiga chega a 429 depois de 10 erros. Sem mudança no controle de segurança |
| IR-9 | Major | PROPOSE FIX | Falha provocada por escolha pré-inserida (índice único) → 409 e tudo desfeito; concorrência só com discordâncias; revisor e limpeza na prova; app HTTP com `VALIDATION_ERROR` |
| IR-10, DC-9 | Major | PROPOSE FIX | `entity_type` por origem (`feedback_rating` / `feedback_read_agreement`); visão expõe `organization_id`; aviso recebe `origin` |
| IR-11 | Major | PROPOSE FIX | Lista de arquivos com Criar/Alterar/Apagar (§9), com Wiki, `wiki-reference.ts`, `CLAUDE.md` e docs |
| DC-8, IR-12 | Nit | PROPOSE FIX | `char_length(btrim(justification)) between 1 and 1000`; trigger que recusa UPDATE; `created_at` = `acknowledged_at` devolvido pela fonte |
| DC-12 | Nit | PROPOSE FIX | Detalhe da contestação mostra a escolha registrada depois na ciência do mesmo feedback |
| DC-14 | Nit | PROPOSE FIX | Alternativas A6 (colunas na fonte) e A7 (tabela única com carga) |
| DC-11, CP-9 | Nit | PROPOSE FIX | Implantação fora do turno e recarga; 410 com mensagem própria |
| CP-8, CP-10, IR-15, IR-13, CP-11, DC-15, IR-16 | Nit | PROPOSE FIX | Detalhes de tela, glossário, formatação e testes nomeados |
| ZO-9 | Nit | PROPOSE FIX | Métricas de utilidade marcadas como congeladas no dicionário |
| ZO-8 | Nit | CONTEST | `account_id` fica: a escolha é registro de negócio; o evento de usabilidade pode ter retenção própria e não liga a escolha à conta |
| ZO-10 | Nit | PROPOSE FIX | Decisões sem nomes de função; nomes só no plano |
