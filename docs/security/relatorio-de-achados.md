# Relatório de achados — auditoria de segurança (08/10/2026)

Branch `admin-list-standardization`, sem commit (working tree compartilhado com outras sessões). Todas as correções abaixo estão
no código e têm teste de regressão, salvo onde indicado. Os números de linha citados como evidência referem-se ao código
**antes** da correção; o arquivo e a função continuam os mesmos.

Classificação:

- **Vulnerabilidade confirmada** — o caminho de exploração foi verificado no código (e reproduzido em teste).
- **Hipótese** — o risco depende de condição não reproduzida aqui (ex.: arquivo malicioso real, segunda organização).
- **Melhoria preventiva** — não há exploração direta, mas reduz alcance ou impacto de outra falha.

Gravidade = impacto × facilidade de exploração × alcance, considerando que a instalação é mono-organização
(`INSTALLATION_ORGANIZATION_ID`) e que os papéis `ADMINISTRADOR`/`ADMINISTRADOR_DE_ACESSOS` podem ser atribuídos com escopo de
Grupo ou Subgrupo.

## Resumo

| ID | Achado | Gravidade | Tipo | Situação |
|---|---|---|---|---|
| SEC-01 | Casos de supervisão (diagnóstico, evidências, feedbacks não publicados) legíveis por qualquer sessão | Crítica | Confirmada | Corrigido |
| SEC-02 | XSS armazenado: arquivo da Base de Conhecimento servido `inline` com o tipo declarado pelo navegador | Alta | Confirmada | Corrigido |
| SEC-03 | Base de Conhecimento sem escopo: administrador de Subgrupo lia e alterava bases de todos os Grupos | Alta | Confirmada | Corrigido |
| SEC-04 | Central de Dados aberta a administrador de Grupo (pessoas, hierarquia, e-mail de login, credenciais) | Alta | Confirmada | Corrigido |
| SEC-05 | Credencial guardada da Central de Dados podia ser enviada para outro destino | Alta | Confirmada | Corrigido |
| SEC-06 | Nível hierárquico do JWT concedia visão ampla e podia ser alterado por administrador escopado | Alta | Confirmada | Corrigido |
| SEC-07 | Cadastro de pessoas (`/admin/users`) contornava a custódia de credencial | Alta | Confirmada | Corrigido |
| SEC-08 | Custódia de credencial ignorava a estrutura liderada pelo alvo | Alta | Confirmada | Corrigido (parte "conta-fantoche" residual) |
| SEC-09 | Escritas autenticadas por cookie sem conferência de origem (CSRF via subdomínio irmão) | Média | Melhoria + vuln. condicionada | Corrigido |
| SEC-10 | Sem limite por IP no login nem teto de uso de IA por conta | Média | Confirmada | Corrigido |
| SEC-11 | "Sair" não revogava a sessão no servidor | Média | Confirmada | Corrigido |
| SEC-12 | Instalação em HTTP ficava em `NODE_ENV=development` no servidor | Média | Confirmada | Corrigido (manuais pendentes) |
| SEC-13 | SSRF: conectores e conexões de IA sem política de destino | Média | Confirmada | Corrigido (DNS rebinding residual) |
| SEC-14 | SFTP aceitava qualquer chave de servidor quando não havia fingerprint | Média | Confirmada | Corrigido (TOFU) |
| SEC-15 | Instrução de sistema do chat vinha do navegador | Média | Confirmada | Corrigido no texto (voz residual) |
| SEC-16 | Qualquer sessão publicava feedback aprovado de qualquer pessoa | Média | Confirmada | Corrigido |
| SEC-17 | Catálogos da organização alteráveis por administrador de Grupo/Subgrupo | Média | Confirmada | Corrigido |
| SEC-18 | Dados de PRV/atingimento da organização inteira para administrador escopado | Média | Confirmada | Corrigido |
| SEC-19 | Pessoa inativada pela Central continuava entrando | Média | Confirmada | Corrigido |
| SEC-20 | Confirmação de ciência com senha: limite de tentativas contornável em paralelo | Média | Confirmada | Corrigido |
| SEC-21 | Monitoria de usabilidade identificava pessoas fora do escopo concedido | Média | Confirmada (combinação de papéis) | Corrigido |
| SEC-22 | API Push: mapa de limite em memória crescia com tokens forjados | Média | Confirmada | Corrigido |
| SEC-23 | Ingestão legada: colaborador sem conferência de organização, sem limites | Média | Confirmada | Corrigido |
| SEC-24 | Ações administrativas que chamam IA/conexões sem teto por conta | Baixa | Confirmada | Corrigido |
| SEC-25 | Workflow chamava Agent exclusivo de outro Grupo | Baixa | Confirmada | Corrigido |
| SEC-26 | Destinatário/revisor fixo de Workflow aceitava qualquer uuid | Baixa | Confirmada | Corrigido |
| SEC-27 | SSRF em conexões de IA (lista de bloqueio contornável, redirecionamento seguido) | Baixa | Confirmada | Corrigido |
| SEC-28 | Chave de IA acompanhava a troca de endereço da conexão | Baixa | Confirmada | Corrigido |
| SEC-29 | Arquivo compactado malicioso (XLSX/DOCX) podia esgotar a memória do processo | Baixa | Hipótese | Corrigido (preventivo) |
| SEC-30 | Injeção de fórmula em CSV exportado | Baixa | Confirmada | Corrigido |
| SEC-31 | Itens menores de autorização, validação e tratamento de erro (lista) | Baixa | Confirmada | Corrigido |
| SEC-32 | Dependências com avisos de segurança aplicáveis | Alta (next) / Média | Confirmada (avisos oficiais) | Corrigido; restantes avaliados |
| SEC-33 | Interface sem cabeçalhos de segurança (CSP, clickjacking, permissões) | Média | Melhoria | Corrigido |
| SEC-34 | Organização fixa no código em ~30 arquivos | Latente | Hipótese (exige 2ª organização) | Pendente |

