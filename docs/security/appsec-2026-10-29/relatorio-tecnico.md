# Relatório técnico — preparação AppSec (Conviso), 29/10/2026

Objetivo: antecipar o que a avaliação corporativa de AppSec vai encontrar, validar os achados e corrigir o que for bem
delimitado. **Não é certificação nem substitui o Conviso.** "Nenhum achado" abaixo sempre significa "nenhum achado nos testes
executados", nunca "sem vulnerabilidades".

## 1. Escopo, revisão e estado do repositório

| Item | Valor |
|---|---|
| Repositório | `/Users/renanmenezes/Developer/Works/inia`, branch `admin-list-standardization` |
| Revisão no início | `f1db28ce` + árvore suja (80 entradas não commitadas de outras frentes: treino com a INIA, "Meu turno", coleta de uso…) |
| Durante o trabalho | a sessão da auditoria Cloudflare (em andamento) commitou `1ea944cf` (N01 e N04). A cópia usada no pentest recebeu esses arquivos antes do reteste |
| Cópia analisada | `output/appsec-2026-10-29/app` (arquivos versionados + novos não ignorados, sem `.env`), manifesto sha256 em `output/appsec-2026-10-29/logs/app-snapshot-manifest.sha256` (hash do manifesto `ca373fd8…24a6a4`) |
| Fora do escopo | produção, homologação no Azure e qualquer endereço remoto; chamadas reais a provedores de IA |

Trabalho preservado: nenhum arquivo de outra frente foi alterado; nada foi commitado. A auditoria Cloudflare (`~/security-audit-skill/inia/run-1/`) foi só
lida; seus 18 achados (C01–C18) já estavam corrigidos pela outra sessão e não foram reapresentados.

## 2. Ambiente e ferramentas (versões, configuração, comandos)

Todas as ferramentas rodaram em contêiner com imagem **fixada por digest** (`output/appsec-2026-10-29/tools/images.txt`); só os
downloads de regras/base usaram rede.

