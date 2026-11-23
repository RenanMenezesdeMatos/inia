# Alcance por vários Grupos (multi-grupo) — Bases, Comunicados, Alinhamentos e Argumentários

17/11/2026 · migration `223_scope_links_multi_group.sql` · branch `claude/escopo-multigrupo`.

Um mesmo conteúdo atende vários Grupos com **um único cadastro** (mesmo id, conteúdo e histórico). Cada **vínculo** aponta para
exatamente um Grupo e, quando há recorte, para **um Subgrupo daquele Grupo**:

- `{ teamId: A, subteamId: null }` = o Grupo A inteiro (o mesmo significado que `TEAM` já tinha: todos os Subgrupos, inclusive os
  criados depois);
- `{ teamId: B, subteamId: B1 }` = só o Subgrupo B1.

Quem está em A (qualquer Subgrupo) ou em B1 é alcançado; B2 (irmão) e um terceiro Grupo não. O **escopo global** de cada conteúdo
(todos os Grupos / o universo inteiro / a organização) continua sendo atributo do próprio conteúdo, nunca um vínculo. **Ausência de
vínculo nunca vira acesso global.** Multi-grupo, sozinho, não concede nada: universo de atuação, produto, permissões e as regras de cada
conteúdo continuam valendo por cima (AND), nos mesmos pontos de antes.

## Estrutura (uma tabela de vínculos por entidade, FK real)

| Entidade | Vínculos | Global | Observação |
|---|---|---|---|
| Base de conhecimento | `knowledge_document_org_scopes` (já existia, 008; endurecida) | linha `ALL_TEAMS` (sozinha) | SUBTEAM grava o Grupo-pai **pelo banco** (gatilho `knowledge_document_org_scopes_fill_team`); índice único; a configuração da versão (`orgScopes`) aplica os vínculos na publicação |
| Argumentário | `argument_script_version_scopes` | `argument_script_versions.scope_type = ALL_TEAMS` | Escopo **da versão** (antes, da linha e travado depois de publicar). Mudar vínculos vai para o rascunho e vale a partir da publicação; a análise usa a versão vigente na data da chamada, então a história não muda. Gatilhos impedem mudar escopo/vínculos de versão publicada |
| Alinhamento operacional | `operational_alignment_version_scopes` | `scope_type = UNIVERSE` | Versões já eram imutáveis depois de publicadas; vínculos idem |
| Comunicado (SEGMENT) | `communication_segment_scopes` | sem vínculo = universo inteiro | Substitui os arrays `segment_team_ids`/`segment_subteam_ids` (sem FK). Público fixo depois que saiu |

Todas as tabelas: `foreign key (subteam_id, team_id) references subteams (id, team_id)` (o Subgrupo pertence ao Grupo — garantido pelo
banco) e índice único `(conteúdo, team_id, subteam_id) nulls not distinct`. Colunas antigas de escopo único **removidas** (uma fonte de
verdade); a visão `argument_scripts` foi recriada.

