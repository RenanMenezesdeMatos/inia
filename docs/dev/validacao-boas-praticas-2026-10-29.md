# Validação de boas práticas — TypeScript, React, Node.js/Express (29/10/2026)

Rodada de engenharia separada da auditoria AppSec (`docs/security/appsec-2026-10-29/`): qualidade, arquitetura,
confiabilidade, testes e manutenção. Não houve pentest nem repetição da auditoria de segurança. Os commits estão em §10 (sem push).

- **Revisão Git:** `77c5adcd` (branch `admin-list-standardization`). O working tree já tinha **96 alterações locais de outras
  sessões** (Meu turno, Treino com a INIA, AppSec de 29/10 e monitoria de usabilidade). A lista e os hashes dos arquivos foram
  registrados antes de qualquer mudança, e nenhum desses trechos foi alterado. A exceção é `backend/src/main/server.ts`, que já
  tinha alterações de outra sessão: recebeu dois trechos novos (o import e as linhas 73–74) e os trechos da outra sessão
  continuam intactos.
- **Escopo do que se afirma:** “atende” quer dizer que atende **nos critérios avaliados aqui**. Isto não é declaração de
  conformidade corporativa, porque os requisitos da empresa não foram fornecidos.

## 1. Diagnóstico executivo

> **Atualização de 30/10/2026:** as pendências deixadas em 29/10 foram tratadas a pedido do usuário (§11). A matriz da §3 e a
> tabela de achados registrados (§4) mostram o estado final.

A base está acima da média para a stack. TypeScript estrito nos dois lados, sem `any` real em produção e sem `@ts-ignore`.
O backend é um monólito modular consistente: tratamento de erro centralizado, timeouts em toda chamada externa, desligamento
gracioso, prontidão e logs estruturados assíncronos. No frontend, os dados passam pelo TanStack Query, as respostas são
validadas com zod e o lint do React Compiler está ativo. Na linha de base, tipos e lint estavam limpos, com 1 aviso aceito, e
as suítes passaram: backend 5.246 testes e frontend 2.049.

Mesmo assim, havia **defeitos reais nos caminhos de falha**, e os testes existentes não os exercitavam:

1. **Central de Dados** devolvia ao pool uma conexão com transação aberta ou abortada em dois caminhos de erro (P1).
2. **API**: com a porta ocupada, o processo continuava de pé sem servir HTTP. O Express 5 entrega o erro ao callback do
   `listen`, e o código o ignorava (P1).
3. **Intervenções e Checkpoints**: um `rollback` que falhava escondia o erro de negócio original (P3).
4. **Report**: a busca de destinatários podia mostrar o resultado de uma busca anterior (corrida de respostas) (P2).
5. **Telas sem fronteira de erro de rota**: uma exceção de renderização trocava a aplicação inteira pela página padrão do
   Next, em inglês e sem navegação. Isso viola a regra 5 de `docs/regras-produto-ui-ux.md` (P2).
6. **Acessibilidade**: 5 tabelas abriam o item só com clique, sem nenhum caminho pelo teclado (P2).

Todos foram corrigidos e ganharam teste de regressão. Para os defeitos de backend, uma **sabotagem** confirmou que o teste falha
com o código antigo. Também foram fechadas duas violações de regras existentes:

- a pendência do erro interno do React Compiler, que agora é erro no lint;
- `className` montado sem `cn`.

Das mudanças amplas, ficaram propostas, sem implementação:

- unificar os 23 helpers de transação;
- adotar gradualmente `noUncheckedIndexedAccess` no frontend;
- testes de contrato frontend × backend;
- CI;
- correlação de requisição nos logs;
- higiene das provas de banco.

A prova de banco da Central de Dados **já falhava** antes desta rodada, igual com e sem as mudanças (12/17). A causa era o
`inia_test` sem a migração 163. Com a autorização do usuário, a migração foi aplicada no banco de teste, e as 6 provas da
Central de Dados passaram com a correção: 62 testes (§6.3).

## 2. Mapa breve da arquitetura

| Parte | O que é | Versões instaladas |
|---|---|---|
| Raiz | `package.json` só com scripts (instalação, banco, `dev`, `build`, `security:*`). npm, um lockfile por app, sem workspaces | Node 24.18.1, npm 11.16.0 |
| `backend/` | Express 5 + `pg` (PostgreSQL), ESM/NodeNext, `src/modules/<domínio>/{domain,application,infrastructure,presentation,testing}` (49 módulos), `src/shared/*`, CLIs em `src/infrastructure/*`. Um binário com papéis `api`/`worker` (`src/main/server.ts`) | TypeScript 5.9.3, express 5.2.1, zod 4.6.7, pg 8.23.0, vitest 3.2.7, eslint 9.39.5 |
| `frontend/` | Next.js 16 (App Router; telas são client components), React 19.2, TanStack Query, zod, shadcn/Radix, Tailwind 4. `app/` só rotas; `components|queries|services|schemas/<feature>`; `lib/<propósito>` | next 16.4.1, react 19.2.4, TypeScript 5.9.3, zod 4.4.3 na linha de base (a sessão de AppSec o atualizou para 4.6.7 durante esta rodada; a verificação “depois” já usa o 4.6.7), vitest 3.2.7 |
| Integrações | Provedores de IA (Gemini/OpenAI-compatível) atrás de gateway com política e timeouts; bancos externos e SFTP/API na Central de Dados; SSE para o chat | — |
| Contratos | Backend valida entrada com zod (no router ou no serviço que recebe `unknown`); frontend valida respostas com zod em `services/` (87 de 92 chamadas — as 5 restantes são POSTs sem corpo de resposta). Não há pacote de tipos compartilhado; a única prova de paridade é a da validação de publicação de Workflow | — |
| Rotina | Sem CI no repositório (`.github` inexistente; o próprio relatório AppSec registra “sem pipeline de CI”). Verificação manual descrita em `refatoracao-progressiva.md` §9; `npm run security:check`/`security:scan` | — |

## 3. Matriz de práticas avaliadas

Legenda: **A** atende · **AP** atende parcialmente · **N** não atende · **NA** não aplicável · **NV** não verificado.
Os itens marcados com ✔ foram corrigidos nesta rodada.

