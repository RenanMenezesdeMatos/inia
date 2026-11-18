# Memória — Alinhamentos operacionais (`OPERATIONAL_ALIGNMENT_RULE_V1`)

> Implementado em 17/11/2026 (migrations 209 a 213; revisão do mesmo dia pedida pelo usuário: papel próprio, trecho opcional,
> vários processos e tela no padrão da Administração). Ver também [motor-de-feedback.md](motor-de-feedback.md),
> [agentes-e-conhecimento.md](agentes-e-conhecimento.md) e [universo-de-atuacao.md](universo-de-atuacao.md).

## O que é

A operação muda antes da documentação oficial (PR, IT, demais bases). Nesse intervalo, a gestão publica um **alinhamento operacional**:
orientação TEMPORÁRIA que vale como procedimento para um público e um período. É **sempre de um ou mais processos** (bases de
procedimento: PR, IT, fluxos…), mas **nem sempre muda um trecho**: pode ser informação NOVA, que a base ainda não tem (decisão do
usuário, 17/11). Quando conflita com a base, prevalece só no trecho conflitante; o resto do procedimento continua valendo; o conteúdo
oficial nunca é alterado.

Exemplo-guia (Ouvidoria): o PR manda enviar a fatura; o alinhamento do Grupo Ouvidoria (B2C, 10/11 a 30/11) manda orientar o App
Meu Vivo ou o site.

## Cadastro

- Tela: Administração › Atendimento com IA › **Alinhamentos operacionais** (`/admin/operational-alignments`; código em
  `frontend/src/components/operational-alignments/`, `schemas|services|queries/operational-alignments/`). Mesmo padrão dos
  Argumentários: abas Lista × formulário dentro do cartão, lista paginada no servidor (busca por título, processo, Grupo, produto;
  filtros de Grupo/Subgrupo, situação, universo, rascunho; tabela ou cards), cadastro e detalhe NA PÁGINA (nunca Sheet/diálogo de
  preenchimento; só confirmações em AlertDialog: publicar e encerrar). **Seletor de processos** (`process-picker.tsx`) para mais de mil
  bases: busca, tipo (PR, IT, fluxo…) e universo no servidor, páginas com `ListPagination`, "Incluir" por processo ou a página inteira,
  lista dos incluídos com filtro e remoção.
- API: `/api/v1/admin/operational-alignments` (`backend/src/modules/operational-alignments/`), montada com
  **`operational_alignments.manage`** — papel próprio **Gestor de alinhamentos** (`GESTOR_DE_ALINHAMENTOS`, escopos organização/Grupo/
  Subgrupo, delegado por Administrador geral e Administrador; não abre bases, agentes nem configurações) e também incluída em
  Administrador geral e Administrador; capacidade `canManageOperationalAlignments` no menu. `GET /process-options` (bases publicadas,
  paginado; `ids=` devolve os títulos dos incluídos) — o papel não precisa de `knowledge.manage`. Escopo decidido no serviço (`getManageableScopes`): **universo inteiro** só com alcance da organização;
  Grupo/Subgrupo só nos administrados; fora do escopo = 404 (não revela). Universo: o do público (Grupo/Subgrupo classificado), o do
  processo e o do produto têm de ser iguais ao do alinhamento (409 `OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT`); com a
  exigência de universo ativa, quem publica precisa alcançar aquele universo.
- Campos: título, **orientação que passa a valer**, **processos** (1 a 300 bases, em `operational_alignment_version_documents`, 211;
  `affected_document_id` da 209 virou legado), **trecho/assunto que muda** (opcional, 210 — vazio = orientação nova ou complementar),
  **justificativa** (obrigatória, 10+ caracteres), universo, público (`UNIVERSE`|`TEAM`|`SUBTEAM`), produto opcional, **início e
  término** (datas civis, término ≥ início, até 366 dias).
- Ciclo: rascunho → **publicar** (versão imutável) → **encerrar** (motivo). Alterar um publicado = nova versão em rascunho com
  **motivo da alteração**; publicada, substitui a anterior **a partir do início dela** (a anterior fica `SUPERSEDED` com o intervalo
  encurtado; nunca começa antes da anterior: `OPERATIONAL_ALIGNMENT_RETROACTIVE_VERSION`). Encerrar: o intervalo termina agora (o que
  já passou continua coberto); se ainda não começou, fica `CANCELLED`. Descartar rascunho apaga só a linha de rascunho (conteúdo em
  `audit_logs`), como nos Argumentários.
- Autoria/histórico: cada versão guarda criou/alterou/publicou/encerrou (pessoa e instante), motivo da alteração e do encerramento,
  `content_hash`; `audit_logs` (`entity_type = 'operational_alignment'`) registra criação, rascunho, publicação (com a conferência de
  assunto proibido e as relações declaradas), encerramento e reprocessamento.

## Rastro de auditoria, exclusão lógica e filtros encadeados (17/11/2026, migration 212)

