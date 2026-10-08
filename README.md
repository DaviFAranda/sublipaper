# Sublipaper — Pedidos e produção

Aplicação local para pedidos, planejamento e acompanhamento da produção, com corte a laser, grades, romaneios, reimpressões e exportação de dados operacionais para planilhas.

## Execução

Requer Node.js 24 ou superior e Python com as dependências de `Pedidos/requirements.txt` instaladas.

```powershell
python -m pip install -r Pedidos/requirements.txt
npm start
```

No Windows, também pode ser usado `Iniciar Sublipaper.cmd`. A interface abre em `http://127.0.0.1:8780`. As outras máquinas da rede acessam o endereço do computador servidor, na mesma porta. O servidor deve permanecer ligado.

Copie `config.example.json` para `config.json` se precisar definir porta ou executável Python. Copie `Pedidos/config.example.json` para `Pedidos/config.json` e configure a pasta de artes da instalação. Configurações locais não são versionadas.

## Organização

- `public/`: interface unificada e módulos de pedidos/laser.
- `Pedidos/`: serviço Python, fluxo operacional e exportações.
- `unified.mjs`: inicialização dos serviços.
- `server.mjs`: serviço principal e integração.

Bancos, imagens de clientes, configurações locais, dependências instaladas e relatórios internos ficam fora do Git. Faça backup separado dos dados antes de atualizar uma instalação. Clonar este repositório não recupera os dados operacionais.

## Versionamento

A branch principal é `main`. Faça alterações em uma branch própria, revise a diferença e teste antes de atualizar a instalação em uso.

```powershell
git switch -c melhoria-descricao
git add caminho/do/arquivo
git diff --cached
git commit -m "Descreve a alteração"
git push -u origin melhoria-descricao
```

As exportações fornecem dados para planilhas; a configuração da conexão externa é feita separadamente. O aplicativo utiliza acesso direto, sem login, conforme o fluxo da instalação local.


## Publicação e atualização

Ao concluir mudanças solicitadas, o Codex verifica, cria commit e envia ao GitHub conforme AGENTS.md. Arquivos incompletos não são publicados automaticamente ao salvar. Para publicar manualmente uma alteração já revisada e testada, use **Publicar no GitHub.cmd** e escreva uma descrição, ou execute:

```powershell
powershell -NoProfile -File publicar.ps1 -Mensagem "Descrição da mudança"
```

No computador servidor, execute **Atualizar Sublipaper.cmd** para buscar origin/main, fazer backup consistente dos bancos e configurações, guardar o código anterior, atualizar por fast-forward e iniciar a nova versão. A autenticação do GitHub usa o gerenciador de credenciais do Git; uma instalação nova pode solicitar login no navegador.

O comando interrompe a atualização se existirem mudanças locais ou histórico divergente. Não atualiza durante apontamentos: aguarde o término da operação antes de usar as filas. Mesmo sem commits novos, faz backup e reinicia para carregar o código atual. Se a versão nova falhar, tenta voltar ao código anterior; os bancos permanecem preservados e o backup fica disponível para restauração assistida.

Backups ficam em **Backups_Sublipaper**, ao lado da pasta do sistema. Não incluem as artes externas nem substituem o backup habitual da fábrica. As máquinas que acessam pelo navegador recebem o sistema atualizado pelo mesmo servidor; recarregue a página após a atualização. Não há tarefa que reinicie a fábrica automaticamente durante o uso.

Teste isolado do atualizador (Windows): `python tests/test_updates.py`. Validação estática evita sintaxe inválida, mas não substitui os testes funcionais apropriados à mudança.


## GitHub Actions

O workflow **Validar Sublipaper** executa no envio à main, em pull requests para main e pelo botão Run workflow na aba Actions. Uma máquina Windows temporária recebe o código, Node.js 24, Python 3.12 e as dependências. Verifica sintaxe e testa atualização, backup, mudanças locais e recuperação após erro de sintaxe ou falha de inicialização, sempre com repositórios e bancos fictícios.

O resultado aparece junto ao commit e na aba Actions: verde quando os testes passam; vermelho quando falham. Os logs mostram qual etapa precisa de correção. Não usa senhas pessoais, não consulta os bancos da fábrica e não reinicia o servidor local. A instalação continua sendo atualizada pelo Atualizar Sublipaper.cmd, após conferir que a execução daquele commit ficou verde.

O teste remoto ocorre depois do envio ao GitHub; uma falha não desfaz o commit e o atualizador atual não consulta automaticamente o resultado do Actions. Para impedir merges quando os testes falharem, é necessário configurar uma regra de proteção da main exigindo Código e atualizador Windows. Essa regra não foi ativada nesta configuração. Minutos disponíveis e eventuais limites de execução dependem do plano da conta.
