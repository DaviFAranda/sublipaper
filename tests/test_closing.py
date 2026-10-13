"""Isolated order-to-spreadsheet contract tests. Never opens factory databases."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from contextlib import contextmanager

@contextmanager
def connection(path):
    db=sqlite3.connect(path)
    try:
        with db: yield db
    finally: db.close()

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Pedidos'))
from closing import close_orders, closeout_rows, CLOSEOUT_HEADERS
from operations_workflow import OperationsWorkflow
from sheet_bridge import dataset, csv_rows, HEADERS


class ClosingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sublipaper-closing-')
        self.folder = Path(self.temp.name)
        self.db = self.folder / 'pedidos.sqlite3'
        with connection(self.db) as db:
            db.executescript('''
                CREATE TABLE orders(id INTEGER PRIMARY KEY,number TEXT,client TEXT,service TEXT,
                    fabric TEXT,width_m TEXT,created_at TEXT,delivery TEXT,nf TEXT,deleted_at TEXT);
                CREATE TABLE items(id INTEGER PRIMARY KEY,order_id INTEGER,art TEXT,quantity TEXT,unit TEXT,price TEXT);
                INSERT INTO orders VALUES(1,'EX-DEMO','Cliente Demonstração','Venda de Papel','','1.6','2026-10-09','2026-10-16','',NULL);
                INSERT INTO items VALUES(10,1,'arte-demonstracao.tif','10','m','5');
            ''')
        self.workflow = OperationsWorkflow(self.folder / 'operacoes.sqlite3', self.db, '')
        self.order = dict(id=1, number='EX-DEMO', client='Cliente Demonstração', service='Venda de Papel',
            fabric='', width_m='1.6', unit='m', delivery='2026-10-16', items=[dict(id=10,art='arte-demonstracao.tif',quantity='10',unit='m',original_path='demo.tif')])

    def tearDown(self):
        target=Path(self.temp.name).resolve()
        assert target.parent==Path(tempfile.gettempdir()).resolve() and target.name.startswith('sublipaper-closing-')
        self.temp.cleanup()

    def act(self, action, **extra):
        return self.workflow.apply('transition', self.order,
            dict(item_id=10,action=action,request_key=action,**extra),'Operador Demonstração','gestao')

    def produce(self):
        self.workflow.apply('release', self.order, {'request_key':'release'}, 'Operador Demonstração', 'gestao')
        options = dict(machine='SOLIS',reference='1,60 m')
        self.act('printing', **options)
        self.act('printed', output='10',loss='0',measurement_unit='m',consumption=[dict(material='Tinta',unit='ml',quantity='20',unit_cost='0.2')],**options)

    def test_full_order_exports_delivery_usage_and_references(self):
        self.workflow.apply('configure',self.order,dict(request_key='refs',kind='references',item_id=10,ft_id='FT-DEMO',sku_id='SKU-DEMO'),'PCP Demonstração','gestao')
        self.produce()
        self.act('packed',reference='VOL-DEMO',machine='Retirada')
        self.act('delivered',machine='Recebedor Demonstração')
        data = dataset(self.db, '')
        result = data['closeouts'][0]
        self.assertTrue(result['completed'])
        self.assertEqual(result['deliveredItems'], 1)
        self.assertEqual(result['knownConsumptionCost'], '4.0')
        self.assertFalse(result['costComplete'])  # Automatic paper consumption has no invented price.
        self.assertEqual(result['pendingConsumptionPrices'], 1)
        self.assertEqual(result['references'][0]['ft_id'], 'FT-DEMO')
        self.assertTrue(result['deliveryAt'])
        self.assertEqual(csv_rows(data,'medicoes')[0]['BOAS'], '10')
        self.assertEqual(csv_rows(data,'medicoes')[0]['UNIDADE'], 'm')
        self.assertEqual(csv_rows(data,'pedidos')[0]['PEDIDO_NUM'], 'EX-DEMO')
        self.assertEqual(csv_rows(data,'consumos')[0]['FT_ID'], 'FT-DEMO')
        for kind in HEADERS:
            for row in csv_rows(data,kind): self.assertEqual(set(row),set(HEADERS[kind]))

    def test_undelivered_order_is_not_complete(self):
        self.produce()
        self.assertFalse(dataset(self.db,'')['closeouts'][0]['completed'])

    def test_delivery_cannot_skip_production(self):
        self.workflow.apply('release',self.order,{'request_key':'release'},'Operador Demonstração','gestao')
        with self.assertRaises(ValueError): self.act('delivered',machine='Recebedor Demonstração')

    def test_replacement_records_stay_on_original_order(self):
        self.produce()
        with connection(self.folder/'operacoes.sqlite3') as db:
            db.execute("INSERT INTO replenishment_batches(token,root_order,root_item,source_item,source_action,print_m,final_qty,final_unit,snapshot,reason,actor,created_at) VALUES('fake','EX-DEMO',10,10,'printed','2','2','m','{}','Demonstração','QA','2026-10-09')")
            db.execute("INSERT INTO production_measurements VALUES(-1,'printed','2','2','0','2','m','Demonstração','QA','2026-10-09')")
        result=dataset(self.db,'')['closeouts'][0]
        self.assertEqual(result['replacementBatches'],1)
        self.assertTrue(all(m['orderNumber']=='EX-DEMO' and m['rootItemId']==10 for m in result['measurements']))
        self.assertEqual(len(result['items']),1)
        self.assertEqual(result['measurementTotals'][0]['processed'],'12')

    def test_missing_history_is_visible_not_fabricated(self):
        result=dataset(self.db,'')['closeouts'][0]
        self.assertFalse(result['completed'])
        self.assertFalse(result['costComplete'])
        self.assertIn('no_history',[i['code'] for i in result['issues']])
        self.assertIn('no_consumption',[i['code'] for i in result['issues']])

    def test_laser_reprint_meterage_is_not_added_twice(self):
        data=dataset(self.db,'')
        data['grades']=[dict(sourceOrderId=1,rootItemId=10,jobId='grade',calculatedCm=900,reprintCm=300,
            reprints=[dict(id='r',status='done',calculatedCm=300)])]
        result=close_orders(data)[0]
        self.assertEqual(result['laserCm'],900)
        self.assertEqual(result['laserReprintCm'],300)
        self.assertEqual(result['laserReprintsDone'],1)
        self.assertEqual(set(closeout_rows([result])[0]),set(CLOSEOUT_HEADERS))
        self.assertEqual(closeout_rows([result])[0]['M_LASER'],9)
        self.assertEqual(closeout_rows([result])[0]['M_REIMPRESSAO_LASER'],3)

    def test_quantities_with_different_units_are_not_added_together(self):
        data=dataset(self.db,'')
        data['measurements']=[dict(orderId=1,action='review_done',unit=unit,expected=q,processed=q,good=q,loss='0') for unit,q in [('m','10'),('pc','12')]]
        result=close_orders(data)[0]
        self.assertEqual({m['unit']:m['good'] for m in result['measurementTotals']},{'m':'10','pc':'12'})


if __name__=='__main__': unittest.main(verbosity=2)
