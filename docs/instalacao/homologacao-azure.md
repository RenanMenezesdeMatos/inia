# Homologação na Azure (conta gratuita): ensaio da instalação em dois servidores Windows

Ensaio completo da montagem da POC — servidor da aplicação de um lado, dados do outro — em duas máquinas virtuais
Windows Server 2016 da Azure, pagas pelo crédito da conta gratuita (US$ 200 por 30 dias). O objetivo é executar pela
primeira vez num Windows de verdade o que até hoje só teve a sintaxe conferida (tabela "O que já foi testado" de
[dois-servidores-windows.md](dois-servidores-windows.md)):

- `configurar-iis.ps1` e as web farms do ARR;
- `instalar-servicos.ps1` com os três serviços (API, Processamento, Interface) e o WinSW;
- a voz e o chat em fluxo atrás do IIS, com HTTPS de verdade;
- um SQL Server real lido pela Central de Dados;
- a IT-INIA-004 seguida do jeito que um leigo seguiria.

Os passos de instalação são os da **IT-INIA-004** (versão guiada) e de [dois-servidores-windows.md](dois-servidores-windows.md)
(referência técnica). Este roteiro diz só **o que muda na Azure**, o que observar e como registrar o que der errado.
Escrito em 14/10/2026 sem executar nada na Azure: os links de download e os nomes dos instaladores foram conferidos nesse
dia; os preços vêm da API oficial de preços da Azure.

---

## 0. Antes de tudo: custo zero, com disciplina

**Regras que não se quebram:**

1. A conta gratuita tem **limite de gastos ligado**: quando o crédito acaba ou os 30 dias passam, a Azure **desativa** a
   assinatura em vez de cobrar. **Nunca** clique em "Atualizar" / "Upgrade" para pagamento conforme o uso nem em
   "Remover limite de gastos" — é isso que passaria a cobrar no cartão.
2. A conta gratuita só permite **4 vCPUs no total por região**, sem aumento. Por isso a montagem é de exatamente duas VMs
   de 2 vCPUs.
3. **Desligue as VMs quando não estiver usando** (botão *Parar* no portal = desalocar: o processamento para de cobrar;
   disco e IP continuam). O desligamento automático diário fica configurado na criação (seção 3).
4. No fim, **apague o grupo de recursos inteiro** (seção 13).

**Quanto custa** (Brazil South, Windows, preços de lista em 14/10/2026):

| Item | Preço | 30 dias ligado 24 h | 30 dias ligado 12 h/dia |
| --- | --- | --- | --- |
| `inia-app` — Standard_B2as_v2 (2 vCPUs, 8 GB) | US$ 0,130/h | US$ 94 | US$ 47 |
| `inia-dados` — Standard_B2als_v2 (2 vCPUs, 4 GB) | US$ 0,0697/h | US$ 50 | US$ 25 |
| 2 discos Standard SSD 128 GB (E10) | US$ 17,92/mês cada | US$ 36 | US$ 36 |
| 2 IPs públicos estáticos (Standard) | US$ 0,005/h cada | US$ 7 | US$ 7 |
| **Total** | | **~US$ 187** | **~US$ 115** |

Cabe nos US$ 200 mesmo ligado o tempo todo, mas com pouca folga: use o desligamento automático. Se a Brazil South não
estiver liberada para a conta gratuita (ou faltar capacidade), use **East US 2**: o processamento sai ~35% mais barato
e a latência do Brasil (~120 ms) não atrapalha a homologação.

O **Gemini** é cobrado à parte, na conta Google da chave — fora deste orçamento. Crie uma chave **só para a
homologação** (fácil de revogar no fim) e siga os cuidados de custo da IT-INIA-005, seção 17. Deixe todos os Workflows
no gatilho **Manual** até o fim da seção 11: uma única carga da Central de Dados dispara todos os Workflows daquela flag.

---

## 1. A montagem

