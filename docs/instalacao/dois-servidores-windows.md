# INIA em dois servidores (Windows Server): aplicação de um lado, dados do outro

Montagem para quando a empresa separa a **área de aplicação** (onde a INIA roda) da **área de dados** (onde os dados
ficam). É a mesma arquitetura de produção — só muda onde cada peça está.

> Versão para imprimir e distribuir às áreas, com figuras: **IT-INIA-003** em
> [docs/manuais](../manuais/) (`.docx` e `.pdf`). Este arquivo é o resumo técnico do mesmo procedimento.

| Peça | Onde | Porta | Quem cuida |
| --- | --- | --- | --- |
| IIS — site "INIA" (URL Rewrite 2.1 + ARR 3.0) | Servidor da aplicação | Pública: 443 com HTTPS (ou a liberada) | Infraestrutura |
| Serviço **INIA - API** (Node.js 24) — telas, chat, voz, administração | Servidor da aplicação | 127.0.0.1:3333 (só interna) | Quem instala a INIA |
| Serviço **INIA - Processamento** (Node.js 24) — Workflows, feedbacks, tarefas periódicas | Servidor da aplicação | 127.0.0.1:3334 (só `/health`, interna) | Quem instala a INIA |
| Serviço **INIA - Interface** (Node.js 24) | Servidor da aplicação | 127.0.0.1:3000 (só interna) | Quem instala a INIA |
| PostgreSQL — **banco interno da INIA** | Área de dados | 5432 | Equipe de dados |
| SQL Server — **dados dos clientes**, só leitura pela Central de Dados | Área de dados | 1433 | Equipe de dados |
| Google Gemini (IA) | Internet | 443 | Responsável pela IA (chave) |

As pessoas acessam **um endereço só** (ex.: `https://inia.empresa.local`). O IIS manda `/api` e `/health` para a API e
o resto para a interface. A INIA não roda sobre SQL Server: o banco interno é sempre PostgreSQL, e o SQL Server só é lido.

**Ordem:** 1) área de dados: PostgreSQL · 2) área de dados: login de leitura no SQL Server · 3) infraestrutura:
preparar o Windows · 4) instalar a INIA · 5) IIS · 6) serviços · 7) primeiro acesso. Os passos 1, 2 e 3 podem ser
feitos ao mesmo tempo.

**HTTP ou HTTPS:** com `https://` a INIA roda em produção (cookie seguro) e a voz funciona. Com `http://` (só rede
interna) login e telas funcionam, mas o navegador **bloqueia o microfone** e nada é criptografado.

**Firewall:** usuários → porta pública do servidor da aplicação; servidor da aplicação → 5432 e 1433 da área de dados;
servidor da aplicação → internet 443 (`generativelanguage.googleapis.com`, `registry.npmjs.org`, `github.com`);
navegador dos usuários → `generativelanguage.googleapis.com` 443 (voz). **Não abra 3000, 3333 nem 3334.**

---

## 1. Área de dados — PostgreSQL da INIA

| Servidor da área de dados | PostgreSQL |
| --- | --- |
| Windows Server 2016 | **15** (mais novo com instalador oficial para o 2016; suporte até nov/2027) |
| Windows Server 2019 / 2022 | **17** |
| Linux | 15, 16 ou 17 (pacotes oficiais; no Red Hat, também `postgresqlNN-contrib`) |

A INIA exige o **15 ou mais novo** (testada no 15 e no 17: todas as migrations, dados de referência, massa de
demonstração com 1,5 milhão de medições e as provas de banco, com o mesmo resultado). No Windows: instalador da EDB
(postgresql.org › Download › Windows), componentes Server + Command Line Tools; as extensões já vêm junto.

```sql
create role inia_app login password 'troque-por-uma-senha-forte';
create database inia owner inia_app encoding 'UTF8' template template0;
```

- O usuário **não precisa** ser superusuário; basta ser o **dono** do banco. O banco **precisa** ser UTF8.
- A instalação ativa sozinha `pgcrypto` e `btree_gist` (o dono pode). Se a política não permitir, rode como
  administrador, conectado no banco `inia`: `create extension if not exists pgcrypto;` e
  `create extension if not exists btree_gist;`.