Código comum: `backend/src/shared/domain/scope-links/scope-links.ts` (puro: `linkReaches`, `reachingSpecificity`, `linksOverlap`,
`sharedLinks`, `scopeLinkProblems`), `auth/application/manageable-scopes.ts` (`normalizeScopeLinks` — Grupo-pai real numa consulta,
`resolveScopeLinksForWrite`, `canManageLink`, `canManageAllLinks`, `canSeeAnyLink`), `shared/presentation/scope-links-schema.ts` (zod).
Frontend: `lib/scope-links/scope-links.ts` e o seletor único `components/admin/shared/multi-org-scope-field.tsx` (por Grupo: "Grupo
inteiro" ou "Só alguns Subgrupos"; resumo "Vale para: …" sempre visível antes de salvar/publicar; encadeado ao universo).

## Validação (backend é a autoridade)

Vínculo repetido, Subgrupo junto do próprio Grupo inteiro, Subgrupo de outro Grupo, Grupo de outra organização, "todos" junto com
Grupos e GROUPS sem vínculo = 422. Alinhamento: cada vínculo precisa ter universo classificado e igual ao do alinhamento. Entradas antigas
de escopo único (`TEAM`/`SUBTEAM` + ids; `teamIds`/`subteamIds` no Comunicado) continuam aceitas e viram vínculos.

## Quem gerencia × quem consome × quando é elegível

- **Gerenciar** (texto, vínculos, publicar, encerrar): TODOS os vínculos — atuais e novos — no escopo de quem altera (a regra que a Base já
  aplicava, A-F02). Gestor de parte dos Grupos de um conteúdo compartilhado: **Base e Argumentário** — vê (somente leitura, tem um vínculo
  dele) e recebe 403 ao alterar; **Alinhamento** — política anterior preservada (ver = administrar): fica fora da lista e o detalhe é 404;
  **Comunicado** — SEGMENT só com `communications.publish_organization` (organização inteira), autor edita.
- **Consumir**: material da base pelo operador (Grupo inteiro = `team_id`, Subgrupo = `subteam_id`), argumentários no motor de feedback e
  no prompt do Agent, alinhamentos no chat (agora) e na monitoria (data do atendimento), comunicados no Acompanhamento, por id e no chat
  (inclusive na visão da estrutura do gestor). Sempre `exists` — o mesmo conteúdo alcançado por dois vínculos aparece uma vez; contagem do
  público conta cada pessoa uma vez.
- **Elegível para Agent/Workflow/Orquestrador/produto**: regras de antes, sem mudança. Base × Agent continua pelo Grupo do Agent (Subgrupo
  leva o Grupo-pai): vincular a base a outro Grupo não liga Agent nenhum (o vínculo Agent↔base é explícito); tirar o vínculo tira a base
  da busca do Agent daquele Grupo na busca seguinte (o cache é por Agent e o alcance é relido a cada busca). Produto é dimensão separada
  (`product_scope_assignments`), nunca combinada com o alcance por Grupo.

## Precedência dos alinhamentos com vários vínculos

A especificidade é a do vínculo **que alcança aquela pessoa** (`specificityFor`): o mesmo alinhamento é "de Grupo" para quem está em A e
"de Subgrupo" para quem está em B1. Conflito na publicação (`isUnresolvableConflict`) = mesmo ponto, mesmo produto e **algum vínculo
idêntico** (ou os dois do universo inteiro). Grupo inteiro × Subgrupo dele não é conflito. A prévia de publicação diz quem prevalece:
THIS, OTHER ou MIXED (depende do Subgrupo). Corrigido junto: o rótulo dizia "o outro prevalece" quando eram produtos diferentes.

## Contagens e relatórios

Indicadores de sucesso (bloco 7): visibilidade = todos os vínculos no alcance; "por área" conta o alinhamento uma vez em cada Grupo que
ele alcança. Lista com filtro de Grupo/Subgrupo = algum vínculo naquele Grupo/Subgrupo, uma linha por conteúdo.

## Migração (backfill) e prova de equivalência

Cada registro de escopo único virou um vínculo (ids preservados). SUBTEAM sem Grupo recebeu o Grupo-pai real; Grupo/Subgrupo
inexistente = sem vínculo (NOTICE na migration), nunca global. No dev (`inia` clonado em `inia_multigrupo`), o acesso pessoa × conteúdo
antes e depois foi **idêntico**: argumentários 89.697 pares, bases 88.184, comunicados 789, alinhamentos 20 — 0 diferenças. Migration
aplicada também do zero sobre um clone de `inia_test`.

## Provas (`INIA_DB_PROOF=1`, banco de teste)

`argument-scripts-proof`, `operational-alignments-proof`, `communications-editorial-proof` e `knowledge-multi-group-proof` têm o cenário
Grupo A inteiro + Subgrupo B1 do Grupo B + Grupo C sem vínculo: acesso (inclusive chamada direta à API), gestão parcial, validação,
duplicata, remoção de vínculo (acesso perdido só ali, história preservada), Agents e chat.

## Correções de passagem

- Formulário da Base editava só `orgScopes[0]`: salvar uma base com vários alcances **apagava os demais**. Agora carrega/salva todos;
  lista e detalhe mostram todos.
- Boas práticas (`real-call-corpus.ts`): alcance SUBTEAM de uma base valia para os Subgrupos irmãos (comparava `team_id`).

## Limitações

- O destino (Grupo/Subgrupo) de quem consome continua sendo o cadastro **atual** da pessoa, como antes (inclusive na monitoria).
- Base sem nenhum alcance (2 no dev) continua visível só para quem administra a organização inteira; ao editar, abre com "Nenhum Grupo"
  e pede um alcance antes de salvar.
- Corpus de Boas práticas mantém "base sem alcance entra" (regra própria daquele módulo, anterior).

## Wiki

`/wiki/administracao/alcance-por-grupos` (17/11/2026) explica a regra em linguagem de usuário, com o exemplo Grupo A inteiro +
Subgrupo B1; Bases de Conhecimento, Acompanhamento (público do comunicado) e Administração (Argumentários, Alinhamentos operacionais,
Publicações) apontam para ela. Mudou a regra? Atualize a página junto.

## Seletor pesquisável, elegibilidade e alcance N em todos os cadastros (23/11/2026, migrations 249 e 250)

Pedido: busca de Grupo/Subgrupo para listas grandes, só opções com operador "Em produção", e vários Grupos/Subgrupos ou "Todos" em
Publicações, Alinhamentos, Indicadores, Produtos, Agentes, Orquestradores, Argumentários e Workflows.

**Decisões do usuário (23/11):** (1) universos continuam SEPARADOS — "Todos" de um cadastro = todos os Grupos/Subgrupos do universo DELE;
vínculo de outro universo é recusado; só a Publicação (sem universo próprio) alcança todos os universos ("Toda a empresa"). (2) Indicador e
Produto: alcance gravado e usado só na Administração; motor de feedback e cálculos não leem. (3) Orquestradores: vínculo idêntico com outro
ativo do chat do mesmo universo = recusado. (4) Migrations só em clones de teste (o `inia` de dev NÃO tem 249/250).

**Cardinalidade final:** Publicação N vínculos (+ "Todo o universo X" explícito; "Toda a empresa" = todos os universos); Alinhamento N por
versão (+ todo o universo); Argumentário N por versão (+ todos); Base N (inalterada); Agente, Orquestrador, Workflow: 1 → N (249,
`agent_scope_links`, `assistant_orchestrator_scope_links`, `workflow_scope_links`; `scope_type` ALL_TEAMS|GROUPS e `team_id`/`subteam_id`
sempre nulos; rascunho do Workflow em `draft_scope_links` jsonb, snapshot em `workflow_versions.scope_links`; configs de versão de
agente/Orquestrador com `scopeLinks`, legado TEAM/SUBTEAM lido por `resourceScopeOf`); Indicador (definição) e Produto: alcance novo (250,
`indicator_scope_links`, `product_operational_scope_links`, padrão ALL_TEAMS = comportamento anterior; pertencimento continua em
`operating_universe`). Regras de cálculo do indicador continuam com 1 escopo (nenhum fluxo em execução as lê).

**Opções** — `GET /api/v1/admin/scope-units` (`org-structure/presentation/scope-unit-options-router.ts`, regra em
`application/scope-unit-options.ts`): `kind` TEAM|SUBTEAM, `permission` da tela (lista fechada), `search` palavra a palavra sem
maiúsculas/acentos (Subgrupo também pelo Grupo-pai), `universes`, `teamId`, cursor keyset; universo, escopo e elegibilidade no SQL ANTES do
`limit`. Elegível = ≥1 `people` ativo, `role='OPERATOR'`, `current_employment_status` em produção (`EM_PRODUCAO` e legado `ACTIVE`); Grupo
conta os dele e os dos Subgrupos; com universo, só operadores daquele universo. `ids=` resolve escolhas salvas com `eligible:false`.
`eligibility=all` existe para filtros/relatórios (ninguém usa ainda).

**Escrita** — `assertNewScopeLinksAdmissible` (`scope-unit-admission.ts`): vínculos NOVOS (fora de `previous`) precisam caber no universo do
cadastro (`SCOPE_UNIT_OUTSIDE_UNIVERSE`) e ter operador em produção (`SCOPE_UNIT_WITHOUT_PRODUCTION_OPERATORS`); o salvo continua aceito.
`resolveResourceScopeForWrite` (`resource-scope-links.ts`) junta isso a `resolveScopeLinksForWrite`; "Todos" exige escopo de organização
(mantê-lo num registro que já era "Todos" não). Códigos por prefixo listados por extenso em `RESOURCE_SCOPE_ERROR_CODES` para o catálogo.
`ScopedTarget` ganhou `GROUPS` + `links` (`canManageScope` exige todos; `scopesAreCompatible`: Grupos efetivos de quem referencia ⊆ os do
referenciado). Consumo: `resourceScopeReachSql`/`resourceScopeSpecificitySql` (`shared/domain/scope-links/resource-scope.ts`), sempre `exists`.

**Frontend** — `MultiOrgScopeField` (mesmo nome, nova implementação, prop `permission` obrigatória) + `ScopeUnitPicker`: modo explícito
"Grupos e Subgrupos específicos" × "Todos…" (rótulo diz o alcance e que inclui os criados depois), abas Grupos/Subgrupos, combobox com ↑/↓/Enter,
"Carregar mais" + sentinela de rolagem, selos removíveis, "Sem operadores em produção" e "Fora do universo" (com "Remover os que não cabem"),
Subgrupo de Grupo inteiro = "Já incluído". Sem virtualização (páginas de 30). Testes de tela usam `components/admin/shared/testing/scope-units-fake.ts`.

**Por fatia** — Agentes: público dos argumentários no prompt sem pessoa = interseção dos públicos dos vínculos; base × agente cabe se for global ou valer para
CADA Grupo efetivo (run-10 QA-01: "algum" levava a base de A a quem é de B por um agente de A + B; a busca não sabe quem pergunta). Orquestradores: resolução pelo vínculo mais específico que alcança a pessoa, empate = mais recente; `ORCHESTRATOR_SCOPE_OVERLAP`
409 com advisory lock (universo pendente conflita com qualquer um); índice único novo só para ALL_TEAMS por universo. Workflows: população = `all OR team_id ∈ inteiros OR subteam_id ∈
Subgrupos`; Publicar grava links + snapshot + rascunho na mesma transação; SET_CONFIG_VALUE com GROUPS grava uma linha por vínculo.
Reclassificação de universo (`universe-administration.ts`) e transferência de configuração (`alcances[]`, inclusive Orquestrador e Indicador) entendem vínculos; trocar o universo confere TODOS os vínculos salvos (`assertScopeLinksInUniverse`) e, no Orquestrador, a sobreposição. Bases também passam pela admissão (universo + produção) nos vínculos novos. Auditoria run-10: `docs/security/relatorio-de-achados.md` § "Décima terceira rodada" (R13-01..11, R-51).

**Provas (`INIA_DB_PROOF=1`)**: `scope-units-proof` (lista grande além da 1ª página, acento, Grupo com produção só num Subgrupo, rota, admissão,
indicador), `agent-scope-links-proof`, `interactive-orchestrator-subteam-proof`, `workflow-scope-links-proof` (inclui Grupo criado depois de
publicar entrando no "Todos"), `network-temporary-password-proof`; as provas multi-grupo antigas ganharam operador em produção nos fixtures.
Equivalência da 249 numa cópia do `inia` (pg_dump): 58 agentes, 18 Orquestradores, 73 Workflows — 0 diferenças de alcance.

**Limitações:** Produto/Indicador não filtram ainda nenhum seletor de outro cadastro (só lista e detalhe); `applyManageableScopeFilter` e
`SqlFilter.orgScope` compartilhados não conhecem GROUPS (cada módulo usa filtro próprio); a Publicação tem um universo só por recorte;
"Habilitar acesso" de conta que entra pela rede ainda mostra senha temporária.

