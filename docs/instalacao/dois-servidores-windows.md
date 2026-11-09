# INIA em dois servidores (Windows Server): aplicação de um lado, dados do outro

Montagem para quando a empresa separa a **área de aplicação** (onde a INIA roda) da **área de dados** (onde os dados
ficam). É a mesma arquitetura de produção — só muda onde cada peça está.

> Versão para imprimir e distribuir às áreas, com figuras: **IT-INIA-003** em
> [docs/manuais](../manuais/) (`.docx` e `.pdf`). Este arquivo é o resumo técnico do mesmo procedimento.
> Ensaio desta montagem em duas VMs da Azure (conta gratuita): [homologacao-azure.md](homologacao-azure.md).
> Roteiro com as telas para a VM da empresa: **IT-INIA-013**, também em [docs/manuais](../manuais/).

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
o resto para a interface — cada um por uma **web farm** do ARR, com uma ou mais instâncias (seção 8). A INIA não roda
sobre SQL Server: o banco interno é sempre PostgreSQL, e o SQL Server só é lido.

**Ordem:** 1) área de dados: PostgreSQL · 2) área de dados: login de leitura no SQL Server · 3) infraestrutura:
preparar o Windows · 4) instalar a INIA · 5) IIS · 6) serviços · 7) primeiro acesso. Os passos 1, 2 e 3 podem ser
feitos ao mesmo tempo.

**HTTP ou HTTPS:** com `https://` a INIA roda em produção (cookie seguro) e a voz funciona. Com `http://` (só rede
interna) login e telas funcionam, mas o navegador **bloqueia o microfone** e nada é criptografado.

**Firewall:** usuários → porta pública do servidor da aplicação; servidor da aplicação → 5432 e 1433 da área de dados;
servidor da aplicação → internet 443 (`generativelanguage.googleapis.com`, `registry.npmjs.org`, `github.com` e, porque o
`npm run build` baixa as fontes da interface e para com erro sem elas, `fonts.googleapis.com` e `fonts.gstatic.com`);
navegador dos usuários → `generativelanguage.googleapis.com` 443 (voz). **Não abra 3000, 3333 nem 3334** (nem as portas
das instâncias extras: tudo escuta só em endereços 127.0.0.x).

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
- **Conexões e memória:** ajuste `max_connections`, `shared_buffers` e `work_mem` pelo número de instâncias da INIA — ver
  a seção 8 ("PostgreSQL para várias instâncias"). Com uma API e um processamento, os padrões do instalador bastam.
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
ou certificado no SQL Server. **Validado contra um SQL Server real em 15/10/2026** (SQL Server 2019 Developer
15.0.2000.5 no Windows Server 2016 da homologação na Azure): "Obrigatória (sem validar certificado)" conectou com
tráfego cifrado, e as 7 cargas do roteiro [primeiro-feedback-exemplo](primeiro-feedback-exemplo/README.md) concluíram
sem rejeição. Na homologação o SQL Server ficou **na mesma máquina** da INIA: em produção a política de saída recusa o
próprio servidor (`DATA_SOURCE_DESTINATION_DENIED`, "loopback só com liberação explícita"), e foi preciso
`INIA_OUTBOUND_ALLOWED_DESTINATIONS=127.0.0.1:1433` no `backend/.env` e reiniciar a API e o Processamento. Com o SQL
Server em outra máquina da rede (o caso da POC) nada disso é necessário.

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
ferramentas, liga o proxy do ARR (tempo-limite 5 min, `responseBufferLimit` 0 — o chat chega em fluxo —, IP do cliente
**sem a porta** no `X-Forwarded-For`), cria as web farms **INIA-API** e **INIA-Interface** (health check em `/ready` da
API e `/healthz` da interface a cada 3 s; balanceamento por menos requisições em andamento), grava o
[web.config](../../deploy/windows/iis/web.config) em `C:\inia-iis`, cria o pool e o site **INIA** (para se outro site
usa a porta), liga o certificado e o firewall. Rodar de novo é seguro (as web farms da INIA são recriadas). Até os
serviços subirem, o endereço dá **502.3 Bad Gateway** (esperado). Várias instâncias: `-InstanciasApi N
-InstanciasInterface N` (seção 8).

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
falha 10 s/30 s, registros em `C:\inia\logs` rodando a cada 10 MB × 8, conta Sistema Local, 30 s para parar) e espera o
`/ready` da API, o `/health` do processamento (`http://127.0.0.1:3334/health`, porta `WORKER_HEALTH_PORT` do
`backend\.env`) e o `/healthz` da interface responderem. Várias instâncias, cota de IA e pool por papel: seção 8. Script:
[deploy/windows/servicos/instalar-servicos.ps1](../../deploy/windows/servicos/instalar-servicos.ps1).

