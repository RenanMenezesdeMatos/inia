<#
.SYNOPSIS
  INIA - agenda a CÓPIA DE SEGURANÇA diária do banco interno (Agendador de Tarefas do Windows).

.DESCRIPTION
  Rode como ADMINISTRADOR, no servidor da aplicação, depois da instalação (npm run setup). Cria a tarefa
  "INIA - Backup do banco", que todo dia, no horário escolhido, roda:
    node scripts\install\db-backup.mjs --dir <Pasta> --keep-days <DiasRetencao>
  O comando faz a cópia (pg_dump), confere que ela abre (pg_restore --list) e apaga as cópias mais velhas que o prazo -
  nunca a mais nova. Código de saída diferente de 0 = falhou (veja "Último resultado" no Agendador e <Pasta>\backup.log).

  A cópia tem TODOS os dados da INIA, inclusive dados pessoais. A pasta fica acessível só a Administradores e ao SYSTEM.
  Mantenha também uma cópia FORA deste servidor (outro disco, outro servidor, armazenamento da empresa).

  Precisa das ferramentas do PostgreSQL (pg_dump e pg_restore) da MESMA versão do servidor do banco ou mais nova: vêm com o
  instalador do PostgreSQL (C:\Program Files\PostgreSQL\<versão>\bin, encontradas sozinhas) ou informe a pasta em -PastaPg.
  O endereço e a senha do banco vêm do backend\.env (o mesmo que a API usa); a senha nunca aparece na linha de comando.

  Teste de restauração (faça depois da primeira cópia e repita de tempos em tempos):
    npm run db:restore-check -- --dir <Pasta>

  ATENÇÃO: escrito e revisado sem execução num Windows real (20/10/2026) - rode uma vez com Start-ScheduledTask e confira
  o "Último resultado" (0) e o arquivo inia-*.dump na pasta.

.EXAMPLE
  .\agendar-backup.ps1 -Pasta D:\backup\inia
.EXAMPLE
  .\agendar-backup.ps1 -Pasta D:\backup\inia -Horario 03:30 -DiasRetencao 30 -PastaPg "C:\Program Files\PostgreSQL\17\bin"
.EXAMPLE
  .\agendar-backup.ps1 -Remover
#>
[CmdletBinding()]
param(
  [string]$Pasta = "",
  [string]$Horario = "02:00",
  [int]$DiasRetencao = 14,
  [string]$PastaPg = "",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$nomeTarefa = "INIA - Backup do banco"
function Passo([string]$texto) { Write-Host "`n== $texto" -ForegroundColor Cyan }
function Ok([string]$texto) { Write-Host "  OK  $texto" -ForegroundColor Green }
function Falha([string]$texto) { Write-Host "  ERRO  $texto" -ForegroundColor Red; exit 1 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Falha "Rode este script como Administrador." }

if ($Remover) {
  Passo "Removendo a tarefa"
  if (Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false
    Ok "tarefa removida (as cópias já feitas continuam na pasta)"
  } else { Ok "nenhuma tarefa para remover" }
  exit 0
}

if (-not $Pasta) { Falha "Informe a pasta das cópias: -Pasta D:\backup\inia (de preferência em outro disco)." }
if ($DiasRetencao -lt 0) { Falha "-DiasRetencao não pode ser negativo (0 = não apagar nenhuma cópia)." }
if ($Horario -notmatch '^\d{2}:\d{2}$') { Falha "-Horario no formato HH:mm (ex.: 02:00)." }

$raiz = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script = Join-Path $raiz "scripts\install\db-backup.mjs"
if (-not (Test-Path $script)) { Falha "Não encontrei $script - rode este arquivo de dentro da pasta da INIA (deploy\windows\backup)." }
if (-not (Test-Path (Join-Path $raiz "backend\.env"))) { Falha "backend\.env não existe - instale a INIA antes (npm run env:init / db:connect / setup)." }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Falha "Node.js não encontrado no PATH." }

Passo "Pasta das cópias"
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
# Só Administradores e SYSTEM (SIDs fixos - funcionam no Windows em português). A tarefa roda como SYSTEM.
& icacls.exe $Pasta /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)(F)" "*S-1-5-18:(OI)(CI)(F)" | Out-Null
if ($LASTEXITCODE -ne 0) { Falha "Não consegui restringir o acesso a $Pasta (icacls)." }
Ok "$Pasta (acesso só de Administradores e SYSTEM)"

Passo "Tarefa agendada"
$argumentos = "`"$script`" --dir `"$Pasta`" --keep-days $DiasRetencao"
if ($PastaPg) { $argumentos += " --pg-bin `"$PastaPg`"" }
$acao = New-ScheduledTaskAction -Execute $node -Argument $argumentos -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -Daily -At $Horario
# SYSTEM lê o backend\.env (o instalar-servicos.ps1 deixa o arquivo legível só por Administradores, SYSTEM, quem instalou e a
# conta dos serviços). StartWhenAvailable: se o servidor estava desligado no horário, a cópia roda quando ele voltar.
$quem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$opcoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
if (Get-ScheduledTask -TaskName $nomeTarefa -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false }
Register-ScheduledTask -TaskName $nomeTarefa -Action $acao -Trigger $gatilho -Principal $quem -Settings $opcoes -Description "Cópia de segurança diária do banco interno da INIA (npm run db:backup)." | Out-Null
Ok "`"$nomeTarefa`" todo dia às $Horario, guardando $DiasRetencao dias"

Write-Host "`nPara testar agora:" -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName `"$nomeTarefa`""
Write-Host "  (Get-ScheduledTaskInfo -TaskName `"$nomeTarefa`").LastTaskResult   # 0 = cópia feita e conferida"
Write-Host "  npm run db:restore-check -- --dir `"$Pasta`"                        # teste de restauração"
