# Ciência com concordância — desenho (v2)

* **Autor:** Renan Menezes (Elefante: Claude)
* **Data:** 2026-11-10 · v2 depois da revisão Goldfish ([review/goldfish_review_report.md](review/goldfish_review_report.md))
* **Base:** tronco `b2fca0dd` (worktree `claude/ciencia-concordancia`)
* **Pedido:** unificar a avaliação dos feedbacks de indicador e de monitoria com a confirmação de ciência e tirar a avaliação separada por polegar ("Joinha") desses feedbacks.

## 1. Contexto e problema

Hoje cada feedback do Acompanhamento do colaborador tem duas ações independentes, e uma consequência da segunda:

1. **Confirmar ciência** (`POST /api/v1/feedback-read-confirmations`, migration 114). Diálogo central com login e senha da própria conta, trava de 5 falhas de credencial em 15 min, transação que grava `acknowledged_at` na fonte, conclui a aplicação em andamento (a conversa "Ouvir com a INIA" sobre aquele feedback), grava a auditoria `FEEDBACK_READ_CONFIRMED` e o evento `CONFIRMED` no registro de usabilidade `feedback_read_confirmation_events`. Idempotente (`alreadyConfirmed`).
2. **"Este conteúdo foi útil?"** (`POST /api/v1/feedback-ratings`, migration 113), no rodapé do item do feed. Polegar para cima grava `UP`; para baixo abre um Popover de 2 etapas (motivo de uma lista fechada → descrição 3–1000 com uma pergunta por motivo) e grava `DOWN`. `feedback_ratings` é histórico mutável (troca ou retira).
3. Todo `DOWN` vigente é uma **contestação** (migration 150; controle do LGPD art. 20 em `docs/security/README.md`): quem tem `feedback_contestations.review` no escopo do colaborador é avisado no sino, responde uma vez em Administração › Contestações de feedback, e o colaborador lê a resposta em "Ver resposta" e recebe o aviso "Sua contestação foi respondida".

O produto quer UMA avaliação, no momento em que o colaborador confirma que leu: ele diz se **concorda** com o feedback. Discordar exige motivo e justificativa e vira contestação. Concordando ou discordando, a ciência é registrada (ciência = "li", não "aceito").

**Fontes abrangidas.** As duas fontes de ciência: feedback publicado (`feedbacks.feedback_kind` é o enum `INDICATOR | MONITORING`, migration 004 — não há outro valor) e feedback de atendimento entregue (`interaction_feedback_deliveries`, monitoria de uma chamada; só existe com `INIA_INTERACTION_FEEDBACK_PIPELINE=ON`, desligado por padrão). Todo feedback com ciência é abrangido; um tipo novo de feedback, se surgir, precisa de decisão própria. "Leitura do dia" não tem ciência nem avaliação. O curtir/descurtir das respostas do chat (`assistant_interaction_ratings`, migration 158) não muda.

## 2. Objetivos e fora de escopo

**Objetivos**
* G1. A confirmação pede, sem opção marcada, "Concordo com o feedback" ou "Não concordo com o feedback".
* G2. Discordar mostra os motivos de hoje (mesmos códigos); escolhido o motivo, abre a justificativa obrigatória com os limites de hoje (3–1000) e uma pergunta por motivo.
* G3. Login e senha da própria conta continuam obrigatórios, com a mesma trava, a mesma auditoria e os mesmos eventos.
* G4. Ciência e escolha na mesma transação: falhou uma, nada é gravado. O backend valida tudo.
* G5. A discordância entra na MESMA fila e na MESMA revisão humana de contestações (permissão, tela, avisos, auditoria, resposta).
* G6. O item mostra a escolha e, quando houver, motivo, justificativa e a resposta da revisão (ou "aguardando").
* G7. Sem polegar nos feedbacks. Contestações antigas continuam visíveis com a resposta, com ou sem ciência.
* G8. O endpoint antigo não grava mais nada.