| VM | Faz o papel de | Tamanho | O que roda |
| --- | --- | --- | --- |
| `inia-app` | Servidor da aplicação | Standard_B2as_v2 — 2 vCPUs, 8 GB | IIS (URL Rewrite + ARR), Node.js 24, serviços INIA - API / Processamento / Interface |
| `inia-dados` | Área de dados | Standard_B2als_v2 — 2 vCPUs, 4 GB | PostgreSQL 15 (banco interno) e SQL Server 2022 Developer (dados de "cliente", só leitura) |

As duas na mesma rede virtual. As pessoas acessam só o `inia-app`, pelo nome gratuito da Azure
(`inia-homolog-<algo>.brazilsouth.cloudapp.azure.com`), com certificado do Let's Encrypt. As portas 5432 e 1433 do
`inia-dados` só aceitam o IP privado do `inia-app` — a mesma regra da IT-INIA-004, Etapa B.

As duas VMs são **Windows Server 2016**, o mínimo que a INIA aceita e a versão do servidor da empresa: o que funcionar
aqui funciona nos mais novos.

Você faz todos os papéis da IT-INIA-004 (projeto, banco, rede, servidor e administrador). Ficha da instalação (IT-INIA-004,
seção 4) já preenchida para a Azure:

| # | Informação | Valor na homologação |
| --- | --- | --- |
| 1 | Endereço da INIA | `https://inia-homolog-<algo>.brazilsouth.cloudapp.azure.com` (seção 3) |
| 2 | Porta pública | 443 |
| 3 | Nome e IP do servidor da aplicação | `inia-app`; IP **privado** (ex.: 10.0.0.4) — é esse que entra nas regras do banco |
| 4 | Versão do Windows | Windows Server 2016 Datacenter (10.0.14393) |
| 5 | PostgreSQL | IP privado do `inia-dados` (ex.: 10.0.0.5), 5432, banco `inia`, usuário `inia_app` |
| 6 | SSL no PostgreSQL | Sim, com certificado autoassinado (seção 5.2) — ou Não, se pular essa parte |
| 7 | SQL Server | IP privado do `inia-dados`, 1433, banco `inia_exemplo`, usuário `inia_leitura` |
| 8–9 | Proxy | Não há |
| 10 | Repositório | `https://github.com/RenanMenezesdeMatos/inia` (privado; acesso pelo `gh`, seção 8) |
| 11 | Organização e fuso | "INIA Homologação", `America/Sao_Paulo` |
| 12 | Primeiro administrador | Você (nome e e-mail) |
| 13 | Cofre | Senhas das VMs, do banco, do `sa`, `backend\.env` e chave do Gemini no seu gerenciador de senhas |

---

## 2. Antes de começar (no Mac)

1. **Atualize o código no GitHub.** O snapshot de lá é de 13/10 às 18:37 e ainda não tem a última versão dos scripts de
   `deploy/windows` (commits de 13/10 à noite). O `npm run github:publish` exige a árvore de trabalho limpa: faça o
   commit (ou guarde) as alterações em andamento e rode:

   ```bash
   npm run github:publish -- --verificar
   ```

2. **Crie a pasta de troca** com o Windows: `~/inia-homolog`. É por ela que os arquivos vão do Mac para as VMs
   (redirecionamento de pasta do aplicativo de área de trabalho remota, seção 4). Copie para ela o script dos dados de
   exemplo:

   ```bash
   mkdir -p ~/inia-homolog && cp docker/external-examples/sqlserver/init.sql ~/inia-homolog/
   ```

3. Instale o **Windows App** (Microsoft, na App Store do Mac): é o cliente de área de trabalho remota.

---

## 3. Conta, grupo de recursos e as duas VMs (portal da Azure)

### 3.1 Conta e controle de gastos

1. `azure.microsoft.com/free` → **Comece gratuitamente**. Pede conta Microsoft, telefone e cartão (a Azure faz uma
   autorização temporária de US$ 1, estornada). Uma conta gratuita por pessoa.
