# Inventário de falhas e cobertura do diagnóstico (11/11/2026)

Resultado da auditoria do repositório para as telas de erro e o diagnóstico na VM. Para cada fluxo: onde a falha nasce, como se
propaga, o código, onde a pessoa vê e onde o administrador investiga. As lacunas no fim são as que ficaram abertas de propósito.

Peças centrais (todas novas, salvo indicação):

- **Catálogo** `backend/src/shared/domain/errors/error-catalog.ts` (+ inventário gerado `domain-error-codes.generated.ts`,
  877 códigos de módulos lidos do fonte) → `docs/operacao/catalogo-de-erros.md|json`, a Administração e a CLI. Teste
  `error-catalog.test.ts`: inventário e documentos em dia, nenhuma entrada órfã, aliases reais, arquivos citados existem, todo
  `INIA-*` do frontend está no catálogo.
- **Correlação**: `x-request-id` (já existia, `shared/presentation/request-id.ts`) agora também é gerado pelo navegador em cada
  chamada (`frontend/src/lib/api/api-client.ts`), exposto pelo CORS e gravado no log do IIS (campo personalizado).
- **Envelope de erro** `modules/error-diagnostics/presentation/error-envelope.ts`: toda resposta 4xx/5xx ganha `error.reference`,
  uma linha `http_error` e a ocorrência (`error_occurrences`, migration 187). Status e códigos existentes **não mudaram**; o 500
  mantém `requestId` por compatibilidade.
- **Logs**: pino com `time` ISO UTC, `service`, `release` e `requestId` em toda linha (`shared/infrastructure/logging/logger.ts`,
  `shared/application/observability/service-identity.ts`).

## Fluxos

