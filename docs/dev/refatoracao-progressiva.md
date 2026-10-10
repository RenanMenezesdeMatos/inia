# Refatoração progressiva — organização, padronização e código obsoleto

Data: 07/10/2026 · branch `admin-list-standardization` · sem commit (working tree compartilhado com outras sessões).

Objetivo: deixar o código mais fácil de navegar e manter **sem mudar comportamento** — rotas, contratos HTTP, formatos de
dados, permissões, regras de negócio e aparência continuam os mesmos. Nada aqui é reescrita, troca de arquitetura ou
atualização de dependência.

Fora do escopo, de propósito:

- **Central de Dados / instalação** (`modules/data-hub`, `infrastructure/installation`, `backend/package.json`, scripts de
  instalação): trabalho em andamento de outra sessão no mesmo working tree.
- **Prompts e esquemas de resposta dos modelos** (`feedback-engine`, `investigation`, `reliable-feedback`): são contratos
  versionados; replays e rodadas pagas dependem de pedidos idênticos byte a byte. Duplicação ali é intencional.
- **Scripts de avaliação congelados** (`scripts/feedback-engine/evaluation/**/evaluate-round-*`, `scripts/poc-tools/**`): o
  hash de cada um está registrado nos arquivos `*-freeze.json` das rodadas; editar apagaria a evidência histórica.

## 1. Linha de base (antes de qualquer mudança)

| Verificação | Backend | Frontend |
|---|---|---|
| `tsc --noEmit` | limpo | 2 erros — da reorganização do sidebar feita em paralelo por outra sessão (já concluída) |
| `eslint` | 4 erros (variáveis sem uso em 4 scripts) | 0 erros, 33 avisos (`react-hooks/set-state-in-effect`, mantidos como aviso de propósito) |
| `vitest run` | 3 falhas, todas timeout de 5 s sob carga — passam isoladas | 5 falhas, timeouts sob carga + benchmark de CPU do lip-sync — passam isoladas |
| `next build` | — | o build de 06/10 mapeava **duas** páginas para `/` |

Ferramentas de diagnóstico (instaladas fora do projeto, nada foi adicionado ao `package.json`): `knip` 5 (código e
dependências sem uso, com os pontos de entrada reais: `server.ts`, CLIs de banco/instalação, scripts, testes, rotas do
App Router, `proxy.ts`) e `jscpd` 4 (duplicação, mínimo de 12 linhas / 90 tokens).

## 2. Diagnóstico

**Estrutura.** O backend já é um monólito modular consistente — `src/modules/<domínio>/{domain,application,infrastructure,presentation,testing}`,
com imports relativos e extensão `.js` (NodeNext). O frontend segue camadas por tipo, e dentro delas por feature:
`app/` (rotas) · `components/<feature>/` · `queries/<feature>/` (TanStack Query) · `services/<feature>/` (HTTP) ·
`schemas/<feature>/` (zod) · `lib/` (utilitários com propósito) · `hooks/`. Reorganizar em pastas por feature não se paga:
o padrão atual é seguido em quase todo o código e mexer nele tocaria centenas de arquivos de outras sessões.

**Duplicação** é baixa (jscpd: 0,29% no frontend, 0,20% no backend). Os clones relevantes foram tratados; os restantes
estão no inventário (seção 6).

**Problemas encontrados, por prioridade** (impacto × risco × esforço):

| # | Problema | Impacto | Risco | Esforço | Tratamento |
|---|---|---|---|---|---|
| 1 | Rota `/` definida duas vezes (`app/page.tsx` e `app/(app)/page.tsx`); a segunda nunca era servida e arrastava `components/home/*` e `mock/app/*` (dados simulados) | alto (confusão, rota ambígua que pode mudar de dono numa atualização do Next) | baixo | baixo | removida a página sombreada e tudo que só ela usava |
| 2 | Tipos do operador escritos à mão em `mock/operator/types.ts`, duplicando os tipos que o zod já infere em `schemas/operator` (e já defasados: sem `origin`, `subtitle`, `occurredAt`) | médio | baixo | baixo | fonte única = `schemas/operator`; `mock/` removido |
| 3 | Formatação de data copiada: `format-alert-time.ts` ≡ `format-message-date-time.ts`; "AAAA-MM-DD → dd/mm/aaaa" em 5 lugares; `formatDateTime` de uso geral morando em `lib/analytics` | médio | baixo | baixo | `lib/format/date.ts` |
| 4 | `node-config-panel.tsx` com 3.909 linhas e 77 declarações (um formulário por tipo de nó, tudo no mesmo arquivo) | alto (manutenção do editor de Workflows) | médio | médio | dividido em `node-config/*` |
| 5 | Mesma sequência transacional (caso → evidência → feedback → materiais → investigação → publicação) copiada em `create-{monitoring,indicator,orchestrator}-feedback.ts` | médio | médio | baixo | `create-approved-feedback.ts` |
| 6 | Quatro buscas "para trás" no grafo do Workflow com o mesmo percurso, só a regra de parada diferente — espelhadas no frontend | médio | médio | baixo | um percurso único com a regra explícita, nos dois lados |
| 7 | Helpers de teste em `application/testing/` em 4 módulos (os outros 24 usam `<módulo>/testing/`) | baixo | baixo | baixo | movidos |
| 8 | Schemas soltos na raiz de `frontend/src/schemas/` | baixo | baixo | baixo | movidos para a pasta da feature |
| 9 | `ui/sidebar.tsx` importava `cn` de um pacote npm (`cn`) em vez de `@/lib/utils`; `ui/radio-group.tsx` importava um pacote transitivo (`@radix-ui/react-radio-group`) que não está no `package.json` | baixo | baixo | baixo | padronizados; dependência `cn` removida |
| 10 | Código e dependências sem uso | baixo | baixo | baixo | removidos quando confirmados; resto inventariado |
| 11 | `backend/tsconfig.json` inclui `src/` e uma pasta `tests/` que não existe — os 224 scripts **nunca passavam por checagem de tipos** (eram 76 erros em 8 scripts) | médio | baixo | baixo | `tsconfig.scripts.json` + `npm run typecheck:scripts`; scripts congelados excluídos (seção 7) |
| 12 | Validação de publicação de Workflow escrita duas vezes — `validate-workflow-for-publish.ts` (backend, 1.692 linhas, fonte da verdade) e `schemas/admin/workflow-validation.ts` (editor, 981 linhas, espelho à mão) — sem nada provando que as duas dizem o mesmo; as regras moravam dentro de duas funções enormes | alto (o editor só chama o dry-run quando não tem problema local: regra a mais no editor bloqueia o que o backend aceitaria) | médio | médio | teste de paridade regra a regra + divisão de cada lado por família de regra (seção 5); as 12 divergências achadas foram corrigidas no editor em 08/10, que passou a seguir o backend (seção 5) |
| 13 | `CLAUDE.md` com ~494 KB — 87 seções de memória carregadas inteiras em toda sessão, a maioria histórico de versões | alto (contexto de todas as sessões) | baixo | médio | vira índice: ficam o papel, o produto, a organização do código e 5 regras transversais; o resto foi movido sem edição para `docs/dev/memoria/<área>.md` |