**Fora de escopo**
* O que a liderança vê do item: continua só o ESTADO da ciência.
* Mudar a escolha depois de registrada; discordar depois de concordar (**→ confirmar**, ver §4.8).
* Converter avaliações antigas em concordância; presumir concordância de ciência antiga.
* Métricas de concordância na Monitoria de usabilidade (desligada). As métricas de utilidade ficam congeladas na data da mudança.
* Curtir/descurtir do chat; Workflows; outros conteúdos.

## 3. Glossário

* **Ciência** — `acknowledged_at` da fonte; "o colaborador leu". Ato único.
* **Concordância** — escolha `AGREE | DISAGREE` registrada com a ciência (tabela `feedback_read_agreements`). Uma por fonte, imutável.
* **Discordância** — concordância `DISAGREE`, com motivo e justificativa.
* **Avaliação de utilidade (legado)** — `feedback_ratings` (`UP | DOWN | NONE`), o "Este conteúdo foi útil?". Só leitura a partir desta mudança.
* **Contestação** — o que a revisão humana responde: avaliação de utilidade `DOWN` (legado) ou discordância. Uma resposta por contestação (`feedback_rating_reviews`).
* **Joinha** — os polegares do "Este conteúdo foi útil?" no rodapé do item (`IniaFeedItem.footer`).
* **Aplicação** — a conversa "Ouvir com a INIA" sobre um feedback; confirmar a ciência a conclui.
* Mais termos da área: [docs/dev/memoria/experiencia-do-colaborador.md](../../dev/memoria/experiencia-do-colaborador.md).

## 4. Decisões

### 4.1 Tabela própria para a concordância

A concordância não vai para `feedback_ratings`. O filtro dos leitores da Monitoria de usabilidade seria um ponto só (`ratingsHistorySql`), mas sobram três motivos: o índice "uma vigente por pessoa × fonte" faria a concordância encerrar a avaliação de utilidade (ou exigiria mudar a unicidade); a tabela é histórico mutável, a concordância é imutável; e todo leitor futuro de `feedback_ratings` precisaria lembrar do filtro para não misturar "útil" com "concordo". Tabela `feedback_read_agreements`: uma linha por fonte (índice único por fonte), organização, pessoa e conta da sessão, escolha, motivo e justificativa só na discordância (check), instante = o da ciência gravada. Imutável também no banco (trigger recusa UPDATE). Detalhe no plano (§9, item 1).

### 4.2 A discordância reaproveita a revisão de contestações

`feedback_rating_reviews` passa a apontar para uma avaliação antiga OU para uma discordância (exatamente uma; `agreement_id` único). "O que é uma contestação" fica num lugar só: a visão `feedback_contestations` (avaliação `DOWN` ∪ discordância, com origem, organização, pessoa, fonte, motivo, texto, data, encerrada e a resposta, se houver). A fila, o detalhe, a resposta e o item do colaborador leem a visão. Mesma permissão, mesma tela, mesmos avisos (as chaves `feedback_contestation:<id>:…` e `feedback_contestation_answer:<id>:<fonte>` não mudam, então o roteamento do sino também não), mesma auditoria — com o tipo de entidade pela origem. O item da fila ganha a origem (selo e filtro). O detalhe de uma contestação antiga mostra a escolha registrada depois, na ciência do mesmo feedback.

### 4.3 A confirmação recebe a escolha e grava tudo numa transação

`POST /feedback-read-confirmations` passa a exigir `agreement` (`{ value: AGREE }` ou `{ value: DISAGREE, reason, justification }`), com o corpo `.strict()`. Corpo inválido = 400 `VALIDATION_ERROR` antes de conferir as credenciais (não conta na trava de domínio; o limitador HTTP de 10 respostas ≥ 400 por conta em 15 min conta, como qualquer erro).

Na transação de sucesso que já existe (lock por fonte + `for update` na fonte):

