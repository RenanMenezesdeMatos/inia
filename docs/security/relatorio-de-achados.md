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

---

# Segunda rodada — 17/10/2026

Branch `admin-list-standardization` a partir do HEAD `27726180`, sem commit. Escopo: o sistema inteiro de novo, com atenção ao
que entrou depois da primeira rodada (≈ 400 arquivos do backend e 320 do frontend: intervenções e políticas de acompanhamento,
reports recorrentes, INIA para lideranças, pacote de configuração, Central de Dados com SQL Server real, multi-instância). A
revisão foi dividida em quatro frentes (autenticação/plataforma, autorização por objeto, Central de Dados/arquivos/SQL,
IA/voz/workflows) mais infraestrutura e dependências; os relatórios de trabalho de cada frente, com a tabela de cobertura rota a
rota, estão em [anexos/rodada-2026-10-17/](anexos/rodada-2026-10-17/). Nenhum achado Crítico ou Alto; os Médios foram todos
tratados (corrigidos, ou com decisão de produto registrada em `pendencias-e-riscos.md`).

Mesma classificação da primeira rodada. Os IDs são os das frentes (AUTH, SCOPE, DATA, AI, INFRA). SCOPE-01 e AI-03 são o mesmo
achado, encontrado por duas frentes.

## Resumo

