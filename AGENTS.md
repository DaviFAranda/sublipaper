# Sublipaper

## Orientação permanente do usuário
Depois de concluir cada alteração autorizada no código, verificar a diferença, executar os testes apropriados, criar commit com descrição clara e enviar a branch em uso ao origin, sem pedir autorização novamente. Na instalação principal a branch é main. Não enviar trabalho incompleto ou testes com falha. Se push/autenticação falhar, preservar o commit e informar a pendência.

Nunca versionar bancos, configurações locais, senhas, tokens, artes ou dados de clientes. Não alterar as planilhas externas sem autorização. Os testes de produção usam bases isoladas.

## Atualização da instalação
Use Atualizar Sublipaper.cmd (atualizar.ps1) no servidor para backup, atualização por fast-forward e reinício. Não realizar reset ou descarte de mudanças do usuário para permitir uma atualização. O rollback do atualizador só pode desfazer a atualização que ele próprio acabou de aplicar, com árvore limpa.