- `postgresql.conf`: `listen_addresses = '*'` e reinicie. `pg_hba.conf` (recarregue com `select pg_reload_conf();`):

```
hostssl  inia  inia_app  IP-DO-SERVIDOR-DA-APLICACAO/32  scram-sha-256
```

- Firewall da área de dados: 5432 só a partir do IP do servidor da aplicação:

```powershell
New-NetFirewallRule -DisplayName "PostgreSQL - INIA" -Direction Inbound -Protocol TCP -LocalPort 5432 -RemoteAddress IP-DO-SERVIDOR-DA-APLICACAO -Action Allow
```

- **SSL (recomendado):** `ssl = on`, `ssl_cert_file`, `ssl_key_file`. Certificado da autoridade da empresa para o
  **nome** do servidor (a INIA consegue conferir) ou autoassinado (criptografa sem conferir). Sem SSL: `host` no lugar
  de `hostssl`, só em rede interna confiável.
- **Backup** (Agendador de Tarefas; senha em `%APPDATA%\postgresql\pgpass.conf` da conta da tarefa):

```powershell
& "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe" -Fc -h localhost -U inia_app -d inia -f "D:\backup\inia-$(Get-Date -Format yyyy-MM-dd).dump"
```

Entregue a quem instala a INIA: servidor (o nome do certificado, se houver), porta, banco, usuário, senha, se o SSL
está ligado e, para conferir o certificado, o `.pem` da autoridade.

## 2. Área de dados — SQL Server com os dados dos clientes (somente leitura)

- SQL Server **2016+** com TLS 1.2; **modo misto** de autenticação (a INIA entra com usuário/senha do SQL Server);
  **TCP/IP** habilitado (1433; instância nomeada exige SQL Server Browser UDP 1434 ou porta fixa); firewall só para o
  servidor da aplicação.

```sql
CREATE LOGIN inia_leitura WITH PASSWORD = 'troque-por-uma-senha-forte';
GO
USE NomeDoBanco;
GO
CREATE USER inia_leitura FOR LOGIN inia_leitura;
GRANT SELECT ON dbo.NomeDaVisaoOuTabela TO inia_leitura;
GO
```

Repita o `GRANT SELECT` por tabela ou visão; nunca `db_owner`. A INIA pede conexão criptografada aceitando o
certificado do servidor; servidor antigo que recusar → "Desligada" nas **Opções avançadas** da conexão (rede interna)
ou certificado no SQL Server. **Ainda não validado contra um SQL Server real** — a primeira conexão da POC é a
validação.

## 3. Infraestrutura — preparar o Windows Server da aplicação

Como administrador, nesta ordem:

