# Segurança — controles transversais e decisões (auditorias de 08/10/2026 e 17/10/2026; liberação na Vivo em 20/10/2026)

Documentação completa em [docs/security/](../../security/README.md): mapa de superfícies, relatório de achados (SEC-01…34),
configuração segura e pendências (R-01…18). Aqui ficam só as decisões que qualquer sessão precisa respeitar ao mexer no código.

## Regras

- **Organização e escopo sempre do servidor**: organização da sessão (`request.user.organizationId`); escopo por
  `getManageableScopes`/`loadViewerScope`; nunca ids, papel ou escopo vindos do corpo. Fora do escopo = 404 (não revela
  existência). O guard de rota (`requirePermission`) só diz "tem a permissão em algum escopo" — o recurso concreto é checado no
  módulo.
- **Catálogo que vale para a organização inteira** (domínios, flags, calendário operacional, governança, definições/glossário de
  indicadores, assuntos, Central de Dados): escrita só com escopo de organização (`writesRequireOrganization` ou
  `coversOrganization`). Um recurso novo desse tipo nasce com essa regra. A LEITURA fica aberta a quem tem a permissão em
  qualquer escopo, então o que ela devolve sobre recursos de Grupo (Agents, Orquestradores, Workflows) segue o escopo de quem
  consulta: as dependências de um domínio de negócio e de uma definição de indicador mostram pelo nome só o que a pessoa
  administra (`agents.manage`/`workflows.manage` no escopo do item, a regra das listas) e contam o resto (`…OutOfScope`); a
  trava de código/exclusão (escrita da organização inteira) continua vendo tudo (lote 2 da 4ª auditoria).
- **Nível hierárquico (`people.role`)**: o guard de sessão relê o valor a cada request (o do JWT é só a foto do login). Definir ou
  mudar um nível de liderança exige `people.manage` de organização. Mudança de credencial (e-mail de login, inativar) passa pela
  custódia (`assertCredentialChangeAllowed`), que exige alcançar também a estrutura liderada pelo alvo.
- **Sessão**: JWT HS256 com `jti`; logout grava em `auth_revoked_sessions` (migration 123); pessoa inativa no cadastro = sem
  sessão. Testes que fazem muitos logins no mesmo app usam `createApp(db, { rateLimits: false })`.
- **CSRF**: toda escrita com cookie precisa de `Origin` em `CORS_ORIGIN` (`origin-guard.ts`). Cliente fora do navegador (sem
  `Origin`/`Sec-Fetch-Site`) passa — testes com supertest não são afetados.
- **Saída para a rede**: todo transporte que conecta a um destino configurado na tela usa a política de destinos
  (`outbound-destination-policy.ts`): Central de Dados (HTTP, SFTP, bancos) e `guardedFetch` dos adapters de IA. Redes privadas
  ficam liberadas (requisito); metadados, link-local, banco interno e, em produção, loopback não. Um conector novo usa a mesma
  política. Credencial guardada é vinculada ao destino (`secretTargetOf`): mudou o destino, pede a senha de novo — e a troca do
  destino, a da credencial e a auditoria vão num commit só (`updateSource` e `updateConnection` da IA; `SecretStore.put/revoke` com
  `{ db }` gravam na transação de quem chama — N01 da 4ª auditoria, provas `source-rebind-proof` e `ai-providers-proof`).
- **Central de Dados — configurar exige a senha da fonte**: a guardada é só para as cargas. Sem liberação (pessoa + fonte + sessão, 30 minutos), rota de configuração responde 403 sem conectar. Toda rota do router é classificada (`DATA_HUB_FREE_ROUTES` ou `configGuard`); sem classificação, nasce bloqueada e reprova o teste. Credencial nova só grava depois de conectar de verdade. Conteúdo bruto só abre pela fonte dele. Registro em `audit_logs` nunca leva senha, token, cabeçalho ou dado do cliente. Detalhes em `central-de-dados-e-instalacao.md`.
- **Persona e instruções de IA são do servidor**: o navegador manda no máximo dado de contexto delimitado (`contextHint`). Saída de
  modelo nunca vira HTML cru, SQL ou ação privilegiada.
