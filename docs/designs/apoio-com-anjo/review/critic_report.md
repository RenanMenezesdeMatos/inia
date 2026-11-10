# Goldfish Review Report — Estágio 7 (Critic Review)

**Target:** `docs/designs/apoio-com-anjo/design_draft.md` (FeatureRange 1-607). Padrões: `feature-spec-standard` + `review/inia-review-standard.md`.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `design_critic` | completed |
| `structural` | completed |
| `style` | completed |

Achados repetidos entre revisores foram unidos (indicado na lente). Ids: DC = design critic, ST = structural, SY = style.

## Blockers

### ST-1 · Falta a seção de riscos e mitigações
* **Lentes:** `structural`, `design_critic`
* **Scope:** documento todo; NFR L584-589.
* **Descrição:** o `feature-spec-standard` exige riscos, limites e mitigação. Dos 4 riscos abertos do brief só o IIS sobreviveu (OQ1); sumiram a percepção da oferta de 30 s, a mudança do polegar e o trabalho não commitado em `operator-inia-chat.tsx`; worker parado, versões misturadas e disputa pela trava ficam espalhados.
* **Recomendação:** seção "Riscos e mitigações" (Risco · Impacto · Mitigação · Fase).

## Major — clareza e estrutura

### DC-1 / ST-5 / SY-2 · "Ausente" com três sentidos; glossário incompleto
* **Scope:** L63, 252, 293, 402, CA12; glossário L44-68.
* **Descrição:** `AWAY` × posse vencida × operador sem aba; CA12 induz a interromper a partir de `AWAY`. Faltam verbetes: cópia da troca, posse, escopo congelado, chave geral, versão por pessoa, aba líder, Em pausa, Cancelado, Encerrado, estados da oferta; falta coluna de código.

### SY-3 · "Desligado" lido como estado final
* **Scope:** L309, 356, 470. É a causa `SCOPE_DISABLED` de `CANCELLED`.

### SY-4 / ST-6 / DC-1 · Origem `NO_ANSWER` × sinal `NO_REPLY`; lista de origens não definida
* **Scope:** L183, 190, 198, 467-468, 486-487, 527. Renomear origem para `SIGNAL`; tabela de origens com mapeamento sinal → origem; `kind` com dois sentidos.

### SY-5 · "Espera" e "consulta" com dois sentidos
* **Scope:** §8, §10, M11, L255, 363, 416-425. Reservar "espera" para a fila e "consulta" para as bases; "chamada de estado" / "chamada longa".

### SY-6 · Oferta `MISSED` com três nomes
* **Scope:** L250, 274, 324, 477. Usar "deixada passar".

### SY-7 · Texto do Anjo para cada causa de fim do pedido
* **Scope:** L309 × L311. Hoje "O operador cancelou" cobre expirado, abandonado e desligado.

### SY-8 · Início dos 3 min no CUJ 5
* **Scope:** L107.

### SY-9 / ST-11 · Quem chama `buildSupportContext` e `replySignalsOf`
* **Scope:** L131-145, 385.

### SY-10 · Afirmações sem calibração
* **Scope:** L21, 28, 29, 315, 557 ("por construção", "tudo funciona", "latência ≤ 1 s", "volume baixo", "na prática").

### ST-2 · `|` sem escape em tabelas quebra células
* **Scope:** L490, 497, 515, 527.

### ST-3 / SY-1 · Referência errada "(seção 13)"
* **Scope:** L146 → seção 9.

### ST-4 · Alternativas incompletas e atribuições sem link
* **Scope:** L547, 564-565, 572-580. G, J, K sem Pros/Cons; I sem Pros; C sem link para a decisão; G sem a regra.

### ST-7 · Resumo do modelo diverge do corpo
* **Scope:** §15 L520-523 × §6. `end_cause` em pedidos vs atendimentos; colunas de status/causa ausentes; onde grava `SCOPE_DISABLED`.

### ST-8 · Índice de rotas incompleto
* **Scope:** §14. Faltam `GET …/messages` alterado, evento SSE, `/auth/me` alterado, rota que grava tentativa sem Anjo.

### ST-9 · Telas do Administrador geral e do Coordenador sem seção
* **Scope:** §9, CUJ 6 e 8. Criar seção "Telas" por papel; "Área do Anjo" está dentro de "Conversa humana".

### ST-10 · Open Questions soltas
* **Scope:** L70-75, 82, 89, 156, 437. OQ4 usada como decidida; OQ2 sem rota; decisões "confirmar na aprovação" do brief fora das OQs.

## Major — aderência ao código

### DC-2 · M1–M6 leem tabelas do `assistant`
* **Scope:** L145, G7, L461-466. Porta de leitura exportada por `assistant`.