- **Rastro (sem tela, só para auditoria)** — `operational-alignments/application/alignment-audit.ts`:
  - `operational_alignment_events` (só inserção): CREATED, DRAFT_SAVED (campos alterados com antes/depois e **processos incluídos/
    excluídos**), DRAFT_DISCARDED (imagem inteira do rascunho), PUBLISHED, SUPERSEDED, STARTED e EXPIRED (job periódico
    `operational-alignments-lifecycle`, a cada 5 min, uma vez por versão, com o instante da vigência), ENDED, CANCELLED, DELETED,
    RESTORED, REPROCESSED — sempre com `actor_person_id` (nulo = relógio, ou restauração cujo autor está em `audit_logs`).
  - `operational_alignment_usages`: **qual versão a IA leu** — superfície (CONVERSATION, AGENT, MONITORING), pessoa, agente, interação
    e data de referência; gravado pela regra única (`resolveOperationalAlignmentsFor` com `usage`), sem aguardar e sem derrubar a
    resposta (no QA Lab a escrita é recusada antes do banco e ignorada).
  - `audit_logs` continua recebendo as ações (entity_type `operational_alignment`).
- **Excluir (lógico, motivo obrigatório)** — `DELETE /:id`: a versão publicada termina AGORA (ou fica cancelada, se não começou), o
  alinhamento sai da lista e aparece em Consultar dados › Itens excluídos (tipo `OPERATIONAL_ALIGNMENT`, permissão
  `operational_alignments.manage` na organização), de onde volta ENCERRADO; para valer de novo, nova versão + publicar. A regra NÃO
  filtra por exclusão: lê os intervalos, então chamada da vigência anterior à exclusão continua coberta (inclusive no reprocessamento).
- **Editar** sempre gera rascunho rastreável (também depois de encerrado); disponível no detalhe e no menu ⋯ de cada linha/card.
- **Encadeamento universo → Grupo → Subgrupo** (tela e formulário; `scope-hierarchy.ts`): `GET /scope-options` devolve os Grupos/
  Subgrupos administrados com o universo de cada um (Subgrupo herda o do Grupo). Escolhido o universo, só aparecem os classificados nele;
  trocar o universo limpa o Grupo/Subgrupo que deixou de caber e tira processos de outro universo; Grupo escolhido antes do universo
  traz o universo dele. No formulário, Grupo sem universo nunca aparece, e o backend recusa
  (`OPERATIONAL_ALIGNMENT_GROUP_UNCLASSIFIED`). O filtro "Todo o universo" lista os alinhamentos sem recorte de Grupo.
- A varredura do mesmo encadeamento no resto do sistema foi aberta como sessão própria ("Filtros e campos respeitando a hierarquia").

## Histórico na conversa e ajuste de segurança (17/11/2026, decisão do usuário)

- **Ferramenta `alinhamentos_anteriores`** (`operational-alignments/application/alignment-history.ts`), na caixa de ferramentas do
  OPERADOR (`leadership-analytics/application/self-context.ts`, ao lado de `my_results`; a voz chega a ela pelo `self_ask`): só
  leitura, sempre da própria pessoa, sem parâmetros. Devolve os alinhamentos que **já não valem** — expirados, encerrados antes ou
  substituídos — dos **últimos 12 meses**, do público da pessoa (universo e Grupo/Subgrupo de hoje), no máximo 20, com referência,
  vigência, processos, a orientação que valia e desde quando/por que não vale. **Excluídos nunca entram** (restaurado volta a entrar).
  O texto vem marcado "REGISTRO: nenhum destes vale mais; nunca oriente por eles" e a regra do operador manda responder como histórico,
  dizendo o que vale hoje pela base oficial.
- **Ajuste de segurança**: o histórico da conversa pode ter uma resposta baseada num alinhamento que deixou de valer. (1) O bloco de
  alinhamentos vigentes diz que só valem os listados; (2) sem nenhum vigente, mas com alinhamento não excluído para as mesmas bases que
  deixou de valer nos últimos 12 meses (`hadRecentAlignments`), o aviso de nenhum vigente ganha a frase de correção; (3) a regra
  do operador (`ALIGNMENT_HISTORY_RULE`) repete: alinhamento citado antes e ausente das instruções atuais não vale mais.
- **"Temos algum alinhamento?" responde por TODOS os processos** (18/11/2026, caso real: a Larissa ouviu "não há nenhum" com um alinhamento
  em vigor para ela): o Orquestrador e cada especialista só veem os alinhamentos das PRÓPRIAS bases, então o aviso de "nenhum vigente" é por
  bases e diz isso ("isso NÃO diz se há alinhamento sobre outros processos"; sem a ferramenta, "sobre esses processos não há"). A
  pergunta usa a ferramenta `alinhamentos_vigentes` (`application/alignments-in-force-tool.ts`, na caixa do operador em
  `self-context.ts`, ao lado de `alinhamentos_anteriores`): em vigor + programados, do público da própria pessoa, pela MESMA leitura do
  Acompanhamento (`listMyAlignments`); `ALIGNMENT_HISTORY_RULE` manda acioná-la. Liderança: ainda não tem a ferramenta.
