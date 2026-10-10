<#
.SYNOPSIS
  INIA - instala a API, o processamento e a interface como SERVIÇOS DO WINDOWS (sobem junto com o servidor e reiniciam
  sozinhos se caírem).

.DESCRIPTION
  Rode como ADMINISTRADOR, no servidor da aplicação, DEPOIS de:
    npm run install:all · npm run env:init · npm run db:connect · npm run setup · npm run build

  Usa o WinSW (Windows Service Wrapper, gratuito, licença MIT): baixe o arquivo WinSW-x64.exe da versão 2.12.0 em
  https://github.com/winsw/winsw/releases e informe o caminho dele em -WinSW.

  Cria três serviços:
    INIA-API            node backend\dist\main\server.js --role=api      telas, chat, voz e administração (lê o backend\.env)
    INIA-Processamento  node backend\dist\main\server.js --role=worker   Workflows, feedbacks e tarefas periódicas - sem
                        HTTP público; /health só em 127.0.0.1 (porta WORKER_HEALTH_PORT do backend\.env, padrão 3334)
    INIA-Interface      node frontend\...\next start -H ... -p ...       (lê o frontend\.env.local)
  API e processamento separados: um lote pesado de IA não divide o processador com as telas. Todos iniciam
  automaticamente (com atraso, depois da rede), reiniciam em caso de falha e gravam os registros em <pasta da INIA>\logs.
  Rodar de novo reinstala (útil depois de mudar a configuração).

  -ProcessoUnico volta ao formato antigo (um serviço INIA-API fazendo API + processamento, sem INIA-Processamento).

.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProxyInternet http://proxy.empresa.local:8080
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProxyInternet http://proxy.empresa.local:8080 -CertificadoRaiz C:\certificados\raiz-empresa.pem
  (proxy que inspeciona HTTPS: o Node só aceita o certificado da empresa se receber a raiz em .pem)
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProcessoUnico
  (API e processamento num processo só, como antes)
.EXAMPLE
  .\instalar-servicos.ps1 -Remover
#>
[CmdletBinding()]
param(
  [string]$WinSW = "",
  [string]$ProxyInternet = "",
  [string]$SemProxyPara = "localhost,127.0.0.1",
  [string]$CertificadoRaiz = "",
  [switch]$ProcessoUnico,
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
function Passo([string]$texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "  OK  $texto" -ForegroundColor Green }
function Falha([string]$texto) { Write-Host "  ERRO  $texto" -ForegroundColor Red; exit 1 }
function Xml([string]$valor) { return [System.Security.SecurityElement]::Escape($valor) }

$identidade = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identidade.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Falha "Abra o PowerShell como Administrador (botão direito > Executar como administrador) e rode de novo."
}

$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$pastaServicos = Join-Path $PSScriptRoot "bin"
$pastaLogs = Join-Path $raiz "logs"
# Todos os que podem existir (remover/reinstalar limpa qualquer formato); os instalados dependem de -ProcessoUnico.
$servicos = @("INIA-API", "INIA-Processamento", "INIA-Interface")
$instalar = @("INIA-API", "INIA-Processamento", "INIA-Interface")
if ($ProcessoUnico) { $instalar = @("INIA-API", "INIA-Interface") }

function Remover-Servico([string]$id) {
  $exe = Join-Path $pastaServicos "$id.exe"
  if (Get-Service -Name $id -ErrorAction SilentlyContinue) {
    if (Test-Path $exe) {
      & $exe stop *> $null
      & $exe uninstall *> $null
    } else {
      Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
      & sc.exe delete $id *> $null
    }
    Start-Sleep -Seconds 2
    Ok "serviço $id removido"
  }
}

if ($Remover) {
  Passo "Removendo os serviços da INIA"
  foreach ($id in $servicos) { Remover-Servico $id }
  Write-Host "`nPronto. Os arquivos da INIA e o banco não foram alterados." -ForegroundColor Green
  exit 0
}