| Situação da fonte | O que acontece |
| --- | --- |
| Sem ciência | Grava a ciência; grava a escolha com o instante devolvido pela fonte; se discordou, avisa os revisores; auditoria com a escolha (`agreement`, `agreementId`, `reason`; a justificativa só na tabela); evento `CONFIRMED`; conclui a aplicação em andamento |
| Com ciência e com escolha (outra aba, clique repetido, resposta perdida) | Nenhuma escolha nem aviso; auditoria e evento `CONFIRMED` com `alreadyConfirmed` e conclusão da aplicação como hoje; devolve a escolha registrada (a da primeira vez, mesmo que este pedido traga outra) |
| Com ciência e sem escolha (anterior à mudança) | Grava a escolha agora (registro único, §4.8); aviso se discordou; auditoria e evento como acima |

Qualquer falha desfaz tudo. Escolha já existente para fonte sem ciência (estado impossível pelo código; índice único) = 409 `FEEDBACK_READ_AGREEMENT_CONFLICT`, nada gravado. O resultado ganha `agreement` (sempre presente; `null` só se a fonte não tem escolha).

### 4.4 O endpoint antigo deixa de existir

`POST /feedback-ratings` responde 410 `FEEDBACK_RATING_REPLACED_BY_READ_CONFIRMATION` ("A avaliação deste feedback agora é feita ao confirmar a ciência. Atualize a página."), fixo no router. `GET /feedback-ratings` sai (não tem mais consumidor). O serviço de gravação de avaliações sai; os dados antigos ficam.

### 4.5 O item do Acompanhamento traz a avaliação

Um leitor do módulo de avaliação devolve, para as fontes de uma página e SÓ da pessoa da sessão, a escolha (com a resposta da revisão) e a contestação antiga vigente (com a resposta). Usado pelo `/operator/overview` e `/operator/feedbacks` (só o próprio operador; o carregador recusa montar `evaluation` se quem lê não é o destinatário) e pela rota das entregas do próprio colaborador (enriquecida no router). O feed da liderança não recebe nada disso. Limite herdado: as entregas não são paginadas hoje.

### 4.6 Frontend

**Diálogo de ciência** (o mesmo controle no Acompanhamento e na sessão "Ouvir com a INIA"):

* Etapa 1 de 2 — título "Você concorda com este feedback?"; RadioGroup com "Concordo com o feedback" e "Não concordo com o feedback", nada marcado, foco na primeira opção. "Não concordo" revela "Por que você não concorda?" com os motivos (RadioGroup); escolhido o motivo, aparece a justificativa: rótulo = a pergunta do motivo, placeholder "Escreva sua justificativa", contador, 3–1000. Trocar o motivo mantém o texto. Nota em linguagem simples: "Não concordar não impede a ciência. Seu motivo e sua justificativa vão para quem revisa os feedbacks da sua equipe (pode ser a sua liderança). A resposta aparece aqui, no feedback, e você recebe um aviso." "Continuar" só habilita com a etapa válida.
* Etapa 2 de 2 — a confirmação de hoje (login, senha, avisos), com o resumo da escolha e "Alterar".
* A escolha, o motivo e a justificativa ficam no controle até o sucesso: fechar, cancelar, errar a senha ou cair na trava não apagam o texto.
* `max-h-[calc(100dvh-2rem)] overflow-y-auto` no conteúdo do diálogo (celular com teclado).
* `alreadyConfirmed` com escolha diferente da enviada (valor, motivo ou texto): aviso (toast) "Este feedback já tinha ciência confirmada. Vale a escolha registrada na primeira confirmação."

**Rodapé do item** (`ReadingEvaluation`, no lugar do Joinha, sempre visível):

* Concordou: "Você concordou com o feedback."
* Discordou: "Você não concordou com o feedback · ‹Aguardando resposta | Resposta da revisão›" + "Ver detalhes" (abre em linha: motivo, justificativa como texto puro, resposta com decisão e data).
* Ciência sem escolha (anterior): "Você ainda não disse se concorda com este feedback." + "Dizer se concorda" → o mesmo diálogo, título "Você concorda com este feedback?", que registra só a escolha.
* Contestação antiga (com ou sem ciência): "Avaliação anterior: não foi útil · ‹Aguardando resposta | Resposta da revisão›" + detalhes em linha.
* Dados: o `evaluation` do servidor vale quando traz a escolha; senão, o mapa da sessão do navegador (gravado ao confirmar aqui ou na sessão) cobre até o próximo carregamento. O cache das entregas recebe a escolha.