- **Arquivos**: tipo decidido pelo servidor, download sempre `attachment` com `sandbox`; ZIP (XLSX/DOCX) passa pela
  `zip-guard.ts` antes do parser — assíncrona desde 19/10/2026: confere o tamanho real de cada entrada EM FLUXO, só contando bytes
  (nunca voltar ao `inflateRawSync`, que guardava a entrada inteira — até 300 MB — e travava o laço); também exige o pacote lido do MESMO jeito pelo JSZip dos parsers (fim do diretório coerente,
  sem registro a mais, sem vão nem ZIP64, sem nome repetido; N04 da 4ª auditoria); CSV exportado neutraliza fórmula.
- **Parser de arquivo de usuário fora do processo da API** (R-24, 18/10/2026): pdf-parse, pdf.js (layout e imagens do PDF), mammoth e exceljs só rodam no processo
  filho de `shared/infrastructure/isolated-parser/` (jobs `knowledge/infrastructure/document-parser-job.ts`, chamado por
  `parseDocumentIsolated`, e `data-hub/infrastructure/xlsx-parser-job.ts`, chamado por `parseExcel`); nunca importar esses parsers
  num módulo da API ou da carga (só em teste, como oráculo). O teto que vale é o da memória RESIDENTE (o pdf.js descompacta fora do
  heap — `--max-old-space-size` sozinho não segura: 2,4 GB com heap de 256 MB). Parser novo de arquivo enviado usa o mesmo caminho
  (um módulo com `run(input, emit)` + `siblingModule`; resultado grande sai em partes por `emit`, recebidas no `onChunk`), com teto
  MEDIDO para a carga legítima: o XLSX tem pool próprio (1 filho por processo, fila de 4) e heap 1.536/residente 2.048 MB/60 s —
  heap abaixo da residente de propósito (com os dois iguais o GC deixa a residente subir e 380 mil linhas deixam de passar; o V8 às
  vezes aborta o filho no teto de heap, o que chega como CRASHED, também recusado). Fila cheia vira erro TRANSITÓRIO
  (`DATA_FILE_READER_BUSY`, 503 no upload/amostra). A guarda de ZIP continua ANTES, no processo que recebe o arquivo.
- **CSP da interface com nonce**: `frontend/src/proxy.ts` monta a política a cada requisição em TODAS as páginas
  (`lib/security/content-security-policy.ts` — origem nova de API/provedor entra lá) e o `RootLayout` lê `x-nonce`, o que deixa
  todas as rotas dinâmicas: nunca reintroduzir página estática nem `export const dynamic = "force-static"`. Script inline novo só
  com o nonce (`(await headers()).get("x-nonce")`); nada de `<script>` montado a partir de dado. Produção não tem
  `'unsafe-eval'`: biblioteca que use `eval`/`new Function` quebra ou gera violação (o Zod roda `jitless` por isso,
  `lib/security/zod-without-eval.ts`). Para conferir no navegador, o console não mostra violação de `eval` — use um `report-uri`
  de teste (ver `docs/security/configuracao-segura.md` §2).
  Estilos (R-07 isolado em 29/10/2026): `<style>` só com o nonce ou por hash; `'unsafe-inline'` só em `style-src-attr`. Componente
  que escreve `<style>` lê o nonce por `useCspNonce()` (`lib/security/csp-nonce.tsx`; Radix pelo `get-nonce`); CSS fixo de
  biblioteca que não aceita nonce entra por hash em `content-security-policy.ts` com teste que recalcula do pacote instalado
  (`sonner`, 404 do Next). No navegador vale o nonce do DOCUMENTO (`pinDocumentNonce`): `router.refresh()` traz um nonce novo que a
  página não conhece. Conferir tela nova no build de produção (`next dev` fica RELAXED): `<style>` sem `.sheet` = bloqueado; o
  console diz "The action has been blocked", não "Refused". `INIA_CSP_STYLES` = STRICT | REPORT_ONLY | RELAXED, lida na subida.
