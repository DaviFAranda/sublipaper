"""Read-only production projection; commercial context belongs to Pedidos.

No billing, fiscal issue, stock movement or spreadsheet mutation happens here.
"""
import csv, io, json, math, sqlite3
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime
from decimal import Decimal, InvalidOperation

FIELDS = {
 'external_order_id':'ID_PEDIDO da planilha', 'external_order_number':'Número do pedido externo',
 'client_id':'ID do cliente', 'cnpj':'CNPJ / CPF', 'rep':'Representante',
 'service_code':'Código do serviço financeiro', 'origin':'Origem do pedido',
 'ft_id':'Ficha técnica (FT)', 'sku_id':'SKU', 'route_id':'Roteiro', 'prep_id':'Preparação',
 'machine':'Máquina', 'operator':'Responsável pelo corte', 'color':'Cor', 'lot_id':'Lote',
 'weight_kg':'Peso medido (kg)', 'billing_quantity':'Quantidade conferida para cobrança',
 'billing_unit':'Unidade de cobrança (m, kg ou pc)', 'partial':'Entrega parcial (sim/não)',
 'nf_number':'Documento fiscal / vale confirmado', 'nf_date':'Data do documento (AAAA-MM-DD)',
 'nf_id':'ID fiscal externo', 'due_date':'Vencimento (AAAA-MM-DD)',
 'payment_terms':'Condição de pagamento', 'payment_days':'Prazo em dias', 'bank':'Banco',
 'classification':'Classificação financeira', 'installments':'Parcelas (JSON com número, data e valor)',
 'delivery_date':'Data de entrega efetiva (AAAA-MM-DD)', 'recipient':'Recebedor',
 'volumes':'Volumes de tecido / embalagem', 'notes':'Observações financeiras'
}
NUMERIC={'weight_kg','billing_quantity','payment_days','volumes'}

@contextmanager
def connection(db):
 c=sqlite3.connect(db,timeout=20);c.row_factory=sqlite3.Row
 c.execute('CREATE TABLE IF NOT EXISTS billing_context(order_id INTEGER PRIMARY KEY REFERENCES orders(id),data TEXT NOT NULL,updated_at TEXT NOT NULL)')
 c.execute('CREATE TABLE IF NOT EXISTS billing_context_audit(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL)')
 try:
  with c:yield c
 finally:c.close()

def production(laser_file):
 if not laser_file or not Path(laser_file).is_file():return [],[]
 c=sqlite3.connect(Path(laser_file).resolve().as_uri()+'?mode=ro',uri=True)
 try:
  c.execute('PRAGMA query_only=ON')
  jobs=[json.loads(r[0]) for r in c.execute('SELECT data FROM jobs ORDER BY rowid')]
  reports=[json.loads(r[0]) for r in c.execute('SELECT data FROM order_reports ORDER BY rowid')]
  return jobs,reports
 finally:c.close()

def decimal(value):
 try:return Decimal(str(value).replace(',','.'))
 except (InvalidOperation,ValueError):return None

def grade_projection(job):
 plan=job['plan'];measurements=job.get('measurements',[])
 def runs(ms):
  return max([0]+[math.ceil(sum(x['good']+x['rejected'] for m in ms for x in m['rows'] if x['id']==r['id'])/r['yield']) for r in plan['rows']])
 length=Decimal(str(plan['length']))*100
 initial=runs([m for m in measurements if not m.get('reprintId')])
 reprints=[]
 for r in job.get('reprints',[]):
  ms=[m for m in measurements if m.get('reprintId')==r['id']]
  done=r['status']=='done' and bool(ms)
  reprints.append({'id':r['id'],'number':r['number'],'order':plan['order'],'sourceOrderId':job.get('source',{}).get('orderId') if job.get('source') else None,'status':r['status'],'reason':r['reason'],'createdAt':r['createdAt'],'finishedAt':ms[-1]['createdAt'] if done else None,'repetitions':runs(ms) if done else 0,'calculatedCm':float(length*runs(ms)) if done else 0,'planningCm':float(decimal(r['calculation']['total'])*100),'measurements':ms})
 repeats=initial+sum(r['repetitions'] for r in reprints)
 good=sum(x['good'] for m in measurements for x in m['rows'])
 rejected=sum(x['rejected'] for m in measurements for x in m['rows'])
 missing=sum(max(0,r['target']-sum(x['good'] for m in measurements for x in m['rows'] if x['id']==r['id'])) for r in plan['rows'])
 return {'jobId':job['id'],'sourceItemId':(job.get('source') or {}).get('itemId'),'order':plan['order'],'art':plan['art'],'grade':plan['grade'],'createdAt':job['createdAt'],'widthCm':plan['width']*100,'lengthCm':float(length),'repetitions':repeats,'calculatedCm':float(length*repeats),'initialCm':float(length*initial),'reprintCm':sum(r['calculatedCm'] for r in reprints),'good':good,'rejected':rejected,'missing':missing,'complete':job['status']!='draft' and missing==0 and not any(r['status']=='open' for r in reprints),'reprints':reprints,'measurements':measurements,'pieces':plan['rows']}

