/* Thumbnail Forge 5 — persistent jobs, image capture and trusted input. */
'use strict';
importScripts('./shared.js','./exports.js','./result-reader.js');
const KEY=TF.STATE_KEY, PAYLOAD='tf_job_payload';
const FLOW_PATTERNS=['https://labs.google/fx/*','https://flow.google/*','https://flow.google.com/*'];
const err=e=>String(e?.message||e);
let writes=Promise.resolve(),launchLock=false;
async function getState(){const data=await chrome.storage.local.get([KEY,'tf_v3']);let raw=data[KEY];if(!raw?.v&&data.tf_v3){const v=data.tf_v3;const images=await chrome.storage.local.get(null);raw={thumbs:(v.library||[]).filter(t=>t.kind!=='logo').map(t=>({...t,src:images['tf_img:'+t.id]})),activeId:v.activeId,zones:{a:v.project?.text?.headline,b:v.project?.text?.support,c:v.project?.text?.badge},settings:{...v.settings,aspect:v.project?.aspect,brief:v.project?.topic},logo:v.brand?.logoId?{src:images['tf_img:'+v.brand.logoId],name:'logo'}:null};if(v.settings?.promptOverride)raw.settings.oneShotPrompt=v.settings.promptOverride;}return TF.normalizeState(raw);}
function mutate(fn){const next=writes.catch(()=>{}).then(async()=>{const st=await getState();await fn(st);const clean=TF.normalizeState(st);const before=await chrome.storage.local.get([KEY,'tf_legacy_v4']);if(before[KEY]&&!before[KEY].v&&!before.tf_legacy_v4)await chrome.storage.local.set({tf_legacy_v4:before[KEY]});await chrome.storage.local.set({[KEY]:clean});return clean;});writes=next;return next;}
async function badge(){try{const s=await getState();await chrome.action.setBadgeBackgroundColor({color:TF.isActiveJob(s.job)?'#D6F36B':'#383D32'});await chrome.action.setBadgeText({text:TF.isActiveJob(s.job)?'…':s.thumbs.length?String(s.thumbs.length):''});}catch{}}
function isExtension(sender){return !!sender.url?.startsWith(chrome.runtime.getURL(''));}
async function validFlowSender(sender,jobId){const j=(await getState()).job;return !!(sender.tab&&TF.isFlowURL(sender.url||sender.tab.url)&&j&&j.tabId===sender.tab.id&&(!jobId||j.id===jobId));}
function cleanPatch(p){
const out={};if(p?.model!==undefined){if(!TF.IMAGE_MODELS.includes(p.model))throw Error('Modèle image inconnu.');out.model=p.model;}for(const k of ['brief','aspect','oneShotPrompt','flowUrl','filePrefix'])if(p?.[k]!==undefined)out[k]=TF.clamp(p[k],k==='oneShotPrompt'?18000:k==='brief'?2000:k==='filePrefix'?60:1000);
if(out.flowUrl&&!TF.isFlowURL(out.flowUrl))throw Error('Utilisez uniquement une URL de Google Flow.');if(out.aspect&&!TF.ASPECTS[out.aspect])throw Error('Format inconnu.');
for(const k of ['autoDownload','logoEnabled'])if(p?.[k]!==undefined){if(typeof p[k]!=='boolean')throw Error('Option invalide : '+k);out[k]=p[k];}
if(p?.logoMode!==undefined){if(!['flow','overlay'].includes(p.logoMode))throw Error('Mode logo inconnu.');out.logoMode=p.logoMode;}
if(p?.logoPosition!==undefined){if(!['top-right','top-left','bottom-right','bottom-left'].includes(p.logoPosition))throw Error('Position logo inconnue.');out.logoPosition=p.logoPosition;}
if(p?.logoSize!==undefined){const n=Number(p.logoSize);if(!Number.isFinite(n)||n<5||n>30)throw Error('La taille du logo doit être comprise entre 5 et 30 %.');out.logoSize=n;}
if(p?.selectors&&typeof p.selectors==='object'){out.selectors={};for(const [k,v] of Object.entries(p.selectors))if(/^[a-zA-Z]+$/.test(k))out.selectors[k]=TF.clamp(v,500);}return out;
}
async function dataURL(blob){const b=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return `data:${blob.type};base64,${btoa(s)}`;}
function validImage(src){return typeof src==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(src)&&src.length<=12*1024*1024;}
async function normalizeImage(src,lossless=false){if(!validImage(src))throw Error('Image JPG, PNG ou WebP attendue (8 Mo maximum).');const blob=await(await fetch(src)).blob();if(blob.size>8*1024*1024)throw Error('Image trop volumineuse (8 Mo maximum).');const bmp=await createImageBitmap(blob);if(bmp.width>8192||bmp.height>8192||bmp.width*bmp.height>40*1024*1024){bmp.close();throw Error('Image trop grande (8192 px / 40 Mpx maximum).');}if(bmp.width<32||bmp.height<32){bmp.close();throw Error('Image trop petite.');}const ratio=Math.min(1,1600/bmp.width,1600/bmp.height);const w=Math.round(bmp.width*ratio),h=Math.round(bmp.height*ratio);const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(bmp,0,0,w,h);bmp.close();return {src:await dataURL(await canvas.convertToBlob({type:lossless?'image/png':'image/webp',quality:0.92})),w,h};}
async function grab(url,meta={}){const vid=TF.extractVideoId(url);if(!vid)throw Error('Ouvrez une vidéo YouTube ou collez son lien complet.');const existing=(await getState()).thumbs.find(t=>t.videoId===vid);if(existing){const st=await mutate(s=>{s.activeId=existing.id;});return{ok:true,duplicate:true,thumb:existing,state:st};}let found;for(const c of TF.thumbCandidates(vid)){try{const r=await fetch(c.url,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)continue;const b=await r.blob();if(b.size<1024||b.size>8*1024*1024)continue;const im=await createImageBitmap(b);const w=im.width,h=im.height;im.close();if(w<c.min||h<90)continue;found={id:TF.uid(),src:await dataURL(b),w,h,videoId:vid,url:'https://www.youtube.com/watch?v='+vid,title:TF.clamp(meta.title||'YouTube · '+vid,180),addedAt:Date.now()};break;}catch{}}
if(!found)throw Error('Miniature inaccessible. Vérifiez le lien et la connexion, ou importez l’image.');let duplicate=false;const st=await mutate(s=>{const ex=s.thumbs.find(t=>t.videoId===vid);if(ex){s.activeId=ex.id;found=ex;duplicate=true;return;}if(s.thumbs.length>=TF.MAX_THUMBS)throw Error('Vos 20 références sont remplies. Supprimez-en une avant d’en ajouter.');s.thumbs.unshift(found);s.activeId=found.id;});return{ok:true,state:st,thumb:found,duplicate};}
const attached=new Set(),detachTimers=new Map(),exportDebugLeases=new Map();
async function cdpAttach(id){if(attached.has(id))return;await chrome.debugger.attach({tabId:id},'1.3');attached.add(id);scheduleDetach(id);}
async function cdpDetach(id){if(exportDebugLeases.get(id)>0)return;clearTimeout(detachTimers.get(id));detachTimers.delete(id);if(!attached.has(id))return;attached.delete(id);try{await chrome.debugger.detach({tabId:id});}catch{}}
function scheduleDetach(id){clearTimeout(detachTimers.get(id));detachTimers.set(id,setTimeout(()=>cdpDetach(id),15000));}
async function cdp(id,method,params){await cdpAttach(id);scheduleDetach(id);return chrome.debugger.sendCommand({tabId:id},method,params);}
chrome.debugger.onDetach.addListener(s=>{attached.delete(s.tabId);clearTimeout(detachTimers.get(s.tabId));});
function mergeResults(previous,incoming){
const results=[...(previous||[])].slice(0,4);if(!Array.isArray(incoming))return results;
for(const [i,value] of incoming.slice(0,4).entries()){
 if(!value||typeof value!=='object')continue;
 const result={index:i+1};
 if(typeof value.src==='string'&&value.src.length<=28*1024*1024)result.src=value.src;
 if(TFExports.isImageData(value.dataUrl))result.dataUrl=value.dataUrl;
 if(!result.src&&!result.dataUrl)continue;
 for(const k of ['width','height'])if(Number.isFinite(value[k]))result[k]=value[k];
 // Flow reports the growing result list repeatedly. The original order is immutable.
 if(!results[i])results[i]=result;
 else if(results[i].src===result.src&&!results[i].dataUrl&&result.dataUrl)results[i]={...results[i],dataUrl:result.dataUrl};
}
return results;
}
async function progress(id,patch,projectUrl){return mutate(s=>{if(!s.job||s.job.id!==id)return;if(!TF.isActiveJob(s.job))return;const j=s.job;if(patch.projectCreationRequested)s.flowCreationPending=true;if(patch.stage==='project-ready')s.flowCreationPending=false;if(!j.projectUrlVerified&&(patch.stage==='project-ready'||Array.isArray(patch.results)&&patch.results.length)&&TF.flowProjectId(projectUrl)){const u=new URL(projectUrl);j.projectUrl=u.origin+u.pathname;j.projectUrlVerified=true;s.flowProjectUrl=j.projectUrl;}for(const k of ['status','stage','message','progress','error','submittedAt','diagnostic','draftSnapshot','projectCreationRequested'])if(patch[k]!==undefined)j[k]=patch[k];if(patch.results!==undefined)j.results=mergeResults(j.results,patch.results);if(![...TF.ACTIVE_STATUSES,'done','error','cancelled','uncertain'].includes(j.status))j.status='running';j.updatedAt=Date.now();if(!TF.isActiveJob(j)){j.endedAt=Date.now();const summary={id:j.id,title:j.title,status:j.status,stage:j.stage,message:j.message,createdAt:j.createdAt,endedAt:j.endedAt,tabId:j.tabId,generationNumber:j.generationNumber,resultCount:(j.results||[]).length,error:j.error};s.history=[summary,...s.history.filter(h=>h.id!==j.id).map(({results,exportLogo,reference,...meta})=>meta)].slice(0,20);}});}