**Administração › Contestações**: selo e filtro de origem ("Discordância na ciência" × "Avaliação “não foi útil”").

**Removidos**: o componente do Joinha (e teste), a query e o serviço de avaliações e os esquemas que só eles usavam.

### 4.7 Textos dos motivos

Os sete códigos ficam (pedido: reaproveitar os motivos). Um catálogo único de rótulo + pergunta, revisto para a discordância e usado também pela Administração:

| Código | Rótulo | Pergunta da justificativa |
| --- | --- | --- |
| POOR_WRITING | O texto está confuso ou mal escrito | O que no texto atrapalhou o entendimento? |
| WRONG_PROCESS | O processo citado está errado | Qual orientação está errada e qual seria a correta? |
| UNCLEAR | O feedback não ficou claro | Qual parte você não entendeu? |
| INIA_COULD_NOT_ANSWER | A INIA não soube responder minha dúvida | Qual dúvida você fez e o que faltou na resposta? |
| INACCURATE | Não condiz com o que aconteceu | O que está diferente do que aconteceu na chamada ou nos seus resultados? |
| NOT_HELPFUL | A orientação não me ajuda a melhorar | Por que essa orientação não ajuda você no dia a dia? |
| OTHER | Outro motivo | Conte por que você não concorda com este feedback. |

### 4.8 Ciências anteriores e o canal de contestação (LGPD art. 20)

Sem o polegar, a contestação passa a acontecer na ciência. Para não deixar sem canal quem já tinha confirmado ciência antes da mudança, a ciência sem escolha pode registrar a escolha UMA vez ("Dizer se concorda", mesmo diálogo, mesmas credenciais, mesma tabela). Quem concordou não tem um segundo canal no sistema (**→ confirmar** com o dono do produto; registrado em `docs/security/README.md`).

## 5. Compatibilidade, implantação e reversão

* Dados antigos ficam como estão: avaliações, revisões, permissões. Contestações antigas continuam na fila e no item.
* **Ordem de implantação**: migration 186 → todas as APIs → frontend (no IIS, a mesma janela; fora do turno). Frontend novo com API antiga perderia a escolha.
* Tela antiga aberta: confirmar sem `agreement` = 400 ("Não foi possível confirmar agora"); polegar = 410. Recarregar resolve. Depois de 10 erros a conta cai no limitador HTTP por 15 min.
* **Reconciliação** depois da implantação: ciências com `acknowledged_at` posterior ao corte e sem escolha (consulta em §9, item 19) devem ser zero.
* **Reversão**: a 186 é aditiva e compatível com o código antigo (a única mudança em tabela existente é `rating_id` aceitar nulo e uma coluna nova). Voltar o código restaura o polegar; as escolhas gravadas ficam.

## 6. Alternativas consideradas

* **A1. Concordância em `feedback_ratings` (valores novos ou coluna `kind`).** Sem mudança em `feedback_rating_reviews`. Rejeitada pelos motivos de §4.1.
* **A2. Discordância como `DOWN` e concordância como `UP`.** Zero mudança na fila. Rejeitada: transformaria toda ciência em avaliação de utilidade e mudaria o significado das métricas de utilidade.
* **A3. Tabela nova de revisões para discordâncias.** Rejeitada: segundo mecanismo de revisão (fila, tela, avisos e permissão duplicados).
* **A4. Ler pelo `GET /feedback-ratings` (todas as avaliações da pessoa).** Rejeitada: cresceria com cada ciência; o enriquecimento por página segue o padrão do feed (materiais, origem, cabeçalho legado).
* **A5. Escolha e credenciais na mesma tela.** Um clique a menos para quem concorda, mas com "Não concordo" o diálogo passa de 650 px. Etapas mantêm a confirmação de hoje intacta.
* **A6. Colunas de concordância na própria fonte (`feedbacks`, `interaction_feedback_deliveries`).** Duas tabelas de outros módulos alteradas, duas escritas, e a revisão continuaria precisando apontar para algo. Rejeitada.
* **A7. Tabela única de contestações com carga das `DOWN` antigas.** Evitaria a união, mas copia/converte registros antigos e muda o alvo das revisões já respondidas. Rejeitada ("preservar registros antigos").

