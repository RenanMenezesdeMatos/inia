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
