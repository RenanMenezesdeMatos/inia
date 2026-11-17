# Memória — Universo de atuação (B2B, B2C, B2X)

> Implementado em 16/11/2026 no ramo `claude/universo-atuacao` (migration 197; etapa 3 em `backend/migrations/pending/198_*`). Prova:
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
- Casos: `supervision_cases.operating_universe` carimbado na origem (trigger). Primeira classificação de uma pessoa (nulo → universo)
  leva o legado junto: vigência "desde sempre" e casos sem carimbo; trocas seguintes abrem nova vigência.
- Vínculos recusados (409 `OPERATING_UNIVERSE_LINK_CONFLICT` com a lista): base × produto/agente; agente × base/domínio/
  Orquestrador/Workflow; Orquestrador × agentes/domínios; produto × bases/argumentários; argumentário × área. Na escolha de produtos
  ("Vale para") a tela só oferece os compatíveis e o backend recusa (`OPERATING_UNIVERSE_PRODUCT_INCOMPATIBLE`).
- Frontend: seletor/selo em `components/operating-universe/`; Pessoas (coluna, filtro, campo), bases (campo + lista), Workflows
  (criação, Abrangência no editor, lista), produtos, formulários de agente/Orquestrador/indicador/domínio/argumentário;
  Administração › Dados › **Universo de atuação** (impacto da ativação, lote por Grupo, recursos, conflitos, ativar/desligar);
  perfil próprio mostra o universo e o aviso de pendência.

## Implantação

1. Migration 197 (aditiva). 2. Classificar o legado na tela (ou mapear o campo na Central). 3. Ativar a exigência na tela (backend
passa a exigir e filtrar). 4. Com zero pendentes, mover `migrations/pending/198_operating_universe_required.sql` para `migrations/`
(ela mesma recusa se houver pendência) — obrigatório no banco.

## Limitações conhecidas

- Listas de agentes, Orquestradores, indicadores, domínios e argumentários ainda não devolvem o universo (o selo não aparece nelas);
  a classificação deles é pela tela de regularização. Seletores de agentes no Orquestrador e de área no argumentário não filtram por
  universo (o backend recusa a mistura).
- Feed do Acompanhamento e ficha usam o universo ATUAL da pessoa para quem vê; o carimbo do caso ainda não filtra o feed.
- Explorador de dados (`data_hub.explore`) e Monitoria de usabilidade não filtram por universo (organização inteira / desligada).
- Pessoa ligada pela Central só pelo e-mail (sem matrícula conhecida) entra como "nova" na regra de quarentena.
- Canais/flags, assuntos proibidos e glossário continuam da organização inteira (governança comum).
- Dev: banco clone `inia_universo` (do `inia_test`) com a 197 aplicada e a conta de teste `qa-universo@inia.test`; o banco `inia`
  e o `inia_test` NÃO têm a 197 (195/196 já estão ocupadas por outros ramos — por isso 197).
