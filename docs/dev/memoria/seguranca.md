# Segurança — controles transversais e decisões (auditoria de 08/10/2026)

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
- **Limites**: `rate-limit.ts` (em memória, por processo). Ação nova que chama IA ou conecta a destino externo entra no
  `costly(...)` ou no teto por conta de `app.ts`.

## Estado

- Migration `123_auth_session_revocations.sql` aplicada em `inia` e `inia_test` (08/10/2026); `inia_test` também tem 121/122 do
  branch `claude/ai-limiter-worker-split`.
- Dependências fixadas: `next ~16.3.8` (16.4.0 evitado), `multer ^2.4.0`; `proxy-addr` 2.0.8, `sharp` 0.35.5 no lock.
- Pendências principais: organização fixa em ~30 arquivos (R-01), voz Live sem `setup` travado (R-04), CSP com estilos inline
  (R-07; os scripts já usam nonce), limitador por processo (R-02), manuais 003/004 desatualizados sobre HTTP (R-11).