- **Nenhum vigente é dado, e a pergunta é informativa** (`OPERATIONAL_ALIGNMENT_CONVERSATION_V3`, 18/11/2026, decisão do usuário):
  toda conversa com pessoa conhecida sem alinhamento vigente para as bases do agente recebe `noAlignmentInForceNotice` (antes só
  entrava com alinhamento recente e o "não há" saía por inferência). "Temos algum alinhamento ativo?" se responde só com "não há
  nenhum ativo no momento": nunca acrescentar "siga a base/os procedimentos" nem prometer avisos futuros da INIA ou da liderança
  (caso real: a V2 mandava "oriente pela base oficial" e o modelo aplicava a qualquer pergunta). A base oficial só entra quando a
  pergunta é como proceder; o histórico vazio e a resposta do histórico seguem a mesma regra.
- Liderança: a ferramenta ainda não está na caixa de ferramentas da liderança.

## Regra única (chat e monitoria) — `operational-alignments/domain/operational-alignment.ts`

`resolveOperationalAlignments` (pura) via `resolveOperationalAlignmentsFor` (lê o banco). Ordem:
1. **Data de referência**: chat = agora; monitoria = **data do atendimento** (`interactions.started_at`), nunca a da monitoria ou do
   reprocessamento. Data inválida/ausente → `REFERENCE_DATE_UNKNOWN`: nenhum alinhamento, vale o oficial, e fica registrado.
   (`interactions.started_at` é `not null` no banco; o ramo existe para dado defeituoso.)
2. **Vigência**: datas civis no **fuso da organização** (o da operação, `resolveOrganizationTimezone`), gravado na versão. Início às
   00:00 (inclusivo); término inclusivo até 23:59:59,999 → `effective_from <= ref < effective_until` (`effective_until` = 00:00 do dia
   seguinte).
3. **Público**: universo do colaborador **na data** (`person_operating_universe_history`) igual ao do alinhamento; colaborador sem
   universo só recebe recorte de Grupo/Subgrupo e só antes da exigência de universo; Grupo/Subgrupo do cadastro (o mesmo que a
   monitoria e os argumentários usam).
4. **Processo autorizado**: só alinhamento com ALGUM dos seus processos entre as bases do agente/avaliador daquele fluxo.
5. **Precedência entre alinhamentos**: só entre os que têm PROCESSO EM COMUM, declarados na publicação como do **mesmo ponto**
   (`SAME_TOPIC`; sem declaração = mesmo ponto, conservador): Subgrupo > Grupo > universo. **Mesmo recorte + mesmo ponto + períodos que
   se cruzam = conflito recusado na publicação** (409 `OPERATIONAL_ALIGNMENT_CONFLICT`); sobreposição sem decisão = 409
   `OPERATIONAL_ALIGNMENT_RELATION_REQUIRED` com a lista (a tela pede a decisão). Pontos diferentes (`INDEPENDENT`) = os dois valem.
   Recorte com produto nunca derruba o geral: os dois entram e o texto diz que, para aquele produto, o específico prevalece.
6. **Assuntos proibidos e limites de atuação acima de tudo**: a publicação passa a orientação pela conferência da Governança
   (`checkResponse`); violação = 422 `OPERATIONAL_ALIGNMENT_PROHIBITED_TOPIC`; conferência indisponível = 503 (não publica). Nos
   prompts, o bloco do alinhamento fica antes das restrições e diz que elas valem acima dele; a conferência da resposta do chat segue.
   Alinhamento nunca concede permissão (o cadastro só grava texto; nenhuma regra de acesso o lê).

## Chat e demais orientações

`agents/application/build-system-prompt.ts`: com pessoa conhecida (`governanceSubjectPersonId` ou `alignmentSubjectPersonId`) entra o
bloco `renderAlignmentsForConversation` depois das bases (parte `knowledge`, presente em todos os perfis de prompt), para as bases
autorizadas ao agente. Cobre especialistas do chat e da voz (`run-specialist-tool`, operador da sessão), o coordenador do Orquestrador
(`resolveOrchestratorForSubject` passa a pessoa) e execuções de agente de Workflow (avaliação de processo legada usa a data do
atendimento, `alignmentReferenceDate`). A resposta é instruída a dizer que a orientação é operacional e temporária, com referência
(`AO-XXXXXXXX vN`) e vigência; `KnowledgeTrace.operationalAlignments` guarda o que sustentou a resposta. Sem pessoa (teste do agente,
prévia, coordenação por Grupo), nada entra. Depois do término, o bloco some e vale a base oficial.

