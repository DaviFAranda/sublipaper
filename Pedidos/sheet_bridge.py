"""Read-only operational feed for spreadsheet consumers. No billing actions."""
import csv, io, json, sqlite3
from pathlib import Path
from datetime import datetime, timezone
from contextlib import contextmanager
from billing_bridge import production, grade_projection
from closing import close_orders, closeout_rows, CLOSEOUT_HEADERS

@contextmanager
def readonly(file):
    c=sqlite3.connect(Path(file).resolve().as_uri()+'?mode=ro',uri=True)
    c.row_factory=sqlite3.Row;c.execute('PRAGMA query_only=ON')
    try: yield c
    finally: c.close()

def attach(rows,sources,laser):
    jobs,_=production(laser)
    by_item={}
    for j in jobs:
        s=j.get('source') or {}
        if s.get('system')!='sublipaper-pedidos':continue
        by_item.setdefault((s.get('orderId'),s.get('itemId')),[]).append(j)
    for row,source in zip(rows,sources):
        for item in row.get('items',[]):
            linked=by_item.get((source['id'],item['id']),[])
            if not linked:continue
            grades=[grade_projection(j) for j in linked]
            released=all(j['status']!='draft' for j in linked)
            complete=released and all(g['complete'] for g in grades)
            running=any(j.get('measurements') for j in linked) and not complete
            item['laser_progress']={'status':'complete' if complete else 'partial' if running else 'ready' if released else 'draft','gradeIds':[j['id'] for j in linked], 'good':sum(g['good'] for g in grades),'rejected':sum(g['rejected'] for g in grades),'missing':sum(g['missing'] for g in grades),'calculatedCm':sum(g['calculatedCm'] for g in grades),'reprintCm':sum(g['reprintCm'] for g in grades),'openReprints':sum(r['status']=='open' for g in grades for r in g['reprints'])}
    return rows

def dataset(db,laser):
    jobs,reports=production(laser)
    with readonly(db) as c:
        contexts={}
        if c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='billing_context'").fetchone():
            contexts={r['order_id']:json.loads(r['data']) for r in c.execute('SELECT order_id,data FROM billing_context')}
        orders=[]
        for r in c.execute('SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY id'):
            order=dict(r);order['widthCm']=float(order['width_m'])*100 if order['width_m'] not in (None,'') else None
            order['items']=[dict(x) for x in c.execute('SELECT * FROM items WHERE order_id=? ORDER BY id',(r['id'],))]
            order['externalReferences']=contexts.get(r['id'],{})
            orders.append(order)
    grades=[];unlinked=[]
    for j in jobs:
        g=grade_projection(j);s=j.get('source') or {}
        g.update(sourceOrderId=s.get('orderId'),sourceItemId=s.get('itemId'),rootItemId=s.get('rootItemId') or s.get('itemId'),productionOrder=s.get('productionOrder'),client=j['plan']['client'],fabric=j['plan']['fabric'],status=j['status'])
        (grades if s.get('system')=='sublipaper-pedidos' else unlinked).append(g)
    result={'schemaVersion':2,'generatedAt':datetime.now(timezone.utc).isoformat(),'orders':orders,'grades':grades,'reports':reports,'unlinkedGrades':unlinked,'lengthUnit':'cm','billingHandledBy':'external_spreadsheets'}
    result.update(operational_dataset(Path(db).parent/'operacoes.sqlite3',orders))
    result['closeouts']=close_orders(result)
    return result

def operational_dataset(file,orders):
    output={name:[] for name in ['consumptions','stages','measurements','productionPlans','batches','deliveries','itemReferences']}
    if not file.is_file():return output
    roots={i['id']:(o['id'],o['number'],i['id']) for o in orders for i in o['items']}
    with readonly(file) as c:
        batches=[dict(r) for r in c.execute('SELECT * FROM replenishment_batches')]
        for b in batches:
            root=roots.get(b['root_item'])
            if root:roots[-b['id']]=root
        references={r['item_id']:json.loads(r['data']) for r in c.execute('SELECT * FROM item_references')} if c.execute("SELECT 1 FROM sqlite_master WHERE name='item_references'").fetchone() else {}
        output['itemReferences']=[{'itemId':i,'orderId':roots[i][0],'orderNumber':roots[i][1],**r} for i,r in references.items() if i in roots]
        tables={'consumptions':'consumptions','stages':'stage_flags','measurements':'production_measurements','productionPlans':'production_plans'}
        for name,table in tables.items():
            for r in c.execute('SELECT * FROM '+table):
                row=dict(r);root=roots.get(row['item_id'])
                if not root:continue
                row.update(orderId=root[0],orderNumber=root[1],rootItemId=root[2],productionItemId=row['item_id'])
                if name=='stages':row['details']=json.loads(row['details'])
                if name=='consumptions':
                    from decimal import Decimal
                    row['knownCost']=str(Decimal(row['quantity'])*Decimal(row['unit_cost'])) if row['unit_cost'] is not None else None
                    row['productionReferences']=references.get(root[2],{})
                    row['priceStatus']='known' if row['unit_cost'] is not None else 'external_price_pending'
                output[name].append(row)
        output['deliveries']=[r for r in output['stages'] if r['action'] in {'packed','delivered'}]
        for b in batches:
            root=roots.get(b['root_item'])
            if root:output['batches'].append({k:v for k,v in {**b,'orderId':root[0],'orderNumber':root[1],'rootItemId':root[2]}.items() if k!='snapshot'})
    output['unitContract']={'commercialQuantity':'unit from commercial item','productionLengths':'m','laserLengths':'legacy JSON fields ending in Cm use cm; CSV lengths use m','consumptionQuantity':'explicit unit per record','missingUnitCost':'null; prices remain in external spreadsheet'}
    return output

