<#
.SYNOPSIS
  INIA - instala a API, o processamento e a interface como SERVIÇOS DO WINDOWS (sobem junto com o servidor e reiniciam
  sozinhos se caírem).

.DESCRIPTION
  Rode como ADMINISTRADOR, no servidor da aplicação, DEPOIS de:
    npm run install:all · npm run env:init · npm run db:connect · npm run setup · npm run build

  Usa o WinSW (Windows Service Wrapper, gratuito, licença MIT): baixe o arquivo WinSW-x64.exe da versão 2.12.0 em
  https://github.com/winsw/winsw/releases e informe o caminho dele em -WinSW.

  Cria os serviços (um por instância; a primeira de cada papel mantém o nome antigo):
    INIA-API, INIA-API-2…            node backend\dist\main\server.js --role=api     telas, chat, voz e administração
    INIA-Processamento, …-2…         node backend\dist\main\server.js --role=worker  Workflows, feedbacks e tarefas periódicas -
                                     sem HTTP público; /health só em 127.0.0.1 (WORKER_HEALTH_PORT do backend\.env, padrão
                                     3334; a instância j usa essa porta + j - 1)
    INIA-Interface, INIA-Interface-2…  node frontend\...\next start -H ... -p ...   (lê o frontend\.env.local)
  API e processamento separados: um lote pesado de IA não divide o processador com as telas. Todos iniciam
  automaticamente (com atraso, depois da rede), reiniciam em caso de falha e gravam os registros em <pasta da INIA>\logs.
  Rodar de novo reinstala (útil depois de mudar a configuração ou o número de instâncias).

  VÁRIAS INSTÂNCIAS (web farm do IIS - configurar-iis.ps1 com os MESMOS números): com mais de uma, a instância i da API e
  da interface escuta em 127.0.0.i, na mesma porta (o ARR do IIS identifica o servidor pelo endereço). Um processo Node usa
  ~1 núcleo: some instâncias até perto do número de núcleos livres. Tudo o que precisa valer para o conjunto (limites de
  login, pausa do provedor de IA, tarefas periódicas, fila de Workflows e da Central de Dados) fica no PostgreSQL.
  -CotaIaApi / -CotaIaProcessamento: chamadas de IA ao mesmo tempo POR PROCESSO (INIA_AI_MAX_CONCURRENT_CALLS) - proteção
  local; o limite do PROVEDOR fica na conexão de IA (Administração > IA > Provedores > "Chamadas simultâneas"), dividido por
  todas as instâncias. -PoolApi / -PoolProcessamento: conexões ao banco POR
  INSTÂNCIA (DATABASE_POOL_MAX) - a soma de todas + folga precisa caber no max_connections do PostgreSQL. 0 = o valor do
  backend\.env.

  -ProcessoUnico volta ao formato antigo (um serviço INIA-API fazendo API + processamento, sem INIA-Processamento).

  ATENÇÃO: escrito e revisado sem execução num Windows real (13/10/2026) - confira o resultado em services.msc e nos
  /health e /ready de cada instância.

.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProxyInternet http://proxy.empresa.local:8080
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProxyInternet http://proxy.empresa.local:8080 -CertificadoRaiz C:\certificados\raiz-empresa.pem
  (proxy que inspeciona HTTPS: o Node só aceita o certificado da empresa se receber a raiz em .pem)
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -InstanciasApi 3 -InstanciasInterface 2 -InstanciasProcessamento 2 -PoolApi 25 -PoolProcessamento 25
  (3 APIs, 2 interfaces e 2 processamentos; depois: configurar-iis.ps1 -InstanciasApi 3 -InstanciasInterface 2)
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ProcessoUnico
  (API e processamento num processo só, como antes)
.EXAMPLE
  .\instalar-servicos.ps1 -WinSW C:\Downloads\WinSW-x64.exe -ContaServico "NT AUTHORITY\LocalService"
  (serviços sem os poderes do LocalSystem; a conta recebe leitura da pasta da INIA e escrita em logs e frontend\.next)
