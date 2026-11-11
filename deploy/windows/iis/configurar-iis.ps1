<#
.SYNOPSIS
  INIA - configura o IIS para atender o endereço público da INIA e encaminhar para ela (proxy reverso).

.DESCRIPTION
  Rode como ADMINISTRADOR, no servidor da aplicação, depois de instalar:
    - o IIS (Gerenciador do Servidor > Adicionar funções > Servidor Web (IIS));
    - o módulo URL Rewrite 2.1;
    - o módulo Application Request Routing 3.0.
  Se o Windows bloquear o script (arquivo baixado da internet): Unblock-File .\configurar-iis.ps1
  ou rode com: powershell -ExecutionPolicy Bypass -File .\configurar-iis.ps1 -Porta 8080

  O script:
    1. confere se o IIS, o URL Rewrite e o ARR estão instalados;
    2. liga o proxy do ARR no nível do servidor (tempo limite de 5 minutos, SEM acumular respostas - o chat da INIA
       chega em fluxo - e SEM a porta do cliente no X-Forwarded-For - senão cada conexão vira um "IP" nos limites);
    3. cria as WEB FARMS "INIA-API" e "INIA-Interface", com uma entrada por instância (instância i = 127.0.0.i, a mesma
       porta para todas: o ARR identifica o servidor pelo endereço, sem a porta), health check (/ready da API e /healthz da
       interface, a cada 3 s) e balanceamento por MENOS REQUISIÇÕES em andamento; grava o web.config na pasta do site;
    4. cria (ou mantém) o pool de aplicativos "INIA" sem .NET e o site "INIA" com a ligação HTTP na porta informada;
    5. com -Https, liga também HTTPS usando o certificado informado pela impressão digital;
    6. com -AbrirFirewall, libera a porta no Firewall do Windows.

  -InstanciasApi e -InstanciasInterface têm de bater com o que o instalar-servicos.ps1 instalou (os mesmos números).

  Rodar de novo é seguro: as web farms da INIA são recriadas, o resto é mantido e o web.config é regravado.

  ATENÇÃO: escrito e revisado sem execução num Windows real (13/10/2026). Confira o resultado no Gerenciador do IIS
  (Server Farms > INIA-API > Monitoring and Management: todos os servidores "Healthy").

.EXAMPLE
  .\configurar-iis.ps1 -Porta 8080
.EXAMPLE
  .\configurar-iis.ps1 -Porta 8080 -InstanciasApi 3 -InstanciasInterface 2
.EXAMPLE
  .\configurar-iis.ps1 -Porta 443 -Https -CertificadoThumbprint 0123ABCD... -NomeDoHost inia.empresa.local -AbrirFirewall
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$Porta,
  [string]$NomeDoHost = "",
  [string]$NomeDoSite = "INIA",
  [string]$PastaDoSite = "C:\inia-iis",
  [int]$PortaApi = 3333,
  [int]$PortaInterface = 3000,
  [ValidateRange(1, 20)][int]$InstanciasApi = 1,
  [ValidateRange(1, 20)][int]$InstanciasInterface = 1,
  [switch]$Https,
  [string]$CertificadoThumbprint = "",
  [switch]$AbrirFirewall
)

$ErrorActionPreference = "Stop"
$appcmd = Join-Path $env:windir "system32\inetsrv\appcmd.exe"

function Passo([string]$texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "  OK  $texto" -ForegroundColor Green }
function Falha([string]$texto) { Write-Host "  ERRO  $texto" -ForegroundColor Red; exit 1 }

function AppCmd([string[]]$argumentos) {
  $saida = & $appcmd @argumentos 2>&1
  if ($LASTEXITCODE -ne 0) { Falha "appcmd $($argumentos -join ' ')`n$saida" }
  return $saida
}

# --- 0. Administrador -------------------------------------------------------------------------------------------
$identidade = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identidade.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Falha "Abra o PowerShell como Administrador (botão direito > Executar como administrador) e rode de novo."
}
if ($Https -and -not $CertificadoThumbprint) { Falha "Com -Https, informe -CertificadoThumbprint (impressão digital do certificado instalado no servidor)." }

# --- 1. Pré-requisitos ------------------------------------------------------------------------------------------
Passo "1/6 Conferindo IIS, URL Rewrite, Application Request Routing e ferramentas do IIS"
if (-not (Test-Path $appcmd)) { Falha "IIS não encontrado. Instale a função Servidor Web (IIS) pelo Gerenciador do Servidor." }
Ok "IIS"
if (-not (Test-Path (Join-Path $env:windir "system32\inetsrv\rewrite.dll"))) { Falha "Módulo URL Rewrite não instalado (baixe o URL Rewrite 2.1 no site da Microsoft)." }
Ok "URL Rewrite"
& $appcmd list config -section:system.webServer/proxy *> $null
if ($LASTEXITCODE -ne 0) { Falha "Módulo Application Request Routing (ARR) 3.0 não instalado (baixe no site da Microsoft)." }
Ok "Application Request Routing"
if (-not (Get-Module -ListAvailable -Name WebAdministration)) { Falha "Faltam os Scripts e Ferramentas de Gerenciamento do IIS. Instale com: Install-WindowsFeature Web-Scripting-Tools" }
Ok "Scripts e Ferramentas de Gerenciamento do IIS"

