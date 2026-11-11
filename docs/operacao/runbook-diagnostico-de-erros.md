# Runbook — diagnóstico de erros na VM da INIA

Para o administrador da VM (Windows Server + IIS + serviços WinSW). Funciona **sem Claude, sem internet e sem ferramenta
externa**: só PowerShell, os arquivos de log e o Node que já roda a INIA.

A pessoa que viu o erro copia da tela (botão **Copiar detalhes para suporte**):

```
INIA — detalhes para o suporte
Código: INIA-BANCO-INDISPONIVEL
Referência: 5f0c2a9e-4b1d-4c37-9a51-2f1e7c0d9b3a (registrada no servidor)
Horário (UTC): 2026-11-11T13:02:11.204Z
Status: 500
Tela: /supervisor
Versão: 32e364c7
```

- **Código** = o tipo de falha (o que procurar no catálogo).
- **Referência** = esta ocorrência (o que procurar nos registros). A nota ao lado diz onde ela está:
  `registrada no servidor` (API ou servidor da interface), `procurar no registro do servidor de acesso (IIS)` (a falha nasceu no
  proxy, antes da API) ou `local — ainda não enviada ao servidor` (navegador sem conexão: não procure no servidor ainda).
- **Status** = o status HTTP da resposta, quando houve resposta.
- **Horário** sempre em UTC (o mesmo dos logs). Brasília = UTC − 3.

## 0. Antes de tudo (cole uma vez por sessão do PowerShell)

```powershell
$INIA = "C:\INIA"          # pasta onde a INIA foi instalada (a que tem backend, frontend e logs)
$REF  = "<referência>"     # cole a referência copiada da tela
$COD  = "<código>"         # cole o código copiado da tela
```

## 1. O que o código significa

Três caminhos, mesma fonte (o catálogo versionado no código):

```powershell
# a) Terminal da VM (não precisa da interface):
Set-Location "$INIA\backend"; node dist\main\diagnostico-de-erros.js $COD
# lista códigos que contêm um trecho:
node dist\main\diagnostico-de-erros.js --buscar BANCO
```

- b) Interface: **Administração › Plataforma › Diagnóstico de erros** (papel Administrador geral, escopo de organização).
- c) Documento: `docs\operacao\catalogo-de-erros.md` (abre no Bloco de Notas) ou, pelo PowerShell:

```powershell
$cat = Get-Content -Raw "$INIA\docs\operacao\catalogo-de-erros.json" | ConvertFrom-Json
$cat.entries | Where-Object { $_.code -eq $COD -or $_.aliases -contains $COD } | Format-List code, module, httpStatus, severity, trigger, technicalDescription, recovery, escalation
$cat.domainCodes | Where-Object code -eq $COD | Format-List   # códigos de regra de negócio dos módulos
```

Cada entrada traz as **causas prováveis como hipóteses**, cada uma com o **sinal** que a confirma e afasta as outras, as
verificações em ordem, onde buscar a evidência e para quem escalar. Não trate a primeira hipótese como causa sem ver o sinal.

## 2. Achar a ocorrência pela referência

```powershell
# a) Tudo de uma vez (banco + arquivos de log), pela CLI:
Set-Location "$INIA\backend"; node dist\main\diagnostico-de-erros.js $REF

# b) Só os logs dos serviços (API, Processamento e Interface):
Select-String -Path "$INIA\logs\INIA-*.log" -SimpleMatch $REF | Select-Object -Last 30

# c) Log do IIS (pedido e resposta passam pelo campo x-request-id):
Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch $REF | Select-Object -Last 10
```

As linhas da API são JSON. Para ler só os campos que importam:

```powershell
Select-String -Path "$INIA\logs\INIA-API*.log" -SimpleMatch $REF | ForEach-Object { $_.Line | ConvertFrom-Json } |
  Format-List time, service, release, event, code, status, severity, route, reference, failure
```

Campos de cada linha de erro: `time` (UTC, ISO), `service` (`inia-api`, `inia-processamento`, `inia-api-processamento`,
`inia-interface`), `release` (versão implantada), `event` (`http_error`, `stream_error`, `job_error`, `client_error`,
`interface_error`, `unhandled_rejection`, `uncaught_exception`), `code`, `status`, `severity`, `route` (sem ids nem parâmetros),
`reference` e, nas falhas inesperadas, `failure` (nome, mensagem e pilha **já sanitizados**: sem e-mail, CPF, token ou senha).

Onde cada origem grava:

