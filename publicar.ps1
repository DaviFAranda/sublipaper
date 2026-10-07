param([string]$Mensagem)
$ErrorActionPreference='Stop'
if([string]::IsNullOrWhiteSpace($Mensagem)){$Mensagem=Read-Host 'Descreva a mudança concluída'}
if([string]::IsNullOrWhiteSpace($Mensagem)){throw 'A descrição não pode ficar vazia.'}
$script:systemRoot=$PSScriptRoot
. (Join-Path $systemRoot 'ferramentas/deploy.ps1')
Test-SystemCode
Invoke-SystemGit -GitArgs @('add','--all') | Out-Null
& git -C $systemRoot diff --cached --quiet
if($LASTEXITCODE -eq 1){Invoke-SystemGit -GitArgs @('commit','-m',$Mensagem) | Out-Host}elseif($LASTEXITCODE -ne 0){throw 'Falha ao conferir mudanças.'}
$branch=Invoke-SystemGit -GitArgs @('branch','--show-current')
if(-not $branch){throw 'Selecione uma branch antes de publicar.'}
Invoke-SystemGit -GitArgs @('push','-u','origin',$branch,'--follow-tags') | Out-Host
Write-Host 'Código publicado no GitHub. Os dados locais não foram enviados.'