| Área | Prática | Situação | Evidência / observação |
|---|---|---|---|
| TS | Compilador estrito | A | `strict` nos dois lados; backend também com `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| TS | Opções estritas extras no frontend | AP (catraca) ✔ | Catraca `npm run typecheck:estrito` (`frontend/scripts/typecheck-strict.mjs`): nenhum arquivo pode ganhar erro de `noUncheckedIndexedAccess`; base de 1.208 erros em 58 arquivos (eram 1.213 em 61), concentrados no lip-sync do avatar e no chat da INIA |
| TS | `any` / supressões | A | 0 `any` real em produção (as 29 ocorrências no backend são uma função chamada `any`); 0 `@ts-ignore`/`@ts-expect-error` |
| TS | Assertions | AP | `request.user!`: 328 trocados por `sessionUser(request)` (tipado, 401 se faltar); 36 restam, todos em arquivos com trabalho não commitado de outras sessões. `as unknown as`: 35 no backend (eram 50 — os helpers de transação saíram) e 31 no frontend |
| TS | Dados externos validados em runtime | A | Zod nas entradas da API, nas respostas do frontend, no `env` e nos contratos da IA; frames SSE do chat usam `JSON.parse(...) as` (arquivo com trabalho de outra sessão, não tocado) |
| TS | Tipos duplicados frontend × backend | AP ✔ | Esquemas continuam independentes, mas há contrato: a prova de ciência valida as respostas reais do Acompanhamento e da confirmação com os schemas zod da tela (`backend/src/shared/presentation/testing/frontend-schema.ts`); outras telas podem usar o mesmo carregador |
| React | Composição e responsabilidades | A | Componentes grandes já divididos em partes (`refatoracao-progressiva.md` §5) |
| React | Hooks e dependências | A | `react-hooks` 7 com React Compiler no lint; 1 aviso aceito (chat). ✔ `react-hooks/invariant` agora é erro (F-08) |
| React | Efeitos e estado derivado | A | 105 `useEffect`; os avisos de `set-state-in-effect` caíram para 1 na rodada de 07–08/10 |
| React | Respostas assíncronas fora de ordem | AP→A ✔ | Varredura dos efeitos assíncronos: 1 corrida real (F-04), corrigida; o restante tem guarda (`cancelled`, `key`) |
| React | Carregamento / erro / vazio | AP→A ✔ | Estados por tela existem; faltava a fronteira de erro de rota (F-05), agora existe |
| React | Keys e imutabilidade | A | 94 `key={index}`; nas listas editáveis (regras de condição, campos, horários) as linhas são controladas e sem estado local, sem defeito demonstrável |
| React | Renderização / carregamento de código | NV | Sem medição de bundle nem de profiler nesta rodada; nenhuma otimização recomendada sem medida |
| React | Acessibilidade funcional | A ✔ | 5 tabelas sem teclado corrigidas (F-06; conferido no navegador); os 38 `label-has-associated-control` são falsos positivos (nome acessível calculado no DOM); 4 problemas reais achados na triagem e corrigidos (2 nomes diferentes do texto visível, 1 campo sem nome, 1 botão de ícone sem nome). Não triados: 216 avisos de `Label` do shadcn com a regra estendida |
| Express | Organização de rotas/middlewares/regras | A | `app.ts` monta os routers com autorização explícita por rota; regras ficam em `application/` |
| Express | Validação de entrada | A | Zod no router ou no serviço (`raw: unknown` + `parse`); query strings tratadas com guarda de tipo; `limit` com teto |
| Express | Erro centralizado (Express 5) | A | `errorHandler` final: `DomainError`, `ZodError`, erros de entrada e de conector (4xx); 500 sem detalhe interno; promessas rejeitadas chegam via Express 5 |
| Express | `app.listen` no Express 5 | N→A ✔ | O erro do listen era ignorado (F-02) |
| Node | Promessas sem tratamento | A | Lint com tipos (rodado à parte): 0 `no-floating-promises`; 1 `no-misused-promises` falso positivo (`server.ts:72`, já tem `.catch`) |
| Node | `unhandledRejection` | A (decisão) | Registra, conta nas métricas e segue — decisão do usuário em 30/10 (P-8); o lint com tipos não acha promessa solta |
| Node | Timeouts em chamadas externas | A | Todos os 9 `fetch` de produção têm `AbortSignal.timeout`/deadline; o pool tem `statement_timeout`, `idle_in_transaction_session_timeout`, `connectionTimeout` e `query_timeout` |
| Node | Retentativa e idempotência | A | Retry com limite nos clientes de IA; workers com posse (lease) e `skip locked`; Idempotency-Key no API Push |
| Node | Transações e consistência | AP→A ✔ | 51 de 52 arquivos corretos; `run-pipeline.ts` corrigido (F-01); 5 helpers mascaravam erro (F-03) |
| Node | Paginação e consumo | A | Listas com página/teto (`respondList`, keyset no caminho quente, `Math.min(100, …)`) |
| Node | Configuração por ambiente | A | `env.ts` valida com zod e recusa a subida com configuração inconsistente |
| Node | Encerramento do processo | A | `createShutdown` (prontidão → dreno → fechar → prazo), `installProcessHandlers`, keep-alive 65 s |
| Node | Logs úteis sem dado sensível | A ✔ | pino assíncrono, `console.*` em ponte para JSON, erro 500 sem corpo/cookie/query; id de requisição (`x-request-id`) em toda linha de log e no corpo do 500 genérico (P-5) |
| Arq. | Acoplamento / ciclos | A | Ciclos verificados nas divisões de 07–08/10; nada novo encontrado |
| Arq. | Regra de negócio duplicada | A ✔ | Transação num helper único (P-1: 22 cópias e 38 blocos escritos à mão); duplicações intencionais documentadas (`refatoracao-progressiva.md` §6) |
| Arq. | Limites entre camadas | A | Router → serviço → SQL/adaptador; a execução de IA fica atrás de uma interface única |
| Arq. | Código morto | A | Removido em 07/10 (knip); o restante está inventariado |
| Testes | Fluxos críticos e de falha | AP→A ✔ | Muitos testes de domínio e rota, mas os caminhos de falha de transação e de `listen` não eram exercitados (agora são) |
| Testes | Integração de rotas | A | 79 arquivos com supertest; 44 de 57 routers com teste próprio |
| Testes | Mocks que escondem problema | AP | 56 arquivos com `vi.mock`; as provas de banco agora barram banco desatualizado (P-6), duas desatualizadas foram corrigidas (D-10, D-11) e há contrato com a tela (P-3). Continuam desligadas por padrão; no CI, sob demanda (num banco novo, 5 casos antigos falham — §11) |
| Testes | Reprodutibilidade | A ✔ | `npm ci` por app; Node 24 em `.nvmrc`, `engines` nos dois lados e tipos do Node 24 no frontend; sem formatador (preferência, D-6) |
| Testes | CI | A ✔ | `.github/workflows/ci.yml` (backend e frontend bloqueantes; provas de banco sob demanda) e `npm run verificar` (o mesmo localmente) — P-4 |

## 4. Achados

Classificação: 1 = defeito confirmado · 2 = violação de regra existente · 3 = melhoria de manutenção fundamentada · 4 =
preferência de estilo · 5 = pendente de investigação. Prioridade P1 (alta) a P4 (baixa).

### F-01 — Conexão devolvida ao pool no meio de uma transação (Central de Dados) · Confiabilidade · P1 · classe 1 ✔
- **Onde:** `backend/src/modules/data-hub/application/run-pipeline.ts`, bloco APPLYING de `executeRun`, linhas 322–350 na
  revisão `77c5adcd`.
- **Evidência:** o `begin` e o `useBatchStatementTimeout` ficavam fora do `try` cujo `catch` faz `rollback`, nos dois modos. No
  modo atômico, a gravação da contagem no Run (pelo pool, outra conexão) acontecia com a transação aberta. Um erro nesses
  pontos ia direto ao `finally { client.release() }`, sem `rollback`. Havia ainda um terceiro problema: se o próprio `rollback`
  falhasse, o erro dele substituía o original.
- **Consequência:** o pg-pool reaproveita primeiro a conexão devolvida por último. A requisição seguinte cai em uma de duas
  situações:
  - se a transação estava **aberta**, a requisição escreve dentro dela, e um `commit` alheio confirmaria pela metade uma carga
    atômica;
  - se estava **abortada**, recebe 25P02 em todo comando enquanto houver tráfego. O `idle_in_transaction_session_timeout` de
    60 s só age quando a conexão fica parada.
- **Referência:** documentação do node-postgres (cliente dedicado por transação, sempre `release`); nodebestpractices 2.3 e 2.8
  (erro operacional tratado; testar os fluxos de erro).
- **Correção:** o bloco virou `applyInTransactions` (`run-pipeline.ts:102`). A sequência de comandos é a mesma, mas qualquer falha
  com a transação aberta faz `rollback` antes de devolver o cliente. Se nem o `rollback` passa, o cliente é descartado
  (`release(erro)`), e o erro original é preservado.
- **Validação:** `run-pipeline.test.ts` (5 testes). A sabotagem com a estrutura original passa no caminho feliz, que tem a mesma
  sequência de comandos, e falha exatamente nos 3 casos de defeito. A prova de banco `data-hub-proof` deu o mesmo resultado
  caso a caso com e sem a mudança. Depois de migrar o `inia_test`, passou 17/17 com a correção, incluindo 100 mil medições em
  lotes. As outras 5 provas da Central de Dados também passaram (§6.3).
- **Risco:** baixo; só os caminhos de erro mudaram.

### F-02 — Porta ocupada: a API "sobe" sem HTTP (Express 5) · Operação · P1 · classe 1 ✔
- **Onde:** `backend/src/main/server.ts:73–74`.
- **Evidência:** no Express 5, `app.listen` registra o callback como ouvinte de `error`
  (`node_modules/express/lib/application.js:598–606`), e o callback ignorava o argumento. A reprodução com o express do projeto
  mostrou o callback chamado com `EADDRINUSE` e o processo vivo, sem exceção.
- **Consequência:** com a porta ocupada ou o endereço inválido, o processo escrevia "listening on …" e seguia de pé. No papel
  `api`, ficava parado; no papel `all`, rodava o worker sem HTTP. O serviço do Windows o via rodando e o balanceador nunca o via
  pronto. No Express 4 a mesma situação virava exceção não capturada, e o processo desligava com código 1.
- **Referência:** Express — Migrating to 5 (`app.listen` entrega o erro ao callback); nodebestpractices 2.6 e 8.6.
- **Correção:** `onHttpListen` em `process-lifecycle.ts:83`. Sem erro, mantém o aviso de "listening"; com erro, registra o log
  `listen_failed` e chama `shutdown("listen_failed", 1)`, o mesmo desligamento já existente.
- **Validação:** 2 testes novos em `process-lifecycle.test.ts`, com Express real numa porta ocupada. Sabotagem: com o callback antigo (erro ignorado), o caso da porta ocupada falha.
- **Risco:** baixo. Muda só a subida que falha, que antes não servia nada.

### F-03 — `rollback` que falha esconde o erro de negócio · Confiabilidade · P3 · classe 1 ✔
- **Onde:** helpers `inTransaction` em `interventions/application/{config-service.ts:25, intervention-service.ts:125,
  ai-draft.ts:56, apply-evaluation.ts:57}` e `checkpoint-registry/application/checkpoint-registry-service.ts:45`.
- **Evidência:** `await client.query("rollback")` sem `.catch`. Os outros 18 helpers do projeto usam
  `.catch(() => undefined)`. O teste novo reproduziu o problema: o erro "Connection terminated" chegava no lugar do
  `COMPETENCY_NOT_FOUND` (404).
- **Consequência:**
  - com a conexão caindo, o 409/404/422 vira 500;
  - em `apply-evaluation.ts`, o `EvaluationAlreadyRecorded` deixa de chegar ao `catch` que buscaria a avaliação vencedora.
- **Correção:** o padrão majoritário do projeto, uma linha por arquivo.
- **Validação:** `interventions/application/config-service-transaction.test.ts` falhava antes e passa depois; os testes dos
  módulos passam (69).
- **Risco:** muito baixo.

### F-04 — Busca de destinatários do report: resposta antiga sobrescreve a atual · React · P2 · classe 1 ✔
- **Onde:** `frontend/src/components/reports/report-form/audience-fields.tsx:27–44`.
- **Evidência:** o efeito com debounce limpava o timer, mas não a requisição em voo. Teste: busca "an", depois "bia"; "bia"
  responde antes e "an" depois. A lista mostrava "Ana Lima" com o campo em "bia".
- **Consequência:** a pessoa errada aparece para ser escolhida como destinatária de um report.
- **Referência:** React — *Synchronizing with Effects* / *You Might Not Need an Effect* (flag `ignore` no cleanup); Vercel
  React Best Practices, categoria de dados no cliente.
- **Correção:** flag `ignore`, sem mudança visual.
- **Validação:** `audience-fields.test.tsx` falha antes e passa depois.
- **Risco:** muito baixo.

### F-05 — Nenhuma fronteira de erro de rota · React/Next · P2 · classe 2 ✔
- **Onde:** `frontend/src/app` não tinha `error.tsx` nem `global-error.tsx`.
- **Evidência:** `find src/app -name error.tsx` não retornava nada. Só existiam fronteiras locais: conteúdo rico, artigo e
  avatar.
- **Consequência:** uma exceção de renderização numa tela troca a aplicação inteira pela página de erro padrão do Next, em
  inglês, sem cabeçalho nem navegação. Viola a regra 5 de `docs/regras-produto-ui-ux.md` ("toda tela deve contemplar … erro").
- **Referência:** documentação do Next 16.4 instalada, `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`.
  Nesta versão a prop de recuperação é `retry`.
- **Correção:**
  - `app/(app)/error.tsx`: dentro do shell autenticado, que continua visível;
  - `app/error.tsx`: login, wiki e falha do próprio shell;
  - ambos usam `components/layout/route-error-state.tsx`, um aviso discreto em português, sem a mensagem interna, com
    "Tentar novamente" → `retry()`.
- **Validação:** `route-error-state.test.tsx` (2 casos); `next build` reconhece os arquivos (§6).
- **Limitação:** não forcei um erro no navegador (§8). Erro no layout raiz continua na página padrão; `global-error.tsx` ficou
  como proposta (§7).

### F-06 — Tabelas que só abrem com clique · Acessibilidade · P2 · classe 1 ✔
- **Onde:**
  - `admin/workflows/workflows-page.tsx` (Workflows);
  - `admin/assistant/assistant-page.tsx` (Orquestradores);
  - `admin/qa-lab/qa-history.tsx` (histórico do QA Lab);
  - `best-practices/analyses-panel.tsx` (análises);
  - `admin/workflows/workflow-enrollments-tab.tsx` (expandir matrícula).
- **Evidência:** `<TableRow onClick>` sem nenhum elemento focável que faça a mesma ação. Foram 7 linhas clicáveis no projeto; 2
  já tinham botão (Diagnóstico, padrões). O jsx-a11y rodado à parte também apontou os invólucros.
- **Consequência:** quem usa teclado ou leitor de tela não abre o Workflow, o Orquestrador, a execução ou a análise na visão em
  tabela. A visão em cards (`EntityCard`) já usava link.
- **Correção:** segue o padrão do próprio projeto.
  - Nas telas de Workflows e Orquestradores, o nome vira `Link` (igual ao card).
  - No QA Lab e nas análises, a data vira um `button` com `aria-label` descritivo.
  - Nas matrículas, o chevron vira um `button` com `aria-expanded`.
  - Em todos, `stopPropagation` evita abrir duas vezes; o clique na linha continua igual.
- **Validação:** `qa-history.test.tsx` (focável, abre uma vez). Os testes das 4 áreas passam (241).
- **Risco:** baixo. A única mudança visual é o sublinhado no hover do nome ou da data.

### F-07 — Erro interno do React Compiler em `indicator-history-chart.tsx` · Manutenção · P3 · classe 2 ✔
- **Evidência:** `eslint --rule 'react-hooks/invariant: error'` acusava `[Codegen] Internal error` na linha 28
  (`Math.max(110, ...values)` no render). Com esse erro, o componente inteiro fica sem análise das outras regras, em silêncio.
  É a pendência registrada em `refatoracao-progressiva.md` §8.
- **Correção:** o cálculo do eixo foi para `achievementAxisDomain`, fora do componente, com as mesmas expressões.

### F-08 — `react-hooks/invariant` desligada · Manutenção · P3 · classe 2 ✔
- **Correção:** `"react-hooks/invariant": "error"` em `frontend/eslint.config.mjs`, como recomenda a própria pendência §8. Antes
  de ligar, confirmei que o projeto inteiro não tinha nenhuma ocorrência.
- **Validação:** sabotagem com a versão antiga do gráfico → `1 error`.

### F-09 — `className` montado por template literal · Convenção · P4 · classe 2 ✔
- **Regra:** `CLAUDE.md`: "classes sempre pelo `cn` de `@/lib/utils`".
- **Evidência:** 17 ocorrências em 13 arquivos.
- **Correção:** 16 trocadas por `cn(...)`, em 12 arquivos. Ficou de fora `operator/operator-inia-chat.tsx:74`, que tem trabalho
  de outra sessão.
- **Validação:** `tailwind-merge` nos valores reais (mapas de status, `className` de quem chama) produziu **0 diferenças em 11
  combinações**. Tipos, lint e testes passam.

### Achados registrados sem alteração

| ID | Achado | Classe | Prioridade | Por que não foi alterado |
|---|---|---|---|---|
| D-1 | `unhandledRejection` só registra e segue | 5 | P3 | **Decidido em 30/10: manter** (P-8) |
| D-2 | Logs sem id de requisição | 3 | P3 | **Feito em 30/10** (P-5, §11) |
| D-3 | 23 helpers `inTransaction` em 4 variantes | 3 | P3 | **Feito em 29/10** (P-1, §9) |
| D-4 | `request.user!` 314× no backend | 3 | P4 | **Feito em 30/10**: 328 trocas por `sessionUser`; 36 restam em arquivos de outras sessões (§11) |
| D-5 | Frontend com `@types/node` 20, sem `engines`/`.nvmrc` | 3 | P4 | **Feito em 30/10** (tipos 24.19.2, `engines`, `.nvmrc`) |
| D-6 | Sem formatador (Prettier/EditorConfig) | 4 | P4 | Preferência; o estilo atual é consistente na prática |
| D-7 | Frames SSE do chat lidos com `JSON.parse(...) as` (`lib/realtime/gemini-text-client.ts`) | 3 | P3 | Arquivo com trabalho de outra sessão; o servidor é o mesmo produto |
| D-8 | 38 `label-has-associated-control` | 5 | P4 | **Triado em 30/10**: todos falsos positivos; 4 problemas reais achados à parte e corrigidos (§11) |
| D-9 | `operator-inia-chat.tsx`: 1 aviso `set-state-in-effect` e 5 `exhaustive-deps` desligados | — | — | Já documentado (`refatoracao-progressiva.md` §8); arquivo com trabalho de outra sessão |

**Para a AppSec:** nenhuma vulnerabilidade nova foi identificada nesta rodada. F-01 e F-02 são de robustez, não de segurança.

## 5. Alterações realizadas

| Conjunto | Arquivos | Por quê |
|---|---|---|
| F-01 | `backend/src/modules/data-hub/application/run-pipeline.ts`, **novo** `run-pipeline.test.ts` | Transação devolvida aberta ou abortada ao pool |
| F-02 | `backend/src/main/process-lifecycle.ts`, `backend/src/main/server.ts` (import + 2 linhas), `backend/src/main/process-lifecycle.test.ts` | `listen` do Express 5 |
| F-03 | 4 arquivos de `interventions/application/` + `checkpoint-registry-service.ts` (1 linha cada), **novo** `interventions/application/config-service-transaction.test.ts` | Erro original preservado |
| F-04 | `frontend/src/components/reports/report-form/audience-fields.tsx`, **novo** `audience-fields.test.tsx` | Corrida de respostas |
| F-05 | **novos** `frontend/src/app/error.tsx`, `frontend/src/app/(app)/error.tsx`, `components/layout/route-error-state.tsx`, `route-error-state.test.tsx` | Fronteira de erro de rota |
| F-06 | `workflows-page.tsx`, `assistant-page.tsx`, `qa-history.tsx`, `analyses-panel.tsx`, `workflow-enrollments-tab.tsx`, **novo** `qa-history.test.tsx` | Acesso por teclado |
| F-07/F-08 | `analytics/indicator-history-chart.tsx`, `frontend/eslint.config.mjs` | Compilador analisa o gráfico; o problema não volta em silêncio |
| F-09 | `app/layout.tsx`, `admin/assistant/assistant-page.tsx`, `admin/agents/agent-detail-page.tsx`, `admin/operational-calendar/operational-calendar-page.tsx`, `admin/usability/usability-tab-frame.tsx`, `feedback-review/feedback-review-sheet.tsx`, `team/team-summary.tsx`, `team/team-member-table.tsx`, `operator/inia-humanoid-avatar-3d.tsx` (só o `className` do indicador de estado, fora do `<Canvas>`), `analytics/quartile-distribution.tsx`, `analytics/indicator-history-chart.tsx`, `analytics/analytics-states.tsx` | Regra do `cn` |
| Relatório | **novo** `docs/dev/validacao-boas-praticas-2026-10-29.md` | Este documento |

Não foram alterados contratos HTTP, regras de negócio, prompts/esquemas versionados, dependências nem migrations.

## 6. Verificações — antes × depois

### 6.1 Estáticas e testes

| Verificação | Antes (linha de base) | Depois |
|---|---|---|
| backend `tsc --noEmit` | 0 erros | 0 erros |
| backend `typecheck:scripts` | 0 erros | 0 erros |
| backend `eslint .` | 0 problemas | 0 problemas |
| backend `vitest run` | 479 arquivos ok / 84 pulados; 5.246 testes ok / 463 pulados; 0 falhas | 483 arquivos ok / 84 pulados; 5.265 testes ok / 463 pulados; 0 falhas (+8 testes desta rodada em 2 arquivos novos + 1 existente; os outros +11 e 2 arquivos são de outra sessão que trabalhou em paralelo) |
| frontend `tsc --noEmit` | 0 erros | 0 erros |
| frontend `eslint` | 0 erros / 1 aviso (`operator-inia-chat.tsx:1767`, conhecido) | 0 erros / 1 aviso (o mesmo), já com `react-hooks/invariant` como erro |
| frontend `vitest run` | 178 arquivos; 2.049 ok / 1 pulado; 0 falhas | 181 arquivos; 2.053 ok / 1 pulado; 0 falhas (+4 testes desta rodada). A 1ª execução terminou com exit 1 por `[vitest-worker]: Timeout calling "onTaskUpdate"`: timeout interno do Vitest, sem teste associado, com a máquina em carga 36 em 10 núcleos (outra sessão rodava o Vitest ao mesmo tempo); uma 2ª execução repetiu o mesmo erro com carga 35, e uma 3ª, **sem os 3 arquivos de teste novos**, também (178 arquivos, 2.049 ok, mesmo erro). Logo, o erro não vem desta rodada; é da máquina compartilhada. Em todas as execuções, todos os testes passaram |
| frontend `next build` | não rodado nesta rodada (o registro AppSec de 29/10 diz build ok com next 16.4.1) | ok (Turbopack; TypeScript em 41 s; 91 páginas). O texto da fronteira de erro está nos chunks do cliente. Único aviso: `Failed to find font override values for font Atkinson Hyperlegible Next`, que já aparece nos builds da rodada AppSec (`output/appsec-2026-10-29/logs/frontend-build.log`) |

### 6.2 Verificações pontuais (rodadas à parte, sem mudar configuração)

- **Lint com tipos no backend** (`no-floating-promises`, `no-misused-promises`, `await-thenable`): 0 promessas soltas; 1 falso
  positivo (`server.ts:72`).
- **React Compiler** com `react-hooks/invariant: error`: 1 erro antes (F-07) e 0 depois.
- **jsx-a11y** no frontend: 5 tabelas sem acesso por teclado (corrigidas); 38 `label-has-associated-control` não triados.
- **Custo de opções estritas no frontend:**
  - `noUncheckedIndexedAccess`: 1.213 erros em 61 arquivos (42 de produção);
  - `exactOptionalPropertyTypes`: 245 erros.

### 6.3 Prova de banco da Central de Dados (`INIA_DB_PROOF=1 npx vitest run data-hub-proof`)

O resultado foi 12 falhas e 5 aprovações, **igual caso a caso com o `run-pipeline.ts` original e com o corrigido**. A causa é de
ambiente, não de código: o `inia_test` está sem a migração `163_pending_source_custody.sql`, commitada hoje em `4859d40f`.
`data-hub/application/writers/person-identity.ts` usa as colunas `people.pending_custody_*`, que não existem no banco de teste,
e por isso as cargas que escrevem pessoas terminam FAILED. Depois, **com autorização do usuário**, rodei `npm run db:migrate:test` no `inia_test`. Antes, conferi que a 163 era a única
migração pendente e que nenhuma outra sessão usava o banco. O resultado com o `run-pipeline.ts` corrigido:

| Prova | Resultado |
|---|---|
| `data-hub-proof` | 17/17 (inclui 100 mil medições por CSV aplicadas em lotes) |
| `employment-status-hardening` | 19/19 |
| `orphan-runs-proof` | 3/3 |
| `person-identity-proof` | 10/10 |
| `source-custody-proof` | 10/10 |
| `source-rebind-proof` | 3/3 |
| `external-database-proof` | 40 pulados (exige `INIA_EXTERNAL_DB_PROOF=1` e os bancos de exemplo em Docker; não rodado) |

As provas rodaram uma por vez (`--no-file-parallelism`). No fim, nenhuma conexão do `inia_test` ficou em `idle in transaction`.

## 7. Propostas de mudanças amplas

P-1, P-6 e P-7 foram implementadas na segunda rodada, a pedido (§9). As demais continuam como proposta.

| ID | Proposta | Justificativa | Impacto | Plano de validação |
|---|---|---|---|---|
| P-1 ✔ (§9) | Helper único de transação em `src/shared/infrastructure/database/transaction.ts`: savepoint quando recebe um `PoolClient`, `rollback` protegido, `release(erro)` quando o rollback falha. Tipo `Queryable` para o executor, sem `as unknown as` | F-01 e F-03 nasceram da cópia divergente: 23 helpers, 4 variantes | 23 arquivos, por módulo, um de cada vez | Teste unitário do helper (os mesmos cenários de `run-pipeline.test.ts`) + suíte do módulo + prova de banco do módulo |
| P-2 | `noUncheckedIndexedAccess` gradual no frontend: `tsconfig.strict.json` estendendo o principal, `include` só com as pastas já limpas, rodado como catraca (a lista só cresce) | O backend já usa a opção; no frontend o custo foi medido (1.213 erros em 61 arquivos) | Por pasta; sem ligar em massa | `tsc -p tsconfig.strict.json` limpo + testes da pasta |
| P-3 | Testes de contrato frontend × backend nos endpoints críticos (Acompanhamento, ciência, chat, reports): teste do backend que valida a resposta real (supertest) com o schema zod do frontend, como já faz `validate-workflow-for-publish.parity.test.ts` | Esquemas zod independentes nos dois lados, sem nada provando que dizem o mesmo | Só testes | O teste falha ao remover um campo da resposta |
| P-4 | CI mínimo no padrão da empresa: `npm ci`, `tsc`, `typecheck:scripts`, `eslint`, `vitest` dos dois lados, `next build`, `security:check`; provas de banco num job com PostgreSQL e migrações aplicadas | Hoje tudo é manual; as provas de banco apodrecem sem aviso (§6.3) | Infraestrutura (depende de onde o código vive na Vivo) | Pipeline verde na revisão atual |
| P-5 | Id de correlação por requisição (`x-request-id` ou gerado) em `AsyncLocalStorage`, incluído nos logs do pino e no 500 devolvido | Ligar a reclamação do usuário ao log do servidor (nodebestpractices 5.14) | `app.ts` + logger | Teste de rota: o 500 traz o id e o log registra o mesmo id |
| P-6 ✔ (§9) | As provas de banco conferem, antes de rodar, se o `inia_test` tem todas as migrações do diretório, e falham com "banco de teste desatualizado — rode `db:migrate:test`" | §6.3: 12 falhas que parecem de código e são de ambiente | Um helper usado nas 82 provas | Rodar com o banco desatualizado gera a mensagem clara |
| P-7 ✔ (§9) | `app/global-error.tsx` próprio (com `<html>`/`<body>` e o tema) | Erro no layout raiz ainda cai na página padrão do Next | 1 arquivo | Erro forçado no layout em ambiente local |
| P-8 | Decidir a política de `unhandledRejection` (D-1): manter "loga e segue" com alerta na métrica, ou desligar com código 1 como o padrão do Node | Divergência da referência | Operação | Decisão registrada + teste de `installProcessHandlers` |

## 8. Pendências, limitações e como repetir

- **Não verificado no navegador.** Nenhum servidor de desenvolvimento estava rodando, e o working tree e os cookies são
  compartilhados com outras sessões. As mudanças visíveis (fronteira de erro, links e botões nas tabelas, `cn`) foram
  verificadas por testes de componente, tipos, lint e build.
- **Não triados:** os 38 avisos `label-has-associated-control`, o tamanho de bundle e o desempenho de renderização (sem medida, sem
  recomendação).
- **Prova de banco de bancos externos** (`external-database-proof`) não foi rodada: exige os bancos de exemplo em Docker.
- **Limites das referências:**
  - o WebFetch devolve as páginas resumidas, então as citações abaixo são paráfrases;
  - a página do npm do TypeScript recusou o acesso (403);
  - o README do nodebestpractices tem selos de versão contraditórios (“Node 22” × “2026 edition”);
  - não li cada regra da Vercel individualmente, só os títulos e duas regras.

Referências consultadas em 29/10/2026 (material de apoio; nenhuma instalação ou script executado):

| Fonte | Versão / commit | Uso |
|---|---|---|
| vercel-labs/agent-skills — `skills/react-best-practices`, `skills/composition-patterns` | `1a2c79d4` (27/10/2026); react-best-practices v1.0.0 | Práticas gerais de React (efeitos, estado derivado, dados no cliente, composição). As regras de Next/RSC/Server Actions/Vercel (`server-*`, `async-api-routes`, hidratação) foram separadas e não se aplicam às telas client-side daqui |
| mattpocock/skills — `diagnosing-bugs`, `tdd`, `tdd/mocking`, `codebase-design`, `improve-codebase-architecture`, `code-review` | `a496f551` (29/10/2026) | Teste vermelho antes da correção, mock só na fronteira, módulos profundos (P-1). Nenhum fluxo de issue ou publicação foi executado |
| wshobson/agents — `typescript-pro`, `javascript-pro`, `code-reviewer`, `test-automator` | `0874a27b` (17/10/2026) | Só como lista de verificação; conteúdo genérico, nada usado como prova |
| goldbergyoni/nodebestpractices | `dc3d60c2` (15/06/2026) | 1.4, 2.1–2.12, 4.x, 5.14, 6.14, 8.6 |
| Express — error handling, migrating to 5, health check & graceful shutdown | páginas 5.x (release 5.3.0); instalado 5.2.1 | F-02, tratamento de erro |
| React — You Might Not Need an Effect, Synchronizing with Effects, Rendering Lists, useEffectEvent | react.dev (19.2/19.3); instalado 19.2.4 | F-04, keys |
| TypeScript — tsconfig reference | instalado 5.9.3 (doc atual 7.x; o 6.0 muda padrões — ver o plano de atualização antes) | P-2 |
| Node.js — API v24 (`--unhandled-rejections`, `process`, `http`), undici | v24.x; instalado 24.18.1 | D-1, timeouts (o `fetch` não tem prazo total padrão) |
| Next.js 16.4 — documentação instalada em `node_modules/next/dist/docs` | 16.4.1 | F-05 (`error.js`, prop `retry`) |

Como repetir:

```bash
cd backend && npx tsc -p tsconfig.json --noEmit && npm run typecheck:scripts && npx eslint . && npx vitest run
cd frontend && npx tsc --noEmit && npx eslint && npx vitest run && npx next build
# provas de banco (depois de migrar o banco de teste)
cd backend && npm run db:migrate:test && INIA_DB_PROOF=1 npx vitest run data-hub-proof
```

Testes desta rodada:

- `backend/src/modules/data-hub/application/run-pipeline.test.ts`
- `backend/src/main/process-lifecycle.test.ts` (2 casos novos de `listen`)
- `backend/src/modules/interventions/application/config-service-transaction.test.ts`
- `frontend/src/components/reports/report-form/audience-fields.test.tsx`
- `frontend/src/components/layout/route-error-state.test.tsx`
- `frontend/src/components/admin/qa-lab/qa-history.test.tsx`
- `backend/src/shared/infrastructure/database/transaction.test.ts` (§9)
- `backend/src/infrastructure/database/testing/proof-database-setup.test.ts` (§9)
- `frontend/src/app/global-error.test.tsx` (§9)

## 9. Segunda rodada (29/10/2026, a pedido): P-1, P-6 e P-7

### P-1 — transação num lugar só

- **Helper:** `backend/src/shared/infrastructure/database/transaction.ts`. Expõe `inTransaction(db, trabalho, { savepoint })` e
  `transactionRunner(nome)`.
- **Com o pool:** abre um cliente dedicado e faz `begin` → trabalho → `commit`. Se o `rollback` falhar, o erro original sobe e o
  cliente é descartado (`release(erro)`).
- **Com um cliente que já está em transação:** usa savepoint. Depois de um erro, volta ao savepoint **e o descarta** (comando
  novo, `release savepoint`). Sem isso, um savepoint de mesmo nome mais acima deixava de ser o alvo de quem chamou.
- **Nome do savepoint:** só identificador simples, porque entra no SQL.
- **Migração:** 21 cópias locais de `inTransaction` mais o `withOwnerLock` passaram a usar o helper. Ficaram de fora:
  - `inia-training/application/training-service.ts`, trabalho não commitado de outra sessão;
  - os ~50 blocos `begin` escritos direto no código (sem helper). Migrá-los é o próximo passo, se quiserem.
- **Sem mudança no SQL emitido por módulo:**
  - os 14 módulos que já usavam savepoint mantêm o mesmo nome (`const inTransaction = transactionRunner("feedback_rating")` etc.),
    então os comandos ficam iguais;
  - os 7 que não tinham savepoint (`interventions` ×4, `read-confirmation-service`, `postgres-feedback-memory-store`,
    `best-practices`) passam a aceitar um cliente já em transação. Antes, esse caso quebrava com `connect()` num cliente.
- **Tipagem:** um único ajuste, em `publish-workflow.ts`, onde o callback anota `tx: Queryable` como antes, para o
  `tx as Database` existente continuar válido. Sobraram imports sem uso (`PoolClient`/`pg`/`Queryable`), que foram removidos.
- **Validação:**
  - 8 testes do helper: caminho feliz, erro, `rollback` que falha, `commit` que falha, savepoint, aninhamento de mesmo nome e
    nome inválido;
  - provas de banco dos 14 módulos afetados (31 arquivos) **antes e depois, idênticas caso a caso**: 111 ok, 14 pulados e 1 falha
    anterior (D-10);
  - suíte, tipos e lint (§9.4).

### P-1 (continuação) — blocos de transação escritos direto no código

A pedido do usuário, os blocos `connect → begin → … → commit/rollback → release` escritos direto no código também passaram
para o helper: **38 de 41 blocos, em 26 arquivos**. O trabalho foi dividido em três grupos de arquivos disjuntos, migrados em
paralelo por subagentes com as mesmas regras, e **todos os diffs foram revisados aqui**.

**Regras seguidas na migração:**
- os comandos SQL, os parâmetros e a ordem dentro da transação são os mesmos;
- o que rodava depois do `commit` (leitura de retorno, resposta HTTP, publicação) roda depois do `inTransaction`;
- a tradução de erro (23505 → 409 etc.) fica num `try/catch` em volta, cobrindo o mesmo trecho de antes;
- retorno antecipado com `rollback` virou valor-sentinela **só quando nada tinha sido escrito antes**. Em todos os casos a
  "escrita" anterior era um `update … returning` ou um `insert … on conflict do nothing` que não afetou linha nenhuma, em
  tabelas sem trigger (conferido nas migrations). O `commit` de uma transação que não escreveu nada equivale ao `rollback`.

| Grupo | Blocos | Arquivos |
|---|---|---|
| A — rotas e configuração | 16 de 16 | `agents/presentation/agent-router.ts` (2), `ai-management/application/ai-connection-service.ts` (3), `ai-model-service.ts` (2), `ai-policy-service.ts` (2), `assistant/presentation/assistant-router.ts` (2), `users/presentation/user-account-router.ts`, `indicator-rules/presentation/indicator-rule-router.ts`, `indicators/application/indicator-definition-service.ts`, `knowledge/presentation/knowledge-router.ts` (2) |
| B — Central de Dados, pessoas, motor, ingestão | 9 de 9 | `data-hub/application/database-run.ts`, `run-service.ts`, `source-service.ts` (2), `data-hub/infrastructure/aes-secret-store.ts`, `people/application/person-source-link.ts`, `workflows/application/engine.ts` (`claimDueEnrollments`), `ingestion/presentation/ingestion-router.ts` (2) |
| C — publicação e reprojeção de feedback | 13 de 14 | `feedback-engine/application/legacy-holds.ts`, `feedback-engine/infrastructure/reproject-feedback-greetings.ts`, `reproject-feedback-materials.ts` (2), `feedbacks/application/create-approved-feedback.ts`, `follow-up-visibility.ts` (2), `publish-feedback.ts`, `feedbacks/infrastructure/reproject-feedback-headings.ts`, `reliable-feedback/infrastructure/postgres-reliable-feedback-store.ts` (2), `publish-reliable-feedback.ts`, `reproject-published-presentation.ts` |

**Mantidos de propósito**, com o motivo:

| Bloco | Motivo |
|---|---|
| `feedback-engine/infrastructure/publish-engine-feedback.ts` | O `rollback` do retorno "pulado" desfaz uma escrita já feita (a emissão do Output). Com `commit`, a emissão ficaria sem feedback. O `rollback` do `catch` já é protegido |
| `data-hub/application/run-pipeline.ts` (`applyInTransactions`) | Várias transações no mesmo cliente, uma por lote. Já foi corrigido no F-01 |
| `performance-analytics/infrastructure/operational-read-model.ts` (2) | Um entra de propósito na transação de quem chama, sem savepoint. O outro usa `begin isolation level repeatable read read only`, que o helper não oferece. Os dois já protegem o `rollback` |
| `inia-training/application/training-service.ts` | Trabalho não commitado de outra sessão |

**Diferenças de comportamento**, nenhuma nos dados:
- um `rollback` que falha não esconde mais o erro original e descarta o cliente. Antes, nos blocos com `rollback` sem
  `.catch` (pelo menos 31 dos 38, contados na revisão `77c5adcd`), o erro do `rollback` substituía o original e pulava a tradução de erro;
- o cliente volta ao pool antes da leitura e da resposta pós-`commit`, em vez de no `finally`;
- nas saídas antecipadas sem escrita, o comando final é `commit`, e não `rollback`;
- em 6 blocos do grupo A, o corpo ganhou um nível de indentação, e as linhas de continuação dos SQL em template literal ganharam
  2 espaços. É espaço em branco dentro do texto do SQL, sem efeito no PostgreSQL; `git diff -w` mostra só a estrutura;
- revisão aqui: o `view.draft!.id` que o grupo A introduziu em `ai-policy-service.ts` virou um `const draftId` capturado
  antes do callback, sem asserção não nula nova.

**Validação:** provas de banco dos 15 módulos afetados (34 arquivos), antes × depois — **idênticas caso a caso**: 181 ok / 7 pulados / 2 falhas anteriores, as mesmas antes e depois (D-10, depois resolvida, e D-11, depois diagnosticada). Os testes unitários dos
módulos de cada grupo, tipos e lint passaram em cada grupo; a suíte completa está em §9.4.

### P-6 — provas de banco só com o banco de teste em dia

- `backend/vitest.config.ts` ganhou um `globalSetup` (`src/infrastructure/database/testing/proof-database-setup.ts`). Ele só age
  com `INIA_DB_PROOF=1`: compara o diretório `migrations/` com `schema_migrations` do `TEST_DATABASE_URL` (só leitura, via
  `pendingMigrations`, nova em `run-migrations.ts`). Com migration pendente, nenhuma prova roda, e a mensagem lista as pendentes
  e o comando `npm run db:migrate:test`.
- **Validação:**
  - 4 testes unitários;
  - com o `inia_test` em dia, a prova roda normalmente (`orphan-runs-proof` 3/3);
  - com um banco descartável vazio (criado e apagado só para isso), as provas foram barradas com "159 migration(s) pendente(s)".
- **Limitação:** as provas que criam o próprio banco (`installation-proof`, `database-outage-proof`) também exigem o
  `inia_test` em dia.

### P-7 — erro no layout raiz

- **`frontend/src/app/global-error.tsx`:**
  - traz o próprio `<html lang="pt-BR">`/`<body>`, o `globals.css` e o mesmo aviso discreto das outras fronteiras;
  - aplica o tema guardado pelo `next-themes`, lido por `lib/browser/use-stored-theme-is-dark.ts` com `useSyncExternalStore`
    (claro no servidor e na hidratação, o tema real no cliente; sem script inline, por causa da CSP com nonce).
- **Fontes:** as do layout (`next/font`) não entram; o texto usa a fonte de reserva do sistema.
- **Validação:** 2 testes (documento renderizado no servidor e a regra do tema) + build.

### D-10 — prova do motor de feedback desatualizada (resolvida: era o teste, não o produto)

`feedback-engine-workflow-proof`, caso K, falhava antes desta rodada. **Causa:** a correção C12 da 4ª auditoria (`f1db28ce`)
passou a escapar cada linha do preâmbulo do CSV do Diagnóstico como uma célula só. Uma linha com `;` ou aspas sai entre aspas
(`"# Método: …"`, `"# Filtros: {…}"`), e a do método tem `;`, então isso acontece em todo export. A prova só pulava linhas que
começam com `#`, por isso lia a linha do método como cabeçalho.