2. **Grupos de recursos** → Criar → `rg-inia-homolog`, região **Brazil South**.
3. **Gerenciamento de Custos** → **Orçamentos** → Adicionar: escopo `rg-inia-homolog`, valor US$ 150, alertas por e-mail em
   50%, 80% e 100%. O alerta não desliga nada; o limite de gastos da conta é que impede cobrança.

### 3.2 Criar a `inia-app`

**Máquinas virtuais** → Criar → Máquina virtual do Azure:

| Campo | Valor |
| --- | --- |
| Grupo de recursos | `rg-inia-homolog` |
| Nome | `inia-app` |
| Região | Brazil South (ou East US 2, seção 0) |
| Opções de disponibilidade | Nenhuma redundância de infraestrutura necessária |
| Tipo de segurança | Padrão sugerido (Inicialização Confiável). Se a criação recusar, troque para Padrão |
| Imagem | **Windows Server 2016 Datacenter - x64 Gen2** (em "Ver todas as imagens", se não estiver na lista) |
| Desconto do Azure Spot | Desmarcado |
| Tamanho | **Standard_B2as_v2** (sem estoque: Standard_B2s_v2, US$ 0,144/h) |
| Usuário / senha | `iniaadmin` (a Azure não aceita "admin") + senha forte, no cofre |
| Portas de entrada públicas | **Nenhuma** (as regras certas entram na 3.4) |
| Licenciamento (licença existente do Windows) | **Não** marcar |
| Disco › Tipo do disco do SO | **SSD Standard (LRS)** — o Premium custa o dobro |
| Rede | Rede virtual nova `vnet-inia-homolog`; sub-rede padrão; IP público novo |
| Gerenciamento › Desligamento automático | **Ligado**, 23:00, fuso (UTC-03:00) Brasília, aviso por e-mail |

Revisar + criar → Criar.

### 3.3 Criar a `inia-dados`

Igual à `inia-app`, mudando: nome `inia-dados`, tamanho **Standard_B2als_v2** (sem estoque: Standard_B2ls_v2), **mesma
rede virtual** `vnet-inia-homolog`. Ela também ganha IP público: sem ele, numa rede virtual nova, a VM pode não ter
saída para a internet (e precisa baixar os instaladores) — a proteção fica nas regras abaixo.

Anote os **IPs privados** das duas (VM › Rede), normalmente 10.0.0.4 (`inia-app`) e 10.0.0.5 (`inia-dados`).

### 3.4 Nome DNS e portas

1. **IP público da `inia-app`** → Configuração → **Rótulo do nome DNS**: `inia-homolog-<algo>` (único na região) → Salvar.
   O endereço da INIA passa a ser `inia-homolog-<algo>.brazilsouth.cloudapp.azure.com`. O IP Standard é estático:
   o nome continua valendo depois de desligar e ligar a VM.
2. **Grupo de segurança de rede da `inia-app`** (VM › Rede › Configurações de rede) → regras de entrada:

   | Porta | Origem | Para quê |
   | --- | --- | --- |
   | 3389 (RDP) | **Meu endereço IP** | Área de trabalho remota, só do seu Mac |
   | 80 | Qualquer | Validação do Let's Encrypt (seção 7) |
   | 443 | Qualquer | A INIA |

3. **Grupo de segurança de rede da `inia-dados`**: só **3389 a partir do Meu endereço IP**. Nada de 5432 ou 1433 para a
   internet. O tráfego entre as duas VMs passa por dentro da rede virtual (a regra padrão `AllowVnetInBound` deixa); quem
   restringe ao `inia-app` é o firewall do Windows, como na empresa.

O IP de casa costuma mudar. Se o RDP parar de conectar, atualize a origem da regra 3389.

---

## 4. Entrar nas VMs e preparar as duas

1. **Windows App** → Adicionar PC: o IP público da VM, usuário `iniaadmin`. Em **Pastas**, redirecione `~/inia-homolog`:
   dentro da VM, ela aparece como `\\tsclient\inia-homolog`.
