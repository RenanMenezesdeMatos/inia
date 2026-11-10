# Goldfish Review Report — Estágio 8 (Zoom Out intermediário)

**Target:** `docs/designs/apoio-com-anjo/design_draft.md` (arquivo inteiro), lido com os relatórios dos estágios 5, 6 e 7.

| Reviewer | Status |
| --- | --- |
| `zoom_out` | completed |

### Z8-1 · Concorrência: três correções empilhadas - Severity: Major
IC-3, IC-4 e DC-12 somam quatro mecanismos (try-lock, savepoint por pedido, disparo pelo laço de esperas, trava por pedido, `lock_timeout`). **Recomendação:** trava por organização só em comandos que mudam estado; mensagens e renovações sem trava (insert/update condicional + índices únicos); `dispatch` depois do commit com `pg_try_advisory_xact_lock` e pela tarefa periódica (padrão `knowledge-publications`); "worker parado" vira risco mitigado por duas instâncias de processamento.

### Z8-2 · Presença: eliminar a ambiguidade - Severity: Major
IC-1 é a causa de CP-1, DC-1/ST-5/SY-2, DC-9, DC-14, SY-8. **Recomendação:** `status` só declarado; interrupção decidida pelo atendimento (`lease_until <= now() - 3 min`, qualquer status); oferta deixada passar vira `PAUSED` com motivo de sistema; `AWAY` deixa de existir; "Ausente" passa a significar só falta de conexão. Fila com Anjos só em pausa: decisão a confirmar.

### Z8-3 · Criação do pedido: um escritor, uma regra de cópia - Severity: Major
**Recomendação:** (a) prévia devolve o id da versão de avaliação vigente; a cópia sai de `(interactionId, ratingId)` imutáveis — sai `previewHash`; (b) `POST /requests` é o único escritor, inclusive da tentativa sem Anjo (409 + registro); (c) servidor deriva a origem (`BUTTON` sem `interactionId`; `DISLIKE` com descurtida vigente e `stillNeedsHelp`; senão `SIGNAL`); (d) cópia = pergunta + resposta quando existir + nota, cobrindo `NO_REPLY` e botão.

### Z8-4 · Área do Anjo fora do canal compartilhado - Severity: Major
**Recomendação:** a área tem a própria chamada longa com `workspace=anjo`, sob a trava de aba única; o canal compartilhado atende só o operador; no máximo duas chamadas longas por navegador; prazos da reserva em aba oculta viram risco (OQ1 já impede ligar antes da validação).

### Z8-5 · `features.chatDislikeDetails` - Severity: Nit
Sem afinidade, a flag não evita o 400 que promete; frontend e backend saem do mesmo build. **Recomendação:** apagar a flag.

### Z8-6 · Mitigações além do necessário - Severity: Nit
DC-5 só no aceite; DC-6 só o próprio atendimento até `ended_at`; DC-3 registro depois do commit, na rota; DC-7 pelo helper de `access`; DC-11 tirar `scroll` de `INTERACTION_EVENTS`; DC-16 escolher uma coisa só; SY-7 um texto só para o Anjo ("Este pedido não está mais disponível").

### Z8-7 · Documento cresce enquanto o estágio 5 pede que encolha - Severity: Nit
Ordem de edição: ZO-1, depois Z8-1 a Z8-4, depois o resto; glossário só com termos de produto; Riscos substitui texto espalhado; K reescrita (percentil simples do brief); CP-6 com uma frase citando as áreas isoladas (`frontend/src/app/(app)/admin/layout.tsx:23-26`).