## 7. Riscos

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Quem concordou não consegue contestar depois | Canal do art. 20 só na ciência | Decisão registrada em docs/security; **→ confirmar** |
| Instância antiga da API durante a implantação | Ciência sem escolha | Ordem de implantação + reconciliação (§5) |
| Falha no aviso aos revisores desfaz a ciência | O colaborador tenta de novo | Aceito: G4 (nunca ciência sem a escolha e a contestação completa) |
| Justificativa lida pela liderança com papel de revisor | Exposição do texto | Texto da tela diz quem lê; `evaluation` só para o próprio destinatário |
| Fila com duas origens para o mesmo feedback | Revisor vê dois itens | Selo e filtro de origem; detalhe mostra a escolha posterior |
| Entregas sem paginação | Leitura cresce com as entregas | Limite herdado; fonte desligada por padrão |
| Métricas de utilidade param de crescer | Parece queda | Marcadas como congeladas no dicionário |

## 8. Fases

1. Migration + backend + provas Postgres (gate: provas verdes, typecheck).
2. Frontend + catálogo de uso + testes (gate: vitest, typecheck, lint, verificação no navegador em 1280 e 375 px).
3. Wiki, docs de segurança, memória da área, revisão Goldfish do código.

## 9. Detailed Implementation Plan

Legenda: **C** criar · **A** alterar · **X** apagar.

### Backend
1. **C** `backend/migrations/186_feedback_read_agreements.sql` — tabela (`source_kind not null`, defaults, `char_length(btrim(justification)) between 1 and 1000`, checks de fonte única e de detalhe da discordância, índices únicos por fonte, índice parcial da fila), trigger de imutabilidade, `feedback_rating_reviews.agreement_id` + `rating_id` nulo + check de exatamente um, visão `feedback_contestations`.
2. **A** `feedback-rating/domain/feedback-rating.ts` — esquema da escolha, tipos da visão do colaborador, origens; **X** esquema de entrada da avaliação e `sameRating`.
3. **C** `feedback-rating/application/read-agreement-service.ts` — gravar a escolha (insert + aviso) e ler a escolha de uma fonte.
4. **C** `feedback-rating/application/feedback-evaluation-reader.ts` — avaliação por fonte (pela visão), só da pessoa da sessão.
5. **A** `feedback-rating/application/contestation-review-service.ts` — base na visão; `origin` no item e filtro; resposta por origem; `entity_type` por origem; aviso com origem; escolha posterior no detalhe.
6. **X** `feedback-rating/application/feedback-rating-service.ts`; **A** `feedback-rating/presentation/feedback-ratings-router.ts` (só o 410); **A** `feedback-contestations-router.ts` (filtro de origem).
7. **A** `feedback-application/presentation/feedback-read-confirmations-router.ts` — `agreement` obrigatório, `.strict()`.
8. **A** `feedback-application/application/read-confirmation-service.ts` — tabela de §4.3.
9. **A** `reporting/application/fetch-operator-overview.ts` — `evaluation` por item (só quando quem lê é o destinatário).
10. **A** `interaction-feedback/presentation/feedback-delivery-router.ts` — `evaluation` por entrega.
11. **A** `usage-analytics/domain/usage-elements.ts` (chaves novas; antigas marcadas legado), `metric-dictionary.ts` (congeladas); regenerar `frontend/src/lib/usage/usage-catalog.generated.json`.

