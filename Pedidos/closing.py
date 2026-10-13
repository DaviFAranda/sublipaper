"""Read-only closeout projection. External spreadsheets retain pricing and billing.

Amounts are grouped by unit. Replacement work always resolves to the original
commercial item; no new sale is inferred from a production replacement.
"""
from collections import defaultdict
from decimal import Decimal


def totals(rows, quantity_key, unit_key):
    values = defaultdict(Decimal)
    for row in rows:
        values[row[unit_key]] += Decimal(str(row[quantity_key]))
    return [{'unit': unit, 'quantity': str(value)} for unit, value in sorted(values.items())]


def close_orders(data):
    result = []
    for order in data['orders']:
        number = order['number']
        select = lambda name: [r for r in data.get(name, []) if r.get('orderId') == order['id']]
        stages, measures, usage, batches = (select(n) for n in ('stages', 'measurements', 'consumptions', 'batches'))
        grades = [g for g in data['grades'] if g['sourceOrderId'] == order['id']]
        delivered = {r['rootItemId'] for r in stages if r['action'] == 'delivered' and r['productionItemId'] == r['rootItemId']}
        items = order['items']
        complete = bool(items) and all(i['id'] in delivered for i in items)
        pending_prices = sum(r.get('unit_cost') is None for r in usage)
        missing_ops = [i['id'] for i in items if not any(r['rootItemId'] == i['id'] for r in stages)]
        issues = []
        if not complete: issues.append({'code': 'production_open', 'label': 'Pedido ainda não entregue por completo'})
        if missing_ops: issues.append({'code': 'no_history', 'label': f'{len(missing_ops)} arte(s) sem histórico de etapas'})
        if pending_prices: issues.append({'code': 'external_prices', 'label': f'{pending_prices} consumo(s) aguardam preço na planilha'})
        if not usage: issues.append({'code': 'no_consumption', 'label': 'Nenhum consumo registrado; conferir com a operação'})
        # Reference codes vary by spreadsheet and are never fabricated or universal blockers.
        references = select('itemReferences')
        missing_references = sum(not any(r.get('itemId') == i['id'] and any(r.get(k) for k in ('ft_id', 'sku_id', 'route_id', 'prep_id')) for r in references) for i in items)
        if missing_references: issues.append({'code': 'references', 'label': f'{missing_references} arte(s) sem códigos externos; conferir se aplicáveis'})
        if any(not g.get('complete', False) for g in grades): issues.append({'code': 'laser_open', 'label': 'Grades ou reimpressões laser ainda pendentes'})
        if order['service']=='Corte a laser' and not grades: issues.append({'code': 'laser_missing', 'label': 'Nenhuma grade laser vinculada ao pedido'})
        reprints = [dict(r, gradeId=g['jobId'], rootItemId=g['rootItemId']) for g in grades for r in g['reprints']]
        units = sorted({r['unit'] for r in measures})
        measurement_totals = [{'action': action, 'unit': unit,
            **{k: str(sum((Decimal(str(r[k])) for r in measures if r['action'] == action and r['unit'] == unit), Decimal(0))) for k in ('expected', 'processed', 'good', 'loss')}}
            for action in sorted({r['action'] for r in measures}) for unit in units
            if any(r['action'] == action and r['unit'] == unit for r in measures)]
        result.append({'orderId': order['id'], 'orderNumber': number, 'client': order['client'],
            'service': order['service'], 'completed': complete, 'deliveredItems': len(delivered), 'itemCount': len(items),
            'commercialQuantities': totals(items, 'quantity', 'unit'), 'measurementTotals': measurement_totals,
            'consumptionTotals': totals(usage, 'quantity', 'unit'),
            'knownConsumptionCost': str(sum((Decimal(str(r['knownCost'])) for r in usage if r.get('knownCost') is not None), Decimal(0))),
            'pendingConsumptionPrices': pending_prices, 'costComplete': bool(usage) and not pending_prices,
            'laserCm': sum(g['calculatedCm'] for g in grades), 'laserReprintCm': sum(g['reprintCm'] for g in grades),
            'laserReprintsDone': sum(r['status'] == 'done' for r in reprints), 'replacementBatches': len(batches),
            'deliveryAt': max((r['created_at'] for r in stages if r['action'] == 'delivered' and r['productionItemId'] == r['rootItemId']), default=None),
            'issues': issues, 'items': items, 'stages': stages, 'measurements': measures,
            'consumptions': usage, 'references': references, 'grades': grades, 'reprints': reprints, 'batches': batches})
    return result


CLOSEOUT_HEADERS = ['PEDIDO_ID', 'PEDIDO_NUM', 'CLIENTE', 'SERVICO', 'CONCLUIDO', 'ARTES', 'ARTES_ENTREGUES',
    'ENTREGUE_EM', 'M_LASER', 'M_REIMPRESSAO_LASER', 'REIMPRESSOES_LASER_FEITAS', 'LOTES_REPOSICAO',
    'CUSTO_CONHECIDO', 'CONSUMOS_REGISTRADOS_COM_PRECO', 'CONSUMOS_SEM_PRECO', 'PENDENCIAS_CONFERENCIA']


def closeout_rows(closeouts):
    return [dict(zip(CLOSEOUT_HEADERS, [r['orderId'], r['orderNumber'], r['client'], r['service'], r['completed'],
        r['itemCount'], r['deliveredItems'], r['deliveryAt'], r['laserCm']/100, r['laserReprintCm']/100, r['laserReprintsDone'],
        r['replacementBatches'], r['knownConsumptionCost'], r['costComplete'], r['pendingConsumptionPrices'],
        ' | '.join(i['label'] for i in r['issues'])])) for r in closeouts]