## 3. Estrutura adotada e onde colocar arquivos novos

### Backend

- Código de produto vive em `src/modules/<domínio>/`:
  - `domain/` — regras puras, sem I/O (tipos, validações, cálculos, contratos);
  - `application/` — casos de uso que orquestram domínio + portas; SQL de leitura específica de caso de uso também fica aqui quando não há porta;
  - `infrastructure/` — adaptadores (Postgres, provedores de IA, arquivos);
  - `presentation/` — routers Express (validação da requisição, permissão, resposta);
  - `testing/` — **tudo que só existe para teste** do módulo: repositórios em memória, fixtures, fakes e provas de banco (`*-proof.test.ts`, ativadas por `INIA_DB_PROOF=1`). Nunca `application/testing/`.
- Testes unitários ficam ao lado do arquivo testado (`x.ts` + `x.test.ts`).
- Caso de uso que cresce além de um arquivo legível vira uma pasta de partes ao lado da entrada, que mantém a mesma API
  (ex.: `workflows/application/validate-workflow-for-publish.ts` + `workflows/application/publish-validation/*`, uma
  família de regra por arquivo).
- O que é de mais de um módulo e não pertence a nenhum domínio vai para `src/shared/{domain,application,infrastructure,presentation}`
  — só com um propósito nomeado (ex.: `shared/application/model-routing`, `shared/domain/clock.ts`). Nada de `utils/` genérico.
- CLIs (migrations, seeds, instalação) ficam em `src/infrastructure/*` porque o `package.json` aponta para eles.
- Scripts de uso pontual vão em `backend/scripts/<área>/`; não são importados por código de produto.

### Frontend

- `app/` só tem rotas (o App Router dá significado aos nomes); a página monta componentes de `components/<feature>/`.
- Cada feature replica as camadas: `components/<feature>/` · `queries/<feature>/use-*-queries.ts` · `services/<feature>/*-service.ts` · `schemas/<feature>/*.schema.ts`.
  Schemas nunca soltos na raiz de `schemas/`.
- Tipos de payload da API vêm do schema zod (`z.infer`) — nunca reescritos à mão em outro lugar.
- `components/ui/` é o kit do design system (shadcn/Radix): não se importa nada de feature ali; primitivas sem uso podem ficar (kit).
- `lib/<propósito>/` para utilitários compartilhados com propósito claro (`lib/format/date.ts`, `lib/realtime/`, `lib/avatar/`...);
  `lib/utils.ts` guarda só o `cn` (convenção do shadcn).
- `hooks/` guarda hooks genéricos de interface; um hook que só embrulha uma infraestrutura fica ao lado dela
  (ex.: `lib/admin/use-admin-mutation.ts` embrulha `lib/admin/admin-api.ts`).
- Memória de projeto nova vai para `docs/dev/memoria/<área>.md` (índice no `CLAUDE.md`, critérios no README da pasta); o
  `CLAUDE.md` só recebe regra que vale para qualquer código.
- Ajustes do ambiente de teste que valem para todos os arquivos ficam em `frontend/vitest.setup.ts`; limites de tempo
  do backend em `backend/vitest.config.ts`.
- Componente que cresce além de um arquivo legível vira uma pasta de partes ao lado da entrada pública, mantendo a API
  do arquivo original (ex.: `workflows/node-config-panel.tsx` + `workflows/node-config/*`, `qa-lab/run-result.tsx` + `qa-lab/run-result/*`,
  `operator/operator-inia-chat.tsx` + `operator/operator-inia-chat/*`; fora de componente:
  `schemas/admin/workflow-validation.ts` + `schemas/admin/workflow-validation/*`). Num componente com estado compartilhado, só sai o que tem
  responsabilidade própria (um hook com o estado dele, uma derivação pura, um trecho de apresentação); o resto fica junto.

## 4. Convenções de desenvolvimento (as que o código já segue e foram mantidas)

- Arquivos e pastas em `kebab-case`; componentes em `PascalCase`; constantes de catálogo em `SCREAMING_SNAKE_CASE` (`*_LABELS`, `*_VERSION`).
- Backend: imports relativos com extensão `.js`; frontend: alias `@/`.
- Validação na fronteira: zod no router (backend) e no parse da resposta do serviço (frontend).
- Erros de negócio: `DomainError(mensagem, CÓDIGO, status)`; o frontend mostra a mensagem e decide pelo código.
- Datas: data civil (`AAAA-MM-DD`) nunca passa por `Date`; instante ISO é formatado pelo `lib/format/date.ts`.
- Comentários em português, explicando decisão ou restrição — nunca repetindo o código.
- Contratos versionados (prompts, esquemas de resposta, `*_VERSION`) só mudam com nova versão; nunca "limpeza" de estilo.
- Regra de publicação de Workflow: nasce no backend, no arquivo da família em `workflows/application/publish-validation/`
  (lança `DomainError` com código). Se o editor consegue checar sem banco, ela é espelhada no arquivo de mesmo nome em
  `frontend/src/schemas/admin/workflow-validation/`, com o MESMO código no campo `code` do problema, e ganha um caso em
  `backend/src/modules/workflows/testing/publish-validation-parity-cases.ts` (espelhada ou "só backend"). O teste de
  paridade falha com código do backend sem caso, código do editor que o backend não tem ou regra que dá resultado diferente.

## 5. Refatorações realizadas

