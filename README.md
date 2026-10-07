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