O comportamento do produto é o pretendido: o `;` de um filtro não abre célula nova, e a planilha mostra o preâmbulo na coluna A.
O único leitor programático do arquivo era a própria prova; o frontend só oferece o link de download. A prova só roda com
`INIA_DB_PROOF=1` e ficou para trás sem aviso, o mesmo tipo de apodrecimento da P-6, agora por mudança de formato e não de
migration.

**Correção:**
- a prova pula as linhas `#` e `"#`;
- teste unitário novo, `feedback-engine/application/leadership-diagnostics-csv.test.ts`, que documenta o formato do preâmbulo e a
  neutralização de fórmula; até aqui, só a prova de banco o exercitava.

**Resultado:** prova 16/16. Os números conferidos no caso K (ocorrências, taxa, regras sem ligação) batem, ou seja, os dados do
export estavam certos. Os testes dos módulos de motor de feedback e Diagnóstico passam (561).

### D-11 — prova de provedores de IA: banco de teste com cadastro de outra sessão (diagnosticada; não é defeito do produto)

`ai-providers-proof`, caso "uso LEGADO é precificado pela tabela", falha com `cost_status: UNKNOWN`.

**Causa.** A regra (`ai-runtime-store.ts`, `legacyPricingOf`) só precifica o uso legado quando o modelo (provedor + id) está
cadastrado **uma vez** na organização. Com dois cadastros, o preço fica nulo de propósito ("nunca um palpite"), e o próprio fim
do caso exige isso. No `inia_test`, a organização da prova já tem uma conexão "Google Gemini" com `gemini-3.1-flash-lite`, o
modelo da rota legada. Quando a prova cadastra o dela, vira ambíguo.

