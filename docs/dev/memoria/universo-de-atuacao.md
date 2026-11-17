# Memória — Universo de atuação (B2B, B2C, B2X)

> Implementado em 16/11/2026 no ramo `claude/universo-atuacao` (migration 197; etapa 3 em `backend/migrations/pending/208_*`, antes 198). Prova:
> `INIA_DB_PROOF=1 NODE_ENV=test TEST_DATABASE_URL=<banco com a 197> npx vitest run operating-universe-proof`.

## Regra

**B2B, B2C e B2X são universos SEPARADOS** (decisão do usuário, 16/11): nada é compartilhado nem associado entre eles. B2X é um
universo próprio. Cada colaborador, base de conhecimento, Workflow, produto, indicador, domínio de negócio, agente, Orquestrador e
argumentário pertence a um só (nulo = pendente). Vínculo que atravessa universos é recusado no backend.

- **Universo ≠ abrangência de acesso.** O universo do colaborador (`people.operating_universe`) diz onde ele atua. A abrangência diz
  quais universos a conta consulta: o do próprio cadastro, ou todos com a permissão `operating_universes.all` **no escopo da
  atribuição** (Grupo, Subgrupo, organização, minha estrutura). Papéis: `ADMINISTRADOR_GERAL`, `ADMINISTRADOR` (já tinham a visão
  ampla) e o novo `ACESSO_A_TODOS_OS_UNIVERSOS` (só essa permissão, para gestores; concedido por ADMINISTRADOR_GERAL/ADMINISTRADOR).
  Capacidade `canViewAllUniverses`. Ninguém muda o próprio universo (`PEOPLE_SELF_CHANGE_FORBIDDEN`).
- **Ativação por organização** (`organizations.operating_universe_enforced_at`). Antes: nada filtrado, universo opcional. Depois:
  cadastro novo exige universo no backend (`OPERATING_UNIVERSE_REQUIRED`) e as consultas operacionais filtram. Ativar com pendências
  exige confirmar a contagem (`OPERATING_UNIVERSE_ACTIVATION_UNCONFIRMED`). Produto exige universo sempre (pedido do usuário).
- Código único: `backend/src/modules/operating-universe/` — `domain/operating-universe.ts` (puro), `application/universe-access.ts`
  (leitura da abrangência, regra de pessoas), `resource-universe.ts` (registro dos tipos e vizinhos de cada um: conflitos),
  `universe-links.ts` (produto × base/argumentário, inclusive pela categoria), `universe-administration.ts` (prontidão,
  classificação, lote por Grupo, ativação), rota `/api/v1/admin/operating-universe`.

## Revisão de 16/11/2026 (noite) — universo no Grupo, migration 204

