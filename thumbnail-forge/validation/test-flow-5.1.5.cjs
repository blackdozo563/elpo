/* Run: node validation/test-flow-5.1.5.cjs
 * Optional: CHROMIUM_EXECUTABLE=/path/to/chromium
 * Requires Playwright + Chromium. The only page is a local synthetic HTML
 * fixture, intercepted at https://flow.google.com/project/local. All other
 * network requests are blocked. Real DOM, canvas, keyboard and pointer events;
 * Chrome extension transport and Flow responses are simulated explicitly.
 * These cases reproduce a DOM-scope hypothesis from the supplied diagnostic,
 * not an authenticated or exact captured Google Flow DOM.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const root = path.resolve(__dirname, '..');
const url = 'https://flow.google.com/project/local';
const prompt = ('Create a cinematic YouTube thumbnail in landscape format. Preserve the exact reference composition and attach the channel logo without changing its lettering. Text A: LE GRAND DÉPART. Text B: TOUT COMMENCE ICI. Text C: ÉPISODE 01. Keep every character and accent legible. Use warm lighting, an uncluttered focal point, natural texture, high contrast, and generous margins. ').repeat(6);
const results = [];
const report = {
  version: '5.1.5', date: new Date().toISOString(),
  mode: 'Real Chromium; real extension scripts and upload bridge; mocked chrome.runtime transport and local synthetic Flow UI',
  limitations: [
    'Fixtures test a composer-scope hypothesis inferred from the supplied diagnostic; the exact authenticated Google Flow DOM was not available.',
    'No external Google API, account, credits, generation, extension installation, or native browser downloads were used.',
    'The suite cannot establish live Google Flow compatibility on its own.'
  ],
  fixturePromptLength: prompt.length, results
};
let browser;
const errors = [];
async function test(name, fn) {
  if(process.env.FORGE_CASE&&!name.includes(process.env.FORGE_CASE))return;
  const started = Date.now();
  try { await fn(); results.push({name, status: 'passed', durationMs: Date.now() - started}); }
  catch (error) { results.push({name, status: 'failed', durationMs: Date.now() - started, error: error.message}); }
  console.log(results.at(-1).status.toUpperCase() + ' ' + name);
}
function html(options) {
  const form = options.siblingForm ? 'form' : 'div';
  let editor = `<div id="editor" contenteditable="true" data-slate-editor="true" role="textbox" aria-label="Image prompt"></div>`;
  for (let i = 0; i < (options.deep ? 10 : 1); i++) editor = `<div class="editor-nest">${editor}</div>`;
  editor = `<${form} id="prompt-wrapper">${editor}</${form}>`;
  const composeTag = options.classic ? 'form' : 'section';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Local Flow regression fixture</title><style>
    * { box-sizing:border-box } body{margin:0;font:16px Arial;background:#eee} header{height:70px;padding:12px;display:flex;gap:10px} main{padding:15px;width:940px;margin:auto} button{min-height:40px;min-width:90px;padding:8px} #compose{background:white;padding:12px;width:900px;border:1px solid #999} #refs{display:flex;gap:12px;min-height:60px} #refs img{width:80px;height:45px;object-fit:contain} #editor{outline:1px solid #aaa;min-height:60px;padding:8px;white-space:pre-wrap;font-size:14px;line-height:20px} #compose.tall #editor{min-height:720px} #prompt-wrapper{margin:0} #toolbar{display:flex;justify-content:space-between;gap:12px;padding-top:12px} #toolbar .right{display:flex;gap:12px} #results{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px} #results article{width:400px;padding:6px} #results img{width:384px;height:216px} .material-symbols{display:inline-block;font-size:14px} button[disabled]{opacity:.6}
  </style></head><body>
    <header><button id="project" type="button" aria-label="Generate project">Generate project</button><button id="video" type="button" aria-label="Generate video">Generate video</button><button id="outside-send" type="button" aria-label="Generate video"><i class="material-symbols">arrow_forward</i> Generate video</button></header>
    <main><${composeTag} id="compose"><div id="refs"></div>${editor}<div id="toolbar">
      <button id="add" type="button" aria-label="Add image"><i class="material-symbols">add</i> Add image</button>
      <div class="right"><button id="settings" type="button" aria-label="Settings trigger" aria-haspopup="dialog"><i class="material-symbols">tune</i> 🍌 Nano Banana 2.1 <i class="material-symbols">crop_16_9</i> x4</button>
      <button id="send" type="button" aria-label="Générer" aria-haspopup="false" disabled><i class="material-symbols">arrow_forward</i></button>${options.ambiguous ? '<button id="send-other" type="button" aria-label="Générer" aria-haspopup="false" disabled><i class="material-symbols">arrow_forward</i></button>' : ''}</div></div></${composeTag}><div id="results"></div></main>
  </body></html>`;
}
function setupFixture(options) {
  window.__events = {send:0, otherSend:0, settings:0, project:0, video:0, outside:0, uploads:0, trustedClicks:[], sentPrompts:[], enableAt:null, sendAt:null};
  window.__messages = [];
  window.__listeners = [];
  window.__patches = [];
  window.__errors = [];
  const events = window.__events;
  function png(color, width=640, height=360) { const c=document.createElement('canvas'); c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,width,height);x.fillStyle='white';x.font='30px Arial';x.fillText(color,10,50);return c.toDataURL('image/png'); }
  window.__assets={reference:png('#304b63'),logo:png('#c04b63',128,64),outputs:['#963333','#339633','#333396','#963396'].map(c=>png(c))};
  const editor = document.getElementById('editor');
  const compose = document.getElementById('compose');
  const send = document.getElementById('send');
  const alternate = document.getElementById('send-other');
  function update() {
    const ready = editor.textContent.trim().length > 0 && document.querySelectorAll('#refs img').length === 2;
    if (options.grow && editor.textContent.length > 1000) compose.classList.add('tall');
    if (ready && options.enableDelay) {
      send.disabled=true; if (alternate) alternate.disabled=true;
      clearTimeout(window.__enableTimer);
      window.__enableTimer=setTimeout(()=>{send.disabled=false;if(alternate)alternate.disabled=false;events.enableAt=performance.now();},options.enableDelay);
    } else { send.disabled=!ready;if(alternate)alternate.disabled=!ready;if(ready)events.enableAt=performance.now(); }
  }
  async function addFile(file) {
    const reader = new FileReader();
    const src = await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
    const img = new Image();img.alt='Attached image';img.src=src;
    if(options.removable){const chip=document.createElement('div'),remove=document.createElement('button');chip.style='display:flex;align-items:center';remove.textContent='Remove ingredient cancel';remove.onclick=()=>{chip.remove();update();};chip.append(img,remove);document.getElementById('refs').append(chip);}else document.getElementById('refs').append(img);events.uploads++;update();
  }
  editor.addEventListener('paste',event=>{for (const file of Array.from(event.clipboardData?.files||[])) addFile(file);event.preventDefault();});
  editor.addEventListener('input',update);
  document.getElementById('prompt-wrapper').addEventListener('submit',event=>event.preventDefault());
  compose.addEventListener('submit',event=>event.preventDefault());
  for (const [id,key] of [['settings','settings'],['project','project'],['video','video'],['outside-send','outside']]) document.getElementById(id).addEventListener('click',()=>events[key]++);
  if(options.preferences){
    let count=1,model=options.initialModel||'Nano Banana 2.1';
    const trigger=document.getElementById('settings');
    const updateSummary=()=>{trigger.textContent='🍌 '+model+' crop_16_9 x'+count;};updateSummary();
    const panel=document.createElement('flow-prompt-box-settings');panel.dataset.flowSettingsPanel='';panel.style='display:none;position:fixed;z-index:50;left:280px;top:20px;width:600px;height:170px;background:#222;color:white';
    for(const text of ['Image','16:9','x1','x2','x3','x4']){const b=document.createElement('button');b.textContent=text;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(text==='Image'||text==='16:9'||text==='x1'));b.onclick=()=>{if(/^x/.test(text)){count=Number(text.slice(1));for(const x of panel.querySelectorAll('[role=radio]'))if(/^x/.test(x.textContent))x.setAttribute('aria-checked',String(x===b));updateSummary();}};panel.append(b);}
    const modelButton=document.createElement('button');modelButton.setAttribute('aria-label','Select model family');modelButton.textContent='🍌 '+model;modelButton.onclick=()=>{const menu=document.createElement('div');menu.setAttribute('role','menu');menu.style='position:fixed;z-index:60;left:400px;top:200px;background:#444';for(const name of ['Nano Banana Pro','Nano Banana 2 Lite','Nano Banana 2.1']){const option=document.createElement('button');option.setAttribute('role','menuitem');option.textContent='🍌 '+name;option.onclick=()=>{model=name;modelButton.textContent='🍌 '+name;updateSummary();menu.remove();};menu.append(option);}document.body.append(menu);};panel.append(modelButton);document.body.append(panel);if(options.uncloseable){panel.style.top='130px';panel.style.height='260px';panel.style.left='0';panel.style.width='100vw';}
    trigger.onclick=()=>{panel.style.display=panel.style.display==='none'?'block':'none';};
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('[role=menu]').forEach(m=>m.remove());});
    window.__settingsState=()=>({model,count,open:panel.style.display!=='none'});
  }
  if(options.home){
    history.replaceState({},'','/');document.querySelector('main').style.display='none';
    const create=document.createElement('button');create.textContent='New project';create.id='new-project';document.querySelector('header').append(create);
    create.onclick=()=>{events.newProject=(events.newProject||0)+1;setTimeout(()=>{history.pushState({},'','/project/local');document.querySelector('main').style.display='block';create.remove();},300);};
  }
  function submit(event, key) {
    events[key]++;events.sendAt=performance.now();events.trustedClicks.push(event.isTrusted);events.sentPrompts.push(editor.innerText);
    editor.textContent='';send.disabled=true;if(alternate)alternate.disabled=true;
    const progress=document.createElement('div');progress.setAttribute('role','progressbar');progress.textContent='Generating';progress.style.height='25px';document.getElementById('results').append(progress);
    setTimeout(()=>{progress.remove();for(const src of window.__assets.outputs){const card=document.createElement('article');card.dataset.generationId=crypto.randomUUID();const img=new Image();img.src=src;img.alt='Generated image';const btn=document.createElement('button');btn.textContent='Download';card.append(img,btn);document.getElementById('results').append(card);}},80);
  }
  send.addEventListener('click',event=>submit(event,'send'));
  if(alternate)alternate.addEventListener('click',event=>submit(event,'otherSend'));
  window.__prefill=async(text)=>{
    for(const src of [window.__assets.reference,window.__assets.logo]) {const img=new Image();img.alt='Attached image';img.src=src;document.getElementById('refs').append(img);await img.decode();}
    editor.textContent=text;update();
  };
  window.chrome={runtime:{lastError:null,onMessage:{addListener(fn){window.__listeners.push(fn);}},sendMessage(message, callback){
    window.__messages.push(structuredClone(message));
    if(message.type==='tf:flowProgress'){window.__patches.push(structuredClone(message.patch));if(options.changeProject&&message.patch.stage==='reference')history.pushState({},'','/project/foreign');}
    window.__transport(message).then(reply=>callback?.(reply)).catch(error=>{window.__errors.push(error.message);callback?.({ok:false,error:error.message});});
  }}};
  window.__dispatch=message=>new Promise(resolve=>{let done=false;for(const fn of window.__listeners)fn(message,{},reply=>{done=true;resolve(reply);});if(!done)resolve(null);});
  // Exact pre-fix scope algorithm, retained only as a regression witness.
  window.__legacyDiagnostic=()=>{
    const box=editor,buttons='button,[role="button"],[role="combobox"],select';
    const visible=el=>!!el.getClientRects().length&&el.getBoundingClientRect().width>3&&el.getBoundingClientRect().height>3;
    const label=el=>[el.getAttribute('aria-label'),el.getAttribute('title'),el.textContent].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
    const norm=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    let root;
    const form=box.closest('form');
    if(form&&form.getBoundingClientRect().height<innerHeight*.7)root=form;
    else {let el=box.parentElement,best=el;for(let i=0;el&&i<7;i++,el=el.parentElement){const r=el.getBoundingClientRect();if(el===document.body||r.height>innerHeight*.7)break;best=el;if([...el.querySelectorAll(buttons)].filter(visible).some(b=>/arrow_forward|^(generate|generer|creer|send|envoyer)(?:\s|$)/.test(norm(label(b))))){best=el;break;}}root=best;}
    return {prompt:true,promptType:box.tagName,composer:!!root,controls:[...root.querySelectorAll(buttons)].filter(visible).map(label),attachmentCount:root.querySelectorAll('img').length,generate:!!root.querySelector('#send'),settingsControl:root.querySelector('#settings')?label(root.querySelector('#settings')):null,modelControl:label(document.getElementById('settings')),rootId:root.id,composeHeight:compose.getBoundingClientRect().height,viewportHeight:innerHeight};
  };
}
async function fixture(options={}) {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const blocked=[];
  await context.route('**/*', async route=>{
    if(route.request().url()===url && route.request().isNavigationRequest())return route.fulfill({status:200,contentType:'text/html',body:html(options)});
    blocked.push(route.request().url());await route.abort();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('__transport',async message=>{
    if(message.type==='tf:cdpClick'){await page.mouse.click(message.x,message.y,{button:message.button||'left'});return {ok:true};}
    if(message.type==='tf:cdpKey'){
      if(message.key.code==='KeyA')await page.keyboard.press('Control+A');
      else if(message.key.key==='Escape')await page.keyboard.press('Escape');
      else throw new Error('Unimplemented fixture key');
      return {ok:true};
    }
    if(message.type==='tf:cdpType'){await page.keyboard.insertText(message.text);return {ok:true};}
    if(message.type==='tf:flowProgress'&&message.patch.stage==='submitting'&&options.failCheckpoint)return {ok:false,error:'Synthetic persistence failure'};
    return {ok:true};
  });
  await page.goto(url);
  await page.evaluate(setupFixture,options);
  for(const file of ['shared.js','flow-bridge.js','flow.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,'src',file),'utf8')});
  return {page,context,blocked,close:()=>context.close()};
}
async function diagnose(page){return (await page.evaluate(()=>window.__dispatch({type:'tf:flowDiagnose'}))).diagnostic;}
async function jobFor(page,id){return page.evaluate(({id,prompt})=>({id,prompt,reference:{src:window.__assets.reference,name:'reference.png'},logo:{src:window.__assets.logo,name:'logo.png'},settings:{aspect:'16:9',outputs:4}}),{id,prompt});}
async function start(page,job){return page.evaluate(job=>window.__dispatch({type:'tf:flowStart',job}),job);}
async function complete(page,timeout=22000){
  await page.waitForFunction(()=>window.__patches.some(p=>['done','error','uncertain','cancelled'].includes(p.status)),null,{timeout});
  await page.waitForFunction(async()=>!(await window.__dispatch({type:'tf:flowPing'})).jobId,null,{timeout:5000});
  return page.evaluate(()=>({patch:window.__patches.at(-1),patches:window.__patches,events:window.__events,messages:window.__messages,errors:window.__errors}));
}
function assertSuccess(done){
  assert.equal(done.patch.status,'done',JSON.stringify(done.patch));assert.equal(done.patch.results.length,4);
  assert.equal(done.events.send,1);assert.equal(done.events.otherSend,0);assert.equal(done.events.uploads,2);
  assert.equal(done.events.settings+done.events.project+done.events.video+done.events.outside,0);
  assert.deepEqual(done.events.trustedClicks,[true]);assert.equal(done.events.sentPrompts[0].replace(/\s+/g,' ').trim(),prompt.trim());
  assert.deepEqual(done.errors,[]);assert.ok(done.patch.results.every(r=>r.dataUrl.startsWith('data:image/png;base64,')));
}
(async()=>{
  try{
    const executablePath=process.env.CHROMIUM_EXECUTABLE||process.env.CHROMIUM_PATH;
    browser=await playwright.chromium.launch({headless:true,...(executablePath?{executablePath}:{})});report.browser=browser.version();
    await test('Cold diagnostic: tall prompt loses old scope; new resolver accepts aria-haspopup=false, excludes Save/Cancel submits and finds two references',async()=>{
      const f=await fixture({grow:true});try{
        await f.page.evaluate(text=>window.__prefill(text),prompt);
        const old=await f.page.evaluate(()=>window.__legacyDiagnostic());
        assert.ok(old.composeHeight>old.viewportHeight*.7);assert.deepEqual(old.controls,[]);assert.equal(old.generate,false);assert.equal(old.settingsControl,null);assert.equal(old.attachmentCount,0);assert.ok(old.modelControl.includes('Nano Banana 2.1'));
        await f.page.locator('#toolbar').evaluate(toolbar=>{for(const label of ['Save','Cancel']){const b=document.createElement('button');b.type='submit';b.textContent=label;toolbar.append(b);}});
        const d=await diagnose(f.page);assert.equal(d.generateCandidates.length,1);assert.equal(d.promptType,'DIV');assert.equal(d.generate,true);assert.equal(d.generateEnabled,true);assert.equal(d.attachmentCount,2);assert.equal(d.addImage,true);assert.ok(d.settingsControl.includes('Nano Banana 2.1'));for(const v of Object.values(d.settings))assert.equal(v.verified,true);assert.ok(d.controls.length>=3);
        report.coldDiagnostic={old,new:d};assert.deepEqual(f.blocked,[]);
      }finally{await f.close();}
    });
    await test('Cold diagnostic: text-only form does not hide sibling generation/settings/reference controls',async()=>{
      const f=await fixture({siblingForm:true});try{
        await f.page.evaluate(()=>window.__prefill('A short prefilled image prompt'));
        const old=await f.page.evaluate(()=>window.__legacyDiagnostic());assert.equal(old.rootId,'prompt-wrapper');assert.equal(old.generate,false);assert.equal(old.attachmentCount,0);
        const d=await diagnose(f.page);assert.equal(d.generate,true);assert.equal(d.attachmentCount,2);assert.equal(d.settings.mode.verified,true);
      }finally{await f.close();}
    });
    await test('Cold diagnostic: ten nested prompt wrappers do not hide generation controls',async()=>{
      const f=await fixture({deep:true});try{
        await f.page.evaluate(()=>window.__prefill('Deeply nested prompt'));
        const old=await f.page.evaluate(()=>window.__legacyDiagnostic());assert.equal(old.generate,false);
        const d=await diagnose(f.page);assert.equal(d.generate,true);assert.equal(d.attachmentCount,2);assert.ok(d.controls.length>=3);
      }finally{await f.close();}
    });
    await test('Full pipeline: reference + logo + long prompt resizes composer; one trusted Generate click, four outputs, no decoy/settings clicks',async()=>{
      const f=await fixture({grow:true,siblingForm:true,deep:true});try{
        const job=await jobFor(f.page,'grow-success');assert.equal((await start(f.page,job)).accepted,true);
        const done=await complete(f.page);assertSuccess(done);report.fullPipelineStages=done.patches.map(p=>p.stage);
        const metrics=await f.page.evaluate(()=>({height:document.getElementById('compose').getBoundingClientRect().height,viewport:innerHeight}));assert.ok(metrics.height>metrics.viewport*.7);
        assert.deepEqual(f.blocked,[]);
      }finally{await f.close();}
    });
    await test('Classic compact form keeps the previous full generation path working',async()=>{
      const f=await fixture({classic:true});try{await start(f.page,await jobFor(f.page,'classic'));assertSuccess(await complete(f.page));}finally{await f.close();}
    });
    await test('Generate remains disabled until async enable; controller waits and clicks once after enable',async()=>{
      const f=await fixture({grow:true,enableDelay:1700});try{
        await start(f.page,await jobFor(f.page,'delayed'));const done=await complete(f.page);assertSuccess(done);assert.ok(done.events.sendAt>=done.events.enableAt);
      }finally{await f.close();}
    });
    await test('Persistence checkpoint failure prevents generation entirely',async()=>{
      const f=await fixture({grow:true,failCheckpoint:true});try{
        await start(f.page,await jobFor(f.page,'checkpoint'));const done=await complete(f.page);assert.equal(done.patch.status,'error');assert.equal(done.patch.error.code,'CHECKPOINT_FAILED');assert.equal(done.events.send,0);assert.equal(done.events.otherSend,0);assert.equal(done.events.settings+done.events.project+done.events.video+done.events.outside,0);
      }finally{await f.close();}
    });
    await test('Duplicate same job during run and after completion never causes a second submission',async()=>{
      const f=await fixture({grow:true});try{
        const job=await jobFor(f.page,'duplicate');await start(f.page,job);assert.equal((await start(f.page,job)).duplicate,true);assertSuccess(await complete(f.page));const reply=await start(f.page,job);assert.equal(reply.duplicate,true);assert.equal(reply.finished,true);assert.equal(await f.page.evaluate(()=>window.__events.send),1);
      }finally{await f.close();}
    });
    await test('Two equally valid Generate buttons are treated as ambiguous; no paid-action click',async()=>{
      const f=await fixture({grow:true,ambiguous:true});try{
        await start(f.page,await jobFor(f.page,'ambiguous'));const done=await complete(f.page,30000);assert.equal(done.patch.status,'error');assert.equal(done.events.send+done.events.otherSend,0);assert.equal(done.events.settings+done.events.project+done.events.video+done.events.outside,0);assert.ok(/GENERATE|AMBIGU|CONTROL/.test(done.patch.error.code));
        report.ambiguousError={code:done.patch.error.code,message:done.patch.error.message};
      }finally{await f.close();}
    });
    await test('Home page creates exactly one first project, persists it before upload and completes',async()=>{
      const f=await fixture({home:true,preferences:true});try{await start(f.page,await jobFor(f.page,'home'));const done=await complete(f.page);assert.equal(done.patch.status,'done',JSON.stringify(done.patch));assert.equal(done.events.newProject,1);assert.equal(done.events.send,1);assert.ok(done.patches.some(p=>p.stage==='project-ready'));assert.equal(await f.page.evaluate(()=>window.__settingsState().open),false);}finally{await f.close();}
    });
    for(const model of ['Nano Banana Pro','Nano Banana 2 Lite','Nano Banana 2.1'])await test('Material preferences close without Escape; exact model '+model,async()=>{
      const f=await fixture({preferences:true,initialModel:model==='Nano Banana 2.1'?'Nano Banana 2 Lite':'Nano Banana 2.1'});try{const job=await jobFor(f.page,'model-'+model);job.settings.model=model;await start(f.page,job);const done=await complete(f.page);assert.equal(done.patch.status,'done',JSON.stringify(done.patch));assert.equal(done.events.send,1);assert.equal(done.events.uploads,2);assert.deepEqual(await f.page.evaluate(()=>window.__settingsState()),{model,count:4,open:false});}finally{await f.close();}
    });
    await test('An entirely covered settings toggle stops before prompt, imports and generation',async()=>{
      const f=await fixture({preferences:true,uncloseable:true});try{await start(f.page,await jobFor(f.page,'covered'));const done=await complete(f.page);assert.equal(done.patch.error.code,'CONTROL_OBSCURED');assert.equal(done.events.send,0);assert.equal(done.events.uploads,0);}finally{await f.close();}
    });
    await test('Owned interrupted draft resumes without importing references twice',async()=>{
      const f=await fixture();try{await f.page.evaluate(()=>window.__prefill(''));const job=await jobFor(f.page,'resume');job.resumeDraft=await f.page.evaluate(()=>({projectUrl:location.origin+location.pathname,prompt:'',attachmentKeys:[...document.querySelectorAll('#refs img')].map(i=>i.src)}));await start(f.page,job);const done=await complete(f.page);assert.equal(done.patch.status,'done',JSON.stringify(done.patch));assert.equal(done.events.uploads,0);assert.equal(done.events.send,1);}finally{await f.close();}
    });
    await test('A second generation in the same project replaces only the prior owned reference chips',async()=>{
      const f=await fixture({removable:true});try{
        await start(f.page,await jobFor(f.page,'first'));const first=await complete(f.page);assert.equal(first.patch.status,'done');
        const job=await jobFor(f.page,'second');job.ownedDraft={...first.patches.find(p=>p.draftSnapshot?.prompt).draftSnapshot,completed:true};
        await f.page.evaluate(()=>{window.__patches=[];window.__assets.outputs=window.__assets.outputs.map((src,i)=>{const c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d');x.fillStyle=['#442211','#114422','#221144','#442244'][i];x.fillRect(0,0,640,360);return c.toDataURL('image/png');});});await start(f.page,job);const done=await complete(f.page);assert.equal(done.patch.status,'done',JSON.stringify(done.patch));assert.equal(done.events.send,2);assert.equal(done.events.uploads,4);assert.equal(await f.page.locator('#refs img').count(),2);assert.equal(done.events.project,0);
      }finally{await f.close();}
    });
    await test('An unrelated user draft is never overwritten or submitted',async()=>{
      const f=await fixture();try{await f.page.evaluate(()=>window.__prefill('My unrelated draft'));await start(f.page,await jobFor(f.page,'foreign'));const done=await complete(f.page);assert.equal(done.patch.error.code,'COMPOSER_NOT_EMPTY');assert.equal(done.events.send,0);assert.equal(done.events.uploads,0);assert.equal(await f.page.locator('#editor').innerText(),'My unrelated draft');}finally{await f.close();}
    });
    await test('Changing project during preparation stops before import or generation',async()=>{
      const f=await fixture({changeProject:true});try{await start(f.page,await jobFor(f.page,'project-change'));const done=await complete(f.page);assert.equal(done.patch.error.code,'PROJECT_CHANGED');assert.equal(done.events.send,0);assert.equal(done.events.uploads,0);}finally{await f.close();}
    });
    await test('No unhandled browser errors',async()=>assert.deepEqual(errors,[]));
  }catch(error){results.push({name:'Suite startup/execution',status:'blocked',error:error.message});}
  finally{
    if(browser)await browser.close();
    report.summary={passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,blocked:results.filter(r=>r.status==='blocked').length};
    fs.writeFileSync(path.join(__dirname,'flow-5.1.5.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report.summary));if(report.summary.failed||report.summary.blocked)process.exitCode=1;
  }
})();