| Mudança | Arquivos | Como foi validado |
|---|---|---|
| Rota `/` única; remoção da home simulada sombreada | `app/(app)/page.tsx`, `components/home/*` (8), `mock/app/*` | dev e build serviam a landing pública em `/` antes; `next build` agora lista uma só página para `/` |
| `/` deixa de ter tela (decisão de produto, 07/10): vira a porta de entrada | `app/page.tsx` redireciona — sem sessão → `/auth/login`; com sessão → tela inicial da pessoa (`landingRouteFor`); o layout da Administração manda quem não tem acesso direto para a tela inicial, sem passar por `/` | `curl` no servidor de dev: sem sessão `307 → /auth/login`; sessão de operador demo `307 → /operator`; de supervisor demo `307 → /supervisor` |
| Tipos do operador só do zod | `mock/operator/*` → `schemas/operator` (+ tipo `OperatorIndicatorsHistoryKind`) | `tsc` |
| `lib/format/date.ts`: `formatCivilDate`, `formatDateTime`, `formatShortDateTime` | 2 arquivos removidos, 8 cópias locais (4 de data civil, 4 de data e hora) substituídas e 21 consumidores migrados (os 2 da Central de Dados pela sessão dona deles); o alias temporário `formatShortDate` foi removido | o formatador antigo × o novo deram **0 diferenças em 25 combinações** de valor × opções; `formatDateTime` produz o mesmo texto que as variantes `dateStyle/timeStyle short` (conferido no ICU do Node); teste novo `lib/format/date.test.ts` |
| Painel de configuração de nós dividido | `node-config-panel.tsx` (3.909 → 179 linhas) + 22 arquivos em `node-config/` | divisão por AST (TypeScript), não por regex: **77/77 declarações idênticas** byte a byte; nenhum ciclo de import; testes do editor (374) + teste novo `node-config-panel.render.test.tsx` (monta o painel para os 11 tipos de nó); o lint do código movido caiu de 5 para 0 avisos (3 imports sem uso na divisão; as 2 assinaturas redundantes de consulta depois) |
| Chat da INIA dividido | `operator/operator-inia-chat.tsx` (2.512 → 2.009 linhas) + 13 arquivos em `operator/operator-inia-chat/`: as declarações de topo (`chat-message`, `voice-context`, `recado`, `feedback-session-model`, `stage-speech`, `mic-level`, `chat-visuals`) e, de dentro do componente, o balão do palco (`use-stage-speech`), o convite proativo (`use-feedback-invite`), o que a sessão de feedback mostra sobre si (`feedback-session-speech`, função pura), a lista de mensagens (`chat-message-list`), os avisos do painel (`panel-conversation-banners`) e o consentimento do microfone (`mic-consent-dialog`) | divisão por AST com o checker do TypeScript resolvendo cada símbolo (o que o trecho usa do componente vira parâmetro; o que o componente usa dele volta no retorno) e verificação independente que lê só os arquivos gerados: **52/52 declarações de topo idênticas** (45 só ganharam `export `); das **236 instruções do componente**, 191 ficaram idênticas e na mesma ordem, 42 foram para um hook/função idênticas, 1 idêntica com o comentário de seção mantido na entrada, e o JSX da lista de mensagens e dos dois trechos do `return` aparece idêntico no componente novo; o que é novo na entrada são só as 3 chamadas (`useStageSpeech`, `useFeedbackInvite`, `describeFeedbackSession`); hooks com efeito chamados no lugar do efeito original (a ordem dos efeitos não muda); nenhum ciclo de import e nenhuma parte importa a entrada. 7 testes de caracterização gravados **antes** (ordem do turno de voz com o debounce, barge-in com só o trecho ouvido — no painel e no palco —, conversa encerrada aberta pelo histórico, nível do microfone pintado no DOM, separadores de data, recado já entregue); testes do operador 82/82; o HTML final de cada um dos 82 testes, capturado antes e depois, ficou **idêntico byte a byte** no chat e na sessão de feedback (o único que varia é o de `follow-up-timeline`, que já variava entre duas execuções do original); `tsc` limpo; `eslint` do frontend inteiro 0 erros / 25 avisos antes e depois, sem nenhuma mensagem diferente por arquivo. O resto da entrada é uma máquina de estado só — conversa, sessão de feedback, transporte de voz e envio dividem ~60 estados/refs, as funções se chamam entre os grupos e os eventos da sessão de voz são criados uma vez com as funções do primeiro render — e ficou junto (ver seção 8) |
| Lint do React Compiler volta a analisar o chat da INIA; recado de voz e campo de mensagem saem da entrada | `operator/operator-inia-chat.tsx` (2.009 → 1.866 linhas) + `operator-inia-chat/use-recado.ts` (hook: o convite que vem do inbox, a fala nesta tela, a oferta registrada uma vez, a voz preparada, o foco vindo do sino e as ações ouvir agora/parar/depois/ouvir de novo; chamado no lugar dos efeitos do recado) + `operator-inia-chat/chat-composer.tsx` (campo de mensagem). Na entrada: as 58 funções internas viram `const` — o compilador não aceita referência antecipada a `function` dentro do componente, e há ciclos entre elas (transporte → fim do turno → recarregar a sessão → apresentação → transporte); os efeitos da montagem, do convite do recado e o de desmontagem passam para depois das funções, na mesma ordem entre si; o `Date.now()` de `applyVoiceConversationResult` vai para `markConversationActivity` (também usada por `adoptConversation`) — era falso positivo: a chamada fica num callback assíncrono, nunca no render; o pulso do microfone do campo chega como callback ref (`micPulseRef`), como já acontecia em `IniaCallControls` (era a "mutação de prop") | verificação independente que lê só os arquivos (original × entrada + hook + componente): 4/4 declarações de topo idênticas; das **196 instruções do componente, 191 idênticas em texto e comentário** (172 na entrada, 18 no hook, 1 no campo de mensagem; nas funções só o cabeçalho `function f(…)` → `const f = (…) =>` muda — parâmetros, retorno, `async` e corpo iguais); as outras 5 são exatamente as mudanças descritas (2 comentários de seção, 2 linhas do `Date.now`, e o JSX do campo de mensagem, 54 linhas, que difere só na linha do pulso); **ordem dos 23 hooks com efeito idêntica** (o `useRecado` expandido no lugar da chamada); nenhuma referência, durante o render, a uma `const` antes da declaração (o risco novo de trocar `function` por `const`). Testes de caracterização já existentes; testes do operador 82/82 e o HTML final de cada um dos 82, capturado antes e depois de cada passo (correção, recado, campo de mensagem), **idêntico byte a byte**; suíte do frontend 1.523 (1 pulado); `tsc` limpo; `next build --webpack` ok (o Turbopack recusa o `node_modules` em symlink do worktree de verificação); `eslint` do frontend 0 erros / 26 avisos (25 antes + 1 novo, ver seção 8). Sabotagem: ref lida e `Math.random()` no render são acusadas agora e passavam em silêncio no original |
| Resultado do QA Run dividido | `qa-lab/run-result.tsx` (1.566 → 179 linhas: `RunResult` + reexportação da API pública) + 13 arquivos em `qa-lab/run-result/` | mesma divisão por AST: **54/54 declarações idênticas** byte a byte, comentários incluídos (22 só ganharam `export `); nenhum ciclo de import; teste novo `run-result.render.test.tsx` gravado **antes** da divisão (passos de Condition, coleção, ranking e consolidação, os 9 tipos de efeito simulado, requests de IA, contexto e as pendências do trace principal e do fan-out) e o HTML de 13 estados renderizados ficou **idêntico byte a byte** depois; testes do QA Lab (48); lint 0 → 0 avisos. Dois comentários ainda dizem "acima" para algo que agora mora em outro arquivo — mantidos para preservar a identidade |
| `createApprovedFeedback` | `feedbacks/application/create-approved-feedback.ts` + os 3 criadores | teste de caracterização novo (`create-feedback-records.test.ts`) gravado **antes** da mudança: registra tabela × coluna × valor de cada inserção e passou igual depois; o SQL novo foi executado no PostgreSQL de teste em transação com rollback (o enum `feedback_kind` aceita o parâmetro) |
| Percurso único para trás no grafo do Workflow | `workflows/domain/graph-schema.ts` (4 funções) e `schemas/admin/workflow-graph.schema.ts` (3) | versão antiga × nova em grafos aleatórios com ciclos, laços e arestas soltas: **110.504 + 82.827 comparações, 0 diferenças**; testes de workflows (backend 965, frontend 374) e prova de banco `workflow-results-proof` |
| Paridade da validação de publicação (backend × editor) | teste novo `workflows/application/validate-workflow-for-publish.parity.test.ts` + `workflows/testing/publish-validation-parity{,-cases,-sweep}.ts`; cada problema do editor ganhou `code` = código da regra do backend que espelha (tipo `ValidationIssue`; a UI não mostra; `GraphIssue` não mudou) | o teste carrega o validador do editor pelo código-fonte do frontend e roda os dois sobre o MESMO Workflow, com banco falso permissivo (regra que depende de banco só falha quando o caso pede): os 22 modelos publicáveis nos dois lados; **135 regras espelhadas** (um caso por regra, grafo-base válido: mesmo código e mesmo nó dos dois lados); **23 regras só do backend** (agente/orquestrador/indicador/estratégia/hierarquia/módulo — o editor não tem o dado); **12 divergências reais registradas** (corrigidas no editor em 08/10 — linha "Divergências backend × editor corrigidas"); catálogo completo (todo código do backend tem caso, todo código do editor existe no backend); varredura com semente fixa de 3.000 mutações dos 22 modelos (1.510 recusas pela mesma regra, 1.103 válidos, 377 nas divergências registradas). Sabotagem conferida: tirar duas regras do editor derruba 3 testes. Os 39 testes antigos do editor que comparavam o objeto inteiro do problema passaram a incluir o `code` |
| Validação de publicação dividida por família de regra | backend: `validate-workflow-for-publish.ts` 1.692 → 92 linhas (carregamentos + chamadas na ordem original; o publish para no primeiro erro) + 11 arquivos em `application/publish-validation/` (`context`, `source-paths`, `trigger-context`, `conditions`, `actions`, `orchestrators`, `review-escalation`, `outputs`, `fan-out`, `indicator-diagnosis`, `reliable-feedback`); editor: `workflow-validation.ts` 981 → 63 linhas + os mesmos 11 nomes em `schemas/admin/workflow-validation/` (`types` no lugar de `context`). Entradas com a mesma API (todas as exportações reexportadas) | divisão por AST, como em `node-config/*`: as declarações de topo movem **idênticas byte a byte** (backend 34/34, editor 22/22 — 6 só ganharam `export `; o comentário de abertura do módulo, que estava preso a `PublishValidationRow`, ficou na entrada) e as regras que moravam DENTRO das duas funções principais viraram funções de família com os comandos **idênticos** (backend 46/46, editor 28/28, comparados após re-indentação uniforme; o laço misto do editor — Definir variável/Output/Orquestrador — continua um laço só, chamando uma função por família, para a lista de problemas sair na mesma ordem); o único código novo é contexto/desestruturação/chamada; nenhum ciclo de import. **Caracterização gravada antes**: 6.192 Workflows (modelos, todos os casos e 6.000 mutações com outra semente) — veredito e mensagem do backend, lista ORDENADA de problemas do editor e a sequência de consultas ao banco ficaram **idênticos byte a byte** depois. Testes de workflows (backend 1.027, editor 385), tsc e eslint limpos. Comentários que dizem "acima"/"abaixo" sobre algo que agora está em outro arquivo foram mantidos para preservar a identidade |
| `CLAUDE.md` em índice + memória por área | `CLAUDE.md` (506.102 → 21.771 bytes) + `docs/dev/memoria/` (README com critérios e o mapa seção → arquivo, 15 áreas em uso, 3 de histórico, ferramentas de migração em `ferramentas/`) | `ferramentas/verificar.mjs` contra a cópia do original: **87/87 seções inteiras, idênticas e únicas no destino**, 1.165/1.165 linhas, 167 links relativos válidos; as únicas linhas novas são o índice, a nota no topo de cada área e o README. Conferência independente em Python: 0 de 1.166 linhas, 0 de 271 parágrafos, 0 de ~2.104 frases faltando. Integrado no principal com o mesmo sha de entrada (`e762eb3f…`) |
| `workflow-router.ts` dividido por grupo de rotas | `workflows/presentation/workflow-router.ts` (914 → 32 linhas: opções + registro na ordem original) + 7 arquivos em `presentation/workflow-router/`: `query-routes`, `enrollment-routes`, `definition-routes`, `lifecycle-routes`, `manual-run-routes` (com as duas funções auxiliares do Gatilho Manual), `variable-routes` e `shared` (o que mais de um grupo usa); `WorkflowRouterOptions` reexportado pela entrada | divisão por AST: **24/24 declarações de topo idênticas** (só ganharam `export `), **28/28 comandos do `createWorkflowRouter` idênticos**; a tabela de rotas do Express montada pelo original e pela versão nova é **idêntica** (23 camadas: método, caminho, nº de handlers e ordem — a ordem de registro importa no Express); nenhuma parte importa a entrada, nenhum ciclo; `tsc`, `eslint`, testes do módulo `workflows` + `app` (1.032) e as provas de banco `manual-run-proof` e `workflow-results-proof` |
| Código sem uso do backend removido | 144 declarações em 86 arquivos: 93 constantes/funções e 51 tipos (inventário e critério na seção 6) + 12 imports e 3 constantes locais que só serviam a elas | knip com scripts e testes como pontos de entrada e `ignoreExportsUsedInFile` (só o que não é usado em lugar nenhum, nem no próprio arquivo), conferido nome a nome por busca no repositório inteiro (backend, scripts, frontend, docs); repetido até o ponto fixo (3 rodadas de cascata); diff revisado contra o backup — os comentários de módulo que estavam colados numa declaração removida voltaram para a declaração seguinte; `tsc`, `typecheck:scripts`, `eslint` limpos; suíte completa do backend 4.190 testes, 0 falha |
| Avisos de hooks do frontend: 25 → 0 | 19 arquivos. Estado copiado de prop/dado do servidor/URL (editor de agente, orquestrador, turno do usuário, gatilho, nome e configurações do Workflow, seletor de agente, aba da Governança, abrir pelo `?new`) passou do efeito para o **ajuste durante a renderização** recomendado pelo React (guarda o valor anterior e ajusta quando ele muda); `useIsMobile`, o tema do React Flow e as preferências de acessibilidade passaram a `useSyncExternalStore` (a acessibilidade virou um armazenamento único sobre o `localStorage`); `groupOptionsFor` virou função pura; `teamsForCompatibility` memoizado; import sem uso removido; `ui/carousel` (kit, sem uso) mantido com a exceção justificada na linha | testes de caracterização gravados **antes** e verdes antes e depois: `hooks/browser-state-hooks.test.tsx` (7), `governance-page.test.tsx` (2), caso novo em `agent-picker.test.tsx`, e o teste de persistência da acessibilidade que já existia (`providers.test.tsx`); `tsc` limpo; `eslint` 0 erros/0 avisos (o lint do chat, integrado depois, trouxe 1 aviso novo e justificado — seção 8); suíte completa 1.533 testes, 0 falha. Diferenças de tempo (nunca de estado final), registradas na seção 8 |
| Divergências backend × editor corrigidas (08/10, decisão do usuário: "não podemos ter divergência"; o backend é a fonte da verdade) | editor: `schemas/admin/workflow-validation/conditions.ts` (Condition de dados numa função só, `validateDataCondition`, usada também pelo critério de "Selecionar colaboradores"; checagem tipada de variável/campo estruturado, como no backend), `fan-out.ts`, `reliable-feedback.ts`, `actions.ts`; `node-config/indicator-analysis.ts`; backend: só o teste (`publish-validation-parity-cases.ts`, `validate-workflow-for-publish.parity.test.ts`) — nenhuma regra do backend mudou | D1–D6, D8a/b/c, D9 e D10 viraram **casos espelhados** (mesmo código, mesmo nó: 135 → 146) e D7 entrou numa lista nova de casos de borda que os dois lados **publicam** (`ACCEPTED`: quartil de performance com "está vazio"/"não está vazio" sem quartil — o editor deixou de exigir o quartil). A lista de divergências toleradas **deixou de existir**: o teste falha em qualquer diferença, inclusive na varredura (3.000 amostras, semente fixa, 0 divergências; conferido também com mais 8 sementes, 24.000 amostras, 0 divergências). O ciclo entre variáveis deixou de sair duas vezes no editor (a segunda, "A → A", era falsa). Efeito colateral achado pelos testes do editor e corrigido: trocar "O que deseja analisar?" de Valor para Atingimento/PRV levava junto a janela de 7 dias (e uma agregação operacional, vindo de Quartil operacional), que o backend recusa — agora cai no período padrão de Atingimento (30 dias) e em Média; o teste de todas as trocas passou a incluir Quartil operacional (36 combinações). Um teste antigo do editor (grupo E/OU) dependia da falta da checagem de variável e passou a informar a variável. Testes do editor 397/397; paridade 198/198 |
| `?new` reabre a criação a cada navegação | `hooks/use-auto-open-from-query.ts` (contrato documentado: a tela consome o pedido com `setOpen(false)`) + Workflows, Orquestradores, Indicadores, Flags de canal, Domínios de negócio (na renderização) e Usuários (no efeito: abrir também limpa a mutação de criação; exceção justificada na linha). Argumentários já fazia assim; a Base de conhecimento navega para a rota própria a cada `?new` | antes, só o primeiro `?new` abria (seção 8, achado mantido até 08/10). Teste novo no hook (pedido consumido → segundo `?new` abre) e na tela de Domínios de negócio — conferido que falha com o comportamento antigo. Domínios de negócio, Flags de canal e Usuários deixaram de cair no erro interno silencioso do React Compiler (`PruneHoistedContexts`): `eslint --rule 'react-hooks/invariant: error'` limpo nos três |
| Helpers de teste em `<módulo>/testing/` | 6 arquivos de `notifications`, `pending-actions`, `performance-analytics`, `workflows` | mover com reescrita de imports relativos; `tsc` + testes dos módulos |
| Schemas na pasta da feature | `broadcast` e `profile-cover` → `schemas/profile/`; `supervision-case` → `schemas/supervision-cases/` | `tsc` + testes |
| `cn` do projeto em `ui/sidebar.tsx`; `radio-group` via `radix-ui` | 2 arquivos | o `cn` do pacote e o do projeto deram **0 diferenças em 5.406 combinações** das classes do sidebar; `radix-ui` reexporta o mesmo módulo do radio group |
| Corpo do agente único em `agent-service.ts` | `agentPayload` | `tsc` + testes de agentes |
| Lint do backend | parâmetro sem uso em `scripts/dev/larissa-scenario/tma-setembro.ts`; scripts congelados fora do lint (seção 7) | `eslint` 4 → 0 erros |
| Comentários que apontavam para o arquivo antigo do painel | 4 arquivos (um citava um símbolo que já nem existia) | leitura |
| Assinaturas redundantes de consulta | `PerformanceConditionForm` e `ScheduledDataSourceForm` chamavam `useIndicatorsWithRulesQuery()` sem usar o retorno | o `IndicatorSelect` filho usa a mesma chave e o TanStack Query deduplica: não havia requisição extra, só assinatura; `tsc`, lint do `node-config` 0 avisos, testes do editor |
| Scripts soltos de `backend/scripts/` | `_verify-tick.ts` → `scripts/dev/run-workflow-ticks.ts`; `seed-call-history.ts` → `scripts/dev/` (caminho dos `.rtf` ajustado) | `tsc` e `eslint` dos dois; o carregador continua achando os 11 `.rtf` de `docs/` |
| CLI `shadcn` em `devDependencies` | `frontend/package.json` | lockfile: só marcações `"dev": true` (310 pacotes usados apenas pela CLI) e as remoções de `cn`/`@tanstack/react-table`; nenhuma versão alterada |