2. A área de transferência funciona: copie os comandos deste arquivo no Mac e cole na VM. O teclado ABNT2 do Mac pode
   trocar símbolos (`\`, `|`, `/`) na VM: na dúvida, cole em vez de digitar.
3. Em cada VM, num **PowerShell como administrador**:

   ```powershell
   tzutil /s "E. South America Standard Time"
   ```

4. Se o **Windows Update** começar a instalar na primeira vez que a VM liga (comum na imagem 2016), espere terminar e
   reinicie **antes** de instalar qualquer coisa: no meio de um `npm run build` ele reinicia sozinho.

**Downloads no Windows Server 2016:** o navegador é o Internet Explorer com a Configuração de Segurança Reforçada, que
bloqueia quase tudo, e o PowerShell 5.1 não usa TLS 1.2 por padrão (os downloads falham com "Não foi possível criar um
canal seguro SSL/TLS"). Os blocos deste roteiro baixam pelo PowerShell com TLS 1.2. **Anote o atrito no registro
(seção 12):** a IT-INIA-004 manda "baixar" sem dizer como, e o servidor da empresa provavelmente tem o mesmo bloqueio.

---

## 5. `inia-dados` — Etapa B da IT-INIA-004

### 5.1 PostgreSQL 15

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force C:\instaladores | Out-Null
Invoke-WebRequest https://get.enterprisedb.com/postgresql/postgresql-15.19-1-windows-x64.exe -OutFile C:\instaladores\postgresql-15-x64.exe -UseBasicParsing
```

15.19 é a mais recente da linha 15 em 14/10/2026. Se der 404, troque pelo link do 15.x mais novo da página de downloads
da EDB. Depois siga a **IT-INIA-004, B.1 a B.3**, sem mudar nada, com `IP-DO-SERVIDOR-DA-APLICACAO` = IP privado da `inia-app`.

### 5.2 SSL no PostgreSQL (recomendado)

Ensaia a conexão criptografada com usuário dono sem superusuário, a mesma da empresa. No Mac:

```bash
cd ~/inia-homolog && openssl req -new -x509 -days 60 -nodes -subj "/CN=inia-dados" -keyout server.key -out server.crt
```

Na `inia-dados`:

```powershell
Copy-Item \\tsclient\inia-homolog\server.crt, \\tsclient\inia-homolog\server.key "C:\Program Files\PostgreSQL\15\data\"
notepad "C:\Program Files\PostgreSQL\15\data\postgresql.conf"
```

No `postgresql.conf`: `ssl = on`, `ssl_cert_file = 'server.crt'`, `ssl_key_file = 'server.key'`. No `pg_hba.conf`, troque
`host` por `hostssl` na linha da INIA. Reinicie (`net stop postgresql-x64-15` e `net start postgresql-x64-15`). No
`db:connect` (seção 8), a criptografia é a opção **1** (criptografada sem conferir).

### 5.3 SQL Server 2022 Developer — o "banco do cliente"

Valida a linha "SQL Server real: **não validado**". A edição Developer é gratuita para desenvolvimento e teste, com o
mesmo motor do Standard. A 2022 é a mais nova que roda no Windows Server 2016. O link curto da Express 2022 está
quebrado: ele redireciona para uma página 404.

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest https://aka.ms/sqlserver2022developer -OutFile C:\instaladores\SQL2022-SSEI-Dev.exe -UseBasicParsing
Start-Process C:\instaladores\SQL2022-SSEI-Dev.exe
```

1. Escolha **Personalizado** (Custom). O "Básico" só aceita login do Windows e a INIA precisa de usuário e senha do SQL Server.
2. Se o instalador pedir um .NET Framework mais novo: `https://go.microsoft.com/fwlink/?linkid=2088631` (.NET Framework
   4.8), instale e reinicie.