| Ferramenta | Versão e digest | Configuração | Escopo e exclusões | Envio de dados |
|---|---|---|---|---|
| Semgrep CE | 1.181.0 (`sha256:81474464…`) | regras oficiais `semgrep/semgrep-rules` no commit `16b9e6d4` (2026-10-21), 388 arquivos: javascript, typescript, ai/*, generic/unicode e html-templates, dockerfile, docker-compose, html/security, bash, insecure-transport/js-node (sem `generic/secrets`: Gitleaks cobre) | `backend/src`, `backend/scripts`, `backend/migrations`, `frontend/src`, `frontend/next.config.ts`, `frontend/public`, `scripts`, `deploy`, `docker`, `compose.yaml`; sem `node_modules`, `dist`, `.next`, `*.test.*`, `testing/` | `--network none`, `--metrics=off` |
| Gitleaks | 8.30.1 (`sha256:c00b6bd0…`) | regras padrão, `--redact=100` | (a) 5.714 arquivos versionados + novos não ignorados; (b) histórico completo `--all` (515 commits) | `--network none` |
| OSV-Scanner | 2.7.0 (`sha256:4f3b7e2c…`) | `--offline-vulnerabilities`; base npm baixada uma vez (GET) e a análise repetida com `--network none` (resultado idêntico) | `backend/package-lock.json` (537 pacotes), `frontend/package-lock.json` (1.099) | nenhuma lista de pacotes enviada |
| Syft | 1.54.1 (`sha256:3eb5379b…`) | `SYFT_CHECK_FOR_APP_UPDATE=false`; CycloneDX + SPDX | `backend/`, `frontend/` (dependências de produção) | `--network none` |
| ZAP | 2.17.0 stable (`sha256:030d3df5…`) | Automation Framework, `-silent` (sem chamadas espontâneas), OpenAPI gerada do inventário de rotas, varredura ativa só no contexto da API local | `http://host.docker.internal:3633` (API) e `:3630` (interface); `/auth/*` e `/data-ingestion/*` excluídos | só o alvo local |
| Nativas | `tsc`, `eslint`, `vitest` do projeto | ambiente limpo (`env -i`), `sandbox-exec` sem rede externa | backend e frontend | — |
| Referências | ASVS 5.0.0 (CSV oficial, sha256 `6124dba1…`), WSTG 4.2 | matriz em `matriz-asvs-5.0.0.md` | — | — |

**Semgrep CE × comercial:** a edição Community analisa fluxo de dados só **dentro de cada função/arquivo**; não segue dado
entre arquivos nem entre funções como o Semgrep Pro. A ausência de alerta de fluxo entre módulos não prova ausência de defeito —
por isso houve revisão contextual e testes dinâmicos.

**Ambiente do pentest local:** API em `NODE_ENV=production`, `--role=api` (sem workers), `CORS_ORIGIN=http://127.0.0.1:3630`,
coleta e painel de usabilidade ligados (mais superfície), segredos aleatórios gerados para o ambiente (arquivo `600` em
`output/…/secrets/`, fora do Git), PostgreSQL 17 em contêiner próprio (`inia-appsec-pg`, 127.0.0.1:55441, 1,5 GB/2 CPUs),
massa `db:seed:demo` (2.373 contas sintéticas, 22.590 atendimentos) + uma 2ª organização criada só para o teste. Interface:
`next build` + `next start` de produção. Desvio: na 2ª passada do ZAP a inatividade da sessão foi desligada para a varredura
autenticada não expirar no meio.

## 3. Resultados das ferramentas

### 3.1 Semgrep — 6.846 resultados, 0 vulnerabilidade confirmada

5.567 são `jsx-not-internationalized` e ~1.100 outros de estilo/portabilidade (qualidade). Os 112 de categoria de segurança
foram lidos um a um:

| Regra (qtde) | Classificação | Motivo |
|---|---|---|
| `tainted-sql-string` (10), `node-mysql-sqli` (2), `node-mssql-sqli` (1) | rejeitado | interpolam só `filter.param()` (placeholder `$n`), números internos ou nomes vindos do catálogo do PostgreSQL |
| `bypass-tls-verification` (2) | endurecimento já registrado (R-08) | modo `NO_VERIFY` escolhido pelo administrador; fontes novas nascem `VERIFY_FULL` |
| `gcm-no-tag-length` (1) | **endurecimento aplicado (APPSEC-05)** | tag truncada era aceita na decifragem |
| `prototype-pollution-loop` (7) | rejeitado | percorrem caminhos para LER valores; nenhuma escrita com chave controlada |
| `direct-response-write` (4) | rejeitado | CSV neutralizado, imagem com tipo do servidor + `CSP default-src 'none'` + `nosniff` |
| `detect-redos` (13), `detect-non-literal-regexp` (32) | não testado / rejeitado | entradas limitadas por tamanho; padrões de constantes internas ou com escape |
| `js-open-redirect-from-function` (1), `react-href-var` (2) | rejeitado | URLs internas montadas pelo servidor |
| `spawn-shell-true` (2), `unsafe-formatstring` (6), `unsafe-dynamic-method` (6) | rejeitado | scripts de instalação com argumentos fixos; logs; despacho por enum validado na publicação |
| `dockerfile-source-not-pinned` (4) | endurecimento | imagens dos bancos de EXEMPLO (só avaliação local) sem digest |
| `ai.generic.detect-*` (139) | inventário | localiza chamadas a provedores de IA (já mapeadas) |

5 arquivos com parse parcial (sintaxe TS recente) — registrados em `raw/semgrep/semgrep.json`.

### 3.2 Gitleaks — 0 credencial real

| Onde | Resultado | Classificação |
|---|---|---|
| Arquivos (1.126 alertas) | 1.125 `generic-api-key` em JSONs de avaliação (`criterionKey`, `runKey`, `analysisKey`…: identificadores e hashes) e senhas de teste em testes/fixtures; 1 `gcp-api-key` | falsos positivos. O `gcp-api-key` é a entrada do teste de redação (`run-workflow-simulation.test.ts:762`), já liberada em `scripts/github/padroes-permitidos.txt`, e **não** é igual a nenhum valor dos `.env` locais (comparação por igualdade, sem imprimir). Não foi testada contra o Google (seria enviar o valor) — recomendação: montar a string no teste em tempo de execução |
| Só no histórico (5) | senhas antigas dos bancos de **exemplo** locais (`6959a93b`, `68af86cc`, 07/10/2026) | nenhum desses valores está em `.env` locais nem no código atual (comparação por igualdade). Hoje vêm de `INIA_EXAMPLES_*` aleatórios. A cópia publicada no GitHub é um snapshot sem histórico (`npm run github:publish`). Se algum ambiente usou os padrões antigos, trocar |

### 3.3 OSV-Scanner — dependências

| Pacote (onde) | Avisos | Em produção? | Caminho vulnerável alcançável? | Classificação |
|---|---|---|---|---|
| `next@16.3.8` (frontend) | GHSA-2464-fhr4-w9xw (RCE, otimização de imagem via `sharp` em Linux glibc), GHSA-673q-mjm6-r5xr (RCE com `use cache` + typed arrays), GHSA-p3m5-59mp-jv5r (DoS com Server Actions); corrigidos em 16.4.1 | sim | não demonstrado: `sharp` já em 0.35.5 (versão corrigida), implantação em Windows, nenhum `"use cache"`, nenhum `"use server"` | **P-03 — atualizado para 16.4.1 em 29/10** (o SCA do Conviso marcaria crítico) |
| `body-parser@2.3.0` (backend, via express) | GHSA-27r3-jxmh-p828 (derruba o processo com corpo comprimido + bytes extras, antes da autenticação) | sim; parser JSON global antes das rotas, `inflate` padrão | caminho alcançável, **crash não reproduzido** (14 variantes) | **P-01 — atualizado para 2.4.0 em 29/10** |
| `zod@4.5.4` (backend) | GHSA-mrhx-c7xc-m3w5 (memória com array grande sem limite) | sim | não testado (seria teste de DoS); corpo limitado a 1 MB e quase todas as rotas exigem sessão | **P-02 — atualizado para 4.6.7 em 29/10** (o `zod 4.4.3` do frontend continua — validação no navegador, recomendação) |
| `multer@2.4.0` | GHSA-q7qp-rjg7-q26m (só com `fileFilter` assíncrono) | sim | não: o único `fileFilter` é síncrono (`inia-scene-router.ts:16`) | rejeitado; mesmo assim atualizado para 2.5.0 em 29/10 |
| `@azure/msal-node@6.0.1` (via `mssql`) | fluxo auth_code | sim | não: conexão SQL Server por usuário/senha | rejeitado |
| `uuid@8.3.2` (via exceljs), `qs@6.16.0` | v3/v5/v6 com buffer; `stringify` com `comma` | sim | não usados | rejeitado (R-14) |
| `vite`, `vitest`, `tinypool`, `@modelcontextprotocol/sdk`, `hono`, `undici`, `brace-expansion`, `fast-uri`, `ip-address`, `deepmerge`, `systeminformation`, `proxy-addr`, `postcss-selector-parser`, `zod@3` (shadcn) | vários | **só desenvolvimento** (`dev: true` no lockfile) | não em execução | rejeitado em runtime. Ressalva: `npm run install:all` instala dependências de desenvolvimento no servidor — recomendação: compilar fora e `npm ci --omit=dev` na implantação |

### 3.4 Syft — SBOM e licenças

`sbom/sbom-{backend,frontend}.{cdx,spdx}.json` (CycloneDX 1.7 e SPDX 2.3, dependências de produção instaladas: 299 pacotes npm no
backend e 385 no frontend). Alertas de **licença** (não são vulnerabilidade): `LGPL-3.0-or-later` (10 pacotes no frontend —
binários `@img/sharp-libvips-*`, ligados dinamicamente), `(MIT OR GPL-3.0-or-later)` (`jszip`, escolher MIT), `Python-2.0`
(`argparse`), `CC-BY-4.0` (`caniuse-lite`, dado de build) e 132 pacotes sem licença declarada no manifesto — revisão jurídica,
em linha com a memória "INIA cedida à Vivo".

### 3.5 Verificações nativas

Ver `registro-de-testes.md` §5 — typecheck, lint e 7.282 testes passaram na cópia isolada (2 ruídos preexistentes registrados).

## 4. Revisão contextual e testes dinâmicos

Revisão guiada pelo ASVS 5.0.0 (matriz em `matriz-asvs-5.0.0.md`: 118 verificados, 15 falharam, 69 não aplicáveis, 143 não
testados) e pelo WSTG 4.2 (ATHN, ATHZ, SESS, INPV, ERRH, CLNT, BUSL). Foco nas unidades que a auditoria Cloudflare deixou
**adiadas** (8) ou **bloqueadas** (1) e no código novo não commitado, com três leitores independentes de código (só leitura) e
validação própria de cada candidato. Os testes dinâmicos estão em `registro-de-testes.md`.

### 4.1 Achados confirmados

**APPSEC-01 — Simulação de política de acompanhamento expõe o tipo exato de afastamento (INSS, maternidade, paternidade) de líderes — MÉDIA — CORRIGIDO E RETESTADO**
- Onde: `backend/src/modules/interventions/application/condition-resolvers.ts` (`resolveEmployment`, e os fatos de `resolveIndicator` com `...evaluation`), exposto por `POST /api/v1/admin/intervention-policies/policies/:id/simulate` (`intervention-admin-router.ts:243`) e pela justificativa da avaliação (`policy-evaluation.ts`), que também vira texto do nó de Workflow.
- Pré-condições: conta com `intervention_policies.simulate` (ex.: papel `GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO`) ou `workflows.manage`, uma política visível e alcance sobre a pessoa (`canSimulateWith` aceita líderes da subárvore). Não exige `people.manage`.
- Caminho: `body.personId` → `canSimulateWith` → `evaluatePolicy` → `resolveEmployeeStatusAt` → `facts.status`/`summary` "não elegível (INSS)" e `eligibility.excludedByStatus` → resposta 200.
- Evidência (dinâmica, ambiente local): Gerente com o papel de políticas, 403 em `/admin/users` e 403 na ficha da supervisora, recebeu `"Situação funcional em 2026-10-29: não elegível (INSS)"` e `{"INSS": 29}` da **supervisora** subordinada (período sintético). Contraria a decisão do C14 (R-37): o afastamento sensível de líder nunca se separa.
- Impacto observado: leitura de dado sensível de saúde (LGPD art. 11) por quem não tem `people.manage`. Potencial: histórico variando `asOf`; o mesmo texto ia para Saídas de Workflow (B2).
- Severidade: média (dado sensível; exige papel administrativo de políticas e alcance sobre a pessoa). Sem CVSS calculado.
- Correção: todos os fatos que saem do resolvedor de condições passam por `protectLeave` (tipo sensível → `AFASTAMENTO_PROTEGIDO`, contagens somadas) e o resumo diz "afastamento — motivo protegido". A decisão (elegível ou não) não muda. Avaliações já gravadas antes da correção mantêm o texto antigo.
- Reteste: mesma chamada → nenhuma ocorrência de INSS/MATERNIDADE/PATERNIDADE; teste novo `condition-resolvers-employment.test.ts` (6 casos).

**APPSEC-02 — Carga de Estrutura organizacional muda Grupo e gestor de conta pré-cadastrada sem custódia e desarma a correção do C09 — MÉDIA — CORRIGIDO (`4859d40f` + `77c5adcd`, outra sessão) E RETESTADO**

- Situação final (29/10 16:05): `77c5adcd` passou a marcar a custódia pendente na PRIMEIRA aplicação da base a quem foi cadastrado à mão — por Colaboradores ou por Estrutura, inclusive quando a pessoa só aparece como gestora (`markFirstApplicationCustody`). Reteste com a prova independente desta rodada sobre esse código: 3/3 (nos dois cenários a conta é desativada, `session_version` 0→1); `source-custody-proof` 10/10 (`raw/dynamic/cn1-proof-after-77c5adcd.txt`).
- Histórico — situação em 29/10 15:50: é o item h19 da auditoria Cloudflare. A sessão daquela auditoria commitou `4859d40f` (migration 163 `pending_custody_*`, `enforceSourceCustody`, revogação da senha temporária não usada; prova `source-custody-proof`, 6 cenários). Reteste com a prova independente desta rodada sobre esse código (`raw/dynamic/cn1-proof-after-fix.txt`): as 6 provas de lá passam, mas **os 2 cenários daqui continuam falhando** — (1) pré-cadastro manual com senha já trocada que nenhuma carga de Colaboradores tocou: a Estrutura é a 1ª carga, `pending_custody` não foi marcado (só o writer de Colaboradores marca) e a revogação só alcança senha temporária não usada → conta ativa, `canOpenEmployeeProfile` verdadeiro; (2) Estrutura que muda só o gestor grava linhagem e a promoção seguinte por Colaboradores não desativa a conta. Reportado à sessão dona com a prova; não alterado aqui. O C-N3 (revalidar em toda promoção) foi descartado pelo usuário, segundo aquela sessão.
- Onde: `backend/src/modules/data-hub/application/writers/master-data-writers.ts` (`organizationalStructureWriter.apply`, ~l. 491–507: `update people set reports_to_id, team_id, subteam_id` sem checar conta) e `person-identity.ts` (`preRegisteredByMatricula` exclui quem já tem qualquer linhagem `people`).
- Pré-condições (as do C09): ADMINISTRADOR de Grupo A pré-cadastra com conta a matrícula futura que a base vai enviar; existe feed `ORGANIZATIONAL_STRUCTURE` ativo. A carga é disparada por `data_hub.manage` (organização), push do cliente ou agenda — não pelo atacante.
- Evidência (prova de banco no PostgreSQL descartável, `anexos/prova-c-n1-estrutura-custodia.test.ts.txt`): controle — Colaboradores põe a conta pré-cadastrada como Supervisora do Grupo B → conta desativada (C09 funciona). Com a carga de Estrutura: a conta é movida ao Grupo B, um operador do Grupo B passa a reportar a ela, a conta segue **ativa** com a mesma `session_version` e `canOpenEmployeeProfile` = verdadeiro (ficha, planos, monitorias). Depois de uma Estrutura que muda o gestor, a promoção posterior por Colaboradores **também** não desativa a conta.
- Impacto: credencial sob custódia de admin do Grupo A lê fichas e indicadores do Grupo B; a correção do C09 deixa de valer para essa pessoa.
- Correção proposta (não aplicada — é a lógica de custódia que a sessão da auditoria Cloudflare acabou de escrever para o C09; aplicar aqui arriscaria conflito com a execução em andamento): passo comum de custódia chamado também em `organizationalStructureWriter.apply` antes do `update` para quem tem conta ativa sem custódia verificada e (a) muda de Grupo ou (b) passa a ter subordinados; e um marcador explícito de "custódia verificada" no lugar de "tem linhagem". A prova anexa vira o teste de regressão. Achado irmão C-N2 (subordinados que passam a apontar para a matrícula numa carga de Colaboradores) entra na mesma correção.

**APPSEC-03 — `/realtime/tool-call` aceita id de conversa de TREINO e grava nela consultas de liderança, que somem da monitoria — BAIXA — ABERTO**
- Onde: `realtime-router.ts` (~l. 855–925 e 711–727), `assistant-conversation.ts:77`, `conversation-monitoring.ts:42` — **código não commitado** da frente "Treino com a INIA" (abas ocultas, marcada "não usar por enquanto"), mas as rotas estão montadas no backend sem interruptor.
- Evidência: análise de código (revisão C, conferida); sem prova dinâmica.
- Correção proposta: recusar com 409 quando a conversa indicada for de origem treino; desmontar as rotas de treino enquanto a frente estiver suspensa. Não aplicada por ser trabalho em andamento do usuário.

**APPSEC-04 — Remoção de metadados de imagem falhava aberta com JPEG que a validação aceita — BAIXA — CORRIGIDO E RETESTADO**
- Onde: `backend/src/shared/infrastructure/image-metadata.ts` (`stripJpeg`) × `profile-preferences/domain/profile-image.ts` (`jpegSize`).
- Evidência (teste): JPEG com marcador RST/TEM antes do SOF passava na validação e voltava inteiro, com EXIF/GPS/XMP — falha observada no código anterior (`raw/dynamic/image-metadata-before-fix.txt`).
- Impacto: GPS e aparelho da foto de perfil/cenário expostos à organização (controle de privacidade AUTH-11 contornado; quem envia é o próprio dono da foto).
- Correção: o removedor trata os mesmos marcadores sem tamanho que a validação. Mantida a política "estrutura desconhecida volta igual" (ver endurecimento).

**APPSEC-05 — AES-GCM aceitava tag de autenticação truncada — ENDURECIMENTO (exige escrita no banco) — CORRIGIDO E RETESTADO**
- Onde: `backend/src/modules/data-hub/infrastructure/aes-secret-store.ts`. Achado do Semgrep (`gcm-no-tag-length`).
- Evidência (teste): no código anterior, tags de 4 e 12 bytes decifravam. Com `authTagLength: 16`, são recusadas.
- Nota: o arquivo foi alterado hoje pela sessão Cloudflare (N01, `1ea944cf`); a mudança desta rodada é pequena e está por cima, sem commit.

### 4.2 Pendentes de validação

| Id | Hipótese | Falta | Próximo passo |
|---|---|---|---|
| P-01 | `body-parser` 2.3.0 derruba a API antes da autenticação | reproduzir o gatilho (14 variantes não derrubaram em Node 24.18.1) | **atualizado** para 2.4.0 (29/10) — sai do inventário |
| P-02 | `zod` 4.5.4 consome memória com array grande | teste de recurso (fora das regras desta rodada) | **atualizado** para 4.6.7 (29/10) — sai do inventário |
| P-03 | `next` 16.3.8 — RCE/DoS publicados | caminho não usado aqui; o SCA vai marcar | **atualizado** para 16.4.1 (29/10) — sai do inventário |
| P-04 | Prévia DOCX roda o `mammoth` a cada leitura, sem cache nem limite por conta (`knowledge-material-router.ts:46-64`) — ~300 KB podem virar até 300 MB descompactados | teste de memória (não-DoS) | gerar a prévia uma vez por sha256 ou em processo filho com limite |
| P-05 | Upload da Central de Dados lê o XLSX/CSV inteiro dentro do request só para mostrar 20 linhas | idem | leitura em streaming com parada no limite |
| P-06 | C-N3: custódia só é avaliada na 1ª aplicação da base; promoções seguintes não revalidam | — | **descartado pelo usuário** (segundo a sessão da auditoria Cloudflare): atrapalharia transferências de quem já usa a própria senha — risco aceito, registrar no `pendencias-e-riscos.md` |
| P-07 | `GET /reports/proposals/:id` altera estado (nota da auditoria Cloudflare) | revalidar | trocar para POST |

### 4.3 Rejeitados (com motivo)

- Enumeração de contas pelo tempo do login (ATHN-01/04): diferença vinha do custo bcrypt das contas criadas no teste; com o custo da aplicação, 68 × 64 ms.
- Escalonamento do operador por `/admin/access` (S2/S2b): validação antes da permissão, mas com corpo válido → 403; nada gravado.
- Acesso entre organizações (S3/S4): nenhum dado da org A pela admin geral da org B em 37 rotas de detalhe e 133 listas.
- Desvio da trava de ZIP (N04): corrigido em `1ea944cf`; revisão ponto a ponto contra o JSZip sem desvio novo.
- CSPT do SPA levando a escrita (A5): escritas usam o id devolvido pelo servidor (fica o endurecimento do `encodeURIComponent`).
- Fuga do somente-leitura do "Testar diagnóstico" (A7): o administrador não escreve SQL; campos entram como parâmetro/enum.
- Alertas do Semgrep e do OSV listados em §3.1 e §3.3 como rejeitados.

### 4.4 Recomendações de endurecimento (sem exploração demonstrada)

1. **MFA ou SSO corporativo** (ASVS V6.3.3 — principal lacuna de autenticação para uma avaliação corporativa).
2. JWT do cookie carrega nome, e-mail, cargo, foto e Grupo (SESS-02): reduzir a `sub`, `organizationId`, `sv`, `jti`, `exp`.
3. HSTS também nas páginas (IIS), sem `includeSubDomains` até confirmar o domínio; CSP com `report-to`; R-07 (`style-src 'unsafe-inline'`).
4. Lista de senhas vazadas local (top-10k) e mínimo maior para administradores (R-22); lista de sessões ativas com encerramento individual (V7.5.2).
5. Cofre de segredos no servidor da Vivo (DPAPI/Key Vault) para `JWT_SECRET` e `DATA_HUB_SECRET_KEY` (V13.3.1).
6. Antivírus nos uploads (bases e Central de Dados) conforme o padrão da Vivo (V5.4.3).
7. Política de prazos de correção de dependências por gravidade (V15.1.1) e implantação com `npm ci --omit=dev`.
8. `encodeURIComponent` nos ids interpolados no frontend (A5); `BEGIN READ ONLY` real no "Testar diagnóstico" e mensagem de erro genérica (A7); `stripImageMetadata` recusar estrutura desconhecida em vez de devolver igual.
9. Revisão B3/B6/B7: destinatário/revisor fixo de Workflow conferido contra o escopo (não só a organização); dependências de domínio de negócio listam Agents de outros Grupos; leituras pesadas sem limite por conta (`/leadership/query`, export do diagnóstico).
10. String no formato de chave Google no teste de redação: montar em tempo de execução.

### 4.5 ZAP

- 1ª passada: efetivamente **sem sessão** (ver `registro-de-testes.md` §4) — 528.930 requisições, 0 respostas 5xx, 0 alerta na API; 3 alertas na interface (CSP `style-src unsafe-inline` — R-07; `Big Redirect` baixo; informativo).
- 2ª passada (autenticada, sessão válida do início ao fim): 532.737 requisições, 168.133 aceitas, 164 rotas atingidas. Alertas: "Spring4Shell" (alto, **falso positivo** — não há Java/Spring), "XSS persistente em resposta JSON" (baixo, rejeitado: JSON com `nosniff`, renderizado como texto). Nenhum alerta de injeção, XSS refletido, SSRF ou travessia de caminho.
- 632 respostas 5xx, todas genéricas (sem stack), em três causas de **qualidade/robustez**: Q-01 nome repetido em `POST /admin/org-structure/subjects` vira 500 em vez de 409; Q-02 byte NUL em parâmetro chega ao PostgreSQL e vira 500 em vez de 400 (consulta parametrizada — não é injeção); Q-03 `POST /admin/knowledge` sem corpo esperado lê `request.body.title` antes da validação. Recomendação: no tratador de erros, mapear `23505` → 409 e `22021`/`22P02` → 400, e recusar `\u0000` na validação de entrada (o tratador fica em `backend/src/main/app.ts`, que tem mudanças não commitadas de outra frente — não alterado aqui).
- Limitação: corpos das escritas foram fuzzados a partir de um JSON genérico (`name`/`description`/`text`); campos específicos de cada rota só foram exercitados nos testes direcionados. Interface: varredura passiva (spider tradicional), sem spider AJAX.

## 5. Mudanças no código (sem commit)

| Arquivo | Mudança | Achado |
|---|---|---|
| `backend/src/modules/interventions/application/condition-resolvers.ts` | `protectLeave` nos fatos de toda condição; resumo com "motivo protegido" | APPSEC-01 |
| `backend/src/modules/interventions/application/condition-resolvers-employment.test.ts` (novo) | 6 casos de regressão | APPSEC-01 |
| `backend/src/shared/infrastructure/image-metadata.ts` + `.test.ts` | marcadores sem tamanho no JPEG + caso de regressão | APPSEC-04 |
| `backend/src/modules/data-hub/infrastructure/aes-secret-store.ts` + `.test.ts` | `authTagLength: 16` + caso de regressão | APPSEC-05 |
| `backend/package.json` + lock (`body-parser 2.4.0`, `qs 6.16.1`, `zod 4.6.7`, `multer 2.5.0`), `frontend/package.json` + lock (`next`/`eslint-config-next ~16.4.1`) | atualizações de dependência pedidas depois da 1ª entrega; árvore real verificada (5.246 + 2.049 testes, tipos, lint, build, assinaturas); OSV: 80 → 73 itens | P-01…P-03 |
| `scripts/security/varredura-appsec.mjs` (novo), `scripts/security/appsec-baseline.json` (novo), `package.json` (`security:scan`) | varredura reproduzível com linha de base (Semgrep 90, Gitleaks 1.964, OSV 73 depois das atualizações) | prevenção |
| `docs/security/appsec-2026-10-29/` (novo), uma linha em `docs/security/README.md`, um parágrafo em `docs/dev/memoria/seguranca.md` | estes relatórios, matriz, SBOM, anexos; índice e memória da área | entrega |

Verificações: testes afetados, `tsc --noEmit` e `eslint` do backend OK (detalhe em `registro-de-testes.md` §5). Atenção: cada
gravação em `backend/src` reinicia o backend de desenvolvimento de outra sessão (`tsx watch`, :3333) — as edições foram
agrupadas.
