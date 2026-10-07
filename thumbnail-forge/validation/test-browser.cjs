/* Run locally after installing Playwright + Chromium:
   node validation/test-browser.cjs
   Optionally: CHROMIUM_EXECUTABLE=/path/to/chromium node validation/test-browser.cjs
   Browser DOM/canvas are real; Chrome extension APIs are simulated deliberately.
   No Google account, network generation, credits or actual downloads are used. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {runShared}=require('./test-shared.cjs');
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'', 'playwright'));}
const root=path.resolve(__dirname,'..'),results=runShared().map(r=>({...r,suite:'shared'}));
const report={version:'5.1.5',date:new Date().toISOString(),mode:'Real Chromium DOM/canvas; simulated chrome.runtime/storage/tabs APIs',limitations:['No authenticated Flow generation tested.','No native Chrome downloads integration tested.','No installed MV3 worker integration asserted by this suite.'],results};
let browser,server,page;
async function test(name,fn){try{await fn();results.push({suite:'browser',name,status:'passed'});}catch(e){results.push({suite:'browser',name,status:'failed',error:e.message});}}
function chromeMock(initial){
  const listeners=[],messages=[];window.__messages=messages;
  function read(){return JSON.parse(localStorage.getItem('__tfMock')||JSON.stringify(initial));}
  function save(s){localStorage.setItem('__tfMock',JSON.stringify(s));for(const fn of listeners)fn({tf_state:{newValue:structuredClone(s)}},'local');}
  window.__readState=read;window.__setState=save;
  window.chrome={runtime:{lastError:null,openOptionsPage(){},sendMessage(msg,cb){messages.push(structuredClone(msg));queueMicrotask(()=>{let s=read(),ok=true,error;switch(msg.type){
    case 'tf:getState':break;
    case 'tf:saveDraft':s.zones=msg.zones;s.settings={...s.settings,...msg.settings,...window.TF.exportSettings({...s.settings,...msg.settings})};save(s);break;
    case 'tf:setLogo':s.logo={src:msg.src,name:msg.name};save(s);break;
    case 'tf:clearLogo':s.logo=null;save(s);break;
    case 'tf:downloadResult':case 'tf:downloadAll':break;
    default:ok=false;error='Mock does not implement '+msg.type;
  }cb({ok,state:structuredClone(s),error});});}},storage:{onChanged:{addListener(fn){listeners.push(fn);}}},tabs:{query:async()=>[],onActivated:{addListener(){}},onUpdated:{addListener(){}}}};
}
async function ready(){await page.waitForFunction(()=>document.getElementById('saveLabel').textContent.includes('Enregistré'));}
async function navigate(suffix='?studio=1'){await page.goto(report.localOrigin+'/src/popup.html'+suffix);await ready();}
async function setJob(job){await page.evaluate(j=>{const s=window.__readState();s.job=j;window.__setState(s);},job);}
(async()=>{
  try{
    const executable=process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH;
    browser=await playwright.chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});report.browser=browser.version();
    server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(file,(err,b)=>{if(err){res.writeHead(404).end();return;}res.setHeader('content-type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(b);});});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));report.localOrigin='http://127.0.0.1:'+server.address().port;
    const context=await browser.newContext({viewport:{width:1400,height:1000}});await context.route('**/*',route=>route.request().url().startsWith(report.localOrigin)||route.request().url().startsWith('data:')?route.continue():route.abort());
    page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const assets=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#214557');g.addColorStop(1,'#e39753');x.fillStyle=g;x.fillRect(0,0,1280,720);x.fillStyle='#f6f3e8';x.font='bold 67px sans-serif';x.fillText('LE GRAND DÉPART',72,210);x.font='26px sans-serif';x.fillText('RÉFÉRENCE · DÉMONSTRATION LOCALE',75,278);x.fillStyle='#d6f36b';x.fillRect(75,332,320,12);x.beginPath();x.arc(1030,475,135,0,Math.PI*2);x.fill();const reference=c.toDataURL();
      const outputs=Array.from({length:4},(_,i)=>{x.fillStyle=['#294354','#44315a','#304a46','#644c38'][i];x.fillRect(0,0,1280,720);x.fillStyle='#f6f3e8';x.font='bold 90px sans-serif';x.fillText('LE GRAND',68,245);x.fillText('DÉPART',68,350);x.font='29px sans-serif';x.fillText('CRÉATION DE DÉMONSTRATION '+(i+1),72,465);x.fillStyle='#d6f36b';x.beginPath();x.arc(1060,390,135+i*8,0,Math.PI*2);x.fill();return c.toDataURL();});
      c.width=200;c.height=100;x.clearRect(0,0,200,100);x.fillStyle='#d6f36b';x.fillRect(20,10,160,80);x.fillStyle='#182019';x.font='bold 56px sans-serif';x.fillText('TV',60,70);return {reference,outputs,logo:c.toDataURL()};
    });
    const initial={v:5,thumbs:[{id:'demo',src:assets.reference,title:'Référence locale de démonstration',w:1280,h:720}],activeId:'demo',logo:null,zones:{a:'LE GRAND DÉPART',b:'TOUT COMMENCE ICI',c:'ÉPISODE 01'},settings:{autoDownload:true,filePrefix:'miniature',logoEnabled:true,logoMode:'flow',aspect:'16:9',brief:'Une aventure commence, lumière de cinéma.'},generationCounter:6,job:null,history:[]};
    await context.addInitScript(chromeMock,initial);await navigate();
    await test('Logo controls start hidden until a real local PNG is imported',async()=>{
      assert.equal(await page.locator('#logoSettings').isVisible(),false);assert.equal(await page.locator('#logoEnabled').isDisabled(),true);
      await page.locator('#logoUpload').setInputFiles({name:'chaine-demo.png',mimeType:'image/png',buffer:Buffer.from(assets.logo.split(',')[1],'base64')});
      await page.waitForFunction(()=>window.__readState().logo?.name==='chaine-demo.png');assert.equal(await page.locator('#logoSettings').isVisible(),true);assert.equal(await page.locator('#logoEnabled').isChecked(),true);assert.equal(await page.locator('#logoPreview img').count(),1);
    });
    await test('Export settings and exact text survive popup reload via simulated storage',async()=>{
      await page.locator('#autoDownload').uncheck();await page.locator('#filePrefix').fill('Ma chaîne / Été');await page.locator('#logoMode').selectOption('overlay');await page.locator('#logoPosition').selectOption('bottom-left');await page.locator('#logoSize').fill('19');await page.locator('#zoneA').fill('ÉTÉ « EXACT » !');await page.locator('#logoSize').blur();await ready();
      assert.equal(await page.locator('#overlayControls').isVisible(),true);assert.equal(await page.locator('#filenamePreview').textContent(),'0007_01_Ma_chaîne_Été.png');
      await page.reload();await ready();assert.equal(await page.locator('#autoDownload').isChecked(),false);assert.equal(await page.locator('#filePrefix').inputValue(),'Ma_chaîne_Été');assert.equal(await page.locator('#logoMode').inputValue(),'overlay');assert.equal(await page.locator('#logoPosition').inputValue(),'bottom-left');assert.equal(await page.locator('#logoSize').inputValue(),'19');assert.equal(await page.locator('#zoneA').inputValue(),'ÉTÉ « EXACT » !');
    });
    await test('Logo modes update prompt and disabled logo can stay stored',async()=>{
      assert.ok((await page.locator('#promptPreview').textContent()).includes('overlaid locally'));
      await page.locator('#logoMode').selectOption('flow');assert.ok((await page.locator('#promptPreview').textContent()).includes('SECOND attached image'));assert.equal(await page.locator('#overlayControls').isVisible(),true);
      await page.locator('#logoEnabled').uncheck();assert.equal(await page.locator('#logoSettings').isVisible(),false);assert.ok((await page.locator('#promptPreview').textContent()).includes('No logo is attached'));assert.ok(await page.evaluate(()=>window.__readState().logo?.src));
      await page.locator('#logoEnabled').check();await page.locator('#logoMode').selectOption('overlay');
    });
    const job={id:'demo-job',generationNumber:6,status:'done',stage:'complete',message:'4 créations prêtes — démonstration locale.',progress:100,createdAt:Date.now(),outputs:4,results:assets.outputs.map(dataUrl=>({dataUrl})),exportSettings:{autoDownload:false,filePrefix:'chaine_demo',logoEnabled:true,logoMode:'overlay',logoPosition:'bottom-left',logoSize:19},exportLogo:{src:assets.logo},hasExportLogo:true,downloads:{0:{state:'complete',filename:'0006_01_chaine_demo.png'},1:{state:'error',error:'Interruption de démonstration.'},2:{state:'in_progress'}}};
    await setJob(job);
    await test('Result controls show stable filenames and target job/index for retry',async()=>{
      assert.equal(await page.locator('.result-card').count(),4);assert.equal(await page.locator('.download-filename').nth(1).textContent(),'0006_02_chaine_demo.png');
      assert.equal(await page.locator('.result-card').nth(1).getByRole('button').textContent(),'Réessayer ↓');assert.equal(await page.locator('.result-card').nth(2).getByRole('button').isDisabled(),true);
      await page.locator('.result-card').nth(1).getByRole('button').click();const sent=await page.evaluate(()=>window.__messages.findLast(m=>m.type==='tf:downloadResult'));assert.deepEqual(sent,{type:'tf:downloadResult',jobId:'demo-job',index:1});
      await page.locator('#downloadAll').click();const all=await page.evaluate(()=>window.__messages.findLast(m=>m.type==='tf:downloadAll'));assert.deepEqual(all,{type:'tf:downloadAll',jobId:'demo-job'});assert.equal(await page.locator('#resultExportHint').isVisible(),true);assert.equal(await page.locator('#startBtn').isDisabled(),true);
    });
    await test('Blob-only result retains its filename, retry action and visible export error',async()=>{
      await setJob({...job,results:[{src:'blob:https://flow.google/local-result'}],downloads:{0:{state:'error',error:'Ouvrez le résultat dans Flow et téléchargez-le manuellement.'}}});
      assert.equal(await page.locator('.result-card').count(),1);
      assert.equal(await page.locator('.download-filename').textContent(),'0006_01_chaine_demo.png');
      assert.ok((await page.locator('.download-error').textContent()).includes('manuellement'));
      assert.equal(await page.getByRole('button',{name:'Réessayer ↓',exact:true}).isVisible(),true);
      assert.ok((await page.locator('.result-card').textContent()).includes('Aperçu indisponible'));
      await setJob(job);
    });
    await test('Progress events preserve current draft and lock logo changes while running',async()=>{
      await page.locator('#zoneA').fill('BROUILLON CONSERVÉ');await setJob({...job,status:'generating',progress:45,results:[],downloads:{}});assert.equal(await page.locator('#zoneA').inputValue(),'BROUILLON CONSERVÉ');
      for(const id of ['logoUpload','removeLogo','logoMode','logoPosition','logoSize','logoEnabled'])assert.equal(await page.locator('#'+id).isDisabled(),true,id);assert.equal(await page.locator('#logoLockHint').isVisible(),true);
      await setJob(job);assert.equal(await page.locator('#logoUpload').isDisabled(),false);
    });
    await test('Logo removal updates stored state and controls without dropping settings',async()=>{
      await page.locator('#removeLogo').click();assert.equal(await page.evaluate(()=>window.__readState().logo),null);assert.equal(await page.locator('#logoSettings').isVisible(),false);assert.equal(await page.locator('#logoEnabled').isDisabled(),true);
      await page.locator('#logoUpload').setInputFiles({name:'chaine-demo.png',mimeType:'image/png',buffer:Buffer.from(assets.logo.split(',')[1],'base64')});await page.waitForFunction(()=>!!window.__readState().logo);assert.equal(await page.locator('#logoMode').inputValue(),'overlay');
    });
    await page.addScriptTag({url:report.localOrigin+'/src/exports.js'});
    await test('PNG overlay uses actual browser pixels, transparent logo and chosen corner',async()=>{
      const data=await page.evaluate(async()=>{
        const c=new OffscreenCanvas(400,200),x=c.getContext('2d');x.fillStyle='#0000ff';x.fillRect(0,0,400,200);
        const asData=async b=>'data:image/png;base64,'+btoa(String.fromCharCode(...new Uint8Array(await b.arrayBuffer())));
        const base=await asData(await c.convertToBlob({type:'image/png'}));c.width=100;c.height=50;x.clearRect(0,0,100,50);x.fillStyle='#ff0000';x.fillRect(20,10,60,30);const logo=await asData(await c.convertToBlob({type:'image/png'}));
        const checks=[];
        for(const position of Object.keys(TF.LOGO_POSITIONS)){
          const settings={logoEnabled:true,logoMode:'overlay',logoPosition:position,logoSize:25};const out=await TFExports.preparePng({dataUrl:base},{exportSettings:settings,exportLogo:{src:logo},hasExportLogo:true});
          const bmp=await createImageBitmap(await(await fetch(out)).blob());const canvas=new OffscreenCanvas(bmp.width,bmp.height),ctx=canvas.getContext('2d');ctx.drawImage(bmp,0,0);bmp.close();const r=TF.logoRect(400,200,100,50,settings);
          const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);checks.push({position,w:canvas.width,h:canvas.height,center:pixel(r.x+Math.floor(r.w/2),r.y+Math.floor(r.h/2)),transparent:pixel(r.x+1,r.y+1),outside:pixel(200,100)});
        }return checks;
      });
      for(const r of data){assert.equal(r.w,400);assert.equal(r.h,200);assert.deepEqual(r.center,[255,0,0,255],r.position);assert.deepEqual(r.transparent,[0,0,255,255],r.position);assert.deepEqual(r.outside,[0,0,255,255],r.position);}
    });
    await test('Missing required logo fails export and disabled logo retains base pixels',async()=>{
      const outcomes=await page.evaluate(async src=>{
        let failed='';try{await TFExports.preparePng({dataUrl:src},{exportSettings:{logoEnabled:true,logoMode:'overlay'},hasExportLogo:true});}catch(e){failed=e.message;}
        const data=await TFExports.preparePng({dataUrl:src},{exportSettings:{logoEnabled:false,logoMode:'overlay'},exportLogo:{src:'invalid'}});const a=await createImageBitmap(await(await fetch(src)).blob()),b=await createImageBitmap(await(await fetch(data)).blob());const c=new OffscreenCanvas(a.width,a.height),x=c.getContext('2d');x.drawImage(a,0,0);const before=x.getImageData(0,0,a.width,a.height).data;x.clearRect(0,0,a.width,a.height);x.drawImage(b,0,0);const after=x.getImageData(0,0,b.width,b.height).data;const identical=before.length===after.length&&before.every((v,i)=>v===after[i]);a.close();b.close();return {failed,png:data.startsWith('data:image/png;base64,iVBORw0KGgo'),identical};
      },assets.reference);assert.ok(outcomes.failed.includes('introuvable'));assert.equal(outcomes.png,true);assert.equal(outcomes.identical,true);
    });
    await test('Unsafe export URLs are rejected without contacting a remote server',async()=>{
      const r=await page.evaluate(()=>{
        const rejected=[];for(const u of ['http://flow.google/a.png','https://evil.example/x.png','https://flow.google.evil.example/a','https://user:pass@flow.google/a','https://flow.google:123/a','blob:https://flow.google/id'])try{TFExports.remoteURL(u);}catch{rejected.push(u);}
        return {rejected:rejected.length,allowed:TFExports.remoteURL('https://a.googleusercontent.com/image.png')};
      });assert.equal(r.rejected,6);assert.equal(r.allowed,'https://a.googleusercontent.com/image.png');
    });
    await page.locator('#zoneA').fill('LE GRAND DÉPART');await page.locator('#filePrefix').fill('chaine_demo');await page.locator('#autoDownload').check();await setJob({...job,downloads:{0:{state:'complete'},1:{state:'complete'},2:{state:'complete'},3:{state:'complete'}}});
    await test('No horizontal overflow in 360px side panel, 440px popup or 1400px studio',async()=>{
      const widths=[];
      for(const [width,query] of [[360,'?panel=1'],[440,''],[1400,'?studio=1']]){
        await page.setViewportSize({width,height:1000});await navigate(query);await page.locator('#notice').evaluate(el=>el.hidden=true);await page.evaluate(()=>window.scrollTo(0,0));
        const metrics=await page.evaluate(()=>({inner:innerWidth,body:document.body.scrollWidth,html:document.documentElement.scrollWidth}));widths.push({width,...metrics});assert.ok(metrics.body<=width+1&&metrics.html<=width+1,JSON.stringify(metrics));
        if(width===440)await page.screenshot({path:path.join(root,'apercu-popup.png'),fullPage:false});if(width===1400)await page.screenshot({path:path.join(root,'apercu-studio.png'),fullPage:true});
      }report.viewportChecks=widths;
    });
    await test('The three image models persist from the actual studio dropdown',async()=>{
      for(const model of ['Nano Banana Pro','Nano Banana 2 Lite','Nano Banana 2.1']){await page.selectOption('#model',model);await page.waitForFunction(m=>window.__readState().settings.model===m,model);assert.equal(await page.locator('#model').inputValue(),model);}
    });
    await test('No unhandled browser page errors',()=>assert.deepEqual(errors,[]));
  }catch(e){report.blocked=e.message;results.push({suite:'browser',name:'Browser suite startup/execution',status:'blocked',error:e.message});}
  finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));delete report.localOrigin;report.summary={passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,blocked:results.filter(x=>x.status==='blocked').length};fs.writeFileSync(path.join(__dirname,'ui-5.1.5.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.summary.failed||report.summary.blocked)process.exitCode=1;}
})();
