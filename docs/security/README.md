# Segurança da INIA

Auditoria de segurança de 08/10/2026 (branch `admin-list-standardization`): inventário das superfícies, revisão de todos os
módulos do backend, da interface, da instalação e das dependências, correções com testes de regressão e o que ficou pendente.
O sistema não é declarado "100% seguro": os documentos mostram o que foi coberto, o que mudou e o risco que sobra.

| Documento | Conteúdo |
|---|---|
| [mapa-de-superficies.md](mapa-de-superficies.md) | Arquitetura, fronteiras de confiança, entradas, saídas, processos em segundo plano e a matriz de cobertura por módulo |
| [relatorio-de-achados.md](relatorio-de-achados.md) | 34 achados com gravidade, tipo, evidência, correção e teste |
| [configuracao-segura.md](configuracao-segura.md) | Variáveis de ambiente, IIS, bancos externos, papéis, atualização, reversão e rotação |
| [pendencias-e-riscos.md](pendencias-e-riscos.md) | Riscos residuais e validações não executadas, com a ação que resolve |
| [anexos/](anexos/) | Matrizes rota a rota produzidas na auditoria (estado anterior às correções) |

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

## Como rodar os testes de segurança

```bash
cd backend && npx vitest run http-security case-router knowledge-router.security user-account-router.security scoped-admin-security outbound-destination-policy secret-binding zip-guard usability-identified-scope
```

Provas contra o banco de teste (por módulo, como orienta a memória do projeto):

```bash
cd backend && INIA_DB_PROOF=1 NODE_ENV=test npx vitest run src/modules/access src/modules/data-hub src/modules/feedback-application src/modules/ai-management
```