### Frontend
12. **A** `schemas/feedback-ratings/feedback-rating.schema.ts` — `CONTESTATION_REASON_COPY`, escolha, avaliação do item; **X** esquemas de utilidade sem uso.
13. **A** `schemas/feedback-read-confirmations/feedback-read-confirmation.schema.ts` — entrada e `agreement` no resultado.
14. **A** `schemas/operator/operator-overview.schema.ts`, `schemas/operator/operator-indicators.schema.ts`, `services/operator/operator-feed.ts` (mapper), `schemas/feedback-delivery/feedback-delivery.schema.ts`, `schemas/admin/feedback-contestation.schema.ts`.
15. **A** `queries/feedback-read-confirmations/use-feedback-read-confirmation.ts` — mapa `{ acknowledgedAt, agreement }`, cache das entregas.
16. **A** `components/feedbacks/confirm-reading/confirm-reading-control.tsx`; **C** `confirm-reading/agreement-step.tsx`, `confirm-reading/reading-evaluation.tsx`.
17. **A** `components/operator/operator-daily-feedback-feed.tsx` (rodapé = `ReadingEvaluation`), `components/operator/inia-feed.tsx` (comentário do rodapé); **X** `components/feedbacks/feedback-rating.tsx`, `feedback-rating.test.tsx`, `queries/feedback-ratings/use-feedback-ratings.ts`, `services/feedback-ratings/feedback-ratings-service.ts`.
18. **A** `components/admin/feedback-contestations/feedback-contestations-page.tsx`, `contestation-detail.tsx`, `services/admin/feedback-contestation-service.ts`.

### Documentação
19. **A** `frontend/src/app/wiki/acompanhamento/page.tsx`, `frontend/src/app/wiki/administracao/page.tsx`, `frontend/src/components/wiki/wiki-reference.ts`, `docs/security/README.md`, `docs/dev/memoria/experiencia-do-colaborador.md` (com a consulta de reconciliação), `docs/dev/monitoria-usabilidade-catalogo.md`, `CLAUDE.md` (parágrafo "Estado atual").

### Testes existentes
| Arquivo | Ação |
| --- | --- |
| `feedback-rating/domain/feedback-rating.test.ts` | Reescrever: esquema da escolha |
| `feedback-rating/testing/feedback-rating-proof.test.ts` | Reescrever: 410/404 das rotas antigas; dados antigos preservados e lidos pelo item |
| `feedback-rating/testing/feedback-contestation-proof.test.ts` | Legado semeado por SQL + aviso; caso de retirada vira "legado encerrado sem resposta fica fora da fila"; discordância na fila, resposta, origem, `entity_type` |
| `feedback-application/testing/read-confirmation-proof.test.ts` | `agreement` em todas as chamadas; casos novos (abaixo) |
| `frontend/.../confirm-reading-control.test.tsx`, `delivered-feedback.test.tsx`, `feedback-application.test.tsx`, `feedback-contestations.test.tsx` | Etapa nova, sem polegar, `origin` na fixture |
| `operator-inia-chat.test.tsx`, `assistant-conversations.test.tsx` | Rodar sem mudança (curtir/descurtir do chat) |

### Testes novos
* Domínio: esquema da escolha (ausente, valor inválido, motivo sem justificativa, só espaços, 1001, campo extra).
* Prova `read-confirmation-proof`: concordar; discordar (linha, aviso ao revisor, item na fila com origem); 400 sem `agreement`/inválido sem evento FAILED; senha errada não grava ciência nem escolha; 5 discordâncias concorrentes = 1 ciência, 1 escolha, 1 aviso por revisor; reenvio = `alreadyConfirmed` com a escolha registrada e evento/auditoria; ciência antiga sem escolha registra uma vez; escolha pré-inserida → 409 com ciência, evento e aviso desfeitos; contrato do feed e da ciência pelos esquemas zod do frontend.
* Prova `feedback-contestation-proof`: revisor responde a discordância; colaborador vê a resposta no `evaluation`; aviso ao colaborador; outra pessoa não vê `evaluation` alheio.
* Frontend: diálogo (nada marcado; concordar → credenciais; discordar exige motivo e justificativa; limites; voltar/fechar mantém; erro de credencial mantém; corpo enviado), `ReadingEvaluation` (concordou, discordou com/sem resposta, legado com/sem ciência, ciência antiga → "Dizer se concorda"), feed sem polegar, mapper do feed, selo de origem.