---

## SEC-01 — Casos de supervisão legíveis por qualquer sessão (Crítica)

- **Onde**: `supervision-cases/presentation/case-router.ts`, `infrastructure/pg-case-repository.ts` (`list()` sem `where`;
  `findById` só por `case_id`); montado em `app.ts` só com `requireAuth`.
- **Evidência**: `GET /api/v1/supervision-cases` devolvia todos os casos da base; `GET /:id` trazia evidências (trechos de
  atendimento), recomendações e feedbacks inclusive não publicados.
- **Cenário**: um operador lista os casos de toda a operação e lê o diagnóstico de qualquer colega.
- **Correção**: `application/case-visibility.ts` — visível só para quem alcança o colaborador pela mesma autoridade de
  Indicadores/Equipe (subárvore de `reports_to` ∪ escopo de `indicators.view`) ou administra Agents no Grupo dele; organização
  sempre a da sessão; id validado como uuid; lista com teto de 200 linhas; fora do escopo = 404.
- **Teste**: `supervision-cases/presentation/case-router.test.ts`; `src/main/app.test.ts` (lista vazia para conta sem escopo).

## SEC-02 — XSS armazenado pelo arquivo original da Base de Conhecimento (Alta)

- **Onde**: `knowledge-router.ts` (upload gravava `file.mimetype` do navegador; download `inline` com esse tipo) e
  `knowledge-material-router.ts` (qualquer usuário autenticado); `text-extractor.ts` aceitava qualquer extensão como texto.
- **Cenário**: um administrador de Grupo envia `x.html` (`text/html`) com `<script src="/api/v1/knowledge-materials/<js>/file">`,
  publica para todos e manda o link ao Administrador geral; em produção (IIS, interface e API na mesma origem) o script roda com a
  sessão dele e pode, por exemplo, conceder papéis.
