"""Sublipaper Pedidos — demo local, Python 3.10+, sem dependências externas."""
import argparse
import json
import os
import io
import re
import uuid
import tempfile
import threading
import warnings
import time
import socket
import hashlib
try:
    import pymupdf as fitz
except ImportError:
    fitz = None
import sqlite3
import unicodedata
from contextlib import contextmanager
import webbrowser
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageOps, UnidentifiedImageError
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader
from integracao_fabrica.core import Factory, SECTORS
from integracao_fabrica.views import project_order
from test_workflow import TestWorkflow
import billing_bridge
import sheet_bridge
from operations_workflow import OperationsWorkflow

IMAGE_LOCK = threading.Lock()
MAX_UPLOAD = 256 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 80_000_000

ROOT = Path(__file__).resolve().parent
DB = Path(os.environ.get('SUBLIPAPER_DATA_DIR', str(ROOT / 'dados'))) / 'pedidos.sqlite3'
ACCESS_FACTORY = None
PREVIEW_ONLY = os.environ.get('SUBLIPAPER_PREVIEW_ONLY') == '1'
TEST_MODE = (PREVIEW_ONLY and os.environ.get('SUBLIPAPER_TEST_WORKFLOW') == '1'
             and DB.parent.resolve().is_relative_to((ROOT / 'dados').resolve())
             and DB.parent.name.startswith('portal-preview-'))
TEST_WORKFLOW = TestWorkflow(DB.parent / 'fluxo_teste.sqlite3') if TEST_MODE else None
PRODUCTION_ENABLED=os.environ.get('SUBLIPAPER_PRODUCTION_WORKFLOW')=='1' and not PREVIEW_ONLY
PRODUCTION_WORKFLOW=OperationsWorkflow(DB.parent/'operacoes.sqlite3',DB,os.environ.get('SUBLIPAPER_LASER_DB','')) if PRODUCTION_ENABLED else None
WORKFLOW=PRODUCTION_WORKFLOW or TEST_WORKFLOW
SERVICES = ['Corte a laser', 'Venda de Papel', 'Transferência digital', 'Venda de tecido', 'Transferência direta']
CLIENT_REFRESH_LOCK = threading.Lock()
FOLDER_CACHE_LOCK = threading.Lock()
FOLDER_CACHE = {}
FOLDER_REFRESHING = set()
last_client_attempt = 0

@contextmanager
def connect():
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        with c:
            yield c
    finally:
        c.close()