| Fluxo | Nasce em | Propagação | Código | Pessoa vê | Investigar |
| --- | --- | --- | --- | --- | --- |
| Validação de entrada | zod nas rotas; `describeClientError` (JSON inválido, corpo grande, upload, formato no banco) | exceção → handler global | `VALIDATION_ERROR`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`/`FILE_TOO_LARGE`, `INVALID_UPLOAD`, `INVALID_IDENTIFIER`/`INVALID_CHARACTER`, `DUPLICATE_RECORD`, `BAD_REQUEST` (existentes) | mensagem no formulário (contextual, o que foi digitado fica); fronteira = tela 400 | log `http_error` + ocorrência |
| Regra de negócio dos módulos | `new DomainError(...)` e respostas `{ error: { code } }` em 182 arquivos | exceção ou resposta direta | ~877 códigos inventariados (ex.: `BUSINESS_DOMAIN_IN_USE`), família por status | mensagem do módulo (contextual); listas da Administração e análises com faixa código/referência | catálogo (código + família) + ocorrência |
| Sessão | `require-auth.ts`, `proxy.ts` (interface) | 401 + cookie limpo; proxy redireciona ao login | `UNAUTHENTICATED`, `SESSION_IDLE`, `SESSION_REVOKED`, `TEMPORARY_PASSWORD_EXPIRED` (existentes) | redirecionamento ao login (página); tela 401 com "Fazer login" e retorno seguro (`?voltar=`) quando a tela quebra por 401 | ocorrência (sem org quando não há sessão) |
| Permissão | `requirePermission`, `writesRequireOrganization`, checagens dos módulos | 403 | `FORBIDDEN`, `ORGANIZATION_SCOPE_REQUIRED`, `*_FORBIDDEN` dos módulos | tela 403 / estado "sem acesso" contextual; "Procure o administrador…" | ocorrência + papéis da conta |
| CSRF | `origin-guard.ts` | 403 | `CROSS_SITE_REQUEST_BLOCKED` | 403 | ocorrência + `CORS_ORIGIN` |
| Limites | `rate-limit.ts` (PostgreSQL) | 429 com `retryAfterSeconds` | `RATE_LIMITED`, `LOGIN_TOO_MANY_ATTEMPTS` | mensagem do limite | ocorrência |
| Rota inexistente da API | 404 final do `app.ts` | resposta | `NOT_FOUND` | 404 | **só log** (varredura não enche o banco) |
| Página inexistente | Next (`app/not-found.tsx`) | 404 real do Next | `INIA-INTERFACE-PAGINA-NAO-ENCONTRADA` (sem referência: não é falha) | tela 404 | log do IIS (caminho) |
| Banco interno fora/lento/esgotado | `pg` | exceção → handler global → `classifyUnexpectedError` | `INIA-BANCO-INDISPONIVEL`, `INIA-BANCO-TIMEOUT`, `INIA-BANCO-CONEXOES-ESGOTADAS` (status continua 500) | tela 500 / faixa contextual | log (a ocorrência não grava com o banco fora); `/ready` |
| IA (provedores) | `ai-errors.ts`, limitador, orçamento | `DomainError` com status próprio | `AI_<CATEGORIA>` (existentes) + aliases `INIA-IA-*` | mensagem do chat/tela | ocorrência + Administração › IA |
| Chat em fluxo (SSE) | `realtime-router.ts` depois do `flushHeaders` (200 já enviado) | evento SSE `error` | agora com `code` (do domínio ou `INIA-STREAM-FALHA`) e `reference` | mensagem no chat com "(código … · referência …)" | `stream_error` no log + ocorrência `STREAM` |
| Central de Dados (conectores) | `DataRunError` | rota síncrona = 502/422; carga = Run reprogramado | `DATA_*` (existentes) + alias `INIA-DADOS-TIMEOUT` | mensagem da Central | ocorrência (rota síncrona); Execuções da fonte (carga) |
| Tarefas periódicas | `periodic-jobs.ts` | rodada falha, próxima tenta | `INIA-JOB-FALHA` + referência `job-<tarefa>-<uuid>` | ninguém (não há tela) | `job_error` no log + ocorrência `JOB` + `/internal/metrics` |
| Processo | `process-lifecycle.ts` | rejeição registrada; exceção encerra e o WinSW reinicia | `INIA-PROCESSO-FALHA` + `proc-<uuid>` | indisponibilidade breve | log + `wrapper.log` + ocorrência `PROCESS` (se o banco estiver de pé) |
| Inesperado (fallback) | qualquer rota | handler global | `INTERNAL_ERROR` (alias `INIA-API-INESPERADO`) com resumo sanitizado | tela 500 | log com pilha sanitizada + ocorrência |
| Renderização no navegador | componente React | `error.tsx` / `global-error.tsx` | `INIA-INTERFACE-RENDERIZACAO` + `web-<uuid>` | tela 500 com código/referência; "registrada" só após o 201 da API | `POST /api/v1/client-errors` → ocorrência `CLIENT` + `client_error` no log |
| Renderização no servidor Next | componente de servidor | digest | `INIA-INTERFACE-SERVIDOR`, referência = digest | tela 500 | `instrumentation.ts` → `interface_error` em `INIA-Interface*.err.log` |
| Rede do navegador | `fetch` sem resposta | `ApiError` status 0 | `INIA-REDE-SEM-CONEXAO` (offline, referência local) / `INIA-REDE-API-INALCANCAVEL` (online) | tela "sem conexão" (sobreposta, app aberto) / 500 | fila local enviada quando a rede volta; log do IIS |
| Proxy IIS/ARR | ARR sem instância saudável / prazo de 5 min | 502/503/504 sem `x-inia-release` | `INIA-PROXY-INDISPONIVEL` | tela 500 com referência "procurar no IIS" | log do IIS (`x-request-id`, `sc-substatus`) |
| Resposta adulterada | portal de rede/proxy corporativo | 2xx/4xx sem o JSON da INIA | `INIA-INTERFACE-RESPOSTA-INVALIDA` | tela 500 | log do IIS |
| Inicialização | `env.ts` (segredos/origens em produção), `listen_failed` | processo não sobe | — (mensagem na saída) | interface indisponível | `INIA-*.err.log`, `wrapper.log` (runbook § 7) |

## Lacunas conhecidas (não cobertas neste trabalho)

1. **Formulários e painéis um a um**: a faixa código/referência entrou no kit (`ErrorState.support`), nas análises
   (`AnalyticsErrorState`) e nas listas da Administração (`AdminListView`). Os ~140 formulários que mostram `error.message` em
   texto continuam como estavam (mensagem correta, sem código/referência). Migrar = passar o erro para `FailureSupport`.
2. **Chamadas `fetch` fora do `api-client`** (login, `auth-service`, chat em fluxo, coleta de uso, prévia de documentos) não enviam
   `x-request-id` próprio: a API gera um, que volta no cabeçalho e no corpo de erro, mas uma falha de rede nelas não tem referência.
3. **Códigos montados em variável** (`code: someVar`) não entram no inventário automático; caem na família do status.
4. **Workflows e motor de feedback**: falhas de execução já são persistidas nas próprias tabelas (execuções, `node_outputs`) e
   aparecem nas telas de Resultados; não viraram ocorrências `INIA-JOB-FALHA` (só as tarefas periódicas).
5. **Fallback próprio do IIS**: o `web.config` mantém `existingResponse="PassThrough"` (as respostas da API passam intactas). Uma
   página de erro própria do IIS para 502 com a arte da INIA **não** foi configurada — não havia IIS para validar o comportamento
   do ARR com página personalizada sem quebrar os 4xx da API. Com a interface fora, a pessoa vê a página do IIS (runbook § 7).
6. **Abertura a frio sem internet**: sem service worker (a estratégia de cache é só de estáticos versionados), o navegador mostra
   a página dele. A tela "sem conexão" da INIA cobre só o app já aberto.
7. **Referência escolhida pelo cliente**: a API aceita o `x-request-id` do navegador (padrão já existente). Um cliente pode repetir
   uma referência; a busca mostra todas as ocorrências daquela referência na organização, nunca de outra.