def csv_rows(data,kind):
    if kind=='fechamentos':return closeout_rows(data['closeouts'])
    if kind=='medicoes':
        from decimal import Decimal
        return [{'PEDIDO_ID':r['orderId'],'PEDIDO_NUM':r['orderNumber'],'ITEM_ID':r['rootItemId'],'TRABALHO_ITEM_ID':r['productionItemId'],'ETAPA':r['action'],'META':str(Decimal(r['expected'])),'PROCESSADO':str(Decimal(r['processed'])),'BOAS':str(Decimal(r['good'])),'PERDAS':str(Decimal(r['loss'])),'UNIDADE':r['unit'],'MOTIVO':r['reason'],'RESPONSAVEL':r['actor'],'DATA':r['created_at']} for r in data['measurements']]
    if kind=='consumos':
        return [{'CONSUMO_ID':r['id'],'PEDIDO_ID':r['orderId'],'PEDIDO_NUM':r['orderNumber'],'ITEM_ID':r['rootItemId'],'TRABALHO_ITEM_ID':r['productionItemId'],'SETOR':r['sector'],'MATERIAL':r['material'],'QUANTIDADE':r['quantity'],'UNIDADE':r['unit'],'PRECO_UNITARIO':r['unit_cost'],'CUSTO_CONHECIDO':r['knownCost'],'PRECO_PENDENTE':r['unit_cost'] is None,'LOTE':r['lot'],'REFERENCIA':r['reference'],'RESPONSAVEL':r['actor'],'DATA':r['created_at'],**{key.upper():r['productionReferences'].get(key,'') for key in ['ft_id','sku_id','route_id','prep_id','color','lot_id']}} for r in data['consumptions']]
    if kind in {'etapas','entregas'}:
        return [{'PEDIDO_ID':r['orderId'],'PEDIDO_NUM':r['orderNumber'],'ITEM_ID':r['rootItemId'],'TRABALHO_ITEM_ID':r['productionItemId'],'ETAPA':r['action'],'MAQUINA':r['machine'],'REFERENCIA':r['reference'],'RESPONSAVEL':r['actor'],'DATA':r['created_at'],'DETALHES':json.dumps(r['details'],ensure_ascii=False)} for r in data['stages' if kind=='etapas' else 'deliveries']]
    if kind=='pedidos':
        return [{'PEDIDO_ID':o['id'],'PEDIDO_NUM':o['number'],'ITEM_ID':i['id'],'CLIENTE':o['client'],'ARTE':i['art'],'SERVICO':o['service'],'TECIDO':o['fabric'],'LARGURA_M':o['width_m'],'QUANTIDADE':i['quantity'],'UNIDADE':i['unit'],'PRECO_UNITARIO':i.get('price'),'DATA_PEDIDO':o['created_at'],'ENTREGA_PREVISTA':o['delivery'],'NF_REFERENCIA':o['nf'],**{key.upper():next((r.get(key) for r in data.get('itemReferences',[]) if r['itemId']==i['id'] and r.get(key)),None) or o['externalReferences'].get(key,'') for key in ['external_order_id','external_order_number','client_id','service_code','ft_id','sku_id','route_id','prep_id','color','lot_id']}} for o in data['orders'] for i in o['items']]
    if kind=='grades':
        return [{'GRADE_ID':g['jobId'],'PEDIDO_ID':g['sourceOrderId'],'ITEM_ID':g['sourceItemId'],'PEDIDO_NUM':g['order'],'CLIENTE':g['client'],'ARTE':g['art'],'GRADE':g['grade'],'LARGURA_M':g['widthCm']/100,'COMPRIMENTO_M':g['lengthCm']/100,'REPETICOES':g['repetitions'],'M_CALCULADOS':g['calculatedCm']/100,'M_REIMPRESSAO':g['reprintCm']/100,'BOAS':g['good'],'REJEITADAS':g['rejected'],'FALTANTES':g['missing'],'CONCLUIDA':g['complete'],'CRIADA_EM':g['createdAt'],'ITEM_ORIGINAL_ID':g['rootItemId'],'TRABALHO':g['productionOrder']} for g in data['grades']+data['unlinkedGrades']]
    if kind=='reimpressoes':
        return [{'REIMPRESSAO_ID':r['id'],'GRADE_ID':g['jobId'],'PEDIDO_ID':g['sourceOrderId'],'ITEM_ID':g['sourceItemId'],'PEDIDO_NUM':g['order'],'NUMERO_REIMPRESSAO':r['number'],'ESTADO':r['status'],'MOTIVO':r['reason'],'CRIADA_EM':r['createdAt'],'CONCLUIDA_EM':r['finishedAt'],'REPETICOES':r['repetitions'],'M_CALCULADOS':r['calculatedCm']/100,'M_PLANEJADOS_COM_5':r['planningCm']/100} for g in data['grades']+data['unlinkedGrades'] for r in g['reprints']]
    if kind=='romaneios':
        rows=[]
        for r in data['reports']:
            grades=[grade_projection(j) for j in r['jobs']]
            rows.append({'ROMANEIO_ID':r['id'],'PEDIDO_NUM':r['order'],'CLIENTE':r['client'],'REGISTRADO_EM':r['createdAt'],'M_CALCULADOS':sum(g['calculatedCm'] for g in grades)/100,'M_REIMPRESSAO':sum(g['reprintCm'] for g in grades)/100,'BOAS':sum(g['good'] for g in grades),'REIMPRESSOES_FEITAS':sum(x['status']=='done' for g in grades for x in g['reprints'])})
        return rows
    raise ValueError('Tabela de integração não encontrada')

