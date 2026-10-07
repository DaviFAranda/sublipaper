"""Fluxo isolado de homologação; não toca os bancos de Estoque ou Digital."""
from __future__ import annotations

import sqlite3
import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from production_tracking import ProductionTracking, MEASURE_ACTIONS, quantity

DIGITAL_MACHINES = ('Atexco Model X', 'SOLIS', 'Atexco Model H-16F-4', 'EFI Reggiani Compact')
PAPER_WIDTHS = ('1,60 m', '1,80 m')
CALANDRAS = tuple(f'Calandra {number}' for number in range(1, 6))
PRINT_SERVICES = {'Transferência digital', 'Venda de Papel', 'Corte a laser'}
CALANDRA_SERVICES = {'Transferência digital', 'Transferência direta', 'Corte a laser'}


def amount(value):
    try:
        number = Decimal(str(value).replace(',', '.'))
    except (InvalidOperation, ValueError):
        raise ValueError('Quantidade inválida') from None
    if not number.is_finite() or number <= 0 or number.as_tuple().exponent < -3:
        raise ValueError('Quantidade deve ser positiva e ter até três casas decimais')
    return number


class WorkflowEngine(ProductionTracking):
    allow_partial_sewing = False
    allow_kg_planning = False
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS releases (
                    order_number TEXT PRIMARY KEY, actor TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS test_ops (
                    item_id INTEGER PRIMARY KEY, order_number TEXT NOT NULL,
                    op_number TEXT NOT NULL UNIQUE, planned TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS test_events (
                    id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
                    item_id INTEGER NOT NULL, sector TEXT NOT NULL,
                    quantity TEXT NOT NULL, reference TEXT NOT NULL,
                    secondary_reference TEXT NOT NULL DEFAULT '',
                    actor TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_test_events_item ON test_events(item_id,sector);
                CREATE TABLE IF NOT EXISTS stage_flags (
                    item_id INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
                    created_at TEXT NOT NULL, machine TEXT NOT NULL DEFAULT '',
                    reference TEXT NOT NULL DEFAULT '', PRIMARY KEY(item_id,action)
                );
                CREATE TABLE IF NOT EXISTS sewing_plans (
                    item_id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL,
                    instructions TEXT NOT NULL, pieces INTEGER NOT NULL,
                    actor TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS stock_identity (
                    item_id INTEGER PRIMARY KEY, owner TEXT NOT NULL,
                    actor TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS billing_events (
                    order_number TEXT NOT NULL, action TEXT NOT NULL, amount TEXT NOT NULL,
                    reference TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY(order_number,action)
                );
            ''')
            self.init_production(db)
            columns = {row['name'] for row in db.execute('PRAGMA table_info(stage_flags)')}
            if 'machine' not in columns:
                db.execute("ALTER TABLE stage_flags ADD COLUMN machine TEXT NOT NULL DEFAULT ''")
            if 'reference' not in columns:
                db.execute("ALTER TABLE stage_flags ADD COLUMN reference TEXT NOT NULL DEFAULT ''")
            if 'details' not in columns:
                db.execute("ALTER TABLE stage_flags ADD COLUMN details TEXT NOT NULL DEFAULT '{}'")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA busy_timeout=10000')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def release(self, order: dict, actor: str, role: str):
        if role not in {'pcp', 'gestao'}:
            raise PermissionError('Somente PCP libera pedidos e cria OPs')
        if not order['items']:
            raise ValueError('Pedido sem artes')
        if order['unit'] not in ({'m','pc','kg'} if self.allow_kg_planning else {'m','pc'}):
            raise ValueError('Este fluxo registra metros e peças; kg exige conversão validada')
        if order['service'] in PRINT_SERVICES and any(not i['original_path'] for i in order['items']):
            raise ValueError('Informe a referência da arte pronta em cada item antes de liberar')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM releases WHERE order_number=?', (order['number'],)).fetchone():
                raise ValueError('Pedido já liberado para produção')
            timestamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
            db.execute('INSERT INTO releases VALUES(?,?,?)', (order['number'], actor, timestamp))
            for index, item in enumerate(order['items'], 1):
                plan=self.production_plan(db,order,item)
                if order['unit'] in {'pc','kg'} and not db.execute('SELECT 1 FROM production_plans WHERE item_id=?',(item['id'],)).fetchone():
                    raise ValueError('PCP: defina o comprimento e a meta final para esta unidade antes de liberar')
                quantity(plan['final_qty'],plan['final_unit'])
                db.execute('INSERT INTO test_ops VALUES(?,?,?,?)',
                           (item['id'], order['number'], f"{order['number']}-{index:02d}-01", str(amount(plan['print_m']))))
            db.commit()
        return {'number': order['number'], 'status': 'liberado', 'ops': len(order['items'])}

    def configure(self, order, data, actor, role):
        kind = data.get('kind')
        if kind=='production': return self.configure_production(order,data,actor,role)
        allowed = {'owner': {'estoque','gestao'}, 'sewing': {'pcp','gestao'}}
        if kind not in allowed or role not in allowed[kind]:
            raise PermissionError('Perfil sem permissão para esta configuração')
        item_id = int(data.get('item_id') or 0)
        if item_id not in {item['id'] for item in order['items']}:
            raise ValueError('Arte não pertence ao pedido')
        if order['service'] == 'Venda de Papel':
            raise ValueError('Venda de Papel não usa tecido ou Costura')
        timestamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if kind == 'owner':
                owner = str(data.get('owner') or '').strip()
                if not owner or len(owner)>120:
                    raise ValueError('Informe o proprietário do tecido (até 120 caracteres)')
                existing = db.execute('SELECT owner FROM stock_identity WHERE item_id=?',(item_id,)).fetchone()
                if existing and existing['owner'] == owner:
                    return {'status':'ok'}
                if existing:
                    raise ValueError('Proprietário já confirmado. Correções precisam de conciliação.')
                db.execute('INSERT INTO stock_identity VALUES(?,?,?,?)',(item_id,owner,actor,timestamp))
            else:
                if db.execute("SELECT 1 FROM stage_flags WHERE item_id=? AND action IN ('sewing','sewn','review_done','packed','delivered')",(item_id,)).fetchone():
                    raise ValueError('Rota bloqueada: Costura ou etapa posterior já iniciada')
                enabled = data.get('enabled')
                if not isinstance(enabled,bool):
                    raise ValueError('Informe se a OP precisa de Costura')
                instructions = str(data.get('instructions') or '').strip()
                pieces = str(data.get('pieces') or '0')
                if enabled and (not pieces.isdigit() or not 1 <= int(pieces) <= 1000000 or not instructions or len(instructions)>1000):
                    raise ValueError('Informe peças previstas e instruções de montagem (até 1000 caracteres)')
                plan=self.production_plan(db,order,next(i for i in order['items'] if i['id']==item_id))
                if enabled and plan['final_unit']=='pc' and Decimal(pieces)!=Decimal(plan['final_qty']):
                    raise ValueError('As peças da Costura devem coincidir com a meta em peças definida pelo PCP')
                db.execute('INSERT OR REPLACE INTO sewing_plans VALUES(?,?,?,?,?,?)',
                           (item_id,int(enabled),instructions if enabled else '',int(pieces) if enabled else 0,actor,timestamp))
        return {'status':'ok'}

    def billing(self, order, data, actor, role):
        if role not in {'financeiro','gestao'}:
            raise PermissionError('Faturamento restrito ao Financeiro e Gestão')
        action = data.get('action')
        if action not in {'invoiced','paid'}:
            raise ValueError('Ação financeira inválida')
        reference = str(data.get('reference') or '').strip()
        if not reference or len(reference)>120:
            raise ValueError('Informe a referência do registro (até 120 caracteres)')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM billing_events WHERE order_number=? AND action=?',(order['number'],action)).fetchone():
                return {'status':'ok'}
            if action == 'invoiced':
                if not order['items'] or any(item.get('total') is None for item in order['items']):
                    raise ValueError('Pedido com preço ou quantidade faturável pendente')
                if any(not db.execute("SELECT 1 FROM stage_flags WHERE item_id=? AND action='delivered'",(item['id'],)).fetchone() for item in order['items']):
                    raise ValueError('Neste teste, conclua a entrega de todas as OPs antes de faturar')
                value = sum((Decimal(str(item['total'])) for item in order['items']),Decimal(0))
                if not value.is_finite() or value < 0:
                    raise ValueError('Valor faturável inválido')
            else:
                invoice = db.execute("SELECT amount FROM billing_events WHERE order_number=? AND action='invoiced'",(order['number'],)).fetchone()
                if not invoice:
                    raise ValueError('Registre o faturamento antes do recebimento')
                value = Decimal(invoice['amount'])
            db.execute('INSERT INTO billing_events VALUES(?,?,?,?,?,?)',
                       (order['number'],action,str(value.quantize(Decimal('0.01'))),reference,actor,datetime.now(timezone.utc).isoformat(timespec='seconds')))
        return {'status':'ok'}

    def record(self, order: dict, data: dict, actor: str, role: str):
        sector = str(data.get('sector') or '')
        if sector not in {'estoque', 'digital'} or role not in {sector, 'gestao'}:
            raise PermissionError('Setor não autorizado')
        if sector == 'estoque' and order['service'] == 'Venda de Papel':
            raise ValueError('Venda de Papel não requer separação de tecido')
        if sector == 'digital' and order['service'] not in PRINT_SERVICES:
            raise ValueError('Serviço sem impressão de papel neste teste')
        try:
            item_id = int(data.get('item_id'))
        except (TypeError, ValueError):
            raise ValueError('Arte inválida') from None
        if item_id not in {item['id'] for item in order['items']}:
            raise ValueError('Arte não pertence ao pedido')
        quantity = amount(data.get('quantity'))
        reference = str(data.get('reference') or '').strip()
        secondary = str(data.get('secondary_reference') or '').strip()
        request_key = str(data.get('request_key') or '').strip()
        if not reference or len(reference) > 120 or len(secondary) > 120 or not request_key or len(request_key) > 100:
            raise ValueError('Informe o código do rolo/papel e uma chave de envio')
        if sector == 'estoque' and not secondary:
            raise ValueError('Informe o proprietário do tecido para conferência manual')
        if sector == 'digital' and not secondary:
            raise ValueError('Informe a máquina usada')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM test_events WHERE request_key=?', (request_key,)).fetchone()
            if existing:
                if (existing['item_id'], existing['sector'], existing['quantity'], existing['reference'], existing['secondary_reference']) != (item_id, sector, str(quantity), reference, secondary):
                    raise ValueError('Chave de envio já usada para outro apontamento')
                return dict(existing)
            op = db.execute('SELECT planned FROM test_ops WHERE item_id=? AND order_number=?', (item_id, order['number'])).fetchone()
            if not op:
                raise ValueError('PCP ainda não liberou esta arte/OP')
            previous = db.execute('SELECT quantity FROM test_events WHERE item_id=? AND sector=?', (item_id, sector)).fetchall()
            if sum((Decimal(row['quantity']) for row in previous), Decimal(0)) + quantity > Decimal(op['planned']):
                raise ValueError('Quantidade do setor excede a OP')
            event_id = uuid.uuid4().hex
            db.execute('INSERT INTO test_events VALUES(?,?,?,?,?,?,?,?,?)',
                       (event_id, request_key, item_id, sector, str(quantity), reference, secondary,
                        actor, datetime.now(timezone.utc).isoformat(timespec='seconds')))
            db.commit()
            return dict(db.execute('SELECT * FROM test_events WHERE id=?', (event_id,)).fetchone())

    def transition(self, order, data, actor, role):
        action = str(data.get('action') or '')
        roles = {'available':'estoque', 'separated':'estoque', 'prepared':'preparacao',
                 'printing':'digital', 'printed':'digital', 'calandra_running':'calandra',
                 'calandra_done':'calandra', 'cutting':'corte', 'cut_done':'corte',
                 'review_done':'revisao', 'packed':'expedicao', 'delivered':'expedicao',
                 'sewing':'costura', 'sewn':'costura'}
        if action not in roles or role not in {roles.get(action), 'gestao'}:
            raise PermissionError('Ação não autorizada para este setor')
        item_id = int(data.get('item_id') or 0)
        if item_id not in {i['id'] for i in order['items']}:
            raise ValueError('Arte não pertence ao pedido')
        service = order['service']
        sector = roles[action]
        if sector in {'estoque','preparacao'} and service == 'Venda de Papel':
            raise ValueError('Este serviço não usa tecido')
        if sector == 'preparacao' and service not in CALANDRA_SERVICES:
            raise ValueError('Este serviço não passa pela preparação para Calandra')
        if sector == 'digital' and service not in PRINT_SERVICES:
            raise ValueError('Este serviço não usa impressão de papel')
        if sector == 'calandra' and service not in CALANDRA_SERVICES:
            raise ValueError('Este serviço não passa pela Calandra')
        if sector == 'corte' and service != 'Corte a laser':
            raise ValueError('Este pedido não passa pelo Corte a laser')
        if sector == 'revisao' and service == 'Venda de Papel':
            raise ValueError('Venda de Papel segue direto da Digital para Expedição')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            op = db.execute('SELECT planned FROM test_ops WHERE item_id=? AND order_number=?', (item_id,order['number'])).fetchone()
            if not op:
                raise ValueError('Aguarde a liberação do PCP')
            if db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,action)).fetchone():
                return {'status':'ok'}
            totals = {}
            for row in db.execute('SELECT sector,quantity FROM test_events WHERE item_id=?',(item_id,)):
                totals[row['sector']] = totals.get(row['sector'],Decimal(0)) + Decimal(row['quantity'])
            planned = Decimal(op['planned'])
            item=next(i for i in order['items'] if i['id']==item_id)
            if action in {'cutting','sewing'} and self.exhausted(db,item_id):
                raise ValueError('Sem quantidade útil neste trabalho. Registre zero na Revisão e solicite a reposição da falta')
            details = {}
            sewing_plan = db.execute('SELECT * FROM sewing_plans WHERE item_id=? AND enabled=1',(item_id,)).fetchone()
            if action == 'separated':
                owner = db.execute('SELECT owner FROM stock_identity WHERE item_id=?',(item_id,)).fetchone()
                previous_owner = db.execute("SELECT secondary_reference AS owner FROM test_events WHERE item_id=? AND sector='estoque' AND secondary_reference!='' ORDER BY created_at DESC LIMIT 1",(item_id,)).fetchone()
                owner = owner or previous_owner
                if not owner:
                    raise ValueError('Confirme o proprietário do tecido antes de separar')
                details['owner'] = owner['owner']
            if action == 'prepared' and totals.get('estoque',Decimal(0)) < planned:
                raise ValueError('O Estoque precisa separar toda a quantidade desta OP')
            reference = str(data.get('reference') or '').strip()
            machine = str(data.get('machine') or '').strip()
            if action in {'printing','printed'} and (machine not in DIGITAL_MACHINES or reference not in PAPER_WIDTHS):
                raise ValueError('Selecione uma máquina Digital e a largura do papel')
            if action == 'printing' and totals.get('digital',Decimal(0)) >= planned:
                raise ValueError('A impressão desta OP já foi concluída')
            if action == 'printed':
                printing = db.execute("SELECT machine,reference FROM stage_flags WHERE item_id=? AND action='printing'",(item_id,)).fetchone()
                if not printing:
                    raise ValueError('Inicie a impressão na Digital antes de concluir')
                if printing['machine'] != machine or printing['reference'] != reference:
                    raise ValueError('Conclua com a mesma máquina e largura de papel selecionadas no início')
            if action in {'calandra_running','calandra_done'}:
                if machine not in CALANDRAS:
                    raise ValueError('Selecione uma das cinco Calandras')
                ready = totals.get('preparacao',Decimal(0)) >= planned and (
                    service == 'Transferência direta' or self.complete(db,item_id,'printed') or totals.get('digital',Decimal(0)) >= planned)
                printed_measure=self.measured(db,item_id,'printed')
                if printed_measure and Decimal(printed_measure['good'])==0: ready=False
                if not ready:
                    raise ValueError('Aguarde o tecido preparado e o papel impresso desta OP')
                running = db.execute('SELECT machine FROM stage_flags WHERE item_id=? AND action=?',
                                     (item_id,'calandra_running')).fetchone()
                if action == 'calandra_done' and not running:
                    raise ValueError('Inicie a Calandra antes de concluir')
                if action == 'calandra_done' and running['machine'] != machine:
                    raise ValueError('Conclua na mesma Calandra em que iniciou')
            if action in {'cutting','cut_done'}:
                if not db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,'calandra_done')).fetchone():
                    raise ValueError('Aguarde a conclusão na Calandra')
                if action == 'cut_done' and not db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,'cutting')).fetchone():
                    raise ValueError('Inicie o Corte antes de concluir')
            if action in {'sewing','sewn'}:
                if not sewing_plan:
                    raise ValueError('O PCP precisa incluir Costura nesta OP')
                prerequisite = 'cut_done' if service == 'Corte a laser' else 'separated' if service == 'Venda de tecido' else 'calandra_done'
                ready = totals.get('estoque',Decimal(0)) >= planned if prerequisite == 'separated' else bool(db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,prerequisite)).fetchone())
                if not ready:
                    raise ValueError('Aguarde a etapa anterior antes da Costura')
                if action == 'sewn':
                    if not db.execute("SELECT 1 FROM stage_flags WHERE item_id=? AND action='sewing'",(item_id,)).fetchone():
                        raise ValueError('Inicie a Costura antes de concluir')
                    pieces_expected=str(self.sewing_expected(db,order,item,sewing_plan))
                    if quantity(data.get('pieces'),'pc',True) > Decimal(pieces_expected) or (not self.allow_partial_sewing and quantity(data.get('pieces'),'pc',True)!=Decimal(pieces_expected)):
                        raise ValueError('A quantidade de Costura não pode superar a meta desta OP')
                    details['pieces'] = int(quantity(data.get('pieces'),'pc',True))
            if action == 'review_done':
                prerequisite = 'sewn' if sewing_plan else 'cut_done' if service == 'Corte a laser' else 'separated' if service == 'Venda de tecido' else 'calandra_done'
                if prerequisite == 'separated':
                    ready = totals.get('estoque',Decimal(0)) >= planned
                else:
                    ready = bool(db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,prerequisite)).fetchone())
                if self.exhausted(db,item_id): ready=True
                if not ready:
                    raise ValueError('Aguarde a etapa anterior desta OP antes da Revisão')
            if action in {'packed','delivered'}:
                if item_id<0: raise ValueError('Este trabalho retorna à conferência do pedido; não possui entrega separada')
                summary=self.root_summary(db,order,item)
                if not summary['ready']: raise ValueError('Aguarde a quantidade aprovada completa e a conferência de todos os trabalhos')
                ready = self.complete(db,item_id,'printed') or totals.get('digital',Decimal(0)) >= planned if service == 'Venda de Papel' else bool(
                    db.execute('SELECT 1 FROM stage_flags WHERE item_id=? AND action=?',(item_id,'review_done')).fetchone())
                if not ready:
                    raise ValueError('Aguarde a impressão ou Revisão desta OP antes da Expedição')
                if action == 'packed':
                    if not reference or len(reference)>120 or machine not in {'Retirada','Entrega'}:
                        raise ValueError('Informe o volume e selecione Retirada ou Entrega')
                    details['destination'] = str(data.get('destination') or '').strip()
                    if len(details['destination'])>300 or (machine == 'Entrega' and not details['destination']):
                        raise ValueError('Informe o destino da entrega (até 300 caracteres)')
                else:
                    packed = db.execute("SELECT reference FROM stage_flags WHERE item_id=? AND action='packed'",(item_id,)).fetchone()
                    if not packed:
                        raise ValueError('Prepare o volume antes de registrar a entrega')
                    reference = packed['reference']
                    if not machine or len(machine)>120:
                        raise ValueError('Informe quem recebeu (até 120 caracteres)')
            if action in MEASURE_ACTIONS:
                details['measurement']=self.save_measurement(db,order,item,data,actor)
            timestamp = datetime.now(timezone.utc).isoformat(timespec='seconds')
            if action in {'separated','prepared','printed'}:
                target=Decimal(details['measurement']['good']) if action=='printed' else planned
                remaining = target - totals.get(roles[action],Decimal(0))
                if remaining > 0:
                    db.execute('INSERT INTO test_events VALUES(?,?,?,?,?,?,?,?,?)',
                               (uuid.uuid4().hex, f'button:{item_id}:{action}', item_id, roles[action], str(remaining),
                                reference if action=='printed' else 'Confirmação operacional',
                                machine if action=='printed' else details.get('owner',''), actor,timestamp))
            db.execute('INSERT INTO stage_flags(item_id,action,actor,created_at,machine,reference,details) VALUES(?,?,?,?,?,?,?)',
                       (item_id,action,actor,timestamp,machine,reference,json.dumps(details,ensure_ascii=False)))
        return {'status':'ok'}

    def attach(self, order: dict, role: str, service=None):
        with self.connection() as db:
            released = db.execute('SELECT 1 FROM releases WHERE order_number=?', (order['number'],)).fetchone()
            ops = {row['item_id']: dict(row) for row in db.execute('SELECT * FROM test_ops WHERE order_number=?', (order['number'],))}
            visible = {'estoque', 'digital', 'preparacao', 'calandra', 'corte', 'revisao', 'expedicao'} if role in {'pcp', 'gestao'} else {role}
            result = dict(order)
            result['test_status'] = 'Liberado para produção' if released else 'Aguardando PCP'
            result['items'] = []
            for item in order['items']:
                out = dict(item)
                op = ops.get(item['id'])
                out['test_op'] = op['op_number'] if op else None
                out['test_events'] = []
                out['test_totals'] = {}
                totals = {}
                if op:
                    for row in db.execute('SELECT * FROM test_events WHERE item_id=? ORDER BY created_at,id', (item['id'],)):
                        totals[row['sector']] = totals.get(row['sector'],Decimal(0)) + Decimal(row['quantity'])
                        if row['sector'] not in visible:
                            continue
                        event = dict(row)
                        out['test_events'].append(event)
                        key = event['sector']
                        out['test_totals'][key] = str(Decimal(out['test_totals'].get(key, '0')) + Decimal(event['quantity']))
                flags = {row['action']:dict(row) for row in db.execute('SELECT * FROM stage_flags WHERE item_id=?',(item['id'],))}
                planned = Decimal(op['planned']) if op else Decimal(item['quantity'])
                separated = bool(op) and totals.get('estoque',Decimal(0)) >= planned
                prepared = bool(op) and totals.get('preparacao',Decimal(0)) >= planned
                printed = bool(op) and totals.get('digital',Decimal(0)) >= planned
                route = item.get('service') or service or order.get('service','')
                sewing_plan = db.execute('SELECT * FROM sewing_plans WHERE item_id=?',(item['id'],)).fetchone()
                sewing = bool(sewing_plan and sewing_plan['enabled'])
                production_done = 'cut_done' in flags if route == 'Corte a laser' else separated if route == 'Venda de tecido' else 'calandra_done' in flags
                owner_row = db.execute('SELECT owner FROM stock_identity WHERE item_id=?',(item['id'],)).fetchone()
                if not owner_row:
                    owner_row = db.execute("SELECT secondary_reference AS owner FROM test_events WHERE item_id=? AND sector='estoque' AND secondary_reference!='' ORDER BY created_at DESC LIMIT 1",(item['id'],)).fetchone()
                if role in {'estoque','preparacao','pcp','gestao'}:
                    out['fabric_owner'] = owner_row['owner'] if owner_row else None
                    out['owner_confirmed'] = bool(db.execute('SELECT 1 FROM stock_identity WHERE item_id=?',(item['id'],)).fetchone())
                out['test_flow'] = {'available': separated or 'available' in flags,
                                    'separated': separated, 'prepared': prepared, 'printed': printed,
                                    'printing': 'printing' in flags and not printed,
                                    'digital_machine': flags.get('printed',flags.get('printing',{})).get('machine',''),
                                    'paper_width': flags.get('printed',flags.get('printing',{})).get('reference',''),
                                    'calandra_running': 'calandra_running' in flags and 'calandra_done' not in flags,
                                    'calandra_done': 'calandra_done' in flags,
                                    'calandra_machine': flags.get('calandra_running',{}).get('machine',''),
                                    'cutting': 'cutting' in flags and 'cut_done' not in flags,
                                    'cut_done': 'cut_done' in flags,
                                    'review_done': 'review_done' in flags,
                                    'delivered': 'delivered' in flags,
                                    'packed': 'packed' in flags or 'delivered' in flags,
                                    'needs_sewing': sewing,
                                    'sewing': 'sewing' in flags and 'sewn' not in flags,
                                    'sewn': 'sewn' in flags,
                                    'sewing_ready': sewing and production_done,
                                    'review_ready': route != 'Venda de Papel' and ('sewn' in flags if sewing else production_done),
                                    'expedition_ready': printed if route == 'Venda de Papel' else 'review_done' in flags,
                                    'needs_fabric': route != 'Venda de Papel',
                                    'needs_preparation': route in CALANDRA_SERVICES,
                                    'needs_print': route in PRINT_SERVICES,
                                    'needs_calandra': route in CALANDRA_SERVICES,
                                    'needs_cut': route == 'Corte a laser',
                                    'needs_review': route != 'Venda de Papel',
                                    'calandra_ready': prepared and (printed if route in PRINT_SERVICES else True)}
                if role in {'costura','corte','revisao','expedicao','pcp','gestao'}:
                    out['sewing_plan'] = {'enabled':sewing,'pieces':sewing_plan['pieces'] if sewing_plan else 0,
                                          'instructions':sewing_plan['instructions'] if sewing_plan else '',
                                          'completed_pieces':json.loads(flags.get('sewn',{}).get('details','{}')).get('pieces',0)}
                if role in {'expedicao','financeiro','pcp','gestao'}:
                    out['dispatch'] = {'volume':flags.get('packed',flags.get('delivered',{})).get('reference',''),
                                       'method':flags.get('packed',{}).get('machine',''),
                                       'destination':json.loads(flags.get('packed',{}).get('details','{}')).get('destination',''),
                                       'recipient':flags.get('delivered',{}).get('machine',''),
                                       'delivered_at':flags.get('delivered',{}).get('created_at','')}
                action_roles = {'available':'estoque','separated':'estoque','printing':'digital','printed':'digital',
                                'prepared':'preparacao','calandra_running':'calandra','calandra_done':'calandra',
                                'cutting':'corte','cut_done':'corte','sewing':'costura','sewn':'costura',
                                'review_done':'revisao','packed':'expedicao','delivered':'expedicao'}
                out['stage_history'] = [{'action':flag['action'],'actor':flag['actor'],'created_at':flag['created_at']}
                                        for flag in sorted(flags.values(),key=lambda row:row['created_at'])
                                        if role in {'pcp','gestao'} or action_roles.get(flag['action']) == role]
                result['items'].append(out)
            if role in {'financeiro','gestao'}:
                events = [dict(row) for row in db.execute('SELECT * FROM billing_events WHERE order_number=? ORDER BY created_at,action',(order['number'],))]
                result['billing'] = {'status':'paid' if any(event['action']=='paid' for event in events) else 'invoiced' if events else 'pending',
                                     'events':events,'ready':bool(result['items']) and all(item['test_flow']['delivered'] for item in result['items']) and all(item.get('total') is not None for item in result['items'])}
            return self.attach_production(db,result,{**order,'service':service or order.get('service','')},role)