**Por que dois serviços no backend:** o processamento (Workflows de monitoria/indicador, que esperam minutos pela IA) roda
num processo próprio e não divide o processador com as telas. As tarefas periódicas (agenda, Central de Dados, calendário,
entregas) usam uma trava no banco: com 2+ processos de processamento, cada rodada acontece em um só. O processamento
reinicia sem derrubar a API (e vice-versa); uma execução interrompida é retomada sozinha quando a posse dela vence.

**Capacidade de IA:** o limite do provedor é da **conexão** (Administração › IA › Provedores › conexão › **Chamadas
simultâneas** — o limite por acesso que o provedor informar), dividido por todas as instâncias da INIA; um quarto fica
reservado para chat e voz. Se o provedor responder "limite de requisições" (429), aquela conexão pausa os lotes em **todas**
as instâncias pelo tempo pedido (o chat nunca é pausado; tenta uma vez a mais e, persistindo, mostra uma mensagem clara). Além
disso cada processo tem um limitador local (`INIA_AI_MAX_CONCURRENT_CALLS`, padrão 16, das quais
`INIA_AI_RESERVED_INTERACTIVE_CALLS` = 4 só para chat/voz/telas) — proteção do próprio processo, não a cota do provedor.

## 7. Primeiro acesso

1. `https://inia.empresa.local/health` → `{"status":"ok"}`. Na própria máquina, `http://127.0.0.1:3333/ready` →
   `{"status":"ready"}` (banco respondendo).
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

**Instalação existente (um serviço por papel, de antes da web farm):** depois de `npm run update` (aplica as migrations
126 e 127) e `npm run build`, rode de novo `configurar-iis.ps1` (cria as web farms; com uma instância o comportamento é o
mesmo) e, se quiser várias instâncias, `instalar-servicos.ps1` com os números (seção 8). No `backend\.env`, troque
`LOGIN_RATE_LIMIT_PER_IP=30` por `200` (agora conta só as recusas por IP) e acrescente `LOGIN_RATE_LIMIT_PER_IP_EMAIL=20`.

**Depois da POC:** a montagem já é a de produção. Para mover o banco: `pg_dump` no atual, `pg_restore` no novo (banco
vazio, mesmo dono) e `npm run db:connect`.

## 8. Várias instâncias (web farm) — muitos usuários simultâneos

Um processo Node usa ~1 núcleo. No teste de carga de 08/10/2026 (Mac M5, IA falsa com a latência real), 100 usuários levaram
a API a 0,4 núcleo no pico — 600 simultâneos não cabem num processo só (extrapolação, não medido). A INIA roda **N APIs,
N interfaces e M processamentos** na mesma máquina (ou, com o IIS na frente, em mais de uma):

```powershell
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\servicos\instalar-servicos.ps1 -WinSW C:\inia-ferramentas\WinSW-x64.exe -InstanciasApi 3 -InstanciasInterface 2 -InstanciasProcessamento 2 -PoolApi 25 -PoolProcessamento 25
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\iis\configurar-iis.ps1 -Porta 443 -Https -CertificadoThumbprint IMPRESSAO-DIGITAL -NomeDoHost inia.empresa.local -InstanciasApi 3 -InstanciasInterface 2
```

- **Endereços:** a instância *i* da API escuta em `127.0.0.i:3333` e a da interface em `127.0.0.i:3000` (o ARR identifica o
  servidor da farm pelo endereço, sem a porta — `127.0.0.1:3333` e `127.0.0.1:3335` seriam "o mesmo"; todo o 127.0.0.0/8 é
  loopback no Windows). O processamento *j* expõe `/health` em `127.0.0.1:3334 + j − 1`. Os serviços: INIA-API, INIA-API-2…,
  INIA-Processamento, INIA-Processamento-2…, INIA-Interface, INIA-Interface-2… (a primeira instância mantém o nome antigo).