- **Correção**: `knowledge-file-response.ts` — tipo decidido pelo servidor a partir do tipo detectado (valores antigos de
  `mime_type` deixam de importar), sempre `attachment`, `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`; upload
  confere assinatura (PDF `%PDF-`, DOCX = ZIP íntegro, texto sem bytes nulos) antes de qualquer parser.
- **Teste**: `knowledge/presentation/knowledge-router.security.test.ts` (HTML gravado sai como `text/plain` + sandbox; PDF falso
  recusado com 422). Verificado no navegador: download e prévia DOCX continuam funcionando.

## SEC-03 — Base de Conhecimento sem escopo (Alta)

- **Onde**: `knowledge-router.ts` não chamava `getManageableScopes`; `replaceScopes` aceitava qualquer alcance.
- **Cenário**: administrador de Subgrupo lia rascunhos de outros Grupos, alterava/publicava procedimentos globais usados pelos
  Agents, promovia uma base para "todos os Grupos" ou a excluía.
- **Correção**: leitura = base global ou com alcance no Grupo/Subgrupo de quem pede (filtro no SQL da lista); escrita, criação e
  exclusão = todos os alcances atuais e novos dentro do escopo (`canManageScope`); global só com escopo de organização; fora = 404;
  edição de base excluída bloqueada.
- **Teste**: `knowledge-router.security.test.ts`; `knowledge-router-checkpoint-hook.test.ts` (publicação continua sincronizando).

## SEC-04 — Central de Dados aberta a administrador de Grupo (Alta)

- **Onde**: `app.ts` montava `/admin/data-hub` e `/ingestion` com `can("data_hub.manage")` (qualquer escopo); nenhuma rota da
  Central aplica escopo; o writer de EMPLOYEES grava `people.role`, `reports_to_id`, `active` e `user_accounts.email`.
- **Cenário**: administrador do Grupo A importa um CSV de pessoas que troca o e-mail de login do Administrador geral, religa
  `reports_to` para liderar a organização ou move uma vítima para o Grupo A e depois gera senha temporária para ela.
- **Correção**: as duas montagens exigem `data_hub.manage` com escopo de organização; a capability `canManageDataHub` acompanha
  (o menu some para o administrador escopado).
- **Teste**: `src/main/scoped-admin-security.test.ts` (403 para administrador de Grupo; Administrador geral passa).

## SEC-05 — Credencial guardada da Central levada para outro destino (Alta)

- **Onde**: `source-service.ts` (`testDatabaseDraft` usava a senha guardada com `config` do corpo; `updateSource` mantinha os
  segredos ao trocar host/URL); `api-pull-connector.ts` (`endpoint` absoluto substituía a `baseUrl` e levava o cabeçalho de
  autenticação).
- **Cenário**: com `data_hub.manage`, apontar uma fonte salva para um servidor próprio e receber a senha do banco/API do cliente
  em claro (o driver PostgreSQL responde a pedido de senha em texto puro).
- **Correção**: `secretTargetOf` — o "destino" da credencial (motor, host, porta, instância, usuário e modo TLS; origem da API,
  tipo de autenticação, URL do token e nome do cabeçalho; host/porta/usuário do SFTP). Mudou o destino: as credenciais precisam
  vir na mesma requisição e as antigas são revogadas; o teste de rascunho só usa a senha guardada contra o mesmo destino; endpoint
  do feed só na origem da fonte.
- **Teste**: `data-hub/application/secret-binding.test.ts`; provas `data-hub-proof` com `INIA_DB_PROOF=1`.

## SEC-06 — Nível hierárquico do JWT como autorização (Alta)

- **Onde**: `reporting/presentation/supervisor-router.ts` (`/overview` aberto a qualquer nível de liderança) e
  `viewer-scope.ts` (`canViewManagementMetrics`) usam `user.role`, foto do login por 12 h; `user-account-router.ts` deixava
  qualquer `people.manage` de Grupo definir `role` (inclusive o próprio).
