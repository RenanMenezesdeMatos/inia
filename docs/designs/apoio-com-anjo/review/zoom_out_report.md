# Goldfish Review Report — Estágio 5 (Zoom Out inicial)

**Target:** `docs/designs/apoio-com-anjo/design_draft.md` (arquivo inteiro, 766 linhas)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `zoom_out` | completed |
| `inventive_catalyst` | completed |

## Prioritized Findings (Blockers -> Major -> Nits)

### ZO-1 · Medição do chat presa ao Apoio com Anjo - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** Overview L12-17; Fases L612-619.
* **Discrepancy Description:** G1, G2 e M1–M6 (motivo e sinais) resolvem o problema de raiz sem Anjo, fila nem espera longa, mas a fase 1 depende do módulo `human-support` completo (fase 0) e, na prática, do risco do IIS (OQ1).
* **Rationale & Recommendation:** dividir a entrega em A (resolutividade do chat) e B (Apoio com Anjo), sem mudar decisões de produto.

### ZO-2 · M1–M6 calculadas no módulo errado - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** G7 L31; §13 L455-479; itens 12 e 25.
* **Discrepancy Description:** `human-support/metrics-service.ts` leria quatro tabelas do `assistant`, contra a regra "nenhum módulo lê tabela privada de outro".
* **Rationale & Recommendation:** `assistant` exporta uma porta de leitura do funil das respostas; `human-support` só compõe.

### ZO-3 · Descurtida gravada sem motivo contradiz a decisão do lote 4 - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §2 L158; G1; M4; CA1.
* **Discrepancy Description:** grava `DOWN` no clique e aceita fechar sem detalhes, criando "motivo não informado" e duas gravações por descurtida.
* **Rationale & Recommendation:** o polegar só abre o Popover; `DOWN` + detalhes numa chamada no "Enviar".

### ZO-4 · Administrador geral com `human_support.attend` - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §4 L214-218; área do Anjo L399; item 32.
* **Discrepancy Description:** a autorização do projeto é por permissão (`access-decision.ts`), e `rolesWithPermission` alimenta as consultas. Ou todo Administrador geral vira Anjo da organização, ou a permissão é inútil e a área aparece para ele.
* **Rationale & Recommendation:** Administrador geral só com `coordinate` e `manage`, delegando os dois papéis; elegibilidade pela permissão `attend`.

### ZO-5 · Elegibilidade copiada em vez de reaproveitada - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** L218; item 13.
* **Discrepancy Description:** `contestationReviewersOf` parte da estrutura atual de uma pessoa; o pedido usa Grupo/Subgrupo congelados — "parte de" vira cópia de SQL lendo `access_role_assignments` dentro do módulo novo.
* **Rationale & Recommendation:** função nova em `access/application/permission-holders.ts` (`personIdsWithPermissionCovering`).

### ZO-6 · Sugestão por três caminhos - Severity: Major
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §3 L187-192; itens 24 e 45.
* **Discrepancy Description:** `recordSuggestion`, evento SSE e `GET …/messages` consultando o apoio a cada mensagem; `/me/state` já entrega liga/desliga e pedido aberto.
* **Rationale & Recommendation:** mensagens trazem só os `signals`; o frontend compõe com `/me/state`; `recordSuggestion` só registra o evento.

### IC-1 · Estado declarado e conexão no mesmo `status` - Severity: Major
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §5 L241-262; §6 `ANJO_LOST`; §7 passos 2-3; CUJ 5.
* **Discrepancy Description:** aos 75 s a posse vencida grava `OFFLINE`; nada limpa `anjo_lost_at` e só se sai de `OFFLINE` por clique. Um Anjo que volta aos 80 s perde o atendimento aos 75 s + 3 min mesmo escrevendo; a pausa "Lanche" vira `OFFLINE` e distorce M17; o mesmo fato tem dois prazos.
* **Rationale & Recommendation:** `status` guarda só o declarado; "conectado" é calculado (`lease_until > now()`); os 3 min são carência em que renovar retoma tudo; só com `lease_until <= now() - 3 min` grava `OFFLINE` e interrompe. Eventos de queda e retorno para M17; uma única condição SQL com teste.

