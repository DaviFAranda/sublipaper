import os from 'node:os';
export function networkAddresses(){return Object.values(os.networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal).map(a=>a.address);}
export function allowedHost(host,extra=[]){try{const name=new URL(`http://${host}`).hostname.toLowerCase();return new Set(['localhost','127.0.0.1',os.hostname().toLowerCase(),...networkAddresses(),...extra.map(s=>s.toLowerCase())]).has(name);}catch{return false;}}