# --- 1. Conferências --------------------------------------------------------------------------------------------
Passo "1/4 Conferindo o que é preciso"
if (-not $WinSW) { Falha "Informe o WinSW: -WinSW C:\caminho\WinSW-x64.exe (versão 2.12.0 em https://github.com/winsw/winsw/releases)." }
if (-not (Test-Path $WinSW)) { Falha "Não achei o WinSW em $WinSW." }
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { Falha "Node.js não encontrado. Instale o Node.js 24 (LTS, instalador .msi) e abra um PowerShell novo." }
$node = $node.Source
$versao = (& $node --version).Trim()
if ([int]($versao.TrimStart("v").Split(".")[0]) -lt 24) { Falha "Node.js $versao encontrado; a INIA precisa do 24 ou mais novo." }
Ok "Node.js $versao ($node)"
$apiJs = Join-Path $raiz "backend\dist\main\server.js"
$nextJs = Join-Path $raiz "frontend\node_modules\next\dist\bin\next"
if (-not (Test-Path (Join-Path $raiz "backend\.env"))) { Falha "backend\.env não existe - rode npm run env:init e npm run db:connect." }
if (-not (Test-Path $apiJs)) { Falha "A API não está compilada - rode npm run build na pasta da INIA." }
if (-not (Test-Path (Join-Path $raiz "frontend\.next\BUILD_ID"))) { Falha "A interface não está compilada - rode npm run build na pasta da INIA." }
if (-not (Test-Path $nextJs)) { Falha "Dependências da interface ausentes - rode npm run install:all." }
if ($CertificadoRaiz) {
  if (-not (Test-Path $CertificadoRaiz)) { Falha "Não achei o certificado raiz em $CertificadoRaiz." }
  $CertificadoRaiz = (Resolve-Path $CertificadoRaiz).Path
  if (-not ((Get-Content -Raw $CertificadoRaiz) -match "BEGIN CERTIFICATE")) { Falha "$CertificadoRaiz não está no formato .pem (texto com BEGIN CERTIFICATE). Exporte o certificado como Base-64 (.cer/.pem)." }
  Ok "certificado raiz da empresa: $CertificadoRaiz"
}
Ok "INIA compilada em $raiz"

# Porta/endereço da interface: os mesmos que o npm run env:init gravou no frontend\.env.local.
$portaInterface = "3000"
$hostInterface = ""
$envInterface = Join-Path $raiz "frontend\.env.local"
if (Test-Path $envInterface) {
  foreach ($linha in Get-Content $envInterface) {
    if ($linha -match "^INIA_WEB_PORT=(\d+)") { $portaInterface = $Matches[1] }
    if ($linha -match "^INIA_WEB_HOST=(\S+)") { $hostInterface = $Matches[1] }
  }
}
$argumentosInterface = "`"$nextJs`" start -p $portaInterface"
if ($hostInterface) { $argumentosInterface = "$argumentosInterface -H $hostInterface" }
$exibicaoInterface = "todas as interfaces"; if ($hostInterface) { $exibicaoInterface = $hostInterface }
Ok "interface na porta $portaInterface ($exibicaoInterface)"

# --- 2. Arquivos dos serviços -----------------------------------------------------------------------------------
Passo "2/4 Gerando os arquivos dos serviços em $pastaServicos"
foreach ($id in $servicos) { Remover-Servico $id }
New-Item -ItemType Directory -Force -Path $pastaServicos | Out-Null
New-Item -ItemType Directory -Force -Path $pastaLogs | Out-Null

$ambienteApi = ""
if ($ProxyInternet) {
  # A IA da INIA chama o Google pela internet (API e processamento); com proxy corporativo o Node 24 só o usa com
  # NODE_USE_ENV_PROXY=1.
  $ambienteApi = @"
  <env name="NODE_USE_ENV_PROXY" value="1"/>
  <env name="HTTPS_PROXY" value="$(Xml $ProxyInternet)"/>
  <env name="HTTP_PROXY" value="$(Xml $ProxyInternet)"/>
  <env name="NO_PROXY" value="$(Xml $SemProxyPara)"/>
"@
  $ambienteApi += "`r`n"
}
if ($CertificadoRaiz) {
  # Proxy que inspeciona HTTPS: sem a raiz da empresa o Node recusa a conexão com a IA (self-signed certificate in chain).
  # Fica no serviço porque serviço do Windows não enxerga variável de sistema nova antes de reiniciar o servidor.
  $ambienteApi += "  <env name=""NODE_EXTRA_CA_CERTS"" value=""$(Xml $CertificadoRaiz)""/>`r`n"
}

function Gravar-Servico([string]$id, [string]$nome, [string]$descricao, [string]$argumentos, [string]$pasta, [string]$ambiente) {
  $xml = @"
<service>
  <id>$id</id>
  <name>$(Xml $nome)</name>
  <description>$(Xml $descricao)</description>
  <executable>$(Xml $node)</executable>
  <arguments>$(Xml $argumentos)</arguments>
  <workingdirectory>$(Xml $pasta)</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart/>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>15 sec</stoptimeout>
  <logpath>$(Xml $pastaLogs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
$ambiente</service>
"@
  Copy-Item -Force $WinSW (Join-Path $pastaServicos "$id.exe")
  [IO.File]::WriteAllText((Join-Path $pastaServicos "$id.xml"), $xml, (New-Object Text.UTF8Encoding($false)))
  Ok "$id.exe + $id.xml"
}

if ($ProcessoUnico) {
  Gravar-Servico "INIA-API" "INIA - API" "INIA: API e processamento (backend, processo único). Configuração em backend\.env." "`"$apiJs`" --role=all" (Join-Path $raiz "backend") $ambienteApi
} else {
  Gravar-Servico "INIA-API" "INIA - API" "INIA: API (telas, chat, voz e administração). Configuração em backend\.env." "`"$apiJs`" --role=api" (Join-Path $raiz "backend") $ambienteApi
  # O processamento também chama a IA: recebe o mesmo proxy/certificado da API.
  Gravar-Servico "INIA-Processamento" "INIA - Processamento" "INIA: processamento (Workflows, feedbacks e tarefas periódicas; sem HTTP público). Configuração em backend\.env." "`"$apiJs`" --role=worker" (Join-Path $raiz "backend") $ambienteApi
}
Gravar-Servico "INIA-Interface" "INIA - Interface" "INIA: interface web. Configuração em frontend\.env.local." $argumentosInterface (Join-Path $raiz "frontend") ""

