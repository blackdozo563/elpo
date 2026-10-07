/* Thumbnail Forge 5.1.5 — read an existing Flow result in its own tab.
 * No new host permissions, arbitrary URL fetch, private API or second generation.
 * The cache fallback reads one already loaded top-frame image with CDP Page.
 */
(function(root){
'use strict';
const MAX_BYTES=20*1024*1024,MAX_EDGE=8192,MAX_PIXELS=40*1024*1024;
const MIME=['image/png','image/jpeg','image/webp'],OCTET=['application/octet-stream','binary/octet-stream'];
const messages={
 INVALID_RESULT:'Adresse du résultat invalide pour cet export.',
 TAB_UNAVAILABLE:'L’onglet Flow de cette génération est fermé ou inaccessible. Rouvrez-le puis réessayez le téléchargement.',
 NOT_FLOW_PAGE:'Le document affiché n’est pas une page Google Flow autorisée. Affichez le résultat dans son onglet Flow puis réessayez.',
 DOCUMENT_REPLACED:'La page Flow a été rechargée pendant la lecture. Attendez que les résultats soient visibles puis réessayez le téléchargement.',
 DEBUGGER_UNAVAILABLE:'Chrome ne permet pas de lire cette image en cache. Fermez les outils de développement (DevTools) de l’onglet Flow, puis réessayez le téléchargement.',
 RESULT_NOT_VISIBLE:'Ce résultat n’est plus affiché dans son onglet Flow. Affichez les images de cette génération puis réessayez le téléchargement.',
 IMAGE_TOO_LARGE:'Image hors limites pour l’export (20 Mo, 8192 px et 40 Mpx maximum).',
 UNSUPPORTED_IMAGE:'Le résultat lu n’est pas une image PNG, JPG ou WebP valide.',
 IMAGE_UNREADABLE:'Lecture de l’image impossible dans cet onglet Flow. Laissez le résultat affiché puis réessayez le téléchargement.'
};
function failure(code,reason){const e=Error(messages[code]||messages.IMAGE_UNREADABLE);e.code=Object.hasOwn(messages,code)?code:'IMAGE_UNREADABLE';if(reason)e.reason=reason;return e;}
function sourceShape(src){
 if(typeof src!=='string'||!src||src.length>Math.ceil(MAX_BYTES*4/3)+100)return false;
 if(src.startsWith('data:'))return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(src);
 try{const url=new URL(src);return !url.username&&!url.password&&['https:','blob:'].includes(url.protocol);}catch{return false;}
}
async function checkTab(job){
 try{const tab=await chrome.tabs.get(job.tabId);if(tab?.id!==job.tabId)throw Error();}
 catch{throw failure('TAB_UNAVAILABLE','tab-unavailable');}
}
function pageMetadata(raw){const url=new URL(raw);return {pageUrl:url.origin+url.pathname,pageProjectId:TF.flowProjectId(raw)};}
// This entire function is serialized into Chrome's ISOLATED top-frame world.
// Keep every dependency inside it; no page JavaScript or raw errors are returned.
async function readInPage(src,mode){
 const MAX_BYTES=20*1024*1024,MAX_EDGE=8192,MAX_PIXELS=40*1024*1024;
 const bad=(code,found=false)=>({ok:false,found,code,reason:'dom'});
 const isFlow=()=>{
   try{const url=new URL(location.href);return url.protocol==='https:'&&!url.username&&!url.password&&((url.hostname==='labs.google'&&/^\/fx\/(?:[a-z-]+\/)?tools\/flow(?:\/|$)/i.test(url.pathname))||['flow.google','flow.google.com'].includes(url.hostname));}catch{return false;}
 };
 const pageURL=()=>location.origin+location.pathname;
 if(!isFlow())return bad('NOT_FLOW_PAGE');
 const matches=()=>Array.from(document.images).find(img=>{
   if((img.currentSrc||img.src)!==src||!img.isConnected)return false;
   const box=img.getBoundingClientRect(),style=getComputedStyle(img);
   return box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&style.visibility!=='collapse';
 });
 const img=matches();if(!img)return bad('RESULT_NOT_VISIBLE');
 try{
   const u=new URL(src),allowed=u.protocol==='https:'||u.protocol==='blob:'&&u.origin===location.origin||u.protocol==='data:'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(src);
   if(!allowed||u.username||u.password)return bad('INVALID_RESULT',true);
 }catch{return bad('INVALID_RESULT',true);}
 const dims=(w,h)=>Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0&&w<=MAX_EDGE&&h<=MAX_EDGE&&w*h<=MAX_PIXELS;
 if(!img.complete||!img.naturalWidth||!img.naturalHeight)return bad('IMAGE_UNREADABLE',true);
 if(!dims(img.naturalWidth,img.naturalHeight))return bad('IMAGE_TOO_LARGE',true);
 if(mode==='probe')return {ok:true,found:true,width:img.naturalWidth,height:img.naturalHeight,pageUrl:pageURL()};
 const encode=async(blob,method,width,height)=>{
   if(blob.size>MAX_BYTES)throw Error('IMAGE_TOO_LARGE');
   const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
   for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   if(!isFlow())throw Error('NOT_FLOW_PAGE');
   if(!matches())throw Error('RESULT_NOT_VISIBLE');
   return {ok:true,found:true,dataUrl:'data:'+blob.type+';base64,'+btoa(binary),width,height,method,pageUrl:pageURL()};
 };
 // Read displayed pixels at the image's native dimensions, without resizing.
 if(mode==='canvas')try{
   const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('IMAGE_UNREADABLE');ctx.drawImage(img,0,0);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('IMAGE_UNREADABLE')),'image/png'));
   return await encode(blob,'page-canvas',canvas.width,canvas.height);
 }catch(e){return bad(['IMAGE_TOO_LARGE','NOT_FLOW_PAGE','RESULT_NOT_VISIBLE'].includes(e?.message)?e.message:'IMAGE_UNREADABLE',true);}
 // A signed or authenticated URL can be read by its owning page, when CORS allows it.
 // This fetch is never used until an exactly matching rendered image was found.
 let timer;const controller=new AbortController();
 try{
   timer=setTimeout(()=>controller.abort(),12000);
   const response=await fetch(src,{credentials:'include',mode:'cors',redirect:'follow',signal:controller.signal});
   if(!response.ok)throw Error('IMAGE_UNREADABLE');
   const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(!['image/png','image/jpeg','image/webp'].includes(mime))return bad('IMAGE_UNREADABLE',true);
   if(Number(response.headers.get('content-length'))>MAX_BYTES)return bad('IMAGE_TOO_LARGE',true);
   const chunks=[];let size=0;
   if(response.body){
     const reader=response.body.getReader();
     try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return bad('IMAGE_TOO_LARGE',true);}chunks.push(value);}}
     finally{reader.releaseLock();}
   }else{const buffer=await response.arrayBuffer();if(buffer.byteLength>MAX_BYTES)return bad('IMAGE_TOO_LARGE',true);chunks.push(buffer);}
   const blob=new Blob(chunks,{type:mime});let bitmap;
   try{bitmap=await createImageBitmap(blob);if(!dims(bitmap.width,bitmap.height))return bad('IMAGE_TOO_LARGE',true);return await encode(blob,'page-fetch',bitmap.width,bitmap.height);}
   finally{bitmap?.close();}
 }catch(e){return bad(['NOT_FLOW_PAGE','RESULT_NOT_VISIBLE'].includes(e?.message)?e.message:'IMAGE_UNREADABLE',true);}
 finally{clearTimeout(timer);}
}
// Check the header BEFORE bitmap decoding to bound compressed image dimensions.
function header(bytes,mime){
 const u=bytes,v=new DataView(u.buffer,u.byteOffset,u.byteLength),ascii=(start,n)=>String.fromCharCode(...u.subarray(start,start+n));
 if(mime==='image/png'&&u.length>=33&&u[0]===137&&ascii(1,7)==='PNG\r\n\x1a\n'&&v.getUint32(8)===13&&ascii(12,4)==='IHDR')return {width:v.getUint32(16),height:v.getUint32(20)};
 if(mime==='image/jpeg'&&u.length>=4&&u[0]===255&&u[1]===216){
   let i=2;while(i+3<u.length){
     if(u[i++]!==255)break;while(i<u.length&&u[i]===255)i++;const marker=u[i++];
     if(marker===217||marker===218)break;if(marker===216||marker>=208&&marker<=215||marker===1)continue;
     if(i+2>u.length)break;const length=v.getUint16(i);if(length<2||i+length>u.length)break;
     if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)return {width:v.getUint16(i+5),height:v.getUint16(i+3)};
     i+=length;
   }
 }
 if(mime==='image/webp'&&u.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){
   if(ascii(12,4)==='VP8X')return {width:1+u[24]+(u[25]<<8)+(u[26]<<16),height:1+u[27]+(u[28]<<8)+(u[29]<<16)};
   if(ascii(12,4)==='VP8 '&&u[23]===157&&u[24]===1&&u[25]===42)return {width:v.getUint16(26,true)&16383,height:v.getUint16(28,true)&16383};
   if(ascii(12,4)==='VP8L'&&u[20]===47)return {width:1+u[21]+((u[22]&63)<<8),height:1+(u[22]>>6)+(u[23]<<2)+((u[24]&15)<<10)};
 }
 throw failure('UNSUPPORTED_IMAGE');
}
async function validateDataURL(dataUrl){
 if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(MAX_BYTES*4/3)+100)throw failure('IMAGE_TOO_LARGE');
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);if(!match)throw failure('UNSUPPORTED_IMAGE');
 let binary;try{binary=atob(match[2]);}catch{throw failure('UNSUPPORTED_IMAGE');}
 if(!binary.length||binary.length>MAX_BYTES)throw failure('IMAGE_TOO_LARGE');
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const dim=header(bytes,match[1]);
 if(!dim.width||!dim.height||dim.width>MAX_EDGE||dim.height>MAX_EDGE||dim.width*dim.height>MAX_PIXELS)throw failure('IMAGE_TOO_LARGE');
 let bitmap;try{
   bitmap=await createImageBitmap(new Blob([bytes],{type:match[1]}));
   if(!((bitmap.width===dim.width&&bitmap.height===dim.height)||(match[1]==='image/jpeg'&&bitmap.width===dim.height&&bitmap.height===dim.width))||bitmap.width>MAX_EDGE||bitmap.height>MAX_EDGE||bitmap.width*bitmap.height>MAX_PIXELS)throw failure('IMAGE_TOO_LARGE');
   return {dataUrl,width:bitmap.width,height:bitmap.height};
 }catch(e){if(e?.code)throw e;throw failure('UNSUPPORTED_IMAGE');}finally{bitmap?.close();}
}
async function pageRead(job,src,documentId,mode='probe'){
 await checkTab(job);
 const target=documentId?{tabId:job.tabId,documentIds:[documentId]}:{tabId:job.tabId,frameIds:[0]};
 let replies;
 try{replies=await chrome.scripting.executeScript({target,world:'ISOLATED',func:readInPage,args:[src,mode]});}
 catch{
   await checkTab(job);
   throw failure(documentId?'DOCUMENT_REPLACED':'IMAGE_UNREADABLE','document-injection');
 }
 const injection=replies?.find(r=>r.frameId===0);
 if(!injection||typeof injection.documentId!=='string'||!injection.documentId||documentId&&injection.documentId!==documentId)throw failure('DOCUMENT_REPLACED','document-id');
 if(!injection.result||typeof injection.result!=='object')throw failure('IMAGE_UNREADABLE','dom');
 return {...injection.result,documentId:injection.documentId};
}
async function prove(job,src,documentId){
 const proof=await pageRead(job,src,documentId,'probe');
 if(!proof.ok||!proof.found)throw failure(proof.code,proof.reason);
 return proof;
}
async function read(job,result,{withDebugger}={}){
 if(!job||!Number.isInteger(job.tabId)||job.tabId<0)throw failure('TAB_UNAVAILABLE','tab-id');
 const src=result?.src;if(!sourceShape(src))throw failure('INVALID_RESULT','source');
 // Authorize only the exact known image in frame 0 of the job's own tab.
 // Chrome's documentId survives SPA route changes but changes on real reload.
 // Every later DOM operation targets that document, never stale URL metadata.
 const initial=await prove(job,src,null),documentId=initial.documentId;
 const finish=async(dataUrl,method)=>{
   const image=await validateDataURL(dataUrl),after=await prove(job,src,documentId);
   return {...image,method,...pageMetadata(after.pageUrl)};
 };
 const fromPage=await pageRead(job,src,documentId,'canvas');
 if(fromPage.ok)return finish(fromPage.dataUrl,fromPage.method);
 if(!fromPage.found||fromPage.code!=='IMAGE_UNREADABLE')throw failure(fromPage.code,fromPage.reason);
 // A failed CORS fetch can evict the existing resource: read cache first.
 let debuggerUnavailable=typeof withDebugger!=='function';
 if(typeof withDebugger==='function'){
   try{
     await prove(job,src,documentId);
     const cached=await withDebugger(async send=>{
       await send('Page.enable',{});
       const tree=await send('Page.getResourceTree',{}),frame=tree?.frameTree?.frame;
       // Ignore frame.url: document routing metadata may be stale after SPA
       // navigation. The pinned live Flow document authorizes this image.
       if(!frame?.id||frame.parentId)throw failure('IMAGE_UNREADABLE','cache-frame');
       // Use securityOrigin only when supplied, never a pathname comparison.
       if(frame.securityOrigin&&frame.securityOrigin!==new URL(initial.pageUrl).origin)throw failure('IMAGE_UNREADABLE','cache-origin');
       const resource=tree.frameTree.resources?.find(r=>r.url===src&&r.type==='Image'&&[...MIME,...OCTET].includes((r.mimeType||'').toLowerCase()));
       if(!resource)throw failure('IMAGE_UNREADABLE','cache-missing');
       if(Number(resource.contentSize)>MAX_BYTES)throw failure('IMAGE_TOO_LARGE','cache-size');
       const content=await send('Page.getResourceContent',{frameId:frame.id,url:src});
       if(content?.base64Encoded!==true||typeof content.content!=='string')throw failure('UNSUPPORTED_IMAGE','cache-body');
       if(content.content.length>Math.ceil(MAX_BYTES*4/3)+4)throw failure('IMAGE_TOO_LARGE','cache-size');
       let mime=resource.mimeType.toLowerCase();
       if(OCTET.includes(mime)){
         let prefix;try{prefix=atob(content.content.slice(0,Math.min(64,content.content.length)));}catch{throw failure('UNSUPPORTED_IMAGE','cache-body');}
         if(prefix.startsWith('\x89PNG\r\n\x1a\n'))mime='image/png';
         else if(prefix.startsWith('\xff\xd8\xff'))mime='image/jpeg';
         else if(prefix.startsWith('RIFF')&&prefix.slice(8,12)==='WEBP')mime='image/webp';
         else throw failure('UNSUPPORTED_IMAGE','cache-signature');
       }
       return 'data:'+mime+';base64,'+content.content;
     });
     return await finish(cached,'browser-cache');
   }catch(e){
     // An explicit attach conflict (often DevTools) is retryable without
     // touching the resource. A failed CORS request could evict that cache.
     if(e?.code==='DEBUGGER_UNAVAILABLE')throw failure(e.code,e.reason||'debugger-attach');
     if(e?.code&&Object.hasOwn(messages,e.code)&&e.code!=='IMAGE_UNREADABLE'&&e.code!=='DEBUGGER_UNAVAILABLE')throw failure(e.code,e.reason);
     if(!e?.code||!Object.hasOwn(messages,e.code))debuggerUnavailable=true;
   }
 }
 await prove(job,src,documentId);
 const fetched=await pageRead(job,src,documentId,'fetch');
 if(!fetched.ok){
   if(fetched.code==='IMAGE_UNREADABLE'&&debuggerUnavailable)throw failure('DEBUGGER_UNAVAILABLE','debugger-and-cors');
   throw failure(fetched.code,fetched.reason);
 }
 return finish(fetched.dataUrl,'page-fetch');
}
root.TFResultReader={read};
})(typeof self!=='undefined'?self:globalThis);
