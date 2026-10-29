# Registro dos testes e do reteste — AppSec 29/10/2026

Tudo aqui rodou **só no ambiente local isolado** descrito em `relatorio-tecnico.md` §2: cópia da árvore de trabalho (sem `.env`
do repositório), API em `NODE_ENV=production` (papel `api`, sem workers), interface em build de produção, PostgreSQL 17 descartável
com a massa sintética (`DEMO_SEED`) + uma 2ª organização criada para o teste, IA sem chave e saída de rede bloqueada
(`INIA_OUTBOUND_MODE=ALLOWLIST` + `sandbox-exec` sem rede externa). Nenhum teste de negação de serviço, força bruta ou ação em
serviço de terceiro. Os scripts estão em `anexos/` (`lib.mjs` só aceita alvo `http://127.0.0.1:`).

Contas usadas (todas sintéticas, senha de teste gerada para o ambiente descartável, nunca impressa):

| Perfil | Conta | Uso |
|---|---|---|
| Administradora geral, org A | `carla.nunes@inia.com` (massa) | comparação de acesso; token do ZAP |
| Administrador geral, org B | `adminb@orgb.appsec.local` (criada) | isolamento entre organizações |
| Operador/Supervisora, org B | `opb@` / `supb@orgb.appsec.local` (criadas) | bloqueio de login, enumeração |
| Operadores da org A | `operador0001..0021.demo@inia.local` | escalonamento vertical, sessão, tempo do login |
| Gerente com papel de políticas | `gerente02.demo@inia.local` + `GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO` (concedido pela API) | prova do B1 |

## 1. Varreduras de autorização sobre o inventário de rotas (`anexos/sweeps.mjs`)

Inventário: 475 rotas (231 GET, 165 POST, 33 DELETE, 26 PATCH, 20 PUT), reconstruído em tempo de execução interceptando o
registro das rotas do Express no `createApp` real (`anexos/route-inventory.mts`, `anexos/inventario-de-rotas.json`).
Parâmetros de caminho com UUID aleatório, salvo em S3.

| Id | Teste | Resultado (depois das correções; antes foi idêntico) | Veredito |
|---|---|---|---|
| S1 | Toda rota sem sessão (escritas com `Origin` válido) | 471 × 401; `POST /auth/logout` → 204 (idempotente, sem sessão) | OK |
| S2 | Operador comum em todas as 322 operações de `/api/v1/admin` | 318 × 403; 2 × 400 e 1 × 404 em `/admin/access` (validação antes da permissão); `GET /admin/ai/me` → 200 com a própria lista vazia de permissões | OK (ver S2b) |
| S2b | `anexos/access-escalation.mjs`: operador se atribui `ADMINISTRADOR_GERAL` com corpo válido; revoga o papel real da admin geral; `grant-to-leaders` | 403 `ACCESS_NOT_AUTHORIZED_TO_ASSIGN` nos três; papéis no banco inalterados | OK |
| S3 | Admin geral da org B nas 37 rotas de detalhe em que a admin da org A abre os 34 ids reais da org A (138 pares) | 68 × 404, 2 × 403, 68 × 200 só em `/admin/users/:id/shift` (`{"data":null}`) e `/interventions/people/:personId` (`{"data":[]}`) — nenhum dado | OK |
| S4 | Admin geral da org B lendo as 133 listas sem parâmetro | 117 × 200 sem nenhum id `de00…` nem o nome da org A; demais 400/403/404/422 | OK |

## 2. Sessão, autenticação, CSRF, CORS, erros, API Push e métricas (`anexos/session.mjs`)