async function existingFlow(){const ts=await chrome.tabs.query({url:FLOW_PATTERNS});return ts.filter(t=>TF.isFlowURL(t.url)).sort((a,b)=>Number(b.active)-Number(a.active))[0];}
async function flowTab(){return generationTab(await getState());}

async function generationTab(state){
 const saved=TF.flowProjectId(state.settings.flowUrl)?state.settings.flowUrl:state.flowProjectUrl;
 const tabs=(await chrome.tabs.query({url:FLOW_PATTERNS})).filter(t=>TF.isFlowURL(t.url));
 // One shared Flow project for every thumbnail and every attempt.
 let tab=saved?tabs.find(t=>TF.flowProjectId(t.url)===TF.flowProjectId(saved)&&new URL(t.url).origin===new URL(saved).origin):null;
 if(!saved)tab=tabs.filter(t=>TF.flowProjectId(t.url)).sort((a,b)=>Number(b.active)-Number(a.active))[0]||tabs.sort((a,b)=>Number(b.active)-Number(a.active))[0];
 if(tab){const focused=await chrome.tabs.update(tab.id,{active:true});if(tab.windowId!=null)await chrome.windows.update(tab.windowId,{focused:true});return focused||tab;}
 return chrome.tabs.create({url:saved||state.settings.flowUrl,active:true});
}