- **Quantas:** some as instâncias até perto do número de núcleos livres (ex.: 8 vCPUs → 3 APIs + 2 interfaces + 2
  processamentos). Memória medida por processo: API até ~0,9 GB, interface até ~0,2 GB.
- **O que vale para o conjunto fica no PostgreSQL:** limites de login e de IA por conta (migration 126), vagas e pausa de
  cada conexão de IA (migrations 127 e 135), tarefas periódicas (trava no banco, uma rodada por intervalo), fila de Workflows e
  da Central de Dados (posse com `skip locked`); a API acorda o processamento por `NOTIFY` quando entra uma carga da Central.
  Nenhum estado de sessão fica no processo: não precisa de afinidade ("sticky session").
- **Login atrás de Citrix/VDI/NAT:** o limite conta por IP **+ e-mail** (`LOGIN_RATE_LIMIT_PER_IP_EMAIL`, 20 por 5 min) e,
  por IP, só as tentativas **recusadas** (`LOGIN_RATE_LIMIT_PER_IP`, 200 por 5 min). Com o IIS na mesma máquina,
  `TRUST_PROXY=loopback`; IIS em outra máquina ou mais de um proxy no caminho: os IPs de todos eles
  ([configuracao-segura.md](../security/configuracao-segura.md)).
- **Saúde e parada:** o ARR consulta `/ready` de cada API a cada 3 s (503 = banco fora ou desligando → sai da farm). Ao parar
  um serviço, a API sai da prontidão, espera 5 s (`INIA_SHUTDOWN_DRAIN_MS`), para de aceitar conexões e tem até 25 s
  (`INIA_SHUTDOWN_TIMEOUT_MS`) para terminar — reinicie uma instância por vez e ninguém perde a tela.
- **Métricas:** `http://127.0.0.i:3333/internal/metrics` (só na própria máquina; o IIS devolve 404 para `/internal`) —
  atraso do event loop, conexões do pool (inclusive quantas requisições **esperam** conexão), latência por rota (p50/p95/p99)
  e o limitador de IA; no processamento, o mesmo em `/health`. `INIA_METRICS_TOKEN` exige também um token.

### Vagas de IA: por conexão (em todas as instâncias) e por processo

- **Por conexão — o que importa para o provedor:** em Administração › IA › Provedores, cada conexão tem **Chamadas
  simultâneas**: quantas chamadas aquele acesso aceita ao mesmo tempo, **somando todas as instâncias** (APIs e
  processamentos). Use o limite por acesso que o provedor informar; em branco = sem limite próprio. Um quarto das vagas fica
  reservado para chat e voz (o lote nunca as ocupa). Um 429 daquela conexão pausa os lotes dela em todas as instâncias; numa
  política com cadeia de modelos, o lote passa direto para o próximo.
- **Por processo — proteção local:** `-CotaIaApi` e `-CotaIaProcessamento` gravam `INIA_AI_MAX_CONCURRENT_CALLS` em cada serviço
  (no processamento, também `INIA_AI_RESERVED_INTERACTIVE_CALLS=1`: lá não há chat). Limita a memória e o event loop de cada
  processo; não precisa somar com a cota do provedor (isso é da conexão).

### PostgreSQL para várias instâncias

**Conexões.** Cada instância tem o próprio pool (`DATABASE_POOL_MAX`, padrão 20; `-PoolApi`/`-PoolProcessamento` no
instalador). O processamento usa até `WORKFLOW_WORKER_CONCURRENCY` (8) conexões nas execuções e, nas tarefas periódicas, só
o tempo de cada consulta; fora do pool, mais 2: uma para as travas de todas as tarefas periódicas (`inia-worker:locks` em
`pg_stat_activity`) e uma para ouvir os avisos da Central de Dados. A API usa conexões por requisição (curtas) — no teste de
08/10 um processo único com 100 usuários chegou a 43 conexões (teto 40).

| Papel | `DATABASE_POOL_MAX` sugerido | Observação |
| --- | --- | --- |
| API (cada instância) | 25 | Suba se `/internal/metrics` mostrar `pool.waiting` > 0 com frequência |
| Processamento (cada instância) | 25 | ≥ `WORKFLOW_WORKER_CONCURRENCY` + 8 |
| Interface | — | Não conecta ao banco |

