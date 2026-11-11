<!-- GERADO por `npm --prefix backend run errors:catalog` a partir de backend/src/shared/domain/errors/error-catalog.ts — não edite à mão. -->

# Catálogo de erros da INIA (versão 2026-11-11.1)

Como usar: a pessoa copia da tela o **código** (tipo de falha) e a **referência** (a ocorrência). Procure o código aqui (ou em
Administração › Plataforma › Diagnóstico de erros, ou com `node "$INIA\backend\dist\main\diagnostico-de-erros.js" <código>`)
e a referência nos registros com os comandos de cada entrada. O passo a passo da VM está em
[runbook-diagnostico-de-erros.md](runbook-diagnostico-de-erros.md).

Status HTTP descreve a resposta; código descreve o tipo de falha; referência identifica uma ocorrência. As causas são
**hipóteses**: só o sinal indicado confirma uma delas.

## Índice

| Código | Módulo | Status | Severidade |
| --- | --- | --- | --- |
| [VALIDATION_ERROR](#validation_error) | API (todas as rotas) | 400 | info |
| [INVALID_JSON](#invalid_json) | API (todas as rotas) | 400 | info |
| [PAYLOAD_TOO_LARGE](#payload_too_large) | API (envio de dados e arquivos) | 413 | info |
| [INVALID_UPLOAD](#invalid_upload) | API (envio de arquivos) | 400 | info |
| [INVALID_IDENTIFIER](#invalid_identifier) | API (todas as rotas) | 400 | info |
| [DUPLICATE_RECORD](#duplicate_record) | API (todas as rotas) | 409 | warning |
| [BAD_REQUEST](#bad_request) | API (todas as rotas) | 400 | info |
| [UNAUTHENTICATED](#unauthenticated) | Acesso (sessão) | 401 | info |
| [FORBIDDEN](#forbidden) | Acesso (permissões) | 403 | info |
| [CROSS_SITE_REQUEST_BLOCKED](#cross_site_request_blocked) | Segurança (CSRF) | 403 | warning |
| [RATE_LIMITED](#rate_limited) | Limites de uso | 429 | warning |
| [NOT_FOUND](#not_found) | API (roteamento) | 404 | info |
| [INIA-INTERFACE-PAGINA-NAO-ENCONTRADA](#inia-interface-pagina-nao-encontrada) | Interface (rotas) | 404 | info |
| [INIA-BANCO-INDISPONIVEL](#inia-banco-indisponivel) | Banco interno (PostgreSQL) | 500 | critical |
| [INIA-BANCO-TIMEOUT](#inia-banco-timeout) | Banco interno (PostgreSQL) | 500 | error |
| [INIA-BANCO-CONEXOES-ESGOTADAS](#inia-banco-conexoes-esgotadas) | Banco interno (PostgreSQL) | 500 | critical |
| [AI_TIMEOUT](#ai_timeout) | IA (provedores) | 504 | warning |
| [AI_RATE_LIMIT](#ai_rate_limit) | IA (provedores) | 503 | warning |
| [AI_AUTH](#ai_auth) | IA (provedores) | 503 | critical |
| [AI_NETWORK](#ai_network) | IA (provedores) | 503 | error |
| [AI_BUDGET_EXCEEDED](#ai_budget_exceeded) | IA (orçamento) | 402 | warning |
| [DATA_SOURCE_TIMEOUT](#data_source_timeout) | Central de Dados (conectores) | 502 | warning |
| [DATA_SOURCE_UNREACHABLE](#data_source_unreachable) | Central de Dados (conectores) | 502 | error |
| [INIA-DEPENDENCIA-TIMEOUT](#inia-dependencia-timeout) | API (chamadas de saída) | 500 | error |
| [INTERNAL_ERROR](#internal_error) | API (todas as rotas) | 500 | error |
| [INIA-STREAM-FALHA](#inia-stream-falha) | Chat da INIA (SSE) | — | error |
| [INIA-JOB-FALHA](#inia-job-falha) | Processamento (tarefas periódicas) | — | error |
| [INIA-PROCESSO-FALHA](#inia-processo-falha) | Processo Node (API/Processamento) | — | critical |
| [INIA-INTERFACE-RENDERIZACAO](#inia-interface-renderizacao) | Interface (navegador) | — | error |
| [INIA-INTERFACE-SERVIDOR](#inia-interface-servidor) | Interface (servidor Next) | 500 | error |
| [INIA-REDE-SEM-CONEXAO](#inia-rede-sem-conexao) | Interface (navegador) | — | info |
| [INIA-REDE-API-INALCANCAVEL](#inia-rede-api-inalcancavel) | Interface (navegador) | — | error |
| [INIA-PROXY-INDISPONIVEL](#inia-proxy-indisponivel) | Proxy (IIS/ARR) | 502 | critical |
| [INIA-INTERFACE-RESPOSTA-INVALIDA](#inia-interface-resposta-invalida) | Interface (navegador) | — | error |

## Entradas

### VALIDATION_ERROR

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 400 · **Severidade:** info
- **Aliases / códigos cobertos:** `INIA-VALIDACAO-DADOS`
- **Quando dispara:** O corpo, a query ou os parâmetros não passaram no esquema zod da rota (`ZodError` no handler global).
- **Mensagem pública:** Algo não encaixou. Revise as informações e tente novamente.
- **Ação segura (usuário):** Voltar e corrigir os campos indicados; nada foi gravado.
- **Descrição técnica:** A requisição chegou à rota, mas os dados não respeitam o contrato. `error.details` traz os caminhos dos campos recusados (sem os valores).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Campo obrigatório vazio ou fora do formato no formulário. | `details[].path` aponta o campo; a mesma tela repete o erro para a mesma entrada. |
| Interface e API em versões diferentes (deploy parcial). | `release` da linha `http_error` difere da versão da interface; acontece para todas as pessoas na mesma tela depois de uma atualização. |
| Chamada direta à API (integração, script) com contrato antigo. | Rota fora do uso da interface e sem `x-inia-client` no log; muitas ocorrências do mesmo IP. |

**Verificações, em ordem:**

1. Peça o código e a referência copiados da tela.
2. Busque a referência no log da API e leia `route` e `details`.
3. Compare a versão da API (`release`) com a da interface (rodapé de Copiar detalhes).
4. Se for após atualização, confirme que API e interface foram publicadas juntas.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Corrigir a entrada. Se for divergência de versão, publicar a mesma versão na API e na interface e reiniciar os serviços INIA-API e INIA-Interface.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

Exemplo sanitizado:

```json
{"level":30,"time":"2026-11-11T13:02:11.204Z","service":"inia-api","release":"32e364c7","event":"http_error","reference":"5f0c…","code":"VALIDATION_ERROR","status":400,"route":"POST /api/v1/admin/indicators"}
```

### INVALID_JSON

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 400 · **Severidade:** info
- **Quando dispara:** O corpo enviado não é um JSON válido (`entity.parse.failed` do express.json).
- **Mensagem pública:** Algo não encaixou. Revise as informações e tente novamente.
- **Ação segura (usuário):** Tentar de novo pela própria tela; se persistir, informar o código ao administrador.
- **Descrição técnica:** Falha antes da rota: o parser de JSON recusou o corpo. A interface sempre envia JSON válido — quase sempre é integração ou proxy alterando o corpo.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Integração externa enviando corpo malformado. | Ocorrências concentradas numa rota de integração e num mesmo IP no log do IIS. |
| Proxy/antivírus corrompendo ou truncando o corpo. | `cs-bytes` no log do IIS menor que o esperado; acontece só para uma rede. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Ache a mesma referência no log do IIS (campo x-request-id) e veja IP e tamanho.
3. Teste a mesma ação a partir da própria VM.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS (campo personalizado x-request-id):

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Corrigir o cliente que envia o corpo; nenhuma ação no servidor.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### PAYLOAD_TOO_LARGE

- **Módulo:** API (envio de dados e arquivos) · **Origem:** API · **Status HTTP:** 413 · **Severidade:** info
- **Aliases / códigos cobertos:** `FILE_TOO_LARGE`, `INIA-ARQUIVO-GRANDE-DEMAIS`
- **Quando dispara:** Corpo JSON acima de 1 MB (`entity.too.large`) ou arquivo acima do limite do multer (`LIMIT_FILE_SIZE` → `FILE_TOO_LARGE`).
- **Mensagem pública:** O conteúdo enviado é maior do que o permitido.
- **Ação segura (usuário):** Enviar um arquivo menor ou dividir o conteúdo.
- **Descrição técnica:** Limites da API: JSON 1 MB (API Push: 10 MB), arquivos por rota (base de conhecimento, Central de Dados, imagens). O IIS também recusa acima de 100 MB (`maxAllowedContentLength`) — esse 413 NÃO chega à API.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Arquivo acima do limite da rota. | Linha `http_error` com `code` FILE_TOO_LARGE na API. |
| Arquivo acima de 100 MB recusado pelo IIS. | Status 413 no log do IIS SEM linha correspondente no log da API. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Se não houver, busque no log do IIS (status 413).
3. Confira o tamanho do arquivo enviado.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Reduzir o arquivo. Limites só mudam por decisão de produto (configuração do IIS e da rota).

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`, `deploy/windows/iis/web.config`

### INVALID_UPLOAD

- **Módulo:** API (envio de arquivos) · **Origem:** API · **Status HTTP:** 400 · **Severidade:** info
- **Quando dispara:** Erro do multer diferente de tamanho (campo inesperado, arquivos demais, envio interrompido).
- **Mensagem pública:** Algo não encaixou no envio do arquivo. Tente novamente.
- **Ação segura (usuário):** Selecionar o arquivo de novo e reenviar pela mesma tela.
- **Descrição técnica:** O envio multipart não respeitou o formato esperado pela rota.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Conexão interrompida durante o envio. | No log do IIS, `sc-win32-status` diferente de 0 para a mesma referência. |
| Cliente enviando campo com nome errado (integração). | Repetição só a partir de um IP/cliente. |

**Verificações, em ordem:**

1. Busque a referência no log da API e no do IIS.
2. Repita o envio a partir da VM.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Reenviar. Integração: corrigir o nome do campo.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### INVALID_IDENTIFIER

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 400 · **Severidade:** info
- **Aliases / códigos cobertos:** `INVALID_CHARACTER`
- **Quando dispara:** O PostgreSQL recusou o formato de um valor vindo da requisição (22P02, 22007, 22008; 22021/22P05 → INVALID_CHARACTER).
- **Mensagem pública:** Algo não encaixou. Revise as informações e tente novamente.
- **Ação segura (usuário):** Voltar e abrir o item pela navegação da INIA (não por um endereço copiado).
- **Descrição técnica:** Id que não é UUID num `/:id`, data inválida ou caractere nulo. A mensagem do banco nunca é devolvida.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Endereço digitado ou copiado incompleto. | `route` com `:id` e a pessoa diz ter colado um link. |
| Varredura de segurança. | Muitas ocorrências por minuto do mesmo IP no log do IIS. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Veja o IP no log do IIS.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Navegar pela interface. Varredura: tratar com a segurança da rede.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### DUPLICATE_RECORD

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 409 · **Severidade:** warning
- **Quando dispara:** Violação de unicidade (23505) que a rota não converteu em código próprio.
- **Mensagem pública:** Já existe um registro com esses dados.
- **Ação segura (usuário):** Atualizar a tela e conferir se o item já foi criado antes de repetir.
- **Descrição técnica:** Gravação concorrente ou duplo clique: a restrição única do banco segurou a duplicata. Nada foi gravado em dobro.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Duplo envio (duplo clique, tentar de novo após lentidão). | Duas linhas da mesma rota em menos de 2 s, a primeira com 2xx. |
| Outra pessoa criou o mesmo item. | Linhas de contas diferentes na mesma rota. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Procure a requisição anterior da mesma rota (mesma pessoa, segundos antes).

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Atualizar a tela; o primeiro envio valeu.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### BAD_REQUEST

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 400 · **Severidade:** info
- **Quando dispara:** Erro do cliente (4xx) levantado por middleware de terceiros sem código próprio.
- **Mensagem pública:** Algo não encaixou. Revise as informações e tente novamente.
- **Ação segura (usuário):** Voltar e tentar de novo.
- **Descrição técnica:** Fallback do `describeClientError` para erros com `status` 4xx sem tradução específica.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Cabeçalho ou corpo fora do padrão aceito por um middleware. | Linha `http_error` com `code` BAD_REQUEST e o `status` real. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Repita a ação na VM.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Corrigir o cliente.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### UNAUTHENTICATED

- **Módulo:** Acesso (sessão) · **Origem:** API · **Status HTTP:** 401 · **Severidade:** info
- **Aliases / códigos cobertos:** `INIA-ACESSO-SESSAO`, `SESSION_IDLE`, `SESSION_REVOKED`, `TEMPORARY_PASSWORD_EXPIRED`
- **Quando dispara:** Rota protegida sem cookie de sessão, com token inválido/expirado, sessão revogada ou encerrada por inatividade (`require-auth.ts`).
- **Mensagem pública:** Entre para continuar. Faça login para acessar esta página.
- **Ação segura (usuário):** Fazer login de novo; a INIA volta para a página em que a pessoa estava.
- **Descrição técnica:** A sessão é conferida no banco a cada requisição (conta habilitada, versão da sessão, inatividade). 401 limpa o cookie.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Sessão venceu por inatividade ou prazo. | Última requisição 2xx da mesma pessoa há mais tempo que a inatividade configurada. |
| Senha trocada, acesso desabilitado ou sessão revogada pelo administrador. | Registro em `audit_logs` da conta pouco antes do 401. |
| Relógio da VM errado (token parece expirado). | 401 para todas as pessoas logo após o login; `Get-Date` da VM diferente da hora real. |
| Cookie bloqueado (HTTP × HTTPS, `__Host-` exige HTTPS). | Login responde 200, mas a requisição seguinte chega sem cookie (todas as pessoas, logo após instalar). |

**Verificações, em ordem:**

1. Peça para entrar de novo.
2. Se repetir para todas as pessoas: confira a hora da VM (`Get-Date` e `w32tm /query /status`).
3. Confira se o endereço público é HTTPS quando o cookie seguro está ligado.
4. Busque a referência no log da API.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Login. Relógio: sincronizar o Windows Time. Cookie: corrigir HTTPS/`SESSION_COOKIE_SECURE`.

**Escalar para:** Administrador de acessos da organização (Administração › Usuários). A INIA não concede acesso por cargo.

**Código:** `backend/src/modules/auth/presentation/require-auth.ts`, `frontend/src/proxy.ts`

### FORBIDDEN

- **Módulo:** Acesso (permissões) · **Origem:** API · **Status HTTP:** 403 · **Severidade:** info
- **Aliases / códigos cobertos:** `INIA-ACESSO-PERMISSAO`, `ORGANIZATION_SCOPE_REQUIRED`
- **Quando dispara:** A conta não tem a permissão da rota (`requirePermission`) ou não tem o escopo exigido (organização inteira).
- **Mensagem pública:** Acesso restrito. Sua conta não tem permissão para abrir esta página.
- **Ação segura (usuário):** Voltar ao início. Se precisar do acesso, pedir ao administrador informando o código e a referência.
- **Descrição técnica:** Permissões vêm de papéis atribuídos por escopo (nunca do cargo). Muitos módulos também respondem com códigos próprios de acesso (ex.: `STRUCTURE_ACCESS_DENIED`).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Papel não atribuído à conta. | Administração › Usuários: a conta não tem papel que inclua a permissão. |
| Papel atribuído em escopo menor (grupo) e a rota exige a organização. | `code` ORGANIZATION_SCOPE_REQUIRED. |
| Link aberto de outra pessoa/área. | Só uma pessoa, uma vez, numa rota de outra área. |

**Verificações, em ordem:**

1. Busque a referência e leia `route`.
2. Confira os papéis da conta em Administração › Usuários.
3. Compare com a permissão da área (Wiki › Administração › Acessos).

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Atribuir o papel certo no escopo certo — ou nenhum, se o acesso não deve existir.

**Escalar para:** Administrador de acessos da organização (Administração › Usuários). A INIA não concede acesso por cargo.

**Código:** `backend/src/modules/access/presentation/require-permission.ts`

### CROSS_SITE_REQUEST_BLOCKED

- **Módulo:** Segurança (CSRF) · **Origem:** API · **Status HTTP:** 403 · **Severidade:** warning
- **Quando dispara:** Escrita com o cookie de sessão vinda de origem que não está em `CORS_ORIGIN`/`allowedOrigins` (`origin-guard.ts`).
- **Mensagem pública:** Acesso restrito. Esta ação foi bloqueada por segurança.
- **Ação segura (usuário):** Abrir a INIA pelo endereço oficial e repetir a ação.
- **Descrição técnica:** Proteção CSRF. Acontece para todos quando o endereço público não está na lista de origens permitidas do backend\.env.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Endereço público novo/alterado sem atualizar `CORS_ORIGIN`. | Toda escrita falha para todas as pessoas; leituras funcionam. |
| Pessoa acessando por IP ou outro nome de host. | Só quem usa aquele endereço; cabeçalho Origin diferente no log do IIS. |
| Ataque CSRF real. | Origem externa desconhecida. |

**Verificações, em ordem:**

1. Confira `CORS_ORIGIN` em `$INIA\backend\.env` contra o endereço usado no navegador.
2. Busque a referência no log da API.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Configuração:

  ```powershell
  Select-String -Path "$INIA\backend\.env" -Pattern "^CORS_ORIGIN"
  ```

**Recuperação:** Corrigir `CORS_ORIGIN` e reiniciar INIA-API (`Restart-Service INIA-API`).

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/presentation/origin-guard.ts`

### RATE_LIMITED

- **Módulo:** Limites de uso · **Origem:** API · **Status HTTP:** 429 · **Severidade:** warning
- **Aliases / códigos cobertos:** `INIA-LIMITE-REQUISICOES`, `LOGIN_TOO_MANY_ATTEMPTS`
- **Quando dispara:** Mais requisições que o limite da regra (login por IP/e-mail, IA por conta, prévias, ações caras) — `rate-limit.ts`.
- **Mensagem pública:** Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.
- **Ação segura (usuário):** Aguardar o tempo indicado (`retryAfterSeconds`) e repetir.
- **Descrição técnica:** Os contadores ficam no PostgreSQL (compartilhados entre instâncias). A mensagem já diz qual limite.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Uso legítimo intenso (cliques repetidos). | Uma conta, uma regra, por pouco tempo. |
| Muitas pessoas atrás do mesmo IP sem `TRUST_PROXY` (todas contam como o IP do IIS). | Regra por IP disparando para pessoas diferentes; IP no log da API = 127.0.0.1. |
| Tentativa de força bruta no login. | Muitos 401 seguidos de 429 para um mesmo IP externo. |

**Verificações, em ordem:**

1. Busque a referência e veja a regra na mensagem.
2. Se for por IP, confira `TRUST_PROXY` no backend\.env.
3. Veja o volume por IP no log do IIS.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Aguardar. Corrigir `TRUST_PROXY` se o IP real não aparece.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/presentation/rate-limit.ts`

### NOT_FOUND

- **Módulo:** API (roteamento) · **Origem:** API · **Status HTTP:** 404 · **Severidade:** info
- **Aliases / códigos cobertos:** `INIA-API-ROTA-INEXISTENTE`
- **Quando dispara:** Nenhuma rota da API atende o caminho (handler final de 404) — inclui módulo desligado neste ambiente.
- **Mensagem pública:** Essa página sumiu do mapa.
- **Ação segura (usuário):** Voltar ao início.
- **Descrição técnica:** Rota inexistente ou módulo desligado (flags no backend\.env). Módulos também devolvem códigos próprios de "não encontrado" para itens que não existem ou que a pessoa não pode ver (mesma resposta, por segurança).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Interface mais nova que a API (rota ainda não publicada). | `release` da API mais antigo que o da interface; acontece para todos. |
| Módulo desligado neste ambiente. | Flag correspondente OFF no backend\.env (ex.: `INIA_USABILITY_PANEL`). |
| Varredura/endereço digitado. | Caminhos aleatórios do mesmo IP. |

**Verificações, em ordem:**

1. Busque a referência e leia `route`.
2. Compare versões da API e da interface.
3. Confira as flags do módulo no backend\.env.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Publicar a mesma versão nos dois lados ou ligar o módulo (decisão de produto).

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`

### INIA-INTERFACE-PAGINA-NAO-ENCONTRADA

- **Módulo:** Interface (rotas) · **Origem:** INTERFACE · **Status HTTP:** 404 · **Severidade:** info
- **Quando dispara:** Endereço da interface que não corresponde a nenhuma página (`app/not-found.tsx`) ou página que chamou `notFound()`.
- **Mensagem pública:** Essa página sumiu do mapa.
- **Ação segura (usuário):** Voltar ao início.
- **Descrição técnica:** O Next responde 404 com a tela da INIA. Não há registro no servidor (não é falha): o log do IIS guarda o caminho pedido.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Link antigo ou favorito de uma tela que mudou de endereço. | Caminho no log do IIS com status 404 e referer interno. |
| Endereço digitado errado. | Caminho sem referer. |

**Verificações, em ordem:**

1. Pergunte o endereço exato aberto.
2. Busque o caminho no log do IIS (status 404).

**Onde buscar evidência:**

- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -Pattern " 404 " | Select-Object -Last 20
  ```

**Recuperação:** Navegar pelo menu. Link antigo divulgado: corrigir a origem do link.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `frontend/src/app/not-found.tsx`

### INIA-BANCO-INDISPONIVEL

- **Módulo:** Banco interno (PostgreSQL) · **Origem:** API · **Status HTTP:** 500 · **Severidade:** critical
- **Quando dispara:** Conexão ao PostgreSQL recusada, encerrada ou sem resposta (ECONNREFUSED, ENOTFOUND, 57P01/57P03, "Connection terminated").
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em alguns minutos. Se a tela era de gravação, conferir antes se a ação já foi feita.
- **Descrição técnica:** A API não alcança o banco. `/ready` responde 503 e o ARR tira a instância da web farm. A ocorrência NÃO fica no banco (está fora): só no log da API.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Serviço do PostgreSQL parado. | `Get-Service postgresql*` diferente de Running; `failure.code` ECONNREFUSED no log. |
| Banco reiniciando/em recuperação. | `failure.code` 57P03 (cannot connect now) ou 57P01 (admin shutdown). |
| `DATABASE_URL` aponta para host/porta errados. | `failure.code` ENOTFOUND/ECONNREFUSED desde a subida do serviço. |
| Disco cheio no servidor do banco. | Log do PostgreSQL com "No space left on device"; `Get-PSDrive` com pouco espaço. |

**Verificações, em ordem:**

1. `Invoke-RestMethod http://127.0.0.1:3333/ready` (503 = sem banco).
2. `Get-Service postgresql*`.
3. Busque o código no log da API e leia `failure.code`.
4. Confira espaço em disco e o log do PostgreSQL.

**Onde buscar evidência:**

- Log da API:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch '"code":"INIA-BANCO-INDISPONIVEL"' | Select-Object -Last 20
  ```
- Log da API pela referência:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Prontidão:

  ```powershell
  Invoke-RestMethod http://127.0.0.1:3333/ready
  ```

**Recuperação:** Subir/recuperar o PostgreSQL. A API volta sozinha (o pool reconecta); `/ready` volta a 200 e o ARR devolve a instância.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/application/errors/classify-error.ts`, `backend/src/infrastructure/database/pool.ts`

Exemplo sanitizado:

```json
{"level":50,"service":"inia-api","event":"http_error","code":"INIA-BANCO-INDISPONIVEL","status":500,"failure":{"name":"Error","code":"ECONNREFUSED","message":"connect ECONNREFUSED 127.0.0.1:5432"}}
```

### INIA-BANCO-TIMEOUT

- **Módulo:** Banco interno (PostgreSQL) · **Origem:** API · **Status HTTP:** 500 · **Severidade:** error
- **Quando dispara:** Consulta cancelada por tempo (57014 statement_timeout / query_timeout do cliente) ou espera por conexão do pool estourada.
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em instantes; se for uma consulta grande, reduzir o período.
- **Descrição técnica:** O banco não respondeu dentro de `DATABASE_STATEMENT_TIMEOUT_MS`/`DATABASE_CONNECTION_TIMEOUT_MS`. Pode ser carga, bloqueio ou consulta pesada.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Consulta pesada (período longo, muitas pessoas). | Sempre a mesma `route`; `failure.code` 57014. |
| Bloqueio (lock) por outra transação (carga da Central, migração). | `pg_locks`/`pg_stat_activity` com `wait_event_type = 'Lock'` no horário. |
| Pool esgotado (muitas requisições simultâneas). | Mensagem "timeout exceeded when trying to connect"; várias rotas ao mesmo tempo. |

**Verificações, em ordem:**

1. Busque a referência e leia `route` e `failure`.
2. No PostgreSQL: `select pid, state, wait_event_type, now()-query_start as tempo, left(query,80) from pg_stat_activity where datname = 'inia' order by tempo desc nulls last limit 15;`
3. Veja se havia carga/migração no horário.

**Onde buscar evidência:**

- Log da API:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Esperar a carga terminar ou encerrar a sessão travada (com cuidado). Recorrente: aumentar pool/timeout é decisão técnica, não correção.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/application/errors/classify-error.ts`, `backend/src/infrastructure/database/pool.ts`

### INIA-BANCO-CONEXOES-ESGOTADAS

- **Módulo:** Banco interno (PostgreSQL) · **Origem:** API · **Status HTTP:** 500 · **Severidade:** critical
- **Quando dispara:** O PostgreSQL recusou nova conexão por limite (53300 too_many_connections / 53400).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em alguns minutos.
- **Descrição técnica:** Soma dos pools (API × instâncias + Processamento × instâncias + Interface) passou de `max_connections` do PostgreSQL.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Instâncias demais para o `max_connections`. | `failure.code` 53300; aconteceu após aumentar `-InstanciasApi`/`-PoolApi`. |
| Conexões presas por outro sistema no mesmo servidor. | `select usename, count(*) from pg_stat_activity group by 1;` mostra outro usuário com muitas conexões. |

**Verificações, em ordem:**

1. Busque o código no log da API.
2. Conte conexões por usuário no PostgreSQL.
3. Compare com `show max_connections;`.

**Onde buscar evidência:**

- Log da API:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch '"code":"INIA-BANCO-CONEXOES-ESGOTADAS"' | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```

**Recuperação:** Reduzir pools/instâncias ou aumentar `max_connections` (com memória disponível).

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/application/errors/classify-error.ts`

### AI_TIMEOUT

- **Módulo:** IA (provedores) · **Origem:** API · **Status HTTP:** 504 · **Severidade:** warning
- **Aliases / códigos cobertos:** `INIA-IA-TIMEOUT`
- **Quando dispara:** O provedor de IA não respondeu no prazo (408/504 do provedor ou prazo local) — `AiProviderError` categoria TIMEOUT.
- **Mensagem pública:** A INIA demorou demais para responder. Tente novamente.
- **Ação segura (usuário):** Tentar novamente; perguntas de leitura podem ser repetidas sem risco.
- **Descrição técnica:** Falha do provedor de IA, já com as alternativas de roteamento esgotadas. Uso e erro ficam em Administração › IA / Modelos.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Provedor lento/instável. | Vários AI_TIMEOUT de rotas diferentes no mesmo intervalo. |
| Proxy de internet da VM lento ou bloqueando. | Também há AI_NETWORK; `HTTPS_PROXY` no serviço. |
| Pergunta com contexto muito grande. | Só uma conversa/rota, repetível. |

**Verificações, em ordem:**

1. Busque a referência no log.
2. Veja Administração › IA / Modelos › Uso (falhas por conexão).
3. Teste a saída de internet da VM pelo proxy configurado.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Administração › IA / Modelos (uso e falhas por conexão)

**Recuperação:** Aguardar o provedor; configurar modelo alternativo na política de roteamento.

**Escalar para:** Administrador de IA da organização; persistindo, equipe de desenvolvimento.

**Código:** `backend/src/shared/application/model-routing/ai-errors.ts`

### AI_RATE_LIMIT

- **Módulo:** IA (provedores) · **Origem:** API · **Status HTTP:** 503 · **Severidade:** warning
- **Aliases / códigos cobertos:** `INIA-IA-COTA`
- **Quando dispara:** Provedor respondeu 429 (cota/limite) e não havia alternativa.
- **Mensagem pública:** A INIA está com muitas solicitações agora. Tente novamente em instantes.
- **Ação segura (usuário):** Aguardar um instante e repetir.
- **Descrição técnica:** Cota do provedor esgotada. O limitador pausa a conexão e retoma sozinho.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Pico de uso (lote de Workflows + chat). | Muitas execuções de Workflow no mesmo horário em Administração › Workflows. |
| Cota contratada baixa. | 429 todo dia no mesmo horário. |

**Verificações, em ordem:**

1. Busque a referência.
2. Veja a pausa da conexão em Administração › IA / Modelos.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Administração › IA / Modelos

**Recuperação:** Aguardar; ajustar teto por conexão ou contratar cota maior.

**Escalar para:** Administrador de IA da organização.

**Código:** `backend/src/shared/application/model-routing/ai-errors.ts`

### AI_AUTH

- **Módulo:** IA (provedores) · **Origem:** API · **Status HTTP:** 503 · **Severidade:** critical
- **Aliases / códigos cobertos:** `INIA-IA-CREDENCIAL`
- **Quando dispara:** Provedor recusou a credencial (401/403).
- **Mensagem pública:** A INIA está indisponível no momento. Procure o administrador.
- **Ação segura (usuário):** Informar o código e a referência ao administrador.
- **Descrição técnica:** Chave de API inválida, revogada ou sem acesso ao modelo configurado.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Chave revogada/expirada. | Todas as chamadas daquela conexão falham com AI_AUTH desde um horário. |
| Modelo sem acesso para a conta do provedor. | Só um modelo falha; outros da mesma conexão funcionam. |

**Verificações, em ordem:**

1. Administração › IA / Modelos › Conexões: testar a conexão.
2. Busque a referência no log.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Administração › IA / Modelos › Conexões (Testar)

**Recuperação:** Cadastrar a chave nova na conexão (sem reiniciar).

**Escalar para:** Administrador de IA da organização.

**Código:** `backend/src/shared/application/model-routing/ai-errors.ts`

### AI_NETWORK

- **Módulo:** IA (provedores) · **Origem:** API · **Status HTTP:** 503 · **Severidade:** error
- **Aliases / códigos cobertos:** `AI_PROVIDER_ERROR`, `AI_MODEL_UNAVAILABLE`, `INIA-IA-INDISPONIVEL`
- **Quando dispara:** Falha de rede até o provedor, erro 5xx do provedor ou modelo inexistente (categorias NETWORK, PROVIDER_ERROR, MODEL_UNAVAILABLE).
- **Mensagem pública:** A INIA está indisponível no momento. Tente novamente em instantes.
- **Ação segura (usuário):** Tentar novamente em instantes.
- **Descrição técnica:** Sem resposta válida do provedor. NETWORK costuma ser proxy/firewall da VM; PROVIDER_ERROR é do provedor; MODEL_UNAVAILABLE é configuração.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Proxy/firewall bloqueando a saída da VM. | `failure.code` ECONNRESET/ENOTFOUND; `Test-NetConnection <host do provedor> -Port 443` falha (host em Administração › IA / Modelos › Conexões). |
| Instabilidade do provedor. | Status page do provedor; 5xx em `providerStatus`. |
| Modelo removido pelo provedor. | `code` AI_MODEL_UNAVAILABLE para um só modelo. |

**Verificações, em ordem:**

1. Busque a referência e leia `details.category`.
2. Teste a saída de rede da VM.
3. Confira o modelo em Administração › IA / Modelos.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Rede (host do provedor: Administração › IA / Modelos › Conexões):

  ```powershell
  Test-NetConnection <host do provedor> -Port 443
  ```

**Recuperação:** Liberar a saída; trocar o modelo; aguardar o provedor.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `backend/src/shared/application/model-routing/ai-errors.ts`

### AI_BUDGET_EXCEEDED

- **Módulo:** IA (orçamento) · **Origem:** API · **Status HTTP:** 402 · **Severidade:** warning
- **Quando dispara:** Orçamento de IA da organização ou da conexão esgotado (`AiBudgetExceededError`).
- **Mensagem pública:** O limite de uso da INIA foi atingido. Procure o administrador.
- **Ação segura (usuário):** Informar o código ao administrador.
- **Descrição técnica:** Bloqueio intencional por orçamento configurado em Administração › IA / Modelos › Orçamentos.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Orçamento do período consumido. | Painel de custo no teto; outras chamadas também recusadas. |

**Verificações, em ordem:**

1. Veja Administração › IA / Modelos › Orçamentos.

**Onde buscar evidência:**

- Administração › IA / Modelos › Orçamentos
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```

**Recuperação:** Aumentar o orçamento (decisão da organização) ou aguardar o próximo período.

**Escalar para:** Administrador de IA da organização.

**Código:** `backend/src/shared/application/model-routing/ai-errors.ts`

### DATA_SOURCE_TIMEOUT

- **Módulo:** Central de Dados (conectores) · **Origem:** API · **Status HTTP:** 502 · **Severidade:** warning
- **Aliases / códigos cobertos:** `INIA-DADOS-TIMEOUT`
- **Quando dispara:** A fonte (banco externo, API Pull) não respondeu no prazo durante amostra, prévia ou carga (`DataRunError`).
- **Mensagem pública:** A fonte de dados demorou demais para responder. Tente novamente.
- **Ação segura (usuário):** Tentar novamente; na carga agendada, a INIA reprograma sozinha.
- **Descrição técnica:** Erro transitório: a execução (Run) é reprogramada. Em rota síncrona (amostra/prévia) volta como 502.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Fonte sobrecarregada ou consulta pesada. | Run com tempo alto e `DATA_SOURCE_TIMEOUT` só em horário de pico. |
| Rede/firewall entre a VM e a fonte. | `Test-NetConnection <host da fonte> -Port <porta>` falha ou demora. |

**Verificações, em ordem:**

1. Central de Dados › a fonte › Execuções: veja a causa.
2. Teste a rede até a fonte a partir da VM.
3. Busque a referência no log.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Central de Dados › Fontes › Execuções
- Rede:

  ```powershell
  Test-NetConnection <host da fonte> -Port <porta>
  ```

**Recuperação:** Aguardar a reprogramação; ajustar consulta/horário da carga com o dono da fonte.

**Escalar para:** Administrador de dados da organização e o responsável pela fonte.

**Código:** `backend/src/modules/data-hub/domain/error-codes.ts`, `backend/src/main/app.ts`

### DATA_SOURCE_UNREACHABLE

- **Módulo:** Central de Dados (conectores) · **Origem:** API · **Status HTTP:** 502 · **Severidade:** error
- **Aliases / códigos cobertos:** `DATA_SOURCE_TLS_FAILED`, `INIA-DADOS-FONTE-INALCANCAVEL`
- **Quando dispara:** Não foi possível conectar à fonte (DNS, recusa, TLS).
- **Mensagem pública:** Não foi possível alcançar a fonte de dados.
- **Ação segura (usuário):** Informar o código ao administrador de dados.
- **Descrição técnica:** Conectividade ou certificado. TLS falha costuma ser certificado interno sem `NODE_EXTRA_CA_CERTS`.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Host/porta errados ou firewall. | `Test-NetConnection` falha. |
| Certificado da fonte não confiável. | `code` DATA_SOURCE_TLS_FAILED; serviço sem `NODE_EXTRA_CA_CERTS`. |

**Verificações, em ordem:**

1. Teste a rede até a fonte.
2. Confira o certificado raiz (-CertificadoRaiz na instalação dos serviços).

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Rede:

  ```powershell
  Test-NetConnection <host da fonte> -Port <porta>
  ```

**Recuperação:** Corrigir rede/certificado; reprocessar a carga.

**Escalar para:** Administrador de dados e infraestrutura.

**Código:** `backend/src/modules/data-hub/domain/error-codes.ts`

### INIA-DEPENDENCIA-TIMEOUT

- **Módulo:** API (chamadas de saída) · **Origem:** API · **Status HTTP:** 500 · **Severidade:** error
- **Quando dispara:** Uma chamada de saída sem tratamento próprio foi abortada por prazo (`AbortError`/`TimeoutError`).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em instantes.
- **Descrição técnica:** Fallback para prazos de dependências que não têm código próprio (IA e Central de Dados têm).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Dependência externa lenta. | `failure.name` TimeoutError/AbortError no log com a mesma `route`. |

**Verificações, em ordem:**

1. Busque a referência e leia `route` e `failure`.
2. Identifique a dependência chamada pela rota.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Aguardar a dependência.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/shared/application/errors/classify-error.ts`

### INTERNAL_ERROR

- **Módulo:** API (todas as rotas) · **Origem:** API · **Status HTTP:** 500 · **Severidade:** error
- **Aliases / códigos cobertos:** `INIA-API-INESPERADO`
- **Quando dispara:** Exceção sem tratamento específico chegou ao handler global (fallback).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente. Em gravações, conferir antes se a ação já foi feita.
- **Descrição técnica:** Bug ou situação não prevista. O log traz `failure.name`, `failure.message` (sanitizada) e a pilha; a ocorrência guarda o mesmo resumo.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Defeito no código da rota. | Mesma `route` e mesma primeira linha da pilha em várias ocorrências. |
| Dado inesperado no banco (registro incompleto). | Só para um item/pessoa; pilha em leitura/mapeamento. |
| Falha de infraestrutura não classificada. | Várias rotas ao mesmo tempo; `failure.code` de sistema (EACCES, ENOSPC). |

**Verificações, em ordem:**

1. Busque a referência no log da API e copie a pilha.
2. Veja se há outras ocorrências da mesma rota (Diagnóstico de erros › por código).
3. Confira disco e permissões da pasta da INIA se `failure.code` for de sistema.

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Todas as falhas inesperadas:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch '"code":"INTERNAL_ERROR"' | Select-Object -Last 20
  ```

**Recuperação:** Contornar pelo caminho alternativo da tela, se houver; correção é do desenvolvimento.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/app.ts`, `backend/src/modules/error-diagnostics/presentation/error-envelope.ts`

### INIA-STREAM-FALHA

- **Módulo:** Chat da INIA (SSE) · **Origem:** STREAM · **Status HTTP:** — · **Severidade:** error
- **Quando dispara:** A resposta do chat falhou depois que o fluxo SSE já tinha começado (status 200 já enviado): evento `error` com `code` e `reference`.
- **Mensagem pública:** Não foi possível obter uma resposta da INIA.
- **Ação segura (usuário):** Enviar a pergunta de novo (a pergunta já ficou salva; nada é cobrado em dobro).
- **Descrição técnica:** O evento SSE `error` leva `{ message, code, reference }`; a referência é o `x-request-id` da requisição e aparece no log e na ocorrência.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Falha do provedor de IA no meio da resposta. | Linha anterior do mesmo `reference` com `AI_*`. |
| Conexão cortada pelo IIS (timeout do proxy, 5 min). | Resposta com mais de 300 s no log do IIS (`time-taken`). |
| Defeito no orquestrador. | `failure` com pilha em `realtime-router`/`orchestrator`. |

**Verificações, em ordem:**

1. Busque a referência no log da API.
2. Veja `time-taken` da mesma referência no log do IIS.
3. Veja Administração › Conversas com a INIA (a pergunta fica marcada sem resposta).

**Onde buscar evidência:**

- Log da API (linha `http_error` com o mesmo `reference`):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Perguntar de novo.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/modules/realtime/presentation/realtime-router.ts`

### INIA-JOB-FALHA

- **Módulo:** Processamento (tarefas periódicas) · **Origem:** JOB · **Status HTTP:** — · **Severidade:** error
- **Quando dispara:** Uma tarefa periódica (Central de Dados, publicação de bases, OCR, avisos, retenção…) lançou exceção numa rodada.
- **Mensagem pública:** Uma tarefa automática da INIA falhou e será tentada de novo.
- **Ação segura (usuário):** Nenhuma ação do usuário; o administrador acompanha.
- **Descrição técnica:** A rodada falha, é registrada (referência `job-<tarefa>-<uuid>`, campo `job`) e a próxima rodada tenta de novo. Estado em `/internal/metrics` (só na VM).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Banco indisponível no momento da rodada. | `failure.code` de conexão; falhas em várias tarefas no mesmo minuto. |
| Dado específico que a tarefa não consegue processar. | Mesma tarefa, mesma mensagem, a cada rodada. |

**Verificações, em ordem:**

1. Busque o código no log do Processamento e veja o campo `job`.
2. Veja `/internal/metrics` na VM (lastError por tarefa).
3. Confirme se a próxima rodada passou.

**Onde buscar evidência:**

- Log do Processamento:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-Processamento*.log" -SimpleMatch '"code":"INIA-JOB-FALHA"' | Select-Object -Last 20
  ```
- Pela referência:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-Processamento*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Métricas internas (na própria VM):

  ```powershell
  Invoke-RestMethod http://127.0.0.1:3333/internal/metrics
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```

**Recuperação:** Falha transitória se resolve na próxima rodada. Repetida: corrigir o dado ou escalar.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/infrastructure/jobs/periodic-jobs.ts`

### INIA-PROCESSO-FALHA

- **Módulo:** Processo Node (API/Processamento) · **Origem:** PROCESS · **Status HTTP:** — · **Severidade:** critical
- **Quando dispara:** Exceção não capturada ou promessa rejeitada sem tratamento (`uncaughtException`/`unhandledRejection`).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em instantes.
- **Descrição técnica:** Rejeição sem tratamento é registrada e o processo segue. Exceção não capturada é registrada e o processo encerra; o WinSW reinicia o serviço (10 s, depois 30 s).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Defeito: promessa sem `catch`. | `kind` unhandledRejection com pilha apontando o módulo. |
| Falha de ambiente (memória, disco). | `failure.code` ENOMEM/ENOSPC; reinícios seguidos no log do WinSW (`INIA-API.wrapper.log`). |

**Verificações, em ordem:**

1. Busque o código no log do serviço.
2. Veja reinícios em `$INIA\logs\INIA-API.wrapper.log`.
3. `Get-Service INIA-*`.

**Onde buscar evidência:**

- Log da API:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch '"code":"INIA-PROCESSO-FALHA"' | Select-Object -Last 20
  ```
- Log do Processamento:

  ```powershell
  Select-String -Path "$INIA\logs\INIA-Processamento*.log" -SimpleMatch '"code":"INIA-PROCESSO-FALHA"' | Select-Object -Last 20
  ```
- Reinícios do WinSW:

  ```powershell
  Get-Content "$INIA\logs\INIA-API.wrapper.log" -Tail 50
  ```

**Recuperação:** O serviço reinicia sozinho. Repetido: escalar com a pilha.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `backend/src/main/server.ts`

### INIA-INTERFACE-RENDERIZACAO

- **Módulo:** Interface (navegador) · **Origem:** CLIENT · **Status HTTP:** — · **Severidade:** error
- **Quando dispara:** Exceção ao montar uma tela no navegador, capturada pela fronteira de erro (`error.tsx`/`global-error.tsx`).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente; se repetir, informar código e referência.
- **Descrição técnica:** O navegador gera a referência e a envia a `POST /api/v1/client-errors`. A tela diz se o registro foi confirmado pelo servidor; se não (offline, API fora), a referência é LOCAL e não será achada no servidor.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Defeito na tela para um dado específico. | Ocorrências com a mesma `route` e a mesma mensagem; só para alguns itens. |
| Navegador antigo/sem suporte. | `details.userAgent` com versão antiga. |
| Interface e API em versões diferentes (resposta com formato novo). | Mensagem de validação zod no `details.message`; `release` diferentes. |

**Verificações, em ordem:**

1. Busque a referência na Administração (Diagnóstico de erros) ou pela CLI.
2. Veja `route`, mensagem e navegador.
3. Repita a mesma tela com a mesma conta.

**Onde buscar evidência:**

- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)
- Log da API (linha client_error):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Contornar pela navegação; atualizar o navegador; publicar versões iguais.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `frontend/src/components/error-states/route-error-boundary.tsx`, `backend/src/modules/error-diagnostics/presentation/client-errors-router.ts`

### INIA-INTERFACE-SERVIDOR

- **Módulo:** Interface (servidor Next) · **Origem:** INTERFACE · **Status HTTP:** 500 · **Severidade:** error
- **Quando dispara:** Exceção ao renderizar uma página no servidor da interface (`next start`); o navegador recebe só o `digest`.
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente.
- **Descrição técnica:** A referência é o `digest` do Next. `instrumentation.ts` grava uma linha JSON `interface_error` com o digest no log do serviço INIA-Interface.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| API inalcançável a partir da interface (`INIA_API_URL`). | Linha com `ECONNREFUSED` para a API no mesmo digest. |
| Defeito em componente de servidor. | Pilha com o arquivo da página. |

**Verificações, em ordem:**

1. Busque o digest no log da Interface.
2. Teste `Invoke-RestMethod http://127.0.0.1:3333/health` da VM.
3. Confira `INIA_API_URL` em `$INIA\frontend\.env.local`.

**Onde buscar evidência:**

- Log da Interface (digest):

  ```powershell
  Select-String -Path "$INIA\logs\INIA-Interface*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```

**Recuperação:** Subir a API ou corrigir `INIA_API_URL` e reiniciar INIA-Interface.

**Escalar para:** Equipe de desenvolvimento da INIA, com o código, a referência, o horário UTC e as linhas do log (já sanitizadas).

**Código:** `frontend/src/instrumentation.ts`

### INIA-REDE-SEM-CONEXAO

- **Módulo:** Interface (navegador) · **Origem:** CLIENT · **Status HTTP:** — · **Severidade:** info
- **Quando dispara:** O navegador está sem internet/rede (`navigator.onLine === false` ou falha de rede com o navegador offline).
- **Mensagem pública:** Opa, perdemos a conexão. Confira sua internet e tente novamente.
- **Ação segura (usuário):** Conferir a internet e tentar novamente. O que foi digitado continua na tela.
- **Descrição técnica:** Problema na rede de quem usa — nada chega ao servidor. A referência é LOCAL (gerada no navegador) e só é enviada quando a conexão volta.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Wi-Fi/rede da pessoa caiu. | Só uma pessoa; volta sozinho. |
| VPN desconectada (INIA em rede interna). | Várias pessoas remotas ao mesmo tempo; quem está no escritório funciona. |

**Verificações, em ordem:**

1. Peça para abrir outro site.
2. Verifique a VPN.
3. Depois que voltar, a referência aparece como enviada (se o envio for confirmado).

**Onde buscar evidência:**

- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```
- Administração › Plataforma › Diagnóstico de erros (busca pela referência)

**Recuperação:** Restabelecer a rede da pessoa.

**Escalar para:** Suporte de rede/estação de trabalho.

**Código:** `frontend/src/components/error-states/offline-screen.tsx`, `frontend/src/lib/api/api-client.ts`

### INIA-REDE-API-INALCANCAVEL

- **Módulo:** Interface (navegador) · **Origem:** CLIENT · **Status HTTP:** — · **Severidade:** error
- **Quando dispara:** O navegador está online, mas a chamada à API falhou sem resposta (conexão recusada, DNS, certificado, CORS).
- **Mensagem pública:** Não conseguimos falar com a INIA agora. Tente novamente.
- **Ação segura (usuário):** Tentar novamente. Gravações: conferir antes se a ação já foi feita.
- **Descrição técnica:** A referência é o `x-request-id` que o navegador enviou: se a requisição chegou ao IIS, ela está no log do IIS (campo x-request-id).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| IIS parado ou site sem a ligação certa. | Nenhuma linha da referência no log do IIS; `Get-Website` com o site Stopped. |
| Certificado HTTPS expirado/inválido. | O navegador mostra aviso de certificado ao abrir o endereço. |
| Endereço da API errado no build da interface (`NEXT_PUBLIC_INIA_API_URL`). | Acontece com todos desde a instalação; a URL chamada não é o endereço público. |

**Verificações, em ordem:**

1. Busque a referência no log do IIS.
2. `Get-Website` e `Get-Service W3SVC`.
3. Abra o endereço público na própria VM.

**Onde buscar evidência:**

- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```

**Recuperação:** Subir o IIS/site, renovar o certificado ou refazer o build com o endereço certo.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `frontend/src/lib/api/api-client.ts`

### INIA-PROXY-INDISPONIVEL

- **Módulo:** Proxy (IIS/ARR) · **Origem:** PROXY · **Status HTTP:** 502 · **Severidade:** critical
- **Quando dispara:** O IIS respondeu 502/503/504 sem o corpo JSON da INIA: o ARR não alcançou nenhuma instância saudável da API (ou estourou o prazo de 5 min).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente em alguns minutos.
- **Descrição técnica:** A falha nasce no proxy, não na API: não há linha na API. A referência (x-request-id enviado pelo navegador) fica no log do IIS com `sc-status` 502 e `sc-substatus` (3 = sem resposta da instância; 4 = sem instância saudável).

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Serviço INIA-API parado/reiniciando. | `Get-Service INIA-API*` diferente de Running; `sc-substatus` 3. |
| Todas as instâncias fora pelo health check (`/ready` 503: banco fora). | `sc-substatus` 4; `/ready` respondendo 503. |
| Requisição passou de 5 min (timeout do ARR). | `time-taken` ≈ 300000 no log do IIS; `sc-status` 502 com `sc-win32-status` 12002. |

**Verificações, em ordem:**

1. Busque a referência no log do IIS e leia `sc-status`, `sc-substatus`, `sc-win32-status`, `time-taken`.
2. `Get-Service INIA-*`.
3. `Invoke-RestMethod http://127.0.0.1:3333/ready`.
4. Gerenciador do IIS › Server Farms › INIA-API › Monitoring.

**Onde buscar evidência:**

- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Serviços:

  ```powershell
  Get-Service INIA-* | Format-Table Name, Status
  ```
- Prontidão da API:

  ```powershell
  Invoke-RestMethod http://127.0.0.1:3333/ready
  ```

**Recuperação:** `Start-Service INIA-API`; resolver o banco se `/ready` = 503.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `frontend/src/lib/api/api-client.ts`, `deploy/windows/iis/configurar-iis.ps1`

### INIA-INTERFACE-RESPOSTA-INVALIDA

- **Módulo:** Interface (navegador) · **Origem:** CLIENT · **Status HTTP:** — · **Severidade:** error
- **Quando dispara:** A API respondeu, mas o corpo não é o JSON esperado (HTML de proxy num 2xx/4xx, resposta truncada).
- **Mensagem pública:** Algo deu errado por aqui. Ocorreu uma falha no sistema.
- **Ação segura (usuário):** Tentar novamente.
- **Descrição técnica:** Algo entre o navegador e a API (proxy corporativo, página de login de rede, filtro de conteúdo) trocou a resposta.

**Causas prováveis (hipóteses — confirme pelo sinal):**

| Hipótese | Sinal que confirma |
| --- | --- |
| Proxy corporativo/portal de rede devolvendo página própria. | Só numa rede; a referência não aparece no log do IIS. |
| Resposta cortada pelo IIS. | Referência no log do IIS com `sc-win32-status` ≠ 0. |

**Verificações, em ordem:**

1. Busque a referência no log do IIS.
2. Repita a ação fora da rede da pessoa.

**Onde buscar evidência:**

- Log do IIS:

  ```powershell
  Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>" | Select-Object -Last 20
  ```
- Ocorrência registrada no banco (CLI da VM, sem interface):

  ```powershell
  node "$INIA\backend\dist\main\diagnostico-de-erros.js" <referência>
  ```

**Recuperação:** Liberar o endereço da INIA no proxy corporativo.

**Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

**Código:** `frontend/src/lib/api/api-client.ts`

## Famílias por status (códigos de regra de negócio dos módulos)

Os códigos abaixo são devolvidos pelos módulos e inventariados automaticamente a partir do código-fonte. A mensagem de cada um
já diz a regra; a família do status diz como investigar.

### FAMILIA-REGRA-DE-NEGOCIO — Regra de negócio ou validação do módulo

- **Status:** 400, 422 · **Severidade:** info
- O módulo recusou a operação por uma regra do produto (a mensagem diz qual). Nada foi gravado.

| Hipótese | Sinal que confirma |
| --- | --- |
| Entrada que não respeita a regra (esperado). | A mensagem do código descreve exatamente o caso; repetível com os mesmos dados. |
| Configuração incompleta (ex.: item sem versão publicada, vínculo ausente). | A regra cita um item de configuração; acontece para todos na mesma tela. |

1. Leia a mensagem do código e as referências de código abaixo.
2. Busque a referência no log da API (`route`).
3. Confira a configuração citada pela mensagem.

**Recuperação:** Corrigir a entrada ou a configuração citada. Não é falha do sistema. **Escalar para:** Administrador funcional da área (dono da configuração).

### FAMILIA-ACESSO — Sessão ou permissão do módulo

- **Status:** 401, 403 · **Severidade:** info
- O módulo negou por sessão ou permissão (além das verificações gerais de UNAUTHENTICATED/FORBIDDEN).

| Hipótese | Sinal que confirma |
| --- | --- |
| Papel/escopo insuficiente para o item. | Conta sem o papel no escopo do item (Administração › Usuários). |

1. Veja os papéis e escopos da conta.
2. Busque a referência e a `route`.

**Recuperação:** Atribuir o papel no escopo certo, se o acesso for devido. **Escalar para:** Administrador de acessos da organização (Administração › Usuários). A INIA não concede acesso por cargo.

### FAMILIA-NAO-ENCONTRADO — Item não encontrado (ou fora do alcance da conta)

- **Status:** 404, 410 · **Severidade:** info
- O item não existe, foi excluído (exclusão lógica) ou a conta não pode vê-lo — a INIA responde igual nos três casos, por segurança.

| Hipótese | Sinal que confirma |
| --- | --- |
| Item excluído. | Consultar dados › Itens excluídos mostra o item. |
| Item de outro escopo. | O item existe, mas fora do escopo da conta. |

1. Procure o item em Consultar dados › Itens excluídos.
2. Confira o escopo da conta.

**Recuperação:** Restaurar o item (se excluído por engano) ou usar uma conta com acesso. **Escalar para:** Administrador funcional da área.

### FAMILIA-CONFLITO — Conflito de estado ou edição concorrente

- **Status:** 409, 412, 423 · **Severidade:** warning
- O item mudou desde que a tela foi aberta, já foi decidido, está em uso ou travado. Nada foi sobrescrito.

| Hipótese | Sinal que confirma |
| --- | --- |
| Outra pessoa alterou o item. | Requisição 2xx de outra conta no mesmo item pouco antes. |
| Item em uso por outro objeto (exclusão bloqueada). | Código *_IN_USE/*_LOCKED; `details` lista dependências. |

1. Atualize a tela e confira o estado atual.
2. Leia `details` na ocorrência.

**Recuperação:** Recarregar e refazer sobre o estado atual; remover dependências antes de excluir. **Escalar para:** Administrador funcional da área.

### FAMILIA-LIMITE — Limite, formato ou cancelamento

- **Status:** 402, 413, 415, 429, 499 · **Severidade:** warning
- Limite de uso/tamanho/orçamento, tipo de arquivo não aceito ou operação cancelada por quem pediu.

| Hipótese | Sinal que confirma |
| --- | --- |
| Uso acima do limite configurado. | A mensagem cita o limite. |

1. Leia a mensagem e `details` (tempo de espera, limite).

**Recuperação:** Aguardar ou ajustar o envio. **Escalar para:** Administrador funcional da área.

### FAMILIA-DEPENDENCIA — Falha de dependência ou do sistema

- **Status:** 500, 502, 503, 504 · **Severidade:** error
- Uma dependência (banco, IA, fonte de dados, parser isolado) falhou ou o módulo encontrou um estado inesperado.

| Hipótese | Sinal que confirma |
| --- | --- |
| Dependência fora do ar. | Outras rotas que usam a mesma dependência falham no mesmo intervalo. |
| Defeito. | Mesma pilha a cada tentativa. |

1. Busque a referência e veja `failure`.
2. Confira `/ready`, serviços e a dependência citada.

**Recuperação:** Restabelecer a dependência; repetir a ação. **Escalar para:** Infraestrutura da VM (servidor, IIS, PostgreSQL). Sem solução em 30 min: equipe de desenvolvimento da INIA com a referência, o horário UTC e as linhas do log.

## Códigos dos módulos (878)

### Módulo `access`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ACCESS_ACCOUNT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Conta não encontrada. | `backend/src/modules/access/application/access-service.ts` |
| `ACCESS_ALREADY_DISABLED` | 409 | FAMILIA-CONFLITO | O acesso desta pessoa já está desabilitado. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_ALREADY_ENABLED` | 409 | FAMILIA-CONFLITO | O acesso desta pessoa já está habilitado. Para uma nova senha, use “Gerar nova senha temporária”. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_ASSIGNMENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Atribuição não encontrada. | `backend/src/modules/access/application/access-service.ts` |
| `ACCESS_CONCURRENT_CHANGE` | 409 | FAMILIA-CONFLITO | Outra pessoa alterou este acesso agora há pouco. Atualize a lista e tente de novo. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_EMAIL_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe o e-mail que a pessoa vai usar para entrar. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_LAST_TENANT_ADMIN` | 409 | FAMILIA-CONFLITO | Este é o último Administrador geral ativo — conceda o papel a outra pessoa antes de revogar. | `backend/src/modules/access/application/access-service.ts`<br>`backend/src/modules/access/application/account-access-service.ts`<br>`backend/src/modules/users/presentation/user-account-router.ts` |
| `ACCESS_NOT_ENABLED` | 409 | FAMILIA-CONFLITO | O acesso desta pessoa está desabilitado — use “Habilitar acesso”. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_PERSON_INACTIVE` | 409 | FAMILIA-CONFLITO | Esta pessoa está inativa no cadastro — reative-a antes de habilitar o acesso. | `backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_PERSON_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pessoa não encontrada. | `backend/src/modules/access/application/access-service.ts`<br>`backend/src/modules/access/application/account-access-service.ts` |
| `ACCESS_ROLE_ALREADY_ASSIGNED` | 409 | FAMILIA-CONFLITO | Esta conta já tem este papel com o mesmo escopo. | `backend/src/modules/access/application/access-service.ts` |
| `ACCESS_SCOPE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escopo inválido para esta organização. | `backend/src/modules/access/application/access-service.ts` |
| `ACCESS_TARGET_LEADS_OUTSIDE_SCOPE` | 403 | FAMILIA-ACESSO | (mensagem montada no código) | `backend/src/modules/access/application/account-access-service.ts` |
| `FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para esta ação. | `backend/src/modules/access/application/access-service.ts`<br>`backend/src/modules/access/application/account-access-service.ts`<br>`backend/src/modules/access/presentation/require-permission.ts`<br>`backend/src/modules/ai-management/application/ai-usage-ranking-service.ts`<br>`backend/src/modules/ai-management/presentation/ai-management-router.ts`<br>`backend/src/modules/checkpoint-registry/presentation/checkpoint-registry-router.ts` |
| `ORGANIZATION_SCOPE_REQUIRED` | 403 | FAMILIA-ACESSO | Esta configuração vale para a organização inteira: só quem a administra em toda a organização pode alterá-la. | `backend/src/modules/access/presentation/require-permission.ts`<br>`backend/src/modules/governance/presentation/governance-router.ts`<br>`backend/src/modules/indicator-rules/presentation/indicator-rule-router.ts`<br>`backend/src/modules/interventions/presentation/intervention-admin-router.ts`<br>`backend/src/modules/knowledge/application/knowledge-versions.ts`<br>`backend/src/modules/org-structure/presentation/org-structure-router.ts` |
| `UNKNOWN_ROLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/access/application/access-service.ts` |

### Módulo `auth`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ACCESS_DISABLED` | 403 | FAMILIA-ACESSO | Seu acesso à INIA está desabilitado. Procure o administrador. | `backend/src/modules/auth/presentation/auth-router.ts` |
| `AUTH_BUSY` | 503 | FAMILIA-DEPENDENCIA | Muitos acessos ao mesmo tempo. Tente de novo em alguns segundos. | `backend/src/modules/auth/infrastructure/password-hasher.ts` |
| `INVALID_CREDENTIALS` | 401 | FAMILIA-ACESSO | E-mail ou senha inválidos. | `backend/src/modules/auth/presentation/auth-router.ts` |
| `LOGIN_TOO_MANY_ATTEMPTS` | 429 | FAMILIA-LIMITE | Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente. | `backend/src/modules/auth/presentation/auth-router.ts` |
| `PASSWORD_CHANGE_NOT_REQUIRED` | 409 | FAMILIA-CONFLITO | Sua senha já foi criada. | `backend/src/modules/auth/application/define-first-password.ts` |
| `PASSWORD_CHANGE_REQUIRED` | 403 | FAMILIA-ACESSO | Crie a sua senha para continuar. | `backend/src/modules/auth/domain/session-state.ts` |
| `PASSWORD_CONFIRMATION_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A confirmação não é igual à nova senha. | `backend/src/modules/auth/application/define-first-password.ts` |
| `PASSWORD_POLICY_VIOLATION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A senha não atende à política de segurança. | `backend/src/modules/auth/application/define-first-password.ts` |
| `PASSWORD_SAME_AS_TEMPORARY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A nova senha precisa ser diferente da senha temporária. | `backend/src/modules/auth/application/define-first-password.ts` |
| `SESSION_IDLE` | 401 | FAMILIA-ACESSO | Sua sessão foi encerrada por inatividade. Entre novamente. | `backend/src/modules/auth/domain/session-state.ts` |
| `SESSION_REVOKED` | 401 | FAMILIA-ACESSO | Sua sessão foi encerrada. Entre novamente. | `backend/src/modules/auth/application/define-first-password.ts`<br>`backend/src/modules/auth/domain/session-state.ts` |
| `TEMPORARY_PASSWORD_EXPIRED` | 401 | FAMILIA-ACESSO | Sua senha temporária expirou. Peça uma nova ao administrador. | `backend/src/modules/auth/domain/session-state.ts`<br>`backend/src/modules/auth/presentation/auth-router.ts` |
| `UNAUTHENTICATED` | 401 | FAMILIA-ACESSO | Sessão ausente ou expirada. | `backend/src/modules/auth/presentation/require-auth.ts`<br>`backend/src/modules/auth/presentation/session-user.ts` |

### Módulo `ai-management`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A conexão é usada por política(s) de roteamento (${deps.rows.map((row) =>  | `backend/src/modules/ai-management/application/ai-connection-service.ts`<br>`backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_BUDGET_DUPLICATE` | 409 | FAMILIA-CONFLITO | Já existe orçamento para este escopo e moeda. | `backend/src/modules/ai-management/application/ai-budget-service.ts` |
| `AI_BUDGET_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/ai-management/application/ai-budget-service.ts` |
| `AI_BUDGET_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Orçamento não encontrado. | `backend/src/modules/ai-management/application/ai-budget-service.ts` |
| `AI_CONNECTION_CREDENTIAL_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${provider.name} não usa credencial. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_CREDENTIAL_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${provider.credentialLabel} é obrigatória para ${provider.name}. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_ENDPOINT_CHANGED` | 409 | FAMILIA-CONFLITO | Outra pessoa mudou o endpoint desta conexão enquanto a credencial era cadastrada. Confira o endpoint atual e cadastre a credencial de novo. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_ENDPOINT_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe o endpoint da conexão. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_HEADER_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_HEADERS_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O provider ${provider.name} não aceita cabeçalhos personalizados. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_IN_USE` | 409 | FAMILIA-CONFLITO | A conexão atende política(s) ativa(s) (${current.activePolicyUseCases.join(", ")}) e ${provider.name} exige credencial. Substitua a chave ou desative as políticas antes. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_NAME_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe uma conexão com esse nome. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_CONNECTION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Conexão não encontrada. | `backend/src/modules/ai-management/application/ai-connection-service.ts`<br>`backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_DISCOVERY_UNSUPPORTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este provider não permite descobrir modelos — cadastre-os manualmente. | `backend/src/modules/ai-management/application/ai-connection-service.ts` |
| `AI_MODEL_DUPLICATE` | 409 | FAMILIA-CONFLITO | Este modelo já está cadastrado nesta conexão. | `backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_MODEL_IN_USE_ACTIVE` | 409 | FAMILIA-CONFLITO | Este modelo atende política(s) ativa(s): ${activeUseCases.join(", ")}. Desabilitá-lo deixa essas políticas sem esse candidato (sem troca silenciosa de modelo). Confirme para prosseguir. | `backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_MODEL_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Modelo não encontrado. | `backend/src/modules/ai-management/application/ai-model-service.ts`<br>`backend/src/modules/ai-management/application/ai-policy-service.ts` |
| `AI_POLICY_ACTIVE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Não há política ativa. | `backend/src/modules/ai-management/application/ai-policy-service.ts` |
| `AI_POLICY_CHAIN_TOO_SHORT` | — | FAMILIA-DEPENDENCIA | Uma cadeia de fallback precisa de ao menos 2 modelos. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_COST_CURRENCY_REQUIRED` | — | FAMILIA-DEPENDENCIA | Informe a moeda do limite de custo por requisição. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_DRAFT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Não há rascunho para ativar. | `backend/src/modules/ai-management/application/ai-policy-service.ts` |
| `AI_POLICY_DUPLICATE_MODEL` | — | FAMILIA-DEPENDENCIA | O mesmo modelo aparece mais de uma vez. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_EMPTY` | — | FAMILIA-DEPENDENCIA | Selecione ao menos um modelo. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_FALLBACK_NOT_ALLOWED` | — | FAMILIA-DEPENDENCIA | Fallback não permitido para: ${invalidFallback.join(", ")} (trocar de provider não resolve esse tipo de erro). | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A política não pode ser ativada: ${view.draft.issues.map((issue) => issue.message).join(" ")} | `backend/src/modules/ai-management/application/ai-policy-service.ts` |
| `AI_POLICY_MODEL_INELIGIBLE` | — | FAMILIA-DEPENDENCIA | ${models.get(modelId)?.displayName ?? modelId}: ${reason}. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_QUALITY_TIER_MISSING` | — | FAMILIA-DEPENDENCIA | QUALITY_FIRST exige o tier declarado em todos os modelos (faltando: ${undeclared.map((model) => model!.displayName).join(", ")}). | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_STRATEGY_NOT_ALLOWED` | — | FAMILIA-DEPENDENCIA | Estratégia só se aplica ao modo automático. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_STRATEGY_REQUIRED` | — | FAMILIA-DEPENDENCIA | Escolha a estratégia do modo automático. | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_POLICY_TOO_MANY_MODELS` | — | FAMILIA-DEPENDENCIA | O modo ${policy.mode} aceita no máximo ${MAX_POLICY_MODELS[policy.mode]} modelo(s). | `backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_PRICING_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_PRICING_OVERLAP` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A nova vigência precisa começar depois do início do preço vigente (o histórico não é reescrito). | `backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_PROVIDER_UNKNOWN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Provider desconhecido. | `backend/src/modules/ai-management/application/ai-connection-service.ts`<br>`backend/src/modules/ai-management/application/ai-model-service.ts` |
| `AI_USAGE_PERIOD_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe um período válido (início antes do fim). | `backend/src/modules/ai-management/application/ai-usage-service.ts` |
| `AI_USAGE_PERIOD_TOO_LONG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O período personalizado pode ter no máximo 1 ano. | `backend/src/modules/ai-management/application/ai-usage-service.ts` |
| `AI_USE_CASE_NOT_ROUTABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | "${useCase.label}" não é configurável nesta versão. | `backend/src/modules/ai-management/application/ai-policy-service.ts`<br>`backend/src/modules/ai-management/domain/ai-routing-policy.ts` |
| `AI_USE_CASE_UNKNOWN` | 404 | FAMILIA-NAO-ENCONTRADO | Use Case desconhecido. | `backend/src/modules/ai-management/application/ai-policy-service.ts`<br>`backend/src/modules/ai-management/domain/ai-routing-policy.ts` |

### Módulo `indicators`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ACTIVE_WORKFLOWS` | — | FAMILIA-DEPENDENCIA | ${plural(active, "Workflow ativo depende", "Workflows ativos dependem")} de uma configuração que a regra nova não aceita. A versão publicada não muda sozinha e a execução falharia. Pause antes de corrigir; depois, aju… | `backend/src/modules/indicators/domain/indicator-correction.ts` |
| `INCOHERENT_VALUES` | — | FAMILIA-DEPENDENCIA | ${plural(scan.incoherentValues, "medição tem", "medições têm")} valor que não confere com numerador ÷ denominador pela estratégia "${label}". O resultado do período não bateria com o que foi medido. ${fix} | `backend/src/modules/indicators/domain/indicator-correction.ts` |
| `INDICATOR_CODE_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um indicador com esse código. | `backend/src/modules/indicators/application/indicator-definition-service.ts` |
| `INDICATOR_CORRECTION_BLOCKED` | 409 | FAMILIA-CONFLITO | Não foi possível corrigir "${definition.name}". ${impact.blockers.map((blocker) => blocker.message).join(" ")} | `backend/src/modules/indicators/application/indicator-correction-service.ts` |
| `INDICATOR_CORRECTION_CONFIRMATION_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Para confirmar, digite o código do indicador: ${definition.code}. | `backend/src/modules/indicators/application/indicator-correction-service.ts` |
| `INDICATOR_HAS_DEPENDENTS` | 409 | FAMILIA-CONFLITO | "${current.name}" é usado agora (${reasons}) e não pode ser excluído. Tire-o de lá ou aguarde as execuções terminarem, ou desative-o. | `backend/src/modules/indicators/application/indicator-definition-service.ts` |
| `INDICATOR_INVALID_CODE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O código deve começar com letra e conter apenas letras maiúsculas, números e underscore (ex.: DIGITAL_RESOLUTION_RATE). | `backend/src/modules/indicators/domain/indicator-definition.ts` |
| `INDICATOR_INVALID_CONFIGURATION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A estratégia "${strategy.label}" só é válida para ${strategy.allowedUnits.map((unit) => INDICATOR_UNIT_METADATA[unit].label).join(", ")} — ${INDICATOR_UNIT_METADATA[input.unit].label} não é compatível. | `backend/src/modules/indicators/domain/indicator-definition.ts` |
| `INDICATOR_SEMANTIC_LOCKED` | 409 | FAMILIA-CONFLITO | Não é possível alterar ${fields.join(", ")} de "${current.name}" por aqui: o indicador já tem histórico (${describeDependencies(dependencies)}). ${guidance} | `backend/src/modules/indicators/application/indicator-definition-service.ts` |
| `INVALID_CONFIGURATION` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/indicators/domain/indicator-correction.ts` |
| `MISSING_COMPONENTS` | — | FAMILIA-DEPENDENCIA | ${plural(scan.missingComponents, "medição não tem", "medições não têm")} numerador e denominador, que a estratégia "${label}" exige. O resultado do período ficaria errado, porque essas linhas entrariam com peso 1.${sc… | `backend/src/modules/indicators/domain/indicator-correction.ts` |
| `NO_CHANGE` | — | FAMILIA-DEPENDENCIA | Nada mudou: escolha outra unidade, direção ou estratégia. | `backend/src/modules/indicators/domain/indicator-correction.ts` |
| `VALUES_OUTSIDE_UNIT` | — | FAMILIA-DEPENDENCIA | ${plural(scan.outOfUnitRange, "medição tem", "medições têm")} valor fora do que a unidade "${INDICATOR_UNIT_METADATA[next.unit].label}" aceita. A carga recusaria essas linhas hoje. | `backend/src/modules/indicators/domain/indicator-correction.ts` |

### Módulo `agents`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AGENT_ACCESS_NOT_AUTHORIZED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/agents/application/agent-execution-authorization.ts` |
| `AGENT_ACTION_LIMITS_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_DELETE_BLOCKED` | 409 | FAMILIA-CONFLITO | (mensagem montada no código) | `backend/src/modules/agents/application/agent-deletion.ts` |
| `AGENT_DRAFT_CONFLICT` | 409 | FAMILIA-CONFLITO | Outra pessoa alterou o rascunho deste agente depois que você o abriu. Atualize para ver a versão atual; o que você digitou continua na tela. | `backend/src/modules/agents/application/agent-versions.ts` |
| `AGENT_DRAFT_PENDING` | 409 | FAMILIA-CONFLITO | Este agente tem um rascunho em andamento. Reverter publica a configuração escolhida como versão nova e descarta o rascunho — confirme para continuar. | `backend/src/modules/agents/application/agent-versions.ts` |
| `AGENT_EXECUTION_EMPTY` | 502 | FAMILIA-DEPENDENCIA | O agente não retornou nenhum texto. | `backend/src/modules/agents/infrastructure/gemini-agent-client.ts` |
| `AGENT_EXECUTION_FAILED` | 502 | FAMILIA-DEPENDENCIA | O modelo de IA não retornou uma resposta válida. | `backend/src/modules/agents/infrastructure/gemini-agent-client.ts` |
| `AGENT_EXECUTION_NETWORK_ERROR` | 504 | FAMILIA-DEPENDENCIA | Não foi possível contatar o modelo de IA. | `backend/src/modules/agents/infrastructure/gemini-agent-client.ts` |
| `AGENT_EXECUTION_NOT_CONFIGURED` | 503 | FAMILIA-DEPENDENCIA | Execução de agentes não está configurada neste ambiente (falta GEMINI_API_KEY). | `backend/src/modules/agents/infrastructure/gemini-agent-client.ts` |
| `AGENT_EXECUTION_TIMEOUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/agents/infrastructure/gemini-agent-client.ts` |
| `AGENT_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este agente está inativo. | `backend/src/modules/agents/domain/agent-inactive-error.ts`<br>`backend/src/modules/indicator-diagnosis/application/simulate-diagnostic-strategy.ts`<br>`backend/src/modules/qa-lab/application/run-agent-simulation.ts` |
| `AGENT_INACTIVE_RESTRICTED` | 403 | FAMILIA-ACESSO | Este agente está inativo. Só administradores consultam o cadastro, o histórico completo e as execuções de agentes inativos, e podem reativá-los ou excluí-los. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_KNOWLEDGE_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Uma das bases de conhecimento selecionadas não existe ou foi excluída. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_KNOWLEDGE_SCOPE_FORBIDDEN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Uma das bases de conhecimento selecionadas vale para outro Grupo — escolha bases globais ou do Grupo deste agente. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_NAME_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um agente com esse nome. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Agente não encontrado. | `backend/src/modules/agents/application/agent-deletion.ts`<br>`backend/src/modules/agents/application/agent-versions.ts`<br>`backend/src/modules/agents/application/run-agent.ts`<br>`backend/src/modules/agents/presentation/agent-router.ts`<br>`backend/src/modules/indicator-diagnosis/application/simulate-diagnostic-strategy.ts`<br>`backend/src/modules/indicator-diagnosis/presentation/diagnostic-strategy-router.ts` |
| `AGENT_NOT_PUBLISHED` | 409, 422 | FAMILIA-CONFLITO | Este agente ainda não foi publicado: o rascunho é tudo o que existe dele. | `backend/src/modules/agents/application/agent-versions.ts`<br>`backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_NOTHING_TO_PUBLISH` | 409 | FAMILIA-CONFLITO | Não há alterações em rascunho para publicar. | `backend/src/modules/agents/application/agent-versions.ts` |
| `AGENT_RUN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Execução não encontrada. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para mover o agente para esse escopo. | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_SPECIALTY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/agents/presentation/agent-router.ts` |
| `AGENT_UNEXPECTED_RESPONSE` | 502 | FAMILIA-DEPENDENCIA | Resposta inesperada do agente no reparo de cobertura. | `backend/src/modules/agents/application/run-agent.ts` |
| `AGENT_VERSION_NOT_FOUND` | 404, 422 | FAMILIA-NAO-ENCONTRADO | A versão do agente referenciada não existe. | `backend/src/modules/agents/application/agent-versions.ts`<br>`backend/src/modules/agents/presentation/agent-router.ts` |
| `APPLICABILITY_INVALID` | — | FAMILIA-DEPENDENCIA | Entrada de aplicabilidade fora do contrato (a aplicabilidade decide quais etapas podem ser julgadas). | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `CHECKPOINT_CAPACITY_EXCEEDED` | — | FAMILIA-DEPENDENCIA | O documento apresentado tem ${presentedSteps} etapas (teto ${capacity}). | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `CHECKPOINT_CONDUCT_REQUIRED` | — | FAMILIA-DEPENDENCIA | FOLLOWED/NOT_FOLLOWED precisam de conductEvidence (papel da fala e relação com a conduta). | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `CHECKPOINT_DEPENDS_ON_UNKNOWN` | — | FAMILIA-DEPENDENCIA | dependsOn precisa ser o código [CP-…] de OUTRA etapa apresentada. | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `CHECKPOINT_REF_REQUIRED` | — | FAMILIA-DEPENDENCIA | Cada etapa precisa do código [CP-…] que a marca no trecho apresentado. | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `CHECKPOINT_REF_UNKNOWN` | — | FAMILIA-DEPENDENCIA | O código não existe entre as etapas apresentadas nesta chamada (o modelo não cria etapa). | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `EVIDENCE_NOT_VERBATIM` | — | FAMILIA-DEPENDENCIA | Não é trecho literal da transcrição. | `backend/src/modules/agents/application/run-agent.ts` |
| `JSON_INVALID` | — | FAMILIA-DEPENDENCIA | A resposta não é um JSON válido. | `backend/src/modules/agents/application/run-agent.ts` |
| `NO_VALID_CHECKPOINT` | — | FAMILIA-DEPENDENCIA | Nenhuma etapa proposta respeitou o contrato. | `backend/src/modules/agents/domain/process-assessment-contract.ts` |
| `OPERATOR_WITHOUT_TEAM` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O operador desta interação não está associado a um grupo. | `backend/src/modules/agents/application/run-agent.ts` |
| `PROCESS_ASSESSMENT_MISSING` | — | FAMILIA-DEPENDENCIA | O campo obrigatório processAssessment não veio como objeto. | `backend/src/modules/agents/application/run-agent.ts`<br>`backend/src/modules/agents/domain/process-assessment-contract.ts` |

### Módulo `investigation`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AGENT_EVIDENCE_ENVELOPE_MISSING` | 502 | FAMILIA-DEPENDENCIA | A resposta não trouxe o envelope de evidência validável após correção — descartada (fail-closed). | `backend/src/modules/investigation/application/text-evidence-gating.ts` |
| `AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM` | 502 | FAMILIA-DEPENDENCIA | A resposta mantém afirmações sem evidência após correção (${salvage.persistentRejections.map((item) =>  | `backend/src/modules/investigation/application/text-evidence-gating.ts` |
| `INVESTIGATION_SUBJECT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Colaborador não encontrado nesta organização. | `backend/src/modules/investigation/application/tool-context.ts` |
| `TOOL_INVALID_ARGUMENTS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/investigation/application/tool-executor.ts` |
| `TOOL_INVALID_INDICATOR` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Indicador "${indicatorCode}" não existe no catálogo. Códigos válidos: ${known.rows.map((item) => item.code).join(", ")}. | `backend/src/modules/investigation/application/tool-context.ts` |
| `TOOL_INVALID_PERIOD` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Período inválido. | `backend/src/modules/investigation/application/tool-context.ts` |
| `TOOL_KNOWLEDGE_UNAVAILABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Consulta à base indisponível: esta análise não tem um Agent com bases autorizadas. | `backend/src/modules/investigation/application/tools/context-tools.ts` |

### Módulo `workflows`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AGENT_STRUCTURED_OUTPUT_INCOMPLETE` | 502 | FAMILIA-DEPENDENCIA | O Agent de síntese não retornou todos os campos obrigatórios. | `backend/src/modules/workflows/application/synthesis-agent-executor.ts` |
| `AGENT_STRUCTURED_OUTPUT_INVALID` | 502 | FAMILIA-DEPENDENCIA | O Agent de síntese não retornou um JSON válido. | `backend/src/modules/workflows/application/synthesis-agent-executor.ts` |
| `CHANGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `ENROLLMENT_CONCURRENT_UPDATE` | 409 | FAMILIA-CONFLITO | A execução mudou de estado enquanto a decisão era enviada — tente novamente. | `backend/src/modules/workflows/application/submit-human-review-decision.ts` |
| `ENROLLMENT_NOT_AWAITING_DECISION` | 409 | FAMILIA-CONFLITO | Esta execução não está aguardando decisão neste nó. | `backend/src/modules/workflows/application/submit-human-review-decision.ts` |
| `ENROLLMENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Execução não encontrada. | `backend/src/modules/workflows/application/submit-human-review-decision.ts` |
| `FOLLOW_UP` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Output "${node.label}" publicaria o resultado de "${source.node.label}" direto ${node.config.surfaces.includes("FOLLOW_UP") ? "no Acompanhamento" : "no Chat/Avatar"} do operador. Feedback oficial de monitoria/indica… | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `HUMAN_REVIEW_SELF_DECISION` | 403 | FAMILIA-ACESSO | Ninguém decide a revisão do próprio resultado. | `backend/src/modules/workflows/application/submit-human-review-decision.ts` |
| `START` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `TARGET` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${nodeLabel}" usa Quartil operacional para um indicador sem direção de desempenho oficial definida (meta por faixa/alvo — "TARGET"). Sem direção HIGHER/LOWER não há regra de classificação em quartis. | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_ACTION_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" gera feedback de um colaborador sobre uma interação ou medição — não existe nesse ponto de um Workflow consolidado. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_AGENT_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o agente "${agent.name}", que está inativo. Ative-o (ou publique uma versão sem ele) antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_AGENT_INVALID_TYPE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" chama "${found.name}", que é o agente-coordenador de um Orquestrador — use o nó Orquestrador, ou escolha um agente especialista. | `backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_AGENT_NOT_AUTHORIZED` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" usa o agente "${agent.name}", cuja versão vigente não está autorizada para este Workflow (alcance ou bases do agente). Ajuste o agente antes de executar. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_AGENT_NOT_CONSOLIDATED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" chama "${found.name}" depois de "Consolidar resultados", mas esse agente analisa um colaborador por vez — escolha um Agent de síntese (ou marque o agente como "aceita resultado consolidado"). | `backend/src/modules/workflows/application/publish-validation/actions.ts`<br>`backend/src/modules/workflows/application/synthesis-agent-executor.ts` |
| `WORKFLOW_AGENT_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa um agente que não existe mais. Publique uma versão com outro agente antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_AGENT_NOT_PUBLISHED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o agente "${agent.name}", que ainda não foi publicado. Publique-o antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_AGENT_SCOPE_FORBIDDEN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O agente "${found.name}" não está disponível para o grupo deste workflow. | `backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" chama "${found.name}", que é um Agent de síntese — ele só roda depois de "Consolidar resultados". | `backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_APPLY_INDIVIDUALLY_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" ("Aplicar individualmente") exige uma coleção de colaboradores — adicione "Selecionar colaboradores" antes dele. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_APPLY_INDIVIDUALLY_MULTIPLE_JOINS` | — | FAMILIA-DEPENDENCIA | "${applyNode?.label ?? applyId}" ("Aplicar individualmente") alcança mais de um "Consolidar resultados" diferente — só um Join é permitido por fan-out. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_CONSOLIDATE_RESULTS_AMBIGUOUS_ORIGIN` | — | FAMILIA-DEPENDENCIA | "${joinNode.label}" ("Consolidar resultados") é alcançado por mais de um "Aplicar individualmente" diferente — a origem ficou ambígua. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" ("Consolidar resultados") exige um colaborador individual como contexto de entrada — ele espera pelas execuções nascidas de "Aplicar individualmente". | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN` | — | FAMILIA-DEPENDENCIA | "${joinNode.label}" ("Consolidar resultados") precisa estar associado a um "Aplicar individualmente". | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_CONSOLIDATED_MODE_INVALID_TRIGGER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A Estrutura Consolidada configurada só é válida para Agenda de calendário — troque o Alvo da avaliação para Individual antes de publicar. | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/lifecycle-routes.ts` |
| `WORKFLOW_DISPATCH_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Disparo não encontrado. | `backend/src/modules/workflows/presentation/workflow-results-router.ts` |
| `WORKFLOW_EMPLOYEE_COLLECTION_INVALID_MODE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${collectionNode.label}" só é válido quando o Workflow analisa uma Estrutura Consolidada. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_ENROLLMENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Execução não encontrada. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN` | — | FAMILIA-DEPENDENCIA | Nem todos os caminhos individuais de "${applyNode.label}" ("Aplicar individualmente") chegam ao mesmo "Consolidar resultados" — algum caminho termina antes de consolidar. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não dá para saber se "${node.label}" é feedback de monitoria ou de indicador com este gatilho e esta origem. Escolha o tipo explicitamente (monitoria exige gatilho por Flag ou Manual com interação; indicador, gatilho … | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_INDICATOR_ORCHESTRATOR_UNSUPPORTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | "${node.label}" é feedback de indicador a partir de um Orquestrador — ainda não suportado: o Orquestrador não recebe o contexto canônico do indicador. Use "Chamar agente" como origem. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_INDICATOR_REQUIRES_CANONICAL_CONTEXT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | "${node.label}" é feedback de indicador, que precisa do dado canônico de uma medição — só existe com gatilho por Indicador ou Manual com medição (modo Individual). | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | "${node.label}" é feedback de monitoria, que precisa da interação do gatilho por Flag de canal ou Manual com interação (modo Individual). | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_SOURCE_INCOMPATIBLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A origem de "${node.label}" ("${source.label}") não é um "Chamar agente" ou "Orquestrador" que analisa um colaborador. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A origem de "${node.label}" ("${source.label}") precisa vir ANTES dele no fluxo. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_SOURCE_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" precisa de uma origem: escolha o "Chamar agente" ou "Orquestrador" cujo resultado vira feedback. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_FEEDBACK_WITHOUT_OUTPUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O feedback de "${node.label}" não é entregue a ninguém. Adicione um Output com ele como conteúdo. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_HUMAN_REVIEW_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_INDICATOR_DIAGNOSIS_DOMAIN_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Agent do nó "${node.label}" não pertence a um domínio permitido na estratégia de diagnóstico do indicador. | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_INDICATOR_DIAGNOSIS_INDICATOR_UNAVAILABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" diagnostica um indicador inativo ou sem fechamento oficial. | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_INDICATOR_DIAGNOSIS_REQUIRES_INDICATOR` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o formato "Diagnóstico do indicador", mas o indicador não tem estratégia de diagnóstico publicada e ativa. Configure-a em Indicadores › Diagnóstico com IA. | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_INDICATOR_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${use.subject} usa o indicador "${indicator.name}", que está desativado — indicadores desativados não entram em Workflows novos. | `backend/src/modules/workflows/application/validate-indicator-capabilities.ts` |
| `WORKFLOW_INDICATOR_NO_OFFICIAL_CLOSURE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${use.subject} usa o fechamento oficial (atingimento/quartil) de "${indicator.name}", que não tem fechamento oficial habilitado — use o Valor do indicador (medição operacional). | `backend/src/modules/workflows/application/validate-indicator-capabilities.ts` |
| `WORKFLOW_INDICATOR_NOT_OPERATIONAL` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${use.subject} usa uma janela operacional (dias, semana ou quartil operacional) para "${indicator.name}", que não tem medição operacional habilitada — use períodos mensais/fechamentos ou habilite a medição operacional… | `backend/src/modules/workflows/application/validate-indicator-capabilities.ts` |
| `WORKFLOW_INTERACTION_FEEDBACK_DISABLED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" gera feedback de atendimento, mas esse módulo está desligado neste ambiente. Remova o nó ou habilite o módulo antes de publicar. | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_INTERACTION_FEEDBACK_NO_INTERACTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa "Interação que disparou o Workflow", que só existe com gatilho por Flag de canal (ou Manual com interação) no modo Individual. Troque a origem para "Interações do colaborador no período" ou us… | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_INTERVENTION_POLICY_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa a política "${policy.name}", que está inativa. | `backend/src/modules/workflows/application/publish-validation/intervention-policy.ts` |
| `WORKFLOW_INTERVENTION_POLICY_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_INTERVENTION_POLICY_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa uma política de acompanhamento que não existe mais. | `backend/src/modules/workflows/application/publish-validation/intervention-policy.ts` |
| `WORKFLOW_INTERVENTION_POLICY_SCOPE_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A política "${policy.name}" vale para outro Grupo/Subgrupo: nenhum colaborador deste Workflow estaria no escopo dela. | `backend/src/modules/workflows/application/publish-validation/intervention-policy.ts` |
| `WORKFLOW_INTERVENTION_POLICY_SOURCE_NOT_ANCESTOR` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa como referência de análise um nó que não vem antes dele no fluxo. | `backend/src/modules/workflows/application/publish-validation/intervention-policy.ts` |
| `WORKFLOW_INTERVENTION_POLICY_UNPUBLISHED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A política "${policy.name}" ainda não tem versão publicada: publique a política antes do Workflow. | `backend/src/modules/workflows/application/publish-validation/intervention-policy.ts` |
| `WORKFLOW_INVALID_ACTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A ação "${label}" tem uma origem dinâmica inválida. | `backend/src/modules/workflows/application/publish-validation/actions.ts`<br>`backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_INVALID_CONDITION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó de condição "${label}" precisa de uma origem selecionada. | `backend/src/modules/workflows/application/publish-validation/conditions.ts`<br>`backend/src/modules/workflows/application/publish-validation/node-references.ts` |
| `WORKFLOW_INVALID_GRAPH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A versão publicada não tem nó Gatilho. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/trigger-context.ts`<br>`backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_INVALID_TRIGGER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O gatilho Manual não diz de qual indicador é a medição. Escolha o indicador nas configurações do workflow. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/trigger-context.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `WORKFLOW_MANUAL_RUN_COLLABORATOR_NOT_ELIGIBLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${row.name} não é elegível para este workflow (precisa ser um operador ativo dentro da Abrangência e do Filtro Populacional do workflow). | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_COLLABORATOR_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Colaborador não encontrado no seu escopo. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_CONFLICT` | 409 | FAMILIA-CONFLITO | Não foi possível registrar o disparo. Tente de novo. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_CONTEXT_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este workflow manual pede "${MANUAL_TRIGGER_CONTEXT_LABELS[target.trigger.context]}", não "${MANUAL_TRIGGER_CONTEXT_LABELS[context]}". | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_CONTEXT_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Selecione a interação do colaborador que será analisada. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_CONTEXT_UNEXPECTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este workflow não usa uma interação selecionada. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_IDEMPOTENCY_CONFLICT` | 409 | FAMILIA-CONFLITO | Esta solicitação já foi usada para outro disparo. Abra o diálogo de novo para uma nova execução. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_INACTIVE` | — | FAMILIA-DEPENDENCIA | O workflow está desativado. Ative-o antes de executar. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_INTERACTION_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A interação selecionada não pertence a este colaborador. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_MEASUREMENT_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A medição selecionada não é deste colaborador e do indicador deste workflow. | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Execução manual não encontrada. | `backend/src/modules/workflows/presentation/workflow-router/manual-run-routes.ts` |
| `WORKFLOW_MANUAL_RUN_NOT_MANUAL` | — | FAMILIA-DEPENDENCIA | Este workflow não usa o gatilho Manual — ele começa pelo próprio gatilho (Flag, Indicador ou Agenda). | `backend/src/modules/workflows/application/manual-run.ts` |
| `WORKFLOW_MANUAL_RUN_NOT_PUBLISHED` | — | FAMILIA-DEPENDENCIA | O workflow ainda não foi publicado. Publique o rascunho antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O gatilho Manual executa para um colaborador — troque o Alvo da avaliação para Individual. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_MISSING_BRANCH_EDGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" não está ligado ao próximo passo. Conecte a saída dele antes de publicar. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts`<br>`backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_MISSING_OUTPUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O workflow chama um agente mas não tem nenhum nó Output — o resultado do agente nunca seria publicado. Adicione um nó Output. | `backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_NODE_INVARIANT` | — | FAMILIA-DEPENDENCIA | Nó "${row.current_node_id}" não existe mais na versão pinada deste workflow. | `backend/src/modules/workflows/application/engine.ts` |
| `WORKFLOW_NOT_PUBLISHED` | 409 | FAMILIA-CONFLITO | Este workflow ainda não foi publicado — não há configuração publicada para restaurar. | `backend/src/modules/workflows/presentation/workflow-router/lifecycle-routes.ts` |
| `WORKFLOW_OPERATIONAL_QUARTILE_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_ORCHESTRATOR_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o Orquestrador "${orchestrator.name}", que está inativo. Ative-o (ou publique uma versão sem ele) antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o Orquestrador "${orchestrator.name}", que só atende chat/voz. Publique uma versão com um Orquestrador habilitado para Workflows antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_ORCHESTRATOR_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" usa o Orquestrador, que exige um colaborador individual como contexto. Adicione "Aplicar individualmente" antes deste nó. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_ORCHESTRATOR_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa um Orquestrador que não existe mais. Publique uma versão com outro Orquestrador antes de executar. | `backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" declara um domínio de negócio inexistente ou inativo no roteamento. | `backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_ORCHESTRATOR_SCOPE_FORBIDDEN` | 409, 422 | FAMILIA-CONFLITO | O Orchestrator "${orchestratorRow.name}" não está disponível para o grupo deste workflow. | `backend/src/modules/workflows/application/publish-validation/orchestrators.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `WORKFLOW_ORCHESTRATOR_VERSION_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" referencia uma versão que não é do Orquestrador "${found.name}". | `backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_ORCHESTRATOR_VERSION_SCOPE_FORBIDDEN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" fixa uma versão do Orquestrador "${found.name}" que não está disponível para o grupo deste workflow — use a versão atual. | `backend/src/modules/workflows/application/publish-validation/orchestrators.ts` |
| `WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Output "${node.label}" entrega o feedback de "${source.node.label}" no Chat/Avatar de outra pessoa. O feedback é do colaborador analisado: use "O próprio operador" (para a gestão, use Acompanhamento ou Notificação). | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Output "${node.label}" precisa publicar o feedback inteiro de "${source.node.label}", não um campo dele. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não foi possível determinar um ${ROLE_LABELS[role]} na cadeia de gestão deste operador. | `backend/src/modules/workflows/application/output-executor.ts` |
| `WORKFLOW_OUTPUT_SURFACE_UNSUPPORTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Output "${node.label}" usa superfície(s) que ainda não têm consumidor real (${unsupported.join(", ")}). Para feedback, use Acompanhamento, Notificação, Chat ou Avatar. | `backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_OUTPUT_TARGET_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_PAID_CYCLE_WITHOUT_WAIT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${paid.label}" chama a IA e faz parte de um caminho que volta para ele sem passar por uma Espera: cada volta faria uma nova chamada paga, sem pausa. Inclua uma Espera no caminho de volta ou desfaça o ciclo antes… | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_PAID_NODE_RUN_LIMIT` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" chama a IA e já rodou ${runs} vezes nesta execução (limite: ${env.WORKFLOW_MAX_PAID_NODE_RUNS}). A execução foi encerrada para não repetir o gasto de IA. | `backend/src/modules/workflows/application/engine.ts` |
| `WORKFLOW_PERFORMANCE_QUERY_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_POPULATION_FILTER_INVALID_TRIGGER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Filtro Populacional configurado só é válido para Agenda — troque o filtro para "Todos os colaboradores elegíveis" antes de publicar. | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/lifecycle-routes.ts` |
| `WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${assessmentNode.label}" usa o formato "Avaliação de processo", que exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação. | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_PROCESS_AUDIT_REQUIRES_FLAG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${auditNode.label}" usa o formato "Conformidade de processo", que exige uma transcrição de chamada — só disponível com gatilho por Flag de canal ou Manual com interação. | `backend/src/modules/workflows/application/publish-validation/trigger-context.ts` |
| `WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o formato "Diagnóstico do fechamento do PRV", que parte do fechamento oficial — só com gatilho por Agenda (ou Manual por colaborador) e a fonte de dados "Fechamentos oficiais". | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts`<br>`backend/src/modules/workflows/application/publish-validation/reliable-feedback.ts` |
| `WORKFLOW_RECIPIENT_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Uma pessoa escolhida como destinatário ou revisor não existe mais, está inativa ou não pertence a esta organização. | `backend/src/modules/workflows/application/publish-validation/review-escalation.ts` |
| `WORKFLOW_RECOGNITION_REQUIRES_RANKING` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O nó "${node.label}" usa o formato "Reconhecimento", que precisa da fonte de dados "Fechamentos oficiais" e de um "Selecionar colaboradores" antes, por ranking de "Melhores desempenhos" ou de evolução. É dele que vem … | `backend/src/modules/workflows/application/publish-validation/indicator-diagnosis.ts` |
| `WORKFLOW_RETRY_CONTENT_MISSING` | — | FAMILIA-DEPENDENCIA | O conteúdo a revisar continua ausente nesta versão. Publique uma versão que corrija a origem do conteúdo. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_FAN_OUT_MISSING` | — | FAMILIA-DEPENDENCIA | A versão vigente do Workflow não tem mais a etapa de envio para vários colaboradores desta execução. Publique uma versão com essa etapa ou execute o Workflow de novo. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | Já existe uma nova tentativa desta execução em andamento. Aguarde ela terminar. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_NOT_BLOCKED` | 409 | FAMILIA-CONFLITO | Só uma execução bloqueada aceita nova tentativa. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_RECONFIRM` | 409 | FAMILIA-CONFLITO | O que será usado na nova tentativa mudou desde que você abriu a confirmação. Confira os dados atualizados e confirme de novo. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_RECORD_CANCELLED` | — | FAMILIA-DEPENDENCIA | A medição desta execução foi cancelada na Central de Dados. Ela precisa voltar a valer, por uma carga ou por Reativar, antes de uma nova tentativa. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_REVIEWER_MISSING` | — | FAMILIA-DEPENDENCIA | ${NO_REVIEWER_MESSAGES[cause]} Ajuste a hierarquia ou o revisor da etapa antes de tentar de novo. | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_RETRY_WORKFLOW_INACTIVE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/workflows/application/workflow-retry.ts` |
| `WORKFLOW_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para publicar este workflow na Abrangência do rascunho. | `backend/src/modules/workflows/application/publish-workflow.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `WORKFLOW_SELECT_EMPLOYEES_INVALID_MODE` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" ("Selecionar colaboradores") exige uma estrutura ou uma coleção como contexto — não pode vir depois de "Aplicar individualmente". | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_SELECT_EMPLOYEES_MISSING_CRITERION` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" ("Selecionar colaboradores") precisa de um critério de seleção configurado. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_SELECT_EMPLOYEES_MISSING_RANKING` | — | FAMILIA-DEPENDENCIA | O nó "${node.label}" ("Selecionar colaboradores") precisa de uma configuração de ranking. | `backend/src/modules/workflows/application/publish-validation/fan-out.ts` |
| `WORKFLOW_STRUCTURED_FIELD_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A ação "${label}" usa o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador. | `backend/src/modules/workflows/application/publish-validation/actions.ts`<br>`backend/src/modules/workflows/application/publish-validation/conditions.ts`<br>`backend/src/modules/workflows/application/publish-validation/outputs.ts` |
| `WORKFLOW_TRIGGER_CONSOLIDATED_MODE_CONFLICT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `WORKFLOW_TRIGGER_POPULATION_FILTER_CONFLICT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não é possível trocar o gatilho: este workflow tem um Filtro Populacional configurado, que só é válido para Agenda. Troque o filtro para "Todos os colaboradores elegíveis" antes. | `backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `WORKFLOW_VARIABLE_CYCLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Ciclo entre variáveis: ${cycleNames.join(" → ")}. Uma variável nunca pode depender dela mesma, mesmo indiretamente. | `backend/src/modules/workflows/application/publish-validation/actions.ts` |
| `WORKFLOW_VARIABLE_IN_USE` | 409 | FAMILIA-CONFLITO | Esta variável está em uso por um ou mais nós deste workflow (rascunho ou versão publicada) — remova as referências antes de excluí-la. | `backend/src/modules/workflows/presentation/workflow-router/variable-routes.ts` |
| `WORKFLOW_VARIABLE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Variável não encontrada. | `backend/src/modules/workflows/presentation/workflow-router/variable-routes.ts` |

### Módulo `shared`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AI_AUTH` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_BUDGET_EXCEEDED` | 402 | FAMILIA-LIMITE | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_CALL_CANCELLED` | 499 | FAMILIA-LIMITE | A solicitação à INIA foi cancelada. | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_CAPACITY_BUSY` | 503 | FAMILIA-DEPENDENCIA | A INIA está atendendo muitas solicitações neste momento. Tente de novo em alguns segundos. | `backend/src/shared/application/model-routing/ai-call-limiter.ts` |
| `AI_CONTEXT_LIMIT` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_INVALID_REQUEST` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_MODEL_UNAVAILABLE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_NETWORK` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_PROVIDER_ERROR` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_RATE_LIMIT` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_ROUTE_UNAVAILABLE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_TIMEOUT` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `AI_UNKNOWN` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/model-routing/ai-errors.ts` |
| `CODIGO` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/shared/infrastructure/errors/scan-error-codes.ts` |
| `CROSS_SITE_REQUEST_BLOCKED` | 403 | FAMILIA-ACESSO | Requisição bloqueada: origem não autorizada. | `backend/src/shared/presentation/origin-guard.ts` |
| `STOP_BEFORE_AI` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/shared/application/llm-telemetry.ts` |

### Módulo `argument-scripts`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ALL_TEAMS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_ALTERNATIVES_NEED_TWO` | — | FAMILIA-DEPENDENCIA | Um grupo de alternativas precisa de pelo menos duas opções. | `backend/src/modules/argument-scripts/domain/argument-script.ts` |
| `ARGUMENT_SCRIPT_ARCHIVED` | 409 | FAMILIA-CONFLITO | Argumentário encerrado: reative-o para publicar. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_AREA_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe a área responsável. | `backend/src/modules/argument-scripts/application/argument-script-service.ts`<br>`backend/src/modules/argument-scripts/domain/argument-script.ts` |
| `ARGUMENT_SCRIPT_EFFECTIVE_ORDER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A nova vigência precisa começar depois do início da versão vigente. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_EMPTY` | — | FAMILIA-DEPENDENCIA | Cadastre ao menos uma orientação, um ponto obrigatório ou uma conduta a evitar. | `backend/src/modules/argument-scripts/domain/argument-script.ts` |
| `ARGUMENT_SCRIPT_NAME_REQUIRED` | — | FAMILIA-DEPENDENCIA | Informe o nome do argumentário. | `backend/src/modules/argument-scripts/domain/argument-script.ts` |
| `ARGUMENT_SCRIPT_NO_DRAFT` | 409 | FAMILIA-CONFLITO | Não há rascunho para descartar. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Argumentário não encontrado. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_NOT_READY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O rascunho ainda não pode ser publicado. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_NOT_STARTED` | 409 | FAMILIA-CONFLITO | A versão publicada ainda não começou a valer: publique outra data ou aguarde o início para encerrar. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_RETROACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A vigência não pode começar antes da publicação: uma regra publicada agora nunca vale para chamadas anteriores. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Seu escopo de administração não cobre o escopo deste argumentário. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_SCOPE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha o grupo. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_SCOPE_LOCKED` | 409 | FAMILIA-CONFLITO | O escopo de um argumentário já publicado não muda (preserva a quem a regra valia). Encerre este e crie outro. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_SOURCE_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Documento de origem não encontrado. | `backend/src/modules/argument-scripts/application/argument-script-service.ts` |
| `ARGUMENT_SCRIPT_TRIGGER_REQUIRED` | — | FAMILIA-DEPENDENCIA | Informe a condição ou gatilho: sem ela não há como saber quando o argumentário vale. | `backend/src/modules/argument-scripts/domain/argument-script.ts` |
| `BUSINESS_DOMAIN_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Área responsável inativa. | `backend/src/modules/argument-scripts/application/argument-script-service.ts`<br>`backend/src/modules/business-domains/application/business-domain-lookup.ts` |

### Módulo `assistant`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ASSISTANT_CONVERSATION_CLOSED` | 409 | FAMILIA-CONFLITO | Esta conversa já foi encerrada. Abrimos a conversa atual para você continuar. | `backend/src/modules/assistant/application/assistant-conversations.ts` |
| `ASSISTANT_CONVERSATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Conversa não encontrada. | `backend/src/modules/assistant/application/assistant-conversations.ts`<br>`backend/src/modules/assistant/application/conversation-monitoring.ts` |
| `ASSISTANT_EMPTY` | 502 | FAMILIA-DEPENDENCIA | A INIA não retornou nenhum texto. | `backend/src/modules/assistant/infrastructure/gemini-function-calling-client.ts` |
| `ASSISTANT_FAILED` | 502 | FAMILIA-DEPENDENCIA | Não foi possível obter uma resposta da INIA. | `backend/src/modules/assistant/infrastructure/gemini-function-calling-client.ts` |
| `ASSISTANT_MESSAGE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Resposta não encontrada. | `backend/src/modules/assistant/application/assistant-interaction-ratings.ts`<br>`backend/src/modules/realtime/presentation/realtime-router.ts` |
| `ASSISTANT_NETWORK_ERROR` | 504 | FAMILIA-DEPENDENCIA | Não foi possível contatar a INIA. | `backend/src/modules/assistant/infrastructure/gemini-function-calling-client.ts` |
| `ASSISTANT_NOT_CONFIGURED` | 503 | FAMILIA-DEPENDENCIA | Orquestrador de chat não está configurado neste ambiente (falta GEMINI_API_KEY). | `backend/src/modules/assistant/infrastructure/gemini-function-calling-client.ts` |
| `ASSISTANT_TIMEOUT` | 422, 504 | FAMILIA-REGRA-DE-NEGOCIO | A INIA demorou demais para responder. | `backend/src/modules/assistant/infrastructure/gemini-function-calling-client.ts` |
| `FUNNEL_PERIOD_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe as datas no formato AAAA-MM-DD. | `backend/src/modules/assistant/application/reply-funnel.ts` |
| `ORCHESTRATOR_AGENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Um dos agentes selecionados não existe mais. | `backend/src/modules/assistant/application/orchestrator-versions.ts`<br>`backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_AGENT_NOT_PUBLISHED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O agente "${agent.name}" ainda não foi publicado. Publique-o antes de usá-lo num orquestrador. | `backend/src/modules/assistant/application/orchestrator-versions.ts` |
| `ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O agente "${agent.name}" não está disponível para o grupo deste orquestrador. | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_AGENT_WRONG_TYPE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O agente escolhido precisa ser do tipo "Orquestrador" — crie ou escolha um agente desse tipo em Agentes. | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Orquestrador não encontrado. | `backend/src/modules/assistant/presentation/assistant-router.ts`<br>`backend/src/modules/qa-lab/application/run-orchestrator-simulation.ts` |
| `ORCHESTRATOR_POLICY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_POLICY_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para criar um orquestrador nesse escopo. | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_SCOPE_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um orquestrador ativo atendendo o chat/voz nesse escopo — desative-o, ou restrinja um dos dois a \"Somente Workflow\", pra evitar que os dois disputem quem responde o operador. | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_SPECIALIST_FORBIDDEN_BY_POLICY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/assistant/presentation/assistant-router.ts` |
| `ORCHESTRATOR_VERSION_CONFLICT` | 409 | FAMILIA-CONFLITO | Outra pessoa gravou este orquestrador depois que você o abriu. Atualize para ver a versão atual; o que você alterou continua na tela. | `backend/src/modules/assistant/application/orchestrator-versions.ts` |
| `RATING_DETAILS_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O motivo da descurtida só vale nas conversas abertas por você com a INIA. | `backend/src/modules/assistant/application/assistant-interaction-ratings.ts` |
| `SPECIALIST_AGENT_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O agente "${row.name}" está inativo. | `backend/src/modules/assistant/application/run-specialist-tool.ts` |
| `SPECIALIST_AGENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Agente especialista não encontrado. | `backend/src/modules/assistant/application/run-specialist-tool.ts` |
| `SPECIALIST_UNEXPECTED_RESPONSE` | 502 | FAMILIA-DEPENDENCIA | Resposta inesperada do especialista. | `backend/src/modules/assistant/application/run-specialist-tool.ts` |
| `STRUCTURED_OUTPUT_IN_USE_DRAFT` | 409 | FAMILIA-CONFLITO | Esta alteração afeta ${impacts.length === 1 ? "um Workflow em rascunho" :  | `backend/src/modules/assistant/application/structured-output-dependencies.ts` |
| `STRUCTURED_OUTPUT_IN_USE_PUBLISHED` | 409 | FAMILIA-CONFLITO | Esta alteração quebraria ${published.length === 1 ? "um Workflow publicado" :  | `backend/src/modules/assistant/application/structured-output-dependencies.ts` |
| `STRUCTURED_OUTPUT_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/assistant/presentation/assistant-router.ts` |

### Módulo `reports`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AUDIENCE_OUT_OF_SCOPE` | 403 | FAMILIA-ACESSO | Público fora do seu escopo de distribuição. | `backend/src/modules/reports/application/report-service.ts` |
| `REPORT_DELIVERY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Entrega não encontrada. | `backend/src/modules/reports/application/report-deliveries-reader.ts`<br>`backend/src/modules/reports/application/report-service.ts` |
| `REPORT_DISTRIBUTION_NOT_ALLOWED` | 403 | FAMILIA-ACESSO | Só o papel Report escolhe outros destinatários. | `backend/src/modules/reports/application/report-service.ts` |
| `REPORT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Report não encontrado. | `backend/src/modules/reports/application/report-service.ts` |
| `REPORT_PROPOSAL_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Proposta não encontrada. | `backend/src/modules/reports/application/report-service.ts` |
| `REPORT_REVISION_CONFLICT` | 409 | FAMILIA-CONFLITO | O report foi alterado em outra tela. Recarregue e tente de novo. | `backend/src/modules/reports/application/report-service.ts` |
| `REPORT_SELF_NOT_ALLOWED` | 403 | FAMILIA-ACESSO | Para criar um report para você é preciso liderar uma estrutura (ou ter acesso de consulta). | `backend/src/modules/reports/application/report-service.ts` |
| `REPORTS_ACCESS_REQUIRED` | 403 | FAMILIA-ACESSO | Reports são para quem lidera uma estrutura ou tem o papel Report. | `backend/src/modules/reports/application/report-service.ts` |
| `STRUCTURE_OUT_OF_SCOPE` | 403 | FAMILIA-ACESSO | A estrutura escolhida não está no seu escopo. | `backend/src/modules/reports/application/report-service.ts` |

### Módulo `conversational-delivery`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `AVATAR_DELIVERY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Recado não encontrado. | `backend/src/modules/conversational-delivery/application/avatar-delivery-service.ts`<br>`backend/src/modules/conversational-delivery/application/recado-speech-audio.ts` |
| `SPEECH_NETWORK_ERROR` | 502 | FAMILIA-DEPENDENCIA | Não foi possível gerar a voz da INIA. | `backend/src/modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts` |
| `SPEECH_NOT_CONFIGURED` | 503 | FAMILIA-DEPENDENCIA | Voz da INIA não está configurada neste ambiente. | `backend/src/modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts`<br>`backend/src/modules/conversational-delivery/infrastructure/gemini-tts-client.ts`<br>`backend/src/modules/conversational-delivery/presentation/inia-deliveries-router.ts`<br>`backend/src/modules/feedback-application/presentation/feedback-applications-router.ts` |
| `SPEECH_PROVIDER_ERROR` | 502 | FAMILIA-DEPENDENCIA | A sessão de voz foi encerrada pelo provedor. | `backend/src/modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts`<br>`backend/src/modules/conversational-delivery/infrastructure/gemini-tts-client.ts` |
| `SPEECH_TIMEOUT` | 422, 502 | FAMILIA-REGRA-DE-NEGOCIO | A voz da INIA demorou demais. | `backend/src/modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts`<br>`backend/src/modules/conversational-delivery/infrastructure/gemini-tts-client.ts` |
| `SPEECH_UNEXPECTED_RESPONSE` | 502 | FAMILIA-DEPENDENCIA | A voz da INIA não veio. | `backend/src/modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts`<br>`backend/src/modules/conversational-delivery/infrastructure/gemini-tts-client.ts` |

### Módulo `main`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `BAD_REQUEST` | — | FAMILIA-DEPENDENCIA | Requisição inválida. | `backend/src/main/app.ts` |
| `DUPLICATE_RECORD` | 409 | FAMILIA-CONFLITO | Já existe um registro com esses dados. | `backend/src/main/app.ts` |
| `FILE_TOO_LARGE` | 413 | FAMILIA-LIMITE | Arquivo acima do tamanho permitido. | `backend/src/main/app.ts` |
| `INVALID_CHARACTER` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Valor com caractere inválido. | `backend/src/main/app.ts` |
| `INVALID_IDENTIFIER` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Identificador ou valor em formato inválido. | `backend/src/main/app.ts` |
| `INVALID_UPLOAD` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Envio de arquivo inválido. | `backend/src/main/app.ts` |
| `NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Recurso não encontrado. | `backend/src/main/app.ts`<br>`backend/src/main/worker-health.ts`<br>`backend/src/modules/indicator-diagnosis/presentation/diagnostic-strategy-router.ts` |
| `PAYLOAD_TOO_LARGE` | 413 | FAMILIA-LIMITE | Corpo da requisição grande demais. | `backend/src/main/app.ts` |

### Módulo `best-practices`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `BEST_PRACTICE_ANALYSIS_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | Já existe uma análise deste resultado e população na fila ou em andamento. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_ANALYSIS_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Análise não encontrada. | `backend/src/modules/best-practices/presentation/best-practices-router.ts` |
| `BEST_PRACTICE_ANSWER_KEY_MISSING` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este dataset não tem gabarito para o modelo simulado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_DATASET_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Dataset sintético não encontrado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_EDIT_EMPTY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Nada a editar. | `backend/src/modules/best-practices/application/pattern-service.ts` |
| `BEST_PRACTICE_EVIDENCE_INSUFFICIENT` | 409 | FAMILIA-CONFLITO | A análise mais recente não sustenta este padrão: não dá para aprová-lo. | `backend/src/modules/best-practices/domain/pattern.ts` |
| `BEST_PRACTICE_EVIDENCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Chamada não encontrada. | `backend/src/modules/best-practices/presentation/best-practices-router.ts` |
| `BEST_PRACTICE_HOW_IT_HELPS_PERSONAL_DATA` | 422 | FAMILIA-REGRA-DE-NEGOCIO | \"Como isso ajuda no resultado\" não pode ter dado pessoal nem número de identificação. | `backend/src/modules/best-practices/application/pattern-service.ts` |
| `BEST_PRACTICE_INDICATOR_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O indicador está desativado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_INDICATOR_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Indicador não encontrado. | `backend/src/modules/best-practices/application/analysis-service.ts`<br>`backend/src/modules/best-practices/presentation/best-practices-router.ts` |
| `BEST_PRACTICE_OBLIGATION_PENDING` | 409 | FAMILIA-CONFLITO | Antes de aprovar, confirme que o comportamento não é uma obrigação do processo. | `backend/src/modules/best-practices/domain/pattern.ts` |
| `BEST_PRACTICE_PATTERN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Padrão não encontrado. | `backend/src/modules/best-practices/application/pattern-service.ts` |
| `BEST_PRACTICE_PHRASING_PERSONAL_DATA` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A sugestão de fala não pode ter dado pessoal nem número de identificação. | `backend/src/modules/best-practices/application/pattern-service.ts` |
| `BEST_PRACTICE_REVIEW_CONFLICT` | 409 | FAMILIA-CONFLITO | O padrão mudou enquanto você revisava. Atualize e tente de novo. | `backend/src/modules/best-practices/application/pattern-service.ts` |
| `BEST_PRACTICE_REVIEW_INVALID_TRANSITION` | 409 | FAMILIA-CONFLITO | Esta ação não vale para o estado atual do padrão. | `backend/src/modules/best-practices/domain/pattern.ts` |
| `BEST_PRACTICE_REVIEW_REASON_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe o motivo desta decisão. | `backend/src/modules/best-practices/domain/pattern.ts` |
| `BEST_PRACTICE_SCOPE_DENIED` | 403 | FAMILIA-ACESSO | Você não administra este Subgrupo. | `backend/src/modules/best-practices/application/analysis-service.ts`<br>`backend/src/modules/best-practices/application/pattern-service.ts`<br>`backend/src/modules/best-practices/presentation/best-practices-router.ts` |
| `BEST_PRACTICE_SIGNAL_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O sinal está desativado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SIGNAL_NOT_CONFIGURED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Cadastre no sinal o que é chamada boa e ruim antes de analisar por ele. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SIGNAL_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Sinal da chamada não encontrado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SIMULATION_ONLY_SYNTHETIC` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O modelo simulado só existe para o dataset sintético. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SUBTEAM_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Subgrupo não encontrado neste Grupo. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SUBTEAM_ONLY_REAL` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O dataset sintético não tem Subgrupo. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_SYNTHETIC_DISABLED` | 403 | FAMILIA-ACESSO | Dados sintéticos não são analisados em produção. | `backend/src/modules/best-practices/application/analysis-service.ts`<br>`backend/src/modules/best-practices/application/synthetic-datasets.ts`<br>`backend/src/modules/best-practices/presentation/best-practices-router.ts` |
| `BEST_PRACTICE_TEAM_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Grupo não encontrado. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICE_TEAM_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha o Grupo (operação) da análise. | `backend/src/modules/best-practices/application/analysis-service.ts` |
| `BEST_PRACTICES_ACCESS_DENIED` | 403 | FAMILIA-ACESSO | Você não tem acesso à base de boas práticas. | `backend/src/modules/best-practices/presentation/best-practices-router.ts` |

### Módulo `ingestion`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `BOOLEAN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Flag "${flagName}" espera um valor ${flag.value_type === "BOOLEAN" ? "booleano" : "numérico"}. | `backend/src/modules/ingestion/presentation/ingestion-router.ts` |
| `INTERACTION_ENDS_IN_FUTURE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O fim da chamada está no futuro. Confira o relógio e o fuso horário do sistema de origem. | `backend/src/modules/ingestion/presentation/ingestion-router.ts` |
| `INVALID_PERIOD` | 400, 422 | FAMILIA-REGRA-DE-NEGOCIO | O fim da chamada deve ser posterior ao início. | `backend/src/modules/ingestion/presentation/ingestion-router.ts`<br>`backend/src/modules/performance-analytics/domain/reference-period.ts` |
| `UNKNOWN_CHANNEL_FLAG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Flag "${flagName}" não está cadastrada para o canal ${input.channel}. Cadastre-a no catálogo antes de enviar. | `backend/src/modules/ingestion/presentation/ingestion-router.ts` |

### Módulo `business-domains`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `BUSINESS_DOMAIN_CODE_LOCKED` | 409 | FAMILIA-CONFLITO | ${BUSINESS_DOMAIN_IN_USE_MESSAGE} Crie um novo domínio com o código desejado e migre as referências. | `backend/src/modules/business-domains/application/business-domain-service.ts` |
| `BUSINESS_DOMAIN_CODE_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um domínio de negócio com esse código. | `backend/src/modules/business-domains/application/business-domain-service.ts` |
| `BUSINESS_DOMAIN_IN_USE` | 409 | FAMILIA-CONFLITO | "${current.name}" ainda é utilizado por Agents ou Orchestrators e não pode ser excluído. Desative-o em vez de excluir. | `backend/src/modules/business-domains/application/business-domain-service.ts` |
| `BUSINESS_DOMAIN_NOT_FOUND` | 404, 422 | FAMILIA-NAO-ENCONTRADO | Área responsável não encontrada. | `backend/src/modules/argument-scripts/application/argument-script-service.ts`<br>`backend/src/modules/business-domains/application/business-domain-lookup.ts`<br>`backend/src/modules/business-domains/application/business-domain-service.ts`<br>`backend/src/modules/business-domains/presentation/business-domain-router.ts` |

### Módulo `call-expectations`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CALL_EXPECTATIONS_MOVED` | 410 | FAMILIA-NAO-ENCONTRADO | As Regras de chamada agora são Argumentários. Use Administração › Argumentários. | `backend/src/modules/call-expectations/presentation/call-expectation-router.ts` |

### Módulo `people`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CAPITAL_UNKNOWN` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Capital fora do catálogo das 27 capitais. | `backend/src/modules/people/presentation/operational-calendar-router.ts` |
| `EMPLOYMENT_STATUS_INVALID_RANGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Fim da situação anterior ao início. | `backend/src/modules/people/application/employment-status-service.ts` |
| `EMPLOYMENT_STATUS_OVERLAP` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A correção sobreporia períodos de situação da mesma pessoa. | `backend/src/modules/people/application/employment-status-service.ts` |
| `EMPLOYMENT_STATUS_UNKNOWN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Situação funcional não reconhecida: "${snapshot.rawStatus ?? ""}". | `backend/src/modules/people/application/employment-status-service.ts` |
| `HOLIDAY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feriado não encontrado. | `backend/src/modules/people/presentation/operational-calendar-router.ts` |
| `PENDING_ACTION_NOT_ACTIONABLE` | 409 | FAMILIA-CONFLITO | Este registro é informativo e não exige decisão. | `backend/src/modules/people/application/workday-reconciliation-service.ts` |
| `PERSON_ALREADY_LINKED` | 409 | FAMILIA-CONFLITO | Esta pessoa já foi vinculada a uma pessoa da base. | `backend/src/modules/people/application/person-source-link.ts` |
| `PERSON_LINK_SAME_PERSON` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha outra pessoa: não dá para vincular alguém a si mesmo. | `backend/src/modules/people/application/person-source-link.ts` |
| `PERSON_LINK_SOURCE_HAS_MATRICULA` | 409 | FAMILIA-CONFLITO | Esta pessoa já veio da base (tem matrícula) — o vínculo é feito a partir da pessoa cadastrada à mão. | `backend/src/modules/people/application/person-source-link.ts` |
| `PERSON_LINK_TARGET_HAS_ACCOUNT` | 409 | FAMILIA-CONFLITO | A pessoa da base já tem conta de login. Decida qual conta fica (desabilite a outra em Acessos) antes de vincular. | `backend/src/modules/people/application/person-source-link.ts` |
| `PERSON_LINK_TARGET_INACTIVE` | 409 | FAMILIA-CONFLITO | A pessoa da base está inativa: os papéis da conta não valeriam para ela. Confira a base antes de vincular. | `backend/src/modules/people/application/person-source-link.ts` |
| `PERSON_LINK_TARGET_NOT_FROM_SOURCE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha uma pessoa que veio da base (com matrícula). | `backend/src/modules/people/application/person-source-link.ts` |
| `SCHEDULE_EXCEPTION_CODE_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O motivo "${SCHEDULE_EXCEPTION_LABELS[input.code] ?? input.code}" não pode ser provisionado diretamente. | `backend/src/modules/people/application/schedule-exception-service.ts` |
| `SCHEDULE_EXCEPTION_INVALID_DATE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Datas devem estar no formato AAAA-MM-DD. | `backend/src/modules/people/application/schedule-exception-service.ts` |
| `SCHEDULE_EXCEPTION_INVALID_RANGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A data inicial não pode ser posterior à final. | `backend/src/modules/people/application/schedule-exception-service.ts` |
| `SCHEDULE_EXCEPTION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Exceção de calendário não encontrada. | `backend/src/modules/people/application/schedule-exception-service.ts`<br>`backend/src/modules/people/application/team-calendar.ts` |
| `SCHEDULE_EXCEPTION_RANGE_TOO_LONG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O período não pode ultrapassar ${MAX_PROVISION_SPAN_DAYS} dias. | `backend/src/modules/people/application/schedule-exception-service.ts` |
| `TEAM_CALENDAR_RANGE_TOO_LONG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O calendário mostra no máximo ${MAX_CALENDAR_RANGE_DAYS} dias por vez. | `backend/src/modules/people/application/team-calendar.ts` |
| `WORKDAY_CLASSIFICATION_REASON_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | "${WORKDAY_CLASSIFICATION_LABELS[classification]}" não aceita motivo. | `backend/src/modules/people/application/workday-classification-service.ts` |
| `WORKDAY_CLASSIFICATION_REASON_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Ausência justificada exige um motivo (atestado, day off, banco de horas, folga extraordinária ou outro). | `backend/src/modules/people/application/workday-classification-service.ts` |

### Módulo `feedbacks`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CASE_EVIDENCE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O caso não possui evidência verificável. | `backend/src/modules/feedbacks/application/publish-feedback.ts` |
| `FEEDBACK_ACK_FORBIDDEN` | 403 | FAMILIA-ACESSO | Só o próprio colaborador pode dar ciência neste feedback. | `backend/src/modules/feedbacks/application/acknowledge-feedback.ts` |
| `FEEDBACK_EVIDENCE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O feedback precisa conter indicador, evidência, comportamento, procedimento e recomendação. | `backend/src/modules/feedbacks/domain/feedback.ts` |
| `FEEDBACK_NOT_APPROVED` | 409 | FAMILIA-CONFLITO | Somente feedback aprovado pode ser publicado. | `backend/src/modules/feedbacks/application/publish-feedback.ts` |
| `FEEDBACK_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feedback não encontrado. | `backend/src/modules/feedbacks/application/acknowledge-feedback.ts`<br>`backend/src/modules/feedbacks/application/publish-feedback.ts`<br>`backend/src/modules/feedbacks/presentation/feedback-router.ts` |
| `FEEDBACK_NOT_PUBLISHED` | 409 | FAMILIA-CONFLITO | Só um feedback publicado pode receber ciência. | `backend/src/modules/feedbacks/application/acknowledge-feedback.ts` |
| `FOLLOW_UP_HIDE_EMPTY_SELECTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe ao menos um feedback. | `backend/src/modules/feedbacks/application/follow-up-visibility.ts` |
| `FOLLOW_UP_HIDE_FEEDBACK_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feedback não encontrado nesta organização: ${missing.join(", ")} | `backend/src/modules/feedbacks/application/follow-up-visibility.ts` |
| `FOLLOW_UP_HIDE_INVALID_REASON` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Motivo de ocultação inválido. | `backend/src/modules/feedbacks/application/follow-up-visibility.ts` |
| `FOLLOW_UP_HIDE_INVALID_SELECTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Rótulo da seleção inválido. | `backend/src/modules/feedbacks/application/follow-up-visibility.ts` |
| `FOLLOW_UP_HIDE_OPERATOR_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Feedback de outro colaborador: ${other.join(", ")} | `backend/src/modules/feedbacks/application/follow-up-visibility.ts` |

### Módulo `interventions`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CASE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Caso não encontrado. | `backend/src/modules/interventions/application/intervention-service.ts`<br>`backend/src/modules/supervision-cases/presentation/case-router.ts` |
| `CHECKPOINT_READING_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Registre a leitura do checkpoint (o que foi observado e o valor do indicador). | `backend/src/modules/interventions/application/intervention-service.ts` |
| `COMPETENCY_ACTIVITY_DUPLICATED` | — | FAMILIA-DEPENDENCIA | A chave de atividade ${activity.key} está repetida. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_CRITERION_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | O critério ${key} não existe nesta organização. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_DOCUMENT_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Um dos documentos escolhidos não existe mais na base de conhecimento. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_INDICATOR_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | O indicador ${code} não existe nesta organização. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_KEY_LOCKED` | 409 | FAMILIA-CONFLITO | A chave da competência não muda depois de criada. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_KEY_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe uma competência com a chave ${input.key}. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Competência não encontrada ou inativa. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `COMPETENCY_PRACTICE_INVALID` | — | FAMILIA-DEPENDENCIA | Chave de prática inválida. | `backend/src/modules/interventions/application/config-service.ts` |
| `COMPETENCY_PRACTICE_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | A prática ${key} não existe nesta organização. | `backend/src/modules/interventions/application/config-service.ts` |
| `CONTINUITY_JUSTIFICATION_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A justificativa da decisão precisa de pelo menos ${CONTINUITY_JUSTIFICATION_MIN} caracteres. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `CONTINUITY_REVIEW_APPROVAL_REQUIRED` | — | FAMILIA-DEPENDENCIA | A avaliação de continuidade sempre exige decisão humana; não é possível desligar. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `CONTINUITY_REVIEW_EVIDENCE_CONDITION` | — | FAMILIA-DEPENDENCIA | A avaliação de continuidade exige uma condição com evidência verificável (indicador, diagnóstico sustentado ou feedback publicado). | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `CONTINUITY_REVIEW_EVIDENCE_REQUIRED` | — | FAMILIA-DEPENDENCIA | A avaliação de continuidade exige pelo menos uma evidência verificável. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `CONTINUITY_REVIEW_EXCLUSIVE` | — | FAMILIA-DEPENDENCIA | A avaliação de continuidade é um processo próprio: não se combina com outras capacidades. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `CONTINUITY_REVIEW_JUSTIFICATION` | — | FAMILIA-DEPENDENCIA | A regra que abre avaliação de continuidade precisa de uma justificativa com pelo menos 30 caracteres. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `CONTINUITY_REVIEW_NO_AI` | — | FAMILIA-DEPENDENCIA | A IA nunca rascunha nem decide uma avaliação de continuidade. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `CONTINUITY_REVIEW_NOT_ON_INCONCLUSIVE` | — | FAMILIA-DEPENDENCIA | A avaliação de continuidade nunca é aberta com dados insuficientes. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `INTERVENTION_AI_DRAFT_NOT_READY` | 409 | FAMILIA-CONFLITO | Não há rascunho pronto para aplicar. | `backend/src/modules/interventions/application/ai-draft.ts` |
| `INTERVENTION_AI_DRAFT_UNAVAILABLE` | 409 | FAMILIA-CONFLITO | Rascunho pela IA não está disponível para esta intervenção agora. | `backend/src/modules/interventions/application/ai-draft.ts` |
| `INTERVENTION_AI_DRAFT_UNSUPPORTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Rascunho pela IA só existe para treinamento ou plano de ação. | `backend/src/modules/interventions/application/ai-draft.ts` |
| `INTERVENTION_ALREADY_ACTIVE` | 409 | FAMILIA-CONFLITO | ${person.name} já tem "${type.definition.name}" em andamento para este assunto. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_ASSIGNMENT_UNRESOLVED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interventions/application/apply-evaluation.ts`<br>`backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_CASE_TEAM_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | ${evaluation.person.name} não está em nenhum Grupo: o caso de supervisão precisa de um. | `backend/src/modules/interventions/application/apply-evaluation.ts`<br>`backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_CONCURRENT_CHANGE` | 409 | FAMILIA-CONFLITO | A intervenção mudou desde que você abriu. Atualize e tente de novo. | `backend/src/modules/interventions/application/ai-draft.ts`<br>`backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_EVALUATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Avaliação não encontrada. | `backend/src/modules/interventions/presentation/intervention-admin-router.ts` |
| `INTERVENTION_EVIDENCE_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Referência não encontrada para este colaborador. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_EVIDENCE_REQUIRED` | — | FAMILIA-DEPENDENCIA | Este tipo exige pelo menos ${definition.evidence.minimumItems} evidência(s) verificável(is); há ${evidenceCount}. | `backend/src/modules/interventions/domain/intervention-plan.ts` |
| `INTERVENTION_FORM_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_FORM_REQUIRED` | — | FAMILIA-DEPENDENCIA | Preencha "${field.label}". | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_FORM_UNKNOWN_FIELD` | — | FAMILIA-DEPENDENCIA | O campo ${key} não existe neste tipo. | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_FORWARD_TARGET_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha para quem encaminhar. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_ITEM_KIND_UNSUPPORTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este tipo de intervenção não usa esse tipo de item. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_ITEM_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Item não encontrado. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_ITEM_OWNER_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O responsável da tarefa precisa ser o colaborador ou alguém da cadeia de gestão dele. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_ITEM_SKIP_REASON` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Diga por que o item foi dispensado. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_LEARNING_REQUIRED` | — | FAMILIA-DEPENDENCIA | Registre a avaliação de aprendizagem. | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_NO_APPROVER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOT_COMPLETABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Intervenção não encontrada. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOT_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | Itens são concluídos durante a execução. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOT_READY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOT_TRAINING` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Só intervenções com treinamento usam competências. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_NOTE_REQUIRED` | — | FAMILIA-DEPENDENCIA | Registre o resultado da intervenção. | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_OPERATIONAL_READING` | — | FAMILIA-DEPENDENCIA | Descreva a leitura do indicador que sustenta o resultado operacional (período, valor antes e depois). | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_OPERATIONAL_REQUIRED` | — | FAMILIA-DEPENDENCIA | Registre a leitura da evolução operacional (o indicador depois da intervenção). | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_PLAN_LOCKED` | 409 | FAMILIA-CONFLITO | O plano não pode ser alterado agora. | `backend/src/modules/interventions/application/ai-draft.ts`<br>`backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_POLICY_CONCURRENT_CHANGE` | 409 | FAMILIA-CONFLITO | O rascunho mudou durante a publicação. Abra de novo e tente outra vez. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_DRAFT_NOT_FOUND` | 409 | FAMILIA-CONFLITO | Não há rascunho para publicar. | `backend/src/modules/interventions/application/config-service.ts`<br>`backend/src/modules/interventions/presentation/intervention-admin-router.ts` |
| `INTERVENTION_POLICY_DRAFT_ONLY` | 409 | FAMILIA-CONFLITO | Uma política sem versão publicada não tem para onde voltar: edite o rascunho ou inative a política. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_EFFECTIVE_FROM_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Data de vigência inválida. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_EFFECTIVE_FROM_PAST` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A vigência não pode começar no passado. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O rascunho tem campos inválidos: salve-o de novo antes de simular. | `backend/src/modules/interventions/application/config-service.ts`<br>`backend/src/modules/interventions/presentation/intervention-admin-router.ts` |
| `INTERVENTION_POLICY_KEY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Chave inválida: use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra). | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_KEY_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe uma política com a chave ${key}. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_NAME_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Dê um nome à política (até 120 caracteres). | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Política não encontrada. | `backend/src/modules/interventions/presentation/intervention-admin-router.ts` |
| `INTERVENTION_POLICY_SCOPE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Grupo não encontrado. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_SCOPE_LOCKED` | 409 | FAMILIA-CONFLITO | O escopo não muda depois da primeira publicação: crie outra política para outro escopo. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_POLICY_VERSION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Versão não encontrada. | `backend/src/modules/interventions/presentation/intervention-admin-router.ts` |
| `INTERVENTION_REASON_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Diga o que precisa mudar (pelo menos 5 caracteres). | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_REPORT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Relatório não encontrado. | `backend/src/modules/interventions/application/report-narrative.ts`<br>`backend/src/modules/interventions/presentation/intervention-router.ts` |
| `INTERVENTION_TASKS_PENDING` | — | FAMILIA-DEPENDENCIA | Ainda há ${counts.tasksTotal - counts.tasksDone - counts.tasksSkipped} tarefa(s) pendente(s). | `backend/src/modules/interventions/domain/intervention-state.ts` |
| `INTERVENTION_TYPE_CONCURRENT_CHANGE` | 409 | FAMILIA-CONFLITO | O rascunho mudou durante a publicação. Abra de novo e tente outra vez. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_DRAFT_NOT_FOUND` | 409 | FAMILIA-CONFLITO | Não há rascunho para publicar. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_DRAFT_ONLY` | 409 | FAMILIA-CONFLITO | Um tipo sem versão publicada não tem para onde voltar: edite o rascunho ou inative o tipo. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_INVALID` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_KEY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Chave inválida: use letras maiúsculas, números e _ (2 a 40 caracteres, começando por letra). | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_KEY_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um tipo de intervenção com a chave ${key}. | `backend/src/modules/interventions/application/config-service.ts` |
| `INTERVENTION_TYPE_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Tipo de intervenção não encontrado ou inativo. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `INTERVENTION_TYPE_VERSION_MISSING` | 500 | FAMILIA-DEPENDENCIA | A versão do tipo desta intervenção não foi encontrada. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `PERSON_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pessoa não encontrada. | `backend/src/modules/data-lifecycle/application/subject-data-export.ts`<br>`backend/src/modules/interventions/application/intervention-service.ts`<br>`backend/src/modules/interventions/presentation/intervention-admin-router.ts`<br>`backend/src/modules/people/application/schedule-exception-service.ts`<br>`backend/src/modules/people/application/workday-classification-service.ts`<br>`backend/src/modules/performance-analytics/application/viewer-scope.ts` |
| `POLICY_ACTION_DUPLICATED` | — | FAMILIA-DEPENDENCIA | O tipo ${action.typeKey} aparece duas vezes na mesma regra. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_ACTION_TYPE_INACTIVE` | — | FAMILIA-DEPENDENCIA | O tipo ${action.typeKey} está inativo. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_ACTION_TYPE_UNPUBLISHED` | — | FAMILIA-DEPENDENCIA | O tipo ${action.typeKey} não existe ou ainda não tem versão publicada. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_COMPETENCY_UNKNOWN` | — | FAMILIA-DEPENDENCIA | Não existe competência com a chave ${key}. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_CONDITION_TYPE_UNKNOWN` | — | FAMILIA-DEPENDENCIA | Não existe tipo de intervenção com a chave ${key}. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_EMPLOYMENT_PERIOD` | — | FAMILIA-DEPENDENCIA | Dias elegíveis usam uma janela de dias ou de calendário. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_FLAG_INACTIVE` | — | FAMILIA-DEPENDENCIA | A flag ${condition.flagName} está desativada no catálogo. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_FLAG_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | A flag ${condition.flagName} (${condition.channel}) não existe no catálogo de flags. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_FLAG_PERCENT` | — | FAMILIA-DEPENDENCIA | Percentual de atendimentos vai de 0 a 100. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_FLAG_VALUE_TYPE` | — | FAMILIA-DEPENDENCIA | A flag ${condition.flagName} é ${flag.valueType === "BOOLEAN" ? "sim/não" : "numérica"}: ajuste o valor procurado. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_GROUP_TOO_DEEP` | — | FAMILIA-DEPENDENCIA | Use no máximo ${MAX_GROUP_DEPTH} níveis de grupos. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INCONCLUSIVE_ACTION_CLASSIFIES` | — | FAMILIA-DEPENDENCIA | Dados insuficientes nunca viram classificação: com regra inconclusiva só cabem tipos de observação, revisão de dados ou revisão pela liderança (${type.definition.name} não é). | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_COMPARATOR` | — | FAMILIA-DEPENDENCIA | Use um comparador numérico. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_COUNT_COMPARE` | — | FAMILIA-DEPENDENCIA | Recorrência compara uma contagem com um número, não com meta ou período anterior. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_COUNT_FILTER` | — | FAMILIA-DEPENDENCIA | Recorrência: defina qual medição conta (comparação e valor). | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_INACTIVE` | — | FAMILIA-DEPENDENCIA | O indicador ${code} está desativado. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | O indicador ${code} não existe nesta organização. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_PERIOD_REQUIRED` | — | FAMILIA-DEPENDENCIA | Defina a janela de análise. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_QUERY_REQUIRED` | — | FAMILIA-DEPENDENCIA | Escolha UMA consulta: histórico do indicador ou resultado oficial. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_REQUIRED` | — | FAMILIA-DEPENDENCIA | Escolha o indicador da condição. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_INDICATOR_THRESHOLD` | — | FAMILIA-DEPENDENCIA | Recorrência: defina quantas ocorrências. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_OPERATIONAL_QUARTILE_UNSUPPORTED` | — | FAMILIA-DEPENDENCIA | Quartil operacional não está disponível em políticas: use o quartil oficial do fechamento. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_PERFORMANCE_QUARTILE` | — | FAMILIA-DEPENDENCIA | Quartil oficial compara com Q1 a Q4 (Q1 = melhor, Q4 = pior), usando igual ou diferente. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_PERFORMANCE_RECURRENCE` | — | FAMILIA-DEPENDENCIA | Recorrência de fechamentos só existe para quartil oficial. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_PRIOR_RESULT_NEEDS_COMPLETED` | — | FAMILIA-DEPENDENCIA | Resultado operacional só existe em intervenções concluídas. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_RULE_ACTIONS_INCOMPATIBLE` | — | FAMILIA-DEPENDENCIA | ${a.typeKey} e ${b.typeKey} são incompatíveis e não podem estar na mesma regra. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_RULE_KEY_DUPLICATED` | — | FAMILIA-DEPENDENCIA | A chave de regra ${rule.key} está repetida. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_RULE_PRIORITY_DUPLICATED` | — | FAMILIA-DEPENDENCIA | A prioridade ${rule.priority} já é da regra ${other}: cada regra precisa de uma prioridade própria (sem empate). | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_RULE_WITHOUT_ACTIONS` | — | FAMILIA-DEPENDENCIA | A regra ${rule.name} precisa de pelo menos uma ação. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_SKILL_GAP_NEEDS_DIAGNOSIS` | — | FAMILIA-DEPENDENCIA | ${type.definition.name} afirma uma lacuna de habilidade: a regra precisa exigir um diagnóstico sustentado (indicador abaixo da meta, sozinho, não basta). | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_TOO_MANY_CONDITIONS` | — | FAMILIA-DEPENDENCIA | Use no máximo ${MAX_CONDITIONS_PER_RULE} condições por regra. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `POLICY_WITHOUT_RULES` | — | FAMILIA-DEPENDENCIA | A política precisa de pelo menos uma regra. | `backend/src/modules/interventions/domain/policy-definition.ts` |
| `TRAINING_CONTENT_NOT_APPROVED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Treinamento só usa conteúdos publicados da base de conhecimento. | `backend/src/modules/interventions/application/intervention-service.ts` |
| `TYPE_AI_DRAFT_UNSUPPORTED` | — | FAMILIA-DEPENDENCIA | Rascunho pela IA só existe para Treinamento ou Plano de ação. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_CAPABILITIES_INCOMPATIBLE` | — | FAMILIA-DEPENDENCIA | Treinamento (lacuna de habilidade) e Reconhecimento não convivem no mesmo tipo. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_COMPLETION_NEEDS_TASKS` | — | FAMILIA-DEPENDENCIA | Exigir todas as tarefas concluídas só faz sentido com a capacidade Tarefas. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_COMPLETION_NEEDS_TRAINING` | — | FAMILIA-DEPENDENCIA | Avaliação de aprendizagem só existe com a capacidade Treinamento. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_FORM_FIELD_DUPLICATED` | — | FAMILIA-DEPENDENCIA | O campo "${field.key}" aparece mais de uma vez no formulário. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_FORM_OPTIONS_UNEXPECTED` | — | FAMILIA-DEPENDENCIA | Só campos do tipo lista têm opções ("${field.label}"). | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_FORM_SELECT_OPTIONS` | — | FAMILIA-DEPENDENCIA | O campo "${field.label}" é uma lista e precisa de pelo menos duas opções. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_INCOMPATIBLE_DUPLICATED` | — | FAMILIA-DEPENDENCIA | A chave ${key} está repetida. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_INCOMPATIBLE_SELF` | — | FAMILIA-DEPENDENCIA | Um tipo não pode ser incompatível consigo mesmo. | `backend/src/modules/interventions/domain/intervention-type.ts` |
| `TYPE_INCOMPATIBLE_UNKNOWN` | — | FAMILIA-DEPENDENCIA | Não existe tipo de intervenção com a chave ${key}. | `backend/src/modules/interventions/domain/intervention-type.ts` |

### Módulo `channel-flags`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CHANNEL_FLAG_IN_USE` | 409 | FAMILIA-CONFLITO | Esta flag é usada por ${users.slice(0, 3).join(", ")}${users.length > 3 ?  | `backend/src/modules/channel-flags/presentation/channel-flag-router.ts` |
| `CHANNEL_FLAG_INDICATOR_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Indicador relacionado não encontrado. | `backend/src/modules/channel-flags/presentation/channel-flag-router.ts` |
| `CHANNEL_FLAG_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Flag não encontrada. | `backend/src/modules/channel-flags/presentation/channel-flag-router.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/definition-routes.ts` |
| `CHANNEL_FLAG_TAKEN` | 409 | FAMILIA-CONFLITO | Esse canal já tem uma flag com esse nome. | `backend/src/modules/channel-flags/presentation/channel-flag-router.ts` |
| `NUMERIC` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/channel-flags/presentation/channel-flag-router.ts` |

### Módulo `checkpoint-registry`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CHECKPOINT_LINK_NOT_CANDIDATE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Essa regra não está entre as correspondências possíveis. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_NOT_AMBIGUOUS` | 409 | FAMILIA-CONFLITO | Só um checkpoint ambíguo em revisão pode ser vinculado. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Checkpoint não encontrado. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-queries.ts`<br>`backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_NOT_REMOVED` | 409 | FAMILIA-CONFLITO | Só um checkpoint removido da base pode ter a remoção confirmada. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_NOT_REVIEWABLE` | 409 | FAMILIA-CONFLITO | Só um checkpoint proposto ou em revisão pode ser aprovado. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_OFFICIAL_RULE_READ_ONLY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A regra oficial vem da Base de Conhecimento e não pode ser editada aqui. Só a configuração operacional é alterável. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_REJECTION_REASON_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe o motivo da rejeição. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |
| `CHECKPOINT_SCOPE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escopo incompleto. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts` |

### Módulo `feedback-application`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `COMPLETED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_APPLICATION_COMPLETED` | 409 | FAMILIA-CONFLITO | Esta conversa já foi concluída: a apresentação não é reproduzida em modo consulta. | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_APPLICATION_CONVERSATION_MISMATCH` | 409 | FAMILIA-CONFLITO | Esta conversa não pertence a este feedback. Abra o feedback de novo para continuar. | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_APPLICATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Aplicação de feedback não encontrada. | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_APPLICATION_NOT_STARTED` | 409 | FAMILIA-CONFLITO | Esta aplicação ainda não começou. | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_APPLICATION_SOURCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feedback não encontrado. | `backend/src/modules/feedback-application/application/feedback-application-service.ts` |
| `FEEDBACK_READ_CONFIRMATION_SOURCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feedback não encontrado. | `backend/src/modules/feedback-application/application/read-confirmation-service.ts` |
| `READ_CONFIRMATION_INVALID_CREDENTIALS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Login ou senha não conferem com a sua conta. | `backend/src/modules/feedback-application/application/read-confirmation-service.ts` |
| `READ_CONFIRMATION_TOO_MANY_ATTEMPTS` | 429 | FAMILIA-LIMITE | Muitas tentativas com login ou senha incorretos. Aguarde alguns minutos e tente de novo. | `backend/src/modules/feedback-application/application/read-confirmation-service.ts` |

### Módulo `knowledge-clarification`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `CONTRACT` | — | FAMILIA-DEPENDENCIA | Fora do contrato: ${parsed.error.issues.slice(0, 4).map((issue) =>  | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `INVALID_JSON` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Corpo da requisição não é um JSON válido. | `backend/src/main/app.ts`<br>`backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `KNOWLEDGE_CLARIFICATION_ANSWER_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/knowledge-clarification/domain/clarification-state.ts` |
| `KNOWLEDGE_CLARIFICATION_STALE` | 409 | FAMILIA-CONFLITO | Este esclarecimento foi substituído por uma pergunta mais recente. Faça a pergunta de novo. | `backend/src/modules/knowledge-clarification/application/knowledge-clarification-service.ts` |
| `LABEL_TOO_LONG` | — | FAMILIA-DEPENDENCIA | Rótulo longo demais (máx. 80): "${clip(label, 60)}" — use a descrição para o detalhe. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `MISSING_EVIDENCE` | — | FAMILIA-DEPENDENCIA | ANSWER exige \"answerEvidence\" com os marcadores K-n das SEÇÕES que sustentam a resposta (base inteira, B-n, não vale: abra a base e cite as seções). | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `MISSING_FIELD` | — | FAMILIA-DEPENDENCIA | CLARIFY exige o objeto \"clarification\". | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `NOT_APPLICABLE_FORBIDDEN` | — | FAMILIA-DEPENDENCIA | A escolha veio do formulário desta etapa: decida CLARIFY, ANSWER ou INSUFFICIENT. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `NOT_ENOUGH_OPTIONS` | — | FAMILIA-DEPENDENCIA | Uma etapa precisa de ao menos ${MIN_CLARIFICATION_OPTIONS} opções distintas, cada uma citando os marcadores K-n que a sustentam.${rejected ?  | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `PENDING_REPLY_INVALID` | — | FAMILIA-DEPENDENCIA | A etapa aberta aceita uma opção só; a mensagem foi interpretada como várias. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `READ_EMPTY` | — | FAMILIA-DEPENDENCIA | READ precisa de bases ainda não abertas (B-n) ou seções ainda não lidas (K-n) que aparecem acima; se já tem o suficiente, decida. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `READ_LIMIT` | — | FAMILIA-DEPENDENCIA | Não há mais consultas para esta pergunta: decida CLARIFY, ANSWER ou INSUFFICIENT com o que já foi mostrado. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `REPEATED_DIMENSION` | — | FAMILIA-DEPENDENCIA | A dimensão "${dimension}" já foi definida: não pergunte de novo — pergunte outra distinção que mude a resposta, ou responda. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `REPEATED_OPTIONS` | — | FAMILIA-DEPENDENCIA | Estas opções repetem as de uma etapa anterior: não pergunte de novo. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `STEP_LIMIT` | — | FAMILIA-DEPENDENCIA | O limite de etapas de esclarecimento chegou: decida ANSWER (se as fontes já sustentam a resposta) ou INSUFFICIENT (explicando o que falta). | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |
| `TOO_MANY_OPTIONS` | — | FAMILIA-DEPENDENCIA | ${options.length} opções é demais para uma etapa (máx. ${MAX_CLARIFICATION_OPTIONS}): pergunte primeiro uma distinção mais ampla que separe os cenários em grupos. | `backend/src/modules/knowledge-clarification/domain/clarification-contract.ts` |

### Módulo `data-hub`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `DATA_CADENCE_TOO_FREQUENT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_COMPONENT_MISSING` | — | FAMILIA-DEPENDENCIA | Componente exigido pela estratégia do indicador ausente. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_CONTRACT_UNKNOWN` | 404 | FAMILIA-NAO-ENCONTRADO | Contrato de dados desconhecido. | `backend/src/modules/data-hub/domain/error-codes.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_CONTRACT_VIOLATION` | — | FAMILIA-DEPENDENCIA | O registro viola uma regra do contrato. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_DUPLICATE` | — | FAMILIA-DEPENDENCIA | Registro duplicado dentro da mesma carga. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_EMPLOYEE_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Colaborador não encontrado. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_EMPLOYMENT_STATUS_CONFLICT` | — | FAMILIA-DEPENDENCIA | Conflito de situação funcional resolvido pela precedência de evidência (registro aplicado; veja a mensagem). | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_EMPLOYMENT_STATUS_UNKNOWN` | — | FAMILIA-DEPENDENCIA | Situação funcional não reconhecida — a INIA nunca converte desconhecido em 'em produção'; mapeie o valor da fonte com 'Mapear códigos'. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_FEED_AUTHORITATIVE_CONFLICT` | 409 | FAMILIA-CONFLITO | Já existe um feed autoritativo ativo para ${input.contractKey} nesta organização. Desmarque o outro antes — duas fontes não podem ser master do mesmo cadastro. | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_FEED_CONNECTOR_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O conector do feed (${input.connectorConfig.connector}) precisa ser o mesmo tipo da fonte (${source.kind}). | `backend/src/modules/data-hub/application/feed-service.ts`<br>`backend/src/modules/data-hub/application/source-service.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_FEED_CONTRACT_LOCKED` | 409 | FAMILIA-CONFLITO | O contrato de um feed que já teve cargas não pode mudar — crie outro feed. | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_FEED_INACTIVE` | 409, 422 | FAMILIA-CONFLITO | O feed não está ativo — ative-o na Central de Dados. | `backend/src/modules/data-hub/application/push-ingestion.ts`<br>`backend/src/modules/data-hub/application/run-service.ts`<br>`backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_FEED_INVALID_TRANSITION` | 409 | FAMILIA-CONFLITO | Um rascunho não pode ser pausado — ative-o primeiro. | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_FEED_KEY_CONFLICT` | 409 | FAMILIA-CONFLITO | Já existe um feed com a chave "${input.feedKey}" nesta fonte. | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_FEED_NOT_FOUND` | 404, 422 | FAMILIA-NAO-ENCONTRADO | Feed não encontrado. | `backend/src/modules/data-hub/application/records.ts`<br>`backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_FILE_ALREADY_PROCESSED` | — | FAMILIA-DEPENDENCIA | Este arquivo já foi processado anteriormente. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_FILE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O arquivo não pôde ser lido. | `backend/src/modules/data-hub/domain/error-codes.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_FILE_READER_BUSY` | — | FAMILIA-DEPENDENCIA | Há muitas planilhas sendo lidas neste momento — a leitura é tentada de novo. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_FLAG_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Flag de canal não cadastrada. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_GROUP_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Grupo não encontrado. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INDICATOR_CAPABILITY` | — | FAMILIA-DEPENDENCIA | O indicador não suporta esta granularidade/capacidade. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INDICATOR_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Indicador não encontrado ou inativo. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INTERACTION_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Interação não encontrada. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INTERNAL_ERROR` | — | FAMILIA-DEPENDENCIA | Erro interno ao processar a carga. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INVALID_DATE` | — | FAMILIA-DEPENDENCIA | Data inválida. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INVALID_ENUM` | — | FAMILIA-DEPENDENCIA | Valor fora das opções permitidas. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_INVALID_NUMBER` | — | FAMILIA-DEPENDENCIA | Número inválido. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_MAPPING_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O mapeamento está incompleto: ${problems.join(" ")} | `backend/src/modules/data-hub/application/feed-service.ts`<br>`backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_NO_VALID_RECORDS` | — | FAMILIA-DEPENDENCIA | Nenhum registro da carga é válido. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_PERSON_LINK_ACCESS_DISABLED` | — | FAMILIA-DEPENDENCIA | Pessoa ligada pelo e-mail foi para outro Grupo ou nível de liderança: o acesso foi desabilitado até quem administra o lugar novo liberar de novo (registro aplicado; veja a mensagem). | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_PERSON_LINKED_BY_EMAIL` | — | FAMILIA-DEPENDENCIA | Matrícula ligada pela conta de login (mesmo e-mail) a uma pessoa já cadastrada na INIA sem matrícula (registro aplicado; veja a mensagem). | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_POSSIBLE_DUPLICATE_PERSON` | — | FAMILIA-DEPENDENCIA | Possível pessoa duplicada: mesmo nome de uma pessoa cadastrada na INIA sem matrícula (registro aplicado; a INIA não junta por nome). | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_PUSH_EMPTY_BODY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Envie um corpo JSON com os registros (ex.: { \"records\": [...] }). | `backend/src/modules/data-hub/presentation/data-ingestion-router.ts` |
| `DATA_PUSH_IDEMPOTENCY_CONFLICT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para um lote diferente. | `backend/src/modules/data-hub/application/push-ingestion.ts`<br>`backend/src/modules/data-hub/application/run-service.ts` |
| `DATA_PUSH_RATE_LIMITED` | 429 | FAMILIA-LIMITE | Limite de requisições excedido. Tente novamente em instantes. | `backend/src/modules/data-hub/presentation/data-ingestion-router.ts` |
| `DATA_PUSH_TOKEN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Token não encontrado ou já revogado. | `backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_PUSH_UNAUTHORIZED` | 401 | FAMILIA-ACESSO | Credencial inválida. | `backend/src/modules/data-hub/application/push-ingestion.ts`<br>`backend/src/modules/data-hub/presentation/data-ingestion-router.ts` |
| `DATA_RAW_EXPIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O arquivo enviado expirou — envie novamente. | `backend/src/modules/data-hub/application/feed-service.ts`<br>`backend/src/modules/data-hub/application/run-service.ts`<br>`backend/src/modules/data-hub/domain/error-codes.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_REFERENCE_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Referência não encontrada na INIA. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_REQUIRED_FIELD_MISSING` | — | FAMILIA-DEPENDENCIA | Campo obrigatório ausente. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_RUN_ALREADY_QUEUED` | 409 | FAMILIA-CONFLITO | Já existe uma carga em andamento ou na fila para este feed. | `backend/src/modules/data-hub/application/run-service.ts` |
| `DATA_RUN_ATOMIC_REJECTED` | — | FAMILIA-DEPENDENCIA | Contrato atômico: nenhum registro foi aplicado porque houve rejeições. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_RUN_NOT_CANCELLABLE` | 409 | FAMILIA-CONFLITO | Só cargas ainda na fila podem ser canceladas. | `backend/src/modules/data-hub/application/run-service.ts` |
| `DATA_RUN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Carga não encontrada. | `backend/src/modules/data-hub/application/records.ts` |
| `DATA_SAMPLE_REQUIRES_UPLOAD` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Envie um arquivo (ou payload de exemplo) para obter a amostra desta fonte. | `backend/src/modules/data-hub/application/feed-service.ts` |
| `DATA_SCHEDULE_EXCEPTION_CONFLICT` | — | FAMILIA-DEPENDENCIA | Conflito entre a exceção de calendário da Central e a registrada pelo Supervisor (mantido o registro do Supervisor; veja a mensagem). | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SCHEMA_CHANGED` | — | FAMILIA-DEPENDENCIA | A estrutura dos dados de origem mudou e um campo obrigatório deixou de existir. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_AUTH_FAILED` | — | FAMILIA-DEPENDENCIA | Falha de autenticação na fonte. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_CONFIG_LOCKED` | 403 | FAMILIA-ACESSO | Para configurar esta fonte, informe a senha dela de novo. | `backend/src/modules/data-hub/application/config-unlock-service.ts`<br>`backend/src/modules/data-hub/presentation/config-access-guard.ts` |
| `DATA_SOURCE_CREDENTIAL_UNPROVEN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta API responde igual com e sem credencial, então não dá para provar a nova. Libere a configuração com a credencial atual e troque em seguida. | `backend/src/modules/data-hub/application/config-unlock-service.ts` |
| `DATA_SOURCE_DESTINATION_CHANGED` | 409 | FAMILIA-CONFLITO | Outra pessoa mudou o destino desta fonte enquanto a alteração era conferida. Abra a fonte de novo, confira o destino atual e informe a credencial outra vez. | `backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_SOURCE_DESTINATION_DENIED` | — | FAMILIA-DEPENDENCIA | O endereço da fonte não é permitido pela política de destinos do servidor da INIA. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_INACTIVE` | 409 | FAMILIA-CONFLITO | A fonte está pausada ou em rascunho — ative-a na Central de Dados. | `backend/src/modules/data-hub/application/push-ingestion.ts` |
| `DATA_SOURCE_INVALID_TRANSITION` | 409 | FAMILIA-CONFLITO | Só uma fonte ativa pode ser pausada. | `backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_SOURCE_KIND_IMMUTABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O tipo da conexão não pode ser alterado depois de criada — crie outra fonte. | `backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_SOURCE_MASKED_VALUE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A Base URL agora aponta para outro servidor, e ${hidden.length === 1 ?  | `backend/src/modules/data-hub/application/source-service.ts`<br>`backend/src/modules/data-hub/domain/config-mask.ts` |
| `DATA_SOURCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Fonte não encontrada. | `backend/src/modules/data-hub/application/records.ts`<br>`backend/src/modules/data-hub/domain/error-codes.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_SOURCE_NOT_PUSH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Tokens de push só existem para fontes API Push. | `backend/src/modules/data-hub/application/source-service.ts`<br>`backend/src/modules/data-hub/presentation/data-hub-router.ts` |
| `DATA_SOURCE_NOT_SYNCABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Só fontes que a INIA consulta (API Pull, SFTP e banco de dados) podem ser sincronizadas pela INIA; arquivos e push chegam do cliente. | `backend/src/modules/data-hub/application/run-service.ts` |
| `DATA_SOURCE_PERMISSION_DENIED` | — | FAMILIA-DEPENDENCIA | O usuário da fonte não tem permissão para ler estes dados. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_RESPONSE_INVALID` | — | FAMILIA-DEPENDENCIA | A fonte respondeu com um formato inesperado. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_SECRET_INCORRECT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/data-hub/application/config-unlock-service.ts` |
| `DATA_SOURCE_SECRET_REENTRY_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O servidor, o banco, o usuário ou a forma de autenticação mudou: informe a credencial de novo (a guardada vale só para o destino original). | `backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_SOURCE_SECRET_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta conexão não usa credencial. | `backend/src/modules/data-hub/application/config-unlock-service.ts`<br>`backend/src/modules/data-hub/application/source-service.ts` |
| `DATA_SOURCE_TIMEOUT` | — | FAMILIA-DEPENDENCIA | A fonte demorou demais para responder. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_TLS_FAILED` | — | FAMILIA-DEPENDENCIA | Falha na conexão segura (TLS/certificado) com a fonte. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_UNLOCK_TOO_MANY_ATTEMPTS` | 429 | FAMILIA-LIMITE | Muitas tentativas com a senha errada neste servidor. Aguarde alguns minutos e tente de novo. | `backend/src/modules/data-hub/application/config-unlock-service.ts` |
| `DATA_SOURCE_UNREACHABLE` | — | FAMILIA-DEPENDENCIA | Não foi possível alcançar a fonte. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SOURCE_VOLUME_LIMIT` | — | FAMILIA-DEPENDENCIA | O volume lido passou do limite configurado para esta carga. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_SUBGROUP_NOT_FOUND` | — | FAMILIA-DEPENDENCIA | Subgrupo não encontrado. | `backend/src/modules/data-hub/domain/error-codes.ts` |
| `DATA_TYPE_INVALID` | — | FAMILIA-DEPENDENCIA | Valor com tipo inválido. | `backend/src/modules/data-hub/domain/error-codes.ts` |

### Módulo `data-explorer`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `DATA_CANCEL_BUSY` | 429 | FAMILIA-LIMITE | Já há um cancelamento em andamento nesta organização. Aguarde terminar e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_FAILED` | 500 | FAMILIA-DEPENDENCIA | Não foi possível concluir e nada foi alterado. Tente de novo; se continuar, avise o administrador. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_IN_FLIGHT` | 409 | FAMILIA-CONFLITO | ${count === 1 ? "Uma execução de Workflow em andamento usa" :  | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_INVALID_REASON` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escreva o motivo, com 10 a 500 caracteres, sem caracteres invisíveis. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_LOCKED` | 409 | FAMILIA-CONFLITO | Estes registros estão em uso por outra operação, como uma carga. Aguarde e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_NOT_AVAILABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Os registros deste conjunto não podem ser cancelados por aqui. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_NOTHING` | 409 | FAMILIA-CONFLITO | Nenhum registro ativo foi encontrado: eles podem já ter sido cancelados. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_OWN_RECORDS` | 403 | FAMILIA-ACESSO | Estes registros incluem os seus próprios resultados. Peça a outro administrador para ${action}. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_RUN_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | Há uma carga deste tipo de dado em andamento. Aguarde terminar para não misturar os dois. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_SCOPE_CHANGED` | 409 | FAMILIA-CONFLITO | A quantidade de registros mudou desde a prévia. Confira de novo antes de confirmar. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_SCOPE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha os registros ou aplique ao menos um filtro: um cancelamento nunca vale para o conjunto inteiro. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_TIMEOUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O cancelamento passou do limite de tempo e nada foi alterado. Restrinja os filtros e faça por partes. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_TOO_MANY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O cancelamento alcança mais de ${max.toLocaleString("pt-BR")} registros, o limite por vez. Restrinja os filtros e faça por partes. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCEL_TOO_MANY_KEYS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Selecione no máximo ${max} registros de uma vez, ou use um filtro. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_CANCELLATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Este cancelamento não existe ou não está disponível. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_BUSY` | 429 | FAMILIA-LIMITE | Já há consultas em andamento no limite permitido. Aguarde terminarem e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_COLUMN_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A consulta usa uma coluna que não está liberada neste conjunto de dados. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_DATASET_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Este conjunto de dados não existe ou não está liberado para consulta. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_EXPORT_BUSY` | 429 | FAMILIA-LIMITE | Já há uma exportação em andamento. Aguarde terminar e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_EXPORT_TOO_LARGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A exportação tem mais de ${maxRows.toLocaleString("pt-BR")} registros, o limite por arquivo. Restrinja os filtros e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_FILTER_LIMIT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Os filtros aceitam até ${conditions} condições e ${depth} níveis de grupo. Simplifique os filtros. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_FILTER_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta coluna não pode ser usada em filtros. Escolha outra coluna. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_INVALID_CURSOR` | 400 | FAMILIA-REGRA-DE-NEGOCIO | A posição da página não vale mais para esta consulta. Volte para a primeira página. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_INVALID_REQUEST` | 400 | FAMILIA-REGRA-DE-NEGOCIO | A consulta não está no formato esperado. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_INVALID_VALUE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Um dos valores do filtro não é válido para o tipo da coluna. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_LIST_LIMIT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Uma lista de valores aceita no máximo ${max} itens. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_NO_COLUMNS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha ao menos uma coluna. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_OPERATOR_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta condição não vale para o tipo desta coluna. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_PAGE_SIZE_EXCEEDED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Cada página mostra no máximo ${max} registros. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_QUERY_FAILED` | 500 | FAMILIA-DEPENDENCIA | Não foi possível executar a consulta. Tente de novo; se continuar, avise o administrador. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_QUERY_TIMEOUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A consulta passou do limite de ${Math.round(timeoutMs / 1000)} segundos e foi interrompida. Restrinja os filtros, por exemplo com um período menor, e tente de novo. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_SEARCH_LENGTH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A busca precisa ter de ${min} a ${max} caracteres. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_SEARCH_NOT_AVAILABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este conjunto de dados não tem campos de busca. Use os filtros. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_SORT_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não é possível ordenar por esta coluna. Escolha uma das colunas marcadas como ordenáveis. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_EXPLORER_TOO_MANY_COLUMNS` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha no máximo ${max} colunas. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_REACTIVATION_BLOCKED` | 409 | FAMILIA-CONFLITO | Estes registros não passam na regra atual do indicador. Corrija o indicador ou envie uma carga nova: nada foi reativado. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DATA_REACTIVATION_NOTHING` | 409 | FAMILIA-CONFLITO | Não há mais registros cancelados neste lote. Uma carga pode já tê-los reativado. | `backend/src/modules/data-explorer/domain/explorer-errors.ts` |
| `DELETED_ITEM_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Item excluído não encontrado. | `backend/src/modules/data-explorer/application/deleted-items-service.ts` |
| `DELETED_ITEM_RESTORE_BLOCKED` | 409 | FAMILIA-CONFLITO | Outro registro ativo já usa este nome ou código. Renomeie ou exclua o atual antes de restaurar. | `backend/src/modules/data-explorer/application/deleted-items-service.ts` |

### Módulo `diagnostics`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `DIAGNOSTIC_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Investigação não encontrada. | `backend/src/modules/diagnostics/presentation/diagnostics-router.ts` |
| `DIAGNOSTICS_ACCESS_DENIED` | 403 | FAMILIA-ACESSO | Você não tem acesso ao Diagnóstico. | `backend/src/modules/diagnostics/presentation/diagnostics-router.ts` |
| `DIAGNOSTICS_PERIOD_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Escolha um período de até 366 dias (início antes do fim). | `backend/src/modules/diagnostics/presentation/diagnostics-router.ts` |

### Módulo `indicator-diagnosis`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `DRAFT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/indicator-diagnosis/application/simulate-diagnostic-strategy.ts` |
| `MEASUREMENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Medição não encontrada para este indicador e colaborador. | `backend/src/modules/indicator-diagnosis/application/simulate-diagnostic-strategy.ts` |
| `STRATEGY_DRAFT_NOT_FOUND` | 409 | FAMILIA-CONFLITO | Não há rascunho para publicar. | `backend/src/modules/indicator-diagnosis/application/diagnostic-strategy-service.ts` |
| `STRATEGY_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Configuração da estratégia inválida. | `backend/src/modules/indicator-diagnosis/application/diagnostic-strategy-service.ts` |
| `STRATEGY_INVALID_FOR_PUBLISH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/indicator-diagnosis/application/diagnostic-strategy-service.ts` |
| `STRATEGY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Este indicador ainda não tem estratégia de diagnóstico. | `backend/src/modules/indicator-diagnosis/application/diagnostic-strategy-service.ts` |

### Módulo `users`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `EMAIL_ALREADY_IN_USE` | 409 | FAMILIA-CONFLITO | Já existe uma conta com este e-mail. | `backend/src/modules/access/application/account-access-service.ts`<br>`backend/src/modules/users/presentation/user-account-router.ts` |
| `EMPLOYMENT_STATUS_CONFLICT` | 409 | FAMILIA-CONFLITO | Já existe um período ${EMPLOYMENT_STATUS_LABELS[outcome.conflict!.existing.status]} de ${outcome.conflict!.existing.effectiveFrom}${outcome.conflict!.existing.effectiveTo ?  | `backend/src/modules/users/presentation/user-account-router.ts` |
| `PEOPLE_ROLE_REQUIRES_ORGANIZATION_SCOPE` | 403 | FAMILIA-ACESSO | Definir ou mudar um nível de liderança (Supervisor, Coordenador, Gerente…) exige administrar pessoas na organização inteira. | `backend/src/modules/users/presentation/user-account-router.ts` |
| `PEOPLE_SELF_CHANGE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não pode alterar o seu próprio nível, Grupo, e-mail ou situação — outra pessoa autorizada precisa fazer isso. | `backend/src/modules/users/presentation/user-account-router.ts` |
| `PERSON_FIELD_MANAGED_BY_SOURCE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/users/presentation/user-account-router.ts` |
| `PERSON_HIERARCHY_REQUIRES_SOURCE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Quem é da hierarquia vem pela base (${sources.map((source) =>  | `backend/src/modules/users/presentation/user-account-router.ts` |
| `PERSON_MATRICULA_IN_USE` | 409 | FAMILIA-CONFLITO | Já existe uma pessoa com esta matrícula na organização. Não cadastre de novo: libere o acesso dela em Acessos › Habilitar acesso. | `backend/src/modules/users/presentation/user-account-router.ts` |
| `USER_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pessoa não encontrada. | `backend/src/modules/people/application/person-source-link.ts`<br>`backend/src/modules/users/presentation/user-account-router.ts` |

### Módulo `error-diagnostics`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ERROR_CODE_NOT_IN_CATALOG` | 404 | FAMILIA-NAO-ENCONTRADO | Código não encontrado no catálogo. | `backend/src/modules/error-diagnostics/presentation/error-diagnostics-router.ts` |
| `ERROR_REFERENCE_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Referência em formato inválido. | `backend/src/modules/error-diagnostics/presentation/error-diagnostics-router.ts` |

### Módulo `feedback-engine`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `FEEDBACK_ANALYSIS_COLLABORATOR_NOT_ALLOWED` | 403 | FAMILIA-ACESSO | Análise bloqueada: o colaborador ${collaboratorId} está fora do escopo permitido nesta execução. | `backend/src/modules/feedback-engine/application/analyze-call.ts` |
| `FEEDBACK_ANALYSIS_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | A análise desta chamada está em andamento em outra execução — será retomada. | `backend/src/modules/feedback-engine/application/analyze-call.ts` |
| `FEEDBACK_CALL_REVIEW_PENDING` | 503 | FAMILIA-DEPENDENCIA | A revisão da análise da chamada não pôde ser concluída agora — a análise está guardada e só a revisão será retomada. | `backend/src/modules/feedback-engine/application/analyze-call.ts` |
| `FEEDBACK_ENGINE_BUDGET_EXHAUSTED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Orçamento da execução atingido (${limit}) — a chamada de ${stage} não foi feita. | `backend/src/modules/feedback-engine/application/engine-meter.ts` |
| `FEEDBACK_ENGINE_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | A geração deste feedback está em andamento em outra execução — será retomada. | `backend/src/modules/feedback-engine/application/generate-feedback.ts` |
| `FEEDBACK_INVESTIGATION_ANALYSIS_PENDING` | 503 | FAMILIA-DEPENDENCIA | A investigação depende de ${interactionIds.length} análise(s) de chamada com revisão pendente — será retomada. | `backend/src/modules/feedback-engine/application/investigate-indicator.ts` |
| `FEEDBACK_INVESTIGATION_IN_PROGRESS` | 409 | FAMILIA-CONFLITO | A investigação deste indicador está em andamento em outra execução — será retomada. | `backend/src/modules/feedback-engine/application/investigate-indicator.ts` |

### Módulo `realtime`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `FEEDBACK_APPLICATION_CONTEXT_UNAVAILABLE` | 503 | FAMILIA-DEPENDENCIA | Não foi possível carregar o contexto deste feedback. Tente de novo em instantes. | `backend/src/modules/realtime/presentation/realtime-router.ts` |
| `KNOWLEDGE_CLARIFICATION_UNAVAILABLE` | 409, 503 | FAMILIA-CONFLITO | Este esclarecimento não está mais disponível. Faça a pergunta de novo. | `backend/src/modules/knowledge-clarification/application/knowledge-clarification-service.ts`<br>`backend/src/modules/realtime/presentation/realtime-router.ts` |
| `REALTIME_NOT_CONFIGURED` | 503 | FAMILIA-DEPENDENCIA | Voz em tempo real não está configurada neste ambiente. | `backend/src/modules/realtime/infrastructure/gemini-realtime-client.ts` |
| `REALTIME_SESSION_FAILED` | 502 | FAMILIA-DEPENDENCIA | Não foi possível iniciar a sessão de voz. | `backend/src/modules/realtime/infrastructure/gemini-realtime-client.ts` |
| `REALTIME_SESSION_TIMEOUT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/realtime/infrastructure/gemini-realtime-client.ts` |
| `SPECIALIST_TOOL_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Especialista não encontrado para essa tool. | `backend/src/modules/realtime/presentation/realtime-router.ts` |
| `TEXT_REPLY_EMPTY` | 502 | FAMILIA-DEPENDENCIA | A INIA não retornou uma resposta. | `backend/src/modules/realtime/infrastructure/gemini-text-client.ts` |
| `TEXT_REPLY_FAILED` | 502 | FAMILIA-DEPENDENCIA | Não foi possível obter uma resposta da INIA. | `backend/src/modules/realtime/infrastructure/gemini-text-client.ts` |
| `TEXT_REPLY_NETWORK_ERROR` | 504 | FAMILIA-DEPENDENCIA | Não foi possível contatar a INIA. | `backend/src/modules/realtime/infrastructure/gemini-text-client.ts` |
| `TEXT_REPLY_NOT_CONFIGURED` | 503 | FAMILIA-DEPENDENCIA | Resposta de texto não está configurada neste ambiente. | `backend/src/modules/realtime/infrastructure/gemini-text-client.ts` |
| `TEXT_REPLY_TIMEOUT` | 422, 504 | FAMILIA-REGRA-DE-NEGOCIO | A INIA demorou demais para responder. | `backend/src/modules/realtime/infrastructure/gemini-text-client.ts` |

### Módulo `feedback-rating`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `FEEDBACK_CONTESTATION_ALREADY_REVIEWED` | 409 | FAMILIA-CONFLITO | Esta contestação já foi respondida. | `backend/src/modules/feedback-rating/application/contestation-review-service.ts` |
| `FEEDBACK_CONTESTATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Contestação não encontrada. | `backend/src/modules/feedback-rating/application/contestation-review-service.ts` |
| `FEEDBACK_CONTESTATION_WITHDRAWN` | 409 | FAMILIA-CONFLITO | O colaborador retirou ou mudou esta avaliação. | `backend/src/modules/feedback-rating/application/contestation-review-service.ts` |
| `FEEDBACK_RATING_REPLACED_BY_READ_CONFIRMATION` | 410 | FAMILIA-NAO-ENCONTRADO | A avaliação deste feedback agora é feita ao confirmar a ciência. Atualize a página. | `backend/src/modules/feedback-rating/presentation/feedback-ratings-router.ts` |
| `FEEDBACK_READ_AGREEMENT_CONFLICT` | 409 | FAMILIA-CONFLITO | A escolha deste feedback já foi registrada. | `backend/src/modules/feedback-rating/application/read-agreement-service.ts` |

### Módulo `interaction-feedback`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `FEEDBACK_DELIVERY_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Feedback não encontrado. | `backend/src/modules/interaction-feedback/application/deliver-feedback.ts` |
| `FEEDBACK_QUALITY_REVIEW_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão de QA de feedback. | `backend/src/modules/interaction-feedback/application/feedback-review-service.ts` |
| `FEEDBACK_REVIEW_ALREADY_DECIDED` | 409 | FAMILIA-CONFLITO | Este feedback já foi avaliado por outra pessoa ou em outra aba. | `backend/src/modules/interaction-feedback/application/feedback-review-service.ts` |
| `FEEDBACK_REVIEW_EDIT_BLOCKED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O texto editado tem um problema que impede a aprovação. | `backend/src/modules/interaction-feedback/application/feedback-review-service.ts` |
| `FEEDBACK_REVIEW_INVALID_DECISION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/interaction-feedback/application/feedback-review-service.ts` |
| `FEEDBACK_REVIEW_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Revisão não encontrada ou fora do seu escopo. | `backend/src/modules/interaction-feedback/application/feedback-review-service.ts` |

### Módulo `governance`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `GLOSSARY_TERM_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Termo não encontrado. | `backend/src/modules/governance/presentation/governance-router.ts` |
| `RESPONSE_CHECK_FAILED` | — | FAMILIA-DEPENDENCIA | A conferência da resposta falhou. | `backend/src/modules/governance/application/response-compliance.ts` |
| `RESPONSE_CHECK_INVALID_OUTPUT` | — | FAMILIA-DEPENDENCIA | A conferência devolveu uma resposta fora do contrato. | `backend/src/modules/governance/application/response-compliance.ts` |
| `RESPONSE_CHECK_PROVIDER_ERROR` | — | FAMILIA-DEPENDENCIA | O provedor de IA não concluiu a conferência. | `backend/src/modules/governance/application/response-compliance.ts` |
| `TOPIC_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Assunto não encontrado. | `backend/src/modules/governance/presentation/governance-router.ts` |

### Módulo `human-support`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `GROUP` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/human-support/application/settings-service.ts` |
| `HUMAN_SUPPORT_ALREADY_CLASSIFIED` | 409 | FAMILIA-CONFLITO | Este atendimento já foi classificado. | `backend/src/modules/human-support/application/classification-service.ts` |
| `HUMAN_SUPPORT_ANJO_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Esta pessoa não tem o papel de Anjo. | `backend/src/modules/human-support/application/settings-service.ts` |
| `HUMAN_SUPPORT_ATTENDANCE_ACTIVE` | 409 | FAMILIA-CONFLITO | Classifique o atendimento depois de encerrá-lo. | `backend/src/modules/human-support/application/classification-service.ts` |
| `HUMAN_SUPPORT_ATTENDANCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Atendimento não encontrado. | `backend/src/modules/human-support/application/classification-service.ts`<br>`backend/src/modules/human-support/application/evaluation-service.ts` |
| `HUMAN_SUPPORT_CONCURRENT_CHANGE` | 409 | FAMILIA-CONFLITO | A configuração mudou enquanto você editava. Recarregue e tente de novo. | `backend/src/modules/human-support/application/settings-service.ts` |
| `HUMAN_SUPPORT_DISABLED` | 409 | FAMILIA-CONFLITO | O apoio com Anjo ainda não está disponível para sua equipe. | `backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_EVALUATION_CLOSED` | 409 | FAMILIA-CONFLITO | A avaliação deste atendimento não está mais aberta. | `backend/src/modules/human-support/application/evaluation-service.ts` |
| `HUMAN_SUPPORT_NO_ANJO_IN_SERVICE` | 409 | FAMILIA-CONFLITO | Nenhum Anjo em serviço agora. | `backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Registro não encontrado. | `backend/src/modules/human-support/application/coordination-service.ts` |
| `HUMAN_SUPPORT_OPERATOR_PRESENT` | 409 | FAMILIA-CONFLITO | O operador ainda está com a INIA aberta. | `backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_REQUEST_ALREADY_OPEN` | 409 | FAMILIA-CONFLITO | Você já tem um pedido de apoio aberto. | `backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_REQUEST_ENDED` | 409 | FAMILIA-CONFLITO | Este atendimento já foi encerrado. | `backend/src/modules/human-support/application/message-service.ts`<br>`backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_REQUEST_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pedido de apoio não encontrado. | `backend/src/modules/human-support/application/conversation-marks.ts`<br>`backend/src/modules/human-support/application/message-service.ts`<br>`backend/src/modules/human-support/application/request-service.ts` |
| `HUMAN_SUPPORT_SOURCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Mensagem não encontrada. | `backend/src/modules/human-support/application/request-service.ts` |
| `PERIOD_TOO_LONG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha um período de até 92 dias. | `backend/src/modules/human-support/application/coverage.ts` |
| `VALIDATION_ERROR` | 400, 422 | FAMILIA-REGRA-DE-NEGOCIO | Dados inválidos. | `backend/src/main/app.ts`<br>`backend/src/modules/human-support/application/coverage.ts`<br>`backend/src/modules/human-support/application/request-service.ts`<br>`backend/src/modules/human-support/application/settings-service.ts`<br>`backend/src/modules/indicators/presentation/employee-performance-router.ts`<br>`backend/src/modules/workflows/domain/draft-graph.ts` |

### Módulo `profile-preferences`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `IMAGE_TOO_LARGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A imagem é grande demais. | `backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |
| `IMAGE_UNREADABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/profile-preferences/application/profile-preferences-service.ts` |
| `PROFILE_AVATAR_FILE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Envie a foto para substituir a atual. | `backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |
| `PROFILE_COVER_FILE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Envie a imagem da capa. | `backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |
| `PROFILE_COVER_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Capa inválida. | `backend/src/modules/profile-preferences/application/profile-preferences-service.ts`<br>`backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |
| `PROFILE_IMAGE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Imagem não encontrada. | `backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |
| `PROFILE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Perfil não encontrado. | `backend/src/modules/profile-preferences/application/profile-preferences-service.ts` |
| `PROFILE_PREFERRED_NAME_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Use apenas letras, espaços, apóstrofo, hífen ou ponto. | `backend/src/modules/profile-preferences/application/profile-preferences-service.ts` |
| `PROFILE_PREFERRED_NAME_TOO_LONG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Use no máximo ${PREFERRED_NAME_MAX_LENGTH} caracteres. | `backend/src/modules/profile-preferences/application/profile-preferences-service.ts` |
| `PROFILE_UPLOAD_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Envio de imagem inválido. | `backend/src/modules/profile-preferences/presentation/profile-preferences-router.ts` |

### Módulo `indicator-rules`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INDICATOR_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Indicador não encontrado. | `backend/src/modules/indicator-diagnosis/application/diagnostic-strategy-service.ts`<br>`backend/src/modules/indicator-diagnosis/presentation/diagnostic-strategy-router.ts`<br>`backend/src/modules/indicator-rules/presentation/indicator-rule-router.ts`<br>`backend/src/modules/indicators/application/indicator-correction-service.ts`<br>`backend/src/modules/indicators/application/indicator-definition-service.ts`<br>`backend/src/modules/performance-analytics/application/build-indicator-members.ts` |
| `INDICATOR_RULE_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Esta regra vale para Grupos fora do seu escopo. | `backend/src/modules/indicator-rules/presentation/indicator-rule-router.ts` |
| `RULE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Regra não encontrada. | `backend/src/modules/indicator-rules/presentation/indicator-rule-router.ts` |

### Módulo `inia-scenes`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INIA_SCENE_BLUR_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O desfoque precisa estar entre 0 e 3 px. | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `INIA_SCENE_DIM_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O escurecimento precisa estar entre 0% e 100%. | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `INIA_SCENE_IMAGE_LABEL_INVALID` | — | FAMILIA-DEPENDENCIA | Identifique cada imagem com até ${INIA_SCENE_IMAGES.labelMax} caracteres (ex.: Dia, Noite). | `backend/src/modules/inia-scenes/domain/inia-scene.ts` |
| `INIA_SCENE_IMAGE_LABEL_TAKEN` | — | FAMILIA-DEPENDENCIA | Duas imagens estão identificadas como "${entry.label}". Use nomes diferentes. | `backend/src/modules/inia-scenes/domain/inia-scene.ts` |
| `INIA_SCENE_IMAGE_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Envie o arquivo da imagem "${label}". | `backend/src/modules/inia-scenes/application/inia-scene-service.ts`<br>`backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `INIA_SCENE_IMAGE_SLOT_OVERLAP` | — | FAMILIA-DEPENDENCIA | Os horários de "${overlap.a.label}" e "${overlap.b.label}" se sobrepõem das ${range.start} às ${range.end}. Ajuste as faixas para não coincidirem. | `backend/src/modules/inia-scenes/domain/inia-scene.ts` |
| `INIA_SCENE_IMAGES_CHANGED` | 409 | FAMILIA-CONFLITO | Imagem desconhecida neste cenário. | `backend/src/modules/inia-scenes/application/inia-scene-service.ts` |
| `INIA_SCENE_IMAGES_COUNT` | — | FAMILIA-DEPENDENCIA | Um cenário tem de 1 a ${INIA_SCENE_IMAGES.max} imagens. | `backend/src/modules/inia-scenes/domain/inia-scene.ts` |
| `INIA_SCENE_IMAGES_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Lista de imagens inválida. | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `INIA_SCENE_NAME_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Informe um nome de até 80 caracteres. | `backend/src/modules/inia-scenes/application/inia-scene-service.ts` |
| `INIA_SCENE_NAME_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um cenário com esse nome. | `backend/src/modules/inia-scenes/application/inia-scene-service.ts` |
| `INIA_SCENE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Cenário não encontrado. | `backend/src/modules/inia-scenes/application/inia-scene-service.ts`<br>`backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `INIA_SCENE_PERIOD_OVERLAP` | 409 | FAMILIA-CONFLITO | O período coincide com o do cenário "${conflict.name}". Ajuste as datas para não se sobreporem. | `backend/src/modules/inia-scenes/application/inia-scene-service.ts` |
| `INIA_SCENE_PRIMARY_IMAGE_REQUIRED` | — | FAMILIA-DEPENDENCIA | Escolha exatamente uma imagem principal (ela vale nos horários sem faixa). | `backend/src/modules/inia-scenes/domain/inia-scene.ts` |
| `INIA_SCENE_UPLOAD_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Envio de imagem inválido. | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `SCENE_IMAGE_TOO_LARGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A imagem é grande demais (máximo de 8 MB). | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |
| `SCENE_IMAGE_UNREADABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/inia-scenes/application/inia-scene-service.ts` |
| `SCENE_PERIOD_INCOMPLETE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/inia-scenes/presentation/inia-scene-router.ts` |

### Módulo `interactions`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INTERACTION_SUBJECT_ALIAS_UNKNOWN_CODE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Alias "${alias.rawSubject}" aponta para código desconhecido "${alias.code}". | `backend/src/modules/interactions/application/interaction-subject-catalog.ts` |
| `INTERACTION_SUBJECT_CODE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Código de assunto inválido: "${definition.code}". | `backend/src/modules/interactions/application/interaction-subject-catalog.ts` |

### Módulo `performance-analytics`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INVALID_COMPARISON` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Comparação operacional inválida. | `backend/src/modules/performance-analytics/presentation/analytics-router.ts` |
| `INVALID_CURSOR` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Cursor de paginação inválido. | `backend/src/modules/performance-analytics/presentation/analytics-router.ts`<br>`backend/src/modules/reporting/presentation/operator-router.ts` |
| `INVALID_SUBJECT` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Tipo de estrutura desconhecido. | `backend/src/modules/performance-analytics/domain/analytics-subject.ts` |
| `NO_STRUCTURE` | 404 | FAMILIA-NAO-ENCONTRADO | Seu perfil não possui estrutura vinculada. | `backend/src/modules/performance-analytics/presentation/analytics-router.ts` |
| `STRUCTURE_REQUIRED` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Esta visão só existe para estruturas. | `backend/src/modules/performance-analytics/presentation/analytics-router.ts` |

### Módulo `leadership-analytics`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INVALID_GROUPING` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Agrupar por ${GROUPING_LABELS[groupBy]} não está disponível para esta estrutura. | `backend/src/modules/leadership-analytics/application/indicator-analysis.ts`<br>`backend/src/modules/leadership-analytics/presentation/leadership-router.ts`<br>`backend/src/modules/performance-analytics/application/build-structure-dashboard.ts`<br>`backend/src/modules/performance-analytics/presentation/analytics-router.ts` |
| `LEADERSHIP_SCOPE_REQUIRED` | 403 | FAMILIA-ACESSO | Disponível para quem lidera uma estrutura ou tem acesso de consulta a indicadores. | `backend/src/modules/leadership-analytics/presentation/leadership-router.ts` |
| `LEADERSHIP_TOOL_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Ferramenta desconhecida. | `backend/src/modules/leadership-analytics/presentation/leadership-router.ts` |
| `STRUCTURE_ACCESS_DENIED` | 403, 422 | FAMILIA-ACESSO | Você não tem acesso a esta estrutura. | `backend/src/modules/leadership-analytics/presentation/leadership-router.ts`<br>`backend/src/modules/performance-analytics/application/viewer-scope.ts` |

### Módulo `knowledge`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `INVALID_SCOPE_JSON` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Escopo inválido. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED` | 409 | FAMILIA-CONFLITO | Esta base está arquivada. Publicar faz com que ela volte a valer para a IA: confirme a reativação para continuar. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_DRAFT_ONLY` | 409 | FAMILIA-CONFLITO | Esta base só tem o rascunho: para retirá-la, exclua a base. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_DRAFT_PENDING` | 409 | FAMILIA-CONFLITO | Há um rascunho em edição. Reverter descarta esse rascunho: confirme para continuar. | `backend/src/modules/knowledge/application/knowledge-versions.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_EXTRACTION_BUSY` | 503 | FAMILIA-DEPENDENCIA | Há muitos arquivos sendo lidos agora. Tente de novo em instantes. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_EXTRACTION_FAILED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não foi possível extrair texto do arquivo enviado. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_FILE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Arquivo original não encontrado para este material. | `backend/src/modules/knowledge/presentation/knowledge-material-router.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_FILE_TYPE_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O arquivo foi recusado: a leitura passou do limite de memória ou de tempo. Confira se ele não está corrompido ou envie uma versão menor. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_IMAGE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Esta imagem não faz parte desta versão. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_MATERIAL_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Material de apoio não encontrado ou não disponível para você. | `backend/src/modules/knowledge/presentation/knowledge-material-router.ts` |
| `KNOWLEDGE_NO_DRAFT` | 409 | FAMILIA-CONFLITO | Não há rascunho para descartar. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_NOT_ARCHIVED` | 409 | FAMILIA-CONFLITO | Esta base não está arquivada. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Base de conhecimento não encontrada. | `backend/src/modules/checkpoint-registry/application/checkpoint-registry-queries.ts`<br>`backend/src/modules/checkpoint-registry/application/checkpoint-registry-service.ts`<br>`backend/src/modules/knowledge/application/knowledge-versions.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_NOTHING_TO_PUBLISH` | 409 | FAMILIA-CONFLITO | Não há rascunho para publicar. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_OCR_DRAFT_CHANGED` | — | FAMILIA-DEPENDENCIA | O rascunho mudou durante a leitura, e o texto lido não foi gravado. Reprocesse o arquivo para ler de novo. | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_OCR_FAILED` | — | FAMILIA-DEPENDENCIA | A leitura do PDF parou antes do fim em várias tentativas. Reprocesse o arquivo para tentar de novo. | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_OCR_FILE_GONE` | — | FAMILIA-DEPENDENCIA | O arquivo deste rascunho não existe mais. | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_OCR_LIMIT` | — | FAMILIA-DEPENDENCIA | A leitura do PDF passou do limite de memória ou de tempo do servidor. Divida o arquivo em partes menores e envie de novo. | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_OCR_NO_TEXT` | — | FAMILIA-DEPENDENCIA | O OCR não encontrou texto nas páginas digitalizadas. Confira se o PDF está legível ou digite o conteúdo. | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_OCR_RUNNING` | 409 | FAMILIA-CONFLITO | O PDF ainda está sendo lido (OCR). Espere a leitura terminar e confira o texto antes de editar ou publicar. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_OCR_UNAVAILABLE` | — | FAMILIA-DEPENDENCIA | (mensagem montada no código) | `backend/src/modules/knowledge/application/knowledge-ocr-jobs.ts` |
| `KNOWLEDGE_PREVIEW_FAILED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Não foi possível gerar a prévia deste documento. | `backend/src/modules/knowledge/presentation/knowledge-material-router.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_PREVIEW_TOO_LARGE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/knowledge/presentation/knowledge-material-router.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_PREVIEW_UNSUPPORTED` | 415 | FAMILIA-LIMITE | Este formato não tem prévia em HTML. | `backend/src/modules/knowledge/presentation/knowledge-material-router.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_REPROCESS_NO_FILE` | 409 | FAMILIA-CONFLITO | Esta base não tem arquivo original para reprocessar. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_REPROCESS_STALE` | 409 | FAMILIA-CONFLITO | A base mudou enquanto o arquivo era reprocessado. Confira e tente de novo. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_REPROCESS_UNSUPPORTED` | 409 | FAMILIA-CONFLITO | O reprocessamento vale para bases em PDF. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_SCOPE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Esta base vale para Grupos fora do seu escopo: só quem administra todos eles pode alterá-la. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_SCOPE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O Subgrupo informado não existe neste Grupo. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_SOURCE_REQUIRED` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Informe um texto ou envie um arquivo. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_VERSION_ALREADY_CURRENT` | 409 | FAMILIA-CONFLITO | Esta já é a versão em uso. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_VERSION_NOT_FAILED` | 409 | FAMILIA-CONFLITO | Só uma atualização com falha pode ser processada de novo. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_VERSION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Versão não encontrada. | `backend/src/modules/knowledge/application/knowledge-versions.ts`<br>`backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `KNOWLEDGE_VERSION_NOT_REVERTIBLE` | 409 | FAMILIA-CONFLITO | Só é possível reverter para uma versão que já ficou pronta. | `backend/src/modules/knowledge/application/knowledge-versions.ts` |
| `KNOWLEDGE_VERSION_RESTRICTED` | 403 | FAMILIA-ACESSO | Esta versão valia para Grupos fora do seu escopo. | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |
| `PDF` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/knowledge/presentation/knowledge-router.ts` |

### Módulo `notifications`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `NOTIFICATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Notificação não encontrada. | `backend/src/modules/notifications/application/build-notification-summary.ts` |

### Módulo `reporting`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `OPERATOR_NOT_FOUND` | 404, 422 | FAMILIA-NAO-ENCONTRADO | Colaborador não encontrado nesta organização. | `backend/src/modules/ingestion/presentation/ingestion-router.ts`<br>`backend/src/modules/reporting/presentation/operator-router.ts`<br>`backend/src/modules/reporting/presentation/supervisor-router.ts` |

### Módulo `qa-lab`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `ORCHESTRATOR_INACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este orquestrador está inativo — ative-o antes de testar. | `backend/src/modules/qa-lab/application/run-orchestrator-simulation.ts` |
| `ORCHESTRATOR_INVOCATION_MODE_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este orquestrador não está habilitado para o contexto "${input.invocationContext}" (modo de invocação: ${row.invocation_mode}). | `backend/src/modules/qa-lab/application/run-orchestrator-simulation.ts` |
| `QA_CHANNEL_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta interação é do canal ${call.channel}, mas o gatilho exige a Flag ${flagLabel(flag)} (canal ${flag.channel}). | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_CONDITION_NOT_PREVIEWABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A prévia por colaborador só se aplica a Conditions de performance ou histórico do indicador — para Conditions sobre o valor do gatilho, use os filtros de chamadas/medições. | `backend/src/modules/qa-lab/application/test-data-finders.ts` |
| `QA_FLAG_MISSING_ON_INTERACTION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta interação não possui a Flag ${flagLabel(flag)} exigida pelo gatilho. | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_FLAG_NOT_FOUND` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A flag configurada no gatilho não existe mais no catálogo. | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_INDICATOR_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A medição selecionada é do indicador "${row2.code}", mas o workflow dispara por "${expectedCode}". | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_INTERACTION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Interação não encontrada. | `backend/src/modules/qa-lab/application/interaction-evidence.ts`<br>`backend/src/modules/qa-lab/presentation/qa-lab-router.ts` |
| `QA_INTERACTION_UNAVAILABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A interação original deste QA Run não está mais disponível. | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_MEASUREMENT_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Medição não encontrada. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_NODE_NOT_CONDITION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Selecione um node de Condição. | `backend/src/modules/qa-lab/application/test-data-finders.ts` |
| `QA_OPERATOR_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Colaborador não encontrado. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_OPERATOR_OUT_OF_POPULATION` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O colaborador não pertence à população deste Workflow (Abrangência/Filtro Populacional). | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_RESOURCE_UNKNOWN` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Tipo de recurso desconhecido. | `backend/src/modules/qa-lab/presentation/qa-lab-router.ts` |
| `QA_RUN_AWAITING_DECISION` | 409 | FAMILIA-CONFLITO | Esta simulação está aguardando uma decisão de revisão humana (aprovar/reprovar/escalar). | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_RUN_EMPLOYEE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Colaborador "${employeeId}" não faz parte de nenhuma coleção desta simulação. | `backend/src/modules/qa-lab/application/run-workflow-simulation.ts`<br>`backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_RUN_FINISHED` | 409 | FAMILIA-CONFLITO | Esta simulação já terminou — use \"Executar novamente\". | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_RUN_NOT_AWAITING_DECISION` | 409 | FAMILIA-CONFLITO | Esta simulação não está aguardando decisão de revisão humana. | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_RUN_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Execução de QA não encontrada. | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts`<br>`backend/src/modules/qa-lab/presentation/qa-lab-router.ts` |
| `QA_RUN_NOT_RESUMABLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta execução de QA não é uma simulação de Workflow retomável. | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_RUN_NOT_WORKFLOW` | 422 | FAMILIA-REGRA-DE-NEGOCIO | \"Testar rascunho atual\" só se aplica a execuções de Workflow. | `backend/src/modules/qa-lab/presentation/qa-lab-router.ts` |
| `QA_RUN_WITHOUT_SNAPSHOT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta execução antiga não guardou o snapshot da configuração — use \"Testar rascunho atual\". | `backend/src/modules/qa-lab/presentation/qa-lab-router.ts` |
| `QA_SHIFT_INCOMPATIBLE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A regra relativa deste workflow é incompatível com a jornada do colaborador (cairia fora do expediente). | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_SHIFT_MISSING` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O colaborador selecionado não tem jornada cadastrada para a data simulada — cadastre a jornada em Usuários ou escolha outro colaborador. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_SUBJECT_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este workflow parte de uma medição de indicador — selecione uma medição de um colaborador. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_TRANSCRIPT_REQUIRED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este Workflow necessita de transcrição e esta interação não possui uma disponível. Escolha outra interação ou use \"Parar antes da IA\" para testar as etapas anteriores. | `backend/src/modules/qa-lab/application/workflow-simulation-service.ts` |
| `QA_TRIGGER_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Trigger relativo ao expediente sem configuração. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_TRIGGER_NOT_FLAG` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este workflow não parte de uma interação (Flag de canal ou Manual com interação) — a massa de teste por interação não se aplica. | `backend/src/modules/qa-lab/application/interaction-evidence.ts` |
| `QA_UNIT_EMPTY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A estrutura selecionada não tem nenhum operador — nada a analisar. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts`<br>`backend/src/modules/qa-lab/application/test-data-finders.ts` |
| `QA_UNIT_KIND_MISMATCH` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A estrutura selecionada (${structure.kind}) não é do mesmo tipo configurado no workflow (${configuredStructure.kind}). | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts`<br>`backend/src/modules/qa-lab/application/test-data-finders.ts` |
| `QA_WORKFLOW_NO_TRIGGER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O grafo deste workflow não tem node Trigger. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_WORKFLOW_NOT_PUBLISHED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Este workflow ainda não tem versão publicada — teste o rascunho. | `backend/src/modules/qa-lab/application/build-simulated-enrollment.ts` |
| `QA_WRITE_BLOCKED` | 500 | FAMILIA-DEPENDENCIA | Escrita no banco bloqueada em ambiente de QA: "${sql.trim().slice(0, 80).replace(/\s+/g, " ")}…". A simulação nunca grava dados operacionais. | `backend/src/modules/qa-lab/application/read-only-database.ts` |
| `WORKFLOW_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Workflow não encontrado. | `backend/src/modules/qa-lab/application/test-data-finders.ts`<br>`backend/src/modules/qa-lab/application/workflow-simulation-service.ts`<br>`backend/src/modules/qa-lab/presentation/qa-lab-router.ts`<br>`backend/src/modules/workflows/application/manual-run.ts`<br>`backend/src/modules/workflows/presentation/workflow-results-router.ts`<br>`backend/src/modules/workflows/presentation/workflow-router/shared.ts` |

### Módulo `pending-actions`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `PENDING_ACTION_ALREADY_DECIDED` | 409 | FAMILIA-CONFLITO | Esta revisão já foi decidida. | `backend/src/modules/pending-actions/application/build-pending-actions.ts`<br>`backend/src/modules/people/application/workday-reconciliation-service.ts` |
| `PENDING_ACTION_DECISION_NOT_ALLOWED` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Esta decisão não está prevista no workflow para esta revisão. | `backend/src/modules/pending-actions/application/build-pending-actions.ts` |
| `PENDING_ACTION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pendência não encontrada ou não endereçada a você. | `backend/src/modules/pending-actions/application/build-pending-actions.ts`<br>`backend/src/modules/people/application/workday-reconciliation-service.ts` |
| `PENDING_ACTION_UNAVAILABLE` | 409 | FAMILIA-CONFLITO | Esta execução não está mais aguardando esta revisão. | `backend/src/modules/pending-actions/application/build-pending-actions.ts` |

### Módulo `product-catalog`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `PRODUCT_CODE_LOCKED` | 409 | FAMILIA-CONFLITO | O código já é usado por bases ou indícios: crie outro produto em vez de trocar o código. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CODE_TAKEN` | 409 | FAMILIA-CONFLITO | Já existe um produto ou categoria com esse código. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_ARCHIVED` | 409 | FAMILIA-CONFLITO | Indício encerrado: reative-o para aprovar uma nova versão. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_EFFECTIVE_ORDER` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A nova vigência precisa começar depois do início da versão vigente. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_NO_DRAFT` | 409 | FAMILIA-CONFLITO | Não há rascunho para aprovar. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Indício não encontrado. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_NOT_READY` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O rascunho ainda não pode ser aprovado. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_NOT_STARTED` | 409 | FAMILIA-CONFLITO | A versão aprovada ainda não começou a valer: aguarde o início ou aprove outra data. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_ONLY_DRAFT` | 409 | FAMILIA-CONFLITO | O indício nunca foi aprovado: exclua o indício em vez de descartar o único rascunho. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_RETROACTIVE` | 422 | FAMILIA-REGRA-DE-NEGOCIO | A vigência não pode começar antes da aprovação: um indício aprovado agora nunca vale para chamadas anteriores. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_SOURCE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Documento de origem não encontrado na base desta organização. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_CRITERION_TARGET_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Um dos produtos indicados não existe nesta organização. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_NODE_HAS_ACTIVE_CHILDREN` | 409 | FAMILIA-CONFLITO | Desative primeiro os produtos desta categoria. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_NODE_IN_USE` | 409 | FAMILIA-CONFLITO | Este item é usado agora por bases, indícios ou produtos dentro dele: tire-o de lá antes de excluir, ou desative. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_NODE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Produto ou categoria não encontrado. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_PARENT_INACTIVE` | 409, 422 | FAMILIA-CONFLITO | A categoria escolhida está desativada. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_SCOPE_SOURCE_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Base não encontrada nesta organização. | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |
| `PRODUCT_SCOPE_TARGET_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Escolha só produtos ou categorias ativos. | `backend/src/modules/product-catalog/application/product-scope-assignments.ts` |
| `PRODUCT_TREE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/product-catalog/application/product-catalog-service.ts` |

### Módulo `org-structure`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `TEAM_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Grupo não encontrado. | `backend/src/modules/org-structure/presentation/org-structure-router.ts` |

### Módulo `usage-analytics`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `USABILITY_CLASSIFICATION_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pessoa sem classificação vigente. | `backend/src/modules/usage-analytics/application/usage-settings-service.ts` |
| `USABILITY_COMMENTS_FORBIDDEN` | 403 | FAMILIA-ACESSO | Exportar comentários exige permissão específica. | `backend/src/modules/usage-analytics/application/query/usability-export.ts` |
| `USABILITY_EXPORT_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para exportar. | `backend/src/modules/usage-analytics/presentation/usability-router.ts` |
| `USABILITY_EXPORT_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Tabela de exportação inválida. | `backend/src/modules/usage-analytics/application/query/usability-export.ts` |
| `USABILITY_EXPORT_TOO_LARGE` | 413 | FAMILIA-LIMITE | O recorte tem ${total} linhas — acima do limite de ${EXPORT_ROW_LIMIT} por arquivo. Estreite o período ou os filtros. | `backend/src/modules/usage-analytics/application/query/usability-export.ts` |
| `USABILITY_FILTER_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Filtro inválido. | `backend/src/modules/usage-analytics/application/query/usability-filters.ts` |
| `USABILITY_FILTER_NOT_SUPPORTED` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Filtro não se aplica a esta aba: ${unsupported.join(", ")}. | `backend/src/modules/usage-analytics/application/query/usability-filters.ts` |
| `USABILITY_PEOPLE_FORBIDDEN` | 403 | FAMILIA-ACESSO | Você não tem permissão para ver pessoas identificadas. | `backend/src/modules/usage-analytics/application/query/person-query.ts`<br>`backend/src/modules/usage-analytics/application/query/usability-context.ts`<br>`backend/src/modules/usage-analytics/application/query/usability-export.ts` |
| `USABILITY_PERIOD_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | (mensagem montada no código) | `backend/src/modules/usage-analytics/application/query/usability-context.ts` |
| `USABILITY_PERSON_NOT_FOUND` | 404 | FAMILIA-NAO-ENCONTRADO | Pessoa não encontrada. | `backend/src/modules/usage-analytics/application/query/person-query.ts`<br>`backend/src/modules/usage-analytics/application/usage-settings-service.ts` |
| `USABILITY_REPROCESS_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Intervalo inválido (máximo 400 dias). | `backend/src/modules/usage-analytics/application/usage-settings-service.ts` |
| `USABILITY_SEGMENT_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Segmento inválido. | `backend/src/modules/usage-analytics/application/query/feedbacks-query.ts`<br>`backend/src/modules/usage-analytics/application/query/journeys-query.ts`<br>`backend/src/modules/usage-analytics/application/query/people-query.ts` |
| `USABILITY_SMALL_COHORT` | 422 | FAMILIA-REGRA-DE-NEGOCIO | O recorte escolhido tem menos de ${MINIMUM_SENSITIVE_AGGREGATE_POPULATION} pessoas. Para não identificar ninguém, a monitoria só mostra números de grupos com ${MINIMUM_SENSITIVE_AGGREGATE_POPULATION} pessoas ou mais —… | `backend/src/modules/usage-analytics/application/query/usability-context.ts` |
| `USABILITY_TIMEZONE_INVALID` | 422 | FAMILIA-REGRA-DE-NEGOCIO | Fuso horário inválido. | `backend/src/modules/usage-analytics/application/usage-settings-service.ts` |
| `USAGE_ACCOUNT_MISMATCH` | 409 | FAMILIA-CONFLITO | O lote pertence a outra conta e foi descartado. | `backend/src/modules/usage-analytics/application/ingest-client-events.ts` |
| `USAGE_BATCH_INVALID` | 400 | FAMILIA-REGRA-DE-NEGOCIO | Lote de eventos inválido. | `backend/src/modules/usage-analytics/application/ingest-client-events.ts`<br>`backend/src/modules/usage-analytics/presentation/usage-events-router.ts` |
| `USAGE_BATCH_TOO_LARGE` | 413 | FAMILIA-LIMITE | Lote acima do limite. | `backend/src/modules/usage-analytics/presentation/usage-events-router.ts` |
| `USAGE_ORIGIN_NOT_ALLOWED` | 403 | FAMILIA-ACESSO | Origem não permitida. | `backend/src/modules/usage-analytics/presentation/usage-events-router.ts` |

### Módulo `reliable-feedback`

| Código | Status | Família | Mensagem | Onde |
| --- | --- | --- | --- | --- |
| `WRITER_TRANSIENT_PROVIDER_ERROR` | 503 | FAMILIA-DEPENDENCIA | O redator do feedback não respondeu (${code}) — nova tentativa pela política de retry. | `backend/src/modules/reliable-feedback/application/generate-reliable-feedback.ts` |