**De onde veio o cadastro.** Ele foi criado em 23/10, no mesmo segundo em que a migração `160_ai_default_models.sql` foi aplicada.
Essa migração e `backend/seeds/ai/configuracao-inicial.json` são trabalho **não commitado** da worktree `brave-curie-8ac5f2`
("modelos de IA pela tela"), aplicado no banco de teste compartilhado. Nenhuma das duas peças existe nesta branch.

**Prova de que o produto está certo.** A mesma prova, num banco descartável recém-migrado (criado e apagado só para isso), passa
**19/19**, inclusive esse caso.

**O que mudou:**
- a prova confere, logo antes de checar o preço, se o modelo legado já está cadastrado fora dela. Se estiver, falha dizendo
  exatamente isso (`banco de teste com "gemini-3.1-flash-lite" já cadastrado fora da prova …`, listando `Google Gemini`);
- a conferência fica depois da chamada legada, porque os casos seguintes (painel por provedor) contam com o uso que ela gera;
- resultado no `inia_test`: 18 ok e 1 falha, como antes, agora com a causa na mensagem.

**O que fica para decidir:**
- **Banco de teste.** O cadastro não foi removido, porque é dado da outra sessão: os registros de `ai_default_models` apontam para
  esses modelos com `on delete restrict`.
