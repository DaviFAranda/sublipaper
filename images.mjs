import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const execute=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
export const MAX_IMAGE_BYTES=3*1024*1024*1024;
export const filename=value=>String(value||'').split(/[\\/]/).pop();
export class Images{
 constructor(folder,python=null){this.folder=folder;this.python=python;this.busy=false;fs.mkdirSync(folder,{recursive:true});}
 save(bytes){const id=createHash('sha256').update(bytes).digest('hex');const target=path.join(this.folder,id+'.jpg');if(!fs.existsSync(target))fs.writeFileSync(target,bytes);return id;}
 get(id){if(!/^[a-f0-9]{64}$/.test(id||''))throw new Error('Miniatura inválida.');const file=path.join(this.folder,id+'.jpg');if(!fs.existsSync(file))throw new Error('Miniatura não encontrada.');return fs.readFileSync(file);}
 import(item,db){if(!/^[a-f0-9]{32}$/.test(item.assetId||''))return null;const file=path.join(path.dirname(db),'miniaturas',item.assetId+'.jpg');return fs.existsSync(file)?this.save(fs.readFileSync(file)):null;}
 async upload(raw){if(typeof raw.base64!=='string'||raw.base64.length>90000000||!/^[A-Za-z0-9+/]*={0,2}$/.test(raw.base64))throw new Error('Imagem inválida. Para arquivos grandes, envie pelo seletor de arquivos.');return this.uploadStream(Readable.from([Buffer.from(raw.base64,'base64')]),raw.name);}
 async uploadStream(stream,rawName,declaredSize){
  const name=filename(rawName);
  if(!name||name.length>300||!/^.+\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name))throw new Error('Escolha uma imagem TIFF, PNG, JPG, WebP ou BMP.');
  if(declaredSize!==undefined&&(!Number.isSafeInteger(declaredSize)||declaredSize<1||declaredSize>MAX_IMAGE_BYTES))throw new Error('Escolha uma imagem de até 3 GB.');
  if(this.busy){const e=new Error('Outra imagem está sendo preparada. Aguarde e tente novamente.');e.status=503;throw e;}
  this.busy=true;const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'laser-thumbnail-')),source=path.join(tmp,'input'+path.extname(name)),dest=path.join(tmp,'thumbnail.jpg');
  let size=0;
  try{
   const limiter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>MAX_IMAGE_BYTES)return callback(new Error('Imagem acima de 3 GB.'));callback(null,chunk);}});
   await pipeline(stream,limiter,fs.createWriteStream(source));
   if(!size||(declaredSize!==undefined&&size!==declaredSize))throw new Error('Envio incompleto. Selecione o arquivo novamente.');
   const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
   const candidates=this.python?[{exe:this.python,args:[]}]:[{exe:bundled,args:[]},{exe:'py',args:['-3']},{exe:'python',args:[]}];
   let done=false;
   for(const c of candidates){if(path.isAbsolute(c.exe)&&!fs.existsSync(c.exe))continue;try{await execute(c.exe,[...c.args,path.join(root,'thumbnail.py'),source,dest],{timeout:600000,maxBuffer:50000,windowsHide:true,env:{...process.env,VIPS_CONCURRENCY:'2'}});done=true;break;}catch(e){if(e.code==='ENOENT'||e.stderr?.includes('No module named'))continue;throw new Error(e.killed?'A prévia demorou mais de 10 minutos. Confira o arquivo.':'Não foi possível gerar a prévia. Confira se a imagem abre normalmente e não está corrompida.');}}
   if(!done)throw new Error('A conversão de imagens precisa de Python. Configure python em config.json.');
   return {id:this.save(fs.readFileSync(dest)),name};
  }finally{this.busy=false;fs.rmSync(tmp,{recursive:true,force:true});}
 }
}
