// Read-only diagnostics against the actual registered public Pages origin.
// Do not record HAR, full SDK bodies, key values, screenshots or credentials.
const {chromium}=require('../web/node_modules/playwright');
const fs=require('node:fs');
const target='https://hyeonbae-jeon.github.io/fire-monitoring/';
const secrets=new Set([process.env.VWORLD_DIAGNOSTIC_KEY].filter(Boolean));
function safe(text){
 let value=String(text??'');
 for(const key of secrets)value=value.replaceAll(key,'[redacted]').replaceAll(encodeURIComponent(key),'[redacted]');
 return value.replace(/https?:\/\/[^\s"'<>]+/g,url=>{try{const u=new URL(url);return u.origin+u.pathname+(u.search?'?[query omitted]':'');}catch{return '[URL omitted]';}})
  .replace(/(apiKey|token|password)=([^\s&"'<>]+)/gi,'$1=[redacted]').slice(0,700);
}
const commandEscape=text=>text.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
(async()=>{
 const http1=process.env.VWORLD_DIAGNOSTIC_HTTP1==='true';
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',...(http1?['--disable-http2']:[])]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const result={target,source:'real-public-pages',transport:http1?'http1':'browser-default',sdkRequests:[],sdkResponses:[],failures:[],consoleErrors:[],pageErrors:[],dialogs:[]};
 const pending=[];let sdkUrl=null;
 page.on('request',r=>{try{const u=new URL(r.url()),key=u.searchParams.get('apiKey');if(key)secrets.add(key);
  if(u.pathname.endsWith('/webglMapInit.js.do')){sdkUrl??=r.url();result.sdkRequests.push({host:u.hostname,path:u.pathname,hasKey:!!key,usesConfiguredKey:!!process.env.VWORLD_DIAGNOSTIC_KEY&&key===process.env.VWORLD_DIAGNOSTIC_KEY.trim(),referrer:safe(r.headers().referer)});}
 }catch{}});
 page.on('requestfailed',r=>{const u=new URL(r.url());result.failures.push({host:u.hostname,path:safe(u.pathname),error:r.failure()?.errorText});});
 page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push(safe(m.text()));});
 page.on('pageerror',e=>result.pageErrors.push(safe(e.message)));
 page.on('dialog',async d=>{result.dialogs.push(safe(d.message()));await d.dismiss();});
 page.on('response',r=>{
  const u=new URL(r.url());
  if(!u.pathname.endsWith('/webglMapInit.js.do'))return;
  pending.push((async()=>{
   const b=await r.text().catch(()=>'');
   result.sdkResponses.push({host:u.hostname,path:u.pathname,status:r.status(),contentType:r.headers()['content-type'],bytes:b.length,
    usesConfiguredKey:!!process.env.VWORLD_DIAGNOSTIC_KEY&&u.searchParams.get('apiKey')===process.env.VWORLD_DIAGNOSTIC_KEY.trim(),
    requestReferrer:safe(r.request().headers().referer),
    flags:{serviceUnavailable:/Service Unavailable|503 Service/i.test(b),domainDenied:/INVALID_DOMAIN|UNREGISTERED|등록되지|등록된.*(URL|도메인)/i.test(b),
     keyDenied:/INVALID_KEY|유효하지.*키|인증키.*(오류|없|유효)/i.test(b),exportsVw:/\bvw\b/.test(b)}});
  })());
 });
 try{
  const response=await page.goto(target,{waitUntil:'domcontentloaded',timeout:30000});result.httpStatus=response?.status();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('[role=status]')).some(e=>/초기화 완료|연결 실패|연결 시간 초과/.test(e.textContent)),null,{timeout:40000}).catch(()=>{});
  result.viewerInitialized=await page.getByText(/VWorld 3D 뷰어 초기화 완료 ·/).count()>0;
  result.deployedKeyPresent=await page.locator('button').filter({hasText:'등록된 키로 다시 연결'}).count()>0;
  result.frames=await Promise.all(page.frames().filter(f=>f!==page.mainFrame()).map(f=>f.evaluate(()=>{
   const viewer=window.ws3d?.viewer;let height=null;
   try{height=viewer?.scene?.globe?.getHeight(window.Cesium.Cartographic.fromDegrees(126.977,37.6585))??null;}catch{}
   return {documentLocation:location.href==='about:srcdoc'?'about:srcdoc':location.origin+location.pathname,
    documentReferrer:document.referrer,vwType:typeof window.vw,viewerPresent:!!viewer,canvasCount:document.querySelectorAll('canvas').length,
    tilesLoaded:viewer?.scene?.globe?.tilesLoaded??null,heightAtSyntheticPoint:Number.isFinite(height)?height:null};
  }).catch(e=>({inspectionError:safe(e.message)}))));
  // One bounded comparison using the browser's supported full-referrer policy.
  // It uses the same real viewer URL and key; no registered URL or header is forged.
  if(!result.viewerInitialized&&sdkUrl){
   const src=sdkUrl.replaceAll('&','&amp;').replaceAll('"','&quot;');
   const html='<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer-when-downgrade"><script>window.sdkProbe={loaded:false,failed:false};</script><script src="'+src+'" referrerpolicy="no-referrer-when-downgrade" onload="sdkProbe.loaded=true" onerror="sdkProbe.failed=true"></script></head><body></body></html>';
   await page.evaluate(html=>{
    const iframe=document.createElement('iframe');iframe.id='vworld-referrer-diagnostic';iframe.src=new URL('vworld-viewer.html',location.href).href;
    iframe.onload=()=>iframe.contentWindow.postMessage({scope:'vworld-bootstrap',type:'initialize',html},location.origin);
    document.body.appendChild(iframe);
   },html);
   const handle=await page.locator('#vworld-referrer-diagnostic').elementHandle(),probe=await handle.contentFrame();
   await probe.waitForFunction(()=>window.sdkProbe?.loaded||window.sdkProbe?.failed,null,{timeout:15000}).catch(()=>{});
   result.fullReferrerProbe=await probe.evaluate(()=>({documentLocation:location.origin+location.pathname,
    vwType:typeof window.vw,scriptLoaded:!!window.sdkProbe?.loaded,scriptFailed:!!window.sdkProbe?.failed}));
  }
 }catch(e){result.navigationError=safe(e.message);}
 await Promise.allSettled(pending);
 result.consoleErrors=result.consoleErrors.slice(0,8);result.pageErrors=result.pageErrors.slice(0,8);result.failures=result.failures.slice(0,12);
 const output=JSON.stringify(result,null,2);fs.writeFileSync('/tmp/vworld-diagnostic.json',output+'\n');
 console.log(output);
 console.log('::notice title=VWorld live diagnostic::'+commandEscape(JSON.stringify(result)));
 await browser.close();
 if(!result.viewerInitialized){console.log('::error title=VWorld viewer not ready::Read the sanitized live diagnostic above. No key values were logged.');process.exitCode=1;}
})().catch(e=>{console.log('::error title=VWorld diagnostic failed::'+commandEscape(safe(e.message)));process.exitCode=1;});