- **Cancelar registros da Central** (06/11/2026): permissão própria, fora da sessão somente leitura; alcance só por chaves ou filtro validados, sempre com a organização da sessão; a tabela vem do catálogo; confirmação trava as linhas e recusa se a quantidade mudou; motivo fora de `audit_logs` e de log. Ver `docs/dev/central-de-dados-consulta.md`.
- **Consulta de dados da Central** (06/11/2026): lista permitida em código, valores só como parâmetro, transação `READ ONLY` com os limites dentro dela e vagas por trava consultiva. Rota nova de leitura ampla de dados entra nessa estrutura, nunca em SQL montado com texto do cliente. SQL livre não existe: exigiria credencial exclusiva, que a instalação não garante. Ver [central-de-dados-consulta.md](../central-de-dados-consulta.md).
- **Limites**: `rate-limit.ts` (loja do PostgreSQL no servidor real, memória nos testes). Ação nova que chama IA ou conecta a
  destino externo entra no `costly(...)` ou no teto por conta de `app.ts`. Matcher por caminho SEMPRE com `routePath(request)`
  (minúsculas, sem barra final) — o Express casa `/x/TEST` e `/x/test/` na rota de `/x/test`. Regra "só falhas" reserva a vaga e
  devolve no sucesso (`release`).
  Leitura pesada sem IA no meio (consulta flexível e ferramentas da liderança fora do chat, exportação do diagnóstico) divide o
  balde `heavyReads` por conta (20/min); o chat já passa pelo teto da IA. Prévia de arquivo monta só as linhas que mostra
  (`scanCsv` com `keep`; no XLSX, largura e total contados linha a linha) — o total continua exato (4ª auditoria).
- **Simulação só leitura**: `createReadOnlyDatabase` barra pela lista de comandos (só o começo do SQL); quem roda com permissão em
  qualquer escopo (o "Testar diagnóstico") usa também `enforcedByDatabase` — cada leitura numa transação `read only` curta, o
  PostgreSQL recusa função que grava ou `nextval`. Nunca abrir uma transação longa em volta da simulação (chamadas de IA no meio
  esbarram no `idle_in_transaction_session_timeout`). O QA Lab (só organização inteira) segue só com a lista.
- **Leitura de conversa pela dona**: quem lê mensagens para decidir algo (esclarecimento pelas bases) passa `ownerPersonId` ao
  `loadMessages` — conversa de outra pessoa volta vazia na mesma consulta, sem ida a mais ao banco.
- **Login** (2ª rodada): tentativa reservada como falha ANTES do bcrypt (`reserveAttempt/resolveAttempt`) — nunca voltar a
  "conferir → bcrypt → gravar"; fila do bcrypt com teto (`PASSWORD_QUEUE_LIMIT`, 503 `AUTH_BUSY`); cookie `inia_device` (dispositivo
  conhecido) passa pela trava do e-mail com trava própria; senha previsível recusada (`COMMON_PASSWORD`, lista espelhada no
  frontend); senha provisória SEMPRE gerada pelo servidor, inclusive no cadastro de pessoa.
- **Central de Dados → contas**: desligamento pela base desabilita a conta (Administrador geral: só sessões); vínculo por e-mail que
  muda Grupo/nível desabilita a credencial (`disableAccountsFromSource`). Fonte de banco NOVA nasce em `VERIFY_FULL`; MySQL valida
  com `verifyIdentity`; `secretTargetOf` inclui CA e chave SFTP. Glob de arquivo sem regex (`matchesGlob`). Teto de 200 MB por carga
  da API Pull. Arquivo ZIP/PDF: guarda mede o conteúdo REAL (`zip-guard.ts`, `pdf-guard.ts`) — nunca confiar no tamanho declarado.
- **Texto de IA** (2ª rodada): evidência de feedback de Orquestrador só com citação conferida dos especialistas
  (`evidenceVerified` no `context_snapshot`; `false` não conta nas políticas); `isVerbatimEvidence` exige ≥ 12 caracteres e duas
  palavras; ferramentas do modelo com teto por rodada (6) e turno (12); links externos só de `NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS`;
  célula de tabela Markdown com dado de integração escapa `[ ] \` * _ < >`.