## 6. Código obsoleto

### Removido (confiança alta)

| Arquivo / símbolo | Motivo | Evidência | Risco |
|---|---|---|---|
| `frontend/src/app/(app)/page.tsx` | rota sombreada | `app-path-routes-manifest.json` mapeava `/page` e `/(app)/page` para `/`; `index.html` do build e o servidor de dev serviam a landing pública; o `proxy.ts` nem protege `/` | baixo — nenhum comportamento servido muda |
| `components/home/*` (8 arquivos), `mock/app/*` | só a rota acima os usava | grafo de imports (knip) + busca por nome em código, testes e documentação | baixo |
| `mock/operator/*` | tipos duplicados do zod | substituídos; `tsc` limpo | baixo |
| `schemas/app/*`, `services/app/*` | arquivos **vazios** desde o primeiro commit | 0 bytes | nenhum |
| `components/auth/login-header.tsx` | sem consumidor desde o primeiro commit | knip + busca | baixo |
| `lib/avatar/lipsync/alignment-layout.ts`, `text-syllables.ts` | sobra do alinhador DTW, substituído pelo semi-Markov (`hsmm.ts`) | nenhum import, nem dinâmico; o laboratório `/dev/avatar-lab` usa só os módulos atuais | baixo |
| `frontend/public.zip` (3,3 MB) | snapshot de julho do código do frontend (não são assets) | conteúdo listado: `src/`, `package.json` antigos; nada o referencia; continua recuperável pelo histórico do git | nenhum |
| `services/admin/employee-performance-service.ts` + schemas de resposta | cliente de uma rota que nenhuma tela usa | knip; o enum de quartil (usado) foi mantido; a rota do backend continua (contrato público, inspeção manual) | baixo |
| `useAiLegacyQuery`, `fetchAiLegacy`, chave `aiLegacy` | substituído: o overview da IA já traz `legacy` | `overview-tab.tsx` usa `data.legacy` | baixo |
| `useWorkflowEnrollmentsQuery`, `fetchWorkflowEnrollments` | substituídos pela versão paginada | só a paginada é usada; a chave `workflowEnrollments` continua (invalidação por prefixo) | baixo |
| `useGlossaryTermsQuery`, `fetchGlossaryTerms` | substituídos pela versão paginada | idem | baixo |
| `NODE_META` (`components/wiki/wiki-data.ts`) | cópia antiga dos visuais dos nós | a wiki usa `wiki-reference.ts`; testes da wiki verdes | baixo |
| `formatAiDate` (`lib/admin/ai-format.ts`) | sem uso | knip + busca | nenhum |
| `generateAgentReply` (`agents/infrastructure/gemini-agent-client.ts`) | substituído por `generateAgentReplyWithUsage` (o uso precisa ser registrado) | nenhum consumidor; 2 mocks de teste com a chave antiga também limpos | baixo |
| Dependências `cn`, `@tanstack/react-table` (frontend) | sem import | lockfile só com remoções (nenhuma versão alterada) | baixo |
| Landing pública de `/` ("Acessar plataforma") | sem função (decisão de produto) | substituída pelo redirecionamento; nenhum link interno apontava para `/` além do layout da Administração, que agora vai direto à tela inicial | baixo |
| `fetchFeedbackApplication`, `fetchAiHealth`, `fetchBusinessDomain`, `createSubteam`, `createSubject` | sem uso em telas | só apareciam como chaves `vi.fn()` em `vi.mock` — nenhum teste os chamava ou verificava; chaves removidas junto; a estrutura (Grupo/Subgrupo) chega pela Central de Dados | baixo |
| `useRenameWorkflowVariableMutation`, `useDeleteWorkflowVariableMutation` (+ serviços) | nunca ligados a uma tela | os endpoints do backend continuam; religar é um hook de 5 linhas quando houver a tela | baixo |
| `backend/scripts/seed-indicators.ts` | substituído pelo `npm run db:seed:demo` | grava metas/medições com `source='seed'` (fora da política de dados de demonstração e do reset), sobrescreve metas e roda ticks do motor (chamadas de IA) | baixo — continua no histórico do git |
| `docs/dev/feedback-engine.md.orig` (não rastreado) | sobra de `patch` de 05/10 | todo o conteúdo está no `feedback-engine.md` atual (só duas frases aparecem na forma curta, antes de ganharem continuação); cópia guardada fora do repositório antes de apagar | nenhum |
| Backend: `pino-http`, `@types/bcryptjs` | sem import; `bcryptjs` 3 traz os próprios tipos | removidos pela sessão da Central de Dados, dona do `backend/package.json` em andamento; `tsc` e testes de `auth` 31/31 | baixo |

