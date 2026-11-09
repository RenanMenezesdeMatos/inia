# Bases de conhecimento: versões, atualização automática e histórico (PEN-008)

Decisão aprovada em 04/11/2026 (ESP-INIA-03 §4.1). Implementada no ambiente de desenvolvimento (migrations 167 e 168). **Não publicada em produção**. Situação por critério: ESP-INIA-03 §4.4. As regras funcionais adicionais foram aprovadas em 04/11/2026 (PEN-077). A lista das interpretações, separando escolhas técnicas de regras adicionais, está no registro da PEN-008.

## 1. Modelo

Reaproveita o que já existia. Não há tabela paralela de versões nem ponteiro novo.

| Onde | O que guarda |
|---|---|
| `knowledge_documents`, `knowledge_document_org_scopes`, `knowledge_document_subject_scopes` | A identidade e a configuração **em uso**: título, tipo, arquivo, alcance e assuntos. |
| `product_scope_assignments` | Os produtos **em vigor**, por data: o registro imutável que o motor de feedback lê. Numa base, muda só na transição da versão. |
| `knowledge_versions` | As versões: conteúdo e, desde a 167, `config`, `file_id`, `text_status`, `origin`, `reverted_from_version_id`, `change_summary`, autor, datas de pedido e de publicação, dados do processamento e `superseded_reason`. |
| `knowledge_files` | Os arquivos. Cada versão aponta para o seu (`file_id`). |
| `knowledge_version_usages` | Quais versões cada consulta usou: `AGENT_RUN`, `CONVERSATION` ou `WORKFLOW`, com agente e versão do agente. A origem é referência sem chave estrangeira, como em `ai_usage_events`. |

**Versão vigente:** a regra de sempre, `liveKnowledgeVersion` (`live-knowledge-version.ts`): a mais recente com status `PUBLISHED` ou `ARCHIVED`; a base vale quando ela está `PUBLISHED`. Todos os leitores da IA já usavam essa regra, e por isso nenhum deles precisou mudar para respeitar "só vale quando pronta": a versão só recebe `PUBLISHED` na transição.

**Situações de uma versão** (`status`):

```
DRAFT/APPROVED → PROCESSING → PUBLISHED → (ARCHIVED)
                     ├→ FAILED → PROCESSING (tentar de novo)
                     └→ SUPERSEDED (NEWER_VERSION ou ARCHIVED)
```

`APPROVED` continua sem efeito (PEN-009). A tela deriva a situação em `knowledge-version-history.ts › situationOf` (em uso, substituída, rascunho, rascunho antigo…).

**Rascunho em edição:** a versão mais recente, se for `DRAFT`/`APPROVED` e estiver acima da vigente. Há um por base. Rascunhos antigos abaixo disso (dados anteriores à 167) ficam no histórico como "Rascunho não publicado".

## 2. Fluxo (`knowledge/application/knowledge-versions.ts`)