- **Leitura de dados de outra pessoa** (2ª rodada): monitorar conversas não amplia acesso a DADOS (cartões revalidados pelo escopo
  de quem lê); simular política sem ver as intervenções da pessoa = histórico oculto; caso de supervisão não repete tipo/motivo da
  intervenção; tipo de afastamento sensível só separado para OPERADORES e quando não aponta ninguém (`sensitiveBreakdownAllowed` sobre os
  operadores do recorte; o de líder sempre somado como motivo protegido — `leaveTypeVisible`, C14 da 4ª auditoria —, no organograma, na consulta de
  força de trabalho e nos reports dela — as telas por pessoa da liderança da cadeia mostram o tipo exato de operadores por decisão de produto de
  29/10/2026, R-37); Agent só usa base
  compatível com o alcance a CADA busca.
- **Imagens**: tudo que a organização inteira vê (foto/capa do perfil, cenário) passa por `stripImageMetadata` antes de gravar.
- **Sessão — 3ª rodada (20/10)**: inatividade pelo SERVIDOR (`auth_session_activity`, migration 149; `SESSION_IDLE_TIMEOUT_MINUTES`,
  padrão 30): GET não renova, escrita e `POST /auth/activity` renovam (no máximo 1×/min). Leitura automática da tela (sino,
  avisos, polling) nunca pode chamar `/auth/activity` — senão a sessão nunca expira. Voz renova pelo `signalUserActivity`. Cookie
  `__Host-inia_session` quando `SESSION_COOKIE_SECURE` (ler sempre por `readSessionCookie`/`SESSION_COOKIE_NAME`, nunca o nome
  literal). HMAC fora da assinatura da sessão só com `derivedKey(<rótulo>)` (HKDF) — rótulo novo para cada uso.
- **Transcrição para a IA**: toda leitura de transcrição que vai a um modelo passa por `transcriptForModel` /
  `loadLatestTranscriptForModel` (`workflows/application/transcript.ts`, `SUBJECT_PII_MASK_V2` desde 21/10/2026), e a conferência
  literal da evidência usa o MESMO texto mascarado. V2 = formato preservado (`maskPreservingFormat`, `peer-privacy-projection.ts`):
  e-mail, CPF pontuado e protocolo viram marcadores; telefone mantém DDD + 1º dígito ("11-9••••-••••"); outro número longo mantém os
  3 primeiros dígitos e a quantidade ("123•••••••"); valor em R$ fica. Aprovado pelo usuário para os indícios de produto (prefixo de
  conta, fixo × móvel); vale também para o que colaborador e liderança veem nas citações. Transcrição de COLEGA segue com a projeção
  de pares (marcadores). Loader novo de transcrição para modelo que leia `transcripts.content` direto é bug.
  `INIA_MODEL_PII_MASKING=OFF` só com decisão do DPO.
- **Segredos cifrados**: grava sempre na v2 (`encryptBoundSecret`, AAD = loja + organização + dono + propósito); leitura por
  `decryptStoredSecret` (chave atual, depois `DATA_HUB_SECRET_KEY_PREVIOUS`). Tabela nova de segredo entra no
  `recifrar-segredos.ts`. Nunca rodar `secrets:rotate --aplicar` no `inia` compartilhado enquanto worktrees com código antigo
  (que não lê v2) usam o banco.
- **Leitura de dado pessoal de outra pessoa** (transcrição, conversa com a INIA, ficha): rota nova grava em
  `personal_data_access_log` (`recordPersonalDataAccess`, migration 151; quem vê = o próprio titular não grava).
- **API Push**: token conferido ANTES do `express.json` (validade, `allowed_networks`, balde por token); Idempotency-Key compara o
  SHA-256 do corpo (422 `DATA_PUSH_IDEMPOTENCY_CONFLICT`). `DataRunError` que escapa para uma rota vira 422/502 no `errorHandler`.

## Estado