def data(db,laser):
 jobs,reports=production(laser)
 with connection(db) as c:
  orders=[]
  for o in c.execute('SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY id DESC'):
   order=dict(o);items=[dict(i) for i in c.execute('SELECT * FROM items WHERE order_id=?',(o['id'],))]
   saved=c.execute('SELECT data,updated_at FROM billing_context WHERE order_id=?',(o['id'],)).fetchone()
   context=json.loads(saved['data']) if saved else {}
   linked=[j for j in jobs if (j.get('source') or {}).get('system')=='sublipaper-pedidos' and j['source']['orderId']==o['id']]
   grades=[grade_projection(j) for j in linked]
   registered=[r for r in reports if r.get('jobs') and all((j.get('source') or {}).get('orderId')==o['id'] for j in r['jobs'])]
   latest=registered[-1] if registered else None
   report_current=bool(latest) and len(latest['jobs'])==len(linked) and all(any(snapshot['id']==j['id'] and snapshot['plan']==j['plan'] and snapshot['measurements']==j['measurements'] and snapshot['reprints']==j['reprints'] for snapshot in latest['jobs']) for j in linked)
   projected=sum((decimal(i['quantity']) or Decimal(0) for i in items),Decimal(0))
   quantity=decimal(context.get('billing_quantity')) if context.get('billing_quantity') else None
   price=decimal(o['unit_price'])
   billing_unit=context.get('billing_unit') or o['unit']
   issues=[]
   for field in ['external_order_id','external_order_number','client_id','cnpj','rep','service_code']:
    if not context.get(field):issues.append('Falta '+FIELDS[field])
   if not grades:issues.append('Sem grades vinculadas')
   elif not all(g['complete'] for g in grades):issues.append('Corte incompleto')
   if not report_current:issues.append('Romaneio completo não registrado ou desatualizado')
   if quantity is None:issues.append('Quantidade de cobrança não conferida')
   if price is None:issues.append('Preço não definido no pedido')
   if billing_unit!=o['unit']:issues.append('Unidade de cobrança diverge do preço do pedido')
   if billing_unit=='kg' and not context.get('weight_kg'):issues.append('Peso não medido')
   value=str(quantity*price) if quantity is not None and price is not None and billing_unit==o['unit'] else None
   order.update(items=items,context=context,grades=grades,commercialQuantity=str(projected),billingQuantity=str(quantity) if quantity is not None else None,billingUnit=billing_unit,billingValue=value,calculatedCm=sum(g['calculatedCm'] for g in grades),reprintCm=sum(g['reprintCm'] for g in grades),good=sum(g['good'] for g in grades),rejected=sum(g['rejected'] for g in grades),report=({'id':latest['id'],'createdAt':latest['createdAt'],'current':report_current} if latest else None),pending=issues)
   orders.append(order)
 return {'schemaVersion':2,'unitOfDimensions':'cm','lossPlanningPercent':5,'orders':orders,'unlinkedGrades':[{'id':j['id'],'number':j['number'],'order':j['plan']['order'],'client':j['plan']['client']} for j in jobs if not j.get('source')],'fields':FIELDS,'notice':'Metragem calculada por grades e contagens. Não equivale a quantidade comercial conferida; peças de corte não equivalem a rolos de tecido.'}