## Monitoria (motor de feedback)

- `analyze-call.ts`: `loadOperationalAlignments` (fiado em `engine-wiring.ts`) com a data do atendimento e as bases candidatas do
  especialista. Os aplicados entram no contexto como fonte **A-n** (`feedback-engine/domain/operational-alignment-context.ts`), com
  linhas [L-n], o procedimento que afetam e o assunto. Instruções `OPERATIONAL_ALIGNMENT_PROMPT_V1` na análise, na revisão e na
  confirmação focal. **Sem alinhamento, o pedido é byte a byte o de antes** (mesmas chaves; teste).
- A leitura de QUAL trecho conflita é do modelo (em `sourceConflicts`, semântica — nunca lista de palavras). A **precedência é do
  código** (`applyAlignmentPrecedence`, `OPERATIONAL_ALIGNMENT_PRECEDENCE_V1`, dentro de `verifyObligationAnalysis`, antes da revisão):
  linha de um processo do alinhamento em conflito com linha dele = superada → a obrigação que só se apoia nela fica
  `NOT_APPLICABLE`, `ruleConflict`, motivo `SUPERSEDED_BY_OPERATIONAL_ALIGNMENT` e a referência; a obrigação do alinhamento é avaliada
  normalmente (`operationalAlignment.role = GUIDANCE`); conflito com outro documento continua conflito comum. A revisão também é
  instruída a refutar acusação pelo trecho substituído.
- Memória: `call_assessments.operational_alignments` (versão, hash, vigência, público, critérios superados e avaliados por ele);
  `call_criterion_assessments.verification.operationalAlignment` e `scope.operationalAlignment`; critério do alinhamento é gravado
  num processo dele (`document_id` = o processo apresentado na análise; senão o primeiro).
- Orientação NOVA (sem conflito): obrigação do processo como as outras durante a vigência (`OPERATIONAL_ALIGNMENT_PROMPT_V2`; a V1,
  que falava só em "substituir o trecho", nunca rodou com modelo real). Proveniência do run: `operationalAlignments` + `operationalAlignmentRule`
  (data de referência e o que ficou de fora com o motivo). Alinhamento não vira prática permanente (fora de `organizePractices`).

## Diagnósticos

O Diagnóstico da liderança e a memória do motor **leem a classificação gravada** (`call_criterion_assessments`); não reavaliam a
chamada. Superado = `NOT_APPLICABLE` → fora de desvio, de acerto e de inconclusivo; a investigação de indicador usa `analyzeCall`
(mesma regra) e a memória exclui `rule_conflict`.

## Monitorias já concluídas (reprocessamento rastreável)

- Identificar: tela (detalhe do alinhamento mostra a contagem) ou `GET /:id/affected-assessments` — avaliações VIGENTES de chamadas
  dentro do intervalo de alguma versão publicada, do público na data, com critério do procedimento afetado e SEM o alinhamento na
  fotografia; `withDeviation` = há desvio nesse procedimento.
- Corrigir: `npx tsx scripts/operational-alignments/reprocess.ts --organization <org> --alignment <id>` (só lista) e, com decisão,
  `--apply --reason "…" [--limit N] [--all] [--assessment <id> …]`. Reanálise pelo motor com o MESMO especialista e a data do
  atendimento; gatilho `OPERATIONAL_ALIGNMENT_REPROCESS` com `parentRunId`; a avaliação nova substitui a anterior (`superseded_by`,
  `supersede_reason = 'REANALYZED'`); `audit_logs` `OPERATIONAL_ALIGNMENT_REPROCESSED`. **Consome IA** (rode a lista antes, limite
  pequeno, teto de US$ 1 por validação sem aprovação). Feedback já entregue não é refeito nem retirado por este comando.

## Provas e testes

- `operational-alignments/domain/operational-alignment.test.ts` — regra pura (limites do dia no fuso, data do atendimento, escopo,
  universo, precedência, produto, conflito, validação, texto do chat).
- `feedback-engine/application/operational-alignment-pipeline.test.ts` — caminho completo com modelo falso (Ouvidoria na vigência
  monitorada depois do término; antes do início; depois do término; outro Grupo; pedido idêntico sem alinhamento).
- `agents/application/build-system-prompt-operational-alignments.test.ts` — bloco no prompt do chat, ordem antes das restrições.
- `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operational-alignments-proof` — API real + banco de teste (escopo, validação, fuso
  Fortaleza, conflito, precedência por Subgrupo, versões, encerramento, auditoria, assunto proibido injetado).
- Frontend: `components/operational-alignments/operational-alignments-page.test.tsx`.

## Motivos e Indicadores de sucesso (17/11/2026, migration 213)