- 3ª rodada (20/10/2026, liberação de IA na Vivo — backlog `docs/dev/liberacao-ia-vivo.md`): migrations 149–152 aplicadas em
  `inia` e `inia_test`, sem commit até a data. Novos: papel `REVISOR_DE_CONTESTACOES` (+ Administrador geral) e permissões
  `feedback_contestations.review` / `privacy.subject_data.export`; plano de incidentes em
  `docs/security/plano-de-resposta-a-incidentes.md`; riscos R-34…R-36. Prova do banco fora do ar com Docker:
  `INIA_DOCKER_PROOF=1 npx vitest run database-outage-proof`. `secrets:rotate --aplicar` NÃO foi rodado no `inia` (outras worktrees).
- R-24 (18/10/2026): PDF/DOCX da Base de Conhecimento e prévia DOCX em processo filho (heap 512 MB, residente 768 MB, 30 s, 2
  simultâneos + fila de 8); XLSX da Central de Dados também (heap 1.536 MB, residente 2.048 MB, 60 s, 1 + fila de 4; linhas em
  lotes de 2 mil; ~350 mil linhas × 10 colunas no máximo). Falta ver o filho rodando no serviço do Windows (homologação; para o
  XLSX, `INIA_XLSX_PROOF=1 npx vitest run xlsx-limits-proof`). Guarda de ZIP em fluxo desde 19/10 (+~70 MB e laço livre na
  planilha de 820 mil linhas, antes +0,5 GB e 270 ms travados). Resíduo anotado no R-24: leitor em fluxo do exceljs medido mas
  não adotado (lê diferente). Achado antigo, não corrigido:
  fórmula sem valor guardado no arquivo entra como o texto "[object Object]" (o `cellToValue` só trata `result` presente).

- 2ª rodada (17/10/2026): 46 itens (14 médios, nenhum crítico ou alto), sem migration; pendências R-19…R-33 e R-05 ampliado (AUTH-5, decisão de produto) em
  `docs/security/pendencias-e-riscos.md`. Instalação Windows (`-ContaServico`, ACL dos `.env`) escrita sem Windows para validar.

- Migration `123_auth_session_revocations.sql` aplicada em `inia` e `inia_test` (08/10/2026); `inia_test` também tem 121/122 do
  branch `claude/ai-limiter-worker-split`.
- Dependências fixadas: `next ~16.4.1` (29/10/2026, avisos GHSA-2464/673q/p3m5 da 16.3.8), `multer ^2.5.0`, `zod ^4.6.7` (backend), `body-parser` 2.4.0 e `qs` 6.16.1 no lock (o `npm update` puxava `qs` de um dia); `proxy-addr` 2.0.8, `sharp` 0.35.5 no lock.
- Preparação AppSec (29/10/2026, `docs/security/appsec-2026-10-29/`): avaliação de política nunca expõe o tipo do afastamento
  sensível (`protectLeave` em `interventions/application/condition-resolvers.ts`, APPSEC-01); o removedor de metadados JPEG trata
  os mesmos marcadores sem tamanho que a validação (APPSEC-04); GCM com `authTagLength: 16` (APPSEC-05). APPSEC-02 = h19 da
  4ª rodada: custódia pendente (migration 163) em `4859d40f` e, para a Estrutura como 1ª carga, `77c5adcd` — a prova independente
  (`anexos/`) passa 3/3; C-N3 (revalidar em toda promoção) descartado pelo usuário. N03 (backup) em `a36909d9`. Atualizações
  `next 16.4.1`, `body-parser 2.4.0`, `zod 4.6.7`, `multer 2.5.0` aplicadas em 29/10 (árvore verificada). Aberto: APPSEC-03
  (treino); MFA/SSO adiado (decisão da INIA). Ajustes rápidos: `zod` do frontend 4.6.7; `describeClientError` com
  `22021`/`22P05` → 400 e `23505` → 409; nome repetido de assunto/Subgrupo → 409; `.gitleaks.toml` (exclusões só da regra genérica);
  prazos de dependências em `docs/security/politica-de-dependencias.md`; HSTS das páginas já vinha do `next.config.ts` em HTTPS. `npm run security:scan` = Semgrep/Gitleaks/OSV/Syft
  em contêiner fixado por digest, barrando só achado novo em relação a `scripts/security/appsec-baseline.json`.