.EXAMPLE
  .\instalar-servicos.ps1 -Remover
#>
[CmdletBinding()]
param(
  [string]$WinSW = "",
  [string]$ProxyInternet = "",
  [string]$SemProxyPara = "localhost,127.0.0.1",
  [string]$CertificadoRaiz = "",
  [ValidateRange(1, 20)][int]$InstanciasApi = 1,
  [ValidateRange(1, 20)][int]$InstanciasInterface = 1,
  [ValidateRange(1, 20)][int]$InstanciasProcessamento = 1,
  [ValidateRange(0, 512)][int]$CotaIaApi = 0,
  [ValidateRange(0, 512)][int]$CotaIaProcessamento = 0,
  [ValidateRange(0, 200)][int]$PoolApi = 0,
  [ValidateRange(0, 200)][int]$PoolProcessamento = 0,
  [switch]$ProcessoUnico,
  # Conta sem senha que roda os serviços: "NT AUTHORITY\LocalService" ou uma gMSA do domínio ("DOMINIO\svc-inia$").
  # Vazio = LocalSystem (padrão do WinSW, como antes) - controla a máquina inteira; prefira uma conta própria.
  [string]$ContaServico = "",
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
if ($ProcessoUnico -and ($InstanciasApi -gt 1 -or $InstanciasProcessamento -gt 1)) { Falha "-ProcessoUnico é um processo só: não combina com -InstanciasApi/-InstanciasProcessamento maiores que 1." }
# A API recusa subir com menos de 2 (INIA_AI_MAX_CONCURRENT_CALLS, DATABASE_POOL_MAX): 0 = usar o backend\.env.
foreach ($par in @(@("-CotaIaApi", $CotaIaApi), @("-CotaIaProcessamento", $CotaIaProcessamento), @("-PoolApi", $PoolApi), @("-PoolProcessamento", $PoolProcessamento))) {
  if ($par[1] -eq 1) { Falha "$($par[0]) precisa ser 0 (usar o backend\.env) ou pelo menos 2." }
}

# Nome do serviço da instância i (a primeira mantém o nome antigo: atualizar uma instalação existente não cria um duplicado).
function Nome-Instancia([string]$base, [int]$i) { if ($i -eq 1) { return $base } else { return "$base-$i" } }

# Todos os que podem existir - inclusive instâncias a mais de uma instalação anterior (remover/reinstalar limpa qualquer formato).
$servicos = @(@("INIA-API", "INIA-Processamento", "INIA-Interface") + @(Get-Service -Name "INIA-*" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^INIA-(API|Processamento|Interface)(-\d+)?$" } | ForEach-Object { $_.Name })) | Select-Object -Unique
$instalar = @()
foreach ($i in 1..$InstanciasApi) { $instalar += (Nome-Instancia "INIA-API" $i) }
if (-not $ProcessoUnico) { foreach ($j in 1..$InstanciasProcessamento) { $instalar += (Nome-Instancia "INIA-Processamento" $j) } }
foreach ($i in 1..$InstanciasInterface) { $instalar += (Nome-Instancia "INIA-Interface" $i) }

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
# Versão implantada (campo `release` de cada log e ocorrência de erro): o arquivo RELEASE da raiz. Publicação por Git = o commit;
# sem Git (cópia da pasta), mantém o RELEASE que veio junto ou, se não houver, a versão do package.json.
$arquivoVersao = Join-Path $raiz "RELEASE"
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git -and (Test-Path (Join-Path $raiz ".git"))) {
  $commit = (& $git.Source -C $raiz rev-parse --short=12 HEAD 2>$null)
  if ($LASTEXITCODE -eq 0 -and $commit) { [IO.File]::WriteAllText($arquivoVersao, "$($commit.Trim())`n", (New-Object Text.UTF8Encoding($false))) }
}
if (Test-Path $arquivoVersao) { Ok "versão implantada: $((Get-Content -Raw $arquivoVersao).Trim()) (arquivo RELEASE)" } else { Ok "versão implantada: a do package.json (sem arquivo RELEASE)" }
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

# Conta do serviço (auditoria de segurança 17/10/2026, INFRA-2): sem ela o WinSW usa LocalSystem.
$contaDominio = ""
$contaUsuario = ""
if ($ContaServico) {
  if ($ContaServico -notmatch "^([^\\]+)\\([^\\]+)$") { Falha "-ContaServico no formato DOMINIO\conta (ex.: NT AUTHORITY\LocalService ou EMPRESA\svc-inia$)." }
  $contaDominio = $Matches[1]
  $contaUsuario = $Matches[2]
  # Só contas sem senha: a senha nunca vai para o XML do serviço em texto puro.
  if ($contaDominio -ne "NT AUTHORITY" -and -not $contaUsuario.EndsWith('$')) { Falha "-ContaServico aceita só conta sem senha: NT AUTHORITY\LocalService ou uma gMSA (nome terminado em `$)." }
  Ok "serviços rodam como $ContaServico"
} else {
  Write-Host "  AVISO  serviços rodando como LocalSystem (controla a máquina inteira). Prefira -ContaServico `"NT AUTHORITY\LocalService`" ou uma gMSA." -ForegroundColor Yellow
}

# Os .env guardam a chave da sessão, a chave de cifra dos segredos e a senha do banco: só Administradores, SYSTEM, quem
# instala e a conta do serviço leem (SIDs fixos - funcionam no Windows em português).
function Restringir-Arquivo([string]$arquivo) {
  if (-not (Test-Path $arquivo)) { return }
  $quem = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $concessoes = @("*S-1-5-32-544:(F)", "*S-1-5-18:(F)", "$($quem):(F)")
  if ($ContaServico) { $concessoes += "$($ContaServico):(R)" }
  & icacls.exe $arquivo /inheritance:r /grant:r @concessoes | Out-Null
  if ($LASTEXITCODE -ne 0) { Falha "Não consegui restringir o acesso a $arquivo (icacls)." }
  Ok "acesso a $arquivo restrito"
}
Restringir-Arquivo (Join-Path $raiz "backend\.env")
Restringir-Arquivo (Join-Path $raiz "frontend\.env.local")

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
# Uma instância: como antes (endereço do frontend\.env.local). Várias: a instância i escuta em 127.0.0.i (web farm do IIS).
function Argumentos-Interface([int]$i) {
  $argumentos = "`"$nextJs`" start -p $portaInterface"
  if ($InstanciasInterface -gt 1) { return "$argumentos -H 127.0.0.$i" }
  if ($hostInterface) { return "$argumentos -H $hostInterface" }
  return $argumentos
}
$exibicaoInterface = "todas as interfaces"; if ($hostInterface) { $exibicaoInterface = $hostInterface }
if ($InstanciasInterface -gt 1) { $exibicaoInterface = "127.0.0.1 a 127.0.0.$InstanciasInterface" }
Ok "interface: $InstanciasInterface instância(s) na porta $portaInterface ($exibicaoInterface)"

# Porta da API e do /health do processamento (as mesmas do backend\.env).
$portaApi = "3333"
$portaProcessamento = "3334"
foreach ($linha in Get-Content (Join-Path $raiz "backend\.env")) {
  if ($linha -match "^PORT=(\d+)") { $portaApi = $Matches[1] }
  if ($linha -match "^WORKER_HEALTH_PORT=(\d+)") { $portaProcessamento = $Matches[1] }
}

# --- 2. Arquivos dos serviços -----------------------------------------------------------------------------------
Passo "2/4 Gerando os arquivos dos serviços em $pastaServicos"
foreach ($id in $servicos) { Remover-Servico $id }
New-Item -ItemType Directory -Force -Path $pastaServicos | Out-Null
New-Item -ItemType Directory -Force -Path $pastaLogs | Out-Null
if ($ContaServico) {
  # Conta própria: lê a pasta da INIA, grava os registros e o cache da interface (frontend\.next).
  foreach ($par in @(@($raiz, "(OI)(CI)(RX)"), @($pastaLogs, "(OI)(CI)(M)"), @((Join-Path $raiz "frontend\.next"), "(OI)(CI)(M)"))) {
    & icacls.exe $par[0] /grant "$($ContaServico):$($par[1])" | Out-Null
    if ($LASTEXITCODE -ne 0) { Falha "Não consegui dar à conta $ContaServico acesso a $($par[0]) (icacls)." }
  }
  Ok "permissões da conta $ContaServico nas pastas da INIA"
}
$contaXml = ""
if ($ContaServico) {
  $contaXml = "  <serviceaccount>`r`n    <domain>$(Xml $contaDominio)</domain>`r`n    <user>$(Xml $contaUsuario)</user>`r`n    <allowservicelogon>true</allowservicelogon>`r`n  </serviceaccount>`r`n"
}

# Serviço do servidor = sempre modo produção (segredos obrigatórios, dados de demonstração recusados), mesmo que alguém
# troque o NODE_ENV do backend\.env: o dotenv não sobrescreve variável que o serviço já definiu.
$ambienteApi = "  <env name=""NODE_ENV"" value=""production""/>`r`n"
if ($ProxyInternet) {
  # A IA da INIA chama o Google pela internet (API e processamento); com proxy corporativo o Node 24 só o usa com
  # NODE_USE_ENV_PROXY=1.
  $ambienteApi += @"
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

function Linha-Env([string]$nome, [string]$valor) { return "  <env name=""$nome"" value=""$(Xml $valor)""/>`r`n" }

# Ambiente de cada instância (por cima do backend\.env: o dotenv não sobrescreve variável que o serviço já definiu).
function Ambiente-Api([int]$i) {
  $ambiente = $ambienteApi
  if ($InstanciasApi -gt 1) { $ambiente += (Linha-Env "HOST" "127.0.0.$i") }
  if ($CotaIaApi -gt 0) { $ambiente += (Linha-Env "INIA_AI_MAX_CONCURRENT_CALLS" "$CotaIaApi") }
  if ($PoolApi -gt 0) { $ambiente += (Linha-Env "DATABASE_POOL_MAX" "$PoolApi") }
  return $ambiente
}
function Ambiente-Processamento([int]$j) {
  $ambiente = $ambienteApi
  if ($portaProcessamento -ne "0") { $ambiente += (Linha-Env "WORKER_HEALTH_PORT" "$([int]$portaProcessamento + $j - 1)") }
  # O processamento só tem lote: uma vaga reservada (o mínimo) basta - o chat roda na API.
  if ($CotaIaProcessamento -gt 0) { $ambiente += (Linha-Env "INIA_AI_MAX_CONCURRENT_CALLS" "$CotaIaProcessamento") + (Linha-Env "INIA_AI_RESERVED_INTERACTIVE_CALLS" "1") }
  if ($PoolProcessamento -gt 0) { $ambiente += (Linha-Env "DATABASE_POOL_MAX" "$PoolProcessamento") }
  return $ambiente
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
  <!-- A API sai da prontidão, espera o IIS tirá-la da farm (INIA_SHUTDOWN_DRAIN_MS, 5 s) e tem até 25 s para terminar
       (INIA_SHUTDOWN_TIMEOUT_MS); 30 s aqui para o Windows não matar o processo antes disso. -->
  <stoptimeout>30 sec</stoptimeout>
  <logpath>$(Xml $pastaLogs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
$contaXml$ambiente</service>
"@
  Copy-Item -Force $WinSW (Join-Path $pastaServicos "$id.exe")
  [IO.File]::WriteAllText((Join-Path $pastaServicos "$id.xml"), $xml, (New-Object Text.UTF8Encoding($false)))
  Ok "$id.exe + $id.xml"
}

function Exibicao([string]$id) { return ($id -replace "^INIA-", "INIA - ") }
if ($ProcessoUnico) {
  Gravar-Servico "INIA-API" "INIA - API" "INIA: API e processamento (backend, processo único). Configuração em backend\.env." "`"$apiJs`" --role=all" (Join-Path $raiz "backend") (Ambiente-Api 1)
} else {
  foreach ($i in 1..$InstanciasApi) {
    $id = Nome-Instancia "INIA-API" $i
    Gravar-Servico $id (Exibicao $id) "INIA: API (telas, chat, voz e administração), instância $i de $InstanciasApi. Configuração em backend\.env." "`"$apiJs`" --role=api" (Join-Path $raiz "backend") (Ambiente-Api $i)
  }
  # O processamento também chama a IA: recebe o mesmo proxy/certificado da API.
  foreach ($j in 1..$InstanciasProcessamento) {
    $id = Nome-Instancia "INIA-Processamento" $j
    Gravar-Servico $id (Exibicao $id) "INIA: processamento (Workflows, feedbacks e tarefas periódicas; sem HTTP público), instância $j de $InstanciasProcessamento. Configuração em backend\.env." "`"$apiJs`" --role=worker" (Join-Path $raiz "backend") (Ambiente-Processamento $j)
  }
}
foreach ($i in 1..$InstanciasInterface) {
  $id = Nome-Instancia "INIA-Interface" $i
  Gravar-Servico $id (Exibicao $id) "INIA: interface web, instância $i de $InstanciasInterface. Configuração em frontend\.env.local." (Argumentos-Interface $i) (Join-Path $raiz "frontend") ""
}

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
Passo "4/4 Conferindo cada instância"
# Espera até 60 s por um 200 em $url; senão, aponta o log do serviço.
function Esperar-200([string]$url, [string]$id) {
  for ($tentativa = 0; $tentativa -lt 30; $tentativa++) {
    try {
      $resposta = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url
      if ($resposta.StatusCode -eq 200) { Ok "$id respondendo em $url"; return }
    } catch { Start-Sleep -Seconds 2 }
  }
  Falha "$id não respondeu em 60 s ($url) - veja $pastaLogs\$id.err.log e $pastaLogs\$id.out.log"
}
foreach ($i in 1..$InstanciasApi) {
  $enderecoApi = "127.0.0.1"; if ($InstanciasApi -gt 1) { $enderecoApi = "127.0.0.$i" }
  # /ready = pronta para receber tráfego (banco respondendo) - o mesmo que o health check da web farm consulta.
  Esperar-200 "http://$($enderecoApi):$portaApi/ready" (Nome-Instancia "INIA-API" $i)
}
if (-not $ProcessoUnico) {
  if ($portaProcessamento -eq "0") {
    Ok "processamento sem /health (WORKER_HEALTH_PORT=0) - confira os serviços INIA-Processamento em services.msc"
  } else {
    foreach ($j in 1..$InstanciasProcessamento) { Esperar-200 "http://127.0.0.1:$([int]$portaProcessamento + $j - 1)/health" (Nome-Instancia "INIA-Processamento" $j) }
  }
}
foreach ($i in 1..$InstanciasInterface) {
  $enderecoInterface = "127.0.0.1"; if ($InstanciasInterface -gt 1) { $enderecoInterface = "127.0.0.$i" }
  Esperar-200 "http://$($enderecoInterface):$portaInterface/healthz" (Nome-Instancia "INIA-Interface" $i)
}

$nomes = ($instalar | ForEach-Object { Exibicao $_ }) -join ", "
Write-Host "`nPronto. Gerencie em Serviços do Windows (services.msc): $nomes." -ForegroundColor Green
Write-Host "Registros: $pastaLogs" -ForegroundColor Green
if ($InstanciasApi -gt 1 -or $InstanciasInterface -gt 1) {
  Write-Host "Agora o IIS: .\configurar-iis.ps1 -Porta <porta pública> -InstanciasApi $InstanciasApi -InstanciasInterface $InstanciasInterface" -ForegroundColor Yellow
}
