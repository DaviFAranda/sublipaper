#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$ruleName = 'Sublipaper-Corte-Laser-LAN'
Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $ruleName -DisplayName 'Sublipaper Corte a Laser - rede local' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8780 -Profile Private -RemoteAddress LocalSubnet | Out-Null
Write-Host 'Acesso liberado para computadores da mesma rede privada na porta 8780.'
'Rede liberada com sucesso.' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'REDE-LIBERADA.txt')