- **Cenário**: administrador de Grupo se coloca como `DIRECTOR` (ou cria um "fantoche" com esse nível e senha escolhida), entra de
  novo e lê dados por pessoa da operação inteira; um líder rebaixado mantinha a visão até o token vencer.
- **Correção**: o guard de sessão relê `people.role` a cada requisição e substitui o do token; criar ou mudar um nível de liderança
  exige `people.manage` com escopo de organização; ninguém altera o próprio nível, Grupo, e-mail ou situação.
- **Teste**: `users/presentation/user-account-router.security.test.ts`; `shared/presentation/http-security.test.ts` ("o nível
  hierárquico vale o do cadastro AGORA").
- **Observação**: a regra de produto "quem lidera vê a visão da operação/métricas de qualquer líder" foi mantida (decisão de
  2026-09-17); o que mudou é quem pode conceder esse nível e quanto tempo ele vale.

## SEC-07 — `/admin/users` contornava a custódia de credencial (Alta)

- **Onde**: `user-account-router.ts` `PATCH /:id` (e-mail e `active`) e `POST /` (conta com senha escolhida, mínimo 6, sem
  auditoria) não chamavam `checkCredentialCustody`.
- **Cenário**: administrador do Grupo A desativa ou troca o e-mail de login de um Administrador geral cuja pessoa está no Grupo A
  (a tela de acessos recusaria por `TARGET_MORE_PRIVILEGED`).
- **Correção**: `assertCredentialChangeAllowed` (mesma régua de Habilitar/Gerar senha/Desabilitar) para e-mail e inativação;
  criar conta exige também `access.users.manage` no Grupo, senha provisória dentro da política (≤ 72 bytes, letra, número, sem o
  e-mail) e grava `audit_logs` sem senha nem hash; mover pessoa para Grupo fora do escopo é recusado.
- **Teste**: `user-account-router.security.test.ts`; `user-account-router.test.ts` (auditoria sem senha).

## SEC-08 — Custódia ignorava a estrutura liderada (Alta)

- **Onde**: `access-decision.ts` `checkCredentialCustody` olhava só os papéis explícitos do alvo; `account-access-service.ts`
  devolvia a senha temporária ao administrador.
- **Cenário**: `ADMINISTRADOR_DE_ACESSOS` do Grupo A gera senha temporária para um gestor sem papel cuja estrutura atravessa outros
  Grupos e passa a ver indicadores, feedbacks e diagnósticos dessa estrutura.
- **Correção**: `CredentialTargetRecord.ledPlacements` (Grupo/Subgrupo de todas as pessoas ativas lideradas, CTE recursiva com
  limite de profundidade) e `reachesLedStructure`: o escopo de quem age precisa alcançar todas elas
  (`ACCESS_TARGET_LEADS_OUTSIDE_SCOPE`).
- **Teste**: `user-account-router.security.test.ts`; `access/testing/*-proof.test.ts` (33 testes contra o Postgres).
- **Residual**: quem pode habilitar contas e atribuir papéis pode criar uma conta que ele mesmo controla e conceder a ela um papel
  delegável (ver `pendencias-e-riscos.md`, R-05).

## SEC-09 — CSRF (Média)

- **Onde**: cookie `SameSite=Lax` sem conferência de origem nas escritas; "mesmo site" inclui subdomínios irmãos.
- **Correção**: `shared/presentation/origin-guard.ts` — escrita (POST/PUT/PATCH/DELETE) com o cookie de sessão precisa de
  `Origin` em `CORS_ORIGIN` (ou `Sec-Fetch-Site: same-origin`); `Origin: null`, outro subdomínio e `cross-site`/`same-site` sem
  `Origin` são recusados; clientes fora do navegador (sem nenhum dos dois cabeçalhos) não são afetados; requisições sem cookie
  (login, API Push) não passam pela guarda. `CORS_ORIGIN` aceita lista.
- **Teste**: `http-security.test.ts` (bloco CSRF). Verificado no navegador: escritas legítimas (logout) passam.

## SEC-10 — Limites de requisições (Média)

- **Onde**: sem limitador além da trava por e-mail (que também permitia *password spraying* em vários e-mails).
- **Correção**: `shared/presentation/rate-limit.ts` (janela deslizante em memória, teto de chaves) aplicado em `app.ts`: login
  30/5 min por IP (`LOGIN_RATE_LIMIT_PER_IP`), criação de senha 20/15 min por IP, falhas de ciência 10/15 min por conta, API Push
  600/min e 30 falhas/15 min por IP, IA conversacional 90/min e sessões de voz 12/min por conta, ações administrativas caras 30/min
  por conta. IP real atrás do IIS por `TRUST_PROXY=loopback` (nunca `true`).
- **Teste**: `http-security.test.ts` (bloco limites).

## SEC-11 — Logout sem revogação (Média)

- **Correção**: JWT com `jti`; `POST /auth/logout` grava o `jti` em `auth_revoked_sessions` (migration `123`) até o `exp`; o guard
  recusa o token revogado (`SESSION_REVOKED`); só aquela sessão cai. Algoritmo fixo `HS256` na assinatura e verificação, payload
  sem forma de sessão recusado, `/me` sem `iat/exp/jti/sv/pc`.
- **Teste**: `http-security.test.ts` (bloco sessão). Verificado no navegador e no banco de dev.

## SEC-12 — Servidor HTTP em modo desenvolvimento (Média)

- **Onde**: `scripts/install/env-init.mjs` gravava `NODE_ENV=development` para endereço `http://` (só para o cookie funcionar).
  Em desenvolvimento a API aceita o `JWT_SECRET` padrão, o fallback fixo do `DATA_HUB_SECRET_KEY` e dados de demonstração.
- **Correção**: `SESSION_COOKIE_SECURE` (auto/true/false) separado do modo; `env-init` grava `NODE_ENV=production` em qualquer
  instalação de servidor e `SESSION_COOKIE_SECURE=false` só para HTTP; `JWT_SECRET` com menos de 32 caracteres recusado em produção.
- **Pendência**: manuais IT-INIA-003/004 ainda dizem "HTTP fica em modo de desenvolvimento" (R-11).

## SEC-13 — SSRF (Média)

- **Onde**: conectores HTTP/SFTP/banco validavam só formato; conexões de IA bloqueavam poucos nomes literais e seguiam
  redirecionamentos.
- **Correção**: `shared/infrastructure/outbound-destination-policy.ts` + `config/outbound-policy.ts`, aplicada no cliente HTTP da
  Central, no SFTP, no conector de bancos externos e no `fetch` dos adapters de IA. Resolve o nome e confere **todos** os
  endereços: metadados de nuvem, link-local, não roteáveis e o host:porta do banco interno sempre negados; loopback negado em
  produção; redes privadas permitidas (requisito); `INIA_OUTBOUND_MODE=ALLOWLIST` + `INIA_OUTBOUND_ALLOWED_DESTINATIONS` para lista
  explícita. Respostas HTTP limitadas a 50 MB, downloads SFTP a 200 MB, redirecionamento nunca seguido.
- **Teste**: `outbound-destination-policy.test.ts`, `secret-binding.test.ts`; provas de IA (`ai-providers-proof`) com servidor
  falso local em ambiente de teste.

## SEC-14 — SFTP sem verificação de chave (Média)

- **Correção**: TOFU de verdade — sem fingerprint configurada, a primeira chave vista é gravada na fonte
  (`pinSftpHostKey`); depois disso uma chave diferente derruba a conexão.
- **Teste**: sem teste automatizado de rede SSH (o cliente real exige servidor); a função de verificação existente continua
  coberta. Ver R-09.

## SEC-15 — Instrução de sistema do chat vinda do navegador (Média)

- **Onde**: `realtime-router.ts` `POST /messages` usava `systemInstruction` do corpo (sem Orquestrador era o prompt inteiro).
- **Correção**: persona do servidor (`INIA_CHAT_PERSONA`); o navegador só envia `contextHint` (≤ 1.000 caracteres, sem controles
  nem colchetes, marcado como "informação, não instrução"); o campo antigo é aceito e ignorado. Erro do provedor de voz não volta
  mais ao navegador; limites em `/tool-call` e `/voice-turn`.
- **Teste**: `realtime-router-addressing.test.ts`; `gemini-text-client.test.ts` e `feedback-application.test.tsx` no frontend.
- **Residual**: a sessão de voz (Gemini Live) é configurada pelo navegador com token efêmero (R-04).

## SEC-16 — Publicar feedback sem permissão (Média)

- **Correção**: `POST /feedbacks/:id/publish` só para quem enxerga o caso (mesma regra do SEC-01), nunca o próprio colaborador,
  organização da sessão, uuid validado.
- **Teste**: `scoped-admin-security.test.ts`.

## SEC-17 — Catálogos da organização alteráveis por administrador escopado (Média)

- **Correção**: `writesRequireOrganization` (require-permission.ts) em domínios de negócio, calendário operacional, flags de canal e
  governança; definições e glossário de indicadores exigem organização; regra de cálculo segue o escopo dela (todos os Grupos =
  organização); subgrupo só em Grupo do escopo; catálogo de assuntos exige organização.
- **Teste**: `scoped-admin-security.test.ts` (8 escritas recusadas ao administrador de Grupo, aceitas ao Administrador geral).

## SEC-18 — PRV e atingimento da organização inteira (Média)

- **Correção**: `GET /admin/employee-performance` filtra pelas pessoas do escopo de `configuration.manage`; `personId` validado.

## SEC-19 — Pessoa inativa mantinha o acesso (Média)

- **Correção**: login e sessão exigem `people.active` além de `user_accounts.active` (`postgres-credential-store.ts`).
- **Teste**: `http-security.test.ts`.

## SEC-20 — Corrida na confirmação de ciência com senha (Média)

- **Correção**: contar falhas → conferir senha → gravar falha sob `pg_advisory_xact_lock` por conta, numa transação; erro lançado
  depois do commit. Limite por conta também no `app.ts`.
- **Teste**: `read-confirmation-proof.test.ts` — 10 tentativas paralelas nunca passam de 5 conferências.

## SEC-21 — Monitoria de usabilidade fora do escopo (Média)

- **Correção**: listas e exportações identificadas só quando o escopo de `usability.users.view` cobre todo o recorte de
  `usability.view` (`identifiedScopeCoversView`); caso contrário, só agregados (o detalhe individual já usava o escopo certo).
- **Teste**: `usability-identified-scope.test.ts`.

## SEC-22 — API Push: memória e limite efetivo (Média)

- **Correção**: balde por id do token já autenticado (não pelo texto enviado), teto de 10 mil baldes, token > 200 caracteres
  recusado antes do banco, limite por IP antes da autenticação; o parser JSON global (1 MB) não roda mais na rota de push (o limite
  documentado de 10 MB passa a valer); token restrito a feed só com feed da própria fonte.

## SEC-23 — Ingestão legada `/api/v1/ingestion` (Média)

- **Correção**: só `data_hub.manage` de organização; organização da sessão; colaborador precisa ser da organização; tamanhos
  limitados (transcrição 200 mil caracteres, 50 flags).

## SEC-24 a SEC-28 — IA, Workflows e conexões (Baixa)

- **SEC-24**: teto de 30 ações caras/min por conta (testar Agent/modelo/conexão/roteamento, simular estratégia, QA Lab, executar
  agora, testes e prévias da Central); entrada de teste de Agent ≤ 100 mil caracteres.
- **SEC-25**: publicação recusa Agent incompatível com a abrangência do Workflow (`WORKFLOW_AGENT_SCOPE_FORBIDDEN`), como já fazia
  com Orquestrador. Teste: catálogo de paridade (`publish-validation-parity-cases.ts`).
- **SEC-26**: pessoa fixa (Output "Usuário específico", revisor/escalonamento "Pessoa específica") precisa existir, estar ativa e ser
  da organização (`WORKFLOW_RECIPIENT_NOT_FOUND`); no runtime a busca é restrita à organização.
- **SEC-27**: ver SEC-13 (`guardedFetch` nos adapters; nome normalizado; IPv4 mapeado em IPv6).
- **SEC-28**: trocar o host da conexão de IA revoga a chave e os cabeçalhos guardados (auditado); mesma origem mantém.
  Teste: `ai-providers-proof.test.ts`.

## SEC-29 — Arquivo compactado malicioso (Baixa, hipótese)

- **Correção**: `shared/infrastructure/zip-guard.ts` lê o diretório central do ZIP antes do exceljs/mammoth (≤ 20 mil entradas,
  ≤ 300 MB descompactados, taxa ≤ 1.000:1, sem ZIP64); multer com limites de partes, campos e tamanho de campo; a prévia DOCX
  (que roda a cada leitura) também passa pela guarda.
- **Teste**: `zip-guard.test.ts`; conferido contra XLSX real de 20 mil linhas e os DOCX dos manuais.

## SEC-30 — Injeção de fórmula em CSV (Baixa)

- **Correção**: exportação do Diagnóstico (`leadership-diagnostics.ts`) e rejeições da Central (`data-hub-router.ts`) prefixam com
  apóstrofo textos iniciados por `= + - @ TAB CR` (a exportação de usabilidade já fazia); visão do CSV do diagnóstico restrita a
  uma lista fechada (entrava no nome do arquivo).

## SEC-31 — Itens menores

| Item | Correção |
|---|---|
| Prévia de agenda listava operadores de qualquer Grupo | Escopo de `workflows.manage` conferido |
| Auditoria de exceção de calendário (código pode ser ATESTADO) por id | Mesmo escopo de quem gere o colaborador; fora = 404 |
| Período do Diagnóstico sem teto | ≤ 366 dias |
| Operador via feedbacks não publicados no próprio Acompanhamento | Só `PUBLISHED` na visão do colaborador |
| Arquivo bruto da Central lido só por id | Filtro por organização quando o id vem da requisição |
| Agent vinculava base de outro Grupo e assuntos proibidos inexistentes | Base global ou do mesmo Grupo; assuntos da organização |
| Id malformado gerava 500 em dezenas de rotas | `22P02/22007/22008` do PostgreSQL → 400 `INVALID_IDENTIFIER` |
| JSON malformado/grande e erro de upload viravam 500 | 400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE`/`FILE_TOO_LARGE` |
| Erro 500 não era registrado | Log estruturado (método, caminho, erro) sem corpo, cookies ou query |
| Respostas da API cacheáveis | `Cache-Control: no-store` em `/api` (imagens mantêm o próprio) |

## SEC-32 — Dependências

Fonte: `npm audit` (GitHub Advisory Database) em 08/10/2026, conferindo a faixa vulnerável contra a versão instalada.

| Pacote | Antes → depois | Aviso | Aplicável? |
|---|---|---|---|
| next | 16.3.4 → 16.3.8 (fixado `~16.3.8`) | GHSA-vcvr-r3jv-pc5j (RCE em `next/og`), GHSA-cjq9-62q9-8jv4 (SSRF no otimizador de imagem), envenenamento de cache SSG/ISR e outros | Sim (runtime); 16.4.0 evitado por ser lançamento de 2 dias |
| sharp | 0.35.4 → 0.35.5 | GHSA-wq5f-xc86-pv6w (librsvg) | Parcial (otimizador de imagem do Next) |
| multer | 2.3.0 → 2.4.0 | GHSA-3pph-fpjx-jg34 (DoS em upload abortado) | Sim |
| proxy-addr | 2.0.7 → 2.0.8 | GHSA-jqcg-44mw-7w3h (IP forjado com IPv4 mapeado) | Sim, agora que `trust proxy` é usado |
| source-map-js, brace-expansion | atualizados no patch | DoS | Baixa (build/arquivamento interno) |
| eslint-config-next | 16.3.4 → 16.3.8 | (alinhamento com o next) | Dev |

Restantes (sem correção compatível): `sprintf-js` via `tedious`/`mammoth` (DoS com especificador de precisão controlado — a INIA
não repassa formato controlado pelo usuário), `uuid` via `exceljs` (só v3/v5/v6 com buffer — exceljs usa v4), `vitest`/`tinypool`/
`@vitest/mocker` (só desenvolvimento; correção exige vitest 5, major), ferramentas do CLI `shadcn` (desenvolvimento).
`npm audit --omit=dev`: frontend 0 vulnerabilidades; backend 7 moderadas (as duas linhas acima).

## SEC-33 — Cabeçalhos de segurança da interface (Melhoria)

`frontend/next.config.ts`: CSP (sem script/estilo/fonte de outro host; `connect-src` só a própria origem, a API e o Gemini Live;
`object-src 'none'`; `frame-ancestors 'none'`; `form-action 'self'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy` (microfone só na própria origem), COOP, HSTS só com HTTPS, sem `X-Powered-By`. A primeira versão manteve
`'unsafe-inline'` em `script-src`; desde 08/10/2026 a CSP é montada no proxy com nonce por requisição e `script-src` não tem mais
`'unsafe-inline'` (R-07, `configuracao-segura.md` §2). Verificado no navegador: login, Acompanhamento, avatar 3D, Indicadores, Organograma,
prévia DOCX e download sem violação (a primeira versão bloqueava as texturas do avatar e foi corrigida com `blob:`).

## SEC-34 — Organização fixa no código (latente)

`00000000-0000-4000-8000-000000000001` em ~30 arquivos (routers de Workflow, Agents, Orquestradores, Base de Conhecimento,
governança, regras de indicador, QA Lab, construção de prompt…). Hoje a instalação cria exatamente essa organização e nenhuma outra;
com uma segunda organização, os usuários dela leriam e escreveriam dados da primeira. Corrigido nos pontos tocados por esta
auditoria (casos, publicação de feedback, ingestão legada); o restante está em `pendencias-e-riscos.md` (R-01).

## Verificações sem achado

- **SQL injection**: nenhum valor de requisição ou integração interpolado no texto SQL; `ORDER BY` sempre constante do servidor;
  dialetos de banco externo com identificadores escapados e valores parametrizados.
- **Atribuição em massa**: INSERT/UPDATE sempre com lista explícita de colunas; zod descarta campos desconhecidos.
- **Segredos**: nenhum segredo versionado no repositório nem no histórico (a única ocorrência de padrão de chave Google é um valor
  sintético de teste de redação); `.env*` ignorados; segredos da Central e da IA cifrados (AES-256-GCM) e nunca devolvidos.
- **Renderização**: conteúdo de IA passa por `RichContent` (sem HTML cru, `javascript:` neutralizado); prévia DOCX sanitizada por
  lista de permissões; React 19 bloqueia `javascript:` em `href`.
- **Notificações, Pendências, Acompanhamento do colaborador, aplicação de feedback, avaliações, conversas monitoradas, cenas,
  argumentários, resultados de Workflow**: autorização por dono/escopo correta.