- **Quando a configuração inicial de IA for integrada,** toda organização nascerá com o modelo legado cadastrado. A prova (e talvez a
  regra de ambiguidade, se o administrador cadastrar o mesmo modelo de novo) terá de precificar o cadastro padrão, em vez de criar um
  segundo.

### 9.4 Verificações da segunda rodada

| Verificação | Resultado |
|---|---|
| backend `tsc`, `typecheck:scripts`, `eslint .` | 0 erros / 0 problemas |
| backend `vitest run` | 485 arquivos ok / 84 pulados; 5.277 testes ok / 463 pulados; 0 falhas (+12 desta rodada: 8 do helper e 4 da checagem das provas) |
| frontend `tsc`, `eslint` | 0 erros; 1 aviso (o mesmo de sempre) |
| frontend `vitest run` | 182 arquivos; 2.055 ok / 1 pulado; 0 falhas (+2 do `global-error`). A 1ª execução terminou de novo com o erro interno `Timeout calling "onTaskUpdate"`; a execução seguinte, com o mesmo código, terminou **limpa** (exit 0). Logo, é intermitente e de ambiente, não determinístico |
| frontend `next build` | ok, 91 páginas, com o `global-error` no lugar do padrão do Next |
| Provas de banco dos módulos da P-1 (31 arquivos) | idênticas antes × depois, caso a caso: 111 ok / 14 pulados / 1 falha anterior (D-10) |
| Migração dos blocos escritos direto (depois) | backend `tsc`, `typecheck:scripts` e `eslint .` limpos; `vitest run` 485 arquivos ok / 85 pulados, 5.277 testes ok / 467 pulados, 0 falhas; provas dos 15 módulos idênticas antes × depois |
| Provas da Central de Dados (P-6 ativa) | rodam com o banco em dia; barradas com mensagem clara diante de um banco desatualizado |