def initialize():
    DB.parent.mkdir(parents=True, exist_ok=True)
    with connect() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE,
          request_key TEXT NOT NULL UNIQUE, client TEXT NOT NULL, delivery TEXT NOT NULL, nf TEXT NOT NULL,
          notes TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
          art TEXT NOT NULL, service TEXT NOT NULL, quantity TEXT NOT NULL, unit TEXT NOT NULL,
          fabric TEXT NOT NULL, fabric_width TEXT, paper_width TEXT, price TEXT, billing_meters TEXT);
        CREATE TABLE IF NOT EXISTS prices(client_key TEXT NOT NULL, service TEXT NOT NULL,
          price TEXT NOT NULL, client TEXT NOT NULL, PRIMARY KEY(client_key, service));
        ''')
        columns = {r['name'] for r in c.execute('PRAGMA table_info(items)')}
        for name in ['asset_id', 'original_name', 'original_path']:
            if name not in columns:
                c.execute(f"ALTER TABLE items ADD COLUMN {name} TEXT NOT NULL DEFAULT ''")
        c.execute('CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL)')
        if 'width_m' not in columns:
            c.execute('ALTER TABLE items ADD COLUMN width_m TEXT')
        order_columns = {r['name'] for r in c.execute('PRAGMA table_info(orders)')}
        if 'client_folder' not in order_columns:
            c.execute("ALTER TABLE orders ADD COLUMN client_folder TEXT NOT NULL DEFAULT ''")
        if 'deleted_at' not in order_columns:
            c.execute('ALTER TABLE orders ADD COLUMN deleted_at TEXT')
        if 'fabric' not in order_columns:
            c.execute("ALTER TABLE orders ADD COLUMN fabric TEXT NOT NULL DEFAULT ''")
        if 'width_m' not in order_columns:
            c.execute('ALTER TABLE orders ADD COLUMN width_m TEXT')
        if 'unit_price' not in order_columns:
            c.execute('ALTER TABLE orders ADD COLUMN unit_price TEXT')
        if 'unit' not in order_columns:
            c.execute("ALTER TABLE orders ADD COLUMN unit TEXT NOT NULL DEFAULT ''")
        if 'service' not in order_columns:
            c.execute("ALTER TABLE orders ADD COLUMN service TEXT NOT NULL DEFAULT ''")
        for order in c.execute("SELECT id FROM orders WHERE width_m IS NULL OR fabric='' ").fetchall():
            first=c.execute('SELECT fabric,width_m FROM items WHERE order_id=? ORDER BY id LIMIT 1',(order['id'],)).fetchone()
            if first:
                c.execute("UPDATE orders SET fabric=CASE WHEN fabric='' THEN ? ELSE fabric END,width_m=COALESCE(width_m,?) WHERE id=?",(first['fabric'],first['width_m'],order['id']))
        for row in c.execute('SELECT id,service,fabric_width,paper_width FROM items WHERE width_m IS NULL').fetchall():
            old = (row['paper_width'] or row['fabric_width']) if row['service'] in ['Só papel','Venda de Papel'] else (row['fabric_width'] or row['paper_width'])
            if old:
                c.execute('UPDATE items SET width_m=? WHERE id=?',(str(Decimal(old)/100),row['id']))
        c.execute("UPDATE items SET service='Venda de Papel' WHERE service='Só papel'")
        c.execute("INSERT OR IGNORE INTO prices SELECT client_key,'Venda de Papel',price,client FROM prices WHERE service='Só papel'")
        c.execute("DELETE FROM prices WHERE service='Só papel'")
        c.execute('CREATE TABLE IF NOT EXISTS client_folders(root TEXT,name TEXT,relative TEXT,PRIMARY KEY(root,relative))')
        c.execute('CREATE TABLE IF NOT EXISTS client_cache(root TEXT PRIMARY KEY,updated_at TEXT,error TEXT)')
        c.execute('CREATE TABLE IF NOT EXISTS order_prices(client_key TEXT PRIMARY KEY,price TEXT NOT NULL,client TEXT NOT NULL)')
        for order in c.execute('SELECT id,client FROM orders WHERE unit_price IS NULL').fetchall():
            values=[r['price'] for r in c.execute('SELECT price FROM items WHERE order_id=?',(order['id'],)).fetchall() if r['price'] is not None]
            if values and len(set(values)) == 1:
                c.execute('UPDATE orders SET unit_price=? WHERE id=?',(values[0],order['id']))
                c.execute('INSERT OR IGNORE INTO order_prices VALUES(?,?,?)',(key(order['client']),values[0],order['client']))
        for order in c.execute("SELECT id FROM orders WHERE unit='' ").fetchall():
            units=[r['unit'] for r in c.execute('SELECT DISTINCT unit FROM items WHERE order_id=?',(order['id'],)).fetchall()]
            if len(units)==1:
                c.execute('UPDATE orders SET unit=? WHERE id=?',(units[0],order['id']))
        for order in c.execute("SELECT id FROM orders WHERE service='' ").fetchall():
            services=[r['service'] for r in c.execute('SELECT DISTINCT service FROM items WHERE order_id=?',(order['id'],)).fetchall()]
            if len(services)==1:
                c.execute('UPDATE orders SET service=? WHERE id=?',(services[0],order['id']))
    (DB.parent / 'miniaturas').mkdir(exist_ok=True)
    (DB.parent / 'previews').mkdir(exist_ok=True)

def art_root():
    config = ROOT / 'config.json'
    settings = json.loads(config.read_text(encoding='utf-8-sig')) if config.exists() else {}
    return os.environ.get('SUBLIPAPER_ART_ROOT') or settings.get('art_root','')

def scan_clients():
    root = art_root()
    try:
        if not root: raise ValueError('Pasta de artes não configurada.')
        clients = []
        with os.scandir(root) as entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    clients.append((root,entry.name,entry.name))
        with connect() as c:
            c.execute('DELETE FROM client_folders WHERE root=?',(root,))
            c.executemany('INSERT INTO client_folders VALUES(?,?,?)',clients)
            c.execute('INSERT OR REPLACE INTO client_cache VALUES(?,?,?)',(root,datetime.now().isoformat(timespec='seconds'),''))
    except (OSError, ValueError) as e:
        with connect() as c:
            c.execute("INSERT INTO client_cache VALUES(?,NULL,?) ON CONFLICT(root) DO UPDATE SET error=excluded.error",(root,str(e)))

def request_client_refresh():
    global last_client_attempt
    if not CLIENT_REFRESH_LOCK.acquire(blocking=False): return
    if time.monotonic()-last_client_attempt < 60:
        CLIENT_REFRESH_LOCK.release()
        return
    last_client_attempt=time.monotonic()
    def run():
        try: scan_clients()
        finally: CLIENT_REFRESH_LOCK.release()
    threading.Thread(target=run,daemon=True).start()

def cached_clients():
    root=art_root()
    with connect() as c:
        clients=[dict(r) for r in c.execute('SELECT name,relative FROM client_folders WHERE root=?',(root,))]
        status=c.execute('SELECT updated_at,error FROM client_cache WHERE root=?',(root,)).fetchone()
    clients.sort(key=lambda x:key(x['name']))
    return {'clients':clients,'updated_at':status['updated_at'] if status else None,
            'error':status['error'] if status else '', 'refreshing':CLIENT_REFRESH_LOCK.locked()}

def make_thumbnail(source, name=''):
    if name.lower().endswith('.pdf'):
        if fitz is None: raise ValueError('O leitor de PDF não está instalado no servidor.')
        try:
            document=fitz.open(stream=source.read(),filetype='pdf')
            if document.page_count < 1: raise ValueError('O PDF não possui páginas.')
            page=document.load_page(0)
            scale=min(1.0,480/max(page.rect.width,page.rect.height))
            pixmap=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False,colorspace=fitz.csRGB)
            picture=Image.frombytes('RGB',(pixmap.width,pixmap.height),pixmap.samples)
            document.close()
            output=io.BytesIO();picture.save(output,'JPEG',quality=55,optimize=True)
            return output.getvalue()
        except ValueError: raise
        except Exception: raise ValueError('Não foi possível ler este PDF. Verifique se ele não está protegido ou danificado.')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        try:
            with Image.open(source) as im:
                if im.format not in ['TIFF', 'JPEG', 'PNG', 'WEBP', 'BMP']:
                    raise ValueError('Selecione TIFF, JPEG, PNG, WebP ou BMP.')
                im.seek(0)
                im.thumbnail((480, 480))
                picture = ImageOps.exif_transpose(im).convert('RGB')
                for quality in [70, 55, 40, 25]:
                    output = io.BytesIO()
                    picture.save(output, 'JPEG', quality=quality, optimize=True)
                    if output.tell() <= 40 * 1024:
                        return output.getvalue()
                picture.thumbnail((240, 240))
                output = io.BytesIO()
                picture.save(output, 'JPEG', quality=25, optimize=True)
                return output.getvalue()
        except (Image.DecompressionBombWarning, Image.DecompressionBombError):
            raise ValueError('Esta arte excede 80 milhões de pixels. Selecione uma cópia reduzida para a referência e mantenha o caminho do original.')
        except (UnidentifiedImageError, OSError):
            raise ValueError('Não foi possível converter esta imagem. Verifique se o arquivo está completo e em formato compatível.')

def shared_path(relative=''):
    root = art_root()
    if not root: raise ValueError('A pasta compartilhada de artes ainda não foi configurada no servidor.')
    base = Path(root).resolve()
    target = (base / relative).resolve()
    if not target.is_relative_to(base): raise ValueError('Caminho fora da pasta de artes.')
    return base, target

def scan_folder(relative):
    base, folder=shared_path(relative)
    entries=[]
    for child in folder.iterdir():
        if len(entries)>=1000: break
        if child.is_symlink(): continue
        is_dir=child.is_dir()
        if is_dir or child.suffix.lower() in ['.tif','.tiff','.jpg','.jpeg','.png','.webp','.bmp','.pdf']:
            entries.append({'name':child.name,'relative':str(child.relative_to(base)),'directory':is_dir})
    entries.sort(key=lambda x:(not x['directory'],x['name'].casefold()))
    return {'path':str(folder),'parent':str(folder.parent.relative_to(base)) if folder!=base else None,'entries':entries,'limited':len(entries)>=1000,'updated_at':time.time()}

def folder_listing(relative):
    with FOLDER_CACHE_LOCK:
        cached=FOLDER_CACHE.get(relative)
        refreshing=relative in FOLDER_REFRESHING
    if cached:
        if time.time()-cached['updated_at']>=60 and not refreshing:
            with FOLDER_CACHE_LOCK: FOLDER_REFRESHING.add(relative)
            def refresh():
                try:
                    fresh=scan_folder(relative)
                    with FOLDER_CACHE_LOCK: FOLDER_CACHE[relative]=fresh
                finally:
                    with FOLDER_CACHE_LOCK: FOLDER_REFRESHING.discard(relative)
            threading.Thread(target=refresh,daemon=True).start()
        return cached
    fresh=scan_folder(relative)
    with FOLDER_CACHE_LOCK: FOLDER_CACHE[relative]=fresh
    return fresh

def preview_for(target):
    stat=target.stat()
    token=hashlib.sha256(f'{target}|{stat.st_size}|{stat.st_mtime_ns}'.encode()).hexdigest()[:32]
    output=DB.parent/'previews'/(token+'.jpg')
    if not output.exists():
        with target.open('rb') as source: output.write_bytes(make_thumbnail(source,target.name))
    return token,output

def register_thumbnail(source, name):
    thumbnail = make_thumbnail(source,name)
    asset_id = uuid.uuid4().hex
    (DB.parent / 'miniaturas' / (asset_id + '.jpg')).write_bytes(thumbnail)
    with connect() as c:
        c.execute('INSERT INTO assets VALUES(?,?,?)',(asset_id,name,len(thumbnail)))
    return {'id':asset_id,'name':name,'bytes':len(thumbnail)}

def key(s):
    return ' '.join(''.join(ch for ch in unicodedata.normalize('NFKD', s.casefold()) if not unicodedata.combining(ch)).split())

def clean(v, limit=200):
    if not isinstance(v, str) or len(v) > limit:
        raise ValueError('Texto inválido ou muito longo.')
    return v.strip()

def numeric(v, label, required=False, positive=True):
    if v is None or v == '':
        if required: raise ValueError(f'Informe {label}.')
        return None
    try:
        d = Decimal(str(v).replace(',', '.'))
        if not d.is_finite() or d < 0 or (positive and d == 0) or d > Decimal('100000000'):
            raise ValueError()
        if d.as_tuple().exponent < -3: raise ValueError()
        return str(d)
    except (ValueError, InvalidOperation):
        raise ValueError(f'{label}: use um valor válido com até 3 casas decimais.')

def validate(payload, *, allow_unlisted=False):
    client = clean(payload.get('client', ''))
    fabric = clean(payload.get('fabric',''))
    width_m = numeric(payload.get('width_m'),'a largura em metros',True)
    unit_price = numeric(payload.get('unit_price'),'o preço por unidade de medida',positive=False)
    unit = clean(payload.get('unit',''))
    if unit not in ['m','kg','pc']: raise ValueError('Selecione a unidade do pedido.')
    service = clean(payload.get('service',''))
    if service not in SERVICES: raise ValueError('Selecione o tipo de serviço do pedido.')
    delivery = (date.today()+timedelta(days=7)).isoformat()
    if not client: raise ValueError('Informe o cliente.')
    client_folder = clean(payload.get('client_folder',''),255)
    with connect() as c:
        selected=c.execute('SELECT name FROM client_folders WHERE root=? AND relative=?',(art_root(),client_folder)).fetchone()
    if not allow_unlisted and (not selected or selected['name'] != client):
        raise ValueError('Selecione o cliente na lista de pastas atualizada.')
    request_key = clean(payload.get('request_key', ''), 80)
    if not request_key: raise ValueError('Identificador de envio ausente. Atualize a página.')
    raw = payload.get('items')
    if not isinstance(raw, list) or not 1 <= len(raw) <= 100: raise ValueError('Inclua de 1 a 100 artes.')
    items = []
    for x in raw:
        if not isinstance(x, dict): raise ValueError('Item inválido.')
        art = clean(x.get('art', ''))
        if not art: raise ValueError('Informe o nome de cada arte.')
        if unit=='pc' and Decimal(numeric(x.get('quantity'),'a quantidade',True)) % 1:raise ValueError('Peças precisam ser informadas em números inteiros.')
        asset_id = clean(x.get('asset_id', ''), 32)
        original_path = clean(x.get('original_path', ''), 2000).strip('"')
        original_name = ''
        if asset_id:
            with connect() as c:
                asset = c.execute('SELECT name FROM assets WHERE id=?', (asset_id,)).fetchone()
            if not asset: raise ValueError('Miniatura não encontrada. Selecione a imagem novamente.')
            original_name = asset['name']
            if not (original_path.startswith('\\\\') or re.match(r'^[A-Za-z]:[\\/]', original_path)) or 'fakepath' in original_path.lower():
                raise ValueError('Informe o caminho completo real da arte original, de preferência em uma pasta compartilhada.')
        items.append(dict(art=art, service=service, unit=unit, fabric=fabric,
            asset_id=asset_id, original_name=original_name, original_path=original_path,
            quantity=numeric(x.get('quantity'), 'a quantidade', True), width_m=width_m,
            price=unit_price, billing_meters=None))
    if any(x['service'] != 'Venda de Papel' for x in items) and not fabric: raise ValueError('Informe o tipo de tecido do pedido.')
    return dict(client=client, client_folder=client_folder, fabric=fabric, width_m=width_m, unit=unit, service=service, unit_price=unit_price, delivery=delivery, nf=clean(payload.get('nf', ''), 500),
                notes=clean(payload.get('notes', ''), 2000), request_key=request_key, items=items)

def detail(c, oid):
    row = c.execute('SELECT * FROM orders WHERE id=?', (oid,)).fetchone()
    if not row: raise ValueError('Pedido não encontrado.')
    result = dict(row)
    result.pop('request_key', None)
    result['items'] = [dict(r) for r in c.execute('SELECT * FROM items WHERE order_id=? ORDER BY id', (oid,))]
    total = Decimal(0)
    pending = 0
    for item in result['items']:
        basis = item['quantity'] if result.get('unit_price') is not None or item['unit'] in ['m','pc'] else item['billing_meters']
        if item['price'] is None or basis is None:
            item['total'] = None
            pending += 1
        else:
            value = (Decimal(item['price']) * Decimal(basis)).quantize(Decimal('0.01'))
            item['total'] = str(value)
            total += value
    result['total'] = str(total)
    result['pending_prices'] = pending
    return result

def save(payload, *, allow_unlisted=False):
    p = validate(payload, allow_unlisted=allow_unlisted)
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old = c.execute('SELECT id FROM orders WHERE request_key=?', (p['request_key'],)).fetchone()
        if old: return detail(c, old['id'])
        cursor = c.execute('INSERT INTO orders(request_key,client,delivery,nf,notes,created_at,client_folder,fabric,width_m,unit_price,unit,service) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          (p['request_key'], p['client'], p['delivery'], p['nf'], p['notes'], datetime.now().isoformat(timespec='seconds'),p['client_folder'],p['fabric'],p['width_m'],p['unit_price'],p['unit'],p['service']))
        oid = cursor.lastrowid
        c.execute('UPDATE orders SET number=? WHERE id=?', (f'SP-D-{oid:06d}', oid))
        for x in p['items']:
            c.execute('INSERT INTO items(order_id,art,service,quantity,unit,fabric,width_m,price,billing_meters,asset_id,original_name,original_path) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
              (oid, *[x[k] for k in ['art','service','quantity','unit']],p['fabric'],p['width_m'],*[x[k] for k in ['price','billing_meters','asset_id','original_name','original_path']]))
        if p['unit_price'] is not None:
            c.execute('INSERT OR IGNORE INTO order_prices VALUES(?,?,?)',(key(p['client']),p['unit_price'],p['client']))
        return detail(c, oid)

def br_number(value):
    text=f'{Decimal(str(value)):,.3f}'.rstrip('0').rstrip('.')
    return text.replace(',','X').replace('.',',').replace('X','.')

def br_money(value):
    return 'R$ '+f'{Decimal(str(value)):,.2f}'.replace(',','X').replace('.',',').replace('X','.')

def safe_text(value):
    return str(value or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def draw_paragraph(pdf,text,x,y,width,height,style):
    paragraph=Paragraph(text,style)
    _,needed=paragraph.wrap(width,height)
    paragraph.drawOn(pdf,x,y-needed)
    return needed

def order_pdf(order):
    output=io.BytesIO();pdf=canvas.Canvas(output,pagesize=A4,pageCompression=1)
    page_w,page_h=A4;left,right=13*mm,page_w-13*mm;usable_w=right-left
    teal=colors.HexColor('#079aa4');dark=colors.HexColor('#173c39');muted=colors.HexColor('#526965');line=colors.HexColor('#cbd8d4')
    normal=ParagraphStyle('normal',fontName='Helvetica',fontSize=8.6,leading=10.5,textColor=dark)
    art_style=ParagraphStyle('art',parent=normal,fontName='Helvetica-Bold',fontSize=10.2,leading=12)
    logo=ROOT/'static'/'logo-sublipaper.png'
    chunks=[order['items'][i:i+8] for i in range(0,len(order['items']),8)] or [[]]
    for page_index,items in enumerate(chunks):
        top=page_h-10*mm
        if logo.is_file():
            pdf.drawImage(ImageReader(str(logo)),left,top-16*mm,width=58*mm,height=15.9*mm,mask='auto',preserveAspectRatio=True,anchor='w')
        pdf.setFillColor(dark);pdf.setFont('Helvetica-Bold',18);pdf.drawString(left,top-24*mm,order['number'])
        pdf.setFont('Helvetica-Bold',14);pdf.drawString(left,top-31*mm,order['client'][:70])
        pdf.setFont('Helvetica',8.5);pdf.setFillColor(muted)
        created=datetime.fromisoformat(order['created_at']).strftime('%d/%m/%Y');delivery=datetime.fromisoformat(order['delivery']).strftime('%d/%m/%Y')
        pdf.drawString(left,top-37*mm,f'Data do pedido: {created}   ·   Previsão de entrega: {delivery}')
        box_y=top-55*mm;box_h=14*mm;pdf.setFillColor(colors.HexColor('#e8f4f2'));pdf.roundRect(left,box_y,usable_w,box_h,2*mm,fill=1,stroke=0)
        labels=[('SERVIÇO',order.get('service') or 'Múltiplos (legado)'),('TECIDO',order.get('fabric') or 'Não informado'),('LARGURA',(br_number(order['width_m'])+' m') if order.get('width_m') else 'Não informada'),('UNIDADE',{'m':'Metros','kg':'Quilos','pc':'Peças'}.get(order.get('unit'),order.get('unit') or 'Legado')),('PREÇO/UNIDADE',br_money(order['unit_price']) if order.get('unit_price') is not None else 'A definir'),('NF',order.get('nf') or 'Não informada')]
        weights=[1.55,1.15,.85,.9,1.35,.8];total_weight=sum(weights);cursor_x=left
        for (label,value),weight in zip(labels,weights):
            column=usable_w*weight/total_weight;x=cursor_x+2.2*mm;pdf.setFillColor(muted);pdf.setFont('Helvetica-Bold',7.2);pdf.drawString(x,box_y+9.3*mm,label)
            pdf.setFillColor(dark);pdf.setFont('Helvetica-Bold',9.8);shown=str(value);max_w=column-4.4*mm
            while stringWidth(shown,'Helvetica-Bold',9.8)>max_w and len(shown)>4: shown=shown[:-2]+'…'
            pdf.drawString(x,box_y+4*mm,shown);cursor_x+=column
        content_top=box_y-3*mm;footer_y=20*mm if page_index==len(chunks)-1 else 11*mm;available=content_top-footer_y
        row_h=available/max(1,len(items));image_size=min(row_h-1*mm,31*mm if len(items)>=7 else 48*mm if len(items)>=4 else 78*mm)
        for idx,item in enumerate(items):
            y_top=content_top-idx*row_h;y_bottom=y_top-row_h
            if idx: pdf.setStrokeColor(line);pdf.line(left,y_top,right,y_top)
            thumb=DB.parent/'miniaturas'/(str(item.get('asset_id') or '')+'.jpg')
            image_x=left+1*mm;image_y=y_bottom+(row_h-image_size)/2
            if thumb.is_file():
                pdf.drawImage(ImageReader(str(thumb)),image_x,image_y,width=image_size,height=image_size,mask='auto',preserveAspectRatio=True,anchor='c')
            text_x=image_x+image_size+5*mm;text_w=right-text_x
            text_y=y_top-4*mm
            used=draw_paragraph(pdf,f'<b>{page_index*8+idx+1}. {safe_text(item["art"])}</b>',text_x,text_y,text_w,row_h-5*mm,art_style)
            pdf.setFillColor(dark);pdf.setFont('Helvetica-Bold',12);pdf.drawString(text_x,text_y-used-5*mm,f'{br_number(item["quantity"])} {order.get("unit") or item["unit"]}')
            pdf.setFont('Helvetica-Bold',8.5);subtotal='A definir' if item['total'] is None else br_money(item['total']);pdf.drawRightString(right,text_y-used-5*mm,f'Subtotal: {subtotal}')
        pdf.setFillColor(muted);pdf.setFont('Helvetica',7);pdf.drawString(left,7*mm,'Documento de conferência · Não é nota fiscal.')
        pdf.drawRightString(right,7*mm,f'{page_index+1}/{len(chunks)}')
        if page_index==len(chunks)-1:
            pdf.setFillColor(dark);pdf.setFont('Helvetica-Bold',11);label='Total parcial' if order['pending_prices'] else 'Total'
            pdf.drawRightString(right,11*mm,f'{label}: {br_money(order["total"])}')
        pdf.showPage()
    pdf.save();return output.getvalue()

class Handler(BaseHTTPRequestHandler):
    def send_json(self, value, status=200, cookie=None):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie: self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_user(self):
        if os.environ.get("SUBLIPAPER_NO_LOGIN") == "1":
            return {"id":"local-workstation","username":"Operação local","role":"gestao"}
        if ACCESS_FACTORY is None: return {'id':'test','username':'test','role':'gestao'}
        jar = SimpleCookie()
        try: jar.load(self.headers.get('Cookie',''))
        except Exception: return None
        token = jar.get('sp_session')
        if token is None: return None
        try: return ACCESS_FACTORY.authenticated_user(token.value)
        except PermissionError: return None

    def require_role(self, *roles):
        user = self.session_user()
        if not user: raise PermissionError('Faça login para continuar')
        if roles and user['role'] not in roles: raise PermissionError('Perfil sem acesso a esta área')
        return user

    def access_json(self):
        if self.headers.get('Content-Type','').split(';')[0] != 'application/json':
            raise ValueError('Envie JSON')
        size = int(self.headers.get('Content-Length','0'))
        if not 0 < size <= 100000: raise ValueError('Dados inválidos')
        data = json.loads(self.rfile.read(size))
        if not isinstance(data,dict): raise ValueError('Objeto esperado')
        return data

    def access_post(self, path):
        if os.environ.get("SUBLIPAPER_NO_LOGIN") == "1":
            return self.send_json({"error":"O sistema funciona sem credenciais."},404)
        if ACCESS_FACTORY is None: return self.send_json({'error':'Login indisponível neste teste'},404)
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            return self.send_json({'error':'Origem não permitida'},403)
        try:
            data = self.access_json()
            if path == '/api/access/bootstrap':
                peer=self.headers.get('X-Sublipaper-Peer','') if os.environ.get('SUBLIPAPER_GATEWAY')=='1' else self.client_address[0]
                if peer not in {'127.0.0.1','::1','::ffff:127.0.0.1'}:
                    raise PermissionError('Primeira conta deve ser criada neste computador')
                return self.send_json(ACCESS_FACTORY.create_user(str(data.get('username') or ''),str(data.get('password') or ''),'gestao'),201)
            if path == '/api/access/login':
                token = ACCESS_FACTORY.login(str(data.get('username') or ''),str(data.get('password') or ''))
                user = ACCESS_FACTORY.authenticated_user(token)
                return self.send_json(user,cookie=f'sp_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200')
            user = self.require_role()
            if path == '/api/access/logout':
                jar=SimpleCookie();jar.load(self.headers.get('Cookie',''))
                ACCESS_FACTORY.logout(jar['sp_session'].value)
                return self.send_json({'status':'ok'},cookie='sp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
            if path == '/api/access/users':
                return self.send_json(ACCESS_FACTORY.create_user(str(data.get('username') or ''),str(data.get('password') or ''),str(data.get('role') or ''),actor_role=user['role']),201)
            if path == '/api/access/users/change':
                active=data.get('active')
                if active is not None and not isinstance(active,bool): raise ValueError('Estado inválido')
                ACCESS_FACTORY.change_user(str(data.get('id') or ''),user['role'],active=active,password=data.get('password'),actor_id=user['id'])
                return self.send_json({'status':'ok'})
            return self.send_json({'error':'Não encontrado'},404)
        except PermissionError as error: return self.send_json({'error':str(error)},403)
        except KeyError as error: return self.send_json({'error':str(error)},404)
        except (ValueError, TypeError, json.JSONDecodeError) as error: return self.send_json({'error':str(error)},400)

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            public={'/','/orders.js','/assets.js','/style.css','/arts.css','/refinements.css','/logo-sublipaper.png','/portal.js','/operations.js','/operations.css','/measurements.js','/overview.js','/overview.css','/portal.css','/api/health'}
            if path == '/api/access/status':
                if os.environ.get('SUBLIPAPER_NO_LOGIN') == '1': return self.send_json({'setup_required':False,'enabled':False,'loginRequired':False,'preview':PREVIEW_ONLY,'test_workflow':TEST_MODE,'production_workflow':PRODUCTION_ENABLED})
                if ACCESS_FACTORY is None: return self.send_json({'setup_required':False,'enabled':False})
                with ACCESS_FACTORY.connection() as db:
                    empty=not db.execute('SELECT 1 FROM users LIMIT 1').fetchone()
                return self.send_json({'setup_required':empty,'enabled':True,'preview':PREVIEW_ONLY,'test_workflow':TEST_MODE,'production_workflow':PRODUCTION_ENABLED})
            if path not in public:
                user=self.require_role()
                role=user['role']
            if path == '/faturamento' or path.startswith('/api/billing'):
                self.require_role('comercial','financeiro','gestao')
                return billing_bridge.get(self,path,DB,os.environ.get('SUBLIPAPER_LASER_DB',''))
            if path == '/api/access/me': return self.send_json(user)
            if path == '/api/access/users': return self.send_json(ACCESS_FACTORY.list_users(role))
            if path == '/api/integration/planilhas' or path.startswith('/api/integration/planilhas/'):
                return sheet_bridge.get(self,path,DB,os.environ.get('SUBLIPAPER_LASER_DB',''))
            if path == '/api/production/laser-items':
                if not PRODUCTION_WORKFLOW:return self.send_json({'error':'Operação indisponível'},404)
                with connect() as c: source=[detail(c,row['id']) for row in c.execute('SELECT id FROM orders WHERE deleted_at IS NULL')]
                return self.send_json(PRODUCTION_WORKFLOW.laser_items(source))
            if path == '/api/factory/orders':
                sectors=parse_qs(urlparse(self.path).query,keep_blank_values=True).get('sector')
                if sectors is not None and (len(sectors) != 1 or sectors[0] not in SECTORS | {'overview'}):
                    return self.send_json({'error':'Informe um único setor válido'},400)
                # An unqualified request is the management overview, never the caller's sector.
                preview=sectors[0] if sectors is not None else 'overview'
                if preview in {'overview','gestao'}:
                    self.require_role('gestao')
                    preview='gestao'
                if preview != role and role != 'gestao': raise PermissionError('Prévia de outro setor restrita à Gestão')
                with connect() as c:
                    query='SELECT id FROM orders WHERE deleted_at IS NULL ORDER BY id DESC'
                    if preview != 'gestao': query += ' LIMIT 200'
                    rows=[detail(c,r['id']) for r in c.execute(query)]
                projected = [project_order(row,preview) for row in rows]
                if PRODUCTION_WORKFLOW:
                    for source in rows:PRODUCTION_WORKFLOW.sync_laser(source)
                if WORKFLOW:
                    projected = [WORKFLOW.attach(row, preview, source['service']) for row,source in zip(projected,rows)]
                if WORKFLOW: projected += WORKFLOW.production_orders(rows,preview)
                projected = sheet_bridge.attach(projected,rows,os.environ.get("SUBLIPAPER_LASER_DB",""))
                return self.send_json(projected)
            if path in {'/api/data','/api/clients','/api/art-files','/api/art-preview'}:
                self.require_role('comercial','gestao')
            if path.startswith('/api/orders/') and path.endswith('/romaneio.pdf'):
                self.require_role('comercial','gestao')
            if path.startswith('/miniaturas/'):
                self.require_role()
            if path.startswith('/previews/'):
                self.require_role('comercial','digital','gestao')
            if path == '/api/clients':
                request_client_refresh()
                return self.send_json(cached_clients())
            if path == '/api/art-files':
                relative = parse_qs(urlparse(self.path).query).get('relative',[''])[0]
                try:
                    return self.send_json(folder_listing(relative))
                except (ValueError, OSError) as e:
                    return self.send_json({'error':str(e)},400)
            if path == '/api/art-preview':
                try:
                    relative=parse_qs(urlparse(self.path).query).get('relative',[''])[0]
                    _,target=shared_path(relative)
                    if not target.is_file() or target.suffix.lower() not in ['.tif','.tiff','.jpg','.jpeg','.png','.webp','.bmp','.pdf']:
                        raise ValueError('Arte não encontrada.')
                    token,output=preview_for(target)
                    return self.send_json({'preview_id':token,'name':target.name,'url':'/previews/'+token+'.jpg','bytes':output.stat().st_size})
                except (ValueError,OSError) as e: return self.send_json({'error':str(e)},400)
            if path == '/api/health': return self.send_json({'app':'sublipaper-pedidos-demo','version':'2.0.0','portal':True,'preview':PREVIEW_ONLY})
            match=re.fullmatch(r'/api/orders/(SP-D-\d{6})/romaneio\.pdf',path)
            if match:
                with connect() as c:
                    row=c.execute('SELECT id FROM orders WHERE number=? AND deleted_at IS NULL',(match.group(1),)).fetchone()
                    if not row: return self.send_json({'error':'Pedido não encontrado'},404)
                    body=order_pdf(detail(c,row['id']))
                self.send_response(200);self.send_header('Content-Type','application/pdf')
                self.send_header('Content-Disposition',f'inline; filename="romaneio-{match.group(1)}.pdf"')
                self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body);return
            if re.fullmatch(r'/miniaturas/[a-f0-9]{32}\.jpg', path):
                target = DB.parent / 'miniaturas' / path.rsplit('/', 1)[1]
                if not target.is_file(): return self.send_json({'error':'Miniatura não encontrada'},404)
                body = target.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type','image/jpeg')
                self.send_header('Content-Length',str(len(body)))
                self.send_header('Cache-Control','public, max-age=31536000, immutable')
                self.end_headers()
                self.wfile.write(body)
                return
            if re.fullmatch(r'/previews/[a-f0-9]{32}\.jpg',path):
                target=DB.parent/'previews'/path.rsplit('/',1)[1]
                if not target.is_file(): return self.send_json({'error':'Prévia não encontrada'},404)
                body=target.read_bytes();self.send_response(200);self.send_header('Content-Type','image/jpeg');self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','public, max-age=3600');self.end_headers();self.wfile.write(body);return
            if path == '/api/data':
                with connect() as c:
                    orders = [detail(c, r['id']) for r in c.execute('SELECT id FROM orders WHERE deleted_at IS NULL ORDER BY id DESC')]
                    prices = [dict(r) for r in c.execute('SELECT * FROM order_prices')]
                return self.send_json({'orders':orders,'prices':prices,'services':SERVICES,'today':date.today().isoformat(),'default_delivery':(date.today()+timedelta(days=7)).isoformat()})
            static = {'/':'portal.html','/pedidos':'index.html','/orders.js':'orders.js','/assets.js':'assets.js','/style.css':'style.css','/arts.css':'arts.css','/refinements.css':'refinements.css','/logo-sublipaper.png':'logo-sublipaper.png','/portal.js':'portal.js','/operations.js':'operations.js','/operations.css':'operations.css','/measurements.js':'measurements.js','/overview.js':'overview.js','/overview.css':'overview.css','/portal.css':'portal.css'}
            if path not in static: return self.send_json({'error':'Não encontrado'}, 404)
            body = (ROOT / 'static' / static[path]).read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', {'/':'text/html; charset=utf-8','/pedidos':'text/html; charset=utf-8','/orders.js':'text/javascript; charset=utf-8','/assets.js':'text/javascript; charset=utf-8','/style.css':'text/css; charset=utf-8','/arts.css':'text/css; charset=utf-8','/refinements.css':'text/css; charset=utf-8','/portal.js':'text/javascript; charset=utf-8','/operations.js':'text/javascript; charset=utf-8','/operations.css':'text/css; charset=utf-8','/measurements.js':'text/javascript; charset=utf-8','/overview.js':'text/javascript; charset=utf-8','/overview.css':'text/css; charset=utf-8','/portal.css':'text/css; charset=utf-8','/logo-sublipaper.png':'image/png'}[path])
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(body)
        except PermissionError as error: self.send_json({'error':str(error)},403)
        except Exception:
            self.send_json({'error':'Não foi possível ler os dados locais.'},500)

    def do_POST(self):
        if self.path == '/api/billing/context':
            try:
                user=self.require_role('comercial','financeiro','gestao')
                return billing_bridge.save_context(self,DB,user)
            except (PermissionError,ValueError) as e:
                return self.send_json({'error':str(e)},403 if isinstance(e,PermissionError) else 400)
        if self.path.startswith('/api/access/'):
            return self.access_post(self.path)
        if self.path.startswith('/api/production/'):
            if not PRODUCTION_WORKFLOW:return self.send_json({'error':'Operação de produção indisponível'},404)
            try:
                origin=self.headers.get('Origin')
                if origin and origin!=f'http://{self.headers.get("Host")}':raise PermissionError('Origem não permitida')
                user=self.require_role();data=self.access_json();kind=self.path.rsplit('/',1)[-1]
                if kind=='check-laser':return self.send_json(PRODUCTION_WORKFLOW.check_laser(int(data.get('itemId') or 0),str(data.get('action') or '')))
                if data.get('batch_token'):order=PRODUCTION_WORKFLOW.resolve_batch(str(data['batch_token']))
                else:
                    with connect() as c:
                        row=c.execute('SELECT id FROM orders WHERE number=? AND deleted_at IS NULL',(str(data.get('number') or ''),)).fetchone()
                        if not row:raise ValueError('Pedido não encontrado')
                        order=detail(c,row['id'])
                if kind=='sync-laser':PRODUCTION_WORKFLOW.sync_laser(order);return self.send_json({'status':'ok'})
                actor=str(data.get('operator') or '').strip()
                if not actor or len(actor)>80:raise ValueError('Informe o responsável pela operação no topo da tela')
                # Centimeters are the UI contract; legacy meter fields stay compatible.
                for cm,meter in [('print_cm','print_m'),('output_cm','output'),('loss_cm','loss'),('requested_cm','requested_qty'),('final_cm','final_qty')]:
                    if cm in data:data[meter]=str(Decimal(str(data[cm]).replace(',','.'))/100)
                if kind in {'transition','consumption'} and any(k.startswith('usage_') for k in data):
                    if data.get('usage_quantity') not in (None,''):
                        data['consumption']=[{'material':data.get('usage_material',''),'quantity':data['usage_quantity'],'unit':data.get('usage_unit',''),'unit_cost':data.get('usage_unit_cost'),'lot':data.get('usage_lot',''),'reference':data.get('usage_reference','')}]
                if kind not in {'release','configure','transition','record','replenishment','consumption'}:return self.send_json({'error':'Operação não encontrada'},404)
                return self.send_json(PRODUCTION_WORKFLOW.apply(kind,order,data,actor,user['role']))
            except PermissionError as e:return self.send_json({'error':str(e)},403)
            except (ValueError,TypeError,InvalidOperation,json.JSONDecodeError) as e:return self.send_json({'error':str(e)},400)
        if self.path.startswith('/api/test/'):
            if not TEST_WORKFLOW: return self.send_json({'error':'Fluxo de testes indisponível nesta base'},404)
            try:
                origin = self.headers.get('Origin')
                if origin and origin != f'http://{self.headers.get("Host")}':
                    raise PermissionError('Origem não permitida')
                user = self.require_role()
                data = self.access_json()
                if self.path == '/api/test/orders':
                    if user['role'] not in {'comercial','gestao'}: raise PermissionError('Somente Comercial cadastra pedidos de teste (Gestão pode simular)')
                    return self.send_json(save(data,allow_unlisted=True),201)
                if data.get('batch_token'):
                    order=TEST_WORKFLOW.resolve_batch(str(data['batch_token']))
                else:
                    number = str(data.get('number') or '')
                    if not re.fullmatch(r'SP-D-\d{6}',number): raise ValueError('Número de pedido inválido')
                    with connect() as c:
                        row = c.execute('SELECT id FROM orders WHERE number=? AND deleted_at IS NULL',(number,)).fetchone()
                        if not row: raise ValueError('Pedido não encontrado')
                        order = detail(c,row['id'])
                if self.path == '/api/test/replenishment':
                    return self.send_json(TEST_WORKFLOW.request_replenishment(order,data,user['username'],user['role']),201)
                if self.path == '/api/test/release':
                    return self.send_json(TEST_WORKFLOW.release(order,user['username'],user['role']))
                if self.path == '/api/test/record':
                    return self.send_json(TEST_WORKFLOW.record(order,data,user['username'],user['role']),201)
                if self.path == '/api/test/transition':
                    return self.send_json(TEST_WORKFLOW.transition(order,data,user['username'],user['role']))
                if self.path == '/api/test/configure':
                    return self.send_json(TEST_WORKFLOW.configure(order,data,user['username'],user['role']))
                if self.path == '/api/test/billing':
                    return self.send_json(TEST_WORKFLOW.billing(order,data,user['username'],user['role']))
                return self.send_json({'error':'Não encontrado'},404)
            except PermissionError as error: return self.send_json({'error':str(error)},403)
            except (ValueError,TypeError,json.JSONDecodeError) as error: return self.send_json({'error':str(error)},400)
        if PREVIEW_ONLY and not TEST_MODE:
            return self.send_json({'error':'Prévia visual: alteração de pedidos desativada'},403)
        try: self.require_role('comercial','gestao')
        except PermissionError as error: return self.send_json({'error':str(error)},403)
        if self.path == '/api/thumbnail': return self.upload_thumbnail()
        if self.path == '/api/shared-thumbnail': return self.shared_thumbnail()
        if self.path == '/api/orders/delete':
            if TEST_MODE: return self.send_json({'error':'Exclusão de pedidos desativada no fluxo de testes'},403)
            return self.delete_order()
        if self.path != '/api/orders': return self.send_json({'error':'Não encontrado'},404)
        if self.headers.get('Content-Type','').split(';')[0] != 'application/json':
            return self.send_json({'error':'Formato não permitido'},415)
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            return self.send_json({'error':'Origem não permitida'},403)
        try:
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 200000: raise ValueError('Pedido muito grande ou vazio.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload,dict): raise ValueError('Pedido inválido.')
            return self.send_json(save(payload),201)
        except (ValueError, TypeError) as e: self.send_json({'error':str(e)},400)
        except Exception: self.send_json({'error':'Não foi possível salvar. Seus campos foram preservados; tente novamente.'},500)

    def delete_order(self):
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            return self.send_json({'error':'Origem não permitida'},403)
        if self.headers.get('Content-Type','').split(';')[0] != 'application/json':
            return self.send_json({'error':'Formato não permitido'},415)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 1000: raise ValueError('Solicitação inválida.')
            payload=json.loads(self.rfile.read(length))
            number=clean(payload.get('number',''),30)
            with connect() as c:
                row=c.execute('SELECT id FROM orders WHERE number=? AND deleted_at IS NULL',(number,)).fetchone()
                if not row: raise ValueError('Pedido não encontrado ou já excluído.')
                linked,_=billing_bridge.production(os.environ.get('SUBLIPAPER_LASER_DB',''))
                if any((j.get('source') or {}).get('orderId')==row['id'] for j in linked):raise ValueError('Pedido possui grades vinculadas e deve conservar seu histórico')
                if PRODUCTION_WORKFLOW:
                    with PRODUCTION_WORKFLOW.connection() as ledger:
                        if ledger.execute('SELECT 1 FROM releases WHERE order_number=?',(number,)).fetchone():raise ValueError('Pedido em produção não pode ser excluído; preserve o histórico operacional')
                c.execute('UPDATE orders SET deleted_at=? WHERE id=?',(datetime.now().isoformat(timespec='seconds'),row['id']))
            return self.send_json({'deleted':True,'number':number})
        except (ValueError,TypeError,json.JSONDecodeError) as e:
            return self.send_json({'error':str(e)},400)
        except Exception:
            return self.send_json({'error':'Não foi possível excluir o pedido.'},500)

    def shared_thumbnail(self):
        if self.headers.get('Origin') not in [None, f'http://{self.headers.get("Host")}']:
            return self.send_json({'error':'Origem não permitida'},403)
        if self.headers.get('Content-Type') != 'application/json': return self.send_json({'error':'Formato inválido'},415)
        if not IMAGE_LOCK.acquire(blocking=False): return self.send_json({'error':'Outra conversão está em andamento. Tente novamente.'},409)
        try:
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= 10000: raise ValueError('Seleção inválida.')
            payload = json.loads(self.rfile.read(size))
            _, target = shared_path(clean(payload.get('relative',''),2000))
            if target.suffix.lower() not in ['.tif','.tiff','.jpg','.jpeg','.png','.webp','.bmp','.pdf']:
                raise ValueError('Selecione um arquivo de imagem compatível.')
            if not target.is_file() or target.stat().st_size > MAX_UPLOAD:
                raise ValueError('Arquivo indisponível ou acima de 256 MB.')
            requested_preview=clean(payload.get('preview_id',''),32)
            expected_preview,preview_path=preview_for(target) if requested_preview else ('',None)
            if requested_preview==expected_preview and preview_path and preview_path.is_file():
                asset_id=uuid.uuid4().hex
                thumbnail=preview_path.read_bytes()
                (DB.parent/'miniaturas'/(asset_id+'.jpg')).write_bytes(thumbnail)
                with connect() as c: c.execute('INSERT INTO assets VALUES(?,?,?)',(asset_id,target.name,len(thumbnail)))
                result={'id':asset_id,'name':target.name,'bytes':len(thumbnail)}
            else:
                with target.open('rb') as source: result=register_thumbnail(source,target.name)
            result['original_path'] = str(target)
            self.send_json(result,201)
        except (ValueError, OSError, TypeError, AttributeError) as e: self.send_json({'error':str(e)},400)
        except Exception: self.send_json({'error':'Não foi possível converter a arte selecionada.'},400)
        finally: IMAGE_LOCK.release()

    def upload_thumbnail(self):
        origin = self.headers.get('Origin')
        if origin and origin != f'http://{self.headers.get("Host")}':
            return self.send_json({'error':'Origem não permitida'},403)
        if self.headers.get('Content-Type') != 'application/octet-stream':
            return self.send_json({'error':'Formato de envio inválido'},415)
        if not IMAGE_LOCK.acquire(blocking=False):
            return self.send_json({'error':'Outra arte está sendo convertida. Tente novamente em instantes.'},409)
        try:
            from urllib.parse import unquote
            name = clean(unquote(self.headers.get('X-File-Name','')), 255)
            if not name or '/' in name or '\\' in name: raise ValueError('Nome de arquivo inválido.')
            size = int(self.headers.get('Content-Length','0'))
            if not 0 < size <= MAX_UPLOAD: raise ValueError('Limite de 256 MB por arquivo. Use uma cópia reduzida para a referência se necessário.')
            self.connection.settimeout(120)
            with tempfile.TemporaryFile(dir=DB.parent) as source:
                remaining = size
                while remaining:
                    block = self.rfile.read(min(1024 * 1024, remaining))
                    if not block: raise ValueError('Envio interrompido. Selecione a imagem novamente.')
                    source.write(block)
                    remaining -= len(block)
                source.seek(0)
                result = register_thumbnail(source, name)
            self.send_json(result,201)
        except (ValueError, OSError) as e: self.send_json({'error':str(e)},400)
        except Exception: self.send_json({'error':'Falha na conversão. Tente uma imagem reduzida.'},400)
        finally: IMAGE_LOCK.release()

class AppServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

def main():
    global ACCESS_FACTORY
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--host', default='127.0.0.1')
    args = parser.parse_args()
    initialize()
    ACCESS_FACTORY = Factory(DB.parent / 'integracao_fabrica.sqlite3')
    request_client_refresh()
    try: httpd = AppServer((args.host,args.port),Handler)
    except OSError:
        from urllib.request import urlopen
        try:
            with urlopen(f'http://127.0.0.1:{args.port}/api/health',timeout=2) as r:
                same = json.load(r).get('app') == 'sublipaper-pedidos-demo'
        except Exception: same=False
        if same:
            webbrowser.open(f'http://127.0.0.1:{args.port}')
            return
        raise SystemExit(f'Porta {args.port} ocupada. Use --port 8766.')
    print(f'Sublipaper Pedidos: http://127.0.0.1:{args.port}\nDados: {DB}\nMantenha esta janela aberta. Ctrl+C encerra.')
    if not args.no_browser: webbrowser.open(f'http://127.0.0.1:{args.port}')
    try: httpd.serve_forever()
    except KeyboardInterrupt: pass
    finally: httpd.server_close()

if __name__ == '__main__': main()
