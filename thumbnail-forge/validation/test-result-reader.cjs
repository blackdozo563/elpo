/* Real Chromium DOM, canvas, fetch/CORS and Page.getResourceContent.
 * The extension scripting/tabs transport is simulated by explicit adapters.
 * Two HTTPS origins use a real local TLS server; all other network is blocked.
 * No Google account, generation, credits or external image requests.
 * Run with CHROMIUM_EXECUTABLE=/path/to/chromium node validation/test-result-reader.cjs
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),https=require('node:https'),os=require('node:os'),{execFileSync}=require('node:child_process');
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(__dirname,'..');let pageOrigin,mediaOrigin,pageURL,tlsDir,server;
const results=[],report={version:'5.1.5',date:new Date().toISOString(),mode:'Real Chromium DOM/canvas/fetch/CORS/history.pushState + real CDP Page resource-cache; simulated chrome.scripting/tabs adapters',limitations:['No authenticated Flow account or exact production CDN was accessed.','No installed MV3 extension or native Chrome download was asserted by this suite; chrome.scripting documentId routing is simulated with a per-document token.','A temporary TLS server serves 127.0.0.1 and localhost as distinct origins; the TF host guard is locally adapted and normal browser CORS remains enabled.'],results};
let browser,page,cdp,scope,tabURL,debugCalls=[],imageRequests=[],assets,tabClosed=false,omitDocumentId=false;const injectionTargets=[];const expired=new Set();
async function test(name,fn){try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});}console.log(results.at(-1).status.toUpperCase()+' '+name);}
async function show(src){await page.evaluate(async src=>{document.body.replaceChildren();const img=new Image();img.style.cssText='display:block;width:320px;height:180px';img.src=src;document.body.append(img);await img.decode();},src);}
async function read(src,job={tabId:7,projectUrl:pageURL,projectUrlVerified:true},options={}){debugCalls=[];return scope.TFResultReader.read(job,{src},{withDebugger:async fn=>fn(async(method,params)=>{debugCalls.push({method,params});return cdp.send(method,params);}),...options});}
async function push(url){await page.evaluate(url=>history.pushState({},'',url),url);tabURL=page.url();}
async function rejected(fn,code){let caught;try{await fn();}catch(e){caught=e;}assert.ok(caught,'expected rejection');assert.equal(caught.code,code);assert.equal(caught.message.includes('TOKEN_PRIVATE'),false);assert.equal(caught.message.includes('http'),false);return caught;}
(async()=>{try{
 browser=await playwright.chromium.launch({headless:true,args:['--no-proxy-server'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});report.browser=browser.version();
 const context=await browser.newContext({ignoreHTTPSErrors:true});page=await context.newPage();
 assets=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
   const make=(color,type='image/png')=>{ctx.fillStyle=color;ctx.fillRect(0,0,640,360);return canvas.toDataURL(type);};
   return {png:make('#f08020'),jpeg:make('#32b4df','image/jpeg'),webp:make('#3ae572','image/webp')};
 });
 tlsDir=fs.mkdtempSync(path.join(os.tmpdir(),'tf-reader-tls-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(tlsDir,'key.pem'),'-out',path.join(tlsDir,'cert.pem'),'-days','1','-subj','/CN=flow.google.com'],{stdio:'ignore'});
 server=https.createServer({key:fs.readFileSync(path.join(tlsDir,'key.pem')),cert:fs.readFileSync(path.join(tlsDir,'cert.pem'))},(req,res)=>{
   const url=new URL(req.url,pageOrigin||'https://flow.google.com');
   if(url.pathname==='/'||url.pathname.startsWith('/project/')){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Local result reader fixture</title><body></body>');return;}
   imageRequests.push({pathname:url.pathname,method:req.method,mode:req.headers['sec-fetch-mode']});
   if(expired.has(url.pathname)){res.writeHead(200,{'Content-Type':'text/html','Access-Control-Allow-Origin':pageOrigin,'Access-Control-Allow-Credentials':'true'});res.end('<html>Expired fixture token</html>');return;}
   const key=url.pathname.includes('jpeg')?'jpeg':url.pathname.includes('webp')?'webp':'png';
   const headers=url.pathname.includes('cors')?{'Access-Control-Allow-Origin':pageOrigin,'Access-Control-Allow-Credentials':'true'}:{};
   res.writeHead(200,{'Content-Type':url.pathname.includes('octet')?'application/octet-stream':assets[key].split(';')[0].slice(5),...headers});res.end(Buffer.from(assets[key].split(',')[1],'base64'));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 pageOrigin='https://127.0.0.1:'+server.address().port;mediaOrigin='https://localhost:'+server.address().port;pageURL=pageOrigin+'/project/local-reader';tabURL=pageURL;
 await context.route('**/*',route=>[pageOrigin,mediaOrigin].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
 await page.goto(pageURL);cdp=await context.newCDPSession(page);
 scope=vm.createContext({URL,Blob,atob,Uint8Array,DataView,console,chrome:{
   tabs:{get:async id=>{if(tabClosed)throw Error('Tab absent');return {id,url:tabURL,pendingUrl:'https://unrelated.example/old-metadata'};}},
   scripting:{executeScript:async spec=>{
     assert.equal(spec.world,'ISOLATED');assert.equal(spec.target.tabId,7);injectionTargets.push(structuredClone(spec.target));
     if(spec.target.documentIds){assert.equal(spec.target.frameIds,undefined);assert.equal(spec.target.documentIds.length,1);}else assert.deepEqual(Array.from(spec.target.frameIds),[0]);
     // Only test adaptation: permit the local Flow fixture origin, not the CDN.
     const source=String(spec.func).replace("['flow.google','flow.google.com'].includes(url.hostname)",JSON.stringify([new URL(pageOrigin).hostname])+'.includes(url.hostname)');
     const reply=await page.evaluate(async arg=>{
       document.__tfReaderDocumentId ||= crypto.randomUUID();const documentId=document.__tfReaderDocumentId;
       if(arg.documentId&&arg.documentId!==documentId)throw Error('Document replaced');
       const fn=(0,eval)('('+arg.source+')'),result=await fn(...arg.args);return {result,documentId};
     },{source,args:spec.args,documentId:spec.target.documentIds?.[0]});
     return [{frameId:0,result:reply.result,documentId:omitDocumentId?undefined:reply.documentId}];
   }}
 },createImageBitmap:async blob=>{
   const bytes=Array.from(new Uint8Array(await blob.arrayBuffer()));
   const dim=await page.evaluate(async({bytes,type})=>{const bmp=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type}));const out={width:bmp.width,height:bmp.height};bmp.close();return out;},{bytes,type:blob.type});return {...dim,close(){}};
 }});
 vm.runInContext(fs.readFileSync(path.join(root,'src/shared.js'),'utf8'),scope);
 scope.TF.isFlowURL=raw=>{try{return new URL(raw).origin===pageOrigin;}catch{return false;}}; // Local-only adapter; production uses unchanged TF.isFlowURL.
 vm.runInContext(fs.readFileSync(path.join(root,'src/result-reader.js'),'utf8'),scope);
 await test('Same-origin rendered PNG returns native canvas pixels without debugger',async()=>{
   const src=pageOrigin+'/result.png';await show(src);const out=await read(src);
   assert.equal(out.method,'page-canvas');assert.equal(out.width,640);assert.equal(out.height,360);assert.equal(debugCalls.length,0);assert.match(out.dataUrl,/^data:image\/png;base64,/);
 });
 await test('Same-origin blob image is read as pixels, without an extension fetch',async()=>{
   const src=await page.evaluate(async data=>URL.createObjectURL(await(await fetch(data)).blob()),assets.png);await show(src);const out=await read(src);
   assert.equal(out.method,'page-canvas');assert.equal(out.width,640);assert.equal(debugCalls.length,0);await page.evaluate(src=>URL.revokeObjectURL(src),src);
 });
 await test('Visible data image uses canvas at original dimensions',async()=>{await show(assets.png);const out=await read(assets.png);assert.equal(out.method,'page-canvas');assert.equal(out.width,640);assert.equal(debugCalls.length,0);});
 await test('Cross-origin tainted canvas falls back to page CORS fetch',async()=>{
   const src=mediaOrigin+'/cors.png?token=TOKEN_PRIVATE';await show(src);const out=await read(src,undefined,{withDebugger:undefined});
   assert.equal(out.method,'page-fetch');assert.equal(out.width,640);assert.equal(out.height,360);assert.equal(debugCalls.length,0);
 });
 for(const format of ['png','jpeg','webp'])await test('Cross-origin '+format.toUpperCase()+' without CORS is read from real browser resource cache',async()=>{
   const src=mediaOrigin+'/cached.'+format+'?token=TOKEN_PRIVATE';await show(src);
   // Reattach AFTER loading, as happens when an older generation is retried.
   await cdp.detach();cdp=await context.newCDPSession(page);
   const tainted=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').drawImage(document.images[0],0,0);try{c.toDataURL();return false;}catch{return true;}});assert.equal(tainted,true);
   const before=imageRequests.length;
   const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.width,640);assert.equal(out.height,360);assert.equal(out.dataUrl,assets[format]);
   assert.equal(imageRequests.length,before,'cache reading must not re-request the image');
   assert.deepEqual(debugCalls.map(c=>c.method),['Page.enable','Page.getResourceTree','Page.getResourceContent']);assert.equal(debugCalls[2].params.url,src);
 });
 await test('Cached cross-origin image reaches final PNG with exact logo pixels and original size',async()=>{
   const src=mediaOrigin+'/overlay.png';await show(src);const cached=await read(src);assert.equal(cached.method,'browser-cache');
   await page.addScriptTag({content:fs.readFileSync(path.join(root,'src/shared.js'),'utf8')});
   await page.addScriptTag({content:fs.readFileSync(path.join(root,'src/exports.js'),'utf8')});
   const checked=await page.evaluate(async cached=>{
     const logoCanvas=document.createElement('canvas');logoCanvas.width=100;logoCanvas.height=50;const lx=logoCanvas.getContext('2d');lx.fillStyle='#ff0000';lx.fillRect(10,5,80,40);
     const settings={logoEnabled:true,logoMode:'overlay',logoPosition:'bottom-left',logoSize:25};
     const png=await TFExports.preparePng(cached,{exportSettings:settings,exportLogo:{src:logoCanvas.toDataURL()},hasExportLogo:true});
     const bitmap=await createImageBitmap(await(await fetch(png)).blob()),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),cx=canvas.getContext('2d');cx.drawImage(bitmap,0,0);bitmap.close();
     const r=TF.logoRect(canvas.width,canvas.height,100,50,settings),pixel=(x,y)=>Array.from(cx.getImageData(x,y,1,1).data);
     return {width:canvas.width,height:canvas.height,logo:pixel(r.x+Math.floor(r.w/2),r.y+Math.floor(r.h/2)),transparent:pixel(r.x+1,r.y+1),outside:pixel(400,100)};
   },cached);
   assert.equal(checked.width,640);assert.equal(checked.height,360);assert.deepEqual(checked.logo,[255,0,0,255]);assert.deepEqual(checked.transparent,[240,128,32,255]);assert.deepEqual(checked.outside,[240,128,32,255]);
 });
 await test('Cached octet-stream image requires a real PNG signature and bitmap decode',async()=>{
   const src=mediaOrigin+'/octet.png';await show(src);const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.dataUrl,assets.png);
 });
 await test('An expired URL returning HTML does not stop export of its already loaded image',async()=>{
   const src=mediaOrigin+'/expired.png';await show(src);expired.add('/expired.png');const before=imageRequests.length;
   const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.dataUrl,assets.png);assert.equal(imageRequests.length,before);
 });
 await test('If cache attachment fails, page fetch still works when CORS allows it',async()=>{
   const src=mediaOrigin+'/cors-fallback.png';await show(src);const out=await read(src,undefined,{withDebugger:async()=>{throw Error('Debugger busy');}});assert.equal(out.method,'page-fetch');assert.equal(out.dataUrl,assets.png);
 });
 await test('Arbitrary absent URL is refused before fetch or debugger',async()=>{
   const before=imageRequests.length;await rejected(()=>read(mediaOrigin+'/absent.png?token=TOKEN_PRIVATE'),'RESULT_NOT_VISIBLE');assert.equal(imageRequests.length,before);assert.equal(debugCalls.length,0);
 });
 await test('Hidden exact URL cannot authorize export',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);await page.locator('img').evaluate(img=>img.style.display='none');await rejected(()=>read(src),'RESULT_NOT_VISIBLE');assert.equal(debugCalls.length,0);
 });
 await test('HTML data and a foreign absent blob cannot authorize image retrieval',async()=>{
   await rejected(()=>read('data:text/html;base64,PGgxPlRPS0VOX1BSSVZBVEU8L2gxPg=='),'INVALID_RESULT');assert.equal(debugCalls.length,0);
   await rejected(()=>read('blob:https://media-result.test/TOKEN_PRIVATE'),'RESULT_NOT_VISIBLE');assert.equal(debugCalls.length,0);
 });
 await test('Stale tabs URL and pendingUrl cannot block the exact visible result',async()=>{
   const src=mediaOrigin+'/stale-tab.png';await show(src);tabURL='https://unrelated.example/old-document';
   try{const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.pageUrl,pageURL);}finally{tabURL=pageURL;}
 });
 await test('HTML MIME in cache is rejected without requesting its body',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);const cmds=[];
   await rejected(()=>read(src,undefined,{withDebugger:async fn=>fn(async method=>{cmds.push(method);return {frameTree:{frame:{id:'frame',url:pageURL},resources:[{url:src,type:'Image',mimeType:'text/html'}]}};})}),'IMAGE_UNREADABLE');assert.deepEqual(cmds,['Page.enable','Page.getResourceTree']);
 });
 await test('Forged bitmap MIME with HTML body is refused',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);
   await rejected(()=>read(src,undefined,{withDebugger:async fn=>fn(async method=>method==='Page.getResourceTree'?{frameTree:{frame:{id:'frame',url:pageURL},resources:[{url:src,type:'Image',mimeType:'image/png'}]}}:{content:Buffer.from('<html>TOKEN_PRIVATE</html>').toString('base64'),base64Encoded:true})}),'UNSUPPORTED_IMAGE');
 });
 await test('Child-frame-only resource cannot authorize the cache fallback',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);
   await rejected(()=>read(src,undefined,{withDebugger:async fn=>fn(async()=>({frameTree:{frame:{id:'root',url:pageURL},resources:[],childFrames:[{frame:{id:'child',url:pageURL},resources:[{url:src,type:'Image',mimeType:'image/png'}]}]}}))}),'IMAGE_UNREADABLE');
 });
 await test('Oversized bitmap header is rejected before decompression',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);const bytes=Buffer.from(assets.png.split(',')[1],'base64');bytes.writeUInt32BE(9000,16);
   await rejected(()=>read(src,undefined,{withDebugger:async fn=>fn(async method=>method==='Page.getResourceTree'?{frameTree:{frame:{id:'frame',url:pageURL},resources:[{url:src,type:'Image',mimeType:'image/png'}]}}:{content:bytes.toString('base64'),base64Encoded:true})}),'IMAGE_TOO_LARGE');
 });
 await test('Tabs metadata changing during cache reading does not replace the live document',async()=>{
   const src=mediaOrigin+'/metadata-during.png';await show(src);
   try{const out=await read(src,undefined,{withDebugger:async fn=>{const out=await fn((m,p)=>cdp.send(m,p));tabURL=pageOrigin+'/project/other';return out;}});assert.equal(out.method,'browser-cache');}
   finally{tabURL=pageURL;}
 });
 await test('Cache protocol errors are redacted',async()=>{
   const src=mediaOrigin+'/cached.png';await show(src);
   await rejected(()=>read(src,undefined,{withDebugger:async()=>{throw Error('Unable to read https://media-result.test/?token=TOKEN_PRIVATE');}}),'DEBUGGER_UNAVAILABLE');
 });
 await test('Legacy home-page metadata survives real SPA navigation to a project',async()=>{
   const home=pageOrigin+'/',src=mediaOrigin+'/spa-home.png';
   await page.goto(home);tabURL=home;await push(pageURL);await show(src);
   const out=await read(src,{tabId:7,projectUrl:home});
   assert.equal(out.method,'browser-cache');assert.equal(out.pageUrl,pageURL);assert.equal(out.pageProjectId,'local-reader');
 });
 await test('Legacy previous-project metadata relies on the exact displayed image after SPA navigation',async()=>{
   const src=mediaOrigin+'/spa-previous.png',previous=pageOrigin+'/project/previous-reader',next=pageOrigin+'/project/new-reader';
   await push(previous);await push(next+'?token=TOKEN_PRIVATE#image');await show(src);
   try{
     const out=await read(src,{tabId:7,projectUrl:previous});assert.equal(out.method,'browser-cache');assert.equal(out.pageUrl,next);assert.equal(out.pageProjectId,'new-reader');
     await rejected(()=>read(mediaOrigin+'/never-loaded.png',{tabId:7,projectUrl:previous}),'RESULT_NOT_VISIBLE');assert.equal(debugCalls.length,0);
     const verified=await read(src,{tabId:7,projectUrl:previous,projectUrlVerified:true});assert.equal(verified.method,'browser-cache');assert.equal(verified.pageUrl,next);
   }finally{await push(pageURL);}
 });
 await test('A verified project permits a detail path and trailing slash for the same project ID',async()=>{
   const src=mediaOrigin+'/spa-detail.png';await push(pageURL+'/detail/image-1/?token=TOKEN_PRIVATE#view');await show(src);
   try{const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.pageProjectId,'local-reader');assert.equal(out.pageUrl,pageURL+'/detail/image-1/');}
   finally{await push(pageURL);}
 });
 await test('Stale CDP root path is accepted only with same origin and exact live image proof',async()=>{
   const src=mediaOrigin+'/spa-cdp.png';await show(src);
   const out=await read(src,undefined,{withDebugger:async fn=>fn(async(method,params)=>{
     const response=await cdp.send(method,params);
     if(method==='Page.getResourceTree')response.frameTree.frame.url=pageOrigin+'/project/previous-reader';
     return response;
   })});assert.equal(out.method,'browser-cache');assert.equal(out.pageProjectId,'local-reader');
 });
 await test('Stale CDP URL metadata is ignored when the pinned Flow document and image are unchanged',async()=>{
   const src=mediaOrigin+'/spa-cdp-origin.png';await show(src);
   const out=await read(src,undefined,{withDebugger:async fn=>fn(async(method,params)=>{
     const response=await cdp.send(method,params);if(method==='Page.getResourceTree')response.frameTree.frame.url=mediaOrigin+'/project/local-reader';return response;
   })});assert.equal(out.method,'browser-cache');assert.equal(out.pageUrl,pageURL);
 });
 await test('Real SPA route changes retain authorization only while the exact image stays in the same document',async()=>{
   const src=mediaOrigin+'/spa-during-change.png';await show(src);
   try{
     const out=await read(src,{tabId:7,projectUrl:pageOrigin+'/'},{withDebugger:async fn=>{
       const bytes=await fn((method,params)=>cdp.send(method,params));await push(pageOrigin+'/project/different-reader');return bytes;
     }});assert.equal(out.method,'browser-cache');assert.equal(out.pageProjectId,'different-reader');
   }finally{await push(pageURL);}
 });
 await test('Real SPA detail navigation during cache reading retains the same project identity',async()=>{
   const src=mediaOrigin+'/spa-during-detail.png';await show(src);
   try{
     const out=await read(src,undefined,{withDebugger:async fn=>{
       const bytes=await fn((method,params)=>cdp.send(method,params));await push(pageURL+'/details/output-2/');return bytes;
     }});assert.equal(out.method,'browser-cache');assert.equal(out.pageProjectId,'local-reader');assert.equal(out.pageUrl,pageURL+'/details/output-2/');
   }finally{await push(pageURL);}
 });
 await test('Removing the exact result during cache reading reports missing image, not a changed project',async()=>{
   const src=mediaOrigin+'/spa-removed.png';await show(src);
   const error=await rejected(()=>read(src,undefined,{withDebugger:async fn=>{
     const bytes=await fn((method,params)=>cdp.send(method,params));await page.evaluate(()=>document.body.replaceChildren());return bytes;
   }}),'RESULT_NOT_VISIBLE');assert.equal(error.reason,'dom');
 });
 await test('A real reload invalidates the pinned document even if the same URL and image reappear',async()=>{
   const src=mediaOrigin+'/reload-same.png';await show(src);
   const error=await rejected(()=>read(src,undefined,{withDebugger:async fn=>{
     const bytes=await fn((method,params)=>cdp.send(method,params));await page.reload();await show(src);return bytes;
   }}),'DOCUMENT_REPLACED');assert.equal(error.reason,'document-injection');
 });
 await test('DOM injections pin the initial top-frame document ID on every subsequent call',async()=>{
   const src=mediaOrigin+'/document-target.png';await show(src);injectionTargets.length=0;await read(src);
   assert.deepEqual(injectionTargets[0],{tabId:7,frameIds:[0]});const ids=injectionTargets.slice(1).map(t=>t.documentIds?.[0]);assert.ok(ids.length>=3);assert.ok(ids.every(id=>id&&id===ids[0]));assert.ok(injectionTargets.slice(1).every(t=>t.frameIds===undefined));
 });
 await test('A missing Chrome document ID fails closed before cache reading',async()=>{
   const src=mediaOrigin+'/no-document-id.png';await show(src);omitDocumentId=true;
   try{await rejected(()=>read(src),'DOCUMENT_REPLACED');assert.equal(debugCalls.length,0);}finally{omitDocumentId=false;}
 });
 await test('A real non-Flow document refuses even a displayed image and trusted saved project metadata',async()=>{
   await page.goto(mediaOrigin+'/project/non-flow');await show(mediaOrigin+'/non-flow.png');
   try{await rejected(()=>read(mediaOrigin+'/non-flow.png'),'NOT_FLOW_PAGE');assert.equal(debugCalls.length,0);}finally{await page.goto(pageURL);}
 });
 await test('A closed tab reports TAB_UNAVAILABLE without falling back to another tab',async()=>{
   tabClosed=true;try{await rejected(()=>read(mediaOrigin+'/closed.png'),'TAB_UNAVAILABLE');assert.equal(debugCalls.length,0);}finally{tabClosed=false;}
 });
 await test('Debugger conflict plus unavailable CORS reports a concrete DevTools recovery action',async()=>{
   const src=mediaOrigin+'/devtools-conflict.png';await show(src);
   const error=await rejected(()=>read(src,undefined,{withDebugger:async()=>{throw Error('Another debugger is already attached');}}),'DEBUGGER_UNAVAILABLE');assert.equal(error.reason,'debugger-and-cors');assert.match(error.message,/DevTools/);assert.equal(error.message.includes('projet'),false);
 });
 await test('Explicit debugger-attach refusal preserves the cached image for a retry after DevTools closes',async()=>{
   const src=mediaOrigin+'/typed-debugger-conflict.png';await show(src);const before=imageRequests.length;
   const error=await rejected(()=>read(src,undefined,{withDebugger:async()=>{const error=Error('Another debugger attached');error.code='DEBUGGER_UNAVAILABLE';error.reason='debugger-attach';throw error;}}),'DEBUGGER_UNAVAILABLE');
   assert.equal(error.reason,'debugger-attach');assert.equal(imageRequests.length,before,'no CORS fetch may evict the cached image after attach refusal');
   const out=await read(src);assert.equal(out.method,'browser-cache');assert.equal(out.dataUrl,assets.png);assert.equal(imageRequests.length,before,'retry must reuse the same cached image without regeneration or refetch');
 });
 }catch(error){results.push({name:'suite setup',status:'failed',error:error.message});}
 finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(tlsDir)fs.rmSync(tlsDir,{recursive:true,force:true});report.passed=results.filter(r=>r.status==='passed').length;report.failed=results.filter(r=>r.status==='failed').length;fs.writeFileSync(path.join(__dirname,'result-reader-5.1.5.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;}
})();