- **Motivo do alinhamento** (obrigatório): catálogo da organização `operational_alignment_reasons` com lista inicial (Processo em
  alteração, Processo desatualizado, Contingência, Falha de sistema, Mudança regulatória, Ação comercial ou campanha, Outro); organização
  nova recebe a lista na primeira leitura. Aba **Motivos** da tela: incluir, renomear, desativar (desativado deixa de ser oferecido,
  continua nos registros) — só com alcance da organização; rotas `GET|POST /reasons`, `PATCH /reasons/:id`.
- **Pedidos do cliente relacionados** (antes "Motivo do pedido do cliente"; 0..N, opcional): o catálogo de **assuntos canônicos** das chamadas (`interaction_subject_definitions`)
  em `operational_alignment_version_subjects` — não é lista nova. Incluir pela aba Motivos (`POST /request-reasons`, código gerado do nome
  como os existentes); o assunto incluído serve aos alinhamentos e só classifica chamadas quando a carga de assuntos trouxer o de-para.
  Dev: incluídos Reembolso, Alteração de vencimento, Mudança do papel do gestor e Mudança de endereço (exemplos do usuário).
- **Indicadores de sucesso › 7 · Alinhamentos operacionais** (no fim da página; `inia-success/application/alignments-reader.ts`, seção
  `alignments` com `operational_alignments.manage` e o alcance da tela de Alinhamentos; menu "Indicadores de sucesso" passa a aparecer
  para quem só tem essa permissão): vigentes no período, criados no período, ativos hoje, **mais antigo ativo**, **por área** (Grupo do
  público), **áreas que mais fazem** (Grupo de quem criou, entre os criados no período), **motivo do alinhamento**, **pedidos do cliente relacionados**
  e **bases mais associadas** (top 10 cada). Período e Grupo/Subgrupo da página filtram pelo público; excluídos fora.

## Bateria paga (17/11/2026, teto US$ 1 — gasto US$ 0,56)

`backend/scripts/dev/operational-alignments/paid-battery.ts` (`--teto`, `--so C1,M1`): modelo REAL (gemini-3.8-flash pela rota da
organização), cenário em memória (nada gravado). Chat com o mesmo texto de instruções da conversa; monitoria com o motor real.
Resultado final: 12/12.
- C1 Ouvidoria na vigência → App Meu Vivo/site, "orientação operacional temporária", AO-… e vigência; C2 outro Grupo → PR oficial;
  C3 depois do término, com a resposta antiga na conversa → "aquela orientação temporária não está mais em vigor" + PR oficial;
  C4 histórico → chamou `alinhamentos_anteriores` e respondeu como registro; C5 alinhamento de cancelamento direto contra assunto
  proibido → "não pode cancelar direto… retenção" (a 1ª verificação da bateria tinha uma expressão errada; a resposta estava certa);
  C6 outro trecho do processo → validar titular e protocolo continuam.
- M1 seguiu o alinhamento na vigência, monitorado depois do término → orientação do alinhamento MET, protocolo não informado NOT_MET
  (trecho oficial que continua valendo), envio por e-mail sem falha. Na 1ª rodada a leitura NÃO declarou o conflito (o trecho
  substituído ficou sem registro) → prompt `OPERATIONAL_ALIGNMENT_PROMPT_V3` pede o par em sourceConflicts mesmo sem obrigação e a
  fotografia guarda `supersededLines`; a 2ª rodada registrou a linha substituída. M3 orientação nova não cumprida → NOT_MET pelo
  alinhamento, nada superado; M2 mesma chamada antes do início → PR oficial (não enviar por e-mail = desvio).

## Responsável, autoria no chat e Publicações (17/11/2026, migration 221 — feito pela sessão de Publicações, combinado com esta área)

- **Responsável pela decisão** (`responsible_person_id`, `responsible_job_title` em `operational_alignment_versions`): quem DEFINIU a
  orientação; padrão = quem cadastra. Só liderança ativa da organização (alguém se reporta a ela) ou quem cadastra
  (`OPERATIONAL_ALIGNMENT_RESPONSIBLE_INVALID`, 422). Cargo = `people.job_title` (o da ficha), copiado ao salvar e DE NOVO na
  publicação (a versão guarda o cargo da data em que passou a valer; mudar o cadastro depois não reescreve). Opções:
  `GET /responsible-options?search=` (lideranças + quem cadastra, 20). Entra no rastro como campo `responsiblePersonId` em
  `alignmentChangesOf`; `operational_alignment_usages` continua só com a versão. Versões anteriores ficam nulas (o chat usa quem publicou).
  Tela: seção "Autoria" no formulário (`responsible-picker.tsx`), "definida por …" no histórico de versões.