| ID | Achado | Gravidade | Tipo | Situação |
|---|---|---|---|---|
| AUTH-1 | Trava de login por e-mail contornável com tentativas simultâneas (20 paralelas = 20 senhas conferidas) | Média | Confirmada | Corrigido |
| AUTH-2 | Rajada paralela passava inteira pelo teto de recusas por IP; fila do bcrypt sem teto (login e ciência travados por minutos) | Média | Confirmada | Corrigido |
| AUTH-3 | Qualquer pessoa trava o login de qualquer conta, inclusive do Administrador geral (5 senhas erradas a cada 15 min) | Média | Confirmada | Corrigido |
| AUTH-13 | Administrador de Grupo pré-cadastra o e-mail de quem vai chegar pela base e fica com a conta (Grupo/nível reais vêm da carga) | Média | Confirmada | Corrigido |
| AUTH-5 | Delegação concede papéis com permissões que quem concede não tem; com a senha temporária, vira conta-fantoche (R-05 ampliado) | Média | Confirmada (desenho) | Pendente — decisão de produto |
| SCOPE-01 / AI-03 | Monitoramento de conversas mostrava respostas e cartões da liderança com pessoas fora do escopo de quem lê | Média | Confirmada | Corrigido |
| SCOPE-02 | Simulação de política, avaliações gravadas e o caso de supervisão revelavam intervenções (inclusive avaliação de continuidade) a quem não pode vê-las | Média | Confirmada | Corrigido |
| DATA-1 | Guarda de ZIP confiava no tamanho declarado (XLSX de 389 KB → 400 MB; imagem-bomba no DOCX a cada prévia); PDF sem guarda | Média | Confirmada | Corrigido (PDF, DOCX e XLSX lidos em processo filho com teto — R-24, 18/10) |
| DATA-4 | MySQL/MariaDB "validando o certificado" não conferia o nome do servidor | Média | Confirmada | Corrigido |
| DATA-5 | Fonte de banco nova nascia com TLS sem validar certificado (SQL Server incluso) | Média | Confirmada | Corrigido (fontes novas) |
| AI-01 | Chamadas de ferramenta por rodada sem teto (uma pergunta → dezenas de especialistas/Orquestradores em paralelo) | Média | Confirmada | Corrigido |
| AI-02 | Feedback publicado a partir de nó Orquestrador gravava o texto da IA como "evidência encontrada" | Média | Confirmada | Corrigido |
| INFRA-1 | Limites por caminho (ações caras, sessões de voz, áudio) contornáveis com maiúsculas ou barra final | Média | Confirmada | Corrigido |
| INFRA-2 | Serviços do Windows como LocalSystem; `.env` com segredos sem ACL restrita | Média | Confirmada | Corrigido parcialmente (opção nova; padrão mantido) |
| AUTH-4 | Mudar o Grupo pelo cadastro mantinha o Subgrupo antigo (a pessoa seguia no escopo do Grupo antigo) | Baixa | Confirmada | Corrigido |
| AUTH-6 | Cadastro de pessoa aceitava senha provisória escolhida por quem cadastra | Baixa | Confirmada | Corrigido |
| AUTH-7 | Pessoa desligada pela base mantinha a conta; reativada, voltava com a senha e os tokens antigos | Baixa | Confirmada | Corrigido |
| AUTH-8 | API em produção aceitava o `JWT_SECRET` de exemplo e qualquer `DATA_HUB_SECRET_KEY` | Baixa | Preventiva | Corrigido (chave de cifra: aviso) |
| AUTH-9 | `config:importar` lia (e enviava ao destino) qualquer arquivo da máquina por caminho com `..` no pacote | Baixa | Confirmada | Corrigido |
| AUTH-10 | Cookie de sessão de Administrador geral gravado dentro da pasta do pacote, que circula entre máquinas | Baixa | Confirmada | Corrigido |
| AUTH-11 | Capa do perfil (e fundo do cenário) servida a toda a organização com EXIF/GPS do celular | Baixa | Confirmada | Corrigido |
| AUTH-12 | Política de senha sem bloqueio de senhas comuns (Senha123, Vivo2026, Primavera2026) | Baixa | Confirmada | Corrigido |
| AUTH-14 | Limite da criação de senha do primeiro acesso por IP (NAT/Citrix: 20 por 15 min para a operação inteira) | Baixa | Confirmada | Corrigido |
| AUTH-15 | `auth_login_attempts` crescia sem limpeza | Baixa | Confirmada | Corrigido |
| AUTH-16 | CSRF dependia só da presença de `Origin`/`Sec-Fetch-Site` | Baixa | Preventiva | Não alterado — ver R-26 |
| AUTH-17 | Endurecimento: `TRUST_PROXY` com rede `/0`, upload do perfil sem teto por conta, cookie sem `__Host-`, CORS padrão em produção | Informativa | Preventiva | Parcial (`/0` e teto do perfil corrigidos) |
| SCOPE-03 | Responsável/aprovador gravado na intervenção mantém o acesso depois de perder a relação com o colaborador | Baixa | Confirmada | Pendente — R-27 |
| SCOPE-04 | "Tentar de novo" da análise de IA de report sem teto por conta | Baixa | Preventiva | Corrigido |
| DATA-2 | Negação do banco interno comparava só o texto do host (pelo IP ou outro nome, passava) | Baixa | Confirmada | Corrigido |
| DATA-3 | Azure WireServer e metadados da Alibaba fora da lista fixa de destinos negados | Baixa | Preventiva | Corrigido |
| DATA-6 | Ligação credencial × destino não incluía a CA do banco nem a chave do servidor SFTP | Baixa | Confirmada | Corrigido |
| DATA-7 | DNS rebinding na política de destinos (R-03) | Baixa | Hipótese | Pendente — R-03 |
| DATA-8 | Carga de Colaboradores liga pelo e-mail contas criadas à mão (inclusive administrativas) e pode inativá-las | Baixa | Confirmada (desenho) | Parcial — R-28 |
| DATA-9 | Teto das ações caras não cobria amostra, listagem SFTP e criação de conjunto (que conectam ao destino) | Baixa | Confirmada | Corrigido |
| DATA-10 | API Pull sem teto da carga inteira (só 50 MB por página × até 10 mil páginas) | Baixa | Confirmada | Corrigido |
| DATA-11 | Padrão de arquivo do SFTP virava regex com retrocesso exponencial (event loop parado 64 s) | Baixa | Confirmada | Corrigido |
| DATA-12/13 | API Push lê o corpo antes do token; Idempotency-Key sem conferir o corpo; API Pull aceita `http://` com credencial; Markdown com nome vindo do feed; `\` no nome do arquivo | Informativa | Confirmada | Parcial (Markdown e nome de arquivo corrigidos) — R-29 |
| AI-04 | Lista nominal + contagem por unidade revelavam o motivo protegido do afastamento (INSS/maternidade) | Baixa | Confirmada | Corrigido |
| AI-05 | Restringir o alcance de uma base não tirava a base dos Agents que já a usavam | Baixa | Confirmada | Corrigido |
| AI-06 | "Testar diagnóstico" aceitava Agent de outro Grupo (bases dele voltavam a quem testou) | Baixa | Confirmada | Corrigido |
| AI-07 | Verificação "literal" da evidência aceitava 1 caractere ou só aspas | Baixa | Confirmada | Corrigido |
| AI-08 | Link externo escrito pela IA (induzido por transcrição/base) virava link clicável "da INIA" | Baixa | Preventiva | Corrigido |
| AI-09 | Voz: sessões Live vivas sem teto por conta; `/tool-call` continuava gastando IA depois que a pessoa saía | Baixa | Confirmada | Corrigido (medição do Live: R-30) |
| AI-10 | Transcrição do próprio sujeito vai ao provedor sem redação de PII | Informativa | Confirmada | Pendente — decisão de DPA (R-31) |
| INFRA-3 | Banco interno usado com superusuário do PostgreSQL sem aviso | Baixa | Preventiva | Corrigido (aviso) |
| DEP-1 | Dependências: produção do frontend sem alerta; backend com 6 moderadas transitivas sem caminho de exploração; críticas só em ferramentas de desenvolvimento | Informativa | — | Sem mudança — R-14 atualizado |

## Detalhe — autenticação, sessão e plataforma

### AUTH-1 — Trava de login com tentativas simultâneas
- **Evidência**: `authenticate.ts` lia as falhas, conferia a senha (bcrypt, ~60 ms) e só então gravava a falha. Prova de conceito
  da frente A1: 20 logins errados em paralelo para o mesmo e-mail → 20 senhas conferidas. Prova no PostgreSQL (antes da correção):
  30 paralelas → 30 conferências.
- **Correção**: a tentativa é RESERVADA (gravada como falha) antes de qualquer conferência e o resultado substitui a reserva
  (`CredentialStore.reserveAttempt/resolveAttempt`, `postgres-credential-store.ts`). Para N tentativas simultâneas, a última a
  contar vê as reservas de todas: no máximo `LOGIN_MAX_FAILURES` chegam ao bcrypt, sem trava nem transação. Senha não conferida
  (fila cheia, falha da thread) não fica contando como falha.
- **Teste**: `auth-flows.test.ts` (20 simultâneas → ≤ 5 conferências); `auth/testing/login-throttle-proof.test.ts` (PostgreSQL
  real, pool de 12 conexões: 30 simultâneas → ≤ 5; falha com o código antigo).

### AUTH-2 — Teto por IP e fila do bcrypt
- **Evidência**: regras "só falhas" do `rate-limit.ts` conferiam no início e gravavam no fim: 40 logins paralelos de e-mails
  distintos com teto 3 → 40 atendidos. A fila do `password-hasher.ts` não tinha teto: uma rajada empurrava login e ciência para o
  fim de uma fila de minutos.
- **Correção**: regras `countOnlyFailures` RESERVAM a vaga (`consume`) e a DEVOLVEM quando a resposta é sucesso (`release`, novo
  na loja em memória e na do PostgreSQL, na mesma janela). Fila de verificações limitada a `PASSWORD_QUEUE_LIMIT` (16 por thread):
  acima disso a tarefa é recusada na hora com 503 `AUTH_BUSY`.
- **Teste**: `http-security.test.ts` (12 paralelas com teto 3 → 3 × 401 e 9 × 429); `postgres-rate-limit-store-proof.test.ts`
  (reserva/devolução entre dois processos); `password-hasher.test.ts` (fila cheia → 503 imediato; as aceitas terminam certas).

### AUTH-3 — Bloqueio de conta por terceiros
- **Evidência**: 5 falhas em 15 min travavam o e-mail para qualquer origem — inclusive a senha certa do dono.
- **Correção**: DISPOSITIVO CONHECIDO (`auth/infrastructure/known-device.ts`). Login certo grava o cookie `inia_device`
  (`<conta>.<aleatório>.<HMAC>`, httpOnly, `Path=/api/v1/auth`, 180 dias; não é sessão). Com o e-mail travado, um cookie válido
  DESTA conta passa pela trava do e-mail e usa uma trava própria do dispositivo (5 falhas). Sem o cookie, continua travado.
- **Teste**: `auth-flows.test.ts` (trava provocada por outro + dono com o cookie entra; cookie de outra conta não fura; 5 erradas
  travam o dispositivo); `known-device.test.ts` (forjado/trocado/truncado = inválido); `http-security.test.ts` (cookie emitido no
  login, `Path` e `HttpOnly`, não reemitido para a mesma conta).

### AUTH-4 — Subgrupo antigo ao trocar de Grupo
- **Correção**: `PATCH /admin/users/:id` zera `subteam_id` quando o Grupo muda (`user-account-router.ts`).
- **Teste**: `account-access-lifecycle-proof.test.ts` (PostgreSQL: pessoa A/A1 → B; Subgrupo nulo; administrador do Grupo A
  recebe 404).

### AUTH-6 — Senha provisória escolhida por quem cadastra
- **Correção**: `POST /admin/users` gera a senha (`generateTemporaryPassword`, ≈ 69 bits) e a devolve UMA vez (`issued`); o
  campo `password` do corpo é ignorado. A tela de cadastro perdeu o campo e mostra o `TemporaryPasswordDialog` (o mesmo de
  "Habilitar acesso").
- **Teste**: `user-account-router.identity.test.ts` (senha do corpo ignorada, formato, nunca gravada em claro, diferente a cada
  cadastro); `users-page.test.tsx` (sem campo; senha mostrada depois de criar).

### AUTH-7 — Desligamento pela base
- **Correção**: a carga de Colaboradores que desativa uma pessoa ATIVA desabilita a conta dela (mesma instrução do "Desabilitar
  acesso": conta inativa, sessões derrubadas, temporária apagada; auditoria `ACCESS_DISABLED` motivo
  `PERSON_DEACTIVATED_BY_SOURCE`). Exceção: conta de Administrador geral só tem as sessões derrubadas
  (`ACCESS_SESSIONS_REVOKED`) — a organização não fica sem quem libere acessos. `disableAccountsFromSource` em
  `data-hub/application/writers/person-identity.ts`.
- **Teste**: `person-identity-proof.test.ts` (desligada → conta desabilitada e versão de sessão +1; reativada pela base → conta
  continua desabilitada; Administrador geral só perde as sessões).

### AUTH-8 — Segredos de produção
- **Correção**: `productionSecretProblems` (`config/env.ts`): em produção a API não sobe com `JWT_SECRET` publicado (código,
  `.env.example`), começando por "troque/change/exemplo", com menos de 32 caracteres ou menos de 10 caracteres distintos.
  `DATA_HUB_SECRET_KEY` fraca só AVISA no log (`weak_production_secret`): trocá-la deixaria ilegíveis as credenciais cifradas —
  procedimento em `configuracao-segura.md`. Os serviços do Windows passam a definir `NODE_ENV=production` no próprio serviço.
- **Teste**: `http-security.test.ts` (valores de exemplo/curtos/repetitivos recusados; o que o `env:init` gera passa; chave fraca
  só avisa).

### AUTH-9 / AUTH-10 — Pacote de configuração
- **Correção**: `lerArquivoDoPacote` (`scripts/config-transfer/formato.ts`) só lê dentro de `arquivos/` e `imagens/` do pacote e
  confere o SHA-256 gravado na exportação; a conferência roda para todos os arquivos ANTES de conectar (simulação inclusive). A
  sessão do destino fica no perfil de quem importa (`~/.inia/sessoes/config-importar-<hash da pasta>.json`, 0600), nunca no
  pacote; um `.sessao-destino.json` antigo é encerrado no servidor e apagado.
- **Teste**: `config-transfer.test.ts` (`../`, absoluto, raiz do pacote, SHA-256 trocado → recusado sem ler nada fora; sessão
  fora da pasta).

### AUTH-11 — Metadados das imagens
- **Correção**: `shared/infrastructure/image-metadata.ts` remove, sem decodificar a imagem, EXIF/XMP/IPTC/comentários (JPEG),
  blocos de texto/eXIf/tIME (PNG) e EXIF/XMP (WebP); a orientação da foto volta num EXIF mínimo. Aplicado à foto/capa do perfil e
  às imagens do cenário da INIA, antes de gravar.
- **Teste**: `image-metadata.test.ts` (GPS, aparelho, XMP e IPTC somem; pixels e dimensões iguais; orientação preservada) e
  conferência manual com o `sharp`: JPEG e WebP reais com pixels idênticos.

### AUTH-12 — Senhas comuns
- **Correção**: `COMMON_PASSWORD` em `auth/domain/password-policy.ts` — "palavra comum (senha, mudar, vivo, inia, meses, estações,
  times…) + números/símbolos", com leitura de `@`→a e `$`→s, e letras quase todas iguais. Espelhada no checklist da tela.
- **Teste**: `auth-domain.test.ts`; `first-access.test.tsx`.

### AUTH-13 — Conta pré-cadastrada assumindo pessoa da base
- **Evidência**: `linkByAccountEmail` ligava a matrícula nova à pessoa cadastrada à mão com o mesmo e-mail e o upsert gravava ali
  o Grupo e o nível reais — a senha continuava a de quem cadastrou.
- **Correção**: o vínculo automático continua (é desenho: "uma pessoa, um cadastro"), mas quando a pessoa tinha Grupo e a base a
  põe em OUTRO Grupo ou num nível de liderança que o cadastro não tinha, a conta é desabilitada (sessões derrubadas, auditoria
  `LINKED_BY_SOURCE_NEW_PLACEMENT`, aviso `DATA_PERSON_LINK_ACCESS_DISABLED` na quarentena) até quem administra o lugar novo
  liberar de novo. Pré-cadastro no mesmo Grupo e nível segue funcionando.
- **Teste**: `person-identity-proof.test.ts` (Grupo A → Supervisora do Grupo B: ligada e desabilitada; mesmo Grupo: segue ativa).

### AUTH-14 / AUTH-15 / AUTH-17
- **Correção**: primeiro acesso com teto por SESSÃO (10 / 15 min) e, por IP, só as recusas (300 / 15 min) — `app.ts`
  (`sessionCookieKey`). Limpeza horária de `auth_login_attempts` com mais de 30 dias (`purgeOldLoginAttempts`, tarefa
  `login-attempts-purge`). `TRUST_PROXY` com rede `/0` recusado na subida. Envio de foto/capa limitado a 20 por minuto por conta.
- **Teste**: `http-security.test.ts`; `login-throttle-proof.test.ts` (retenção).

### INFRA-1 — Limites por caminho
- **Evidência**: o Express roteia sem diferenciar maiúsculas e aceita barra final; os limitadores comparavam `request.path` cru:
  `POST /admin/agents/x/TEST` ou `/x/test/` chegavam ao teste do Agent sem o teto (reproduzido).
- **Correção**: `routePath()` em `app.ts` (minúsculas, sem barra final) usado por todos os limitadores montados por caminho.
- **Teste**: `http-security.test.ts` (variações → 429; falham com o código antigo).

### INFRA-2 / INFRA-3 — Instalação
- **Correção**: `instalar-servicos.ps1 -ContaServico "NT AUTHORITY\LocalService"` (ou gMSA) grava `<serviceaccount>` no WinSW e
  dá à conta leitura da pasta e escrita em `logs` e `frontend\.next`; sem a opção, aviso de LocalSystem. Sempre: `backend\.env` e
  `frontend\.env.local` com ACL só para Administradores, SYSTEM, quem instala e a conta do serviço. `doctor`/`db:connect` avisam
  quando o usuário do banco interno é superusuário.
- **Teste**: sem PowerShell nesta máquina — **não validado em Windows** (ver R-11 e R-32).

## Detalhe — autorização por objeto, Central de Dados e IA

### SCOPE-01 / AI-03 — Monitoramento de conversas
- **Evidência**: o alcance do leitor era decidido pelo Grupo do DONO da conversa; as mensagens voltavam com texto e cartões da
  liderança sem nenhuma conferência contra o escopo de quem lê (o dono, ao reabrir, já tinha os cartões revalidados).
- **Correção**: `loadMonitoredMessages` recebe o filtro do LEITOR (`conversation-monitoring-router.ts`: cartões do próprio dono +
  estruturas que o escopo de `indicators.view` de quem lê alcança). Resposta com algum cartão fora disso sai sem texto e sem
  cartões (`OUT_OF_READER_SCOPE_NOTICE`); sem filtro, falha fechada. A prévia da lista também não mostra resposta com cartão.
- **Teste**: `conversation-monitoring.test.ts`; `assistant-conversations-proof.test.ts` (SQL da prévia no PostgreSQL real).

### SCOPE-02 — Intervenções reveladas por simulação, avaliação e caso
- **Correção**: simulação sem acesso às intervenções da pessoa (`canSeeInterventionsOf`) roda com o histórico OCULTO — as
  condições `PRIOR_INTERVENTIONS`/`TIME_SINCE_INTERVENTION` ficam inconclusivas sem ler nada (`INTERVENTIONS_NOT_VISIBLE`) e as
  decisões não consultam intervenções existentes. Detalhe e reavaliação de avaliação gravada exigem ver as intervenções da
  pessoa. Casos abertos por intervenção (manual ou política) ganham título e resumo neutros — tipo e justificativa ficam na
  intervenção.
- **Teste**: `condition-resolvers.test.ts`; `interventions-proof.test.ts` (percurso completo no PostgreSQL continua passando).

### SCOPE-04 — Reports
- **Correção**: prévia, "Executar agora" e nova tentativa da análise entram no teto das ações caras por conta (`app.ts`).
- **Teste**: `http-security.test.ts`.

### DATA-1 — Arquivos comprimidos
- **Correção**: `zip-guard.ts` descompacta cada entrada de verdade (`inflateRawSync` com teto = o tamanho declarado); entrada que
  passa do declarado, tem tamanho real diferente, é cifrada ou usa método desconhecido recusa o pacote — antes de exceljs/mammoth
  (upload, SFTP, importação e cada prévia DOCX). PDF: `pdf-guard.ts` mede cada fluxo FlateDecode fora da thread principal antes
  do pdf-parse (32 MB por fluxo de conteúdo, 64 MB por imagem, 512 MB no total, taxa > 200:1 recusada fora das imagens).
  **18/10 (R-24)**: pdf-parse e mammoth (texto do upload e prévia DOCX) rodam num processo filho
  (`shared/infrastructure/isolated-parser/`): parser numa worker thread, com a thread principal do filho vigiando a memória
  residente do processo inteiro (768 MB) — o pdf.js descompacta em ArrayBuffers fora do heap, que `--max-old-space-size` (512 MB)
  não limita —, prazo de 30 s com `SIGKILL`, ambiente sem os segredos da API, 2 filhos simultâneos e fila de 8. Estouro, prazo ou
  morte do filho: 422 `KNOWLEDGE_FILE_TYPE_MISMATCH`; erro do parser: 422 `KNOWLEDGE_EXTRACTION_FAILED`; fila cheia: 503.
  **18/10 (R-24, XLSX)**: o exceljs da Central de Dados (upload, amostra, carga de arquivo e SFTP) roda no mesmo processo filho
  (job `data-hub/infrastructure/xlsx-parser-job.ts`), com teto próprio medido — heap 1.536 MB, residente 2.048 MB, 60 s, 1 filho por
  processo e fila de 4 — e as linhas voltando em lotes de 2 mil pelo IPC (a tabela nunca é copiada inteira de uma vez). Estouro,
  prazo ou morte do filho: `DATA_FILE_INVALID` com o motivo; fila cheia: `DATA_FILE_READER_BUSY` (transitório). No upload e na
  amostra, erro de leitura de arquivo vira 422/503 com o código (antes, 500). **19/10**: a guarda de ZIP confere cada entrada em
  fluxo, só contando os bytes (blocos de 64 KB descartados, zlib no pool de threads): conferir a planilha de 820 mil linhas (302 MB
  descompactados) passou de +0,5 GB e 270 ms de laço travado para ~+70 MB e laço livre, com os mesmos motivos de recusa.
- **Teste**: `zip-guard.test.ts` (inclusive entrada legítima de 200 MB conferida sem a memória subir — a versão anterior subia
  +393 MB e falha nesse teste) e `pdf-guard.test.ts` (bombas montadas no teste); as bombas da frente A3 recusadas; XLSX de 20 mil
  linhas, manuais .docx/.pdf do repositório (até 198 MB descompactados) aceitos. `isolated-parser.test.ts` (prazo, memória dentro e
  fora do heap, erro, fila, ambiente sem segredos), `text-extractor.test.ts` (PDF gerado e manual real idênticos ao parser no
  processo; bomba `[/FlateDecode /RunLengthDecode]` de 35 KB — passa na pré-varredura; a de 23 KB já levava o processo a 2,4 GB —
  recusada sem a memória do teste subir) e `knowledge-router.security.test.ts` (422 sem gravar nada). Os 20 manuais de `docs/manuais`
  conferidos pelo `dist/` compilado (texto e prévia idênticos; 0,2–0,4 s por arquivo). `xlsx-parser.test.ts` (planilha variada — datas, fórmulas,
  texto rico, link, erro, célula mesclada, segunda aba — e 20 mil linhas idênticas ao exceljs no processo, com e sem amostra;
  mensagens de antes; guarda de ZIP antes; teto de memória e prazo recusados sem a memória do teste subir; BUSY transitório) e a
  prova opcional `INIA_XLSX_PROOF=1 npx vitest run xlsx-limits-proof` (tetos reais: 200 mil linhas lidas; 820 mil linhas, 47 MB,
  recusadas em ~10 s).

### DATA-4 / DATA-5 / DATA-6 — TLS e credencial dos bancos e do SFTP
- **Correção**: MySQL/MariaDB com validação passa `verifyIdentity: true` (`mysql-session.ts`). Fonte de banco NOVA sem modo
  escolhido nasce em `VERIFY_FULL` (`withNewSourceDefaults`, `source-service.ts`) e a tela nasce nesse modo para qualquer banco;
  fontes gravadas sem o campo continuam no padrão antigo. `secretTargetOf` inclui o hash da CA do banco e a chave do servidor
  SFTP: trocar/apagar exige a senha de novo.
- **Teste**: `secret-binding.test.ts`; `database-wizard.test.tsx`. Sem banco externo com certificado nesta máquina: conexão real
  não executada (R-08).

### DATA-2 / DATA-3 — Política de destinos
- **Correção**: o banco interno é negado também pelo IP e por qualquer nome que resolva para ele, e — quando ele é a própria máquina
  — pelos IPs das placas de rede na mesma porta (`withDeniedAddresses`). Azure WireServer (168.63.129.16) e metadados da Alibaba
  (100.100.100.200) entram na lista fixa.
- **Teste**: `outbound-destination-policy.test.ts`.

### DATA-9 / DATA-10 / DATA-11 / DATA-13
- **Correção**: amostras, listagem SFTP e criação de conjunto no teto das ações caras; API Pull com teto de 200 MB por carga
  (`MAX_API_PULL_RUN_BYTES`); padrão SFTP casado sem regex (`matchesGlob`, linear); células das tabelas Markdown da liderança
  escapam `[ ] \` * _ < >`; `\` sai do `filename` do download.
- **Teste**: `glob.test.ts` (padrão de 8 `*` contra 255 letras < 50 ms); `api-pull-volume.test.ts`; `query-table-markdown.test.ts`.

### AI-01 — Teto de chamadas de ferramenta
- **Correção**: `MAX_TOOL_CALLS_PER_ROUND = 6` e `MAX_TOOL_CALLS_PER_TURN = 12` em `run-orchestrated-reply.ts` (as excedentes voltam
  ao modelo como "não executada"); roteamento declarado pelo Workflow não conta. Consulta de processo da liderança: no máximo 2
  Orquestradores por resposta (`process-consultation.ts`).
- **Teste**: `run-orchestrated-reply.test.ts` (30 pedidas por rodada → 12 executadas no turno).

### AI-02 / AI-07 — Evidência
- **Correção**: o feedback publicado a partir de Orquestrador usa como evidência só as citações literais já conferidas pelos
  especialistas de contrato FEEDBACK; sem nenhuma, diz que não há trecho verificado e grava `evidenceVerified: false`, que as
  políticas de acompanhamento não contam como evidência verificável (`condition-resolvers.ts`). A síntese segue como
  recomendação. `isVerbatimEvidence` exige ao menos 12 caracteres e duas palavras.
- **Teste**: `create-orchestrator-feedback.test.ts`; `create-feedback-records.test.ts` (snapshot atualizado);
  `run-agent.test.ts`.

### AI-04 / AI-05 / AI-06 — Dados sensíveis, bases e Agents
- **Correção**: `sensitiveBreakdownAllowed` (`management-metrics.ts`) — tipos sensíveis separados só com 5+ pessoas e, entre os
  afastados sensíveis, nenhum ou dois tipos com 2+ cada; vale para o organograma e para a ferramenta de força de trabalho. A
  recuperação de conhecimento aplica a cada busca a mesma regra de alcance do cadastro do Agent. "Testar diagnóstico" só aceita
  Agent global ou de Grupo/Subgrupo que quem testa administra, e que valeria para o colaborador escolhido.
- **Teste**: `management-metrics.test.ts`; `leadership-tools-v3.test.ts`; `agent-knowledge-scope-proof.test.ts` (PostgreSQL;
  falha com o código antigo); `diagnostic-strategy-proof.test.ts`.

### AI-08 / AI-09 — Links e voz
- **Correção**: `RichContent` só torna clicável caminho da própria INIA e domínios de `NEXT_PUBLIC_INIA_TRUSTED_LINK_HOSTS`;
  link externo aparece como texto com o domínio à vista. Voz: teto de 60 sessões novas por conta a cada 30 minutos (a sessão Live
  vale 30 min) além do teto por minuto; `/tool-call` cancela as chamadas de IA quando a conexão cai.
- **Teste**: `rich-content.test.tsx`; `follow-up-entry.test.tsx`; `http-security.test.ts`.

## Verificações executadas (segunda rodada)

| Verificação | Comando | Resultado |
|---|---|---|
| Typecheck do backend | `cd backend && npx tsc -p tsconfig.json --noEmit` | sem erro |
| Typecheck dos scripts | `cd backend && npm run typecheck:scripts` | sem erro |
| Lint do backend | `cd backend && npx eslint .` | sem erro nem aviso |
| Suíte do backend | `cd backend && npx vitest run` | 419 arquivos, **4.760 testes passando**, 0 falhas (413 pulados = provas de banco e casos condicionais). Linha de base antes das correções: 4.713 passando e 1 falha intermitente de socket em `notifications-router.test.ts`, que passa isolada |
| Typecheck do frontend | `cd frontend && npx tsc --noEmit` | sem erro |
| Lint do frontend | `cd frontend && npx eslint` | 0 erros, 1 aviso preexistente (`operator-inia-chat.tsx`, `react-hooks/set-state-in-effect`, arquivo não alterado) |
| Suíte do frontend | `cd frontend && npx vitest run` | 159 arquivos, **1.894 passando**, 0 falhas. Numa execução anterior com a máquina sob carga, o teste de desempenho de `lib/avatar/lipsync/pt-br/g2p.test.ts` ("fonemização < 5 ms") marcou 6,97 ms — arquivo não alterado; passa isolado e na execução final |
| Build | `npm run build` (backend `tsc` e `next build`) | concluídos sem erro |
| Provas de banco (PostgreSQL de teste) | `INIA_DB_PROOF=1 NODE_ENV=test npx vitest run <módulos> --no-file-parallelism` (auth, access, data-hub, interventions, knowledge, profile-preferences, inia-scenes, org-structure, leadership-analytics, reports, feedback-application, assistant, users, indicator-diagnosis, shared, main) | 989 passando. Duas falhas por **outra sessão usando o mesmo `inia_test` ao mesmo tempo** (worktree `auditoria-eficiencia` rodando `analytics-read-model-proof` e `data-hub-proof`, com a mesma organização fixa): `knowledge-material-access-proof` (statement timeout ao inserir pessoa) — repetida sozinha: **9/9 passando**; `data-hub-proof` — repetida sozinha depois da outra sessão: **17/17**, com `person-identity-proof` 8/8 |
| Provas escritas nesta rodada | `login-throttle-proof`, `postgres-rate-limit-store-proof` (reserva/devolução), `person-identity-proof` (3 casos novos), `account-access-lifecycle-proof` (Subgrupo), `agent-knowledge-scope-proof`, `diagnostic-strategy-proof` (Agent de outro Grupo) | passando; `login-throttle-proof` e `agent-knowledge-scope-proof` conferidas **falhando com o código antigo** |
| Bombas da frente A3 | XLSX/DOCX/PDF montados pela frente A3 contra as guardas novas | todas recusadas; manuais `.docx`/`.pdf` e um XLSX de 20 mil linhas aceitos |
| Imagens reais | JPEG/WebP com EXIF de celular gerados com `sharp` | pixels idênticos depois da limpeza, orientação preservada, modelo do aparelho removido |
| `npm audit` | backend e frontend, com e sem dependências de desenvolvimento | ver DEP-1 / R-14 |
| Segredos versionados | `git grep` por padrões de chave (Google, OpenAI, Anthropic, GitHub, Slack, AWS, chave privada) e histórico de `.env` | só valores falsos em testes; nenhum `.env` no histórico |

# Quarta rodada — 28 e 29/10/2026

Auditoria com a skill de auditoria de segurança da Cloudflare (`github.com/cloudflare/security-audit-skill`, perfil padrão, com
parada antecipada declarada depois de duas ondas de caçadores) sobre `6b5667ad` + árvore de trabalho da branch
`admin-list-standardization`. Cada candidato foi validado por um verificador independente; reproduções em sandbox, com um
PostgreSQL 17 descartável e sem nenhuma chamada a modelo. Resultado: 18 confirmados (9 médios, 9 baixos), 4 a validar, 8 unidades
adiadas e 1 bloqueada. O registro completo (rastro, reprodução, correção sugerida, `findings.json` e `coverage-ledger.json`) fica
fora do repositório, em `~/security-audit-skill/inia/run-1/`.

O dono do produto escolheu corrigir primeiro o grupo "isolamento e escopo" (28–29/10, commit `3ee9e9b9`), depois os médios
ativos por padrão C04, C06, C07 e C08 (29/10, `9958d7e1`) e então os baixos C10–C16 e C18 (29/10; no C14 decidiu manter o tipo de afastamento só para operadores). Dos itens "a validar", N01 e N04 foram confirmados no banco descartável e corrigidos (29/10); a unidade interrompida da auditoria (h19, custódia nas cargas) foi investigada, confirmada e corrigida (29/10); o N03 (permissões do backup) foi corrigido no script sem esperar a conferência na VM (29/10); os demais estão em `pendencias-e-riscos.md` R-38; a decisão sobre o N02 está em R-37.

| ID | Gravidade | O que acontecia | Correção | Teste |
|---|---|---|---|---|
| C05 | Média (impacto alto) | O Output publicava como "resultado de Agent" qualquer objeto com esse formato e confiava na organização e na pessoa escritas nele: um campo de um Orquestrador publicava feedback em outra organização, com "trecho da transcrição" não conferido | Só a raiz de um nó "Chamar agente" do grafo (`agentNodeIds`), e só para a organização e o colaborador da matrícula; o grupo vem do banco, na organização. `createApprovedFeedback` confere pessoa e grupo na organização e publica com o escopo dela | `output-executor.test.ts` (3 recusas novas); suíte de feedbacks |
| C02 | Média | `canManageScope` autorizava Subgrupo só pelo `subteamId`; o `teamId` enviado (de outro Grupo) era gravado e passava a decidir o Grupo do Agent: bases e argumentários do outro Grupo na prévia do prompt | `normalizeScopedTarget`: Subgrupo sempre com o Grupo-pai real da organização (`teamId` divergente = recusa), em Agents, Orquestradores, bases, regras de indicador e Workflows (criar e mover). O Grupo de um Agent de Subgrupo passa a vir sempre do Subgrupo na checagem de bases, na recuperação e no argumentário | `manageable-scopes.test.ts`; harness da auditoria (v04): 403/422/403 e nada gravado |
| C03 | Média | `/admin/checkpoints` (leitura) aceitava `knowledge.manage` em qualquer escopo e devolvia o literal de bases de outros Grupos | Rota montada com `knowledge.manage` na organização inteira (a tela foi retirada em 07/10; a governança já exigia isso) | `checkpoint-registry-proof` (403 nas três leituras para o administrador escopado) |
| C01 | Média | Na monitoria de conversas, o recado de Workflow entregue a um gestor sobre colaborador de outro Grupo aparecia completo (lista e mensagens) a quem lê só o Grupo do gestor | O sujeito do recado (operador da interação, pessoa da medição ou sujeito agendado) precisa ser o dono ou estar no alcance do leitor; senão a prévia e TODAS as respostas da INIA da conversa saem com aviso. Matrícula consolidada ou apagada: só a organização inteira vê | `workflow-recado-monitoring-proof` (novo); harness v01 agora falha na asserção do vazamento |
| C09 | Média | Pessoa cadastrada à mão já com a matrícula (e conta) não passava pela custódia do AUTH-13 quando a carga de Colaboradores a punha em outro Grupo ou num nível de liderança | A carga trata a pessoa com conta ativa e sem linhagem `people` como cadastro manual que a base assume agora: mesma regra (conta desabilitada, sessões derrubadas, aviso `DATA_PERSON_LINK_ACCESS_DISABLED`); a carga registra a linhagem mesmo sem mudança de dado | `person-identity-proof` (2 casos novos); harness r18 (cadastro real + carga real): conta desabilitada |
| C17 | Baixa | O colaborador que também administra Agents no Grupo dele (ou na organização) abria e listava o próprio caso de supervisão | `CaseVisibility.viewerPersonId`: o próprio caso nunca é visível (detalhe 404, fora da lista) | `case-router.test.ts`; harness v22 (0 de 2 casos próprios na lista) |
| C07 | Média | Carga de API Push que estava na fila quando o feed ou a fonte foram removidos voltava a ocupar, a cada ciclo, as vagas da fila de TODAS as organizações (com 5 órfãs, a Central de Dados parava para todos) | Remover feed ou fonte encerra as cargas da fila (`CANCELLED`, `DATA_FEED_INACTIVE`, na mesma transação da fonte); o ciclo encerra na hora a órfã que ainda existir | `orphan-runs-proof` (novo); `source-deletion.test.ts`; harness v18: órfãs já canceladas e nunca reivindicadas |
| C04 | Média | Com o painel de usabilidade ligado, o analista (sem `people.manage`) via e exportava INSS/maternidade/paternidade ao lado do nome | Lista, detalhe e CSV mostram `AFASTAMENTO_PROTEGIDO`; o código exato fica na tela de situação funcional | `usability-proof` (caso novo); harness v11: `AFASTAMENTO_PROTEGIDO` no lugar de INSS |
| C06 | Média | Ciclo "Reprovado → refazer" voltando a um nó pago repetia a chamada de IA sem limite (21 chamadas em 40 ciclos no teste da auditoria); desativar o Workflow não parava | Publicação (backend e editor) recusa ciclo por nó pago sem Espera (`WORKFLOW_PAID_CYCLE_WITHOUT_WAIT`); o motor limita no banco as execuções do mesmo nó pago por execução (`WORKFLOW_MAX_PAID_NODE_RUNS`, padrão 5; `WORKFLOW_PAID_NODE_RUN_LIMIT`); Workflow desativado não tem execução reivindicada | paridade de publicação (caso recusado + caso com Espera); `paid-node-run-limit-proof` (novo); harness v17 adaptado: 5 chamadas e execução encerrada; desativado = 0 chamadas |
| C08 | Média | Depois de sair, da inatividade ou de outro login na mesma aba, o Voltar reexibia páginas da conta anterior a partir do cache do roteador do Next | Toda troca de sessão (sair, sair de todos os aparelhos, inatividade, sessão perdida, entrar, criar a senha) carrega a página de novo (`lib/auth/session-navigation.ts`), e a saída espera o logout terminar | `authenticated-app-shell.test.tsx` (novo), `first-access.test.tsx`; tela (29/10): com o código antigo o Voltar mostrou o caso da Larissa sem ir ao servidor; com a correção, nada reaparece (nem depois de outra conta entrar) |
| C10 | Baixa | O `/health` do processo worker devolvia o retrato de métricas internas sem o `INIA_METRICS_TOKEN` documentado | Detalhe só com a trava de `/internal/metrics` (conexão local, sem cabeçalho de proxy, token quando definido); sem ela, só "está de pé" (o instalador continua recebendo 200) | `worker-health.test.ts` (novo) |
| C11 | Baixa | `turnId`/`clientMessageId` escolhidos pelo navegador forjavam o rótulo "Recado enviado por um fluxo" na monitoria | Origem só com a chave EXATA `workflow-output:<uuid>` gravada pelo servidor; o navegador não pode usar os prefixos reservados | `message-origin.test.ts` (novo), `realtime-router-feedback-application.test.ts`; harness v03: 400 "Chave reservada" |
| C12 | Baixa | Filtro livre da URL entrava no cabeçalho do CSV de diagnósticos sem neutralizar fórmula (`;` abria célula nova) | Cada linha do cabeçalho é uma célula escapada como as demais | `diagnostics-router.test.ts` (caso novo) |
| C13 | Baixa | `compare_population` contava a lista de ativos, não quem tem medição: numa janela com um colega só, a "referência" era o valor dele | Mínimo de 4 colegas COM medição na janela (o zero lógico de falta não conta) | harness v09: `POPULATION_TOO_SMALL` na janela de um colega só, referência 300 na janela normal. **Resíduo** (R-38): diferença entre janelas vizinhas ainda isola o dia extra de um colega |
| C14 | Baixa | Subtrair dois recortes, as populações com e sem líderes ou duas datas da consulta de força de trabalho (e pai menos filho no organograma) revelava o tipo de afastamento que a regra do AI-04 escondia célula a célula — o de um líder afastado inclusive, que a liderança não vê em nenhuma outra tela | Decisão de produto (29/10/2026): o tipo só se separa para OPERADORES. A regra do AI-04 passa a olhar só os operadores do recorte (`leaveTypeVisible`), e o afastamento de um líder entra sempre somado como "Afastamento (motivo protegido)" — no organograma (`SENSITIVE_LEAVE`, ao lado dos tipos, com aviso), na consulta de força de trabalho (`AFASTAMENTO_PROTEGIDO`) e nos reports dela. Com e sem líderes, e entre datas, as colunas por tipo são as mesmas | `management-metrics.test.ts` e `leadership-tools-v3.test.ts` (casos novos), `structure-scope-proof`, `person-structure-view.test.tsx`; harness v10 + 2 cenários: o do líder (B) deixou de reproduzir; os de operador (A, C, D) continuam, aceitos (R-37) |
| C15 | Baixa | Report distribuído juntava na mesma entrega destinatários com escopos diferentes acima dos operadores (líderes) | A chave de escopo inclui as pessoas que o escopo de cada um alcança abaixo da âncora, além dos operadores (sem ninguém além deles, a chave é a de sempre) | `report-executor.test.ts` (2 casos novos); harness h04 adaptado: duas entregas, nenhuma linha fora do escopo |
| C16 | Baixa | O colaborador avaliado podia receber e decidir a Revisão humana do próprio resultado (revisor fixo ou promovido durante a espera) e receber os avisos de gestão sobre si | O gravador único da decisão recusa o próprio avaliado (`HUMAN_REVIEW_SELF_DECISION`, 403, nas duas portas); a busca por cargo nos Workflows começa no gestor do avaliado; revisão e escalonamento nunca vão ao avaliado | `submit-human-review-decision.test.ts` (novo), `output-executor.test.ts`; harness v14: avaliado sem aviso e sem decisão; revisão, escalonamento e aviso de gestão para a liderança acima |
| C18 | Baixa | Leitor só de agregados da usabilidade isolava uma pessoa filtrando por cargo único (ou escopo pequeno) | Para quem não vê pessoas identificadas: recorte com menos de 5 pessoas não mostra números (`USABILITY_SMALL_COHORT`, inclusive na exportação); cargo, papel e situação reservados a quem vê pessoas; leitura pela estrutura atual. A tela esconde esses filtros e explica o recorte pequeno | `usability-proof` (caso novo); harness r21: 403 no filtro por cargo |
| N01 | Média (confirmado) | Trocar o destino de uma fonte gravava o endereço novo antes de trocar a credencial, em commits separados: um "Testar conexão" no meio-tempo mandava a credencial guardada do cliente para o endereço novo (com a troca e 4 testes disparados juntos, em 100 de 100 tentativas), e uma falha no meio deixava os dois assim, sem auditoria. O mesmo na troca de endpoint da conexão de IA | Configuração, credencial e auditoria num commit só (`updateSource`; `SecretStore.put/revoke` aceitam a transação de quem chama) e o mesmo em `updateConnection` da IA: quem lê vê o par antigo inteiro ou o novo | `source-rebind-proof` (novo: troca parada no meio, 30 tentativas com 4 leituras, falha no meio) e caso novo no `ai-providers-proof`; no código antigo a prova falha nos 3 cenários (48 vazamentos) e no caso da IA (15 leituras misturadas); no novo, zero |
| N04 | Média (confirmado) | A trava de ZIP lia o diretório de um jeito e o JSZip dos parsers de outro (contagem menor, campo de disco 0xFFFF, vão antes do fim): entradas que a trava não via eram descompactadas sem teto. Um XLSX de 400 KB inflou para 400 MB e derrubou um processo com 256 MB (falta de memória, não tratável); a prévia de DOCX gastava ~500 MB por leitura | `inspectZip` exige volume único, contagens iguais, diretório terminando exatamente no fim, fim do arquivo coerente com o comentário, nenhum registro a mais, sem localizador ZIP64 e sem nome repetido | `zip-guard.test.ts` (5 casos novos: os 4 formatos da auditoria, comentário e nome repetido, planilha real do exceljs); harness v24: os 4 formatos recusados e nada descompactado; o mesmo XLSX de 400 KB é recusado em 0,1 s com 94 MB. Os 16 .docx do repositório continuam aceitos |
| h19 | Média (confirmado) | A custódia da credencial do AUTH-13 só valia no registro que ligava a pessoa cadastrada à mão, e só na carga de Colaboradores (Grupo é opcional nela). Ligada sem Grupo, a pessoa ia depois para outro Grupo pela Estrutura organizacional (ou pela carga seguinte), ou recebia subordinados de outro Grupo, e a conta — cuja senha quem a cadastrou conhecia — continuava ativa, sem registro. A senha temporária ainda não usada também seguia valendo depois da mudança | Custódia pendente: na primeira aplicação da base a quem foi cadastrado à mão — por Colaboradores ou por Estrutura, inclusive quando a pessoa só aparece como gestor —, o lugar do cadastro manual fica guardado (`people.pending_custody_*`, migration 163) e a carga que definir o lugar aplica a regra do AUTH-13 (a primeira versão, `4859d40f`, só cobria a ligação pela carga de Colaboradores; a preparação AppSec, APPSEC-02, achou a Estrutura como primeira carga de fora — completado depois). E, para qualquer pessoa, mudar de Grupo, virar liderança ou ganhar subordinado de outro Grupo expira a senha temporária ainda não usada | `source-custody-proof` (novo, 10 cenários: no código anterior falham os 4 de ataque, e na `4859d40f` os 3 da Estrutura como primeira carga; confirmação do Grupo e transferência comum seguem iguais); harness da auditoria e a prova independente da preparação AppSec (`appsec-2026-10-29/anexos/prova-c-n1-…`): não reproduzem mais |
| N03 | Média até validar | `npm run db:backup` criava a pasta com a permissão herdada (no Windows, a do `C:\` — leitura para os usuários da máquina; 0755 no Linux/macOS), o `pg_dump` escrevia a cópia aberta (0644) e só no fim um `chmod` que no Windows não faz nada. Só a pasta da tarefa agendada (`agendar-backup.ps1`) era restringida; atualização, rotação de chave e resposta a incidente rodam o comando sem ela | `restrictBackupDir` (`scripts/install/backup-tools.mjs`) antes de qualquer escrita: só o dono (0700/0600) ou, no Windows, só Administradores, SYSTEM e a conta que roda, sem herança (`icacls`), inclusive cópias antigas e o registro da pasta; o arquivo nasce 0600 antes do `pg_dump`; sem conseguir restringir, a cópia não é feita | `backup-tools.test.mjs` (novo, `node --test "scripts/install/*.test.mjs"`; Windows por simulação do `icacls`); cópia real no banco descartável: pasta nova e pasta aberta com cópia antiga → `drwx------` e `-rw-------`; `pg_dump` mantém 0600 no arquivo pré-criado; pasta impossível → "Backup NÃO foi feito" (saída 1). O `icacls` no Windows de verdade fica para a homologação (R-35) |
| L3-1 | Média (funcional) | Lote 3 das partes não analisadas: a largura da planilha era `Math.max(...linhas)`, que estoura a pilha a partir de ~100 mil linhas — um XLSX legítimo de 13 MB com 300 mil linhas falhava no upload e nas cargas agendadas ("Maximum call stack size exceeded") | `widestRow` conta linha a linha (`xlsx-parser.ts`) | `xlsx-parser.test.ts` (novo, 500 mil linhas); o mesmo XLSX de 300 mil linhas carrega (300.000 registros) |
| L3-2 | Média | Lote 3 (P-04 da preparação AppSec): a prévia de DOCX (`GET …/preview`, qualquer leitor do material, sem cache nem limite) descompactava e embutia todas as imagens a cada leitura — um DOCX legítimo de 1,2 MB com uma imagem de 100 MB gerava 133 MB de resposta e ~1,3 GB de memória por prévia (3 ao mesmo tempo: 1,7 GB); a guarda de ZIP permite até 300 MB | `renderDocxPreviewHtml`: texto (partes XML) acima de 20 MB = sem prévia (`KNOWLEDGE_PREVIEW_TOO_LARGE`; a tela mostra o texto extraído e o download); partes binárias acima de 25 MB = prévia sem as imagens (nem são descompactadas) e com aviso; teto de 30 prévias por conta por minuto nas duas rotas (`knowledgePreviewsPerAccount`). A guarda de ZIP passa a devolver o tamanho de cada parte | `docx-preview.test.ts` (novo, 4 casos) e caso novo em `http-security.test.ts`; o mesmo DOCX: 23 ms e ~300 MB de pico (o do processo), 3 ao mesmo tempo 51 ms; documento com 20 MB de imagens continua com a prévia completa |
| L2-1 | Baixa (confirmado) | Lote 2 das partes não analisadas: as dependências de um domínio de negócio (`GET /admin/business-domains/:id/dependencies`) e de uma definição de indicador (`GET /admin/indicator-rules/definitions/:id/dependencies`), leituras abertas a quem tem `configuration.manage` em qualquer escopo, listavam nome e id dos Agents, Orquestradores e Workflows de TODOS os Grupos: o administrador do Grupo A lia ali os do Grupo B, que a lista de cada um esconde e cujo detalhe dá 404. Só nomes de configuração da mesma organização, sem conteúdo nem ação | As duas rotas mostram pelo nome só o que quem consulta administra (`agents.manage`/`workflows.manage` no escopo do item, a regra das listas) e contam o resto (`agentsOutOfScope`, `orchestratorsOutOfScope`, `workflowsOutOfScope`; a tela mostra "+ N em outros Grupos (fora do seu escopo)"). A trava de código/exclusão (escrita da organização inteira) e as contagens da lista continuam com todos | `catalog-dependencies-scope-proof` (novo, banco), `business-domains-page.test.tsx` e `indicator-definition-form.test.tsx` (casos novos) |
| N02 | Decisão | Liderança da cadeia vê o tipo exato de afastamento por pessoa (perfil › Indicadores, Calendário da equipe, aviso de conciliação), o contrário do que dizia o FAQ F01 | Decisão de produto (29/10/2026): manter. FAQ F01, `memoria/liderancas.md`, `memoria/seguranca.md` e o comentário do AI-04 corrigidos | — |

## Verificações executadas (quarta rodada)

| Verificação | Comando | Resultado |
|---|---|---|
| Typecheck do backend e dos scripts | `npx tsc --noEmit -p .`; `npm run typecheck:scripts` | sem erro |
| Lint dos arquivos alterados | `npx eslint <arquivos>` | sem erro nem aviso |
| Suíte do backend | `npx vitest run` | 475 arquivos, **5.215 testes passando**, 0 falhas (441 pulados = provas de banco e casos condicionais) |
| Provas de banco (PostgreSQL 17 descartável, migrado) | `INIA_DB_PROOF=1 npx vitest run --no-file-parallelism` em auth, access, agents, knowledge, assistant, checkpoint-registry, feedbacks, workflows, conversational-delivery e data-hub (`person-identity-proof`, `data-hub-proof`) | todas passam, exceto o teste de volume do `data-hub-proof` (exige os 2.000 operadores `DEMO-OP-*` da massa demo, ausentes no banco descartável). O `data-hub-proof` só rodou depois de criar ali a operação "Atendimento B2C" da massa demo |
| Harnesses da auditoria depois das correções | v04 (C02), v01 (C01), r18 (C09), v22 (C17), contra o mesmo banco descartável | os quatro deixaram de reproduzir o achado |

Não executado no primeiro lote: suíte e lint do frontend (nenhum arquivo do frontend mudou) e as provas no `inia_test` compartilhado.

Segundo lote (C04, C06, C07, C08 — 29/10/2026):

| Verificação | Resultado |
|---|---|
| Typecheck backend, scripts e frontend | sem erro |
| Lint | backend sem erro; frontend 0 erros e o aviso preexistente de `operator-inia-chat.tsx` |
| Suíte do backend | 475 arquivos, **5.217 testes passando**, 0 falhas |
| Suíte do frontend | 178 arquivos, **2.048 passando**, 0 falhas; o vitest reporta 1 "Timeout calling onTaskUpdate" (canal interno, máquina com carga ~25) que aparece igual no código commitado |
| Provas de banco (PostgreSQL descartável) | 28 arquivos; falham só o teste de volume do `data-hub-proof` (massa demo ausente) e a "visão geral" do `usability-proof`, que falha igual no código commitado (prova desatualizada, não ligada a estas correções) |
| Testes de tela (navegador, servidores próprios em 127.0.0.1, banco de desenvolvimento) | C08 antes × depois descrito na tabela. C04, C06 e C07 não têm tela que mostre o valor corrigido (o painel não exibe a situação; a regra do editor é a mesma função da paridade; a fila é interna) |

Terceiro lote (C10, C11, C12, C13, C15, C16, C18 — 29/10/2026): typecheck do backend, dos scripts e do frontend sem erro; lint sem
erro (o aviso preexistente de `operator-inia-chat.tsx`); suíte do backend 478 arquivos e **5.230 testes passando**, 0 falhas; suíte do
frontend 178 arquivos e **2.048 passando**, 0 falhas; provas de banco dos módulos tocados passam, exceto a "visão geral" do
`usability-proof` e dois casos do `investigation-tools-proof` (segmentação por assunto e contagem de flags), que falham igual no código
commitado (dados do banco descartável). Testes da auditoria: C11, C13, C15 (adaptado), C16 e C18 deixaram de reproduzir; o de C10
chama a função sem o token (como o `server.ts` antigo) e não confere o corpo — a correção está no `server.ts` e no teste novo.

C14 (29/10/2026): typecheck e lint sem erro; suíte do backend 478 arquivos e **5.233 testes passando**, do frontend 178 arquivos e
**2.049 passando**, 0 falhas; `structure-scope-proof` e `access-proof` passam no banco descartável (a prova do organograma foi
ajustada: a estrutura do Gerente tem 5 pessoas mas só 3 operadores, então os afastamentos ficam somados). Harness v10 com dois
cenários a mais (líder afastado entre datas e no organograma): nenhum cenário de líder revela o tipo.

N01 e N04 (29/10/2026): typecheck e lint sem erro; suíte do backend 478 arquivos e **5.238 testes passando**, 0 falhas; provas de
banco da Central de Dados, da IA e da base de conhecimento passam no banco descartável, exceto o teste de volume do `data-hub-proof`
(massa demo ausente) e o caso "admin de GRUPO" do `ai-providers-proof`, que falha igual no código commitado (a prova espera duas
permissões e o papel tem também `AI_USAGE_RANKING_READ` — prova desatualizada).

h19 (29/10/2026, completado no mesmo dia depois do reteste da preparação AppSec): typecheck e lint sem erro; suíte do backend 479 arquivos e **5.246 testes passando**, 0 falhas; provas de banco
da Central de Dados, de acesso, de autenticação, de pessoas e da estrutura passam num banco descartável novo, exceto o teste de
volume do `data-hub-proof` (massa demo ausente).

Lote 3 (29/10/2026): typecheck e lint sem erro; suíte do backend 481 arquivos e **5.253 testes passando**; provas de banco de
bases de conhecimento e da Central de Dados passam. Medido no banco descartável com a massa demo e em processos isolados: o upload
lê o arquivo inteiro para mostrar 20 linhas (CSV de 44 MB → 1,1 GB de pico; só administradores da organização inteira) e as
consultas pesadas da liderança não têm limite por conta (PRV por pessoa, 6 meses, do diretor: 0,5 s; 10 ao mesmo tempo, 4,2 s) —
os dois ficam em R-38. A ferramenta de contexto mostra à IA o tipo de afastamento do operador investigado, dentro da decisão do N02.

Telas e provas (29/10/2026), com servidores próprios em 127.0.0.1 sobre o banco descartável com a massa demo: o card da
gerente no organograma mostra INSS 2, Maternidade 2 e "Afastamento (motivo protegido)" 1 (o supervisor afastado), com o aviso, e o
rótulo cabe também na largura de celular (C14); a leitora só de agregados não vê os filtros de cargo, papel e situação, vê o aviso
e, com um Subgrupo de 3 pessoas, recebe "Recorte pequeno demais" (API 422) (C18); a prévia do DOCX com 40 MB de imagens mostra só
o texto e o aviso, sem imagem, com "Baixar original" (lote 3). Provas: `ai-providers-proof` passa a esperar
`AI_USAGE_RANKING_READ` no administrador de Grupo (papel ADMINISTRADOR desde 5cb9c104, no escopo dele); `usability-proof`
declara que as tabelas das fontes oficiais já existiam no período da massa (num banco novo as migrations são de hoje) e devolve
as datas no fim; `investigation-tools-proof` e o teste de volume do `data-hub-proof` só precisam da massa demo (`db:seed:demo`).

N03 (29/10/2026): `node --test "scripts/install/*.test.mjs"` 6 de 6; cópia real com `pg_dump` 17.11 no banco descartável
(pasta nova, pasta já aberta com cópia antiga, `pg_dump` direto sobre o arquivo pré-criado e pasta sem permissão) com as
permissões acima. Sem Windows aqui: o caminho do `icacls` foi testado por simulação.

Lote 2 (29/10/2026), as rotas montadas que ainda não tinham sido lidas por dentro: ciclo de vida, consultas e variáveis de
Workflows (escopo pela Abrangência publicada, 404 fora dele; publicar confere o escopo; a variável fica presa ao Workflow),
domínios de negócio, flags de canal e calendário operacional (consulta filtrada pela organização; escrita só da organização
inteira, 403 `ORGANIZATION_SCOPE_REQUIRED` conferido por HTTP) e QA de feedback (`feedback_quality_review.view`/`.decide` por
atribuição de papel, escopo organização/Grupo/Subgrupo/Minha estrutura, nunca o próprio feedback, 404 fora do escopo, a decisão
confere o escopo de `.decide`, os filtros só oferecem o que está no escopo) — sem achado, exceto o L2-1. Antes × depois por HTTP
no banco descartável com a massa demo (administrador do Grupo A criado para a prova e removido no fim): antes, as dependências
traziam pelo nome o Agent e o Orquestrador do Grupo B; depois, só o Agent do Grupo A, com 1 + 1 contados, e as dependências do
indicador só o Workflow do Grupo A, com 1 contado; o administrador geral continua vendo tudo. Typecheck e lint sem erro; suíte
do backend 485 arquivos e **5.277 testes passando**, do frontend 183 arquivos e **2.062 passando**, 0 falhas (o vitest reporta o
"Timeout calling onTaskUpdate" de sempre); `catalog-dependencies-scope-proof` e `business-domain-proof` passam no banco
descartável. Tela, com servidores próprios em 127.0.0.1: o administrador do Grupo A abre o domínio e vê "Agents 2", o Agent do
Grupo A e "+ 1 em outros Grupos (fora do seu escopo)", e "Orchestrators 1" só com a contagem. A lista de dependências do
indicador só aparece no formulário de edição, exclusivo de quem administra a organização inteira (que vê tudo); para o
administrador de Grupo ela só chegava pela API.

Endurecimentos do R-38 (29/10/2026), sem falha explorável por trás, medidos no banco descartável com a massa demo:
(1) prévia do upload da Central de Dados — o CSV monta só as linhas mostradas e conta o resto (`scanCsv`), o XLSX conta largura e
total linha a linha sem uma segunda cópia da aba: CSV de 44 MB com 436 mil linhas, de 846 MB e 644 ms para 249 MB e 193 ms; XLSX
de 10 MB com 300 mil linhas, de ~1,72 GB para ~1,49 GB (o resto é o exceljs carregando a planilha, como na importação); mesma
saída (colunas, primeiras linhas, total); (2) teto por conta `heavyReadsPerAccount` (20/min, um balde) na consulta flexível e
nas ferramentas da liderança chamadas fora do chat e na exportação do diagnóstico; (3) "Testar diagnóstico" com o banco como
segunda trava (`createReadOnlyDatabase(db, { enforcedByDatabase: true })`: cada leitura numa transação `read only` curta) —
função que grava, `nextval` e CTE com função que grava, que a lista de comandos deixava passar, agora dão 25006 e nada é
gravado; o teste (parar antes da IA) dá o mesmo resultado, de 13 para 30 ms; (4) a leitura do esclarecimento pelas bases
confere a dona da conversa (`loadMessages` com `ownerPersonId`, na mesma consulta). Typecheck e lint sem erro; suíte do
backend 486 arquivos e **5.282 testes passando**, 0 falhas; provas `read-only-database-proof` (nova),
`assistant-conversations-proof` (caso novo), `data-hub-proof`, `source-custody-proof` e `person-identity-proof` passam no
banco descartável.


## Quinta rodada (10–11/11/2026, skill da Cloudflare, run-2)

Passada parcial sobre o diff `6b5667ad..4a066be9` (tudo o que entrou depois da 4ª rodada) mais a revalidação dos 22 registros da 4ª rodada. Perfil `standard`, 67 agentes, só código-fonte e checagens locais em sandbox contra um PostgreSQL descartável. Registro completo, fora do repositório: `~/security-audit-skill/inia/run-2/` (`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`).

Resultado: nenhum achado crítico ou alto; 9 confirmados (3 médios, 6 baixos), 5 que dependem de um fato externo, 1 rejeitado. Dos 22 registros da 4ª rodada, 19 continuam fechados; 3 tinham desvio (C13, C18 e o irmão do N01 na conexão de IA) e entram abaixo. Todos corrigidos com teste que falha no código anterior.

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| R5-C01 | Média | A largura declarada da página do PDF (MediaBox) controlava um laço no processo da API (`lines.ts`, `bestGutter`) | no máximo 1.000 passos; largura inválida ou infinita não varre |
| R5-C02 | Média | Grade de linhas no PDF: união de conjuntos sem compressão (`tables.ts`), ~37 s por página no processo da API | compressão de caminho + união por tamanho; grade acima de 10.000 células fica como texto |
| R5-C03 | Média | Pré-checagem `inspectPdf` quadrática (1 MiB parava a API 12 s) | posições de `endstream`/`obj`/`/FlateDecode` achadas uma vez e percorridas em ordem (15 MiB em ~56 ms) |
| R5-C04 | Baixa | Trocar o endpoint de uma conexão de IA decidia a revogação num retrato lido antes da transação; a chave digitada ao mesmo tempo ficava ativa no endpoint novo (irmão do N01) | linha travada (`for update`); revoga pelo endpoint travado; gravar chave confere o endpoint visto (409 `AI_CONNECTION_ENDPOINT_CHANGED`) |
| R5-C05 | Baixa | `compare_population` contava colegas só com zero lógico (ausência injustificada) no mínimo de 4, mas o valor de referência não os soma (desvio do C13) | o portão conta só quem contribui para o valor |
| R5-C06 | Baixa | Fila de OCR única para todas as organizações, sem limite por página; o prazo crescia com páginas que nem são lidas | prazo por no máximo 300 páginas, 20 s por página, organização atendida há mais tempo primeiro |
| R5-C07 | Baixa | Rotação de credencial do Data Hub (rota sem senha da fonte) gravava a credencial provada no destino antigo sobre um destino trocado em paralelo | linha travada e destino reconferido; 409 `DATA_SOURCE_DESTINATION_CHANGED` |
| R5-C08 | Baixa | Definição operacional do indicador buscada só pelo código: Ranking, Quartil operacional e condições de medição usavam direção/agregação de outra organização com o mesmo código | organização obrigatória em toda busca por código (tipos obrigam os chamadores) |
| R5-C09 | Baixa | Leitor só de agregados da usabilidade reconstruía um grupo pequeno subtraindo dois recortes permitidos (desvio do C18) | para esse leitor, pessoas de células (Grupo × Subgrupo × classe) com menos de 5 saem de todos os recortes, inclusive dos totais |

Dependem de fato externo (endurecidos de forma segura mesmo assim):

- **R5-N01** avaliações de política gravadas antes de `291bd48c` guardam o tipo exato de afastamento — agora protegido na leitura (sem reescrever o banco); falta contar se há linhas antigas no homolog/VM.
- **R5-N02** limpeza de metadados de JPEG copiava tudo depois do primeiro SOS (imagem secundária MPF, vídeo anexado) — agora corta no fim da imagem principal e recusa (422) o que não consegue ler; falta testar com foto real de celular.
- **R5-N03** sessão encerrada no servidor: o Voltar ainda mostrava páginas da conta anterior (16 redirecionamentos suaves para o login) — a tela de login limpa o cache e recarrega uma vez quando a página veio de fora de `/auth`; falta o roteiro no navegador.
- **R5-N04 / R5-N05** backup no Windows: pasta pré-existente mantinha o dono; a tarefa SYSTEM chamava `whoami`/`icacls`/`pg_dump` pelo nome a partir de `C:\inia` — agora caminhos absolutos (`%SystemRoot%\System32`, `--pg-bin` absoluto ou Program Files), `/setowner` Administradores + `/reset` antes da restrição; falta conferir ACLs na VM.

Limites conhecidos das correções (revisão independente de 11/11/2026):

- R5-N01: a proteção na leitura cobre avaliação, dados estruturados do relatório e detalhe da intervenção; o texto que a IA já tinha escrito antes de 29/10 (`narrative.current`), as saídas antigas do nó "Avaliar política de acompanhamento" e payloads de eventos antigos continuam como foram gravados — regenerar a narrativa resolve o primeiro.
- Backup no Windows: `pg_dump`/`pg_restore` não são mais procurados no PATH; instalação do PostgreSQL fora de `Program Files` precisa de `--pg-bin` (ou `-PastaPg` ao agendar). Pasta de backup que já existia exige prompt de Administrador para trocar o dono (a tarefa agendada roda como SYSTEM e não é afetada); pasta nova não muda nada.
- Imagens: JPEG sem marcador de fim (EOI) ou PNG sem IEND agora são recusados (422) em vez de aceitos sem limpeza.

Rejeitado: recarregar um registro cancelado o reativa (comportamento documentado em `docs/dev/central-de-dados-consulta.md`; quem tem `data_hub.manage` já grava qualquer resultado por carga).

Áreas adiadas, auditadas em 11/11/2026 a pedido (onda 6, no tronco `e3fdd414`; crítico final sem lacunas, então a cobertura do escopo fechou):

| # | Gravidade | Achado | Correção |
|---|---|---|---|
| R5-C10 | Média | As rotas de execuções do Workflow (lista, registros dos Agents, retry, decisão) conferiam só o escopo ATUAL do Workflow e devolviam toda execução: depois de mover o Workflow para outro Grupo (ou de a pessoa mudar de Grupo), o admin do Grupo novo via e reexecutava execuções sobre operadores fora do seu alcance | regra única por pessoa (`enrollment-visibility.ts`, a mesma de Resultados): fora do alcance some da lista e dá 404; sem pessoa, vale o escopo gravado na versão; "Executar agora" filtra pelo colaborador |
| R5-C11 | Baixa | Execuções de Agent anteriores à migration 164 (sem versão, sem escopo gravado) ficavam legíveis para todos depois de o Agent ter o escopo restringido | sem escopo gravado, entrada e saída só para quem lê todos os escopos do Agent (mesma regra do histórico) |