### Preservado — investigação pendente ou decisão de produto

| Candidato | Por que suspeito | Por que ficou | Ação sugerida |
|---|---|---|---|
| Primitivas sem uso do kit (`ui/carousel`, `ui/hover-card`, partes de `sidebar`, `avatar`, `dropdown-menu`...) e `embla-carousel-react` | sem consumidor | kit do design system (shadcn) | manter |
| Backend: 42 exports/tipos sem consumidor **mantidos de propósito** (o resto foi removido — seção 5) | knip os lista como sem uso | contratos versionados (`*_VERSION`, prompts, esquemas de resposta, `*_CONTRACT`, `interactionAssessmentsSchema`), dados de teste em `testing/`, portas de extensão (`ports.ts`, `CheckpointEquivalenceJudge`), `withLlmContext` (citado na memória do projeto), `ConditionGroup` (reexportado por `graph-schema.ts`) e dois tipos que ancoram a documentação do vocabulário (`PendingActionKind`, `AiCostStatus` — o EXACT reservado) | manter |
| `backend/scripts/dev/seed-call-history.ts` | script de uso único de set/2026 | é o único carregador dos `.rtf` de `docs/`; atenção: também matricula em Workflows e roda ticks do motor (pode chamar IA) | manter; revisar se a massa demo passar a carregar esse corpus |

