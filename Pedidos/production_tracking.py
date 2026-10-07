"""Medições e lotes de reposição exclusivos do ambiente de homologação."""
import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

MEASURE_ACTIONS = {'printed':'digital', 'calandra_done':'calandra', 'cut_done':'corte', 'review_done':'revisao'}
LINK_ROLES = {'revisao','financeiro','gestao'}

def quantity(value, unit='m', zero=False):
    try:
        result=Decimal(str(value).replace(',','.'))
    except (InvalidOperation, ValueError):
        raise ValueError('Informe uma quantidade válida') from None
    if not result.is_finite() or result < 0 or (not zero and result == 0) or result > 100000000 or result.as_tuple().exponent < -3:
        raise ValueError('Use quantidade positiva, com até três casas decimais (zero apenas nas medições)')
    if unit == 'pc' and result != result.to_integral_value():
        raise ValueError('Peças precisam ser informadas em números inteiros')
    return result

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

class ProductionTracking:
    def init_production(self, db):
        db.executescript('''
          CREATE TABLE IF NOT EXISTS production_plans (
            item_id INTEGER PRIMARY KEY, print_m TEXT NOT NULL, final_qty TEXT NOT NULL,
            final_unit TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS production_measurements (
            item_id INTEGER NOT NULL, action TEXT NOT NULL, expected TEXT NOT NULL,
            processed TEXT NOT NULL, loss TEXT NOT NULL, good TEXT NOT NULL, unit TEXT NOT NULL,
            reason TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
            PRIMARY KEY(item_id,action));
          CREATE TABLE IF NOT EXISTS replenishment_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL UNIQUE,
            root_order TEXT NOT NULL, root_item INTEGER NOT NULL, source_item INTEGER NOT NULL,
            source_action TEXT NOT NULL, print_m TEXT NOT NULL, final_qty TEXT NOT NULL,
            final_unit TEXT NOT NULL, snapshot TEXT NOT NULL, reason TEXT NOT NULL,
            actor TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(source_item,source_action));
          CREATE INDEX IF NOT EXISTS idx_replenishment_root ON replenishment_batches(root_order,root_item);
        ''')

    def production_plan(self, db, order, item):
        row=db.execute('SELECT * FROM production_plans WHERE item_id=?',(item['id'],)).fetchone()
        return dict(row) if row else {'print_m':str(item['quantity']), 'final_qty':str(item['quantity']), 'final_unit':item.get('unit',order.get('unit','m'))}

    def configure_production(self, order, data, actor, role):
        if role not in {'pcp','gestao'}:
            raise PermissionError('Somente PCP e Gestão definem as unidades de produção')
        item=next((i for i in order['items'] if i['id']==int(data.get('item_id') or 0)),None)
        if not item: raise ValueError('Arte não pertence ao pedido')
        unit=data.get('final_unit')
        if unit not in {'m','pc'}: raise ValueError('Selecione metros ou peças')
        meters=quantity(data.get('print_m'))
        target=quantity(data.get('final_qty'),unit)
        if order['unit']=='pc' and (unit!='pc' or target!=quantity(item['quantity'],'pc')):
            raise ValueError('A meta em peças deve coincidir com o pedido')
        if order['unit']=='m' and unit=='m' and (meters!=quantity(item['quantity']) or target!=meters):
            raise ValueError('Para metro corrido, mantenha a quantidade contratada do pedido')
        if order['unit']=='m' and meters!=quantity(item['quantity']):
            raise ValueError('A metragem base deve coincidir com o pedido; peças são uma meta separada')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM test_ops WHERE item_id=?',(item['id'],)).fetchone():
                raise ValueError('Defina as unidades antes de liberar a OP')
            sewing=db.execute('SELECT pieces FROM sewing_plans WHERE item_id=? AND enabled=1',(item['id'],)).fetchone()
            if sewing and unit=='pc' and Decimal(sewing['pieces'])!=target:
                raise ValueError('Alinhe as peças previstas da Costura com a meta em peças antes de liberar')
            db.execute('INSERT OR REPLACE INTO production_plans VALUES(?,?,?,?,?,?)',(item['id'],str(meters),str(target),unit,actor,stamp()))
        return {'status':'ok'}

    def measured(self, db, item_id, action):
        row=db.execute('SELECT * FROM production_measurements WHERE item_id=? AND action=?',(item_id,action)).fetchone()
        return dict(row) if row else None

    def complete(self, db, item_id, action):
        return bool(db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,action)).fetchone())

    def sewing_expected(self, db, order, item, sewing):
        done=db.execute("SELECT details FROM stage_flags WHERE item_id=? AND action='sewn'",(item['id'],)).fetchone()
        if done: return Decimal(json.loads(done['details']).get('pieces',sewing['pieces']))
        measured=self.measured(db,item['id'],'cut_done')
        if measured and measured['unit']=='pc': return Decimal(measured['good'])
        allocated=sum((Decimal(row['pieces']) for row in db.execute('SELECT s.pieces FROM replenishment_batches b JOIN sewing_plans s ON s.item_id=-b.id WHERE b.source_item=?',(item['id'],))),Decimal(0))
        return max(Decimal(0),Decimal(sewing['pieces'])-allocated)

    def effective_target(self, db, item, plan, unit):
        column='final_qty' if unit=='pc' else 'print_m'
        base=quantity(plan[column],unit)
        allocated=sum((Decimal(row[column]) for row in db.execute('SELECT print_m,final_qty FROM replenishment_batches WHERE source_item=?',(item['id'],))),Decimal(0))
        return max(Decimal(0),base-allocated)

    def measurement_spec(self, db, order, item, action):
        plan=self.production_plan(db,order,item)
        paper=order['service']=='Venda de Papel'
        unit=plan['final_unit'] if action in {'cut_done','review_done'} or (paper and action=='printed') else 'm'
        expected=self.effective_target(db,item,plan,unit)
        previous='calandra_done' if action=='cut_done' else 'cut_done' if action=='review_done' and order['service']=='Corte a laser' else 'calandra_done' if action=='review_done' and order['service']!='Venda de tecido' else 'printed' if action=='calandra_done' and order['service']!='Transferência direta' else None
        prior=self.measured(db,item['id'],previous) if previous else None
        # Comparisons only between identical units; piece yields are explicitly planned by PCP.
        available=Decimal(prior['good']) if prior and prior['unit']==unit else None
        if action in {'review_done','cut_done'} and self.exhausted(db,item['id']): available=Decimal(0)
        return {'unit':unit,'expected':str(expected),'available':str(available) if available is not None else None}

    def save_measurement(self, db, order, item, data, actor):
        action=data['action'];spec=self.measurement_spec(db,order,item,action)
        if data.get('measurement_unit')!=spec['unit']:
            raise ValueError('Confirme a unidade da medição indicada nesta etapa')
        output_only='output' in data
        processed=quantity(data.get('output') if output_only else data.get('processed'),spec['unit'],True)
        loss=Decimal(0) if output_only else quantity(data.get('loss'),spec['unit'],True)
        if loss>processed: raise ValueError('As perdas não podem superar a quantidade medida')
        if spec['available'] is not None and processed>Decimal(spec['available']):
            raise ValueError('A quantidade medida não pode superar a quantidade útil recebida da etapa anterior')
        good=processed-loss;reason=str(data.get('reason') or '').strip()
        if len(reason)>500 or (not output_only and (loss>0 or good<Decimal(spec['expected'])) and not reason):
            raise ValueError('Descreva a perda ou falta de quantidade (até 500 caracteres)')
        db.execute('INSERT INTO production_measurements VALUES(?,?,?,?,?,?,?,?,?,?)',(item['id'],action,spec['expected'],str(processed),str(loss),str(good),spec['unit'],reason,actor,stamp()))
        return self.measured(db,item['id'],action)

    def exhausted(self, db, item_id):
        row=db.execute('SELECT good FROM production_measurements WHERE item_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',(item_id,)).fetchone()
        return bool(row and Decimal(row['good'])==0)

    def resolve_batch(self, token):
        with self.connection() as db:
            row=db.execute('SELECT * FROM replenishment_batches WHERE token=?',(token,)).fetchone()
            if not row: raise ValueError('Trabalho de produção não encontrado')
            order=json.loads(row['snapshot']);order['batch_token']=row['token']
            return order

    def root_summary(self, db, order, item):
        parent=db.execute('SELECT root_order,root_item FROM replenishment_batches WHERE id=?',(-item['id'],)).fetchone() if item['id']<0 else None
        if parent: return None
        plan=self.production_plan(db,order,item);terminal='printed' if order['service']=='Venda de Papel' else 'review_done'
        rows=[dict(r) for r in db.execute('SELECT * FROM replenishment_batches WHERE root_item=? AND root_order=? ORDER BY id',(item['id'],order['number']))]
        approved=Decimal(0);pending=0;lots=[]
        for lot_id,qty,row in [(item['id'],plan['final_qty'],None)]+[(-r['id'],r['final_qty'],r) for r in rows]:
            measurement=self.measured(db,lot_id,terminal)
            done=self.complete(db,lot_id,terminal)
            good=Decimal(measurement['good']) if measurement else Decimal(qty) if done else Decimal(0)
            approved+=good
            if not done: pending+=1
            if row:
                flags=[r['action'] for r in db.execute('SELECT action FROM stage_flags WHERE item_id=?',(lot_id,))]
                running=[sector for start,end,sector in [('printing','printed','digital'),('calandra_running','calandra_done','calandra'),('cutting','cut_done','corte'),('sewing','sewn','costura')] if start in flags and end not in flags]
                waiting=[]
                totals={}
                for event in db.execute('SELECT sector,quantity FROM test_events WHERE item_id=?',(lot_id,)):
                    totals[event['sector']]=totals.get(event['sector'],Decimal(0))+Decimal(event['quantity'])
                separated=totals.get('estoque',Decimal(0))>=Decimal(row['print_m'])
                prepared=totals.get('preparacao',Decimal(0))>=Decimal(row['print_m'])
                has_sewing=bool(db.execute('SELECT 1 FROM sewing_plans WHERE item_id=? AND enabled=1',(lot_id,)).fetchone())
                cut=order['service']=='Corte a laser'
                if not done:
                    if terminal!='printed' and not separated: waiting.append('estoque')
                    if 'printed' not in flags and 'printing' not in flags: waiting.append('digital')
                    if terminal!='printed' and separated and not prepared: waiting.append('preparacao')
                    if terminal!='printed' and prepared and 'printed' in flags and 'calandra_running' not in flags and 'calandra_done' not in flags and not self.exhausted(db,lot_id): waiting.append('calandra')
                    if cut and 'calandra_done' in flags and 'cutting' not in flags and 'cut_done' not in flags and not self.exhausted(db,lot_id): waiting.append('corte')
                    preceding='cut_done' if cut else 'calandra_done'
                    if has_sewing and preceding in flags and 'sewing' not in flags and 'sewn' not in flags and not self.exhausted(db,lot_id): waiting.append('costura')
                    if terminal=='review_done' and (('sewn' if has_sewing else preceding) in flags or self.exhausted(db,lot_id)): waiting.append('revisao')
                lots.append({'work':f"TR-{row['id']:06d}",'quantity':row['final_qty'],'unit':row['final_unit'],'print_m':row['print_m'],'source':MEASURE_ACTIONS[row['source_action']],'reason':row['reason'],'actor':row['actor'],'created_at':row['created_at'],'approved':str(good),'complete':done,'actions':flags,'running':running,'waiting':waiting})
        missing=max(Decimal(0),Decimal(plan['final_qty'])-approved)
        return {'target':plan['final_qty'],'unit':plan['final_unit'],'approved':str(approved),'missing':str(missing),'pending_batches':pending,'ready':missing==0 and pending==0,'batches':lots}

    def request_replenishment(self, order, data, actor, role):
        action=data.get('source_action');sector=MEASURE_ACTIONS.get(action)
        if not sector or role not in {sector,'gestao'}: raise PermissionError('Somente o setor responsável solicita esta reposição')
        item=next((i for i in order['items'] if i['id']==int(data.get('item_id') or 0)),None)
        if not item: raise ValueError('Arte não pertence ao pedido')
        if not getattr(self,'allow_material_replenishment',False) and order['service'] not in {'Transferência digital','Corte a laser','Venda de Papel'}:
            raise ValueError('Este serviço não usa impressão. Reposição exige um fluxo de material, não reimpressão na Digital')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing=db.execute('SELECT * FROM replenishment_batches WHERE source_item=? AND source_action=?',(item['id'],action)).fetchone()
            if existing: return {'status':'ok','work':f"TR-{existing['id']:06d}"}
            measurement=self.measured(db,item['id'],action)
            if not measurement: raise ValueError('Registre a medição antes de solicitar reposição')
            shortage=max(Decimal(0),Decimal(measurement['expected'])-Decimal(measurement['good']))
            if shortage==0: raise ValueError('A quantidade útil já atende esta etapa; não há falta para repor')
            following={'printed':{'calandra_running','calandra_done','cutting','cut_done','review_done','packed','delivered'},'calandra_done':{'cutting','cut_done','sewing','sewn','review_done','packed','delivered'},'cut_done':{'sewing','sewn','review_done','packed','delivered'},'review_done':{'packed','delivered'}}[action]
            flags={r['action'] for r in db.execute('SELECT action FROM stage_flags WHERE item_id=?',(item['id'],))}
            if flags & following: raise ValueError('A arte já avançou. Solicite a falta na medição da etapa atual para não duplicar reposições')
            parent=db.execute('SELECT * FROM replenishment_batches WHERE id=?',(-item['id'],)).fetchone() if item['id']<0 else None
            root_order=parent['root_order'] if parent else order['number'];root_id=parent['root_item'] if parent else item['id']
            if self.complete(db,root_id,'packed') or self.complete(db,root_id,'delivered') or db.execute('SELECT 1 FROM billing_events WHERE order_number=?',(root_order,)).fetchone():
                raise ValueError('Pedido já encaminhado para entrega ou faturamento')
            plan=self.production_plan(db,order,item)
            requested=quantity(data.get('requested_qty'),measurement['unit']) if 'requested_qty' in data else shortage
            meters=requested if measurement['unit']=='m' else quantity(data.get('print_m'))
            final=requested if measurement['unit']==plan['final_unit'] else quantity(data.get('final_qty'),plan['final_unit'])
            if final>self.effective_target(db,item,plan,plan['final_unit']):
                raise ValueError('A reposição supera a meta restante desta arte')
            token=uuid.uuid4().hex;when=stamp()
            cursor=db.execute('INSERT INTO replenishment_batches(token,root_order,root_item,source_item,source_action,print_m,final_qty,final_unit,snapshot,reason,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(token,root_order,root_id,item['id'],action,str(meters),str(final),plan['final_unit'],'{}',measurement['reason'],actor,when))
            batch_id=cursor.lastrowid;batch_item=-batch_id;number=f'TR-{batch_id:06d}'
            # Operational snapshot has no prices, customer-order number or replacement lineage.
            child_item={k:v for k,v in item.items() if k in {'art','fabric','width_m','asset_id','original_name','original_path'}}
            child_item.update(id=batch_item,quantity=str(final),unit=plan['final_unit'],service=order['service'])
            child={k:v for k,v in order.items() if k in {'client','fabric','width_m','delivery','service'}}
            child.update(number=number,unit=plan['final_unit'],created_at=when,items=[child_item])
            db.execute('UPDATE replenishment_batches SET snapshot=? WHERE id=?',(json.dumps(child,ensure_ascii=False),batch_id))
            db.execute('INSERT INTO production_plans VALUES(?,?,?,?,?,?)',(batch_item,str(meters),str(final),plan['final_unit'],actor,when))
            db.execute('INSERT INTO releases VALUES(?,?,?)',(number,actor,when))
            db.execute('INSERT INTO test_ops VALUES(?,?,?,?)',(batch_item,number,number,str(meters)))
            owner=db.execute('SELECT owner FROM stock_identity WHERE item_id=?',(item['id'],)).fetchone()
            if owner: db.execute('INSERT INTO stock_identity VALUES(?,?,?,?)',(batch_item,owner['owner'],actor,when))
            sewing=db.execute('SELECT * FROM sewing_plans WHERE item_id=? AND enabled=1',(item['id'],)).fetchone()
            if sewing:
                pieces=final if plan['final_unit']=='pc' else quantity(data.get('sewing_pieces'),'pc')
                allocated=sum((Decimal(r['pieces']) for r in db.execute('SELECT s.pieces FROM replenishment_batches b JOIN sewing_plans s ON s.item_id=-b.id WHERE b.source_item=?',(item['id'],))),Decimal(0))
                if pieces>Decimal(sewing['pieces'])-allocated: raise ValueError('As peças de Costura superam a quantidade restante planejada')
                db.execute('INSERT INTO sewing_plans VALUES(?,?,?,?,?,?)',(batch_item,1,sewing['instructions'],int(pieces),actor,when))
        return {'status':'ok','work':number}

    def production_orders(self, orders, role):
        if role not in {'estoque','digital','preparacao','calandra','corte','costura','revisao'}: return []
        from integracao_fabrica.views import project_order
        visible_numbers={o['number'] for o in orders}
        result=[]
        with self.connection() as db:
            batches=[dict(r) for r in db.execute('SELECT * FROM replenishment_batches ORDER BY id DESC') if r['root_order'] in visible_numbers]
        for row in batches:
            source=json.loads(row['snapshot']);projected=self.attach(project_order(source,role),role,source['service'])
            projected['batch_token']=row['token']
            if role=='revisao': projected['number']=row['root_order']
            result.append(projected)
        return result

    def attach_production(self, db, result, source_order, role):
        service=source_order['service']
        for out in result['items']:
            item=next(i for i in source_order['items'] if i['id']==out['id']);plan=self.production_plan(db,source_order,item)
            out['production_plan']={k:plan[k] for k in ('print_m','final_qty','final_unit')}
            out['production_configured']=bool(db.execute('SELECT 1 FROM production_plans WHERE item_id=?',(item['id'],)).fetchone())
            sewing=db.execute('SELECT * FROM sewing_plans WHERE item_id=? AND enabled=1',(item['id'],)).fetchone()
            if sewing:
                out['sewing_requirement']={'enabled':True,'pieces_remaining':str(self.sewing_expected(db,source_order,item,sewing))}
                if role=='costura': out['sewing_plan']['pieces']=int(self.sewing_expected(db,source_order,item,sewing))
            f=out['test_flow'];measurements=[dict(r) for r in db.execute('SELECT * FROM production_measurements WHERE item_id=? ORDER BY created_at,rowid',(item['id'],))]
            if role in {'digital','calandra','corte','revisao','gestao','financeiro'}:
                out['measurements']=[m for m in measurements if role in LINK_ROLES or MEASURE_ACTIONS[m['action']]==role]
            own_action=next((a for a,s in MEASURE_ACTIONS.items() if s==role),None)
            if own_action: out['measurement_spec']=self.measurement_spec(db,source_order,item,own_action)
            last=measurements[-1] if measurements else None
            own=next((m for m in measurements if m['action']==own_action),None)
            if own:
                requested=db.execute('SELECT id FROM replenishment_batches WHERE source_item=? AND source_action=?',(item['id'],own_action)).fetchone()
                later={'printed':{'calandra_running','cutting','review_done','packed'},'calandra_done':{'cutting','sewing','review_done','packed'},'cut_done':{'sewing','review_done','packed'},'review_done':{'packed','delivered'}}[own_action]
                advanced=any(self.complete(db,item['id'],a) for a in later)
                out['quantity_issue']={'missing':str(max(Decimal(0),Decimal(own['expected'])-Decimal(own['good']))),'unit':own['unit'],'requested':bool(requested),'can_request':bool(last and last['action']==own_action and not advanced and not requested and (getattr(self,'allow_material_replenishment',False) or service in {'Transferência digital','Corte a laser','Venda de Papel'}))}
            measured_print=self.measured(db,item['id'],'printed')
            f['printed']=self.complete(db,item['id'],'printed') or f['printed']
            f['printing']=self.complete(db,item['id'],'printing') and not f['printed']
            f['calandra_ready']=f['prepared'] and (service=='Transferência direta' or f['printed']) and (not measured_print or Decimal(measured_print['good'])>0)
            f['exhausted']=self.exhausted(db,item['id'])
            if f['exhausted']: f['review_ready']=service!='Venda de Papel'
            if role in {'estoque','preparacao','calandra'} or (role=='digital' and service!='Venda de Papel'):
                out['quantity']=plan['print_m'];out['unit']='m'
            elif role in {'corte','costura','revisao','expedicao'} or (role=='digital' and service=='Venda de Papel'):
                out['quantity']=plan['final_qty'];out['unit']=plan['final_unit']
            if item['id']<0:
                f['expedition_ready']=False
                if role=='revisao': out['work_label']=out['test_op']
            else:
                summary=self.root_summary(db,source_order,item)
                if summary['batches'] or measurements:
                    f['expedition_ready']=summary['ready']
                if role in LINK_ROLES: out['replenishment']=summary
        return result