HEADERS={'pedidos': ['PEDIDO_ID', 'PEDIDO_NUM', 'ITEM_ID', 'CLIENTE', 'ARTE', 'SERVICO', 'TECIDO', 'LARGURA_M', 'QUANTIDADE', 'UNIDADE', 'PRECO_UNITARIO', 'DATA_PEDIDO', 'ENTREGA_PREVISTA', 'NF_REFERENCIA'], 'grades': ['GRADE_ID', 'PEDIDO_ID', 'ITEM_ID', 'PEDIDO_NUM', 'CLIENTE', 'ARTE', 'GRADE', 'LARGURA_M', 'COMPRIMENTO_M', 'REPETICOES', 'M_CALCULADOS', 'M_REIMPRESSAO', 'BOAS', 'REJEITADAS', 'FALTANTES', 'CONCLUIDA', 'CRIADA_EM'], 'reimpressoes': ['REIMPRESSAO_ID', 'GRADE_ID', 'PEDIDO_ID', 'ITEM_ID', 'PEDIDO_NUM', 'NUMERO_REIMPRESSAO', 'ESTADO', 'MOTIVO', 'CRIADA_EM', 'CONCLUIDA_EM', 'REPETICOES', 'M_CALCULADOS', 'M_PLANEJADOS_COM_5'], 'romaneios': ['ROMANEIO_ID', 'PEDIDO_NUM', 'CLIENTE', 'REGISTRADO_EM', 'M_CALCULADOS', 'M_REIMPRESSAO', 'BOAS', 'REIMPRESSOES_FEITAS']}

HEADERS['pedidos'] += [k.upper() for k in ['external_order_id','external_order_number','client_id','service_code','ft_id','sku_id','route_id','prep_id','color','lot_id']]
HEADERS['grades'] += ['ITEM_ORIGINAL_ID','TRABALHO']
HEADERS['medicoes']=['PEDIDO_ID','PEDIDO_NUM','ITEM_ID','TRABALHO_ITEM_ID','ETAPA','META','PROCESSADO','BOAS','PERDAS','UNIDADE','MOTIVO','RESPONSAVEL','DATA']
HEADERS.update(consumos=['CONSUMO_ID','PEDIDO_ID','PEDIDO_NUM','ITEM_ID','TRABALHO_ITEM_ID','SETOR','MATERIAL','QUANTIDADE','UNIDADE','PRECO_UNITARIO','CUSTO_CONHECIDO','PRECO_PENDENTE','LOTE','REFERENCIA','RESPONSAVEL','DATA'])
HEADERS['consumos'] += [k.upper() for k in ['ft_id','sku_id','route_id','prep_id','color','lot_id']]
HEADERS.update({k:['PEDIDO_ID','PEDIDO_NUM','ITEM_ID','TRABALHO_ITEM_ID','ETAPA','MAQUINA','REFERENCIA','RESPONSAVEL','DATA','DETALHES'] for k in ['etapas','entregas']})

HEADERS['fechamentos']=CLOSEOUT_HEADERS

def get(handler,path,db,laser):
    data=dataset(db,laser)
    name=path.rsplit('/',1)[-1]
    if name in {'planilhas','dados.json'}:return handler.send_json(data)
    if name not in {k+'.csv' for k in HEADERS}:return handler.send_json({'error':'Tabela de integração não encontrada'},404)
    rows=csv_rows(data,name[:-4]);output=io.StringIO(newline='')
    writer=csv.DictWriter(output,fieldnames=HEADERS[name[:-4]],delimiter=';',lineterminator='\r\n');writer.writeheader()
    for row in rows:writer.writerow({k:("'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v) for k,v in row.items()})
    body=b'\xef\xbb\xbf'+output.getvalue().encode('utf-8');handler.send_response(200);handler.send_header('Content-Type','text/csv; charset=utf-8');handler.send_header('Content-Disposition','attachment; filename="'+name+'"');handler.send_header('Cache-Control','no-store');handler.send_header('Content-Length',str(len(body)));handler.end_headers();handler.wfile.write(body)