## 10. Commits (29/10/2026, sem push)

Branch `admin-list-standardization`. Cada arquivo foi adicionado explicitamente; o trabalho não commitado de outras sessões
no mesmo working tree ficou de fora. Isso inclui os trechos de coleta de usabilidade em `backend/src/main/server.ts`: desse
arquivo entraram só os dois trechos do F-02, aplicados ao índice por patch.

| Commit | Conteúdo |
|---|---|
| `724dff25` | F-01 — APPLYING da Central de Dados não devolve cliente com transação aberta |
| `63bfdb01` | F-02 — porta ocupada no `listen` do Express 5 desliga o processo |
| `be15701f` | P-1 — helper único de transação + 22 cópias (inclui o F-03) |
| `d00818da` | P-1 — 38 blocos escritos à mão migrados para o helper |
| `1f8bea35` | P-6 — provas de banco só com o banco de teste em dia |
| `185ba154` | D-10 e D-11 — provas desatualizadas (CSV do Diagnóstico; banco de teste com cadastro de outra sessão) |
| `437c4040` | F-04 — busca de destinatários do report |
| `147d6636` | F-05 e P-7 — fronteiras de erro de rota e `global-error.tsx` |
| `16bbee3a` | F-06 — tabelas acessíveis pelo teclado |
| `3c805f5e` | F-07, F-08 e F-09 — erro interno do React Compiler como erro de lint; classes pelo `cn` |
| (este) | relatório |