- Pendências principais: organização fixa em ~30 arquivos (R-01), voz Live sem `setup` travado (R-04), CSP com `style`
  em atributo (R-07, isolado em 29/10), limitador por processo (R-02), manuais 003/004 desatualizados sobre HTTP (R-11).

### Conferência das respostas (2026-11-04, PEN-017)

Controle sobre o conteúdo, além da instrução à IA. Prevenção no chat, na voz pelo servidor, em Agents e em Orquestradores; só detecção na fala do modelo de voz, cuja transcrição vem do navegador e pode ser omitida por um cliente adulterado. Detalhes em [docs/dev/conferencia-das-respostas.md](../conferencia-das-respostas.md).

### Triagem da varredura de 07/11/2026 (merge das branches pendentes)

`npm run security:scan` depois do merge trouxe 9 itens novos. **Um era real e foi corrigido:** `workflows/domain/draft-graph.ts` devolvia o branco do rascunho andando por herança; um corpo com `"__proto__": {"toString": ""}` (o JSON.parse cria a chave como própria e o schema a remove) trocava `Object.prototype.toString` do processo da API — quem salva Workflow derrubava a API. Agora o caminho anda só por chaves próprias (`Object.hasOwn`) e o campo tolerado também é conferido assim; prova em `draft-graph.test.ts`. Veio em f6296e19 (04/11/2026) e não chegou à versão publicada (e0fccf4). A wiki `banco-do-cliente` trocava só a primeira quebra de linha (`replaceAll`). Os demais entraram na linha de base como falso positivo: `data-hub-router.ts` (texto de auditoria em JSON, não HTML), `response-compliance.ts` (marcação do prompt, com o conteúdo neutralizado), `docx-preview.ts` (HTML do mammoth que a tela passa por `sanitizeDocumentHtml`), o laço de `draft-graph.ts` (já guardado por `Object.hasOwn`), as quatro chaves de cenário de `scripts/dev/recognition-validation.ts` que o Gitleaks lê como chave de API e o `minimatch` só de desenvolvimento (aviso, não barra).

### Auditoria da publicação de 07/11/2026 (a7676db3 para o GitHub)

Diff revisado: da versão publicada (`e0fccf4` no GitHub = commit local `3d64bd54`) até `a7676db3`. Foram quatro revisões independentes por área, mais o plugin Soundcheck (`pr-review`, OWASP Web/LLM/API) sobre o mesmo diff.

**Varredura.** Um item novo, e é falso positivo: Semgrep `detect-non-literal-regexp` em `knowledge/domain/pdf-ocr/hocr.ts` (`property`). O nome que entra na regex é sempre uma constante do próprio arquivo (`bbox`, `x_wconf`, `baseline`, `x_size`), e o padrão é linear. Entrou na linha de base. Gitleaks e OSV: nenhum item novo.

**Achados reais, todos corrigidos com teste que falhava antes.** Cinco dos seis são da mesma família: uma configuração versionada (rascunho ou versão antiga) roda ou é publicada, mas o acesso é conferido pelo alcance da linha viva.
- Bases (`d7c5be69`): o `PATCH /:id` com `status: PUBLISHED` publicava um rascunho de alcance maior. Agora o PATCH, a troca de arquivo, o reprocessamento e o descarte exigem também o alcance do rascunho, como `/publish` já exigia. O detalhe mostrava texto, extração e configuração de rascunho restrito a outro Grupo; agora esses itens saem só com número e situação (`restricted: true`).
- Agents (`219a23ac`): a prévia das instruções, o teste, a prévia da publicação, publicar, reverter, descartar e salvar conferem o alcance da configuração em questão (`authorizeAgentConfig`).
- Workflows (`afb29bec`): a versão fixada do Orquestrador precisa servir ao Grupo do Workflow na publicação (`WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN`). Depois (09/11/2026), a execução também confere, porque versões publicadas antes dessa correção e o rascunho do QA Lab não passam pela publicação: a etapa falha com o mesmo código, e a varredura das versões em uso está em [workflows.md](workflows.md) (no `inia`, nenhuma incompatível).
- Central de Dados (`9f9d69e2`): o valor oculto de uma API Pull (cabeçalho, parâmetro fixo, query do endpoint) só vale para a origem em que foi digitado. Com outra origem, a resposta é 422 `DATA_SOURCE_MASKED_VALUE`, inclusive antes da prova da credencial nova, que já chamava os conjuntos no servidor novo.
- Consultar dados (`2dac9d78`): reativar um cancelamento recusa os próprios resultados, com a mesma regra de cancelar.

