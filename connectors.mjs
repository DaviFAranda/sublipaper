import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function findOrders(){const local=path.join(path.dirname(fileURLToPath(import.meta.url)),'Pedidos','dados','pedidos.sqlite3');if(fs.existsSync(local))return local;let folder=path.dirname(fileURLToPath(import.meta.url));for(let i=0;i<6;i++){const candidate=path.join(folder,'Sistemas','Sistema_Digital_v0.29.0_Abas_por_Impressora','Sistema Sublipaper','dados','pedidos.sqlite3');if(fs.existsSync(candidate))return candidate;const next=path.dirname(folder);if(next===folder)break;folder=next;}return '';}
export function readOrders(file,query='',selected=null){
 if(!file||!fs.existsSync(file))throw new Error('Banco de Pedidos não localizado. Configure pedidosDb em config.json.');
 const db=new DatabaseSync(file,{readOnly:true});try{db.exec('PRAGMA query_only=ON');return db.prepare(`SELECT o.id AS orderId,o.number AS "order",o.client,o.delivery,o.notes,i.id AS itemId,i.art,i.service,i.quantity,i.unit,COALESCE(NULLIF(i.fabric,''),o.fabric) AS fabric,COALESCE(i.width_m,o.width_m) AS width,i.asset_id AS assetId,i.original_name AS originalName,i.original_path AS originalPath FROM orders o JOIN items i ON i.order_id=o.id WHERE o.deleted_at IS NULL AND (i.service='Corte a laser' OR o.service='Corte a laser') AND ${selected?'o.id=? AND i.id=?':'(o.number LIKE ? OR o.client LIKE ? OR i.art LIKE ?)'} ORDER BY o.id DESC,i.id LIMIT 200`).all(...(selected?[selected.orderId,selected.itemId]:Array(3).fill(`%${query}%`)));}finally{db.close();}}
export function orderItem(file,orderId,itemId){return readOrders(file,'',{orderId,itemId})[0];}
