param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$script:systemRoot=$PSScriptRoot
. (Join-Path $systemRoot 'ferramentas/deploy.ps1')
$lockName='Local\Sublipaper-Atualizacao-'+($systemRoot -replace '[^a-zA-Z0-9]','')
$updateLock=New-Object System.Threading.Mutex($false,$lockName)
if(-not $updateLock.WaitOne(0)){throw 'Já existe uma atualização em andamento.'}
$stopped=$false;$applied=$false;$oldCommit=$null;$newCommit=$null
try {
 if((Invoke-SystemGit -GitArgs @('branch','--show-current')) -ne 'main'){throw 'Atualize somente uma instalação na branch main.'}
 if(Invoke-SystemGit -GitArgs @('status','--porcelain')){throw 'Existem alterações locais. Publique ou revise essas mudanças antes de atualizar; nenhum arquivo foi sobrescrito.'}
 Invoke-SystemGit -GitArgs @('fetch','origin','--tags') | Out-Host
 $incomingFiles=Invoke-SystemGit -GitArgs @('ls-tree','-r','--name-only','origin/main')
 if(@($incomingFiles | Where-Object {$_ -match '(^|/)(dados|artes|uploads|python-libs|node_modules)/|(^|/)config\.json$|\.(sqlite3?|db)(-|$)|(^|/)\.env($|\.)'}).Count){throw 'A versão recebida contém dados ou configurações locais; atualização interrompida.'}
 $oldCommit=Invoke-SystemGit -GitArgs @('rev-parse','HEAD');$newCommit=Invoke-SystemGit -GitArgs @('rev-parse','origin/main')
 & git -C $systemRoot merge-base --is-ancestor $oldCommit $newCommit
 if($LASTEXITCODE -ne 0){throw 'O histórico local divergiu do GitHub. Atualização interrompida sem descartar commits.'}
 Test-SystemCode
 if($oldCommit -eq $newCommit){Write-Host 'O código já está atualizado. Será feito backup e reinício para carregar os arquivos atuais.'}
 $owned=Get-OwnedSystemProcess
 $backupParent=Join-Path (Split-Path $systemRoot -Parent) 'Backups_Sublipaper'
 $backupPath=Join-Path $backupParent ('atualizacao-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+$oldCommit.Substring(0,7)+'-'+([guid]::NewGuid().ToString('N').Substring(0,6)))
 # Cada alvo é absoluto e fica na pasta de backups irmã da instalação.
 $backupPath=[IO.Path]::GetFullPath($backupPath)
 if(-not $backupPath.StartsWith([IO.Path]::GetFullPath($backupParent)+[IO.Path]::DirectorySeparatorChar)){throw 'Pasta de backup inválida.'}
 Write-Host 'Pausando o sistema para backup e atualização. Aguarde antes de registrar novos apontamentos.'
 Stop-OwnedSystem $owned;$stopped=$true
 $python=Get-SystemPython
 & $python (Join-Path $systemRoot 'ferramentas/backup_atualizacao.py') $systemRoot $backupPath
 if($LASTEXITCODE -ne 0){throw 'Backup falhou; atualização cancelada.'}
 Invoke-SystemGit -GitArgs @('archive','--format=zip',"--output=$backupPath/codigo-anterior.zip",$oldCommit) | Out-Null
 @{before=$oldCommit;after=$newCommit;created=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupPath 'atualizacao.json') -Encoding UTF8
 Invoke-SystemGit -GitArgs @('merge','--ff-only','origin/main') | Out-Host;$applied=$true
 Test-SystemCode
 & (Join-Path $systemRoot 'iniciar.ps1') -NoBrowser:$NoBrowser
 if($LASTEXITCODE -ne 0){throw 'A versão nova não iniciou.'}
 Write-Host "Atualização concluída. Backup: $backupPath"
} catch {
 $failure=$_
 if($applied -and (Invoke-SystemGit -GitArgs @('rev-parse','HEAD')) -eq $newCommit -and -not (Invoke-SystemGit -GitArgs @('status','--porcelain'))){
  try {Stop-OwnedSystem (Get-OwnedSystemProcess);Invoke-SystemGit -GitArgs @('reset','--hard',$oldCommit) | Out-Host;Write-Warning 'O código anterior foi restaurado. O backup dos bancos foi preservado; nenhuma restauração automática de dados foi feita.'}catch{Write-Warning "Não foi possível reverter automaticamente: $_"}
 }
 if($stopped){try{& (Join-Path $systemRoot 'iniciar.ps1') -NoBrowser}catch{Write-Warning 'Consulte dados/logs. O backup está preservado.'}}
 throw $failure
} finally {$updateLock.ReleaseMutex();$updateLock.Dispose()}
