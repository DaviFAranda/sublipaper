# Núcleo de integração da fábrica

- Este diretório é uma implementação isolada em desenvolvimento. Não apontar seus testes para os bancos oficiais.
- Use o Python com Pillow do iniciador e rode `python -m unittest -v tests integracao_fabrica.test_core integracao_fabrica.test_connectors integracao_fabrica.test_api integracao_fabrica.test_launcher` na raiz `Sistema Sublipaper`.
- `Iniciar Sistema.bat` liga esta API local junto a Pedidos. Com o banco atual de Pedidos como origem, rotas de escrita fabril ficam bloqueadas até existir integração homologada.
- `core.py` usa SQLite de teste explícito. `schema_postgresql.sql` é o alvo ainda não implantado; não executar no banco de Estoque.
- Conectores abrem os bancos existentes somente em modo leitura e deixam trabalhos Digital sem vínculo automático com arte/OP.
- Respeitar o serviço e o preço por unidade do pedido atual. Quantidade parcial pertence à OP.
- Valor comercial só é visível para Comercial, Financeiro e Gestão conforme os métodos atuais. Novas respostas e exportações devem aplicar a mesma política.
- Não adicionar credenciais, `.env`, dump, chave privada ou dados de clientes ao código versionado.
