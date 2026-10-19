import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Pedidos'))
from order_numbers import next_order_number, valid_order_number


class OrderNumbersTest(unittest.TestCase):
    def test_sequence_preserves_legacy_and_deleted_orders(self):
        with sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE orders(number TEXT UNIQUE, deleted_at TEXT)')
            self.assertEqual(next_order_number(db), '30000')
            db.executemany('INSERT INTO orders VALUES(?, NULL)',
                           [('SP-D-999999',), ('29999',), ('30000draft',)])
            self.assertEqual(next_order_number(db), '30000')
            db.execute('INSERT INTO orders VALUES(?, NULL)', (next_order_number(db),))
            self.assertEqual(next_order_number(db), '30001')
            db.execute("INSERT INTO orders VALUES('40000', 'deleted')")
            self.assertEqual(next_order_number(db), '40001')
            self.assertEqual(db.execute("SELECT count(*) FROM orders WHERE number='SP-D-999999'").fetchone()[0], 1)

    def test_numeric_and_legacy_routes(self):
        for number in ['30000', '100000', 'SP-D-000001']:
            self.assertTrue(valid_order_number(number))
        for number in ['', '30000abc', '30000/other', '-30000', '٣٠٠٠٠']:
            self.assertFalse(valid_order_number(number))


if __name__ == '__main__':
    unittest.main()
