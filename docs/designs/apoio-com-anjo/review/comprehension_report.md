# Goldfish Review Report — Estágio 6 (Comprehension Test)

**Target:** `docs/designs/apoio-com-anjo/design_draft.md` — FeatureRange 1-607, DetailedRange 608-766. Revisor leu só o documento.

| Reviewer | Status |
| --- | --- |
| `comprehension` | completed |

## O que isto propõe

Um formulário de descurtida no chat do operador com a INIA — motivo de lista fechada, comentário e "ainda precisa de ajuda?" — gravado como nova versão da avaliação; sinais gravados por código quando uma resposta não achou trecho nas bases, quando o esclarecimento foi insuficiente, quando uma ferramenta falhou, um especialista estava bloqueado ou o turno terminou em erro. Sobre isso, o "Apoio com Anjo": o operador pede ajuda por botão, descurtida ou sugestão; o sistema oferece o pedido a um Anjo por vez (30 s para aceitar) sob trava por organização; os dois conversam numa sala do mesmo painel, isolada da IA por fronteiras de módulo e testes de estrutura; atualizações por espera longa sobre uma versão por pessoa; liga/desliga por organização, Grupo e Subgrupo com herança; papéis ANJO e COORDENADOR_DE_ANJOS; classificação pelo Anjo, avaliação pelo operador, funil M1–M17; entrega em fases, tudo desligado no início.

## Como o sistema atual funciona, segundo este documento

O chat chega pelo SSE ao `realtime-router` e ao módulo `assistant`; grava UP/DOWN/NONE sem motivo, em versões, descartando repetições (`sameRating`). Cada resposta vem de um turno orquestrado que consulta bases, ferramentas e especialistas e deixa rastros; ferramenta que falha fica `EXECUTED`. Não há caminho humano. Acesso por papéis com escopo, auditoria, registro LGPD de leitura, retenção e exportação por FK para `people`. N APIs e M workers atrás do IIS sem afinidade, PostgreSQL; sessão expira com 30 min sem interação.

*(Paráfrase confere com a intenção do autor.)*

## Findings

### CP-1 · "Ausente" com dois significados - Severity: Major
* **Affected Scope:** L63, 252, 293, 402, 728, CA12.
* **Discrepancy:** glossário define Ausente = `AWAY` (oferta perdida); CA12 diz "Anjo ausente 3 min → interrompido", que é a posse vencida; "ausente" também usado para o operador.

### CP-2 · `NO_REPLY` e `BUTTON` sem cópia definida - Severity: Major
* **Affected Scope:** L82, 183, 192, 444, 467-468, 487.
* **Discrepancy:** `NO_REPLY` fica na mensagem do operador, mas `buildSupportContext` aceita só respostas da INIA; não se diz qual a cópia nem onde aparece a sugestão; para `BUTTON` não se diz o que o Anjo vê; a lista de origens nunca é enumerada; `NO_ANSWER` só aparece em M7/M8 sem dizer que cobre consulta falhou e bloqueado.

### CP-3 · Registro de "nenhum Anjo em serviço" indefinido - Severity: Major
* **Affected Scope:** L95, 348, 486-487, M9.
* **Discrepancy:** botão de confirmar desabilitado, mas "a tentativa fica registrada ao clicar" — qual clique, qual rota; a prévia é GET.

### CP-4 · Termos da INIA sem definição na tabela de sinais - Severity: Major
* **Affected Scope:** §3 L179-183.
* **Discrepancy:** "bases", "ferramenta de dados", "especialista", "esclarecimento pelas bases", `NONE`×`NO_MATCH`, `toleratesToolFailure` (só ferramenta tolerante ou qualquer uma?).

### CP-5 · Elegibilidade e cobertura de escopo não explicadas - Severity: Major
* **Affected Scope:** L39, 218, 222, 229.
* **Discrepancy:** `contestationReviewersOf` "sem `MY_STRUCTURE`", `scopeReachesCollaborator`, "Minha estrutura" não explicados; o que "cobrir" significa por nível; toda pessoa tem Subgrupo?

### CP-6 · Como o Coordenador chega à área - Severity: Major
* **Affected Scope:** L124, 216, 705, 707.
* **Discrepancy:** "fora de `canAccessAdministration`" e "área isolada" sem explicação; como quem não administra chega a "Administração › Monitoramento" e o que mais vê.

### CP-7 · `participationOf` × `participantsOf` - Severity: Nit
* **Affected Scope:** L185, 680-681.

### CP-8 · Modelo de versões da avaliação suposto - Severity: Nit
* **Affected Scope:** L158, 171, M2.

### CP-9 · Nomes de produto sem definição - Severity: Nit
* **Affected Scope:** L35-42, 479, 536, 629 (Acompanhamento, "Ouvir com a INIA", recado, Monitoria de usabilidade, IAjuda, "frente").

### CP-10 · Referências adiantadas; voz nos sinais - Severity: Nit
* **Affected Scope:** L72, 363, 389.
* **Discrepancy:** "fase 2" e "aba líder" antes de definidos; não diz se os sinais valem para respostas por voz.

### CP-11 · `features.chatDislikeDetails` "liga" em qual fase - Severity: Nit
* **Affected Scope:** L614-615, 235, 672.

### CP-12 · Provas contra o banco sem roteiro - Severity: Nit
* **Affected Scope:** L720.