| Id | Teste | Esperado | Observado | Veredito |
|---|---|---|---|---|
| SESS-01 | Atributos do cookie de sessão | __Host-, HttpOnly, Secure, SameSite, Path=/ | __Host-inia_session=<mascarado>; Max-Age=43200; Path=/; Expires=Fri, 30 Oct 2026 05:32:15 GMT; HttpOnly; Secure; SameSite=Lax | OK |
| SESS-02 | Claims do JWT | sem dado sensível; exp e jti presentes | sub,personId,organizationId,role,name,email,avatarUrl,jobTitle,teamId,teamName,sv,iat,exp,jti | ENDURECIMENTO |
| SESS-03 | Token reaproveitado depois do logout | 401 | 401 | OK |
| SESS-04 | Outra sessão depois de 'sair de todos' | 401 | 204/401 | OK |
| SESS-05 | JWT com payload alterado (role) e assinatura antiga | 401 | 401 | OK |
| SESS-06 | JWT alg=none | 401 | 401 | OK |
| SESS-07 | JWT assinado com o segredo de exemplo publicado | 401 | 401 | OK |
| SESS-08 | JWT com algoritmo trocado (HS512) | 401 | 401 | OK |
| SESS-09 | Token válido em cookie sem o prefixo __Host- | 401 (produção só lê __Host-) | 401 | OK |
| CSRF-01 | Escrita com cookie e Origin de outro site | 403 | 403 CROSS_SITE_REQUEST_BLOCKED | OK |
| CSRF-02 | Escrita com cookie, sem Origin e Sec-Fetch-Site cross-site | 403 | 403 CROSS_SITE_REQUEST_BLOCKED | OK |
| CSRF-03 | Escrita com cookie sem Origin nem Sec-Fetch-Site | aceita (risco aceito R-26) | 204 | OK (R-26) |
| CSRF-04 | Origin com prefixo da origem válida | 403 | 403 | OK |
| CORS-01 | Preflight de origem estranha | sem Access-Control-Allow-Origin | (ausente) | OK |
| CORS-02 | Preflight da interface | ACAO = origem da interface + credentials | http://127.0.0.1:3630 cred=true | OK |
| CORS-03 | Preflight com Origin: null | sem ACAO | (ausente) | OK |
| ATHN-01 | Mensagem para e-mail inexistente × senha errada | idênticas | 401/INVALID_CREDENTIALS × 401/INVALID_CREDENTIALS (138 ms × 547 ms) | OK |
| ATHN-02 | Tentativas erradas seguidas na mesma conta | bloqueio temporário (429/423) antes da 8ª; senha certa também barrada durante o bloqueio | 401,401,401,401,429,429,429,429 → certa: 429 LOGIN_TOO_MANY_ATTEMPTS | OK |
| ERRH-01 | JSON malformado | 400 genérico, sem stack | 400 {"error":{"code":"INVALID_JSON","message":"Corpo da requisição não é um JSON válido."}} | OK |
| ERRH-02 | Corpo JSON acima de 1 MB | 413 genérico | 413 {"error":{"code":"PAYLOAD_TOO_LARGE","message":"Corpo da requisição grande demais."}} | OK |
| ERRH-03 | Id inválido com aspas no caminho | 400/404 sem erro interno | 404 CASE_NOT_FOUND | OK |
| ERRH-04 | Travessia de caminho na URL da API | 404 JSON | 404 | OK |
| PUSH-01 | API Push sem token | 401 | 401 DATA_PUSH_UNAUTHORIZED | OK |
| PUSH-02 | API Push com token inventado | 401 | 401 DATA_PUSH_UNAUTHORIZED | OK |
| CONF-01 | /internal/metrics sem token | 404 | 404 | OK |
| CONF-02 | /internal/metrics com X-Forwarded-For forjado | 404 | 404 | OK |
| ATHN-03 | Troca de senha com senha atual errada | recusada | 400 VALIDATION_ERROR | OK |
| SESS-10 | Sessão parada só com leituras | encerrada pela inatividade (30 min) | o token do ZAP (1ª passada) passou a receber 401 `SESSION_IDLE` | OK |
| ATHN-04 | Tempo do login: 12 e-mails inexistentes × 12 contas com senha errada (1 tentativa por conta) | sem diferença | mediana 68 ms × 64 ms (`raw/dynamic/login-timing.json`) | OK |