1. **Microsoft Visual C++ Redistributable (x64)**, versão mais recente (página "Latest supported Visual C++
   Redistributable downloads" da Microsoft) — sem ele a compilação da interface falha com
   `Failed to load SWC binary for win32/x64`.
2. **Node.js 24 LTS**, instalador `.msi` x64 (nodejs.org). Deixe **desmarcado** "Tools for Native Modules". O Node.js 24
   suporta oficialmente o Windows Server 2016 em diante.
3. **Git para Windows** (git-scm.com), opções padrão.
4. IIS e ferramentas:

```powershell
Install-WindowsFeature Web-Server, Web-Mgmt-Console, Web-Scripting-Tools
```

5. **URL Rewrite 2.1** x64 (iis.net, `rewrite_amd64_en-US.msi`) e depois **Application Request Routing 3.0** x64
   (iis.net, `requestRouter_amd64.msi`).

Com proxy de internet: `npm config set proxy …`, `npm config set https-proxy …`, `git config --global http.proxy …`.
Proxy que inspeciona HTTPS: `npm config set cafile C:\certificados\raiz-empresa.pem` (raiz da empresa em .pem).

Sugestão para a POC (não medida em carga): 4 vCPUs, 8 GB de memória, 20 GB livres em C:. Importe o certificado HTTPS
em **Certificados (Computador local) › Pessoal**, com a chave privada.

## 4. Instalar e configurar a INIA

PowerShell **como administrador**, em `C:\inia` (caminho curto por causa do limite de caminho do Windows):

```powershell
cd C:\
git clone URL-DO-REPOSITORIO inia
cd C:\inia
npm run install:all
node scripts\install\env-init.mjs --own-postgres --public-url https://inia.empresa.local
npm run db:connect
npm run doctor
npm run setup
npm run build
```

- `env-init.mjs --public-url` (chamado com `node` direto: no PowerShell o `--` do `npm run x -- …` pode ser engolido):
  cria `backend\.env` e `frontend\.env.local` com segredos aleatórios, põe API e interface em `127.0.0.1`
  (`HOST`/`INIA_WEB_HOST`), `CORS_ORIGIN` e `NEXT_PUBLIC_INIA_API_URL` = o endereço público; `https://` → `NODE_ENV=production`,
  `http://` → `development`. Rodar de novo com outro endereço atualiza só esses valores.
- `db:connect` pergunta servidor, porta, banco, usuário, senha (oculta) e criptografia (1 = criptografada sem conferir;
  2 = conferida, com `.pem` e NOME do servidor; 3 = sem criptografia), **confere tudo** (rede, senha, versão ≥ 15, UTF8,
  permissões, extensões) e só então grava o `DATABASE_URL`. Não interativo: `INIA_DB_PASSWORD` +
  `--host --port --database --user --ssl encrypted|verified|disabled [--ca arquivo.pem] --yes`.
- `setup` cria as tabelas, a organização (nome e fuso) e o primeiro administrador, com **senha temporária exibida uma
  única vez** (72 h). Não há usuário padrão.
- Guarde uma cópia do `backend\.env` no cofre: a `DATA_HUB_SECRET_KEY` decifra as senhas dos bancos externos.
- Aviso de `cpu-features` no `install:all` é inofensivo (opcional). `npm.ps1 não pode ser carregado` → use `npm.cmd`.

## 5. Publicar pelo IIS

```powershell
Get-ChildItem Cert:\LocalMachine\My | Format-Table Subject, Thumbprint, NotAfter
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\iis\configurar-iis.ps1 -Porta 443 -Https -CertificadoThumbprint IMPRESSAO-DIGITAL -NomeDoHost inia.empresa.local -AbrirFirewall
```

Sem HTTPS (rede interna): `… configurar-iis.ps1 -Porta 8080 -AbrirFirewall`. O script
([deploy/windows/iis/configurar-iis.ps1](../../deploy/windows/iis/configurar-iis.ps1)) confere IIS/URL Rewrite/ARR/
ferramentas, liga o proxy do ARR (tempo-limite 5 min, `responseBufferLimit` 0 — o chat chega em fluxo), grava o
[web.config](../../deploy/windows/iis/web.config) em `C:\inia-iis`, cria o pool e o site **INIA** (para se outro site
usa a porta), liga o certificado e o firewall. Rodar de novo é seguro. Até os serviços subirem, o endereço dá
**502.3 Bad Gateway** (esperado).

## 6. Serviços do Windows

Baixe **WinSW-x64.exe** 2.12.0 (MIT, ~18 MB):
`https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe`

```powershell
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\servicos\instalar-servicos.ps1 -WinSW C:\inia-ferramentas\WinSW-x64.exe
```

Opções: `-ProxyInternet http://proxy:8080` (com `NODE_USE_ENV_PROXY=1` nos serviços da API e do processamento — os dois
chamam a IA), `-CertificadoRaiz C:\certificados\raiz-empresa.pem` (`NODE_EXTRA_CA_CERTS` — proxy que inspeciona HTTPS;
fica no serviço porque serviço do Windows não enxerga variável de sistema nova sem reiniciar o servidor),
`-ProcessoUnico` (formato antigo: um serviço INIA - API fazendo API + processamento), `-Remover`. Cria **INIA - API**
(`--role=api`), **INIA - Processamento** (`--role=worker`) e **INIA - Interface** (início automático atrasado, reinício em
falha 10 s/30 s, registros em `C:\inia\logs` rodando a cada 10 MB × 8, conta Sistema Local) e espera o `/health` da API e
o do processamento (`http://127.0.0.1:3334/health`, porta `WORKER_HEALTH_PORT` do `backend\.env`) responderem. Script:
[deploy/windows/servicos/instalar-servicos.ps1](../../deploy/windows/servicos/instalar-servicos.ps1).

**Por que dois serviços no backend:** o processamento (Workflows de monitoria/indicador, que esperam minutos pela IA) roda
num processo próprio e não divide o processador com as telas. As tarefas periódicas (agenda, Central de Dados, calendário,
entregas) usam uma trava no banco: com 2+ processos de processamento, cada rodada acontece em um só. O processamento
reinicia sem derrubar a API (e vice-versa); uma execução interrompida é retomada sozinha quando a posse dela vence.

**Capacidade de IA** (`backend\.env`, ver comentários do `.env.example`): cada processo tem um limitador de chamadas —
`INIA_AI_MAX_CONCURRENT_CALLS` (padrão 16) chamadas ao provedor ao mesmo tempo, das quais
`INIA_AI_RESERVED_INTERACTIVE_CALLS` (padrão 4) só para chat/voz/telas. Com os serviços separados, a API só tem chamadas
interativas e o processamento só lote (até 16 − 4 = 12 simultâneas). Os dois usam a mesma chave do Gemini: some o que cada
processo pode usar e mantenha abaixo da cota da chave. Se o provedor responder "limite de requisições" (429), o
processamento espera o tempo pedido e tenta de novo; o chat tenta uma vez a mais e, persistindo, mostra uma mensagem clara.

## 7. Primeiro acesso

1. `https://inia.empresa.local/health` → `{"status":"ok"}`.
2. Administrador entra com o e-mail do `setup` e a senha temporária e cria a própria senha (IT-INIA-002).
3. IA: `GEMINI_API_KEY=` no `C:\inia\backend\.env` e `Restart-Service INIA-API, INIA-Processamento`.
4. **Administração › Central de Dados › Conectar banco de dados** → SQL Server → Conexão → Testar conexão → tabela ou
   visão → conjunto de dados → amostra e mapeamento → validar e ativar.

## Rotina

```powershell
Stop-Service INIA-Interface, INIA-API, INIA-Processamento
Start-Service INIA-Processamento, INIA-API, INIA-Interface
Restart-Service INIA-API, INIA-Processamento
```

Parar só o processamento (ex.: segurar um lote) não derruba as telas nem o chat: `Stop-Service INIA-Processamento`.

**Atualizar** (backup do banco antes; pare os serviços — o Windows trava arquivos em uso):

```powershell
cd C:\inia
Stop-Service INIA-Interface, INIA-API, INIA-Processamento
git pull
npm run install:all
npm run update
npm run build
Start-Service INIA-Processamento, INIA-API, INIA-Interface
```

**Trocar endereço / passar para HTTPS:** `node scripts\install\env-init.mjs --public-url https://…` → parar serviços,
`npm run build`, iniciar → `configurar-iis.ps1` com porta/certificado/nome novos. **Trocar o PostgreSQL ou a senha:**
`npm run db:connect` e `Restart-Service INIA-API, INIA-Processamento`. **Sem internet no servidor:** prepare `C:\inia` (até o `build`) numa
máquina Windows x64 com o mesmo Node.js e copie a pasta.

**Instalação existente (dois serviços, de antes da separação):** depois de `npm run update` e `npm run build`, rode de
novo o `instalar-servicos.ps1` com as mesmas opções — ele remove os serviços antigos e cria os três. A migration 122
(trava das tarefas periódicas) entra no `npm run update`.

**Depois da POC:** a montagem já é a de produção. Para mover o banco: `pg_dump` no atual, `pg_restore` no novo (banco
vazio, mesmo dono) e `npm run db:connect`.

## O que já foi testado

| Item | Situação |
| --- | --- |
| Instalação do zero, `db:connect` com SSL obrigatório e dono sem superusuário | Testado |
| PostgreSQL 15 e 17 (migrations, referência, massa demo, provas de banco) | Testado — mesmo resultado |
| Endereço único com proxy na frente e API/interface só em 127.0.0.1 | Testado com proxy equivalente ao IIS |
| API e processamento em processos separados (`--role=api` / `--role=worker`, dois processamentos ao mesmo tempo) | Testado em macOS — tarefas periódicas uma vez por rodada no conjunto, desligamento limpo |
| `configurar-iis.ps1`, `instalar-servicos.ps1` (três serviços) | Sintaxe conferida (PowerShell 7); **não executados num Windows Server** |
| SQL Server real; voz atrás do IIS | **Não validados** |