## 11. Terceira rodada (30/10/2026): as pendências

**Decisões do usuário:**
- P-8: manter "registra e segue";
- CI no GitHub Actions mais um script local;
- não mexer nos arquivos das frentes não commitadas (Meu turno, Treino, chat da INIA);
- trocar os `request.user!`.

| Item | O que foi feito | Validação |
|---|---|---|
| D-4 | Helper `sessionUser(request)` (`backend/src/modules/auth/presentation/session-user.ts`): usuário com tipo garantido; sem ele, o mesmo 401 `UNAUTHENTICATED` do `requireAuth` em vez de `TypeError`/500. Foram 328 trocas mecânicas em 56 arquivos, feitas por subagente e revisadas aqui; 36 ficam em arquivos com trabalho de outras sessões (`app.ts`, `auth-router`, `realtime-router`, `usage-events-router`, Treino, Meu turno) | tipos, lint, testes dos 40 módulos tocados; teste do helper (2) |
| P-3 | `backend/src/shared/presentation/testing/frontend-schema.ts` carrega o schema zod da tela pelo caminho do frontend (alias `@/` no `backend/vitest.config.ts`). A prova de ciência ganhou o caso "contrato com a tela": `/operator/overview`, `/operator/feedbacks` e a confirmação passam pelos schemas `operatorOverviewSchema`, `operatorFeedbackPageSchema` e `readConfirmationResultSchema` | prova 6/6; sabotagem: sem `feedbacksNextCursor` na resposta, a prova falha com "expected string, received undefined" |
| P-2 | Catraca `npm run typecheck:estrito` (`frontend/scripts/typecheck-strict.mjs` + `typecheck-strict-baseline.json`): roda `tsc` com `noUncheckedIndexedAccess` e falha se algum arquivo ganhar erro; `--atualizar-base` só para encolher. Três arquivos de produto zerados (`query-fields`, `operator-daily-feedback-feed`, `av-sync-section`) | base 1.213 → 1.208 erros, 61 → 58 arquivos; sabotagem: arquivo novo com `lista[0].toUpperCase()` reprova; a catraca pegou também um erro meu no teste do lip-sync |
| P-4 | `.github/workflows/ci.yml` (actions presas por SHA, `permissions: contents: read`): jobs backend (tipos, tipos dos scripts, lint, testes) e frontend (tipos, catraca, lint, testes, build), bloqueantes; job `provas` sob demanda, com PostgreSQL 17, migrations, dados de referência e massa demo. `npm run verificar` (`scripts/ci/verificar.mjs`) roda o mesmo localmente (`--sem-build`, `--provas`) | YAML validado; os passos conferidos localmente (§11.1) |
| P-5 | `x-request-id`: `backend/src/shared/presentation/request-id.ts` (aceita o id do proxy se for identificador simples de 8–64 caracteres, senão gera UUID; devolve no cabeçalho) + `shared/application/observability/request-context.ts` (`AsyncLocalStorage`); o logger põe `requestId` em toda linha (`mixin` do pino) e o 500 genérico devolve `requestId` | 5 testes do middleware (inclusive simultâneas e depois de `await`) + teste de ponta a ponta no `app.test.ts` (banco falhando → 500 com o id do cabeçalho, sem detalhe interno) |
| Acessibilidade | Os 38 avisos `label-has-associated-control` são falsos positivos (`<label>` envolvendo `Switch`/`RadioGroupItem`/`Input`, nome conferido com `dom-accessibility-api`). A triagem achou 4 problemas reais, corrigidos: `source-wizard` e `database-wizard` com `aria-label` diferente do texto visível (WCAG 2.5.3), "Namespace de origem" sem nome, botão "Inserir imagem" sem nome | testes de `data-hub` e `profile` (69) |
| D-11 | A conta do preço legado roda numa organização C criada e apagada pela própria prova; a chamada legada continua na organização da prova (o painel a soma) | `ai-providers-proof` 19/19 no `inia_test` com o cadastro da outra sessão |
| Node 24 | `frontend`: `@types/node` 20 → 24.19.2 (lockfile: só ele e `undici-types`), `engines.node >=24`; `.nvmrc` na raiz | tipos, catraca, testes e build |
| Vitest | Causa do "Timeout calling onTaskUpdate": o arquivo de replays do lip-sync é CPU síncrona encadeada por microtarefas; sob carga o worker passava de 60 s (prazo fixo do Vitest) sem ler a resposta do processo principal — aparecia até com carga 3, pela disputa entre os próprios workers. Correção em `speech-lipsync-engine.test.ts`: volta ao event loop entre os testes dos três blocos de replay; o teste de alocação ganhou aquecimento explícito de 100 mil chamadas (antes dependia da ordem dos testes e falhava isolado); o de custo de CPU confere a carga também depois de medir. Tentativas descartadas no caminho: volta ao event loop em todo o arquivo (desestabilizava a alocação) e mover custo/alocação para arquivo próprio (o custo passava a disputar CPU com os replays) | 3 rodadas da suíte do frontend com carga 30–40: 0 timeouts (antes, 1 por rodada); o arquivo passa em todas as rodadas, com o custo pulado sob carga alta, como prometido |