let dispatchLock=false;
async function dispatch(jobId){if(dispatchLock)return;dispatchLock=true;try{let s=await getState(),j=s.job;if(j?.id!==jobId||j.status!=='opening'||j.claimed||!j.tabId)return;let tab;try{tab=await chrome.tabs.get(j.tabId);}catch{return;}if(!TF.isFlowURL(tab.url)||tab.status==='loading')return;
try{await chrome.tabs.sendMessage(tab.id,{type:'tf:flowPing'});}catch{await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['src/flow-bridge.js']});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/shared.js','src/flow.js']});}
const payload=(await chrome.storage.local.get(PAYLOAD))[PAYLOAD];if(!payload||payload.id!==jobId)throw Error('Dossier de génération introuvable.');
// Persist ownership before sending: a lost acknowledgement can never cause a duplicate generation.
s=await mutate(st=>{if(st.job?.id===jobId&&st.job.status==='opening'){st.job.claimed=true;st.job.status='running';st.job.stage='connect';st.job.message='Connexion à l’éditeur Flow…';st.job.updatedAt=Date.now();}});
if(s.job.id!==jobId||s.job.status!=='running')return;
payload.projectCreationRequested=!!s.job.projectCreationRequested;
const response=await chrome.tabs.sendMessage(tab.id,{type:'tf:flowStart',job:payload});if(!response?.ok)throw Error(response?.error||'Flow n’a pas accepté la commande.');
}catch(e){await progress(jobId,{status:'uncertain',stage:'connection',error:err(e),message:'Connexion interrompue. Vérifiez Flow avant de relancer.'});}finally{dispatchLock=false;}}
async function start(msg){
if(launchLock)throw Error('Un lancement est déjà en cours.');launchLock=true;let id;
try{
 let s=await getState();if(TF.isActiveJob(s.job))throw Error('Une génération est déjà active. Attendez ou arrêtez-la.');
 if(exportsBusy(s.job))throw Error('Les téléchargements de cette génération sont encore en cours. Attendez leur fin avant de lancer la suivante.');
 const ref=s.thumbs.find(t=>t.id===s.activeId);if(!ref)throw Error('Ajoutez une miniature de référence.');
 const zones=msg.zones||s.zones,settings={...s.settings,...cleanPatch(msg.settings||{})};
 if(![zones.a,zones.b,zones.c,settings.brief].some(x=>String(x||'').trim()))throw Error('Saisissez au moins un texte ou le sujet de votre vidéo.');
 const prior=s.job,previousPayload=(await chrome.storage.local.get(PAYLOAD))[PAYLOAD];
 id=TF.uid();const logo=s.logo,prompt=TF.buildOneShotPrompt(settings,zones,{logo}),exportLogo=settings.logoEnabled&&settings.logoMode==='overlay'?logo:null;
 const job={id,status:'opening',stage:'connect',message:'Ouverture de Flow…',progress:3,createdAt:Date.now(),updatedAt:Date.now(),tabId:null,claimed:false,projectCreationRequested:s.flowCreationPending===true,results:[],downloads:{},referenceId:ref.id,title:settings.brief||zones.a||'Miniatures',outputs:4,exportSettings:TF.exportSettings(settings),exportLogo,hasExportLogo:!!exportLogo};
 // The persistent sequence and job are committed together before opening Flow.
 s=await mutate(st=>{if(TF.isActiveJob(st.job)||exportsBusy(st.job))throw Error('Une génération ou un export est déjà en cours.');st.generationCounter=(st.generationCounter||0)+1;job.generationNumber=st.generationCounter;st.zones={...zones};st.settings=settings;st.job=job;});
 const payload={id,reference:{...ref,name:'forge-reference.'+(ref.src.startsWith('data:image/png')?'png':ref.src.startsWith('data:image/webp')?'webp':'jpg')},logo:TF.logoForFlow(settings,logo),prompt,settings:{...settings,model:TF.normalizeModel(settings.model),outputs:4}};
 if(prior?.draftSnapshot&&(prior.status==='done'||!prior.submittedAt&&['error','cancelled'].includes(prior.status)))payload.ownedDraft={...prior.draftSnapshot,completed:prior.status==='done'};
 if(prior&&!prior.submittedAt&&prior.referenceId===ref.id&&prior.draftSnapshot&&previousPayload?.id===prior.id&&previousPayload.prompt===prompt&&previousPayload.reference?.src===ref.src&&(previousPayload.logo?.src||'')===(payload.logo?.src||''))payload.resumeDraft=prior.draftSnapshot;
 await chrome.storage.local.set({[PAYLOAD]:payload});
 const tab=await generationTab(s);await mutate(st=>{if(st.job?.id===id)st.job.tabId=tab.id;});
 await chrome.alarms.create('tf-monitor',{periodInMinutes:0.5});dispatch(id);return{ok:true,job:{...job,tabId:tab.id}};
}catch(e){if(id)await progress(id,{status:'error',error:err(e),message:err(e)});throw e;}finally{launchLock=false;}
}
async function download(src,filename){if(!validImage(src)){let u;try{u=new URL(src);}catch{throw Error('Image non téléchargeable.');}if(u.protocol!=='https:'||!/(^|\.)(googleusercontent\.com|googleapis\.com|google\.com|google)$/.test(u.hostname))throw Error('Ouvrez le résultat dans Flow pour le télécharger.');}const dl=await chrome.downloads.download({url:src,filename:'Thumbnail-Forge/'+String(filename||'miniature.png').replace(/[^\p{L}\p{N}_.-]/gu,'_').slice(0,120),saveAs:false});return{ok:true,downloadId:dl};}
// Each result owns a durable reservation. Generation status and export status stay separate.
const EXPORT_BUSY=new Set(['pending','starting','in_progress']);
let exportPump=null;
function exportsBusy(job){return Object.values(job?.downloads||{}).some(d=>EXPORT_BUSY.has(d.state));}
async function patchDownload(jobId,index,fn,attemptId){return mutate(s=>{if(s.job?.id!==jobId)return;const d=s.job.downloads?.[index];if(d&&(!attemptId||d.attemptId===attemptId)){fn(d);d.updatedAt=Date.now();}});}
async function applyDownloadItem(jobId,index,item,attemptId){return patchDownload(jobId,index,d=>{
 if(d.state==='complete')return; // A delayed search cannot regress an already completed attempt.
 d.downloadId=item.id;d.state=['complete','interrupted'].includes(item.state)?item.state:'in_progress';
 d.error=item.state==='interrupted'?'Chrome a interrompu le téléchargement : '+(item.error||'cause non précisée')+'. Réessayez cet export.':item.paused?'Téléchargement suspendu dans Chrome. Reprenez-le ou annulez-le dans la liste des téléchargements.':'';
},attemptId);}
async function reconcileDownload(job,index){
 const d=job.downloads?.[index];if(!d||!['starting','in_progress'].includes(d.state))return;
 if(Number.isInteger(d.downloadId)){
   let found;try{found=await chrome.downloads.search({id:d.downloadId});}catch{return;}
   if(found[0])await applyDownloadItem(job.id,index,found[0],d.attemptId);
   else await patchDownload(job.id,index,x=>{x.state='uncertain';x.error='L’entrée a disparu de la liste Chrome. Vérifiez votre dossier avant de réessayer cet export.';},d.attemptId);
   return;
 }
 // A worker may stop between downloads.download() and saving its id. Never blindly resend.
 const basename=d.filename.split('/').pop(),escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=escape(basename.replace(/\.png$/,''))+'(?: \\([0-9]+\\))?\\.png$';
 let found=[];try{found=await chrome.downloads.search({filenameRegex:pattern,startedAfter:new Date((d.startedAt||d.reservedAt||job.createdAt)-1).toISOString(),limit:20});}catch{}
 found=found.filter(item=>item.byExtensionId===chrome.runtime.id&&item.id!==d.previousDownloadId);
 if(found.length===1)await applyDownloadItem(job.id,index,found[0],d.attemptId);
 else await patchDownload(job.id,index,x=>{x.state='uncertain';x.error='État du téléchargement incertain après interruption. Aucune nouvelle copie automatique. Vérifiez votre dossier, puis utilisez Réessayer si nécessaire.';},d.attemptId);
}
async function queueExports(jobId,{indices,manual=false,redownload=false}={}){
 let count=0;
 const state=await mutate(s=>{
   const j=s.job;if(!j||j.id!==jobId)throw Error('Cette génération n’est plus affichée. Consultez son onglet Flow.');
   if(!manual&&!j.exportSettings?.autoDownload)return;
   const wanted=indices||j.results.map((_,i)=>i);
   for(const index of wanted)if(!Number.isInteger(index)||index<0||index>=j.results.length||!j.results[index])throw Error('Résultat introuvable.');
   if(!j.exportSettings)j.exportSettings=TF.exportSettings(s.settings);
   if(j.generationNumber===undefined)j.generationNumber=0;
   j.downloads||={};
   for(const index of wanted){
     const previous=j.downloads[index];
     if(previous&&EXPORT_BUSY.has(previous.state))continue;
     if(previous&&(!manual||previous.state==='complete'&&!redownload))continue;
     j.downloads[index]={attemptId:TF.uid(),attemptVersion:TF.VERSION,state:'pending',filename:'Thumbnail-Forge/'+TF.exportFilename(j,index,'png'),reservedAt:Date.now(),updatedAt:Date.now(),previousDownloadId:previous?.downloadId,error:''};count++;
   }
 });
 if(exportsBusy(state.job)){await chrome.alarms.create('tf-exports',{periodInMinutes:0.5});pumpExports();}
 return{ok:true,queued:count,state};
}
async function withExportDebugger(job,fn){
 const id=job.tabId;
 const live=(await getState()).job;
 if(!Number.isInteger(id)||live?.id!==job.id||live.tabId!==id)throw Error('Le lot à exporter n’est plus actif dans le studio.');
 await chrome.tabs.get(id);
 // Only the result reader calls this helper, after proving the live Flow
 // document and exact rendered result. tabs.url may be stale after routing.
 exportDebugLeases.set(id,(exportDebugLeases.get(id)||0)+1);
 try{
   return await fn(async(method,params)=>{
     if(!['Page.enable','Page.getResourceTree','Page.getResourceContent'].includes(method))throw Error('Lecture de ressource non autorisée.');
     const now=(await getState()).job;
     if(now?.id!==job.id||now.tabId!==id)throw Error('Le lot a changé pendant la récupération.');
     try{return await cdp(id,method,params);}
     catch(e){
       if(!attached.has(id))throw Object.assign(Error('Le lecteur Chrome est indisponible. Fermez le panneau Inspecter / DevTools de Flow, puis réessayez le téléchargement.'),{code:'DEBUGGER_UNAVAILABLE',reason:'debugger-attach'});
       throw e;
     }
   });
 }finally{
   const count=(exportDebugLeases.get(id)||1)-1;
   if(count>0)exportDebugLeases.set(id,count);else exportDebugLeases.delete(id);
   await cdpDetach(id);
 }
}
async function prepareResultPng(job,index,attemptId){
 const result=job.results[index];
 try{return await TFExports.preparePng(result,job);}
 catch(e){
   // Only a source-read failure permits reacquiring pixels. A logo/composition
   // failure must never silently fall back to an unbranded file.
   if(e.code!=='SOURCE_READ_FAILED')throw e;
   const latest=(await getState()).job;
   if(latest?.id!==job.id||latest.tabId!==job.tabId||latest.results?.[index]?.src!==result.src)throw Error('Le résultat à exporter a changé.');
   const pixels=await TFResultReader.read(job,result,{withDebugger:fn=>withExportDebugger(job,fn)});
   if(!TFExports.isImageData(pixels?.dataUrl))throw Error('Flow n’a pas fourni de pixels image exportables.');
   const after=(await getState()).job;
   if(after?.id!==job.id||after.results?.[index]?.src!==result.src||after.downloads?.[index]?.attemptId!==attemptId)throw Error('La tentative d’export a changé.');
   await mutate(st=>{
     const live=st.job,d=live?.downloads?.[index];
     if(live?.id!==job.id||d?.attemptId!==attemptId)return;
     d.readMethod=String(pixels.method||'flow-page').slice(0,40);d.updatedAt=Date.now();
     // Repair only legacy route metadata after the reader proves this exact
     // result is still rendered in its original tab and reads its pixels.
     if(!live.projectUrlVerified&&TF.flowProjectId(pixels.pageUrl)){
       const u=new URL(pixels.pageUrl);live.projectUrl=u.origin+u.pathname;live.projectUrlVerified=true;
     }
   });
   // One transient image at a time; do not duplicate large bitmaps in tf_state.
   return TFExports.preparePng({...result,dataUrl:pixels.dataUrl},job);
 }
}
function pumpExports(){
 if(exportPump)return exportPump;
 exportPump=(async()=>{
  for(;;){
   const j=(await getState()).job;
   const pending=Object.entries(j?.downloads||{}).find(([,d])=>d.state==='pending');if(!pending)return;
   const [index,d]=pending;let submitted=false;
   try{
     // While decoding, the persistent state remains pending: safe to retry after worker suspension.
     await patchDownload(j.id,index,entry=>{entry.attemptVersion=TF.VERSION;},d.attemptId);
     const url=await prepareResultPng(j,Number(index),d.attemptId);
     const state=await patchDownload(j.id,index,entry=>{entry.state='starting';entry.startedAt=Date.now();entry.error='';},d.attemptId);
     if(state.job?.id!==j.id||state.job.downloads?.[index]?.state!=='starting'||state.job.downloads[index].attemptId!==d.attemptId)continue;
     const downloadId=await chrome.downloads.download({url,filename:d.filename,conflictAction:'uniquify',saveAs:false});submitted=true;
     await patchDownload(j.id,index,entry=>{entry.downloadId=downloadId;entry.state='in_progress';},d.attemptId);
     const items=await chrome.downloads.search({id:downloadId});if(items[0])await applyDownloadItem(j.id,index,items[0],d.attemptId);
   }catch(e){
     await patchDownload(j.id,index,entry=>{
       // If Chrome accepted the download, do not describe a later storage/search failure as safe to resend.
       if(submitted){if(!Number.isInteger(entry.downloadId))entry.state='uncertain';entry.error='Vérification du téléchargement interrompue. Consultez la liste Chrome avant un réessai.';}
       else{entry.state='error';entry.error=err(e);entry.errorCode=String(e?.code||'EXPORT_FAILED').slice(0,80);entry.readFailureReason=e?.reason?String(e.reason).slice(0,80):null;}
     },d.attemptId);
   }
  }
 })().finally(()=>{exportPump=null;});
 // A failed storage write can outlive an event handler. Recovery will use the durable reservation.
 exportPump.catch(()=>{});return exportPump;
}
async function recoverExports(){
 const j=(await mutate(s=>{for(const d of Object.values(s.job?.downloads||{}))d.attemptId||=TF.uid();})).job;if(!j)return;
 for(const index of Object.keys(j.downloads||{}))await reconcileDownload(j,index);
 if(j.exportSettings?.autoDownload&&j.results?.length)await queueExports(j.id);
 else if(exportsBusy((await getState()).job)){await chrome.alarms.create('tf-exports',{periodInMinutes:0.5});pumpExports();}
}
chrome.downloads.onChanged.addListener(change=>{
 (async()=>{await exportsReady;const j=(await getState()).job;if(!j)return;const entry=Object.entries(j.downloads||{}).find(([,d])=>d.downloadId===change.id);if(!entry)return;await reconcileDownload(j,entry[0]);})().catch(()=>{});
});
chrome.alarms.onAlarm.addListener(alarm=>{
 if(alarm.name!=='tf-exports')return;
 (async()=>{await exportsReady;const j=(await getState()).job;for(const index of Object.keys(j?.downloads||{}))if(j.downloads[index].state==='in_progress'||j.downloads[index].state==='starting'&&!exportPump)await reconcileDownload(j,index);if(exportsBusy((await getState()).job))pumpExports();else await chrome.alarms.clear('tf-exports');})().catch(()=>{});
});
// Every worker wakeup reconciles Chrome's real list before accepting another export request.
const exportsReady=recoverExports().catch(()=>{});

