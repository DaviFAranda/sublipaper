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

### Organização da versão 3.1

A interface usa módulos nativos, sem etapa de compilação. `public/factory.mjs` controla apenas navegação e inicialização; `public/app/production.mjs` trata PCP e filas; `overview.mjs` trata acompanhamento; `order-model.mjs` concentra a projeção de situação compartilhada entre dashboard e pedidos; `api.mjs` mantém o transporte e as chaves de reenvio; `closing.mjs` apresenta a conferência final. `commercial.mjs` mantém cadastro e seleção de artes e utiliza um template separado. `workspace.css` define o padrão visual comum.

O núcleo Python de produção e os bancos existentes são mantidos para preservar o histórico e as regras já operacionais. Esta é uma reconstrução gradual: não existe migração destrutiva de dados nem substituição das planilhas de faturamento. Serviços posteriores respeitam a liberação e a quantidade útil das etapas anteriores.

`Pedidos/closing.py` é uma projeção sem escrita dos registros. A aba **Concluídos e dados** distingue entrega operacional de pendências de informação e reúne artes, referências, consumos, medições por etapa/unidade, grades, reimpressões e reposições no pedido original. Quantidades de unidades diferentes não são somadas; medições de etapas diferentes também não representam uma única saída final. O total de laser já inclui suas reimpressões.

Os CSV de integração usam metros para larguras, comprimentos, medições e totais laser; as colunas antigas de comprimento `CM_*`/`*_CM` passam a `M_*`/`*_M`. Campos JSON explicitamente terminados em `Cm` mantêm a unidade histórica para compatibilidade, com conversão na apresentação. `fechamentos.csv` adiciona uma linha por pedido e `dados.json` acrescenta `closeouts`. Preços desconhecidos permanecem nulos. `CUSTO_CONHECIDO` considera apenas os consumos precificados; `CONSUMOS_REGISTRADOS_COM_PRECO` indica cobertura de preços dos registros disponíveis, não certifica o custo total da fábrica. Referências externas devem ser conferidas com os cadastros SAPP/PEDIDOS; sua ausência é visível e não bloqueia automaticamente um serviço onde não se aplicam.

Testes isolados: `node --test tests/*.test.mjs` e `python tests/test_closing.py`. Verificam paralelismo das etapas, vínculo com pedido original, entrega, consumo, referências, unidades e o contrato de exportação. Também são executados no GitHub Actions.

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

Comprimentos são informados e apresentados em metros em Pedidos, PCP, produção, fechamento e romaneios. Apenas o editor de proporções da grade laser usa centímetros para dimensões da grade e das peças. Os bancos existentes não precisam de migração: os campos em metros permanecem em metros e registros antigos explicitamente em centímetros são convertidos ao exibir. Peças e quilos mantêm suas unidades. As planilhas externas não são alteradas pelo aplicativo.