### Duplicação mantida de propósito

- Esquemas de resposta e prompts do motor de feedback (`call-review.ts` × `obligation-review.ts`): contratos versionados.
- `toEvidence` (Condition) × `toMemberEvidence` (Ranking): parecidos, mas o Ranking devolve de propósito uma evidência mais enxuta — unificar mudaria o payload.
- Leitores de SSE (`realtime/infrastructure/gemini-text-client.ts` × `ai-management/infrastructure/adapters/http.ts`): tratam JSON inválido e `[DONE]` de formas diferentes, e um é o caminho legado do chat.
- `Section`/`SheetSkeleton` de 12 linhas em duas telas de revisão de features diferentes: extrair só criaria acoplamento.
- Formatadores de data locais com regra de fallback própria (`qa-lab-format`, `manual-run-dialog`, `person-structure-view`, `data-hub-format`): devolvem `"—"`, o ISO ou `Invalid Date` para valor inválido — unificar mudaria a saída nesses casos.

## 7. Achados e como foram tratados (07/10, segunda rodada, a pedido do usuário)

1. **Scripts do backend sem checagem de tipos** e **3 erros de lint em scripts congelados** (`evaluate-round-v14b/c/d.ts`,
   cujo hash está nos `round-v14*-freeze.json`). Tratados numa sessão própria e integrados aqui:
   - `backend/tsconfig.scripts.json` (estende o principal, `noEmit`, `allowJs` só para o teste importar o módulo dos
     congelados) + `npm run typecheck:scripts`: 0 erros. O `typecheck` de sempre continua só com `src/`.
   - **Congelado** = caminho de `scripts/` nas chaves `files` de algum `*-freeze.json` (derivado dos próprios manifestos)
     ou pasta/rodada que a documentação manda nunca reexecutar: `scripts/poc-tools/holdout-v2/**`,
     `scripts/poc-tools/benchmarks/**`, as rodadas pagas V9–V14d da Larissa e `compare-contracts-v10.ts`. A definição mora
     em `backend/scripts/frozen-scripts.js`; o `eslint.config.js` a importa (uma rodada nova com `*-freeze.json` sai do lint
     sozinha) e o `tsconfig.scripts.json` repete a lista de forma estática — `scripts/frozen-scripts.test.ts` falha se as
     duas divergirem. Nenhum congelado foi editado (os 21 hashes registrados conferem); ficaram 72 erros de tipo só em 4
     scripts do holdout, que vêm da evolução de `src/` depois que eles foram escritos.
   - Corrigidos 4 scripts ativos: 3 só de tipo (o JavaScript gerado é idêntico) — `smoke-recall-indicator-diagnosis.ts`,
     `recompose-larissa.ts`, `run-poc-feedbacks.ts` — e `probe-reference-practices.ts`, que quebrava em execução desde
     `e050a61` (`signal.flagIds is not iterable`: passava `[]` onde `segmentRows` espera um sinal; agora `NO_SIGNAL`).
   - Resultado: `npx eslint .` sem erros (antes 4).