function exportDiagnostic(job,tabId,tabURL){
 if(!job)return null;
 return {generationNumber:job.generationNumber||0,tabMatches:job.tabId===tabId,project:{savedId:TF.flowProjectId(job.projectUrl),verified:job.projectUrlVerified===true,currentId:TF.flowProjectId(tabURL)},
  results:(job.results||[]).map((result,index)=>{
   let source={protocol:'unknown',host:null};
   try{const url=new URL(result.src);source={protocol:url.protocol,host:url.hostname||null};
     if(url.protocol==='blob:'){const inner=new URL(url.pathname);source.host=inner.hostname;}
   }catch{}
   const dl=job.downloads?.[index];
   return {index:index+1,source,storedPixels:!!result.dataUrl,state:dl?.state||'not_requested',attemptVersion:dl?.attemptVersion||null,readMethod:dl?.readMethod||null,
    errorCode:dl?.errorCode||null,readFailureReason:dl?.readFailureReason||null,error:dl?.error?String(dl.error).replace(/(?:https?|blob):\/\/[^\s]+/g,'[adresse masquée]').slice(0,350):null};
  })};
}
const PUBLIC=new Set(['tf:getState','tf:grab','tf:flowReady','tf:flowProgress','tf:cdpAttach','tf:cdpDetach','tf:cdpClick','tf:cdpType','tf:cdpKey']);
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{(async()=>{try{await exportsReady;if(sender.id!==chrome.runtime.id)throw Error('Source non autorisée.');if(!PUBLIC.has(msg?.type)&&!isExtension(sender))throw Error('Action réservée au studio.');let s;
switch(msg?.type){
case'tf:getState':return{ok:true,state:await getState()};
case'tf:grab':return grab(msg.url,msg.meta);
case'tf:import':{const im=await normalizeImage(msg.src);const thumb={...im,id:TF.uid(),title:TF.clamp(msg.title||'Référence importée',180),addedAt:Date.now()};s=await mutate(st=>{if(st.thumbs.length>=20)throw Error('Supprimez une référence (maximum 20).');st.thumbs.unshift(thumb);st.activeId=thumb.id;});return{ok:true,state:s,thumb};}
case'tf:delete':s=await mutate(st=>{st.thumbs=st.thumbs.filter(t=>t.id!==msg.id);});return{ok:true,state:s};
case'tf:setActive':s=await mutate(st=>{if(!st.thumbs.some(t=>t.id===msg.id))throw Error('Référence introuvable.');st.activeId=msg.id;});return{ok:true,state:s};
case'tf:saveDraft':{const patch=cleanPatch(msg.settings||{});s=await mutate(st=>{st.zones={a:TF.clamp(msg.zones?.a,300),b:TF.clamp(msg.zones?.b,300),c:TF.clamp(msg.zones?.c,300)};st.settings={...st.settings,...patch,selectors:{...st.settings.selectors,...patch.selectors}};});return{ok:true,state:s};}
case'tf:setZones':s=await mutate(st=>{st.zones={a:TF.clamp(msg.zones?.a,300),b:TF.clamp(msg.zones?.b,300),c:TF.clamp(msg.zones?.c,300)};});return{ok:true,state:s};
case'tf:setSettings':{const patch=cleanPatch(msg.patch);s=await mutate(st=>{st.settings={...st.settings,...patch,selectors:{...st.settings.selectors,...patch.selectors}};});return{ok:true,state:s};}
case'tf:setLogo':{const input=msg.logo||msg,im=await normalizeImage(input.src,true);s=await mutate(st=>{st.logo={...im,name:TF.clamp(input.name||'logo.png',100),addedAt:Date.now()};});return{ok:true,state:s};}
case'tf:clearLogo':s=await mutate(st=>{st.logo=null;});return{ok:true,state:s};
case'tf:download':{s=await getState();const t=s.thumbs.find(t=>t.id===msg.id);if(!t)throw Error('Référence introuvable.');return download(t.src,'reference-'+(t.videoId||t.id)+(t.src.startsWith('data:image/png')?'.png':t.src.startsWith('data:image/webp')?'.webp':'.jpg'));}
case'tf:downloadResult':return queueExports(msg.jobId,{indices:[msg.index],manual:true,redownload:true});
case'tf:downloadAll':return queueExports(msg.jobId,{manual:true});
case'tf:openOptions':await chrome.runtime.openOptionsPage();return{ok:true};
case'tf:openStudio':await chrome.tabs.create({url:chrome.runtime.getURL('src/popup.html?studio=1')});return{ok:true};
case'tf:openFlow':{s=await getState();const t=s.job?.tabId;try{if(t){const tb=await chrome.tabs.get(t);if(TF.isFlowURL(tb.url)){await chrome.tabs.update(t,{active:true});await chrome.windows.update(tb.windowId,{focused:true});return{ok:true};}}}catch{}await flowTab();return{ok:true};}
case'tf:start':return start(msg);
case'tf:cancel':{s=await getState();if(!TF.isActiveJob(s.job)||msg.jobId&&s.job.id!==msg.jobId)return{ok:true};const j=s.job;await progress(j.id,{status:'cancelled',message:j.submittedAt?'Suivi arrêté. Une génération déjà envoyée peut continuer dans Flow.':'Automatisation arrêtée.'});try{await chrome.tabs.sendMessage(j.tabId,{type:'tf:flowCancel',jobId:j.id});}catch{}await cdpDetach(j.tabId);return{ok:true,state:await getState()};}
case'tf:flowReady':{if(!TF.isFlowURL(sender.url||sender.tab?.url))return{ok:false};s=await getState();if(s.job?.tabId===sender.tab.id){if(s.job.claimed&&s.job.stage==='opening'&&!s.job.submittedAt&&TF.isActiveJob(s.job)){s=await mutate(st=>{if(st.job?.id===s.job.id&&st.job.stage==='opening'&&!st.job.submittedAt&&TF.isActiveJob(st.job)){st.job.claimed=false;st.job.status='opening';st.job.updatedAt=Date.now();}});}if(s.job.status==='opening')dispatch(s.job.id);}return{ok:true};}
case'tf:flowProgress':{if(!await validFlowSender(sender,msg.jobId))throw Error('Tâche étrangère.');s=await progress(msg.jobId,msg.patch||{},msg.pageUrl);if(s.job?.exportSettings?.autoDownload&&s.job.results?.length)await queueExports(s.job.id);if(!TF.isActiveJob(s.job))await cdpDetach(sender.tab.id);return{ok:true,job:s.job};}
case'tf:diagnose':{
 s=await getState();let tab;
 if(Number.isInteger(s.job?.tabId))try{const candidate=await chrome.tabs.get(s.job.tabId);if(TF.isFlowURL(candidate.url))tab=candidate;}catch{}
 tab||=await existingFlow();let r;
 if(tab){
  try{r=await chrome.tabs.sendMessage(tab.id,{type:'tf:flowDiagnose',settings:s.settings});}
  catch{
   try{
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['src/flow-bridge.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/shared.js','src/flow.js']});
    r=await chrome.tabs.sendMessage(tab.id,{type:'tf:flowDiagnose',settings:s.settings});
   }catch{r={url:tab.url,pageDiagnosticError:'Le contrôleur de cette page est indisponible. Le diagnostic des exports reste accessible ci-dessous.'};}
  }
 }else r={url:null,pageDiagnosticError:'L’onglet Flow est fermé ou introuvable.'};
 s=await getState();return{ok:true,diagnostics:{...(r?.diagnostic||r?.diagnostics||r),extensionVersion:TF.VERSION,imageExports:exportDiagnostic(s.job,tab?.id,tab?.url)}};
}
case'tf:exportData':{s=await getState();const body=JSON.stringify({version:5,exportedAt:new Date().toISOString(),...s,legacy:await chrome.storage.local.get(['tf_v3','tf_legacy_v4'])},null,2);const src='data:application/json;base64,'+btoa(unescape(encodeURIComponent(body)));await chrome.downloads.download({url:src,filename:'Thumbnail-Forge/forge-sauvegarde.json',saveAs:true});return{ok:true};}
default:
if(!msg.type?.startsWith('tf:cdp'))throw Error('Commande inconnue.');
if(!await validFlowSender(sender))throw Error('Automatisation non autorisée sur cet onglet.');
s=await getState();if(msg.type!=='tf:cdpDetach'&&!TF.isActiveJob(s.job))throw Error('Automatisation arrêtée.');
const id=sender.tab.id;
if(msg.type==='tf:cdpDetach'){await cdpDetach(id);return{ok:true};}
if(msg.type==='tf:cdpAttach'){await cdpAttach(id);return{ok:true};}
if(msg.type==='tf:cdpType'){await cdp(id,'Input.insertText',{text:TF.clamp(msg.text,25000)});return{ok:true};}
if(msg.type==='tf:cdpKey'){const k=msg.key||{};const base={key:k.key,code:k.code,windowsVirtualKeyCode:k.keyCode||0,nativeVirtualKeyCode:k.keyCode||0,modifiers:k.modifiers||0};await cdp(id,'Input.dispatchKeyEvent',{type:'keyDown',...base});await cdp(id,'Input.dispatchKeyEvent',{type:'keyUp',...base});return{ok:true};}
if(msg.type==='tf:cdpClick'){if(!Number.isFinite(msg.x)||!Number.isFinite(msg.y))throw Error('Coordonnées invalides.');const b=msg.button==='right'?'right':'left',base={x:msg.x,y:msg.y,button:b,clickCount:1};await cdp(id,'Input.dispatchMouseEvent',{type:'mouseMoved',x:msg.x,y:msg.y});await cdp(id,'Input.dispatchMouseEvent',{type:'mousePressed',buttons:b==='right'?2:1,...base});await cdp(id,'Input.dispatchMouseEvent',{type:'mouseReleased',buttons:0,...base});return{ok:true};}
throw Error('Commande de saisie inconnue.');
}}catch(e){return{ok:false,error:err(e)};}})().then(reply,e=>reply({ok:false,error:err(e)}));return true;});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')getState().then(s=>{if(s.job?.tabId===id&&s.job.status==='opening')dispatch(s.job.id);});});
chrome.tabs.onRemoved.addListener(id=>{cdpDetach(id);getState().then(s=>{if(s.job?.tabId===id&&TF.isActiveJob(s.job))progress(s.job.id,{status:s.job.submittedAt?'uncertain':'error',message:'L’onglet Flow a été fermé. Vérifiez le projet avant de relancer.',error:'Onglet fermé'});});});
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name!=='tf-monitor')return;const s=await getState(),j=s.job;if(!TF.isActiveJob(j)){await chrome.alarms.clear('tf-monitor');return;}const age=Date.now()-j.updatedAt;if(j.status==='opening'){if(age>90000)await progress(j.id,{status:'error',message:'Flow n’est pas prêt. Connectez-vous à Flow, puis relancez.',error:'Ouverture expirée'});else dispatch(j.id);return;}if(age>90000){try{const r=await chrome.tabs.sendMessage(j.tabId,{type:'tf:flowPing'});if(r?.jobId===j.id)return;}catch{}await progress(j.id,{status:'uncertain',message:'Le suivi a été interrompu. Consultez Flow avant toute nouvelle génération.',error:'Session interrompue'});await cdpDetach(j.tabId);}});
function menus(){chrome.contextMenus.removeAll(()=>{chrome.contextMenus.create({id:'tf-grab',title:'Ajouter cette miniature à Forge',contexts:['page','link','image'],documentUrlPatterns:['https://*.youtube.com/*']});});}
async function toast(tabId,r){try{await chrome.tabs.sendMessage(tabId,{type:'tf:toast',text:r.ok?'Miniature ajoutée à Forge':r.error,kind:r.ok?'ok':'err'});}catch{}}
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{if(info.menuItemId!=='tf-grab')return;try{const url=[info.linkUrl,info.srcUrl,info.pageUrl].find(u=>TF.extractVideoId(u));await toast(tab?.id,await grab(url,{title:info.linkUrl?'':tab?.title}));}catch(e){await toast(tab?.id,{error:err(e)});}});
chrome.commands.onCommand.addListener(async cmd=>{if(cmd!=='grab-current')return;const[tab]=await chrome.tabs.query({active:true,currentWindow:true});try{await toast(tab?.id,await grab(tab?.url,{title:tab?.title}));}catch(e){await toast(tab?.id,{error:err(e)});}});
chrome.runtime.onInstalled.addListener(async()=>{await mutate(()=>{});menus();badge();for(const t of await chrome.tabs.query({url:['https://*.youtube.com/*',...FLOW_PATTERNS]})){try{const yt=new URL(t.url).hostname.endsWith('youtube.com');if(!yt)await chrome.scripting.executeScript({target:{tabId:t.id},world:'MAIN',files:['src/flow-bridge.js']});await chrome.scripting.executeScript({target:{tabId:t.id},files:['src/shared.js',yt?'src/youtube.js':'src/flow.js']});if(yt)await chrome.scripting.insertCSS({target:{tabId:t.id},files:['src/youtube.css']});}catch{}}});
chrome.runtime.onStartup.addListener(async()=>{menus();badge();const s=await getState();if(TF.isActiveJob(s.job))await progress(s.job.id,{status:'uncertain',message:'Chrome a redémarré. Vérifiez Flow avant de relancer.',error:'Session interrompue'});});
chrome.storage.onChanged.addListener((c,a)=>{if(a==='local'&&c[KEY])badge();});
