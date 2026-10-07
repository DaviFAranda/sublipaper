import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Store} from './store.mjs';
import {findOrders,readOrders,orderItem} from './connectors.mjs';
import {printDocument,printIdentification,printPreparation,printOrderDocument} from './print.mjs';
import {Images,filename} from './images.mjs';
import {groupOrders,orderKey} from './orders.mjs';
import {networkAddresses,allowedHost} from './network.mjs';
import {proxyPedidos} from './gateway.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const defaults={port:8780,pedidosDb:process.env.PEDIDOS_DB||findOrders()};
const cfg=fs.existsSync(path.join(ROOT,'config.json'))?{...defaults,...JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8').replace(/^\uFEFF/,''))}:defaults;
const store=new Store(process.env.LASER_DB||path.join(ROOT,'dados','laser.sqlite3'));
const images=new Images(path.join(path.dirname(process.env.LASER_DB||path.join(ROOT,'dados','laser.sqlite3')),'miniaturas'),process.env.SUBLIPAPER_PYTHON||cfg.python);
const pedidosPort=Number(process.env.PEDIDOS_INTERNAL_PORT||0);
const localActor={id:"local-workstation",name:"Operação local",role:"manager"};
function send(res,data,status=200,type='application/json; charset=utf-8',headers={}){const body=Buffer.isBuffer(data)?data:Buffer.from(type.startsWith('application/json')?JSON.stringify(data):String(data));res.writeHead(status,{'Content-Type':type,'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...headers});res.end(body);}
async function body(req){if(!(req.headers['content-type']||'').startsWith('application/json'))throw new Error('Envie dados JSON.');let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>(req.url==='/api/images'?90000000:150000)){throw new Error('Dados muito grandes.');}chunks.push(c);}const d=JSON.parse(Buffer.concat(chunks).toString());if(!d||Array.isArray(d)||typeof d!=='object')throw new Error('Dados inválidos.');return d;}
async function productionApi(route,data=null){
 if(!pedidosPort)return null;
 const response=await fetch(`http://127.0.0.1:${pedidosPort}/api/production/${route}`,{headers:{Host:'127.0.0.1:8780',...(data?{'Content-Type':'application/json'}:{})},...(data?{method:'POST',body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(15000)});
 if(response.status===404)return null;
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível validar o fluxo');return result;
}
async function linkedItem(orderId,itemId){
 if(Number(itemId)>0)return orderItem(cfg.pedidosDb,Number(orderId),Number(itemId));
 const rows=await productionApi('laser-items');return rows?.find(r=>r.orderId===Number(orderId)&&r.itemId===Number(itemId));
}
async function validateLaser(source,action){if(source)await productionApi('check-laser',{itemId:source.itemId,action});}
async function synchronizeLaser(source,number){if(source)await productionApi('sync-laser',{number:source.productionOrder||number,batch_token:source.batchToken||''});}
const staticFiles={'/':'index.html','/completion.mjs':'completion.mjs','/styles.css':'styles.css','/refinements.css':'refinements.css','/print.css':'print.css','/logo.png':'logo.png','/commercial.mjs':'commercial.mjs','/commercial.css':'commercial.css','/factory.mjs':'factory.mjs','/laser.mjs':'laser.mjs','/laser.css':'laser.css','/factory.css':'factory.css'};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'};
export const server=http.createServer(async(req,res)=>{try{
 if(!allowedHost(req.headers.host||'',cfg.allowedHosts||[]))return send(res,{error:'Endereço não autorizado.'},403);
 const url=new URL(req.url,'http://localhost'),route=url.pathname;let u={...localActor};
 if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(res,{error:'Origem inválida.'},403);
 if(req.method==='GET'&&['/pedidos','/pedidos/','/pedidos/faturamento','/pedidos/index.html','/pedidos/billing.html','/pedidos/pedidos','/pedidos/portal.html'].includes(route)){res.writeHead(302,{Location:route.includes('faturamento')||route.includes('billing')||url.searchParams.get('next')==='faturamento'?'/#overview':'/'});return res.end();}
 if(route==='/pedidos'||route.startsWith('/pedidos/')){if(!pedidosPort)return send(res,{error:'Inicie pelo Iniciar Sublipaper.cmd para abrir os Pedidos.'},503);return proxyPedidos(req,res,pedidosPort);}
 if(req.method==='GET'&&(route==='/api/integration/planilhas'||route.startsWith('/api/integration/planilhas/'))){if(!pedidosPort)return send(res,{error:'Inicie pelo inicializador único.'},503);req.url='/pedidos'+req.url;return proxyPedidos(req,res,pedidosPort);}
 if(req.method==='GET'&&route in staticFiles){const f=path.join(ROOT,'public',staticFiles[route]);return send(res,fs.readFileSync(f),200,types[path.extname(f)]);}
 if(req.method==='GET'&&route==='/api/health')return send(res,{ok:true,version:'3.0.0',app:'sublipaper-unificado',root:ROOT,pedidos:pedidosPort>0});
 if(req.method==='GET'&&route==='/api/session')return send(res,{user:u,setup:false,loginRequired:false});
 if(req.method==='POST'){
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){return send(res,{error:'Origem inválida.'},403);}
  if(route==='/api/images/upload'){
   if(req.headers['content-type']!=='application/octet-stream')throw new Error('Envie o arquivo de imagem.');
   req.setTimeout(600000);res.setTimeout(600000);
   return send(res,await images.uploadStream(req,decodeURIComponent(req.headers['x-file-name']||''),req.headers['content-length']===undefined?undefined:Number(req.headers['content-length'])),201);
  }
  const d=await body(req);if(d.operator){const operator=String(d.operator).trim();if(!operator||operator.length>80)throw new Error('Responsável inválido.');u={...u,name:operator};}
  if(route==='/api/images')return send(res,await images.upload(d),201);
  if(d.artFilename)d.art=filename(d.artFilename);
  if(d.thumbnailId)images.get(d.thumbnailId);
  if(route==='/api/setup'||route==='/api/login'||route==='/api/logout'||route==='/api/users')return send(res,{error:'Este sistema funciona sem credenciais.'},404);
  if(route==='/api/jobs'){
   let source=null,plan=d;
   if(d.source){const item=await linkedItem(d.source.orderId,d.source.itemId);if(!item)throw new Error('Arte de corte não encontrada nos Pedidos.');source={system:'sublipaper-pedidos',orderId:item.orderId,itemId:item.itemId,assetId:item.assetId,originalName:item.originalName,originalPath:item.originalPath,quantity:item.quantity,unit:item.unit,productionOrder:item.productionOrder||item.order,batchToken:item.batchToken,rootItemId:item.rootItemId||item.itemId||''};await validateLaser(source,'create');plan={...d,order:item.order,client:item.client,art:filename(d.artFilename||item.originalName||item.originalPath||item.art),artFilename:filename(d.artFilename||item.originalName||item.originalPath||item.art),thumbnailId:d.thumbnailId||images.import(item,cfg.pedidosDb),fabric:item.fabric||d.fabric,delivery:item.delivery};}
   const result=store.mutate(d.token,u,()=>store.create(plan,u,source));return send(res,result,201);
  }
  const m=route.match(/^\/api\/jobs\/([a-f0-9-]+)\/(update|link|releaseOrder|release|measure|reprint|cancel|reverse|registerPrint|registerOrderPrint)$/);if(m){const [,id,action]=m;if(action==='link'){const item=await linkedItem(d.source?.orderId,d.source?.itemId);if(!item)throw new Error('Arte de corte não encontrada nos Pedidos.');d.source={system:'sublipaper-pedidos',orderId:item.orderId,itemId:item.itemId,assetId:item.assetId,quantity:item.quantity,unit:item.unit,productionOrder:item.productionOrder||item.order,batchToken:item.batchToken,rootItemId:item.rootItemId||item.itemId||''};d.order=item.order;d.client=item.client;}if(action==='update'){const j=store.get(id);if(j.source){const item=await linkedItem(j.source.orderId,j.source.itemId);if(!item)throw new Error('O pedido de origem está indisponível.');d.order=item.order;d.client=item.client;}}const before=store.get(id);const linked=d.source||before.source;if(action==='releaseOrder'){for(const job of store.list().filter(j=>j.status==='draft'&&orderKey(j)===orderKey(before)))await validateLaser(job.source,'releaseOrder');}else if(['release','measure','reprint','cancel','reverse','update','link'].includes(action))await validateLaser(linked,action);const result=store.mutate(d.token,u,()=>store[action](id,d,u));await synchronizeLaser(linked,before.plan.order);return send(res,result);}
 }
 
 const reportRoute=route.match(/^\/api\/order-romaneios\/([a-f0-9-]+)$/);if(req.method==='GET'&&reportRoute)return send(res,printOrderDocument(store.orderReport(reportRoute[1])),200,'text/html; charset=utf-8');
 if(req.method==='GET'&&route==='/api/identifications')return send(res,printIdentification(groupOrders(store.list()).filter(g=>g.complete)),200,'text/html; charset=utf-8');
 const imageMatch=route.match(/^\/api\/images\/([a-f0-9]{64})$/);if(req.method==='GET'&&imageMatch)return send(res,images.get(imageMatch[1]),200,'image/jpeg');
 const sourceImage=route.match(/^\/api\/source-images\/([a-f0-9]{32})$/);if(req.method==='GET'&&sourceImage){const f=path.join(path.dirname(cfg.pedidosDb),'miniaturas',sourceImage[1]+'.jpg');if(!fs.existsSync(f))return send(res,'',404,'text/plain');return send(res,fs.readFileSync(f),200,'image/jpeg');}
 if(req.method==='GET'&&route==='/api/jobs')return send(res,store.list());
 if(req.method==='GET'&&route==='/api/orders'){const rows=await productionApi('laser-items');const q=(url.searchParams.get('q')||'').toLocaleLowerCase();return send(res,rows?rows.filter(r=>`${r.order} ${r.client} ${r.art} ${r.productionOrder}`.toLocaleLowerCase().includes(q)):readOrders(cfg.pedidosDb,q));}
 if(req.method==='GET'&&route==='/api/integration/export'){return send(res,{schemaVersion:1,jobs:store.list(),events:store.db.prepare('SELECT * FROM outbox ORDER BY created_at').all().map(e=>({...e,payload:JSON.parse(e.payload)}))},200,undefined,{'Content-Disposition':'attachment; filename="laser-integracao.json"'});}
 const m=route.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(print|history|thumbnail|identification))?$/);if(req.method==='GET'&&m){const j=store.get(m[1]);if(m[2]==='identification'){const group=groupOrders(store.list()).find(g=>g.key===orderKey(j));return send(res,printIdentification([group]),200,'text/html; charset=utf-8');}if(m[2]==='history')return send(res,store.history(j.id));if(m[2]==='thumbnail'){if(j.plan.thumbnailId)return send(res,images.get(j.plan.thumbnailId),200,'image/jpeg');const asset=j.source?.assetId;if(!/^[a-f0-9]{32}$/.test(asset||''))return send(res,'',404,'text/plain');const f=path.join(path.dirname(cfg.pedidosDb),'miniaturas',asset+'.jpg');if(!fs.existsSync(f))return send(res,'',404,'text/plain');return send(res,fs.readFileSync(f),200,'image/jpeg');}if(m[2]==='print'){const recordId=url.searchParams.get('record');if(recordId){const record=j.printRecords?.find(r=>r.id===recordId);if(!record)throw new Error('Romaneio registrado não encontrado.');return send(res,printDocument(record.snapshot),200,'text/html; charset=utf-8');}const rid=url.searchParams.get('reprint');const r=rid?j.reprints.find(r=>r.id===rid):null;if(rid&&!r)throw new Error('Solicitação não encontrada.');return send(res,r?printDocument(j,r):printPreparation(j),200,'text/html; charset=utf-8');}return send(res,j);}
 return send(res,{error:'Página não encontrada.'},404);
 }catch(e){const status=e.status||(/UNIQUE constraint/.test(e.message)?409:400);send(res,{error:/UNIQUE constraint/.test(e.message)?'Este usuário ou arte já está cadastrado.':e.message},status);}});
if(process.env.LASER_NO_LISTEN!=='1'){const port=Number(process.env.LASER_PORT||cfg.port);server.listen(port,cfg.host||'0.0.0.0',()=>{const message=`Sublipaper · Operação e produção\nNeste computador: http://127.0.0.1:${port}\nNa mesma rede:\n${networkAddresses().map(ip=>`http://${ip}:${port}`).join('\n')}\n\nMantenha este computador ligado. O iniciador pode ser fechado.\nOs outros computadores precisam apenas de um navegador.\n`;if(!process.env.LASER_DB)fs.writeFileSync(path.join(ROOT,'ACESSO-REDE.txt'),message);console.log(message);});}
server.requestTimeout=0;
process.on('SIGINT',()=>server.close(()=>{store.close();process.exit(0);}));