3. Na Central de Instalação: **Nova instalação autônoma** → recursos: só **Serviços de Mecanismo de Banco de Dados** →
   **Instância padrão** → em Configuração do Mecanismo de Banco de Dados: **Modo misto**, senha do `sa` (cofre) e
   "Adicionar Usuário Atual".
4. **TCP/IP** (vem desligado): abra `SQLServerManager16.msc` → Configuração de Rede do SQL Server → Protocolos para
   MSSQLSERVER → TCP/IP → **Habilitado** → reinicie: `Restart-Service MSSQLSERVER`. A instância padrão usa a 1433.
5. Firewall, só para a `inia-app`:

   ```powershell
   New-NetFirewallRule -DisplayName "SQL Server - INIA" -Direction Inbound -Protocol TCP -LocalPort 1433 -RemoteAddress IP-PRIVADO-DA-INIA-APP -Action Allow
   ```

6. Dados de exemplo: o mesmo script do Docker. Traz o usuário somente leitura `inia_leitura` e tudo o que a IT-INIA-005
   precisa: 30 colaboradores com Grupo e subgrupo, meta, TMA diário, fechamento oficial de agosto e setembro e 288
   chamadas (as de setembro com transcrição) — ver [primeiro-feedback-exemplo](primeiro-feedback-exemplo/README.md).
   Ele pede a senha do `sa`; a senha do `inia_leitura` vai no `-v` e fica no cofre:

   ```powershell
   Copy-Item \\tsclient\inia-homolog\init.sql C:\instaladores\
   sqlcmd -S localhost -U sa -f 65001 -i C:\instaladores\init.sql -v READER_PASSWORD='SENHA-FORTE-DO-INIA_LEITURA'
   ```

   `-f 65001` faz o `sqlcmd` ler o arquivo como UTF-8 (sem ele, os acentos chegam trocados). Aspas simples no
   PowerShell, para um `$` na senha não ser trocado por variável. A senha não pode ter aspas: ela entra num texto SQL
   entre aspas simples. Rodar de novo só acrescenta o que falta.

   Se o `sqlcmd` não for reconhecido, baixe o `sqlcmd-windows-amd64.zip` em `github.com/microsoft/go-sqlcmd/releases`,
   extraia em `C:\instaladores\sqlcmd` e use `C:\instaladores\sqlcmd\sqlcmd.exe`.

7. Com 4 GB na VM, limite a memória do SQL Server para sobrar para o PostgreSQL:

   ```powershell
   sqlcmd -S localhost -U sa -Q "exec sp_configure 'show advanced options', 1; reconfigure; exec sp_configure 'max server memory (MB)', 1024; reconfigure;"
   ```

---

## 6. `inia-app` — Etapas A e D da IT-INIA-004

**Etapa A** como está na IT. No A.4, use o IP privado da `inia-dados` nos dois `Test-NetConnection`: os dois precisam dar
`TcpTestSucceeded : True` antes da Etapa E.

