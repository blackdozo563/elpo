/* Thumbnail Forge 5.1 — bounded PNG export, including exact local logo pixels. */
(function(root){
'use strict';
const MAX_BYTES=20*1024*1024, MAX_PIXELS=40*1024*1024, MAX_EDGE=8192;
const manual='Ouvrez le résultat dans Flow et téléchargez-le manuellement.';
function remoteURL(src){
  let u;try{u=new URL(src);}catch{throw Error('Adresse de résultat invalide. '+manual);}
  const host=u.hostname.toLowerCase();
  const allowed=['labs.google','flow.google','flow.google.com'].includes(host)||/(^|\.)(googleusercontent\.com|googleapis\.com)$/.test(host);
  if(u.protocol!=='https:'||!allowed||u.username||u.password||(u.port&&u.port!=='443'))throw Error('Cette adresse de résultat n’est pas autorisée pour l’export automatique. '+manual);
  return u.href;
}
function isImageData(src){return typeof src==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/.test(src)&&src.length<=Math.ceil(MAX_BYTES*4/3)+100;}
async function readBounded(response){
  if(!response.ok)throw Error('Image inaccessible (HTTP '+response.status+'). '+manual);
  if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('Image trop volumineuse pour l’export (20 Mo maximum). '+manual);
  const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(mime&&!['image/png','image/jpeg','image/webp','application/octet-stream','binary/octet-stream'].includes(mime))throw Error('Le serveur n’a pas renvoyé une image PNG, JPG ou WebP. '+manual);
  if(!response.body){const b=await response.blob();if(b.size>MAX_BYTES)throw Error('Image trop volumineuse. '+manual);return b;}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('Image trop volumineuse (20 Mo maximum). '+manual);}chunks.push(value);}}finally{reader.releaseLock();}
  return new Blob(chunks,{type:mime||'application/octet-stream'});
}
async function imageBlob(src){
  if(typeof src!=='string')throw Error('Aucune image exportable trouvée. '+manual);
  if(src.startsWith('data:')){if(!isImageData(src))throw Error('Données image invalides ou trop volumineuses. '+manual);return readBounded(await fetch(src));}
  const url=remoteURL(src);
  try{return await readBounded(await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)}));}
  catch(e){throw Error('Export distant impossible : '+String(e?.message||e)+' '+manual);}
}
async function bitmap(src){
  let bmp;try{bmp=await createImageBitmap(await imageBlob(src));}catch(e){throw Object.assign(Error('Lecture de l’image impossible : '+String(e?.message||e)),{code:'SOURCE_READ_FAILED'});}
  if(bmp.width<16||bmp.height<16||bmp.width>MAX_EDGE||bmp.height>MAX_EDGE||bmp.width*bmp.height>MAX_PIXELS){bmp.close();throw Error('Dimensions hors limites pour l’export (16–8192 px, 40 Mpx maximum). '+manual);}
  return bmp;
}
async function asDataURL(blob){
  if(blob.size>MAX_BYTES)throw Error('Le PNG final dépasse 20 Mo. '+manual);
  const b=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<b.length;i+=32768)text+=String.fromCharCode(...b.subarray(i,i+32768));
  return 'data:image/png;base64,'+btoa(text);
}
async function preparePng(result,job){
  const base=await bitmap(result?.dataUrl||result?.src);let logo;
  try{
    const canvas=new OffscreenCanvas(base.width,base.height),ctx=canvas.getContext('2d');
    if(!ctx)throw Error('La composition PNG n’est pas disponible dans ce navigateur.');
    ctx.drawImage(base,0,0);
    const settings=job.exportSettings||{};
    if(settings.logoEnabled&&settings.logoMode==='overlay'&&job.exportLogo?.src){
      try{logo=await bitmap(job.exportLogo.src);const r=TF.logoRect(base.width,base.height,logo.width,logo.height,settings);ctx.drawImage(logo,r.x,r.y,r.w,r.h);}
      catch(e){throw Error('Le logo n’a pas pu être appliqué ; aucun fichier sans logo n’a été téléchargé. '+String(e?.message||e));}
    }
    if(settings.logoEnabled&&settings.logoMode==='overlay'&&job.hasExportLogo&&!job.exportLogo?.src)throw Error('Le logo de cette génération est introuvable ; export annulé.');
    return await asDataURL(await canvas.convertToBlob({type:'image/png'}));
  }finally{base.close();if(logo)logo.close();}
}
root.TFExports={remoteURL,isImageData,preparePng,MAX_BYTES,MAX_PIXELS,MAX_EDGE};
})(typeof self!=='undefined'?self:globalThis);