`max_connections` ≥ soma dos pools + 2 por processamento (travas das tarefas periódicas e aviso da Central; num processo
único, papel `all`, só a das travas) + ~15 de manutenção (backup, psql, `superuser_reserved_connections`). Exemplo com 3 APIs e
2 processamentos: 3 × 25 + 2 × 25 + 4 + 15 = 144 → **200**.
Acima de ~300 conexões, considere um PgBouncer (modo *session*: a INIA usa `LISTEN` e travas consultivas de sessão).

**Memória** (exemplo: servidor de dados com 16 GB, SSD, só PostgreSQL; reinício do serviço para `max_connections` e
`shared_buffers`):

| Parâmetro | Linux | Windows | Por quê |
| --- | --- | --- | --- |
| `max_connections` | 200 | 200 | Soma dos pools + folga (acima) |
| `shared_buffers` | 4GB (~25% da RAM) | 512MB | No Windows valores grandes rendem menos; a faixa útil citada pela EDB (e por versões antigas da documentação do PostgreSQL) é 64MB–512MB — o cache do sistema operacional faz o resto. Mais de 40% da RAM raramente ajuda em qualquer sistema |
| `effective_cache_size` | 12GB | 12GB | ~75% da RAM: só informa o planejador |
| `work_mem` | 16MB | 16MB | Por ordenação/hash, por conexão: (RAM − `shared_buffers`) ÷ (`max_connections` × 3) ≈ 16–20MB. Nunca centenas de MB: 200 conexões × várias operações estouram a memória |
| `maintenance_work_mem` | 1GB | 512MB | VACUUM e criação de índice |
| `random_page_cost` | 1.1 | 1.1 | Disco SSD |
| `max_wal_size` | 4GB | 4GB | Menos checkpoints durante as cargas da Central de Dados |
| `idle_in_transaction_session_timeout` | 5min | 5min | Uma conexão esquecida em transação não segura travas |
| `log_min_duration_statement` | 1000 | 1000 | Registra consultas acima de 1 s |
| `effective_io_concurrency` | 200 | não configure | No Windows o PostgreSQL não usa e recusa valor diferente de 0 |

Confira depois: `select count(*) from pg_stat_activity where datname = 'inia';` perto do pico (deve ficar bem abaixo de
`max_connections`) e o `pool.waiting` de cada API em `/internal/metrics`.

## O que já foi testado

| Item | Situação |
| --- | --- |
| Instalação do zero, `db:connect` com SSL obrigatório e dono sem superusuário | Testado |
| PostgreSQL 15 e 17 (migrations, referência, massa demo, provas de banco) | Testado — mesmo resultado |
| Endereço único com proxy na frente e API/interface só em 127.0.0.1 | Testado com proxy equivalente ao IIS |
| API e processamento em processos separados (`--role=api` / `--role=worker`, dois processamentos ao mesmo tempo) | Testado em macOS — tarefas periódicas uma vez por rodada no conjunto, desligamento limpo |
| `configurar-iis.ps1`, `instalar-servicos.ps1` (três serviços) | **Executados num Windows Server 2016 real em 14/10/2026** (homologação na Azure, uma VM, PostgreSQL 15.19 local): IIS + URL Rewrite 2.1 + ARR 3.0 (requestRouter 7.1.05311), HTTPS com certificado do Let's Encrypt, três serviços WinSW no ar e `https://…/health` respondendo de fora. Corrigido no ensaio: o atributo do ARR é `includePortInXForwardedFor` (o script usava `includePortInXFF`, que não existe) |
| Web farm (N APIs/interfaces, M processamentos), health check do ARR, X-Forwarded-For sem porta | Web farm com **uma** instância de cada papel executada no Windows (14/10/2026, health check `/ready` e `/healthz`); **N instâncias ainda não executadas**. Na API: dois processos reais dividindo limite de login e pausa de IA (prova automatizada), `/ready`, desligamento com prazo e IP com porta tratado — testados em macOS |
| SQL Server real | **Validado em 15/10/2026** (homologação na Azure): SQL Server 2019 Developer no Windows Server 2016, conexão cifrada pela Central de Dados e as 7 cargas do primeiro feedback concluídas (1, 2, 30, 1, 560, 56 e 288 recebidos, 0 rejeitados). SQL Server na mesma máquina exige `INIA_OUTBOUND_ALLOWED_DESTINATIONS`; em outra máquina, não |
| Voz atrás do IIS | **Não validada** |