- **Chat** (`OPERATIONAL_ALIGNMENT_CONVERSATION_V2` em `renderAlignmentsForConversation`, só no modo conversa): cada alinhamento traz
  "Definido por: Nome (cargo) · publicado por: …" (ou só "Publicado por … (responsável pela decisão não informado)") e a instrução de
  COMEÇAR pela conduta e depois dizer de onde veio, atribuindo a decisão a quem definiu, sem deduzir cargo. Modo `evaluation` e o
  contexto A-n do motor (`OPERATIONAL_ALIGNMENT_PROMPT_V3`) NÃO mudaram: autoria nunca entra na avaliação do operador. A visão da
  estrutura do gestor (`renderAlignmentsForStructure`) herda a autoria. Bateria paga
  `scripts/dev/publications/alignment-attribution-battery.ts`: 10/10, US$ 0,04 ("…conforme o alinhamento da supervisora de atendimento
  Ana Souza (AO-… v1)"; versão antiga → "publicada pelo analista …"; sem cargo → só o nome).
- **Publicações**: Administração › Publicações tem as abas Comunicados × Alinhamentos operacionais; a de alinhamentos é ESTA tela
  (`OperationalAlignmentsPage embedded`, sem o cabeçalho próprio; `startWithNew` abre o formulário — `?tipo=alinhamentos&novo=1`). Quem
  só gerencia alinhamentos entra em Publicações e cai direto nos alinhamentos. O item "Alinhamentos operacionais" em Atendimento com IA
  continua (decisão do usuário: "deixa como está").
- Prova: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operational-alignments-responsible-proof`.

## Esclarecimento pelas bases × alinhamento no chat (17/11/2026, `PUBLICATION_RELEVANCE_V1`)

Achado: no chat real (texto e voz) uma pergunta NOVA passa antes pelo esclarecimento pelas bases, que só lê as bases — com ANSWERED ou
INSUFFICIENT ele encerrava o turno e o alinhamento em vigor (que só está no prompt do agente) nunca era aplicado. A bateria paga de
17/11 chamava o agente direto e não passou por esse caminho. Agora (`communications/domain/publication-relevance.ts` →
`clarificationYieldsTo`, no `realtime-router`): se a resposta das bases se apoiou num processo que um alinhamento EM VIGOR para a
pessoa muda (`ALIGNED_PROCESS`), ou se a IA decidiu que a pergunta trata um alinhamento/comunicado (`PUBLICATION_SELECTED`, ex.:
"quais alinhamentos estão valendo?"), quem responde é o agente. Detalhes no item "Quando comunicado e alinhamento entram na conversa"
de [experiencia-do-colaborador.md](experiencia-do-colaborador.md).

## Limitações conhecidas

- Nenhuma chamada real de modelo foi feita: a qualidade da leitura do conflito pelo modelo (sourceConflicts) não foi medida.
- Recorte por produto é condição dada ao modelo (rotulada), não decidida por código; não usa o modo produto do motor.
- Contrato legado `LINES_V7` (respostas antigas reaproveitadas) não aplica a precedência; análise nova usa `OBLIGATIONS_V1`.
- Grupo/Subgrupo do colaborador é o atual do cadastro (como nos argumentários); o universo é o da data.
- "Ouvir com a INIA" (aplicação de feedback) e o coordenador do Orquestrador resolvido só por Grupo não recebem alinhamentos.
- Feedback composto a partir de critério do alinhamento cita o título da seção ("Alinhamento operacional temporário AO-… (vigente …)"),
  mas a tela do feedback não tem selo próprio.
- Dev: migrations 209–212 aplicadas em `inia` e `inia_test` em 17/11/2026; nenhum alinhamento cadastrado no `inia`.

## Público por vários Grupos (17/11/2026, migration 223)

O público passa a ter vínculos (`operational_alignment_version_scopes`, da versão): o universo inteiro OU vários Grupos inteiros e/ou
Subgrupos de Grupos diferentes. A precedência usa o vínculo que alcança cada pessoa; conflito = vínculo idêntico. Detalhes em
[alcance-multigrupo.md](alcance-multigrupo.md).

## Alinhamento no Acompanhamento do operador — fase 1 implementada (18/11/2026, migration 227, não commitado)

Motivo (usuário, 18/11): o alinhamento vale na avaliação das chamadas sem que o operador seja avisado — hoje só aparece no chat, se ele
perguntar, e na monitoria. Decisões do usuário (pergunta com opções, 18/11): leitura simples; sino ao começar a valer; aparece já na
publicação com destaque de "válido a partir de"; um item por alinhamento, sempre atualizado. "Priorize UI/UX."

- **Quem vê**: o público do alinhamento pela MESMA regra da conversa (universo e Grupo/Subgrupo da pessoa HOJE, vínculos 223), lido a
  cada consulta — quem entra no Grupo durante a vigência passa a ver; quem sai deixa de ver. Excluído (lógico) some; restaurado volta.
  Nunca uma lista de destinatários gravada (diferente dos comunicados TEAM).
- **Um item por alinhamento**: mostra a versão publicada mais recente que alcança a pessoa; o instante do item na timeline = publicação
  dessa versão (nova versão sobe com "Atualizado em …" e "O que mudou nesta versão" = motivo da alteração). Encerrado/expirado fica como
  histórico (12 meses, como `alinhamentos_anteriores`) **em vermelho, com o símbolo de PARE** (octógono) no lugar do ícone da família e
  faixa vermelha em destaque "Este alinhamento não está mais vigente" + "Encerrado em …" (ajuste do usuário, 18/11: o cinza não chamava
  atenção); sem botão de leitura; a leitura já feita continua visível.
- **Cartão** (família nova `ALIGNMENT` no `FeedbackEntryHeader`, ícone de rota, tom roxo da marca; vermelho com PARE quando não vale mais):
  linha "ALINHAMENTO OPERACIONAL · ‹público›" + título; selos de estado — "Em vigor · até 30/11 (N dias)" verde, "Atualizado em …" roxo,
  "Não vale mais desde …" vermelho; **vigência sempre visível** em selo próprio ("Vigência 24/11 a 30/11"); processos em selos; blocos
  "O que fazer" (orientação, texto puro com quebras), "O que muda" (trecho, se houver), produto (se houver), "Por quê" (justificativa);
  rodapé "Definido por ‹nome (cargo)›" + ação de leitura.
- **Antes de valer**: aparece já na publicação com faixa âmbar em destaque "Alinhamento válido a partir de ‹dia da semana›, 24/11"
  (+ "Até lá, siga o procedimento de hoje."). A faixa só existe enquanto a data civil de quem lê (fuso da organização) é anterior ao
  início; depois do início some e vale o selo "Em vigor".
- **Leitura simples** ("Li o alinhamento", sem senha; nunca chamar de "ciência" — a palavra é da confirmação com login e senha dos
  feedbacks): tabela nova só de inserção (pessoa × VERSÃO, instante), idempotente; nova versão pede leitura de novo ("Li a nova versão");
  depois: "Você leu em …". Não muda a avaliação das chamadas nem o chat. A liderança vê "N de M leram" (fase 2, no Acompanhamento do
  líder, ramo "Da equipe").
- **Sino**: no job `operational-alignments-lifecycle` (STARTED, uma vez por versão), um aviso para cada pessoa do público naquele
  momento — "Novo alinhamento em vigor: ‹título›" / "Alinhamento atualizado: ‹título›" para versão > 1 —, inserção em lote
  (`insert … select`), com chave de deduplicação por versão × pessoa; rota do sino = o item no Acompanhamento.
- **Filtro "Tipo"**: opção "Alinhamentos" no operador (e na liderança, quando entrar a fase 2).
- **Fora do escopo**: avaliação das chamadas e chat continuam como estão (o alinhamento vale com ou sem leitura).
- **Implementação (fase 1)**: `MY_OPERATIONAL_ALIGNMENTS_V1`. Backend: regra pura `domain/my-alignments.ts` (versão mostrada = a em
  vigor; sem ela, a próxima; sem as duas, a última que valeu; público pela `audienceReasonOf` de hoje), leitura
  `application/my-alignments.ts` (`listMyAlignments`, `markMyAlignmentRead` — 404 fora do público/encerrado/excluído/outra versão —,
  `notifyAlignmentVersionsStarted`), rota `GET /api/v1/operational-alignments/mine` e `POST /:alignmentId/versions/:versionId/read`
  (pessoa só da sessão, `presentation/my-operational-alignments-router.ts`). Migration 227 `operational_alignment_reads` (pessoa × versão,
  só inserção por trigger), aplicada em `inia` e `inia_test`. Sino: `runAlignmentLifecycle` recebe `notifyStarted` e avisa as versões
  cujo STARTED acabou de ser gravado (`returning`); destinatários = `people.role = 'OPERATOR'` ativos do público (líder não recebe); alerta
  `OPERATIONAL_ALIGNMENT_STARTED`, chave `operational_alignment_started:<alinhamento>:<versão>:<pessoa>`, kind `OPERATIONAL_ALIGNMENT`,
  destino `FOLLOW_UP` com `itemId = alignment:<id>`; versão que começou há mais de 2 dias não avisa (implantação/job parado não gera
  enxurrada; alinhamentos que já valiam antes da 227 não avisam). Frontend: `components/operational-alignments/my-alignments/
  my-alignment-entry.tsx` (cartão; famílias `ALIGNMENT` e `ALIGNMENT_ENDED` no `FeedbackEntryHeader`, `FeedbackCard` ganhou
  `className`), fonte `alignment` em `follow-up-timeline.ts`, tipo `ALIGNMENT` ("Alinhamentos") no filtro do operador, deep link
  `?tab=followup&item=alignment:<id>` destacado no feed do operador (`highlightItemKey`), Wiki `/wiki/acompanhamento#alinhamentos` e o
  sino em `wiki-reference.ts`. Provas: `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run my-alignments-proof` (API real, público, estados, nova
  versão, leitura, sino, excluído), `domain/my-alignments.test.ts`, `my-alignment-entry.test.tsx`. Dev não tinha nenhum alinhamento
  publicado em 18/11 (conferência visual pendente).
- **Fase 2 — quem lidera (18/11/2026, não commitado, `STRUCTURE_OPERATIONAL_ALIGNMENTS_V1`)**: `application/structure-alignments.ts`
  (`listStructureAlignments`): alinhamentos cujo público alcança algum liderado ativo (regra de público em SQL, `alignmentReachesPersonSql`,
  a mesma da `audienceReasonOf` pelo cadastro de hoje), um por alinhamento pela mesma escolha do operador (`pickDisplayVersions`), com
  `reach = { people, read }` (pessoas da estrutura alcançadas e quantas marcaram "Li o alinhamento" na versão mostrada).
  - **Feed do líder**: porta `performance-analytics/application/follow-up-alignment-source.ts` (padrão: `infrastructure/
    structure-alignment-source.ts`, como a dos comunicados); `loadFollowUpFeed` une um ramo `ALIGNMENT` (lista da porta passada por
    `unnest(ids, instantes)`, mesmo keyset e período), só na própria estrutura, fora de "Só aguardando ciência" e de "Para mim" (é "Da
    equipe"), tipo `ALIGNMENT` no filtro (`FOLLOW_UP_TYPES`). Item `kind/category = ALIGNMENT` com `alignment` (StructureAlignment).
    Frontend: o MESMO cartão (`MyAlignmentEntry`) com "N de M pessoas da equipe leram esta versão" e barra, sem botão de leitura.
  - **Chat do líder**: ferramenta `leadership_alignments` (estrutura opcional, como as demais `leadership_*`; em vigor + programados, com
    alcance e leituras; `renderStructureAlignments`), regra de roteamento em `LEADERSHIP_RESPONSE_RULES` ("nunca responda que não há sem
    ela"). Voz do líder chega por `leadership_ask`.
  - Prova: `my-alignments-proof` cobre alcance/leituras, o ramo no feed com tipo, Da equipe, Para mim, ciência, sem a própria estrutura e o
    cursor. Dev 18/11: equipe da Daniela Duarte Rocha = 39 liderados, os 3 TESTE QA alcançam 36.
- **Consulta de processo de quem lidera respeita o alinhamento (18/11/2026, caso real do diretor)**: "Como a equipe deve registrar uma
  contestação?" era respondida pelo ESCLARECIMENTO pelas bases (texto final = o do esclarecimento) e o alinhamento que muda aquele registro
  para um Subgrupo nunca aparecia. Agora o `clarify` da liderança (`realtime-router.ts`) aplica a MESMA regra do operador
  (`clarificationYieldsTo`): a decisão da IA de relevância passa a receber também os alinhamentos em vigor para os PÚBLICOS da estrutura
  (`conversation-publications.ts` → `resolveAlignmentsForStructure`, import adiado por ciclo) e, com alinhamento/comunicado escolhido
  (PUBLICATION_SELECTED) ou base apoiada num processo alinhado (ALIGNED_PROCESS), o esclarecimento cede a vez ao Orquestrador do Grupo, que
  responde com os alinhamentos da estrutura nos especialistas; o funil (pergunta em aberto) nunca é desviado. Continuação pelo formulário
  (escolha de uma opção) ainda responde direto pelas bases — limitação.
  - Conferência da resposta no caminho do líder: a consulta de processo e o bloco da estrutura no topo (`leaderStructureContext`) passam a
    mandar o texto publicado dos alinhamentos/comunicados como fonte PUBLICATION (V6); a fonte do alinhamento leva referência, público,
    vigência, quem definiu, trecho, orientação e motivo (sem isso, "definida pela supervisora X, para o Subgrupo Y" era barrado).
  - Replay real (diretor, 3 tentativas, 18/11): esclarecimento sem alinhamento → barrado (V3, sem fonte) → barrado (V6 sem público/autor) →
    entregue (V6) com a exceção do Subgrupo e o procedimento padrão. Custo de tempo: a consulta que cede vai ao Orquestrador de todos os
    Grupos da estrutura (~90 s para o diretor com 12 Grupos, contra ~40 s pelo esclarecimento).
  - **Tempo (mesmo dia, sem mudar decisão)**: a decisão de relevância roda JUNTO do esclarecimento (antes, depois dele) e, quando ela já
    escolheu alinhamento/comunicado, a orquestração do Grupo começa sem esperar o esclarecimento (se ele abrir pergunta, vale o funil e a
    orquestração antecipada é descartada — custo só nesse caso). Diretor: 91 s → 64 s, mesma resposta, conferência V6 aprovada. O que resta é
    estrutural: especialistas (~17 s), síntese do Orquestrador do Grupo (~11 s) e a reescrita final pelo modelo da liderança (~10 s) —
    pular a reescrita mudaria o texto e precisa de avaliação de qualidade antes (regra "qualidade acima de velocidade").

