"""Operational ledger: local production records, costs and laser synchronization."""
import json, uuid, threading, hashlib
from pathlib import Path
from decimal import Decimal
from datetime import datetime, timezone
from contextlib import contextmanager
from workflow_engine import WorkflowEngine
from billing_bridge import production, grade_projection
from production_tracking import quantity

class NestedConnection:
    def __init__(self, db):self.db=db
    def execute(self, sql, args=()):
        if sql.strip().upper().startswith('BEGIN') and self.db.in_transaction:return self.db.execute('SELECT 1')
        return self.db.execute(sql,args)
    def commit(self):pass
    def __getattr__(self,name):return getattr(self.db,name)

class OperationsWorkflow(WorkflowEngine):
    allow_partial_sewing = True
    allow_kg_planning = True
    allow_material_replenishment = True
    def __init__(self,path,pedidos,laser):
        self.local=threading.local();self.pedidos=Path(pedidos);self.laser=laser
        super().__init__(path)
        with self.connection() as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS item_references(item_id INTEGER PRIMARY KEY,data TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS operation_requests(key TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS consumptions(id TEXT PRIMARY KEY,request_key TEXT NOT NULL,order_number TEXT NOT NULL,item_id INTEGER NOT NULL,sector TEXT NOT NULL,material TEXT NOT NULL,quantity TEXT NOT NULL,unit TEXT NOT NULL,unit_cost TEXT,lot TEXT NOT NULL,reference TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
              CREATE INDEX IF NOT EXISTS consumption_order ON consumptions(order_number,item_id);
            ''')
    @contextmanager
    def connection(self):
        active=getattr(self.local,'active',None)
        if active is not None:yield active;return
        with super().connection() as db:yield db
    def atomic(self,key,payload,fn):
        key=str(key or uuid.uuid4().hex)
        if len(key)>120:raise ValueError('Identificador de operação inválido')
        digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        with super().connection() as db:
            db.execute('BEGIN IMMEDIATE')
            old=db.execute('SELECT * FROM operation_requests WHERE key=?',(key,)).fetchone()
            if old:
                if old['digest']!=digest:raise ValueError('A mesma operação foi reenviada com dados diferentes; atualize a fila')
                return json.loads(old['result'])
            self.local.active=NestedConnection(db)
            try:
                result=fn();db.execute('INSERT INTO operation_requests VALUES(?,?,?,?)',(key,digest,json.dumps(result,ensure_ascii=False),datetime.now(timezone.utc).isoformat()));return result
            finally:self.local.active=None
    def apply(self,kind,order,data,actor,role):
        if kind=='billing':raise ValueError('Faturamento permanece nas planilhas')
        self.sync_laser(order)
        usage=self.validate_usage(data.get('consumption',[]))
        if kind=='transition' and 'output' in data:
            loss=quantity(data.get('loss','0'),zero=True);good=quantity(data['output'],zero=True);data={**data,'processed':str(good+loss),'loss':str(loss)};data.pop('output',None)
        payload={'kind':kind,'order':order['number'],'data':data,'actor':actor}
        def act():
            if kind=='consumption':
                item_id=int(data.get('item_id') or 0);action=data.get('action');sector={'printed':'digital','calandra_done':'calandra','sewn':'costura','review_done':'revisao','delivered':'expedicao'}.get(action)
                if not sector or not usage or item_id not in {i['id'] for i in order['items']}:raise ValueError('Informe um consumo adicional válido para esta arte')
                if not self.complete(getattr(self.local,'active'),item_id,action):raise ValueError('Conclua a etapa antes de adicionar um consumo complementar')
                self.save_usage(order,item_id,sector,usage,actor,str(data.get('request_key','')))
                return {'status':'ok','records':len(usage)}
            method=self.configure if kind=='configure' else getattr(super(OperationsWorkflow,self),'request_replenishment' if kind=='replenishment' else kind)
            if kind=='transition' and self.complete(getattr(self.local,'active'),int(data.get('item_id') or 0),data.get('action')):raise ValueError('Etapa já concluída; atualize a fila')
            result=method(order,actor,role) if kind=='release' else method(order,data,actor,role)
            terminal=data.get('action');item_id=int(data.get('item_id') or 0)
            if kind=='transition' and terminal in {'printed','calandra_done','review_done'}:
                with self.connection() as db:
                    measure=self.measured(db,item_id,terminal)
                    if measure and measure['unit']=='m':
                        material='Papel' if terminal=='printed' else 'Tecido' if terminal=='calandra_done' or order['service']=='Venda de tecido' else None
                        if material and not any(x['material'].lower()==material.lower() for x in usage):
                            q=Decimal(measure['processed']);unit='m'
                            if material=='Papel':q*=Decimal('1.8' if data.get('reference')=='1,80 m' else '1.6');unit='m2'
                            if q>0:usage.append({'material':material,'quantity':str(q),'unit':unit,'unit_cost':None,'lot':str(data.get('lot',''))[:120],'reference':str(data.get('machine',''))+' · '+str(data.get('reference',''))})
            if usage:
                item_id=int(data.get('item_id') or 0)
                if item_id not in {i['id'] for i in order['items']}:raise ValueError('Consumo precisa de uma arte válida')
                sector={'separated':'estoque','prepared':'preparacao','printed':'digital','calandra_done':'calandra','sewn':'costura','review_done':'revisao','delivered':'expedicao'}.get(data.get('action'))
                if not sector:raise ValueError('Registre o consumo ao concluir a etapa')
                self.save_usage(order,item_id,sector,usage,actor,str(data.get('request_key','')))
            return result
        return self.atomic(data.get('request_key'),payload,act)
    def validate_usage(self,rows):
        if not isinstance(rows,list) or len(rows)>20:raise ValueError('Consumo inválido')
        valid=[]
        for row in rows:
            if not isinstance(row,dict):raise ValueError('Consumo inválido')
            material=str(row.get('material','')).strip();unit=str(row.get('unit','')).strip()
            if not material or len(material)>100 or unit not in {'cm','m','m2','kg','ml','kWh','min','un'}:raise ValueError('Informe material e unidade do consumo')
            q=quantity(row.get('quantity'));cost=row.get('unit_cost')
            cost=quantity(cost,zero=True) if cost not in (None,'') else None
            lot=str(row.get('lot','')).strip();reference=str(row.get('reference','')).strip()
            if len(lot)>120 or len(reference)>200:raise ValueError('Referência de consumo muito longa')
            valid.append(dict(material=material,quantity=str(q),unit=unit,unit_cost=str(cost) if cost is not None else None,lot=lot,reference=reference))
        return valid
    def save_usage(self,order,item,sector,rows,actor,key):
        number=order['number']
        if item<0:
            with self.connection() as db:number=db.execute('SELECT root_order FROM replenishment_batches WHERE id=?',(-item,)).fetchone()[0]
        with self.connection() as db:
            for r in rows:db.execute('INSERT INTO consumptions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(uuid.uuid4().hex,key,number,item,sector,r['material'],r['quantity'],r['unit'],r['unit_cost'],r['lot'],r['reference'],actor,datetime.now(timezone.utc).isoformat()))
    def configure(self,order,data,actor,role):
        if data.get('kind')!='references':return super().configure(order,data,actor,role)
        if role not in {'pcp','gestao'}:raise PermissionError('Somente PCP define referências da produção')
        item_id=int(data.get('item_id') or 0)
        if item_id not in {i['id'] for i in order['items']}:raise ValueError('Arte não pertence ao pedido')
        refs={key:str(data.get(key,'')).strip() for key in ['ft_id','sku_id','route_id','prep_id','color','lot_id']}
        if any(len(v)>120 for v in refs.values()):raise ValueError('Referências permitem até 120 caracteres')
        with self.connection() as db:
            if db.execute('SELECT 1 FROM test_ops WHERE item_id=?',(item_id,)).fetchone():raise ValueError('Defina as referências antes de liberar a OP')
            db.execute('INSERT OR REPLACE INTO item_references VALUES(?,?,?,?)',(item_id,json.dumps(refs,ensure_ascii=False),actor,datetime.now(timezone.utc).isoformat()))
        return {'status':'ok'}
    def laser_items(self,orders):
        rows=[]
        def item_row(order,item,parent,token=''):
            return {'orderId':parent['id'],'order':parent['number'],'client':parent['client'],'itemId':item['id'],'rootItemId':item.get('root_item_id',item['id']),'art':item['art'],'fabric':item.get('fabric') or parent.get('fabric',''),'width':float(item.get('width_m') or parent.get('width_m') or 0),'quantity':item['quantity'],'unit':item['unit'],'assetId':item.get('asset_id'),'originalName':item.get('original_name') or item['art'],'originalPath':item.get('original_path',''),'productionOrder':order['number'],'batchToken':token,'delivery':parent.get('delivery','')}
        for o in orders:
            if o['service']=='Corte a laser':rows.extend(item_row(o,i,o) for i in o['items'])
        by_number={o['number']:o for o in orders}
        with self.connection() as db:
            for b in db.execute('SELECT * FROM replenishment_batches ORDER BY id'):
                parent=by_number.get(b['root_order'])
                if not parent or parent['service']!='Corte a laser':continue
                child=json.loads(b['snapshot']);[i.update(root_item_id=b['root_item']) for i in child['items']];rows.extend(item_row(child,i,parent,b['token']) for i in child['items'])
        return rows
    def check_laser(self,item_id,action):
        with self.connection() as db:
            if action in {'release','releaseOrder','measure'} and not self.complete(db,item_id,'calandra_done'):raise ValueError('Aguarde PCP, preparação, impressão e conclusão da Calandra antes de cortar')
            if action in {'create','release','releaseOrder','measure','reprint','reverse','update','cancel','link'} and any(self.complete(db,item_id,a) for a in ['sewing','sewn','review_done','packed','delivered']):raise ValueError('Esta arte avançou para Costura/Revisão. Solicite a reposição na etapa atual para preservar o histórico')
        return {'status':'ok'}
    def sync_laser(self,order):
        if order.get('service')!='Corte a laser':return
        jobs,_=production(self.laser)
        for item in order['items']:
            linked=[j for j in jobs if (j.get('source') or {}).get('system')=='sublipaper-pedidos' and j['source'].get('itemId')==item['id']]
            if not linked:continue
            released=all(j['status']!='draft' for j in linked);complete=released and all(grade_projection(j)['complete'] for j in linked)
            with self.connection() as db:
                if not db.execute('SELECT 1 FROM test_ops WHERE item_id=?',(item['id'],)).fetchone():continue
                if not self.complete(db,item['id'],'calandra_done'):continue
                if any(self.complete(db,item['id'],a) for a in ['sewing','sewn','review_done','packed','delivered']):continue
                if released:
                    measurements=[m for j in linked for m in j['measurements']]
                    last=max(measurements,key=lambda m:m['createdAt']) if measurements else {}
                    latest=last.get('createdAt') or max(j.get('updatedAt',j['createdAt']) for j in linked)
                    actor=last.get('actor') or last.get('createdBy') or 'Operação local'
                    details=json.dumps({'source':'laser','grades':[j['id'] for j in linked]},ensure_ascii=False)
                    db.execute('INSERT OR IGNORE INTO stage_flags VALUES(?,?,?,?,?,?,?)',(item['id'],'cutting',str(actor),latest,'Corte a laser','',details))
                    if complete:db.execute('INSERT OR IGNORE INTO stage_flags VALUES(?,?,?,?,?,?,?)',(item['id'],'cut_done',str(actor),latest,'Corte a laser','',details))
                    else:db.execute("DELETE FROM stage_flags WHERE item_id=? AND action='cut_done'",(item['id'],))
    def measurement_spec(self,db,order,item,action):
        spec=super().measurement_spec(db,order,item,action)
        recorded=self.measured(db,item['id'],action)
        if recorded:spec['expected']=recorded['expected']
        if action=='review_done':
            sewn=db.execute("SELECT details FROM stage_flags WHERE item_id=? AND action='sewn'",(item['id'],)).fetchone()
            if sewn and spec['unit']=='pc':spec['available']=str(json.loads(sewn['details']).get('pieces',0))
        return spec
    def attach(self,order,role,service=None):
        out=super().attach(order,role,service);out.pop('billing',None)
        for i in out['items']:
            i['production_flow']=i.get('test_flow');i['production_op']=i.get('test_op')
            if role in {'pcp','gestao'}:
                with self.connection() as db:
                    ref=db.execute('SELECT data FROM item_references WHERE item_id=?',(i['id'],)).fetchone()
                    i['production_references']=json.loads(ref['data']) if ref else {}
            if role=='expedicao':
                source=next(x for x in order['items'] if x['id']==i['id'])
                with self.connection() as db:i['replenishment']=self.root_summary(db,order,source)
        return out