# --- 2. Proxy do ARR no nível do servidor -----------------------------------------------------------------------
Passo "2/6 Ligando o proxy do ARR (tempo limite 5 min, sem acumular respostas, IP do cliente sem porta)"
AppCmd @("set", "config", "-section:system.webServer/proxy", "/enabled:True", "/preserveHostHeader:True", "/timeout:00:05:00", "/responseBufferLimit:0", "/includePortInXForwardedFor:False", "/commit:apphost") | Out-Null
Ok "proxy ligado"

# --- 3. Web farms + pasta do site + web.config ------------------------------------------------------------------
Passo "3/6 Web farms (INIA-API x$InstanciasApi, INIA-Interface x$InstanciasInterface), pasta do site e web.config"
Import-Module WebAdministration

# Uma web farm por papel. Instância i = 127.0.0.i na mesma porta (o ARR identifica o servidor pelo ENDEREÇO, sem a porta:
# 127.0.0.1:3333 e 127.0.0.1:3335 seriam o "mesmo" servidor). Health check: só recebe tráfego quem responde "$Resposta" no
# corpo de $Caminho; ao desligar, a API responde 503 sem essa palavra e sai da farm antes de fechar a porta.
function Configurar-Farm([string]$Nome, [int]$Instancias, [int]$PortaInterna, [string]$Caminho, [string]$Resposta) {
  if (Get-WebConfiguration -PSPath "MACHINE/WEBROOT/APPHOST" -Filter "webFarms/webFarm[@name='$Nome']") {
    AppCmd @("set", "config", "-section:webFarms", "/-[name='$Nome']", "/commit:apphost") | Out-Null
  }
  AppCmd @("set", "config", "-section:webFarms", "/+[name='$Nome']", "/commit:apphost") | Out-Null
  for ($i = 1; $i -le $Instancias; $i++) {
    $endereco = "127.0.0.$i"
    AppCmd @("set", "config", "-section:webFarms", "/+[name='$Nome'].[address='$endereco']", "/commit:apphost") | Out-Null
    AppCmd @("set", "config", "-section:webFarms", "/[name='$Nome'].[address='$endereco'].applicationRequestRouting.httpPort:$PortaInterna", "/commit:apphost") | Out-Null
  }
  $arr = "/[name='$Nome'].applicationRequestRouting"
  AppCmd @(
    "set", "config", "-section:webFarms",
    # Menos requisições em andamento: o chat fica aberto em fluxo; rodízio simples empilharia conversas longas numa instância.
    "$arr.loadBalancing.algorithm:LeastRequests",
    "$arr.healthCheck.url:http://$($Nome.ToLower())$Caminho",
    "$arr.healthCheck.interval:00:00:03",
    "$arr.healthCheck.timeout:00:00:02",
    "$arr.healthCheck.responseMatch:$Resposta",
    # Com TODAS as instâncias fora (ex.: banco parado), continua mandando para uma: a pessoa vê a mensagem da INIA, não um 502.
    "$arr.healthCheck.minServers:1",
    "$arr.protocol.timeout:00:05:00",
    "$arr.protocol.responseBufferLimit:0",
    "$arr.protocol.includePortInXForwardedFor:False",
    "/commit:apphost"
  ) | Out-Null
  $enderecos = (1..$Instancias | ForEach-Object { "127.0.0.$($_):$PortaInterna" }) -join ", "
  Ok "web farm $Nome - $enderecos - health check $Caminho"
}
Configurar-Farm "INIA-API" $InstanciasApi $PortaApi "/ready" "ready"
Configurar-Farm "INIA-Interface" $InstanciasInterface $PortaInterface "/healthz" "inia-interface"

$modelo = Join-Path $PSScriptRoot "web.config"
if (-not (Test-Path $modelo)) { Falha "Não achei o modelo $modelo (rode o script de dentro da pasta deploy\windows\iis da INIA)." }
New-Item -ItemType Directory -Force -Path $PastaDoSite | Out-Null
$conteudo = Get-Content -Raw -Encoding UTF8 $modelo
[IO.File]::WriteAllText((Join-Path $PastaDoSite "web.config"), $conteudo, (New-Object Text.UTF8Encoding($false)))
Ok "web.config gravado em $PastaDoSite (regras para as web farms INIA-API e INIA-Interface)"

# --- 4. Pool de aplicativos e site ------------------------------------------------------------------------------
Passo "4/6 Pool de aplicativos e site '$NomeDoSite'"
$protocolo = "http"; if ($Https) { $protocolo = "https" }