### 11.1 Ambiente: provas num banco novo e bancos externos

- **Provas num banco recém-criado** (o que o job `provas` do CI faz), em ordem:
  - só com as migrations: 338 ok, 17 falhas;
  - mais dados de referência: as mesmas falhas;
  - mais massa demo (53 s): restam **5 falhas antigas**:
    - `diagnostic-strategy-proof`: 500;
    - `analytics-read-model-proof`: 2 estouros de tempo;
    - `diagnostic-calls-proof`: 1 estouro de tempo e 1 texto divergente na "regressão Ícaro".

  Não foram investigadas nesta rodada; por isso o job de provas é sob demanda e não bloqueia. O banco descartável foi apagado.
- **Prova de bancos externos** (`external-database-proof`):
  - rodou com PostgreSQL, MariaDB e MySQL de exemplo em contêineres efêmeros. As senhas aleatórias ficaram só no ambiente do comando: o `.env` da raiz não foi criado, porque mudaria como a instalação enxerga esta máquina. Os contêineres foram removidos no fim;
  - 27 de 30 casos falham no teste de conexão (`health: ERROR`);
  - **numa cópia limpa da revisão `77c5adcd` (antes desta auditoria) a falha é a mesma** (PostgreSQL: 9 falhas, 1 ok). É anterior a estas mudanças; a causa não foi identificada (a regra do banco interno compara porta e não é ela);
  - SQL Server não rodou, porque depende de emulação em ARM.
- **Navegador:** a visão em tabela de Workflows foi conferida na tela real (servidor de desenvolvimento local, conta de teste da massa demo). O nome de cada linha é um `<a href>` focável. Ao fim: preferência de visão devolvida para cards, logout, janela restaurada. Os outros itens visíveis (fronteiras de erro, rótulos acessíveis) ficaram cobertos por testes de componente e pelo build.

- **Primeira execução do CI no GitHub** (publicação `7f35d9ac`):
  - backend verde; provas puladas, como previsto (são sob demanda);
  - frontend com 1 falha: o custo de CPU do lip-sync deu 1.137 ms para 55 s de fala (~2%) contra o orçamento absoluto de 1%, que
    foi calibrado na máquina de desenvolvimento;
  - decisão: no CI (`CI=true`) o teste se pula e diz por quê, pela mesma regra que já valia para máquina saturada (medida que
    não diz nada sobre o motor). Ele continua valendo localmente (`npm run verificar`);
  - observação para o produto: em hardware mais fraco que o de desenvolvimento, o lip-sync passa de 1% de CPU. Vale medir numa
    máquina típica de operador antes de concluir algo;
  - nenhum timeout de RPC do Vitest no CI.
- **Instabilidade observada sob carga alta (local):** `Parse Error: Expected HTTP/` do supertest em testes de rota, uma vez em
  `qa-lab-router.test.ts` e uma em `feedback-review-router.test.ts`. Repetidos sozinhos, passam (3/3). Não investigado.

### 11.2 O que continua em aberto

- **Arquivos com trabalho de outras sessões** (por decisão do usuário):
  - D-7, validação dos eventos SSE do chat;
  - D-9, o chat da INIA;
  - a cópia de `inTransaction` do Treino;
  - os 36 `request.user!` restantes;
  - o `className` sem `cn` no chat.
- **Provas que não passam:**
  - as 5 que falham num banco novo;
  - a causa da falha da prova de bancos externos;
  - SQL Server.
- **Acessibilidade:** os 216 avisos de `Label` do shadcn com a regra estendida (amostra indica maioria de falsos positivos).
- **Não medido:** tamanho de bundle e desempenho de renderização, sem medida e portanto sem recomendação.
- **Uso do CI:** ele consome minutos do plano do GitHub a cada publicação.

### 11.3 Verificações da terceira rodada

| Verificação | Resultado |
|---|---|
| `npm run verificar` — backend | tipos, tipos dos scripts e lint limpos; 488 arquivos ok / 86 pulados, **5.290 testes ok** / 471 pulados, 0 falhas |
| `npm run verificar` — frontend | tipos e lint limpos (1 aviso, o mesmo); catraca: 1.208 erros em 58 arquivos, nenhum piorou; build ok |
| Testes do frontend | 183 arquivos, **2.065 ok** / 1 pulado, 0 falhas, exit 0, **0 timeouts** do Vitest em 3 rodadas com carga 30–40 (a 1ª rodada do `verificar`, antes da correção do lip-sync, terminou com o timeout) |
| Provas tocadas nesta rodada | `read-confirmation-proof` 6/6 (contrato), `ai-providers-proof` 19/19, `data-hub-proof` e demais da Central (sem mudança) |
| Navegador | tabela de Workflows com link focável por linha (servidor de desenvolvimento local) |

### 11.4 Commits da terceira rodada

Branch `admin-list-standardization`, com índice temporário: o staging de outras sessões nunca foi levado nem desfeito. Do
`backend/src/main/app.ts` entraram só o import, o middleware e o corpo do 500; o resto do arquivo é trabalho não commitado de
outra sessão.

| Commit | Conteúdo |
|---|---|
| `81690653` | D-4 — `sessionUser` no lugar de `request.user!` (56 arquivos + helper) |
| `113f2e98` | P-5 — id de requisição em toda linha de log e no 500 genérico |
| `f4c5d4ab` | P-3 — contrato frontend × backend nas provas |
| `db4ae011` | D-11 — prova do preço legado independente do banco de teste |
| `faf64a13` | P-4 e P-2 — GitHub Actions, `npm run verificar` e catraca de tipagem estrita |
| `f292cc8a` | Acessibilidade — nomes acessíveis e controles sem nome |
| `b64f8425` | Node 24 no frontend (`@types/node`, `engines`, `.nvmrc`) |
| `64cb184b` | Vitest — fim do timeout de RPC; custo/alocação do lip-sync estáveis |
| (este) | relatório |