# --- 3. Instalar e iniciar --------------------------------------------------------------------------------------
Passo "3/4 Instalando e iniciando"
foreach ($id in $instalar) {
  $exe = Join-Path $pastaServicos "$id.exe"
  & $exe install
  if ($LASTEXITCODE -ne 0) { Falha "Não consegui instalar o serviço $id (veja a mensagem acima)." }
  & $exe start
  if ($LASTEXITCODE -ne 0) { Falha "O serviço $id não iniciou - veja $pastaLogs\$id.err.log" }
  Ok "$id instalado e iniciado"
}

# --- 4. Conferir ------------------------------------------------------------------------------------------------
Passo "4/4 Conferindo a API e o processamento"
$portaApi = "3333"
$portaProcessamento = "3334"
foreach ($linha in Get-Content (Join-Path $raiz "backend\.env")) {
  if ($linha -match "^PORT=(\d+)") { $portaApi = $Matches[1] }
  if ($linha -match "^WORKER_HEALTH_PORT=(\d+)") { $portaProcessamento = $Matches[1] }
}
$respondeu = $false
for ($tentativa = 0; $tentativa -lt 30 -and -not $respondeu; $tentativa++) {
  try {
    $resposta = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$portaApi/health"
    if ($resposta.StatusCode -eq 200) { $respondeu = $true }
  } catch { Start-Sleep -Seconds 2 }
}
if ($respondeu) { Ok "API respondendo em http://127.0.0.1:$portaApi/health" }
else { Falha "A API não respondeu em 60 s - veja $pastaLogs\INIA-API.err.log e $pastaLogs\INIA-API.out.log" }
if (-not $ProcessoUnico) {
  if ($portaProcessamento -eq "0") {
    Ok "processamento sem /health (WORKER_HEALTH_PORT=0) - confira o serviço INIA-Processamento em services.msc"
  } else {
    $respondeu = $false
    for ($tentativa = 0; $tentativa -lt 30 -and -not $respondeu; $tentativa++) {
      try {
        $resposta = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$portaProcessamento/health"
        if ($resposta.StatusCode -eq 200) { $respondeu = $true }
      } catch { Start-Sleep -Seconds 2 }
    }
    if ($respondeu) { Ok "processamento respondendo em http://127.0.0.1:$portaProcessamento/health" }
    else { Falha "O processamento não respondeu em 60 s - veja $pastaLogs\INIA-Processamento.err.log e $pastaLogs\INIA-Processamento.out.log" }
  }
}

$nomes = ($instalar | ForEach-Object { $_ -replace "^INIA-", "INIA - " }) -join ", "
Write-Host "`nPronto. Gerencie em Serviços do Windows (services.msc): $nomes." -ForegroundColor Green
Write-Host "Registros: $pastaLogs" -ForegroundColor Green