### DC-3 · Registro LGPD dentro da transação do aceite
* **Scope:** L330. `recordPersonalDataAccess` engole o erro (`personal-data-access-log.ts:26-40`), mas no PostgreSQL o erro aborta a transação e o aceite vira rollback. Gravar depois do commit ou sob `SAVEPOINT`.

## Major — permissões

### DC-4 · Administrador geral com `human_support.attend`
* **Scope:** L214, 218, item 13. Elegibilidade por `rolesWithPermission` tornaria todo Administrador geral Anjo da organização; por código de papel, ele teria a área sem receber ofertas. Dar só `coordinate` e `manage`.

### DC-5 · Papel revogado ainda aceita a oferta pendente
* **Scope:** L253, 319-324, 330. Reconferir elegibilidade no aceite e no envio de mensagem; passo de varredura para revogação e desligamento.

### DC-6 · Leitura sem prazo pelo Anjo de um atendimento anterior
* **Scope:** L490, 445. Inclui mensagens com o Anjo seguinte. Limitar até o `ended_at` do próprio atendimento, enquanto a classificação estiver pendente ou o papel cobrir o escopo.

### DC-7 · Alcance do Coordenador sobre dados do Anjo pela lotação
* **Scope:** L222, 503, M17. Coordenador de X não vê Anjo lotado em Z que atende X; Coordenador de Z vê pausas de quem atende outros escopos. Usar interseção entre o escopo da atribuição `ANJO` e o do Coordenador.

## Major — concorrência

### DC-8 · Reconexão durante o desligamento volta para a instância que está saindo
* **Scope:** L416, 421. Health check de 3 s + `LeastRequests`; esperas de 20 s + dreno de 5 s estouram 25 s. Com `draining`, responder `reconnect` na hora a qualquer chamada nova.

### DC-9 · Anjo `OFFLINE` por desligamento com atendimento ativo nunca é "perdido"
* **Scope:** L253, L119, L320. Avaliar a posse de quem tem atendimento ativo independentemente do status.

### DC-10 · Duas Web Locks; aba líder do chat não renova a posse do Anjo; reserva por temporizador
* **Scope:** L255, 420-421. A aba da área sempre manda `workspace=anjo`; prazos dimensionados para o modo de reserva (aba oculta reduz temporizador a 1/min).

### DC-11 · Rolagem automática da sala renova a sessão
* **Scope:** L257, CA17. `SessionIdleGuard` conta `scroll` como interação e o chat rola sozinho (`operator-inia-chat.tsx:280`).

### DC-12 · Trava por organização em todo comando, inclusive mensagem
* **Scope:** L315, 328. Cada comando esperando a trava segura uma conexão do pool (20). Trava por pedido para mensagens; `lock_timeout`; distribuição só quando o estado muda.

### DC-13 · `DOWN` puro atrasado apaga os detalhes
* **Scope:** L158, 171. `DOWN` sem detalhes sobre `DOWN` vigente não grava.

### DC-14 · `AWAY` em serviço por até 30 min
* **Scope:** L260. Fila que ninguém atende; contorna CUJ 3/CA4. Prazo para `AWAY` sair de serviço.

## Major — privacidade

### DC-15 · Colunas que apontam para pessoas não definidas
* **Scope:** L449, 525-527. Exportação por FK simples; risco de levar estrelas ao Anjo (contra OQ2), de omitir a classificação na exportação do operador, de FK composta quebrar a retenção. Tabela explícita de FKs para pessoas + teste positivo da exportação do Anjo.

## Major — métricas

### DC-16 · Voz e esclarecimento sem sinal; "sem sinal" = "não calculado"
* **Scope:** M1, M6, L513, L183. Gravar linha com lista vazia quando calculado; denominador de M6 = respostas calculadas; separar por canal; definir "resposta".

### DC-17 · Origem declarada pelo cliente
* **Scope:** L487, M8, M9. O servidor deriva a origem; deduplica tentativas.

## Nits

* DC: `KNOWLEDGE_NOT_FOUND` "ferramenta de dados" ambíguo; `participationOf`/`participantsOf` trocados; `startDraining` fica em `process-lifecycle.ts:52`; `NO_REPLY` — o cliente lança exceção no `error` e perde a sugestão; quais gravações incrementam a versão; `statement_timestamp()` no limite do prazo; `shared_context` × retenção do chat; OQ2 com n<5; M10 "teve atendimento".
* ST: inglês/português nos títulos; Non-Goals agrupados; "fase 2" antes de definida; referências sem caminho; colunas Tipo e Recorte nas métricas; H4 nas subseções.
* SY: "Sugestão de Anjo" × "Sugestão de apoio"; "cópia compartilhada"; "dono"/"dona"; "Coordenador"/"Adm. geral"; `agent` × `anjo` nos nomes; prefixo "Rejected by author"; listas em G2/L158/passo 6; L83 redundante; intervalo de ~20 s não definido.