### IC-2 · Prova de vida da área do Anjo no canal compartilhado - Severity: Major
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §5 L255; §10 L412-421.
* **Discrepancy Description:** duas travas Web Locks independentes; a aba líder do canal pode ser outra (chat de um Anjo que também é operador); não está dito quem manda `workspace=anjo`. Resultado: queda sem motivo ou oferta tocada em aba sem som.
* **Rationale & Recommendation:** a aba da área toma a liderança do canal (`steal`), só ela manda `workspace=anjo`; o `AbortError` do `steal` não conta como falha.

### IC-3 · Distribuição no fim de todo comando e worker como ponto único - Severity: Major
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §7 L315, L328; NFR Disponibilidade.
* **Discrepancy Description:** erro em qualquer pedido desfaz o comando de outra pessoa (cancelar, encerrar, mensagem); com o worker parado, prazos não andam e o operador fica "Aguardando…" sem fim.
* **Rationale & Recommendation:** comando faz só a própria transição e confirma; distribuição depois, em transação própria com `pg_try_advisory_xact_lock`, um savepoint por pedido; o laço de 1 s das esperas também dispara a distribuição quando há prazo vencido; worker como reserva.

### IC-4 · Renovação de posse como comando? - Severity: Nit
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §7 L315; §10 L412.
* **Discrepancy Description:** não diz se renovar `lease_until`/`operator_seen_at` passa pela trava e pela distribuição.
* **Rationale & Recommendation:** renovação é `update … greatest(lease_until, now() + 75 s)` sem trava, sem versão; a expiração é condicional.

### IC-5 · Prévia recalculada gera 409 na hora de pedir ajuda - Severity: Nit
* **Reviewer Lens:** `inventive_catalyst`
* **Affected Scope:** §12 L444; §2 L158.
* **Discrepancy Description:** recalcular a cópia e recusar com `HUMAN_SUPPORT_PREVIEW_CHANGED` erra justamente no momento de pedir ajuda.
* **Rationale & Recommendation:** a prévia grava ou assina a cópia e devolve um id; a criação usa essa cópia.

### ZO-7 · Estimativa mais complexa que o pedido - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §8 L353-359; M11.
* **Discrepancy Description:** Kaplan–Meier, três recortes e cache por processo (telas diferentes podem mostrar valores diferentes); M11 com dois números.
* **Rationale & Recommendation:** regra simples do brief, sem cache, um número.

### ZO-8 · Correção fora do escopo e item condicional - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §3 L185; item 1; itens 42-44.
* **Discrepancy Description:** `CONSULTATION_FAILED` vem das falhas do `runOrchestratedReply`, não de `assistant_interaction_agents.outcome`; o check de `FAILED` já existe na 166.
* **Rationale & Recommendation:** levar a correção do `FAILED` para PR próprio; tirar "se preciso" do item 1.

### ZO-9 · Tabelas e telas sobrepostas - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §15; §11 L440; item 55.
* **Discrepancy Description:** `human_support_agent_settings` duplica a chave da presença; histórico de avaliação sem leitor; "Elegibilidade agora" repete "Anjos".
* **Rationale & Recommendation:** capacidade como coluna da presença; confirmar o histórico; juntar telas com filtro por escopo.

### ZO-10 · Detalhe demais e referências imprecisas - Severity: Nit
* **Reviewer Lens:** `zoom_out`
* **Affected Scope:** §7, §10, item 39, Alternativa E.
* **Discrepancy Description:** constantes de ajuste misturadas às regras; `ratingsOf` não existe (é `loadConversationRatings`, `assistant-interaction-ratings.ts:56`); `listenForWake` já reconecta sozinho.
* **Rationale & Recommendation:** apêndice de parâmetros; corrigir nomes e a justificativa da Alternativa E.