Nota sobre ATHN-01: a primeira medição (138 × 547 ms) vinha das contas da org B que eu criei com bcrypt custo 12; com custo igual
(o que a aplicação gera: `$2b$10$` em 2.372 contas) não há diferença — **rejeitado**. Ressalva: conta com hash de outro custo
seria distinguível (a referência fictícia usa o custo atual).

## 3. Provas dos achados e reteste

| Achado | Prova antes | Correção | Reteste |
|---|---|---|---|
| APPSEC-01 (B1) | `anexos/b1-policy-simulate.mjs`: Gerente sem `people.manage` (403 em `/admin/users` e na ficha) recebe da simulação `"Situação funcional em 2026-10-29: não elegível (INSS)"` e `eligibility.excludedByStatus: {"INSS": 29}` da **supervisora** subordinada | `condition-resolvers.ts` | mesma chamada: 0 ocorrências de INSS/MATERNIDADE/PATERNIDADE; `não elegível (afastamento — motivo protegido)` e `AFASTAMENTO_PROTEGIDO`. Teste novo `condition-resolvers-employment.test.ts` (6 casos) |
| APPSEC-02 (C-N1) | prova de banco `anexos/prova-c-n1-estrutura-custodia.test.ts.txt` no banco de teste descartável: controle (C09) desativa a conta; com a carga de Estrutura a conta pré-cadastrada fica ativa, `session_version` igual, move para o Grupo B e `canOpenEmployeeProfile` = true; depois da Estrutura, a promoção por Colaboradores também deixa a conta ativa | `4859d40f` + `77c5adcd` (sessão da auditoria Cloudflare, não desta rodada) | 1º reteste, sobre `4859d40f` + migration 163: os 2 cenários **continuavam falhando** (reportado; `raw/dynamic/cn1-proof-after-fix.txt`). 2º reteste, sobre `77c5adcd`: **3/3** — conta desativada e `session_version` 0→1 nos dois cenários; `source-custody-proof` 10/10 (`raw/dynamic/cn1-proof-after-77c5adcd.txt`) |
| APPSEC-04 (metadados JPEG) | teste novo contra o código anterior: `expected '…' not to contain 'GPS'` (`raw/dynamic/image-metadata-before-fix.txt`) | `image-metadata.ts` | 5/5 testes passam |
| APPSEC-05 (tag GCM) | teste novo contra o código anterior: tag truncada (4 e 12 bytes) **decifrava** | `aes-secret-store.ts` | 5/5 testes passam |
| P-01 (`body-parser` 2.3.0, GHSA-27r3-jxmh-p828) | `anexos/body-parser-crash.mts`: 14 variantes (gzip/deflate/br, bytes extras de texto, aleatórios e com assinatura gzip, em 1 ou 2 escritas) contra o `createApp` real num processo descartável | — | **não reproduzido** em Node 24.18.1 (400 ou 404, processo vivo) |

## 4. ZAP 2.17.0 (`raw/zap/`, fora do Git)

**1ª passada (efetivamente SEM sessão).** OpenAPI de 466 operações gerada do inventário + spider da interface + varredura
passiva e ativa (25 min, 4 threads). As métricas internas da API mostraram 528.930 requisições, **0 respostas 5xx** e só 365
com sucesso; as 8.248 requisições a `GET /admin/agents` deram 4xx, embora a mesma requisição autenticada dê 200. Conclusão: o
cookie não chegou (a substituição `${INIA_TOKEN}` do plano não foi aplicada e o token também expirou por inatividade). Vale como
varredura **pré-autenticação**: 0 alertas na API. Interface: `CSP: style-src unsafe-inline` (médio — R-07), `Big Redirect
Detected` (baixo — o 307 da raiz para o login carrega corpo; sem dado sensível) e informativo.

**2ª passada (autenticada).** Token da administradora geral sintética gravado no plano, inatividade desligada só nesta subida
(`SESSION_IDLE_TIMEOUT_MINUTES=0`, desvio registrado), autenticação conferida antes por um `requestor` (200), ids reais da org A
nos parâmetros de 54 operações. Varredura ativa de 28 min 32 s; o token continuava válido no fim (`/auth/me` → 200).

