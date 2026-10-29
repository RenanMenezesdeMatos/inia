# Segurança da INIA

Auditoria de segurança de 08/10/2026 e **segunda rodada em 17/10/2026** (branch `admin-list-standardization`): inventário das
superfícies, revisão de todos os módulos do backend, da interface, da instalação e das dependências, correções com testes de
regressão e o que ficou pendente. O sistema não é declarado "100% seguro": os documentos mostram o que foi coberto, o que mudou e o
risco que sobra.

| Documento | Conteúdo |
|---|---|
| [mapa-de-superficies.md](mapa-de-superficies.md) | Arquitetura, fronteiras de confiança, entradas, saídas, processos em segundo plano e a matriz de cobertura por módulo |
| [relatorio-vulnerabilidades-2026-10-17.md](relatorio-vulnerabilidades-2026-10-17.md) | Resumo da 2ª rodada em linguagem direta: cada vulnerabilidade, o risco, a solução e a situação |
| [relatorio-de-achados.md](relatorio-de-achados.md) | 1ª rodada: 34 achados (SEC-01…34). 2ª rodada: 46 itens (14 médios, 28 baixos, 4 informativos — AUTH, SCOPE, DATA, AI, INFRA) com gravidade, tipo, evidência, correção e teste, e as verificações executadas. 4ª rodada (28–29/10/2026, skill da Cloudflare): 18 confirmados, todos corrigidos (o C13 tem resíduo; no C14 o tipo de afastamento fica só para operadores), e dos 4 a validar N01 e N04 confirmados e corrigidos e a decisão sobre o tipo de afastamento |
| [configuracao-segura.md](configuracao-segura.md) | Variáveis de ambiente, IIS, bancos externos, papéis, atualização, reversão e rotação |
| [pendencias-e-riscos.md](pendencias-e-riscos.md) | Riscos residuais e validações não executadas, com a ação que resolve |
| [plano-de-resposta-a-incidentes.md](plano-de-resposta-a-incidentes.md) | Parte da INIA na resposta a incidentes (20/10/2026): o que conta, prazos da LGPD, contenção, onde está a evidência, relatório para a Vivo |
| [appsec-2026-10-29/](appsec-2026-10-29/README.md) | Preparação para a avaliação AppSec do Conviso (29/10/2026): Semgrep, Gitleaks, OSV, Syft (SBOM), ZAP e pentest local; matriz ASVS 5.0.0; achados APPSEC-01…05 (APPSEC-02 = h19 da 4ª rodada, corrigido em `4859d40f` + `77c5adcd` e retestado); `npm run security:scan` com linha de base. Commits da 4ª rodada no mesmo dia: N01/N04 em `1ea944cf`, h19 em `4859d40f` + `77c5adcd`, N03 (pasta e arquivo do backup restritos) em `a36909d9` |
| [anexos/](anexos/) | Matrizes rota a rota produzidas em cada rodada (estado anterior às correções); a 2ª rodada em `anexos/rodada-2026-10-17/` |

## Controles transversais introduzidos

