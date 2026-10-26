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
  `coversOrganization`). Um recurso novo desse tipo nasce com essa regra.
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
  política. Credencial guardada é vinculada ao destino (`secretTargetOf`): mudou o destino, pede a senha de novo.
- **Persona e instruções de IA são do servidor**: o navegador manda no máximo dado de contexto delimitado (`contextHint`). Saída de
  modelo nunca vira HTML cru, SQL ou ação privilegiada.
- **Arquivos**: tipo decidido pelo servidor, download sempre `attachment` com `sandbox`; ZIP (XLSX/DOCX) passa pela
  `zip-guard.ts` antes do parser; CSV exportado neutraliza fórmula.
- **CSP da interface com nonce**: `frontend/src/proxy.ts` monta a política a cada requisição em TODAS as páginas
  (`lib/security/content-security-policy.ts` — origem nova de API/provedor entra lá) e o `RootLayout` lê `x-nonce`, o que deixa
  todas as rotas dinâmicas: nunca reintroduzir página estática nem `export const dynamic = "force-static"`. Script inline novo só
  com o nonce (`(await headers()).get("x-nonce")`); nada de `<script>` montado a partir de dado. Produção não tem
  `'unsafe-eval'`: biblioteca que use `eval`/`new Function` quebra ou gera violação (o Zod roda `jitless` por isso,
  `lib/security/zod-without-eval.ts`). Para conferir no navegador, o console não mostra violação de `eval` — use um `report-uri`
  de teste (ver `docs/security/configuracao-segura.md` §2).
- **Limites**: `rate-limit.ts` (loja do PostgreSQL no servidor real, memória nos testes). Ação nova que chama IA ou conecta a
  destino externo entra no `costly(...)` ou no teto por conta de `app.ts`. Matcher por caminho SEMPRE com `routePath(request)`
  (minúsculas, sem barra final) — o Express casa `/x/TEST` e `/x/test/` na rota de `/x/test`. Regra "só falhas" reserva a vaga e
  devolve no sucesso (`release`).
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
  intervenção; tipo de afastamento sensível só separado quando não aponta ninguém (`sensitiveBreakdownAllowed`); Agent só usa base
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
- 2ª rodada (17/10/2026): 46 itens (14 médios, nenhum crítico ou alto), sem migration; pendências R-19…R-33 e R-05 ampliado (AUTH-5, decisão de produto) em
  `docs/security/pendencias-e-riscos.md`. Instalação Windows (`-ContaServico`, ACL dos `.env`) escrita sem Windows para validar.

- Migration `123_auth_session_revocations.sql` aplicada em `inia` e `inia_test` (08/10/2026); `inia_test` também tem 121/122 do
  branch `claude/ai-limiter-worker-split`.
- Dependências fixadas: `next ~16.3.8` (16.4.0 evitado), `multer ^2.4.0`; `proxy-addr` 2.0.8, `sharp` 0.35.5 no lock.
- Pendências principais: organização fixa em ~30 arquivos (R-01), voz Live sem `setup` travado (R-04), CSP com estilos inline
  (R-07; os scripts já usam nonce), limitador por processo (R-02), manuais 003/004 desatualizados sobre HTTP (R-11).
