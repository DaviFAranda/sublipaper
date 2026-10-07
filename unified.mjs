import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const cfg=fs.existsSync(path.join(root,'config.json'))?JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,'')):{};
const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
const python=process.env.SUBLIPAPER_PYTHON||cfg.python||(fs.existsSync(bundled)?bundled:'python');
// Reserve an OS-selected internal port; the service binds only loopback.
const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const n=probe.address().port;probe.close(()=>resolve(n));});});
const child=spawn(python,['-u',path.join(root,'Pedidos','server.py'),'--host','127.0.0.1','--port',String(port),'--no-browser'],{cwd:path.join(root,'Pedidos'),windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',SUBLIPAPER_GATEWAY:'1',SUBLIPAPER_NO_LOGIN:'1',SUBLIPAPER_PRODUCTION_WORKFLOW:process.env.SUBLIPAPER_PRODUCTION_WORKFLOW??'1',SUBLIPAPER_LASER_DB:process.env.LASER_DB||path.join(root,'dados','laser.sqlite3')},stdio:['ignore','inherit','inherit']});
let childError=null,closing=false;child.on('error',e=>{childError=e;});child.on('exit',code=>{childError=new Error('Pedidos encerrou ('+code+'). Confira os logs.');if(!closing&&process.env.PEDIDOS_INTERNAL_PORT){console.error(childError.message);process.exitCode=1;server?.close();}});
let server;
try{
 let ready=false;
 for(let i=0;i<100;i++){
  if(childError)throw childError;
  try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(500)});if(r.ok&&(await r.json()).app==='sublipaper-pedidos-demo'){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,150));
 }
 if(!ready)throw new Error('Pedidos não iniciou em 15 segundos.');
 process.env.PEDIDOS_INTERNAL_PORT=String(port);
 process.env.SUBLIPAPER_PYTHON=python;
 server=(await import('./server.mjs')).server;
 server.on('error',e=>{console.error(e.message);closing=true;child.kill();process.exitCode=1;});
 server.on('close',()=>{closing=true;child.kill();});
}catch(e){closing=true;child.kill();console.error(e.message);process.exitCode=1;}
process.on('exit',()=>{closing=true;child.kill();});
process.on('SIGTERM',()=>{closing=true;child.kill();server?.close(()=>process.exit(0));});
