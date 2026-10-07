/* Run: node validation/test-background.cjs — deterministic service worker mocks, no live Flow. */
let checks=0;
const strictAssert=require('node:assert/strict');
const assert=new Proxy(strictAssert,{get(target,key){const value=target[key];return typeof value==='function'?function(...args){const result=Reflect.apply(value,target,args);checks++;return result;}:value;}});
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../src');
const PNG='data:image/png;base64,aGVsbG8=';
const clone=value=>structuredClone(value);
function event(){const listeners=[];return{addListener:f=>listeners.push(f),emit:(...args)=>listeners.forEach(f=>f(...args)),listeners};}
async function harness(raw,{items=[],autoComplete=true,failPrepare=0,failDownload=0,prepare,reader,tabs=[]}={}){
 const db={tf_state:clone(raw)},requests=[],tabRequests=[],tabMessages=[],readerRequests=[],debuggerAttachments=[],debuggerDetachments=[],cdpCommands=[],chromeItems=clone(items),tabList=clone(tabs),tabUpdates=[];let nextId=100,prepareCount=0;
 const chrome={
  runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,onMessage:event(),onInstalled:event(),onStartup:event(),openOptionsPage:async()=>{}},
  storage:{local:{get:async keys=>keys===null?clone(db):Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in db).map(k=>[k,clone(db[k])])),set:async data=>Object.assign(db,clone(data))},onChanged:event()},
  action:{setBadgeBackgroundColor:async()=>{},setBadgeText:async()=>{}},
  debugger:{onDetach:event(),attach:async(...args)=>{debuggerAttachments.push(args);},detach:async(...args)=>{debuggerDetachments.push(args);},sendCommand:async(...args)=>{cdpCommands.push(args);return{};}},
  downloads:{onChanged:event(),download:async options=>{requests.push(options);if(failDownload-->0)throw Error('NETWORK_FAILED');const id=nextId++;chromeItems.push({id,filename:'/Downloads/'+options.filename,state:autoComplete?'complete':'in_progress',byExtensionId:'test-extension',startTime:new Date().toISOString()});return id;},search:async query=>chromeItems.filter(x=>query.id!==undefined?x.id===query.id:(!query.filenameRegex||new RegExp(query.filenameRegex).test(x.filename))&&(!query.startedAfter||new Date(x.startTime)>new Date(query.startedAfter)))},
  tabs:{query:async()=>clone(tabList),create:async o=>{tabRequests.push(o);const t={id:42,status:'loading',...o};tabList.push(t);return clone(t);},get:async id=>clone(tabList.find(t=>t.id===id)||{id,url:'https://flow.google.com/',status:'loading'}),sendMessage:async(...args)=>{tabMessages.push(args);return{ok:true};},update:async(id,patch)=>{tabUpdates.push({id,...patch});const t=tabList.find(t=>t.id===id);if(t)Object.assign(t,patch);return t?clone(t):{id,...patch};},onUpdated:event(),onRemoved:event()},
  windows:{update:async()=>{}},scripting:{executeScript:async()=>{},insertCSS:async()=>{}},
  alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()},
  contextMenus:{removeAll:cb=>cb(),create:()=>{},onClicked:event()},commands:{onCommand:event()}
 };
 const context=vm.createContext({chrome,URL,console,Blob,fetch,AbortSignal,crypto:require('node:crypto').webcrypto,Uint8Array,Date,setTimeout:(...args)=>{const timer=setTimeout(...args);timer.unref();return timer;},clearTimeout,btoa,structuredClone});
 context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file}));
 vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context,{filename:'background.js'});
 context.TFExports.preparePng=async(result,job)=>{prepareCount++;if(failPrepare-->0)throw Error('Logo illisible');return prepare?prepare(result,job,prepareCount,db):PNG;};
 context.TFResultReader={...(context.TFResultReader||{}),read:async(job,result,options)=>{readerRequests.push({job:clone(job),result:clone(result),options});if(reader)return reader(job,result,options);throw Error('Lecteur inattendu dans ce test');}};
 await vm.runInContext('exportsReady',context);
 const send=(msg,sender={id:chrome.runtime.id,url:chrome.runtime.getURL('src/popup.html')})=>new Promise(resolve=>chrome.runtime.onMessage.listeners[0](msg,sender,resolve));
 const settle=async()=>{for(let i=0;i<5;i++){await new Promise(resolve=>setImmediate(resolve));const pump=vm.runInContext('exportPump',context);if(pump)await pump;}};
 await settle();
 return{db,chrome,requests,chromeItems,tabList,tabUpdates,tabRequests,tabMessages,readerRequests,debuggerAttachments,debuggerDetachments,cdpCommands,context,send,settle,get prepareCount(){return prepareCount;}};
}
const base=(extra={})=>({v:5,thumbs:[],settings:{autoDownload:true},generationCounter:7,job:{id:'job',tabId:42,status:'generating',createdAt:Date.now(),updatedAt:Date.now(),generationNumber:7,results:[],downloads:{},exportSettings:{autoDownload:true,filePrefix:'chaine',logoEnabled:false,logoMode:'flow'},...extra},history:[]});
const results=n=>Array.from({length:n},(_,i)=>({index:i+1,src:'https://example.googleusercontent.com/'+i,dataUrl:PNG,width:1280,height:720}));
const flowSender={id:'test-extension',url:'https://flow.google.com/',tab:{id:42,url:'https://flow.google.com/'}};
const report=(h,n,status='generating')=>h.send({type:'tf:flowProgress',jobId:'job',patch:{status,results:results(n)}},flowSender);
(async()=>{
 {
  const h=await harness(base(),{autoComplete:false});
  await Promise.all([report(h,1),report(h,1)]);await h.settle();assert.equal(h.requests.length,1);
  await report(h,2);await h.settle();await report(h,4,'done');await h.settle();await report(h,4,'done');await h.settle();
  assert.equal(h.requests.length,4);assert.deepEqual(h.requests.map(r=>r.filename),[1,2,3,4].map(i=>'Thumbnail-Forge/0007_0'+i+'_chaine.png'));
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.downloads[0].state,'in_progress');
  for(const item of h.chromeItems){item.state='complete';h.chrome.downloads.onChanged.emit({id:item.id,state:{current:'complete'}});}await h.settle();
  assert.ok(Object.values(h.db.tf_state.job.downloads).every(d=>d.state==='complete'));
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();assert.equal(h.requests.length,4);
  await h.send({type:'tf:downloadResult',jobId:'job',index:0});await h.settle();assert.equal(h.requests.length,5);
  assert.equal((await h.send({type:'tf:downloadResult',src:PNG,filename:'arbitrary.png'})).ok,false);
  assert.equal((await h.send({type:'tf:downloadResult',jobId:'job',index:9})).ok,false);
 }
 {
  const h=await harness(base({exportSettings:{autoDownload:false,filePrefix:'off',logoEnabled:false}}));
  await report(h,4,'done');await h.settle();assert.equal(h.requests.length,0);
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();assert.equal(h.requests.length,4);
 }
 {
  const h=await harness(base(),{failPrepare:1});await report(h,1,'done');await h.settle();
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.downloads[0].state,'error');assert.equal(h.requests.length,0);
  await report(h,1,'done');await h.settle();assert.equal(h.prepareCount,1);
  await h.send({type:'tf:downloadResult',jobId:'job',index:0});await h.settle();assert.equal(h.requests.length,1);assert.equal(h.db.tf_state.job.downloads[0].state,'complete');
 }
 {
  const h=await harness(base(),{failDownload:1});await report(h,1,'done');await h.settle();
  assert.equal(h.db.tf_state.job.downloads[0].state,'error');assert.equal(h.db.tf_state.job.status,'done');
 }
 const filename='Thumbnail-Forge/0007_01_chaine.png';
 {
  const h=await harness(base({status:'done',results:results(1),downloads:{0:{state:'pending',filename,reservedAt:Date.now()}}}));
  assert.equal(h.requests.length,1);assert.equal(h.db.tf_state.job.downloads[0].state,'complete');
 }
 {
  const now=Date.now(),h=await harness(base({status:'done',results:results(1),downloads:{0:{state:'starting',filename,startedAt:now}}}),{items:[{id:17,state:'complete',byExtensionId:'test-extension',filename:'/Downloads/'+filename,startTime:new Date(now+1).toISOString()}]});
  assert.equal(h.requests.length,0);assert.equal(h.db.tf_state.job.downloads[0].state,'complete');assert.equal(h.db.tf_state.job.downloads[0].downloadId,17);
 }
 {
  const h=await harness(base({status:'done',results:results(1),downloads:{0:{state:'starting',filename,startedAt:Date.now()}}}));
  assert.equal(h.requests.length,0);assert.equal(h.db.tf_state.job.downloads[0].state,'uncertain');
  await h.send({type:'tf:downloadResult',jobId:'job',index:0});await h.settle();assert.equal(h.requests.length,1);
 }
 {
  const h=await harness(base({status:'done',results:results(1),downloads:{0:{state:'in_progress',filename,downloadId:12}}}),{items:[{id:12,state:'interrupted',error:'NETWORK_FAILED'}]});
  assert.equal(h.requests.length,0);assert.equal(h.db.tf_state.job.downloads[0].state,'interrupted');
 }
 {
  const raw=base({status:'done'});raw.thumbs=[{id:'ref',src:PNG}];raw.activeId='ref';raw.logo={src:PNG,name:'logo.png'};raw.zones={a:'Bonjour'};raw.settings={logoEnabled:true,logoMode:'overlay',logoSize:14,filePrefix:'test'};
  const h=await harness(raw);const response=await h.send({type:'tf:start'});assert.equal(response.ok,true);assert.equal(h.db.tf_state.generationCounter,8);assert.equal(h.db.tf_state.job.generationNumber,8);assert.equal(h.db.tf_state.job.exportLogo.src,PNG);assert.equal(h.db.tf_job_payload.logo,null);
  await h.send({type:'tf:setSettings',patch:{logoSize:30,filePrefix:'changed'}});assert.equal(h.db.tf_state.job.exportSettings.logoSize,14);assert.equal(h.db.tf_state.job.exportSettings.filePrefix,'test');
 }
 {
  const h=await harness(base({status:'done',results:results(1),downloads:{0:{state:'in_progress',filename,downloadId:12}}}),{items:[{id:12,state:'in_progress'}]});
  const response=await h.send({type:'tf:start'});assert.equal(response.ok,false);assert.match(response.error,/téléchargements/);assert.equal(h.tabRequests.length,0);
 }
 {
  // A late search from the previous attempt cannot overwrite a new explicit redownload.
  const h=await harness(base(),{autoComplete:false});await report(h,1,'done');await h.settle();
  const oldId=h.chromeItems[0].id;h.chromeItems[0].state='complete';
  const originalSearch=h.chrome.downloads.search;let releaseOldSearch;
  h.chrome.downloads.search=query=>new Promise(resolve=>{releaseOldSearch=async()=>resolve(await originalSearch(query));});
  h.chrome.downloads.onChanged.emit({id:oldId,state:{current:'complete'}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof releaseOldSearch,'function');
  h.chrome.downloads.search=originalSearch;
  h.chrome.downloads.onChanged.emit({id:oldId,state:{current:'complete'}});await h.settle();
  assert.equal(h.db.tf_state.job.downloads[0].state,'complete');
  await h.send({type:'tf:downloadResult',jobId:'job',index:0});await h.settle();
  const newId=h.db.tf_state.job.downloads[0].downloadId;assert.notEqual(newId,oldId);
  await releaseOldSearch();await h.settle();
  assert.equal(h.db.tf_state.job.downloads[0].downloadId,newId);assert.equal(h.db.tf_state.job.downloads[0].state,'in_progress');
 }
 {
  // Reproduce inaccessible blob/CDN exports without sending another generation.
  const inaccessible=Array.from({length:4},(_,i)=>({index:i+1,src:i%2?'https://cdn.example.invalid/image-'+i+'.webp':'blob:https://flow.google.com/image-'+i,width:1280,height:720}));
  const sourceOnly=async result=>{if(result.dataUrl===PNG)return PNG;const e=Error('Lecture directe impossible');e.code='SOURCE_READ_FAILED';throw e;};
  const h=await harness(base(),{prepare:sourceOnly,reader:async()=>({dataUrl:PNG,method:'test-page-reader'})});
  await h.send({type:'tf:flowProgress',jobId:'job',patch:{status:'done',results:inaccessible}},flowSender);await h.settle();
  assert.equal(h.requests.length,4);
  assert.deepEqual(h.requests.map(r=>r.filename),[1,2,3,4].map(i=>'Thumbnail-Forge/0007_0'+i+'_chaine.png'));
  assert.equal(h.readerRequests.length,4);assert.equal(h.prepareCount,8);
  assert.ok(h.readerRequests.every((request,i)=>request.job.id==='job'&&request.result.src===inaccessible[i].src));
  assert.ok(Object.values(h.db.tf_state.job.downloads).every(d=>d.state==='complete'));
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.generationCounter,7);
  assert.ok(h.db.tf_state.job.results.every(r=>r.dataUrl===undefined),'Reader image bytes remain transient');
  assert.equal(h.tabRequests.length,0);assert.ok(h.tabMessages.every(([,message])=>message.type!=='tf:flowStart'));
  assert.ok(h.cdpCommands.every(([,method])=>!method.startsWith('Input.')));
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
  assert.equal(h.requests.length,4);assert.equal(h.readerRequests.length,4);
 }
 {
  // Existing failed exports are repaired by downloadAll, preserving their generation.
  const inaccessible=Array.from({length:4},(_,i)=>({index:i+1,src:'blob:https://flow.google.com/old-'+i,width:1280,height:720}));
  const downloads=Object.fromEntries(inaccessible.map((_,i)=>[i,{state:'error',filename:'Thumbnail-Forge/0007_0'+(i+1)+'_chaine.png',error:'Adresse non autorisée'}]));
  const sourceOnly=async result=>{if(result.dataUrl===PNG)return PNG;const e=Error('Lecture directe impossible');e.code='SOURCE_READ_FAILED';throw e;};
  const h=await harness(base({status:'done',results:inaccessible,downloads}),{prepare:sourceOnly,reader:async()=>({dataUrl:PNG,method:'test-page-reader'})});
  assert.equal(h.requests.length,0);assert.equal(h.readerRequests.length,0);
  const response=await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
  assert.equal(response.ok,true);assert.equal(h.requests.length,4);assert.equal(h.readerRequests.length,4);
  assert.equal(h.db.tf_state.job.id,'job');assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.generationCounter,7);
  assert.equal(h.tabRequests.length,0);assert.ok(h.tabMessages.every(([,message])=>message.type!=='tf:flowStart'));
  assert.ok(h.cdpCommands.every(([,method])=>!method.startsWith('Input.')));
 }
 {
  // One unreadable source remains an export error and does not spoil other images.
  const inaccessible=Array.from({length:4},(_,i)=>({index:i+1,src:'blob:https://flow.google.com/failure-'+i,width:1280,height:720}));
  const sourceOnly=async result=>{if(result.dataUrl===PNG)return PNG;const e=Error('Lecture directe impossible');e.code='SOURCE_READ_FAILED';throw e;};
  const h=await harness(base(),{prepare:sourceOnly,reader:async(_job,result)=>{if(result.src.endsWith('-2'))throw Error('Image absente du projet');return{dataUrl:PNG,method:'test-page-reader'};}});
  await h.send({type:'tf:flowProgress',jobId:'job',patch:{status:'done',results:inaccessible}},flowSender);await h.settle();
  assert.equal(h.requests.length,3);assert.equal(h.db.tf_state.job.downloads[2].state,'error');assert.match(h.db.tf_state.job.downloads[2].error,/Image absente/);
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.error,undefined);
  assert.equal(h.tabRequests.length,0);assert.ok([0,1,3].every(i=>h.db.tf_state.job.downloads[i].state==='complete'));
 }
 {
  // Logo/composition errors must never trigger a page read or omit the logo silently.
  const h=await harness(base({exportSettings:{autoDownload:true,filePrefix:'logo',logoEnabled:true,logoMode:'overlay'},exportLogo:{src:PNG}}),{prepare:async()=>{throw Error('Logo impossible à dessiner');}});
  await report(h,1,'done');await h.settle();
  assert.equal(h.readerRequests.length,0);assert.equal(h.requests.length,0);
  assert.equal(h.db.tf_state.job.downloads[0].state,'error');assert.match(h.db.tf_state.job.downloads[0].error,/Logo/);assert.equal(h.db.tf_state.job.status,'done');
 }
 {
  // Already captured image bytes do not need the page reader.
  const h=await harness(base());await report(h,1,'done');await h.settle();
  assert.equal(h.readerRequests.length,0);assert.equal(h.requests.length,1);
 }
 {
  // A generation-finished detach must wait until the export callback releases its lease.
  const h=await harness(base({status:'done'}));
  const withDebugger=vm.runInContext('withExportDebugger',h.context),detach=vm.runInContext('cdpDetach',h.context);
  let releaseRead,entered;const enteredRead=new Promise(resolve=>{entered=resolve;});
  const lease=withDebugger(h.db.tf_state.job,async sendCommand=>{await sendCommand('Page.enable',{});await sendCommand('Page.getResourceTree',{});entered();await new Promise(resolve=>{releaseRead=resolve;});return 'captured';});
  await enteredRead;assert.equal(h.debuggerAttachments.length,1);
  await detach(42);assert.equal(h.debuggerDetachments.length,0);
  releaseRead();assert.equal(await lease,'captured');
  await h.settle();assert.equal(h.debuggerDetachments.length,1);
  assert.equal(h.cdpCommands.length,2);assert.deepEqual(h.cdpCommands.map(([,method])=>method),['Page.enable','Page.getResourceTree']);
 }
 {
  // The private helper guards job/tab existence and allowed methods. Live DOM/document
  // ownership belongs to reader tests; mocked tabs.url is not an authority here.
  const h=await harness(base({status:'done'})),withDebugger=vm.runInContext('withExportDebugger',h.context);
  await assert.rejects(withDebugger({...h.db.tf_state.job,id:'other-job'},async()=>{}),/lot/);
  const originalGet=h.chrome.tabs.get;h.chrome.tabs.get=async()=>{throw Error('No tab with id');};
  await assert.rejects(withDebugger(h.db.tf_state.job,async()=>{}),/No tab/);
  assert.equal(h.debuggerAttachments.length,0);assert.equal(h.cdpCommands.length,0);
  h.chrome.tabs.get=async id=>({id,url:'https://example.invalid/stale-metadata'});
  const result=await withDebugger(h.db.tf_state.job,async sendCommand=>{await sendCommand('Page.enable',{});await sendCommand('Page.getResourceTree',{});return 'resource-read-permitted';});
  assert.equal(result,'resource-read-permitted');assert.equal(h.debuggerAttachments.length,1);assert.equal(h.debuggerDetachments.length,1);
  assert.deepEqual(h.cdpCommands.map(([,method])=>method),['Page.enable','Page.getResourceTree']);
  h.chrome.tabs.get=originalGet;
  await assert.rejects(withDebugger(h.db.tf_state.job,sendCommand=>sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:1,y:1})),/non autorisée/);
  assert.equal(h.debuggerAttachments.length,1);assert.equal(h.cdpCommands.length,2);
 }
 {
  // Studio diagnostics retain export evidence when the page controller is stale or closed.
  const signedURL='https://cdn.googleusercontent.com/private/result.png?X-Goog-Signature=secret-signature';
  const blobURL='blob:https://flow.google.com/private/blob-id?token=secret-blob';
  const raw=base({status:'done',results:[{index:1,src:signedURL},{index:2,src:blobURL}],downloads:{0:{state:'error',error:'Fetch failed: '+signedURL},1:{state:'error',error:'Cannot read '+blobURL}},exportSettings:{autoDownload:false,filePrefix:'chaine'}});
  const h=await harness(raw),diagnosed=[];
  h.chrome.tabs.query=async()=>[{id:99,url:'https://flow.google.com/another-project',active:true}];
  h.chrome.tabs.sendMessage=async(id,message)=>{diagnosed.push({id,message});return{diagnostic:{controller:'ready'}};};
  const preferred=await h.send({type:'tf:diagnose'});
  assert.equal(preferred.ok,true);assert.deepEqual(diagnosed.map(call=>call.id),[42]);assert.equal(preferred.diagnostics.controller,'ready');
  assert.equal(preferred.diagnostics.imageExports.tabMatches,true);assert.equal(preferred.diagnostics.imageExports.generationNumber,7);
  const [remote,blob]=preferred.diagnostics.imageExports.results;
  assert.equal(remote.source.protocol,'https:');assert.equal(remote.source.host,'cdn.googleusercontent.com');
  assert.equal(blob.source.protocol,'blob:');assert.equal(blob.source.host,'flow.google.com');
  assert.deepEqual(Object.keys(remote.source).sort(),['host','protocol']);
  assert.doesNotMatch(JSON.stringify(preferred.diagnostics.imageExports),/secret-signature|secret-blob|X-Goog-Signature|private\/result|private\/blob-id/);
  assert.match(remote.error,/adresse masquée/);assert.match(blob.error,/adresse masquée/);
  let failedMessages=0,injections=0;
  h.chrome.tabs.sendMessage=async()=>{failedMessages++;throw Error('Could not establish connection. Receiving end does not exist.');};
  h.chrome.scripting.executeScript=async()=>{injections++;};
  const stale=await h.send({type:'tf:diagnose'});
  assert.equal(stale.ok,true);assert.equal(failedMessages,2);assert.equal(injections,2);
  assert.match(stale.diagnostics.pageDiagnosticError,/indisponible/);assert.equal(stale.diagnostics.imageExports.results.length,2);
  assert.equal(stale.diagnostics.imageExports.results[0].state,'error');assert.equal(stale.diagnostics.extensionVersion,h.context.TF.VERSION);
  h.chrome.tabs.get=async()=>{throw Error('No tab with id');};h.chrome.tabs.query=async()=>[];
  const closed=await h.send({type:'tf:diagnose'});
  assert.equal(closed.ok,true);assert.equal(closed.diagnostics.url,null);assert.match(closed.diagnostics.pageDiagnosticError,/fermé|introuvable/);
  assert.equal(closed.diagnostics.imageExports.tabMatches,false);assert.equal(closed.diagnostics.imageExports.results.length,2);
  assert.equal(failedMessages,2);assert.equal(h.tabRequests.length,0);assert.equal(h.requests.length,0);
 }
 {
  // SPA navigation must use the page's current URL, never MessageSender's stale home URL.
  const h=await harness(base({exportSettings:{autoDownload:false,filePrefix:'chaine'}}));
  const project='https://flow.google.com/project/proj_A-123/images/result-1';
  const before=await h.send({type:'tf:flowProgress',jobId:'job',pageUrl:project,patch:{status:'generating',results:[]}},flowSender);
  assert.equal(before.ok,true);assert.equal(h.db.tf_state.job.projectUrlVerified,undefined);
  const current=await h.send({type:'tf:flowProgress',jobId:'job',pageUrl:project+'?view=detail#canvas',patch:{status:'generating',results:results(1)}},flowSender);
  assert.equal(current.ok,true);assert.equal(h.db.tf_state.job.projectUrl,project);assert.equal(h.db.tf_state.job.projectUrlVerified,true);
  await h.send({type:'tf:flowProgress',jobId:'job',pageUrl:'https://flow.google.com/project/other-project',patch:{status:'generating',results:results(2)}},flowSender);
  assert.equal(h.db.tf_state.job.projectUrl,project);assert.equal(h.db.tf_state.job.projectUrlVerified,true);
  assert.equal(h.requests.length,0);
 }
 {
  // Old content scripts without pageUrl cannot accidentally bind a job to the home route.
  const h=await harness(base({exportSettings:{autoDownload:false,filePrefix:'chaine'}}));
  await report(h,1);assert.equal(h.db.tf_state.job.projectUrl,undefined);assert.equal(h.db.tf_state.job.projectUrlVerified,undefined);
  await h.send({type:'tf:flowProgress',jobId:'job',pageUrl:'https://flow.google.com/',patch:{status:'generating',results:results(1)}},flowSender);
  assert.equal(h.db.tf_state.job.projectUrl,undefined);
  await h.send({type:'tf:flowProgress',jobId:'job',pageUrl:'https://foreign.invalid/project/not-flow',patch:{status:'generating',results:results(1)}},flowSender);
  assert.equal(h.db.tf_state.job.projectUrlVerified,undefined);
 }
 {
  // Four existing PAGE_CHANGED failures recover only their pixels, preserving logo and ordering.
  const sources=Array.from({length:4},(_,i)=>({index:i+1,src:'blob:https://flow.google.com/legacy-'+i,width:1280,height:720}));
  const downloads=Object.fromEntries(sources.map((_,i)=>[i,{state:'error',filename:'Thumbnail-Forge/0007_0'+(i+1)+'_original.png',error:'PAGE_CHANGED',errorCode:'PAGE_CHANGED'}]));
  const logo={src:'data:image/png;base64,bG9nbw==',name:'original-logo.png'},snapshot={autoDownload:true,filePrefix:'original',logoEnabled:true,logoMode:'overlay',logoSize:14,logoPosition:'bottom-left'};
  const raw=base({status:'done',projectUrl:'https://flow.google.com/',results:sources,downloads,exportLogo:logo,hasExportLogo:true,exportSettings:snapshot});
  raw.logo={src:'data:image/png;base64,bmV3bG9nbw==',name:'new-logo.png'};raw.settings={filePrefix:'new-settings',logoSize:25};
  const project='https://flow.google.com/project/recovered-123/images/detail',prepared=[];
  let releaseFirst,entered;const firstRead=new Promise(resolve=>{entered=resolve;});
  const h=await harness(raw,{prepare:async(result,job)=>{prepared.push(clone(job));if(result.dataUrl===PNG)return PNG;throw Object.assign(Error('SOURCE_READ_FAILED'),{code:'SOURCE_READ_FAILED'});},reader:async(job,result)=>{
    if(result===undefined)throw Error('Missing exact source');
    if(result.src===sources[0].src){entered();await new Promise(resolve=>{releaseFirst=resolve;});}
    return{dataUrl:PNG,method:'exact-src-test',pageUrl:project+'?tracking=not-persisted#detail'};
  }});
  assert.equal(h.requests.length,0);assert.equal(h.db.tf_state.job.projectUrlVerified,undefined);
  const response=await h.send({type:'tf:downloadAll',jobId:'job'});await firstRead;
  assert.equal(response.ok,true);assert.equal(h.db.tf_state.job.projectUrl,'https://flow.google.com/');assert.equal(h.db.tf_state.job.projectUrlVerified,undefined);
  releaseFirst();await h.settle();
  assert.equal(h.requests.length,4);assert.equal(h.readerRequests.length,4);
  assert.deepEqual(h.requests.map(r=>r.filename),[1,2,3,4].map(i=>'Thumbnail-Forge/0007_0'+i+'_original.png'));
  assert.deepEqual(h.readerRequests.map(request=>request.result.src),sources.map(result=>result.src));
  assert.equal(h.db.tf_state.job.projectUrl,project);assert.equal(h.db.tf_state.job.projectUrlVerified,true);
  assert.ok(prepared.every(job=>job.exportLogo.src===logo.src&&job.exportSettings.logoSize===14&&job.exportSettings.logoMode==='overlay'&&job.exportSettings.logoPosition==='bottom-left'));
  assert.deepEqual(h.db.tf_state.job.exportLogo,logo);assert.deepEqual(h.db.tf_state.job.exportSettings,snapshot);
  assert.equal(h.db.tf_state.generationCounter,7);assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.error,undefined);
  assert.equal(h.tabRequests.length,0);assert.ok(h.tabMessages.every(([,message])=>message.type!=='tf:flowStart'));assert.ok(h.cdpCommands.every(([,method])=>!method.startsWith('Input.')));
  assert.ok(h.db.tf_state.job.results.every(result=>result.dataUrl===undefined));
  h.chrome.tabs.get=async id=>({id,url:'https://flow.google.com/project/recovered-123/'});
  const diagnostic=await h.send({type:'tf:diagnose'});
  assert.deepEqual(clone(diagnostic.diagnostics.imageExports.project),{savedId:'recovered-123',verified:true,currentId:'recovered-123'});
 }
 {
  // Reader success without a valid project URL does not promote legacy route metadata.
  for(const pageUrl of ['https://flow.google.com/','https://foreign.invalid/project/pretend']){
    const raw=base({status:'done',projectUrl:'https://flow.google.com/',results:[{src:'blob:https://flow.google.com/legacy-no-route'}],downloads:{0:{state:'error',filename:'Thumbnail-Forge/0007_01_chaine.png'}}});
    const h=await harness(raw,{prepare:async result=>{if(result.dataUrl===PNG)return PNG;throw Object.assign(Error('read'),{code:'SOURCE_READ_FAILED'});},reader:async()=>({dataUrl:PNG,method:'exact-src-test',pageUrl})});
    await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
    assert.equal(h.requests.length,1);assert.equal(h.db.tf_state.job.projectUrl,'https://flow.google.com/');assert.notEqual(h.db.tf_state.job.projectUrlVerified,true);
  }
 }
 {
  // Failure diagnostics distinguish an actual project mismatch from a generic read failure.
  const raw=base({status:'done',projectUrl:'https://flow.google.com/project/original-id',projectUrlVerified:true,results:[{src:'blob:https://flow.google.com/missing'}],downloads:{0:{state:'error',filename:'Thumbnail-Forge/0007_01_chaine.png'}}});
  const h=await harness(raw,{prepare:async()=>{throw Object.assign(Error('read'),{code:'SOURCE_READ_FAILED'});},reader:async()=>{throw Object.assign(Error('Le projet a changé.'),{code:'PAGE_CHANGED',reason:'PROJECT_MISMATCH'});}});
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
  h.chrome.tabs.get=async id=>({id,url:'https://flow.google.com/project/different-id/images/detail'});
  const diagnostic=await h.send({type:'tf:diagnose'}),exports=diagnostic.diagnostics.imageExports;
  assert.equal(diagnostic.ok,true);assert.deepEqual(clone(exports.project),{savedId:'original-id',verified:true,currentId:'different-id'});
  assert.equal(exports.results[0].errorCode,'PAGE_CHANGED');assert.equal(exports.results[0].readFailureReason,'PROJECT_MISMATCH');
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.error,undefined);assert.equal(h.requests.length,0);assert.equal(h.tabRequests.length,0);
 }
 {
  // New reservations identify the version that actually performed the export.
  const h=await harness(base());await report(h,1,'done');await h.settle();
  assert.equal(h.db.tf_state.job.downloads[0].attemptVersion,h.context.TF.VERSION);
  const diagnostic=await h.send({type:'tf:diagnose'});
  assert.equal(diagnostic.diagnostics.imageExports.results[0].attemptVersion,h.context.TF.VERSION);
  assert.equal(h.requests.length,1);
 }
 {
  // A pending reservation left by the previous extension is stamped before image preparation.
  const seen=[];
  const raw=base({status:'done',results:results(1),downloads:{0:{state:'pending',filename:'Thumbnail-Forge/0007_01_chaine.png',attemptId:'old-reservation',attemptVersion:'5.1.3',reservedAt:Date.now()}}});
  const h=await harness(raw,{prepare:async(_result,_job,_count,db)=>{seen.push(db.tf_state.job.downloads[0].attemptVersion);return PNG;}});
  assert.deepEqual(seen,[h.context.TF.VERSION]);assert.equal(h.db.tf_state.job.downloads[0].attemptVersion,h.context.TF.VERSION);
  assert.equal(h.db.tf_state.job.downloads[0].state,'complete');assert.equal(h.requests.length,1);
  assert.equal(h.db.tf_state.generationCounter,7);assert.equal(h.db.tf_state.job.id,'job');assert.equal(h.tabRequests.length,0);
 }
 {
  // Historical errors stay versionless until explicitly retried; job branding and names stay fixed.
  const logo={src:'data:image/png;base64,bG9nbw==',name:'original-logo.png'},snapshot={autoDownload:true,filePrefix:'original',logoEnabled:true,logoMode:'overlay',logoSize:14,logoPosition:'bottom-left'};
  const raw=base({status:'done',results:results(1),exportLogo:logo,hasExportLogo:true,exportSettings:snapshot,downloads:{0:{state:'error',filename:'Thumbnail-Forge/0007_01_original.png',errorCode:'PAGE_CHANGED',error:'Ancienne erreur'}}});
  raw.settings={filePrefix:'changed',logoSize:29};raw.logo={src:'data:image/png;base64,Y2hhbmdlZA==',name:'changed.png'};
  const prepared=[];
  const h=await harness(raw,{prepare:async(_result,job)=>{prepared.push(clone(job));return PNG;}});
  const before=await h.send({type:'tf:diagnose'});assert.equal(before.diagnostics.imageExports.results[0].attemptVersion,null);assert.equal(h.requests.length,0);
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
  const after=await h.send({type:'tf:diagnose'});assert.equal(after.diagnostics.imageExports.results[0].attemptVersion,h.context.TF.VERSION);
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].filename,'Thumbnail-Forge/0007_01_original.png');
  assert.deepEqual(prepared[0].exportLogo,logo);assert.deepEqual(prepared[0].exportSettings,snapshot);
  assert.deepEqual(h.db.tf_state.job.exportLogo,logo);assert.deepEqual(h.db.tf_state.job.exportSettings,snapshot);
  assert.equal(h.db.tf_state.job.id,'job');assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.generationCounter,7);
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();assert.equal(h.requests.length,1);
  assert.equal(h.tabRequests.length,0);assert.ok(h.tabMessages.every(([,message])=>message.type!=='tf:flowStart'));
 }
 {
  // Debugger denial has an actionable typed error and always releases its lease.
  const raw=base({status:'done',results:[{index:1,src:'blob:https://flow.google.com/refused-debugger'}],downloads:{0:{state:'error',filename:'Thumbnail-Forge/0007_01_chaine.png'}}});
  let attachCalls=0;const debuggerErrors=[];
  const h=await harness(raw,{prepare:async result=>{if(result.dataUrl===PNG)return PNG;throw Object.assign(Error('Source read failed'),{code:'SOURCE_READ_FAILED'});},reader:async(_job,_result,{withDebugger})=>{
    try{await withDebugger(sendCommand=>sendCommand('Page.enable',{}));}
    catch(error){debuggerErrors.push(error);throw error;}
    return{dataUrl:PNG,method:'mock-page-fetch'};
  }});
  h.chrome.debugger.attach=async()=>{attachCalls++;throw Error('Another debugger is already attached');};
  await h.send({type:'tf:downloadAll',jobId:'job'});await h.settle();
  const failed=h.db.tf_state.job.downloads[0];
  assert.equal(failed.state,'error');assert.equal(failed.errorCode,'DEBUGGER_UNAVAILABLE');assert.equal(failed.readFailureReason,'debugger-attach');
  assert.match(failed.error,/Fermez.*DevTools/);assert.equal(debuggerErrors[0].code,'DEBUGGER_UNAVAILABLE');assert.equal(debuggerErrors[0].reason,'debugger-attach');
  assert.equal(h.db.tf_state.job.status,'done');assert.equal(h.db.tf_state.job.error,undefined);assert.equal(h.requests.length,0);
  assert.equal(vm.runInContext('exportDebugLeases.size',h.context),0);
  const diagnostic=await h.send({type:'tf:diagnose'});assert.equal(diagnostic.diagnostics.imageExports.results[0].attemptVersion,h.context.TF.VERSION);
  assert.equal(diagnostic.diagnostics.imageExports.results[0].errorCode,'DEBUGGER_UNAVAILABLE');
  assert.equal(diagnostic.diagnostics.imageExports.results[0].readFailureReason,'debugger-attach');
  assert.equal(attachCalls,1);assert.equal(h.db.tf_state.job.id,'job');assert.equal(h.db.tf_state.generationCounter,7);
  assert.equal(h.tabRequests.length,0);assert.equal(h.cdpCommands.length,0);
 }
 {
  checks++;const ready={v:5,thumbs:[{id:'ref',src:PNG},{id:'other',src:PNG}],activeId:'ref',zones:{a:'Test'},settings:{model:'Nano Banana 2 Lite',autoDownload:false},history:[]};
  const h=await harness(ready,{tabs:[{id:71,url:'https://flow.google.com/project/shared',active:true,status:'loading',windowId:1}]});
  const first=await h.send({type:'tf:start'});assert.equal(first.ok,true);assert.equal(first.job.tabId,71);assert.equal(h.tabRequests.length,0);
  const id=h.db.tf_state.job.id;
  await h.send({type:'tf:flowProgress',jobId:id,pageUrl:'https://flow.google.com/project/shared',patch:{stage:'project-ready',status:'running'}},{...flowSender,tab:{id:71,url:'https://flow.google.com/project/shared'}});
  assert.equal(h.db.tf_state.flowProjectUrl,'https://flow.google.com/project/shared');assert.equal(h.db.tf_state.job.projectUrlVerified,true);
  await h.send({type:'tf:flowProgress',jobId:id,patch:{status:'error'}},{...flowSender,tab:{id:71,url:'https://flow.google.com/project/shared'}});
  h.db.tf_state.activeId='other';h.tabList.push({id:72,url:'https://flow.google.com/project/unrelated',active:true,status:'loading'});h.tabList[0].active=false;
  const next=await h.send({type:'tf:start'});assert.equal(next.ok,true);assert.equal(next.job.tabId,71);assert.equal(h.tabRequests.length,0);
  const payload=h.db.tf_flow_payload||Object.values(h.db).find(v=>v?.reference&&v?.prompt);assert.equal(payload.settings.model,'Nano Banana 2 Lite');
 }
 {
  checks++;const h=await harness({v:5,thumbs:[{id:'ref',src:PNG}],activeId:'ref',zones:{a:'Test'},settings:{autoDownload:false},flowProjectUrl:'https://flow.google.com/project/saved',history:[]});
  const started=await h.send({type:'tf:start'});assert.equal(started.ok,true);assert.equal(h.tabRequests[0].url,'https://flow.google.com/project/saved');
 }
 {
  checks++;const h=await harness(base({status:'running',stage:'opening',claimed:true,projectCreationRequested:true}));
  await h.send({type:'tf:flowReady'},flowSender);await h.settle();assert.equal(h.db.tf_state.job.status,'opening');assert.equal(h.db.tf_state.job.claimed,false);assert.equal(h.db.tf_state.job.projectCreationRequested,true);
 }
 {
  checks++;const h=await harness(base({status:'running',stage:'submitting',claimed:true,submittedAt:Date.now()}));
  await h.send({type:'tf:flowReady'},flowSender);await h.settle();assert.equal(h.db.tf_state.job.claimed,true);assert.equal(h.db.tf_state.job.status,'running');assert.equal(h.tabMessages.filter(([,m])=>m.type==='tf:flowStart').length,0);
 }
 {
  checks++;const h=await harness(base({status:'running',stage:'opening',claimed:true,projectCreationRequested:true}),{tabs:[{id:42,url:'https://flow.google.com/project/new',status:'complete'}]});
  h.db.tf_job_payload={id:'job',prompt:'Ready',reference:{src:PNG},settings:{model:'Nano Banana 2.1'}};
  await h.send({type:'tf:flowReady'},{...flowSender,tab:{id:42,url:'https://flow.google.com/project/new'}});await h.settle();
  assert.equal(h.tabRequests.length,0);const starts=h.tabMessages.filter(([,m])=>m.type==='tf:flowStart');assert.equal(starts.length,1);assert.equal(starts[0][1].job.projectCreationRequested,true);assert.equal(h.db.tf_state.job.claimed,true);
 }
 {
  checks++;const h=await harness({v:5,thumbs:[{id:'ref',src:PNG}],activeId:'ref',zones:{a:'Test'},settings:{autoDownload:false},flowCreationPending:true,history:[]},{tabs:[{id:42,url:'https://flow.google.com/',status:'loading'}]});
  const started=await h.send({type:'tf:start'});assert.equal(started.ok,true);assert.equal(h.db.tf_state.job.projectCreationRequested,true);assert.equal(h.tabRequests.length,0);
  const id=h.db.tf_state.job.id;await h.send({type:'tf:flowProgress',jobId:id,pageUrl:'https://flow.google.com/project/resolved',patch:{stage:'project-ready'}},flowSender);assert.equal(h.db.tf_state.flowCreationPending,false);assert.equal(h.db.tf_state.flowProjectUrl,'https://flow.google.com/project/resolved');
 }
 console.log(JSON.stringify({suite:'background-state-machine',checks,passed:true,scope:'Mocked Chrome APIs; live DOM/document ownership is covered by reader tests, not this suite. No live Flow generation or browser download test.'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
