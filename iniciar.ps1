$ErrorActionPreference='Stop'
$systemRoot=$PSScriptRoot
$systemPort=8780
$systemConfig=Join-Path $systemRoot 'config.json'
if(Test-Path -LiteralPath $systemConfig){$systemSettings=Get-Content -LiteralPath $systemConfig -Raw | ConvertFrom-Json;if($systemSettings.port){$systemPort=[int]$systemSettings.port}}
$systemUrl="http://127.0.0.1:$systemPort"
$systemListeners=@(Get-NetTCPConnection -LocalPort $systemPort -State Listen -ErrorAction SilentlyContinue)
if($systemListeners.Count){
 try{$systemHealth=Invoke-RestMethod "$systemUrl/api/health" -TimeoutSec 3}catch{throw 'A porta está ocupada por outro programa. Consulte o responsável pelo servidor.'}
 if($systemHealth.app -eq 'sublipaper-unificado' -and $systemHealth.version -eq '3.0.0' -and $systemHealth.pedidos -and $systemHealth.root -eq $systemRoot){Start-Process $systemUrl -WindowStyle Hidden;exit 0}
 throw 'Uma versão anterior está aberta. Feche a janela antiga do sistema e execute este iniciador novamente. Seus dados foram preservados.'
}
$nodeCommand=Get-Command node -ErrorAction SilentlyContinue
$systemNode=if($nodeCommand){$nodeCommand.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(-not(Test-Path -LiteralPath $systemNode)){throw 'Node.js 24 ou superior é necessário no computador servidor.'}
$systemNodeVersion=& $systemNode -p 'Number(process.versions.node.split(".")[0])'
if([int]$systemNodeVersion -lt 24){throw 'Atualize o Node.js para a versão 24 ou superior.'}
$systemLogs=Join-Path $systemRoot 'dados\logs'
New-Item -ItemType Directory -Path $systemLogs -Force | Out-Null
$systemLock=New-Object System.Threading.Mutex($false,'Local\Sublipaper-Unificado-8780')
if(-not $systemLock.WaitOne(0)){throw 'O sistema já está iniciando. Aguarde alguns segundos.'}
try{
 $systemProcess=Start-Process -FilePath $systemNode -ArgumentList 'unified.mjs' -WorkingDirectory $systemRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $systemLogs 'servidor.log') -RedirectStandardError (Join-Path $systemLogs 'erros.log') -PassThru
 $systemReady=$false
 for($systemAttempt=0;$systemAttempt -lt 60;$systemAttempt++){
  Start-Sleep -Milliseconds 500
  if($systemProcess.HasExited){throw 'O sistema não iniciou. Consulte dados\logs\erros.log.'}
  try{$systemHealth=Invoke-RestMethod "$systemUrl/api/health" -TimeoutSec 1;if($systemHealth.app -eq 'sublipaper-unificado' -and $systemHealth.pedidos){$systemReady=$true;break}}catch{}
 }
 if(-not $systemReady){throw 'A inicialização demorou mais que o esperado. Consulte dados\logs\erros.log.'}
 Write-Host 'Pedidos e Corte a Laser iniciados. Os demais computadores acessam pelo navegador (ACESSO-REDE.txt).'
 Start-Process $systemUrl -WindowStyle Hidden
}finally{$systemLock.ReleaseMutex();$systemLock.Dispose()}