def save_context(handler,db,user):
 if handler.headers.get('Origin') not in [None,'http://'+handler.headers.get('Host','')]:raise PermissionError('Origem não permitida')
 if handler.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Envie JSON')
 size=int(handler.headers.get('Content-Length','0'))
 if not 0<size<=20000:raise ValueError('Dados inválidos')
 try:
  payload=json.loads(handler.rfile.read(size))
  if not isinstance(payload,dict):raise ValueError()
  oid=int(payload['orderId']);raw=payload['context']
 except (ValueError,KeyError,TypeError):raise ValueError('Pedido e contexto inválidos')
 if not isinstance(raw,dict) or set(raw)-FIELDS.keys():raise ValueError('Campo financeiro inválido')
 context={}
 for k,v in raw.items():
  if not isinstance(v,(str,int,float)) or len(str(v))>4000:raise ValueError('Valor inválido: '+k)
  v=str(v).strip()
  if k in NUMERIC and v:
   n=decimal(v)
   if n is None or not n.is_finite() or n<0:raise ValueError('Número inválido: '+FIELDS[k])
   v=str(n)
  if k.endswith('_date') and v:
   try:datetime.strptime(v,'%Y-%m-%d')
   except ValueError:raise ValueError('Data inválida: '+FIELDS[k])
  if k=='billing_unit' and v not in ['','m','kg','pc']:raise ValueError('Unidade inválida')
  if k=='partial' and v not in ['','sim','não']:raise ValueError('Entrega parcial: use sim ou não')
  if k=='installments' and v:
   try:
    installments=json.loads(v)
    if not isinstance(installments,list):raise ValueError()
    for part in installments:
     if not isinstance(part,dict) or set(part)!={'number','date','value'}:raise ValueError()
     if not isinstance(part['number'],int) or part['number']<1:raise ValueError()
     datetime.strptime(part['date'],'%Y-%m-%d')
     n=decimal(part['value'])
     if n is None or not n.is_finite() or n<0:raise ValueError()
   except (ValueError,TypeError,KeyError):raise ValueError('Parcelas: lista JSON com number, date, value')
  context[k]=v
 with connection(db) as c:
  if not c.execute('SELECT 1 FROM orders WHERE id=? AND deleted_at IS NULL',(oid,)).fetchone():raise ValueError('Pedido não encontrado')
  before=c.execute('SELECT data,updated_at FROM billing_context WHERE order_id=?',(oid,)).fetchone()
  version=before['updated_at'] if before else None
  if payload.get('version')!=version:raise ValueError('Dados alterados em outro computador. Atualize antes de salvar.')
  after=json.dumps(context,ensure_ascii=False);now=datetime.now().isoformat(timespec='microseconds')
  c.execute('INSERT INTO billing_context VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at',(oid,after,now))
  c.execute('INSERT INTO billing_context_audit(order_id,actor,created_at,before_data,after_data) VALUES(?,?,?,?,?)',(oid,user['username'],now,before['data'] if before else '{}',after))
 handler.send_json({'saved':True,'version':now})