**Segunda rodada (09/11/2026): o que estava aberto foi corrigido, com teste que falhava antes.**
- Conferência das respostas (`f381bde4`): a pergunta e a resposta também passam por `neutralizeMarks`, e o trecho da violação é conferido com os mesmos sinais trocados. Nenhuma pergunta ou resposta dos casos medidos tem `<` ou `>`, então a entrada desses casos não muda, e as versões do prompt seguem as mesmas.
- Bases:
  - o alcance em uso e o do rascunho são relidos com a base travada antes de escrever (`bd77598f`);
  - reverter descartando o rascunho conta o alcance dele, e editar sem rascunho conta o da atualização que falhou, de onde o rascunho novo parte (`e456ec67`);
  - a tela mostra o rascunho restrito como aviso, sem editar, publicar, descartar nem reprocessar (`34a4350d`).
- Agents:
  - o teste do rascunho executa a configuração conferida (`7e55c331`);
  - rascunho, versões, execuções e histórico de outro alcance saem `restricted`, e a tela mostra aviso no lugar dos campos (`a3c6078f`);
  - o histórico gravado antes de `configScopes` só mostra os valores a quem alcança todos os alcances que o agente já teve (`6962bbfb`).
- Workflows (`6ebd58f9`): a execução confere a versão fixada (e a de origem da migração) contra o alcance do Workflow e falha fechada se não servir. Varredura, só leitura: `npx tsx scripts/dev/orchestrator-version-scope-sweep.ts`. No `inia`, em 09/11, conferiu 5 etapas e não achou nenhuma incompatível.
- Central de Dados:
  - trocar a credencial sem liberação viva é recusado enquanto a fonte ou algum conjunto guardar outro valor oculto (`65ef9be7`). Isso fecha o "residual de desenho" de quem usava um token próprio válido;
  - a mesma conferência é repetida com a fonte travada (`44d9d0c6`);
  - gravar fonte ou conjunto reconfere a liberação de quem edita, com a fonte travada (`b11ec5c1`).

**Resíduos conhecidos (nenhum dá acesso ao que a regra nega).**
- Agents: rascunho sobrescrito antes de 09/11/2026 não deixou o alcance gravado em lugar nenhum além do histórico.
- Tela, nos casos em que a API recusa com 403 e a tela mostra o erro:
  - o menu "⋯" da lista de Bases ainda oferece "Publicar" e "Editar" para o rascunho restrito;
  - a atualização com falha restrita ainda oferece "Tentar novamente";
  - "Ver prompt final" do editor de Workflow, com versão restrita, mostra o erro genérico.
- Central: numa fonte em que ninguém sabe a credencial guardada, o cabeçalho oculto da própria fonte só sai cadastrando a fonte de novo. Os conjuntos podem ser excluídos.
- Workflows: uma versão fixada que não existe, ou que é de outro Orquestrador, continua caindo na versão atual. Sem versão fixada, o alcance do Orquestrador atual não é conferido de novo na execução.
- Testes da bomba de PDF (`text-extractor-isolated`, `knowledge-router.security`): com a máquina carregada, no macOS, a memória comprimida mantém a memória residente abaixo do teto. Aí o PDF passa, em vez de ser recusado por memória, e o teste falha. Sozinhos, ou na verificação sem outra carga, passam. O processo da API continua isolado do parser.