- **Editar** (`saveKnowledgeDraft`): atualiza o rascunho ou cria um a partir do que está sendo editado (atualização com falha, vigente ou mais recente). Salvar sem mudança não cria versão. Nada muda no que a IA usa. Sem versão vigente, a configuração também vai para a base, porque não há consumidor e a lista precisa mostrar o que foi editado; os produtos, não.
- **Produtos** (`setProductScope` → `saveKnowledgeDraft`): `PUT /admin/product-catalog/sources/KNOWLEDGE_DOCUMENT/:id/scope` grava em `config.productNodeIds` do rascunho e não abre vigência. Um rascunho novo parte dos produtos em vigor, nunca do retrato da vigente, para não desfazer uma abrangência que ninguém pediu para mudar. `GET .../sources` traz `scope` (o que vale) e `pendingScope` (o que está numa versão fora de uso). Argumentário não muda: vale a partir de agora.
- **Trocar o arquivo** (`POST /:id/draft/file`): o arquivo novo entra no rascunho, com o texto extraído. Sem texto: `text_status = 'UNAVAILABLE'`, `content = ''`; dá para digitar o texto.
- **Publicar** (`requestKnowledgePublication`): `DRAFT → PROCESSING`, registrando autor e data. Se os produtos mudam, exige alcance de organização (`canChangeProducts`, 403 `ORGANIZATION_SCOPE_REQUIRED`) e produtos ativos (422 `PRODUCT_SCOPE_TARGET_INVALID`). Em base arquivada, só com `reactivate: true` (409 `KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED`), que fica registrado em `reactivation_confirmed_at` e `reactivation_confirmed_by_name`.
- **Processar** (`processKnowledgeVersion`): pega a posse (lease de 2 minutos, com `update … where processing_lease_until < now()`), prepara (`prepareKnowledgeVersion`: texto, trechos, arquivo) e conclui. A API processa na hora; a tarefa periódica `knowledge-publications` (`server.ts`) conclui o que ficou sem dono. Falha passageira solta a posse (até 3 tentativas); `KnowledgeProcessingError` falha na hora.
- **Transição** (`finishKnowledgeVersion`): uma transação com a linha da base travada (`for update`). Confere de novo a situação da versão; se existe vigente de número maior, vira `SUPERSEDED`; senão vira `PUBLISHED` e aplica a configuração à base (`applyConfigToDocument`) na mesma transação. Grava `effective_from` e `published_at`. Na mesma transação, `applyProductScopeAssignment` encerra a vigência de produtos anterior e abre a nova, no mesmo instante da versão (produto desativado até ali: `KnowledgeProcessingError`, a versão falha e nada muda). Em base arquivada, sem a confirmação registrada, a versão vira `SUPERSEDED/ARCHIVED` e a base continua arquivada. Depois do commit, sincroniza o Checkpoint Registry (falha só vai para o log, como antes).
- **Arquivar** (`archiveKnowledge`): cancela o que está em `PROCESSING` (`SUPERSEDED/ARCHIVED`) e marca a vigente como `ARCHIVED`. O rascunho fica.
- **Reativar** (`reactivateKnowledge`): a mesma versão volta a `PUBLISHED`; versão arquivada sem nunca ter sido publicada passa pelo processamento.
- **Reverter** (`revertKnowledgeVersion`): versão nova (`origin = 'REVERT'`) com o conteúdo e a configuração da antiga, inclusive os produtos, direto em `PROCESSING`. Com rascunho, exige `discardDraft: true`. Versão sem configuração registrada volta só com o conteúdo, sobre a configuração em uso.
- **Tentar de novo** (`retryKnowledgeVersion`): as mesmas conferências de publicar. A confirmação da reativação vale por ação: em base arquivada, é pedida de novo, inclusive para falha anterior ao arquivamento.
- **Reprocessar** (`POST /:id/reprocess`, 06/11/2026): converte de novo o arquivo do que está sendo editado ou da versão em uso e grava num rascunho, com `extraction` (migration 176). Com rascunho de outro texto, exige `overwriteDraft: true`. Ver [pdf-para-markdown/relatorio.md](pdf-para-markdown/relatorio.md).
- **Imagens do PDF** (migration 178): ficam em `knowledge_file_images`, por arquivo, e somem com ele. A posição fica em `extraction.images` da versão, com a mesma imutabilidade do resto do registro: reverter copia, editar o rascunho acompanha a linha. Como a posição faz parte do registro, reprocessar uma versão antiga cria rascunho mesmo com o texto igual. Ver [memória da área](memoria/agentes-e-conhecimento.md).
- **Compatibilidade:** `PATCH /:id` ainda aceita `status` (`config:importar` e scripts): `PUBLISHED` vira pedido de publicação, `ARCHIVED` arquiva, os outros só marcam o rascunho. Em base arquivada, `PUBLISHED` exige `reactivate: true`.