def export_rows(dataset,kind):
 rows=[]
 for o in dataset['orders']:
  c=o['context'];ref=c.get('external_order_number') or o['number'];oid=c.get('external_order_id') or 'PEDIDOS:'+str(o['id'])
  if kind=='pedidos':
   rows.append({'ID_PEDIDO':oid,'Data entrada do pedido':o['created_at'],'PEDIDO_NUM':ref,'ORIG':c.get('origin',''),'CLIENTE':o['client'],'REP':c.get('rep',''),'SERVICO':c.get('service_code',''),'TECIDO':o['fabric'],'METROS_PED':o['commercialQuantity'] if o['unit']=='m' else '', 'VALOR_PED':str((decimal(o['commercialQuantity']) or Decimal(0))*decimal(o['unit_price'])) if decimal(o['unit_price']) is not None else '', 'PRECO_UNIT_PED':o['unit_price'] or '', 'DATA_FATURAMENTO':c.get('nf_date',''),'NF_FISCAL_NUM':c.get('nf_number',''),'METROS_FATURADOS':o['billingQuantity'] if o['billingUnit']=='m' else '', 'VALOR_FATURADO':o['billingValue'] or '', 'UNIDADE':o['billingUnit'],'QUANTIDADE':o['billingQuantity'] or '', 'STATUS_INTEGRACAO':'; '.join(o['pending'])})
  elif kind=='romaneios':
   for g in o['grades']:
    rows.append({'Data':(o['report'] or {}).get('createdAt',''),'Romaneio':(o['report'] or {}).get('id',''),'Pedido':ref,'NF':c.get('nf_number',''),'Cliente':o['client'],'Artigo':g['art'],'Cor':c.get('color',''),'Maquina':c.get('machine',''),'Setor':'CORTE_LASER','Situacao':'Registrado' if o.get('report',{} ) and o['report']['current'] else 'Pendente','Pecas':'','Metros':str(Decimal(str(g['calculatedCm']))/100),'Peso_kg':'','PECAS_CORTE_BOAS':g['good'],'PECAS_CORTE_REJEITADAS':g['rejected'],'GRADE_ID':g['jobId'],'ITEM_PEDIDO_ID':g['sourceItemId'],'REIMPRESSOES':sum(r['status']=='done' for r in g['reprints']),'REIMPRESSAO_CM':g['reprintCm'],'ORIGEM_METRAGEM':'calculada_grade','PENDENCIAS':'; '.join(o['pending'])})
  elif kind=='reimpressoes':
   for g in o['grades']:
    for r in g['reprints']:rows.append({'ID':r['id'],'Pedido':ref,'PEDIDOS_ID':o['id'],'Item':g['sourceItemId'],'Grade':g['jobId'],'Reimpressao':r['number'],'Estado':r['status'],'Motivo':r['reason'],'Solicitada':r['createdAt'],'Concluida':r['finishedAt'] or '','Repeticoes':r['repetitions'],'CM_CALCULADOS':r['calculatedCm'],'CM_PLANEJADOS_COM_5':r['planningCm']})
  else:raise ValueError('Exportação inválida')
 return rows

def get(handler,path,db,laser):
 if path=='/faturamento':
  body=(Path(__file__).parent/'static'/'billing.html').read_bytes();handler.send_response(200);handler.send_header('Content-Type','text/html; charset=utf-8');handler.send_header('Content-Length',str(len(body)));handler.end_headers();handler.wfile.write(body);return
 dataset=data(db,laser)
 if path=='/api/billing':
  with connection(db) as c:
   for o in dataset['orders']:
    row=c.execute('SELECT updated_at FROM billing_context WHERE order_id=?',(o['id'],)).fetchone();o['contextVersion']=row[0] if row else None
  return handler.send_json(dataset)
 if path=='/api/billing/export.json':return handler.send_json(dataset)
 if path.startswith('/api/billing/') and path.endswith('.csv'):
  rows=export_rows(dataset,path.rsplit('/',1)[1][:-4]);output=io.StringIO(newline='');writer=csv.DictWriter(output,fieldnames=list(rows[0]) if rows else ['SEM_REGISTROS'],delimiter=';',lineterminator='\r\n');writer.writeheader()
  # Spreadsheet imports must never execute user-supplied formulas.
  for row in rows:writer.writerow({k:("'"+v if isinstance(v,str) and v.lstrip().startswith(('=','+','-','@')) else v) for k,v in row.items()})
  body=b'\xef\xbb\xbf'+output.getvalue().encode('utf-8');handler.send_response(200);handler.send_header('Content-Type','text/csv; charset=utf-8');handler.send_header('Content-Disposition','attachment; filename="'+path.rsplit('/',1)[1]+'"');handler.send_header('Content-Length',str(len(body)));handler.send_header('Cache-Control','no-store');handler.end_headers();handler.wfile.write(body);return
 handler.send_json({'error':'Exportação não encontrada'},404)