| Origem | Referência | Onde procurar |
| --- | --- | --- |
| API (4xx/5xx) | `x-request-id` (UUID) | `logs\INIA-API*.out.log` + banco (`error_occurrences`) |
| Chat da INIA depois de começar a responder | `x-request-id` da pergunta | `logs\INIA-API*.out.log` (`stream_error`) + banco |
| Tarefa periódica | `job-<tarefa>-<uuid>` | `logs\INIA-Processamento*.out.log` (`job_error`) + banco |
| Falha do processo Node | `proc-<uuid>` | log do serviço (`unhandled_rejection`/`uncaught_exception`) + `INIA-*.wrapper.log` |
| Tela quebrada no navegador | `web-<uuid>` | banco (quando a tela diz "registrada"), `client_error` no log da API |
| Tela quebrada no servidor da interface | digest numérico | `logs\INIA-Interface*.err.log` (`interface_error`) |
| Proxy (IIS sem a API) | o `x-request-id` enviado pelo navegador | log do IIS (`sc-status` 502/503/504) |

## 3. Saúde dos serviços, do proxy e do banco

```powershell
Get-Service INIA-* | Format-Table Name, Status, StartType
Get-Service W3SVC, WAS | Format-Table Name, Status
Get-Website | Format-Table Name, State, PhysicalPath
Invoke-RestMethod http://127.0.0.1:3333/health     # processo da API de pé           -> {"status":"ok"}
Invoke-RestMethod http://127.0.0.1:3333/ready      # API pronta (banco respondendo)   -> {"status":"ready"}; 503 = sem banco/desligando
Invoke-RestMethod http://127.0.0.1:3000/healthz    # interface (next start)          -> {"status":"ok","service":"inia-interface"}
Invoke-RestMethod http://127.0.0.1:3334/health     # Processamento (worker), se instalado
Invoke-RestMethod http://localhost/health          # pelo IIS (endereço público, porta do site)
Invoke-RestMethod http://127.0.0.1:3333/internal/metrics   # só na própria VM: erros por rota, tarefas, pool, ocorrências
```

Com várias instâncias, a instância *n* usa `127.0.0.n` (ex.: `127.0.0.2:3333`). Estado das web farms: Gerenciador do IIS ›
Server Farms › INIA-API / INIA-Interface › Monitoring and Management.

Banco (PostgreSQL), quando a API diz `INIA-BANCO-*`:

```powershell
Get-Service postgresql* | Format-Table Name, Status
# Com o psql do PostgreSQL instalado (ajuste a pasta da versão):
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U inia -d inia -c "select pid, state, wait_event_type, now()-query_start as tempo, left(query,80) from pg_stat_activity where datname='inia' order by tempo desc nulls last limit 15;"
```

## 4. Logs: local, rotação e guarda

| Log | Onde | Rotação / guarda |
| --- | --- | --- |
| Serviços (API, Processamento, Interface) | `$INIA\logs\<serviço>.out.log` (saída), `.err.log` (erros do processo; a interface grava `interface_error` aqui), `.wrapper.log` (WinSW: subidas, quedas, reinícios) | WinSW `roll-by-size`: 10 MB por arquivo, 8 arquivos guardados por fluxo (≈ 80 MB por serviço). O mais antigo é apagado. |
| IIS | `C:\inetpub\logs\LogFiles\W3SVC<id do site>\u_exAAMMDD.log` (horário UTC) | um arquivo por dia; o IIS **não apaga** sozinho — limpe com a política da empresa. |
| Ocorrências no banco | tabela `error_occurrences` | `INIA_ERROR_OCCURRENCE_RETENTION_DAYS` (padrão 30 dias), apagadas de hora em hora pela tarefa `error-occurrences-purge`. |

Os logs dos serviços são a fonte primária: a gravação no banco é assíncrona, tem teto por minuto (600 falhas graves e 120
comuns por processo) e não acontece com o banco fora do ar. O 404 de endereço inexistente da API fica só no log.

Id do site no IIS (para achar a pasta `W3SVC<id>`): `Get-Website INIA | Select-Object id, name`.

## 5. Referência sem registro

Nada no banco nem nos logs? Siga nesta ordem:

1. **A tela dizia "local — ainda não enviada ao servidor"?** O navegador estava sem conexão. A ocorrência só chega quando a rede
   volta e a pessoa reabre a INIA na mesma aba. Use o horário e a tela para procurar no log do IIS.
2. **Falha no proxy (IIS) antes da API** (`INIA-PROXY-INDISPONIVEL`, `INIA-REDE-API-INALCANCAVEL`): procure no log do IIS
   (seção 6). Se nem o IIS tem a referência, o pedido não chegou à VM (rede, DNS, certificado, VPN).
3. **Banco fora no momento**: procure só nos arquivos (`Select-String … $REF`). A linha está lá com o mesmo código.
4. **Fora da guarda** (mais de 30 dias no banco; logs do WinSW rotacionados): restam o horário e o log do IIS.
5. **Outra organização**: a tela de diagnóstico só mostra ocorrências da organização de quem consulta (e as sem organização).
   A CLI da VM vê todas.