2. **Consulta "disparada sem uso"** nos formulários de Condition por performance e de fonte da Agenda: a análise inicial
   estava errada — o `IndicatorSelect` filho usa a mesma chave e o TanStack Query deduplica, então não havia requisição
   extra, só uma assinatura redundante. Removida (seção 5).
3. **Testes que falhavam com a máquina ocupada** — a causa não era só carga:
   - **Bug real de interface:** ao abrir o detalhe do indicador (Indicadores), o foco automático do painel caía no botão
     "Como o acompanhamento operacional é calculado" e o Radix abria o tooltip sozinho, por cima do conteúdo (o Radix abre
     tooltip em qualquer foco que não venha de clique). Corrigido em `analytics/indicator-detail-sheet.tsx`: ao abrir, o foco
     vai para o próprio painel; pelo teclado o tooltip continua abrindo. Teste de regressão em `indicators-view.test.tsx`
     (falha sem a correção, passa com ela). Efeito colateral: os testes desse arquivo caíram de 3–6,6 s para 16–225 ms cada.
   - **Bug do ambiente de teste (jsdom 26 + nwsapi 2.2.27):** `element.matches(":modal")` entra em recursão até estourar a
     pilha (~160 ms por chamada) e só então devolve `false`; o floating-ui (Popover/Select/Tooltip do Radix) pergunta isso a
     cada posicionamento, e um teste que abria um popup deixava o event loop ocupado por segundos — inclusive nos testes
     seguintes do arquivo (um `setTimeout(100)` levava 7 s). `frontend/vitest.setup.ts` devolve `false` para `:modal`
     direto (o jsdom não tem "top layer", a resposta é sempre essa). `workflow-issues-panel` caiu de 0,6–2,3 s para 7–50 ms
     por teste. Não verifiquei se isso também explica a nota do `CLAUDE.md` sobre o `DropdownMenu` travar o jsdom.
   - **Benchmark de CPU do lip-sync:** media tempo de relógio. Passou a medir tempo de CPU do processo no melhor de 3
     replays, com os mesmos limites (1% da fala, 10 ms por chunk); foi separado do teste de alocação; e é pulado — com o
     motivo no log — só quando a máquina está saturada (carga acima do número de núcleos), condição em que nem o tempo de
     CPU é confiável (no Apple Silicon o processo vai para os núcleos de eficiência e o custo dobra).
   - **Backend:** os testes de domínio mais pesados levam até ~2 s sozinhos e 3–4× mais na suíte completa;
     `backend/vitest.config.ts` fixa 20 s de limite (antes 5 s padrão).
   - **Corrida de milissegundo** em `workflows/application/engine.test.ts` (achada na suíte de 08/10, depois da
     integração das divisões): o teste de idempotência do `join_check` compara duas execuções, mas o `joinedAt` vem do
     relógio real e as duas podiam cair em milissegundos diferentes (…820Z × …821Z). O relógio agora fica congelado só
     nesse teste (`vi.useFakeTimers({ toFake: ["Date"] })`); a comparação continua exigindo resultado idêntico.
   - Resultado: frontend com 0 falhas na suíte completa e soma dos tempos de teste de 219 s para 93 s; backend com 0 falhas
     com a carga da máquina subindo de 11 para 26 durante a rodada.
4. **Produto:** `/` deixou de ter tela própria (seção 5).

## 8. Pendências, riscos e próximos passos