**Imutabilidade:** o gatilho `knowledge_versions_content_immutable` recusa mudar conteúdo, hash, configuração, arquivo, número, origem e vínculo de uma versão fora do rascunho. Nenhuma rota apaga versão publicada; só o rascunho em edição pode ser descartado. As provas ainda limpam `knowledge_versions` diretamente, por isso o `DELETE` não é bloqueado no banco.

## 3. Consulta (`knowledge/application/knowledge-consultation-context.ts`)

AsyncLocalStorage, no mesmo estilo de `agent-runtime-context.ts`.

- **Quem abre:** `runAgent`, a etapa de orquestrador do Workflow e o `knowledgeConsultationScope` nas rotas `/realtime/messages` e `/realtime/tool-call`. Dentro de outra, continua nela.
- **Turno de voz:** cada chamada de ferramenta é uma requisição, e o processo pode ser outro. `continueVoiceTurnConsultation` fixa as versões que as chamadas anteriores do mesmo turno já gravaram (o `client_message_id` da resposta começa pelo `turnId`), há até 15 minutos: o `turnId` vem do cliente, e reusar um turno antigo não prende ninguém numa versão substituída. Sem estado em memória, para valer com várias APIs. Duas chamadas simultâneas não se veem: é a limitação registrada.
- **Pin:** `retrieve-knowledge.ts › withConsultationVersions`. A primeira leitura de cada base fixa a versão; as seguintes usam essa, com o título dela. O cache por versão continua valendo. A autorização é sempre a de agora: base que saiu da lista não volta.
- **Registro:** `markKnowledgeVersionsUsed` (trechos entregues ao agente) e `markPinnedDocumentsUsed` (bases citadas pelo esclarecimento). Quem grava chama `recordKnowledgeUsage`: `productionAgentRuns.complete/fail`, `appendConversationMessage` (resposta) e `recordWorkflowKnowledgeUsage` (no QA Lab não grava nada: a transação é só leitura).
- **O que já registrava:** a análise do motor de feedback (`call_assessments`, `feedback_material_recommendations`, `monitoring_evaluations`) continua gravando a versão nos próprios registros.
- **Rastro:** `KnowledgeTrace` ganhou `versionId` e `version` nas bases autorizadas e nos trechos.

## 4. Rotas (`knowledge-router.ts`, sob `knowledge.manage`)

`POST /:id/publish`, `/:id/archive`, `/:id/reactivate`, `/:id/draft/discard`, `/:id/draft/file`, `GET /:id/versions`, `/:id/versions/compare?from&to`, `/:id/versions/:versionId`, `.../file`, `.../preview`, `POST .../retry`, `.../revert`. O detalhe (`GET /:id`) traz `inUse`, `archived`, `draft`, `updates` e `editable`; a lista traz `inUseVersion`, `draftVersion`, `updateVersion` e `updateStatus`, e o `status` passou a ser o da versão em uso.

**Permissões:**

- Ler uma versão exige ler a base **hoje** e também o alcance que a versão tinha (`readableVersion`). Sem isso, 403 `KNOWLEDGE_VERSION_RESTRICTED`, e no histórico a versão aparece só com número e situação. Fora da base ou da organização, 404.
- Publicar, reverter e tentar de novo exigem escrever na configuração em uso e na da versão.
- O leitor de material (`knowledge-material-router.ts`) e o `GET /:id/file` usam `LIVE_FILE_QUERY`: sempre o arquivo da versão vigente, nunca o de um rascunho.

## 5. Comparação (`knowledge-version-history.ts`, `domain/knowledge-version-diff.ts`)