6. **Erro de renderização no servidor da interface** (referência só com dígitos): procure em `INIA-Interface*.err.log`.
7. Ainda nada: anote código, horário UTC e tela, e procure por horário:

```powershell
$de = [datetime]"2026-11-11T13:00:00Z"; $ate = $de.AddMinutes(10)
Get-Content "$INIA\logs\INIA-API.out.log" | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } |
  Where-Object { $_.time -and [datetime]$_.time -ge $de -and [datetime]$_.time -le $ate -and $_.level -ge 40 } |
  Format-Table time, code, status, route, reference
```

## 6. Erro gerado no proxy (IIS/ARR)

A interface identifica: resposta 502/503/504 **sem** o cabeçalho `x-inia-release` da API = a resposta veio do IIS. Código
`INIA-PROXY-INDISPONIVEL`, referência = o `x-request-id` que o navegador enviou (gravado no log do IIS pelo campo personalizado
`x-request-id`, criado pelo `configurar-iis.ps1`).

```powershell
Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -SimpleMatch $REF
# Ler os campos: a 1ª linha "#Fields:" do arquivo diz a ordem. Os que importam:
#   sc-status sc-substatus sc-win32-status time-taken x-request-id
```

| `sc-status`.`sc-substatus` | Significa | Verifique |
| --- | --- | --- |
| 502.3 | a instância da API não respondeu (parada, reiniciando ou passou de 5 min) | `Get-Service INIA-API*`; `time-taken` ≈ 300000 = prazo do ARR |
| 502.4 / 503 | nenhuma instância saudável na web farm | `Invoke-RestMethod http://127.0.0.1:3333/ready` (503 = banco) |
| 504 | prazo esgotado no proxy | consulta lenta (`INIA-BANCO-TIMEOUT`) ou IA lenta |

O IIS **não** entrega página própria da INIA nesses casos: a falha aparece para a pessoa como a tela de erro da INIA quando o app
já estava aberto (a chamada à API falhou); se a própria interface estiver fora, aparece a página de erro do IIS (ver seção 7).

Instalações antigas (antes deste runbook) não têm o campo `x-request-id` no log do IIS: rode de novo o `configurar-iis.ps1`
(ele é idempotente) ou crie os campos à mão:

```powershell
& "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.applicationHost/sites "/+[name='INIA'].logFile.customFields.[logFieldName='x-request-id',sourceName='x-request-id',sourceType='RequestHeader']" /commit:apphost
& "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.applicationHost/sites "/+[name='INIA'].logFile.customFields.[logFieldName='x-request-id-resposta',sourceName='x-request-id',sourceType='ResponseHeader']" /commit:apphost
```

## 7. Interface totalmente indisponível

A pessoa vê a página de erro do IIS (ou do navegador) em vez da INIA — não há código nem referência da INIA. Use o horário.

```powershell
Get-Service INIA-Interface*, INIA-API*, W3SVC | Format-Table Name, Status
Invoke-RestMethod http://127.0.0.1:3000/healthz
Get-Content "$INIA\logs\INIA-Interface.wrapper.log" -Tail 40     # o WinSW registra quedas e reinícios
Get-Content "$INIA\logs\INIA-Interface.err.log" -Tail 60
Select-String -Path "C:\inetpub\logs\LogFiles\W3SVC*\u_ex*.log" -Pattern " 50[234] " | Select-Object -Last 20
```

Causas comuns, pela ordem: serviço parado depois de atualização (build da interface ausente — `frontend\.next` sem `BUILD_ID`);
porta 3000 ocupada por outro processo (`Get-NetTCPConnection -LocalPort 3000`); disco cheio (`Get-PSDrive C`); conta do serviço
sem permissão em `frontend\.next` ou `logs`. Recuperação: `Start-Service INIA-Interface` (o WinSW já reinicia sozinho após falha:
10 s e depois 30 s).

**Sem internet no navegador, abrindo a INIA do zero:** a INIA não tem service worker; o navegador mostra a página "sem internet"
dele. Com a INIA já aberta, a tela "Opa, perdemos a conexão" aparece por cima e o que foi digitado continua.

## 8. Ensaio rápido (para conferir a instalação)

1. Abra a INIA, entre como administrador geral e acesse um endereço inexistente: `/nao-existe` → tela "Essa página sumiu do mapa"
   (status 404 no log do IIS).
2. Entre como uma conta sem papéis e abra `/api/v1/admin/error-diagnostics/codes` no navegador → JSON 403 com `reference`.
3. Procure essa referência: `node dist\main\diagnostico-de-erros.js <referência>` → mostra a ocorrência `FORBIDDEN` e a explicação.
4. Pare a API por um instante (`Stop-Service INIA-API`), clique em algo na INIA → tela de falha com `INIA-PROXY-INDISPONIVEL`; a
   referência aparece no log do IIS com `sc-status` 502. `Start-Service INIA-API` ao terminar.
