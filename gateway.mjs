import http from 'node:http';

// Pedidos keeps its own namespace, cookies and authorization rules.
export function proxyPedidos(req,res,port){
 const incoming=new URL(req.url,'http://localhost');
 const target=(incoming.pathname.slice('/pedidos'.length)||'/')+incoming.search;
 const headers={...req.headers,'x-sublipaper-peer':req.socket.remoteAddress||''};delete headers.connection;
 const upstream=http.request({hostname:'127.0.0.1',port,path:target,method:req.method,headers},response=>{
  const outputHeaders={...response.headers};delete outputHeaders.connection;
  const type=String(outputHeaders['content-type']||'');
  if(type.startsWith('application/json')){
   const chunks=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
    let bytes=Buffer.concat(chunks);
    try{const data=JSON.parse(bytes);const rewrite=v=>typeof v==='string'&&/^\/(previews|miniaturas)\//.test(v)?'/pedidos'+v:Array.isArray(v)?v.map(rewrite):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rewrite(x)])):v;bytes=Buffer.from(JSON.stringify(rewrite(data)));}catch{}
    delete outputHeaders['transfer-encoding'];outputHeaders['content-length']=bytes.length;res.writeHead(response.statusCode,outputHeaders);res.end(bytes);
   });
  }else{res.writeHead(response.statusCode,outputHeaders);response.pipe(res);}
 });
 upstream.on('error',()=>{if(res.headersSent)return res.destroy();res.writeHead(503,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'Pedidos indisponível. Abra Iniciar Sublipaper.cmd no servidor.'}));});
 req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
}