- **Lint do React Compiler no chat da INIA — corrigido em 08/10 (seção 5).** O `eslint-plugin-react-hooks` 7 roda o React
  Compiler só para o lint (o build não usa o compilador). Em `operator-inia-chat.tsx` ele caía num erro interno — `Invariant:
  [PruneHoistedContexts] Unexpected hoisted function` — e nenhuma regra dele (`immutability`, `refs`, `purity`…) chegava ao
  componente. Decisão do usuário: corrigir os padrões em vez de deixar o componente fora do compilador (`"use no memo"` não
  foi usado em nenhum trecho). Agora o componente é analisado — uma sabotagem (ref lida e `Math.random()` no render) é
  acusada, e no original passava em silêncio —, e o recado de voz e o campo de mensagem saíram da entrada. O que ficou:
  - **Aviso novo:** `react-hooks/set-state-in-effect` no efeito de montagem (`loadCurrentConversation()` muda estado de forma
    síncrona). A regra é aviso de propósito no projeto; tirar o aviso mudaria o fluxo de carga da conversa.
  - **4 `Todo` do compilador** no componente (`try/finally` ×3, `throw` dentro de `try/catch` ×1). A regra `react-hooks/todo`
    não está ligada e eles não impedem a análise, mas os blocos `finally` não são analisados e o compilador não compilaria o
    componente — só importa se o build passar a usar o compilador.
  - **Regra para quem mexer no chat:** funções internas como `const`, e efeitos depois das funções que chamam. Uma `function`
    usada antes da própria declaração, ou um efeito que chama uma função declarada mais abaixo, derruba de novo a análise do
    componente inteiro — **em silêncio**, porque `react-hooks/invariant` não está ligada. Conferir com
    `npx eslint --rule 'react-hooks/invariant: error' src/components/operator/operator-inia-chat.tsx`.
  - **O mesmo erro interno silencioso em outros arquivos** (lint do frontend com `react-hooks/invariant` e `react-hooks/todo`
    ligadas, 08/10): `analytics/indicator-history-chart.tsx` (`Codegen`) e `admin/assistant/structured-output-builder.tsx`
    (`Rewrite hoisted function references`) — o compilador não analisa esses componentes; não tratados. Domínios de negócio,
    Flags de canal e Usuários, que também estavam nesta lista (`PruneHoistedContexts`), saíram dela com a correção do `?new`
    (seção 5). Depois de tratar os dois restantes, ligar `react-hooks/invariant` como erro no `eslint.config.mjs` impediria a
    volta do problema.
- **Avisos de hooks — diferenças de tempo, não de estado final** (seção 5): o estado ajustado durante a renderização fica
  certo no mesmo render (antes havia um quadro intermediário com o valor antigo); `useIsMobile` e o tema do React Flow,
  numa montagem só no cliente, já nascem com o valor real (antes: desktop/claro por um quadro; na hidratação nada mudou);
  a acessibilidade não regrava o `localStorage` ao carregar (só os comandos da pessoa gravam) e duas instâncias ficam iguais;
  o construtor do resultado estruturado do Orquestrador monta uma vez com o registro carregado (antes montava vazio e remontava).
- **`?new` — resolvido em 08/10 (seção 5):** antes só o primeiro `?new` abria a criação (Workflows, Orquestradores,
  Indicadores, Flags de canal, Usuários, Domínios de negócio); agora toda tela consome o pedido e cada navegação com `?new`
  abre de novo, como Argumentários. Quem usar `useAutoOpenFromQuery` numa tela nova precisa consumir o pedido com
  `setOpen(false)` — o comentário do hook diz isso.
- `use-admin-mutation.ts` foi reavaliado e fica em `lib/admin/` (ver critério da seção 3) — não é pendência.
- **Divergências da validação de publicação de Workflow — resolvidas em 08/10 (seção 5).** Decisão do usuário: nenhuma
  divergência entre editor e backend; o backend é a fonte da verdade e o editor o segue. As 12 (D1–D10, achadas em 07/10)
  foram corrigidas no editor; nenhuma regra do backend mudou. **D7** (quartil de performance com "está vazio"/"não está
  vazio" e sem quartil) seguiu o backend: publica — o editor deixou de exigir o quartil de referência. O teste de paridade
  não aceita mais divergência registrada: qualquer diferença falha. Achados que não mudam regra e continuam como estão:
  `WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN` nunca é o primeiro erro do backend (o contexto de entrada errado sempre o
  precede); a mensagem "Chamar agente depois de Consolidar resultados" do bloco de contexto é inalcançável nos dois lados;
  `times: []` na Agenda e `sourcePath: ""` na Condition são recusados pelos dois lados com códigos diferentes (o backend, no
  esquema ao salvar). Como o editor lista todos os problemas e o backend para no primeiro, um caso pode ter mais de um
  problema no editor — o teste exige que o primeiro do backend esteja entre eles, no mesmo nó (ex.: "Gerar feedback sem
  saída ligada" também aponta o Output solto, que é exatamente o erro seguinte do backend).
- **`next build` final (08/10, depois de todas as integrações e das correções de paridade e `?new`):** ok com Turbopack, sem
  aviso — TypeScript limpo, 78 páginas geradas, 89 rotas (46 estáticas, 43 dinâmicas), uma só página para `/`. Rodou ao lado do
  `next dev` da porta 3000 sem derrubá-lo (o Next 16 separa `.next/dev` de `.next`). Armadilha: a primeira tentativa falhou
  com `ENOTEMPTY … rmdir '.next/server'` porque o Finder gravou um `.DS_Store` na pasta enquanto o build a apagava; removido
  o `.DS_Store`, o build passou. Não é erro do código.
- Verificação visual no navegador não foi feita: o `next dev` da porta 3000 é de outra sessão. As mudanças visíveis
  (redirecionamento da raiz, foco do detalhe do indicador) foram verificadas por `curl` e por testes de componente.

## 9. Como validar

```bash
cd backend && npx tsc -p tsconfig.json --noEmit && npm run typecheck:scripts && npx eslint . && npx vitest run
cd frontend && npx tsc --noEmit && npx eslint && npx vitest run && npx next build
cd frontend && npx eslint --rule 'react-hooks/invariant: error' src/components/operator/operator-inia-chat.tsx
```

A última linha confere que o React Compiler continua analisando o chat da INIA: o erro interno que o tirava da análise não
aparece no `eslint` normal (a regra `react-hooks/invariant` não está ligada). Tem de sair sem erro.

Testes desta refatoração: `backend/src/modules/workflows/application/validate-workflow-for-publish.parity.test.ts`, o caso
"?new … abre de novo a cada nova navegação" de `frontend/src/components/admin/business-domains/business-domains-page.test.tsx`,
`frontend/src/hooks/browser-state-hooks.test.tsx`, `frontend/src/components/admin/governance/governance-page.test.tsx`, o caso
"caracterização: a lista acompanha o valor que vem de fora" de `frontend/src/components/admin/workflows/agent-picker.test.tsx`,
`backend/src/modules/feedbacks/application/create-feedback-records.test.ts`,
`frontend/src/lib/format/date.test.ts`, `frontend/src/components/admin/workflows/node-config-panel.render.test.tsx`,
`frontend/src/components/admin/qa-lab/run-result.render.test.tsx`, o caso "abrir o detalhe não abre tooltip sozinho" em
`frontend/src/components/analytics/indicators-view.test.tsx`, o bloco "caracterização do comportamento" de
`frontend/src/components/operator/operator-inia-chat.test.tsx` e o caso "caracterização — resposta cortada no palco" de
`frontend/src/components/operator/feedback-application/feedback-application.test.tsx`.