Decisão do usuário depois das respostas de negócio ("um supervisor pode ter Grupo B2C e B2B, raro mas ocorre"; "uma pessoa atua em um
universo só"):
- **Fonte do universo = Grupo** (carga de Grupos, coluna "Universo de atuação"); **Subgrupo** só quando difere do Grupo-pai; o
  **operador herda**. Na pessoa fica só a **exceção** (`people.operating_universe_override`, carga de Colaboradores ou ficha). O banco
  calcula `people.operating_universe` = exceção → Subgrupo → Grupo (`resolve_person_operating_universe`, gatilho antes de gravar; mudar o
  universo de um Grupo/Subgrupo recalcula os operadores dele). O legado da 197 (universo gravado pessoa a pessoa) virou exceção.
- **Liderança não precisa de universo**: vê a PRÓPRIA estrutura (quem responde a ela) em qualquer universo (`personAllowedByUniverse`,
  `inViewerStructure`). O universo limita só o que vem de PAPÉIS de acesso. Consulta de processo da liderança (U4-01): Orquestradores do
  universo do cadastro **e dos universos que ela lidera** (`processOrchestratorUniverses`); universo que não lidera continua fora.
- **Vigência informada pela carga**: "Universo vigente desde" no Grupo, no Subgrupo e na exceção da pessoa
  (`operating_universe_effective_from`; passada ao gatilho de vigência por `inia.universe_effective_from`). Nunca antes da vigência
  atual nem no futuro; sem a data, vale o momento da carga.
- **Pendência = só operador** sem universo resolvido. Operador NOVO com a exigência ativa: precisa de exceção ou de Grupo com universo
  (Pessoas 422 `OPERATING_UNIVERSE_REQUIRED`; Central → quarentena `DATA_OPERATING_UNIVERSE_REQUIRED`).
- Tela: Administração › Dados › Universo de atuação → "Grupos e Subgrupos" (classificar com vigência opcional; o que vem da base fica
  travado — `OPERATING_UNIVERSE_MANAGED_BY_SOURCE`), rotas `GET/PUT /api/v1/admin/operating-universe/units`. Pessoas: o campo virou
  "Universo de atuação — exceção", com "Hoje: B2C (do Grupo)" e o selo "exceção" na lista.
- O que o cliente manda: **Grupos** + `operatingUniverse` (e `operatingUniverseEffectiveFrom`); **Subgrupos** + os mesmos, opcionais;
  **Colaboradores**: `operatingUniverse` vira exceção opcional, + `operatingUniverseEffectiveFrom`. Estrutura organizacional não muda.
- Prova: `operating-universe-proof` atualizada (Grupo classificado propaga, exceção preservada, liderança vê a estrutura toda, vigência
  com data mantém 2020 no universo antigo).

## Revisão da auditoria run-4 (17/11/2026) — migration 207

Achados do delta do universo (`security-audit-skill/inia/run-4/agents/delta-universo/findings.md`); UB-08/UB-10 ficaram na 206 (outro
ramo de trabalho). Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operating-universe-review-proof` (falha no código anterior).
- **UB-01 — exceção limpável.** Carga de Colaboradores: coluna `operatingUniverse` mapeada e vazia = sem exceção (limpa); não mapeada =
  mantém (`employeeUniverseMapped`, mesma regra do controle de campo da ficha). A ficha já limpava ("Sem exceção — herda do
  Grupo/Subgrupo") quando o campo não vem de feed. A **207** limpa as exceções REDUNDANTES (iguais ao universo que a pessoa herdaria do
  Subgrupo/Grupo) — vieram da conversão da 197 pela 204; o universo calculado não muda e nenhuma vigência nova é aberta.
- **UB-02 — operador existente não fica pendente em silêncio.** Com a exigência ativa, carga (quarentena `DATA_OPERATING_UNIVERSE_REQUIRED`)
  e ficha (422 `OPERATING_UNIVERSE_REQUIRED`) recusam mudar Grupo/Subgrupo, nível ou exceção quando o operador resultante ficaria sem
  universo resolvido. Operador já pendente em que nada disso muda continua editável/carregável (regulariza-se classificando o Grupo).
- **UB-03** tirar o universo de um Subgrupo confere os operadores que voltariam a herdar de um Grupo sem universo (422).
- **UB-04** `PUT /units`: quem herda o universo daquele Grupo/Subgrupo (sem exceção própria; no Grupo, sem Subgrupo com universo) não o
  reclassifica — 403 `PEOPLE_SELF_CHANGE_FORBIDDEN`, como na ficha e no lote.
- **UB-05** vigência do `PUT /units`: data inexistente (`2026-02-30`) = 400 de validação; futura = 422
  `OPERATING_UNIVERSE_EFFECTIVE_FROM_FUTURE` (comparada com a data UTC de hoje).
- **UB-06** vigência retroativa (antes do início do período aberto) troca o universo do período aberto no lugar (gatilho refeito na
  207) — nada de período de duração zero; e a leitura dos indicadores por competência ignora períodos de duração zero que já existam.
- **UB-07** etapa 3 renumerada para `pending/208_*` e restrita a OPERADOR (contagem igual à da prontidão).
- **UB-11** a 204 ficou idempotente no próprio arquivo (o executor não confere checksum; conteúdo equivalente na primeira aplicação —
  a cópia do legado para a exceção só roda quando a coluna nasce). Reaplicar a 204 sozinha volta a função de propagação ao corpo dela
  (sem o filtro da 206); por isso a ordem 204 → 206 → 207 vale também em reaplicação manual.

## Onde o universo é aplicado

- Cadastro de pessoas: Pessoas (POST/PATCH, filtro `operatingUniverse` com `PENDING`), Central de Dados › Colaboradores (campo ENUM
  `operatingUniverse`; com a exigência, pessoa NOVA sem universo vai para a quarentena `DATA_OPERATING_UNIVERSE_REQUIRED`), controle
  de campo da base (`PERSON_FIELD_RULES`), massa demo (segmento do Grupo; Diretor pendente de propósito).
- Chat: `resolveOrchestratorForSubject` só escolhe Orquestrador do universo do operador (pendente = nenhum); especialistas de outro
  universo saem (`specialistUniverseFilter`); recuperação de bases só do universo do agente (`retrieve-knowledge.ts`, a cada busca —
  o cache por agente confere a lista de bases a cada chamada); Orquestrador pendente por id fica fora com a exigência. O perfil
  enviado à INIA leva "Universo de atuação: …" (`asking-person-profile.ts`).
- Workflows: universo na Abrangência (rascunho × publicada, vale ao Publicar; `draft_operating_universe`, trigger 144 refeito,
  `workflow_versions.operating_universe`). População (`resolveScopeOperatorIds`, `isOperatorEligibleForWorkflow`) só com operadores
  do universo; `WorkflowScopeRef/WorkflowPopulation.operatingUniverse` obrigatório no tipo (nenhum chamador esquece). Publicar recusa
  agente/Orquestrador/indicador de outro universo (`assertWorkflowGraphUniverse`).
- Analytics (Indicadores, Equipe, ficha, ferramentas da liderança, reports — tudo que usa `loadViewerScope`): operadores filtrados por
  `universeAllowsPerson`; navegação de líderes não muda. Acesso cruzado por id = 403. Linhas oficiais de indicador só contam se o
  indicador for do universo VIGENTE da pessoa na competência (`person_operating_universe_history`): trocar de operação não
  reclassifica o passado. O grafo em cache invalida pela versão STRUCTURE (trigger 128 refeito com a coluna).
- Apoio com Anjo (auditoria 16/11, rodada 4): com a exigência, o pedido só vai a Anjo do universo do operador ou com
  `operating_universes.all` cobrindo o Grupo/Subgrupo do pedido (distribuição, disponibilidade, "ninguém em serviço", transferência —
  `human-support/application/universe-gate.ts`); o Coordenador só lê, lista e transfere pedidos de operadores do universo dele, salvo
  essa permissão no lugar do pedido (`coverage.ts`). Universo do pedido = o do operador no cadastro (sem carimbo). Detalhes em
  `apoio-com-anjo.md`.
- Casos: `supervision_cases.operating_universe` carimbado na origem (trigger). Primeira classificação de uma pessoa (nulo → universo)
  leva o legado junto: vigência "desde sempre" e casos sem carimbo; trocas seguintes abrem nova vigência. O carimbo do legado usa o índice parcial `supervision_cases_operator_pending_universe` (203).
- Vínculos recusados (409 `OPERATING_UNIVERSE_LINK_CONFLICT` com a lista): base × produto/agente; agente × base/domínio/
  Orquestrador/Workflow; Orquestrador × agentes/domínios; produto × bases/argumentários; argumentário × área. Na escolha de produtos
  ("Vale para") a tela só oferece os compatíveis e o backend recusa (`OPERATING_UNIVERSE_PRODUCT_INCOMPATIBLE`).
- Frontend: seletor/selo em `components/operating-universe/`; Pessoas (coluna, filtro, campo), bases (campo + lista), Workflows
  (criação, Abrangência no editor, lista), produtos, formulários de agente/Orquestrador/indicador/domínio/argumentário;
  Administração › Dados › **Universo de atuação** (impacto da ativação, lote por Grupo, recursos, conflitos, ativar/desligar);
  perfil próprio mostra o universo e o aviso de pendência.

## Implantação

1. Migration 197 (aditiva). 2. Classificar o legado na tela (ou mapear o campo na Central). 3. Ativar a exigência na tela (backend
passa a exigir e filtrar). 4. Com zero pendentes, mover `migrations/pending/208_operating_universe_required.sql` para `migrations/`
(renumerada para depois da última aplicada; ela mesma recusa se houver operador ativo pendente) — obrigatório no banco, só para
OPERADOR (`people_active_operator_requires_universe`; liderança fica nula de propósito).

## Limitações conhecidas

- Listas de agentes, Orquestradores, indicadores, domínios e argumentários ainda não devolvem o universo (o selo não aparece nelas);
  a classificação deles é pela tela de regularização. Seletores de agentes no Orquestrador e de área no argumentário não filtram por
  universo (o backend recusa a mistura).
- Feed do Acompanhamento e ficha usam o universo ATUAL da pessoa para quem vê; o carimbo do caso ainda não filtra o feed.
- Apoio com Anjo: atendimento já em andamento na ativação (ou na troca de universo do operador) segue até terminar; o painel de
  presença/histórico dos Anjos não filtra pelo universo do Anjo.
- Explorador de dados (`data_hub.explore`) e Monitoria de usabilidade não filtram por universo (organização inteira / desligada).
- Pessoa ligada pela Central só pelo e-mail (sem matrícula conhecida) entra como "nova" na regra de quarentena.
- Canais/flags, assuntos proibidos e glossário continuam da organização inteira (governança comum).
- Dev: a 197 foi aplicada no banco `inia` em 16/11/2026 22:57 (pedido do usuário; filtro DESLIGADO, nada classificado) e no clone
  `inia_universo` (do `inia_test`, com a conta de teste `qa-universo@inia.test` e o Grupo "B2B · Grandes Contas" classificado). O
  `inia_test` NÃO tem a 197. Numeração: 195/196 já eram de outros ramos e 199/201 de "communications" — por isso 197.
- Merge na main local em 16/11 (`c4cd8ae6`), sem push.
