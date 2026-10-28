let serverMode=false,csrf='';
export async function initializeMonitorSession(enabled:boolean){
 serverMode=enabled;
 if(enabled){const r=await monitorFetch('/api/session');if(!r.ok)throw new Error('서버 로그인 상태를 확인하세요.');csrf=(await r.json()).csrfToken??'';}
}
export async function monitorFetch(url:string,options:RequestInit={}){
 const headers=new Headers(options.headers);
 if(serverMode&&url.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(options.method??'GET'))headers.set('X-Monitor-CSRF',csrf);
 const response=await fetch(url,{...options,headers,cache:'no-store'});
 if(serverMode&&response.status===401){location.assign('/login');throw new Error('로그인이 만료됐습니다. 다시 로그인하세요.');}
 return response;
}