Texto por linha (subsequência comum mais longa, com o começo e o fim iguais fora da conta; teto de `MAX_DIFF_CELLS`, acima dele `TOO_LARGE`). Linha em branco fica de fora, porque o mesmo texto extraído de PDF e de DOCX só difere nos parágrafos; o número de cada linha continua sendo o do texto original. Remoção seguida de adição no mesmo ponto vira "alterada". Configuração campo a campo, em linguagem de tela, com os nomes resolvidos na organização. Arquivo pelo `checksum`. Quando não dá: `NOT_RECORDED` (versão sem `config`), `TEXT_UNAVAILABLE` (sem texto), `TOO_LARGE`.

## 6. Migração 167

Só acrescenta. Não muda status, conteúdo nem hash; nenhum rascunho é publicado, e nenhuma base arquivada volta. `config` só na vigente e na mais recente, porque título, tipo e alcance valiam na hora e não dá para saber os de versões mais antigas; `file_id` em todas as versões (até aqui havia um arquivo por base, enviado na criação); `published_at` nas decididas, a partir de `effective_from` ou `created_at`.

**Resultado no banco de desenvolvimento `inia` (04/11/2026):** hashes idênticos antes e depois para as 98 versões (conteúdo, status, número, datas), as vigentes de 65 bases, as 67 bases, os 65 alcances, os 60 assuntos, os 2 arquivos, os 158 vínculos com agentes e as 41 abrangências por produto. Continuam 91 publicadas, 5 rascunhos e 2 arquivadas. A prova cobre os casos de dado antigo (rascunho que não é publicado, base arquivada que não volta, versão sem configuração registrada).

**Migração 168:** colunas `publish_requested_by`, `reactivation_confirmed_at` e `reactivation_confirmed_by_name`; os rascunhos passam a partir dos produtos em vigor. Nenhuma abrangência em vigor muda, e nenhuma versão muda de situação. **Resultado em `inia` (04/11/2026):** os mesmos hashes de versões, vigentes, bases, alcances, assuntos, arquivos, vínculos e abrangências (também com lista de produtos e vigências) antes e depois, e os mesmos 91, 5 e 2.

## 7. Provas

```bash
cd backend && INIA_DB_PROOF=1 npx vitest run knowledge-version-lifecycle-proof
```

15 cenários, banco de teste real, API e motor reais, provedor simulado (`createApp(pool, { knowledgeInlineProcessing: false })` para a prova controlar o instante da transição). Inclui releitura da mesma base pelas rotas de chat e voz, com a publicação pronta no meio do turno e conferindo o texto que chega ao modelo; Workflow completo com duas etapas de orquestrador, pela API e pelo motor; produtos no ciclo da versão; base arquivada; PDF e DOCX reais (`testing/knowledge-file-fixtures.ts`). Mais `knowledge-version-diff.test.ts`, `text-extractor.test.ts`, `knowledge-router-checkpoint-hook.test.ts` e o caso da consulta em `orchestrator-executor.test.ts`.

## 8. Limitações

- **Marcador de página em PDF antigo:** o extrator acrescentava "-- 1 of 1 --" ao texto, e por isso um PDF digitalizado parecia ter texto. Corrigido (`pageJoiner: ""` em `text-extractor.ts`). A versão já gravada não muda: o marcador aparece como linha removida na primeira comparação com um arquivo novo.
- **Edição simultânea:** a última gravação do rascunho vale (bases na PEN-050, aberta).
- **Produtos em argumentário:** continuam com efeito imediato. Não têm o ciclo de versões.
- **Análise de chamada antiga depois de uma transição:** usa os produtos da data da chamada e o texto da versão em uso na análise. Já era assim.
- **Abertas:** PEN-009 ("Aprovado" sem efeito), PEN-010 (agendamento), PEN-012 (agentes que usam a base no detalhe) e autoria de excluir (PEN-007).
- **Leitores de versão:** `load-prv-closing-data`, `checkpoint-registry-queries` e o corpus de boas práticas leem a mais recente `PUBLISHED` só para o número da versão. Não decidem disponibilidade.
- **Desempenho:** fora desta tarefa. Sem meta e sem otimização.