**Etapa D** com o atalho por PowerShell (mesmos programas e endereços oficiais da IT, mais o `gh` para o repositório
privado e o win-acme para o certificado):

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force C:\inia-ferramentas | Out-Null
Set-Location C:\inia-ferramentas
function Ultimo($repo, $padrao) { (Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing).assets | Where-Object name -like $padrao | Select-Object -First 1 -ExpandProperty browser_download_url }
$node = (Invoke-RestMethod https://nodejs.org/dist/index.json -UseBasicParsing | Where-Object version -like 'v24.*' | Select-Object -First 1).version
$baixar = [ordered]@{
  'vc_redist.x64.exe'       = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
  'node-x64.msi'            = "https://nodejs.org/dist/$node/node-$node-x64.msi"
  'git-64-bit.exe'          = Ultimo 'git-for-windows/git' 'Git-*-64-bit.exe'
  'gh.msi'                  = Ultimo 'cli/cli' 'gh_*_windows_amd64.msi'
  'rewrite_amd64_en-US.msi' = 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi'
  'requestRouter_amd64.msi' = 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi'
  'WinSW-x64.exe'           = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
  'win-acme.zip'            = Ultimo 'win-acme/win-acme' 'win-acme.*.x64.trimmed.zip'
}
foreach ($arquivo in $baixar.Keys) { Write-Host "baixando $arquivo"; Invoke-WebRequest $baixar[$arquivo] -OutFile $arquivo -UseBasicParsing }
```

Instalar, na ordem da IT (Node.js sem "Tools for Native Modules" — a instalação silenciosa não marca):

```powershell
Start-Process .\vc_redist.x64.exe -ArgumentList '/install /quiet /norestart' -Wait
Start-Process msiexec.exe -ArgumentList '/i node-x64.msi /qn' -Wait
Start-Process .\git-64-bit.exe -ArgumentList '/VERYSILENT /NORESTART' -Wait
Start-Process msiexec.exe -ArgumentList '/i gh.msi /qn' -Wait
Install-WindowsFeature Web-Server, Web-Mgmt-Console, Web-Scripting-Tools
Start-Process msiexec.exe -ArgumentList '/i rewrite_amd64_en-US.msi /qn' -Wait
Start-Process msiexec.exe -ArgumentList '/i requestRouter_amd64.msi /qn' -Wait
Expand-Archive win-acme.zip -DestinationPath C:\inia-ferramentas\win-acme -Force
```

Feche e abra de novo o terminal como administrador e faça o **D.2** da IT (`node --version` → v24…, `npm --version`,
`git --version`). O WinSW fica em `C:\inia-ferramentas\WinSW-x64.exe`. A IT-INIA-004 usa `C:\ferramentas` e o guia
técnico, `C:\inia-ferramentas`: os dois servem, mas registre a diferença.

---

## 7. Certificado HTTPS (é a Etapa C da IT, feita por você)

O Let's Encrypt valida pela porta 80. O win-acme, no modo `selfhosting`, atende só o caminho
`/.well-known/acme-challenge/` e divide a porta 80 com o IIS (via http.sys). Por isso o certificado sai antes de a INIA
existir, sem mexer no site. Troque o nome e o e-mail; `--accepttos` aceita os termos do Let's Encrypt:

```powershell
C:\inia-ferramentas\win-acme\wacs.exe --source manual --host inia-homolog-ALGO.brazilsouth.cloudapp.azure.com --validation selfhosting --store certificatestore --certificatestore My --installation none --emailaddress SEU-EMAIL --accepttos
dir Cert:\LocalMachine\My | ft Subject, Thumbprint, NotAfter
```

Guarde o **Thumbprint**. O certificado vale 90 dias, mais que a homologação. Com `--installation none`, a renovação
automática do win-acme gera um certificado novo, mas não troca a ligação do site: se a homologação virar ambiente
permanente, refaça com `--installation iis`. Se a validação falhar, confira a regra da porta 80 no grupo de segurança
(3.4) e se o nome resolve para o IP público (`Resolve-DnsName` no próprio servidor).

---

## 8. Código e Etapa E da IT-INIA-004

Acesso ao repositório privado sem deixar senha na VM:

```powershell
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
```

O `gh` mostra um código de 8 caracteres e tenta abrir o navegador da VM: ignore, abra `https://github.com/login/device`
**no Mac** e digite o código. Depois siga a **IT-INIA-004, E.1 a E.6**, no Prompt de Comando como administrador, com
estes valores:

| Passo | Na homologação |
| --- | --- |
| E.1 | `git clone https://github.com/RenanMenezesdeMatos/inia.git inia` |
| E.2 | `node scripts\install\env-init.mjs --own-postgres --public-url https://inia-homolog-ALGO.brazilsouth.cloudapp.azure.com` |
| E.3 | Servidor = IP privado da `inia-dados`; criptografia **1** com o SSL da 5.2 (sem ele, **3**) |
| E.4 | Organização "INIA Homologação", fuso `America/Sao_Paulo`, você como administrador. **Copie a senha temporária** (aparece uma vez) |
| E.5 | A chave do Gemini **só da homologação** |
| E.6 | `npm run build`. Demora mais que no Mac: a B2as_v2 é uma VM "burstable" (desempenho pleno só por períodos curtos) |

A instalação sobe **sem dados de demonstração**, e é isso que se quer: com endereço público o `env-init` grava
`NODE_ENV=production`, e o `setup --demo` e o `db:seed:demo` recusam produção. Não contorne. A homologação ensaia
justamente a entrada de dados pela Central (seção 11).

---

## 9. Etapas F, G e H — os scripts nunca executados

**F — IIS** (o Default Web Site fica com a porta 80; a INIA só usa a 443, então não há conflito):

```powershell
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\iis\configurar-iis.ps1 -Porta 443 -Https -CertificadoThumbprint THUMBPRINT -NomeDoHost inia-homolog-ALGO.brazilsouth.cloudapp.azure.com -AbrirFirewall
```

Esperado: `== 1/6` a `== 6/6`, só `OK`. Depois, no Gerenciador do IIS: Server Farms › INIA-API e INIA-Interface, com
o servidor da farm aparecendo (fica "Unhealthy" até a Etapa G).

**G — serviços:**

```powershell
powershell -ExecutionPolicy Bypass -File C:\inia\deploy\windows\servicos\instalar-servicos.ps1 -WinSW C:\inia-ferramentas\WinSW-x64.exe
```

O script atual cria **três** serviços (**INIA - API**, **INIA - Processamento**, **INIA - Interface**) e espera
`http://127.0.0.1:3333/ready`, `http://127.0.0.1:3334/health` e `http://127.0.0.1:3000/healthz`. A IT-INIA-004 v1.0
ainda descreve dois serviços e "quatro blocos 1/4"; essa divergência já está no registro (seção 12).

**H — conferência final:** a tabela da IT-INIA-004, seção 12, mais o `sc query INIA-Processamento`. O primeiro acesso é
pelo navegador do **Mac**: o IE da VM não abre a interface.

---

## 10. Checklist da homologação

Marque e anote no registro (seção 12) tudo que não for "Esperado".

| # | Teste | Como | Esperado |
| --- | --- | --- | --- |
| H01 | IIS e web farms | `configurar-iis.ps1` + Gerenciador do IIS › Server Farms › Monitoring | 6/6 sem ERRO; servidores **Healthy** depois da G |
| H02 | Serviços | `instalar-servicos.ps1`; `services.msc` | 3 serviços **Em execução**, início automático (atraso) |
| H03 | Endereço e cadeado | Mac: `https://<nome>/health` e `https://<nome>` | `{"status":"ok"}`; tela de login com cadeado válido |
| H04 | Métricas fechadas | Mac: `https://<nome>/internal/metrics` | **404** |
| H05 | Primeiro acesso | Login com a senha temporária (IT-INIA-002) | Pede a senha nova e entra |
| H06 | Chat em fluxo | Conversar com a INIA | A resposta aparece **aos poucos**, não de uma vez (`responseBufferLimit` 0 do ARR) |
| H07 | Voz atrás do IIS | Falar com a INIA pelo microfone | O navegador libera o microfone e a conversa funciona ("voz atrás do IIS: não validada") |
| H08 | SQL Server real | Administração › Central de Dados › Conectar banco de dados › SQL Server: IP privado da `inia-dados`, 1433, `inia_exemplo`, `inia_leitura` → Testar conexão → `dbo.colaboradores` | Conexão criptografada aceita; amostra com os 30 colaboradores |
| H09 | Carga pela Central | Conjunto de dados de pessoas (`dbo.colaboradores`) e de medições (`dbo.medicoes_diarias`, TMA) validados e ativos | Pessoas e estrutura aparecem; medições de TMA nos Indicadores |
| H10 | Liga sozinha | Reiniciar a `inia-app` pelo portal | `/health` volta sem ninguém fazer nada |
| H11 | Banco cai e volta | Reiniciar a `inia-dados` com a INIA no ar | `/ready` dá 503 enquanto o banco está fora e volta sozinho; a API não cai |
| H12 | Processamento separado | `Stop-Service INIA-Processamento` | Telas e chat continuam; `Start-Service` volta |
| H13 | Web farm com 2 instâncias | `instalar-servicos.ps1 … -InstanciasApi 2 -InstanciasInterface 2` e `configurar-iis.ps1 … -InstanciasApi 2 -InstanciasInterface 2` | 2 servidores Healthy em cada farm; parar `INIA-API-2` não derruba a tela de quem está usando |
| H14 | Atualização | Rotina "Atualizar" da IT-INIA-004, seção 13 (antes, um `github:publish` com alguma mudança) | `update` aplica ou diz que não há nada; tudo volta |
| H15 | Backup e restauração | `pg_dump` da IT-INIA-003 na `inia-dados`; `pg_restore` num banco vazio `inia_restauro` | Restauração sem erro |
| H16 | Registros | `C:\inia\logs` | Um arquivo por serviço, sem senha nem chave no conteúdo |

---

## 11. Dados e primeiro feedback (IT-INIA-005)

Com H08 e H09 de pé, siga a **IT-INIA-005** do começo, com o roteiro de
[primeiro-feedback-exemplo/README.md](primeiro-feedback-exemplo/README.md): criar o indicador TMA, os conjuntos de
dados da Central sobre as tabelas do SQL Server de exemplo (Grupos, subgrupos, colaboradores, metas, medições,
fechamento oficial e chamadas) e os quatro procedimentos fictícios na Base de conhecimento. Os dados contam uma
história (TMA da Elisa Almeida subindo em setembro por causa das chamadas de Contestação de valor) que o feedback de
indicador deve encontrar. Nunca use dado real de cliente: a VM está na internet.

Ao rodar os Workflows (Manual, uma chamada e uma pessoa), acompanhe o custo em Administração › IA e no painel da chave
do Gemini.

---

## 12. Registro de achados

Uma linha por surpresa, com a **mensagem exata** (print ou texto copiado). No fim, cada linha vira correção num script,
numa IT ou neste guia, e a tabela "O que já foi testado" de [dois-servidores-windows.md](dois-servidores-windows.md) é
atualizada com o que passou.

| # | Seção / teste | O que aconteceu (mensagem exata) | Como contornei | Corrigir em |
| --- | --- | --- | --- | --- |
| 0 | 9 (G) | Já conhecido: a IT-INIA-004 v1.0 descreve 2 serviços e "1/4 a 4/4"; o script cria 3 serviços (com o Processamento) | — | IT-INIA-004 (Etapas G, H e seção 13) |
| 1 | | | | |
| 2 | | | | |

---

## 13. Rotina e encerramento

**A cada sessão de trabalho:** no portal, ligue primeiro a `inia-dados` e depois a `inia-app`. Os serviços sobem sozinhos.
Se a `inia-app` subir antes, o `/ready` responde 503 até o banco voltar, e isso também é teste (H11). Ao terminar,
**Parar** as duas. O desligamento das 23:00 é só a rede de segurança.

**Antes do 30º dia (ou quando acabar):**

1. Se quiser guardar alguma coisa: `pg_dump` do banco e o registro de achados.
2. **Grupos de recursos** → `rg-inia-homolog` → **Excluir grupo de recursos**. Isso apaga VMs, discos, IPs e rede.
3. Revogue a chave do Gemini da homologação (Google AI Studio) e a autorização do GitHub CLI (GitHub › Settings ›
   Applications › Authorized OAuth Apps).
4. **Não** converta a conta para pagamento conforme o uso. Sem conversão, a assinatura é desativada e nada é cobrado.