| Controle | Onde |
|---|---|
| Conferência de origem nas escritas com cookie (CSRF) | `backend/src/shared/presentation/origin-guard.ts` |
| Limites de requisições por IP e por conta | `backend/src/shared/presentation/rate-limit.ts`, montagem em `backend/src/main/app.ts` |
| Revogação da sessão no logout (`jti`) | migration `123_auth_session_revocations.sql`, `auth/presentation/auth-router.ts`, `require-auth.ts` |
| Política de destinos de saída (SSRF) | `backend/src/shared/infrastructure/outbound-destination-policy.ts`, `backend/src/config/outbound-policy.ts` |
| Guarda de ZIP e limites de upload | `backend/src/shared/infrastructure/zip-guard.ts` |
| Escrita de catálogo só com escopo de organização | `writesRequireOrganization` em `access/presentation/require-permission.ts` |
| Visibilidade de casos de supervisão | `supervision-cases/application/case-visibility.ts` |
| Entrega segura do arquivo original da base | `knowledge/presentation/knowledge-file-response.ts` |
| Credencial vinculada ao destino (Central de Dados) | `secretTargetOf` em `data-hub/application/source-service.ts` |
| Cabeçalhos de segurança da interface | `frontend/next.config.ts` |
| Caminho normalizado nos limites por rota (2ª rodada) | `routePath` em `backend/src/main/app.ts` |
| Tentativa de login reservada antes do bcrypt; teto da fila do bcrypt | `auth/application/authenticate.ts`, `auth/infrastructure/password-hasher.ts` |
| Dispositivo conhecido (trava do e-mail não barra o dono) | `auth/infrastructure/known-device.ts` |
| Limites "só falhas" com vaga reservada e devolvida | `shared/presentation/rate-limit.ts` (`release` nas lojas) |
| Segredos de produção conferidos na subida | `productionSecretProblems` em `backend/src/config/env.ts` |
| ZIP com tamanho real conferido; PDF com fluxos medidos | `shared/infrastructure/zip-guard.ts`, `shared/infrastructure/pdf-guard.ts` |
| Metadados fora das imagens (EXIF/GPS) | `shared/infrastructure/image-metadata.ts` |
| Banco interno negado por qualquer nome/IP; metadados de nuvem | `shared/infrastructure/outbound-destination-policy.ts` |
| Teto de chamadas de ferramenta por rodada/turno | `assistant/application/run-orchestrated-reply.ts` |
| Monitoramento de conversas pelo escopo de quem lê | `assistant/application/conversation-monitoring.ts` |
| Simulação sem histórico de intervenções para quem não o vê | `interventions/application/condition-resolvers.ts` |
| Links externos só de domínios confiáveis | `frontend/src/components/rich-content/rich-content.tsx` |
| Sessão encerrada por inatividade (3ª rodada, 20/10) | migration 149, `auth/presentation/require-auth.ts`, `frontend/src/components/auth/session-idle-guard.tsx` |
| "Sair de todos os aparelhos"; cookie `__Host-`; chaves HMAC por rótulo (HKDF) | `auth/presentation/auth-router.ts`, `session-cookie.ts`, `auth/infrastructure/derived-keys.ts` |
| Dados de cliente mascarados nas transcrições enviadas à IA | `workflows/application/transcript.ts` (`transcriptForModel`) |
| Cifra dos segredos presa à organização/dono/finalidade (AAD) e recifragem | `data-hub/infrastructure/aes-secret-store.ts`, `backend/scripts/seguranca/recifrar-segredos.ts` |
| Registro de leitura de dados pessoais de outra pessoa | migration 151, `data-lifecycle/application/personal-data-access-log.ts` |
| Exportação dos dados do titular (LGPD art. 18) | `data-lifecycle/application/subject-data-export.ts` |
| Revisão humana das contestações de feedback (LGPD art. 20) | migration 150, `feedback-rating/application/contestation-review-service.ts` |
| Token da API Push com validade e IPs; token antes do corpo | migration 152, `data-hub/application/push-ingestion.ts`, `data-hub/presentation/data-ingestion-router.ts` |
| Banco fora do ar não trava a API | `infrastructure/database/pool.ts` (`query_timeout`, keep-alive), `main/readiness.ts`; prova `database-outage-proof` (Docker) |

## Como rodar os testes de segurança

```bash
cd backend && npx vitest run http-security case-router knowledge-router.security user-account-router.security scoped-admin-security outbound-destination-policy secret-binding zip-guard pdf-guard image-metadata known-device auth-flows password-hasher conversation-monitoring run-orchestrated-reply create-orchestrator-feedback condition-resolvers glob api-pull-volume query-table-markdown usability-identified-scope auth-domain transcript aes-secret-store push-token-hardening push-openapi
```

```bash
cd frontend && npx vitest run src/components/rich-content src/components/admin/users src/components/auth src/lib/auth src/components/admin/feedback-contestations src/components/admin/data-hub/push-token-hardening
```

Provas contra o banco de teste (por módulo, como orienta a memória do projeto):

```bash
cd backend && INIA_DB_PROOF=1 NODE_ENV=test npx vitest run src/modules/access src/modules/data-hub src/modules/feedback-application src/modules/ai-management --no-file-parallelism
```

```bash
cd backend && INIA_DB_PROOF=1 NODE_ENV=test npx vitest run login-throttle-proof postgres-rate-limit-store-proof person-identity-proof agent-knowledge-scope-proof diagnostic-strategy-proof account-access-lifecycle-proof interventions-proof assistant-conversations-proof --no-file-parallelism
```