| Métrica (métricas internas da API, diferença antes/depois) | Valor |
|---|---|
| Requisições | 532.737 |
| 2xx/3xx (autenticadas e aceitas) | 168.133 |
| 4xx (validação, 404 de ids injetados, permissão) | 363.972 |
| 5xx | 632 — todas com corpo genérico (`INTERNAL_ERROR`, sem stack) |
| Rotas atingidas / com resposta de sucesso | 164 / 42 nomeadas (o restante é agregado em "outras rotas" pelas métricas) |

| Alerta ZAP | Risco (confiança) | Classificação |
|---|---|---|
| Spring4Shell (40045), `POST /best-practices/analyses` | Alto (Médio) | **rejeitado** — não há Java/Spring; a "evidência" é um `400 Bad Request` diferente para o parâmetro `class.module.classLoader…` |
| Cross Site Scripting Weakness (Persistent in JSON Response) (40014), `GET /admin/intervention-policies/audit` | Baixo (Baixo) | **rejeitado** — o texto gravado volta em JSON com `Content-Type: application/json` e `nosniff`; a interface renderiza como texto (React) |
| User Agent Fuzzer (10104) | Informativo | sem ação |

Causas dos 5xx (616 erros registrados no log da API):

| Qtde | Causa | Classificação |
|---|---|---|
| 426 | `POST /admin/org-structure/subjects` com nome repetido: violação da restrição única vira 500 em vez de 409 | qualidade (Q-01) |
| 183 | byte NUL (`%00`) em parâmetro de caminho/corpo chega ao PostgreSQL (`invalid byte sequence for encoding UTF8: 0x00`) em várias rotas | qualidade (Q-02) — consulta parametrizada, sem injeção; o certo é 400 |
| 7 | `POST /admin/knowledge` sem corpo multipart/JSON: `request.body.title` lido antes da validação (`TypeError`) | qualidade (Q-03) |

Nenhum alerta de injeção (SQL, NoSQL, comando, caminho), XSS refletido, SSRF ou inclusão de arquivo nas 466 operações.

## 5. Verificações nativas

| Verificação | Resultado |
|---|---|
| backend `typecheck`, `typecheck:scripts`, `lint` | OK |
| backend `vitest` (cópia isolada, antes das correções) | 5.233 passaram, 449 pulados (provas de banco) |
| frontend `typecheck`, `lint` | OK (1 aviso de lint preexistente: `react-hooks/set-state-in-effect`) |
| frontend `vitest` | 2.049 passaram; saída 1 pelo erro conhecido `Timeout calling "onTaskUpdate"` do Vitest sob carga (preexistente) |
| Arquivos alterados (repositório) | testes afetados: 57 (intervenções) + 128 (imagem, cifra, Central de Dados, perfil, cenários, IA) passaram; `tsc --noEmit` e `eslint` OK |
| Dependências atualizadas numa 2ª cópia (`body-parser 2.4.0`, `multer 2.5.0`, `zod 4.6.7`, `qs 6.16.1`, `next 16.4.1`) | backend: typecheck OK, 5.229 passaram; 4 falhas intermitentes sob carga que passam isoladas (31/31). Frontend: typecheck, lint, 2.049 testes e `next build` OK. `npm audit signatures`: 490 assinaturas e 73 atestações verificadas |
| **Árvore real depois de APLICAR as atualizações** (29/10 ~16:10, inclui `77c5adcd`) | backend: typecheck, `typecheck:scripts`, lint OK; **5.246** testes passaram (463 pulados). Frontend: typecheck OK, lint com o aviso antigo, **2.049** testes, `next build` OK (91 páginas). `npm audit signatures`: backend 490 + 73 atestações, frontend 983 + 240. OSV: 80 → 73 itens, nenhum novo. Tudo sem rede externa e sem o `.env` real (`DOTENV_CONFIG_PATH=/dev/null`), exceto o build (fontes do `next/font`) |