# A porta (com o mesmo nome de host) não pode estar em uso por OUTRO site - o IIS não iniciaria nenhum dos dois.
foreach ($ligacao in @(Get-WebBinding)) {
  $partes = $ligacao.bindingInformation.Split(":")
  $dono = ([regex]::Match($ligacao.ItemXPath, "@name='([^']+)'")).Groups[1].Value
  if ($dono -ne $NomeDoSite -and $partes[1] -eq "$Porta" -and $partes[2] -eq $NomeDoHost) {
    Falha "A porta $Porta$(if ($NomeDoHost) { " (host $NomeDoHost)" }) já é usada pelo site '$dono'. Pare/remova aquela ligação no Gerenciador do IIS ou use outra porta (ou um -NomeDoHost)."
  }
}

& $appcmd list apppool $NomeDoSite *> $null
if ($LASTEXITCODE -ne 0) {
  AppCmd @("add", "apppool", "/name:$NomeDoSite", "/managedRuntimeVersion:") | Out-Null
  Ok "pool de aplicativos '$NomeDoSite' criado (sem .NET)"
} else { Ok "pool de aplicativos '$NomeDoSite' já existe" }

& $appcmd list site $NomeDoSite *> $null
if ($LASTEXITCODE -ne 0) {
  AppCmd @("add", "site", "/name:$NomeDoSite", "/bindings:$protocolo/*:$($Porta):$NomeDoHost", "/physicalPath:$PastaDoSite") | Out-Null
  AppCmd @("set", "app", "$NomeDoSite/", "/applicationPool:$NomeDoSite") | Out-Null
  Ok "site '$NomeDoSite' criado ($protocolo na porta $Porta)"
} else {
  AppCmd @("set", "vdir", "$NomeDoSite/", "/physicalPath:$PastaDoSite") | Out-Null
  if (-not (Get-WebBinding -Name $NomeDoSite -Protocol $protocolo -Port $Porta -ErrorAction SilentlyContinue)) {
    if ($NomeDoHost) { New-WebBinding -Name $NomeDoSite -Protocol $protocolo -Port $Porta -HostHeader $NomeDoHost }
    else { New-WebBinding -Name $NomeDoSite -Protocol $protocolo -Port $Porta }
    Ok "site '$NomeDoSite' já existia: ligação $protocolo na porta $Porta acrescentada (remova ligações antigas no Gerenciador do IIS, se houver)"
  } else { Ok "site '$NomeDoSite' já existe (pasta atualizada para $PastaDoSite)" }
}

# Diagnóstico de erros: o log do IIS grava o x-request-id que o navegador envia (pedido) e o que a API devolve (resposta) — a
# REFERÊNCIA que a tela de erro mostra. Assim uma falha que nasce no proxy (502 sem a API) também é encontrada pela referência:
#   Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch "<referência>"
# Idempotente: remove os campos (se existirem) e cria de novo.
foreach ($campo in @(@("x-request-id", "x-request-id", "RequestHeader"), @("x-request-id-resposta", "x-request-id", "ResponseHeader"))) {
  & $appcmd set config -section:system.applicationHost/sites "/-[name='$NomeDoSite'].logFile.customFields.[logFieldName='$($campo[0])']" /commit:apphost *> $null
  AppCmd @("set", "config", "-section:system.applicationHost/sites", "/+[name='$NomeDoSite'].logFile.customFields.[logFieldName='$($campo[0])',sourceName='$($campo[1])',sourceType='$($campo[2])']", "/commit:apphost") | Out-Null
}
Ok "log do IIS com os campos x-request-id (pedido e resposta) — referência das telas de erro"

# --- 5. HTTPS ---------------------------------------------------------------------------------------------------
Passo "5/6 HTTPS"
if ($Https) {
  $certificado = Get-ChildItem "Cert:\LocalMachine\My" | Where-Object { $_.Thumbprint -eq $CertificadoThumbprint.Replace(" ", "").ToUpper() }
  if (-not $certificado) { Falha "Certificado $CertificadoThumbprint não encontrado em Certificados (Computador local) > Pessoal." }
  $ligacaoHttps = Get-WebBinding -Name $NomeDoSite -Protocol "https" -Port $Porta
  $ligacaoHttps.AddSslCertificate($certificado.Thumbprint, "my")
  Ok "HTTPS na porta $Porta com o certificado $($certificado.Subject)"
} else { Ok "não pedido (site em HTTP na porta $Porta - use só em rede interna)" }

# --- 6. Firewall ------------------------------------------------------------------------------------------------
Passo "6/6 Firewall do Windows"
if ($AbrirFirewall) {
  $regra = "INIA - porta $Porta"
  if (-not (Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $regra -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow | Out-Null
  }
  Ok "porta $Porta liberada para entrada"
} else { Ok "não alterado (use -AbrirFirewall para liberar a porta $Porta)" }

& $appcmd start site "/site.name:$NomeDoSite" *> $null
$esquema = "http"; if ($Https) { $esquema = "https" }
$hostExibido = "localhost"; if ($NomeDoHost) { $hostExibido = $NomeDoHost }
Write-Host "`nPronto. Com os serviços da INIA no ar, teste: $($esquema)://$($hostExibido):$Porta/health  (deve responder {""status"":""ok""})" -ForegroundColor Green
Write-Host "Saúde de cada instância: Gerenciador do IIS > Server Farms > INIA-API / INIA-Interface > Monitoring and Management." -ForegroundColor Green
