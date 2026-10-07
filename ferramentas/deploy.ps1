$ErrorActionPreference='Stop'
function Invoke-SystemGit {
 param([string[]]$GitArgs)
 $result=& git -C $script:systemRoot @GitArgs
 if($LASTEXITCODE -ne 0){throw "Git falhou: $($GitArgs[0])"}
 return $result
}
function Get-SystemPython {
 $config=Join-Path $script:systemRoot 'config.json'
 if(Test-Path -LiteralPath $config){$settings=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json;if($settings.python){return $settings.python}}
 $bundled=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
 if(Test-Path -LiteralPath $bundled){return $bundled}
 return 'python'
}
function Test-SystemCode {
 $python=Get-SystemPython
 & $python (Join-Path $script:systemRoot 'ferramentas/verificar_codigo.py') $script:systemRoot
 if($LASTEXITCODE -ne 0){throw 'Verificação do código falhou; nada será publicado ou atualizado.'}
 foreach($file in Get-ChildItem -LiteralPath $script:systemRoot -Filter '*.ps1' -Recurse | Where-Object {$_.FullName -notmatch '[\/]dados[\/]|[\/]python-libs[\/]'}){
  $tokens=$null;$parseErrors=$null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count){throw "PowerShell inválido: $($file.FullName): $parseErrors"}
 }
}
function Get-SystemAddress {
 $port=8780;$config=Join-Path $script:systemRoot 'config.json'
 if(Test-Path -LiteralPath $config){$settings=Get-Content -LiteralPath $config -Raw | ConvertFrom-Json;if($settings.port){$port=[int]$settings.port}}
 return @{Port=$port;Url="http://127.0.0.1:$port"}
}
function Get-OwnedSystemProcess {
 $address=Get-SystemAddress
 $listeners=@(Get-NetTCPConnection -LocalPort $address.Port -State Listen -ErrorAction SilentlyContinue)
 if(-not $listeners.Count){return $null}
 $health=Invoke-RestMethod "$($address.Url)/api/health" -TimeoutSec 3
 if($health.app -ne 'sublipaper-unificado' -or $health.root -ne $script:systemRoot){throw 'A porta está ocupada por outra instalação; atualização interrompida.'}
 $ownerIds=@($listeners.OwningProcess | Select-Object -Unique)
 if($ownerIds.Count -ne 1){throw 'Mais de um processo na porta do sistema.'}
 $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($ownerIds[0])"
 if($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'unified\.mjs'){throw 'O processo não é o inicializador esperado.'}
 return $process
}
function Stop-OwnedSystem($process) {
 if(-not $process){return}
 $serverFile=[IO.Path]::GetFullPath((Join-Path $script:systemRoot 'Pedidos\server.py'))
 $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.ProcessId)" | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($serverFile)})
 foreach($child in $children){Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue}
 Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
}
