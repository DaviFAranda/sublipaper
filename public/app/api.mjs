export async function api(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',...options});
 let result;try{result=await response.json();}catch{throw Error('O servidor retornou uma resposta inválida. Tente atualizar a tela.');}
 if(!response.ok)throw Error(result.error||'Não foi possível concluir a operação');return result;
}
const pendingPosts=new Map();
export async function post(path,data){
 const operator=localStorage.getItem('sublipaper-operator')||'';
 if(path.includes('/production/')&&!operator.trim())throw Error('Informe o responsável no topo da tela.');
 const key=path+JSON.stringify(data);let token=pendingPosts.get(key);if(!token){token=crypto.randomUUID();pendingPosts.set(key,token);}
 const result=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,operator,request_key:token})});pendingPosts.delete(key);return result;
}
