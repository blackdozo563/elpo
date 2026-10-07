/* Local regression checks. Run: node validation/test-shared.cjs */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
function runShared() {
  const scope = { URL, crypto: require('node:crypto').webcrypto };
  scope.self = scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/shared.js'), 'utf8'), scope);
  const TF = scope.TF, results=[];
  function test(name, fn) { try { fn(); results.push({name,status:'passed'}); } catch(e) { results.push({name,status:'failed',error:e.message}); } }
  const plain=x=>JSON.parse(JSON.stringify(x));
  test('V5 migration preserves references, exact text, stored logo and custom prompt',()=>{
    const migrated=TF.normalizeState({v:5,thumbs:[{id:'ref',src:'data:image/png;base64,AAAA'}],activeId:'ref',logo:{src:'logo',name:'chaîne.png'},zones:{a:'ÉTÉ 100% !',b:'',c:'ÇA'},settings:{oneShotPrompt:'Mon prompt {{A}}'},history:[{id:'old',status:'done'}]});
    assert.equal(migrated.activeId,'ref'); assert.equal(migrated.logo.name,'chaîne.png'); assert.equal(migrated.zones.a,'ÉTÉ 100% !'); assert.equal(migrated.settings.oneShotPrompt,'Mon prompt {{A}}'); assert.equal(migrated.settings.autoDownload,true); assert.equal(migrated.settings.logoMode,'flow'); assert.equal(migrated.generationCounter,0); assert.equal(migrated.history[0].id,'old');
  });
  test('Generation counter recovers maximum persisted job or history number',()=>{
    assert.equal(TF.normalizeState({generationCounter:3,job:{generationNumber:8},history:[{generationNumber:12},{generationNumber:-1},{generationNumber:Infinity}]}).generationCounter,12);
    assert.equal(TF.normalizeState({generationCounter:-5,history:[{generationNumber:NaN}]}).generationCounter,0);
    assert.equal(TF.normalizeState({generationCounter:22,job:{generationNumber:8}}).generationCounter,22);
  });
  test('Export settings normalize filenames and clamp size/position/mode',()=>{
    const s=TF.exportSettings({filePrefix:'../Ma chaîne/À test:*?',logoSize:100,logoPosition:'center',logoMode:'bad',autoDownload:false,logoEnabled:false});
    assert.equal(s.filePrefix,'Ma_chaîne_À_test'); assert.equal(s.logoSize,30); assert.equal(s.logoPosition,'top-right'); assert.equal(s.logoMode,'flow'); assert.equal(s.autoDownload,false); assert.equal(s.logoEnabled,false);
    assert.equal(TF.exportSettings({filePrefix:'!!!',logoSize:1}).filePrefix,'miniature'); assert.equal(TF.exportSettings({logoSize:1}).logoSize,5);
  });
  test('Export filenames sort by generation then output and retain snapshot prefix',()=>{
    const j={generationNumber:27,exportSettings:{filePrefix:'Ma chaîne'}};
    assert.equal(TF.exportFilename(j,0),'0027_01_Ma_chaîne.png'); assert.equal(TF.exportFilename(j,3),'0027_04_Ma_chaîne.png');
    assert.equal(TF.exportFilename({generationNumber:10001,exportSettings:{filePrefix:'x'}},9),'10001_10_x.png');
    assert.equal(TF.exportFilename(null,-1,'exe'),'0000_01_miniature.png');
    assert.ok(TF.exportFilename({generationNumber:9},3)<TF.exportFilename({generationNumber:10},0));
  });
  test('Logo rectangle respects aspect ratio and safe corners on landscape/portrait/square',()=>{
    for(const [width,height] of [[1280,720],[720,1280],[1080,1080],[16,16]]) for(const [lw,lh] of [[200,100],[100,400],[400,100]]) for(const position of Object.keys(TF.LOGO_POSITIONS)) {
      const r=TF.logoRect(width,height,lw,lh,{logoSize:30,logoPosition:position});
      assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height,JSON.stringify(r));
      assert.ok(Math.abs(r.w-lw/lh*r.h)<=Math.max(1,lw/lh),'ratio rounding');
      assert.ok(r.h<=height*0.3+1); assert.ok(r.w<=width*0.3+1);
      if(position.endsWith('right')) assert.ok(r.x>=width/2); else assert.ok(r.x<width/2);
      if(position.startsWith('bottom')) assert.ok(r.y>=height/2); else assert.ok(r.y<height/2);
    }
    assert.throws(()=>TF.logoRect(0,1,1,1,{}));
  });
  test('Only enabled Flow mode attaches uploaded logo',()=>{
    const logo={src:'real-logo'};
    assert.equal(TF.logoForFlow({logoEnabled:true,logoMode:'flow'},logo),logo);
    assert.equal(TF.logoForFlow({logoEnabled:false,logoMode:'flow'},logo),null);
    assert.equal(TF.logoForFlow({logoEnabled:true,logoMode:'overlay'},logo),null);
    assert.equal(TF.logoForFlow({},null),null);
  });
  test('Prompt retains exact zones with enabled Flow logo',()=>{
    const prompt=TF.buildOneShotPrompt({logoEnabled:true,logoMode:'flow',logoPosition:'bottom-left',logoSize:15},{a:'ÉTÉ « OUI » !',b:'POUR 5 €',c:'ÇA'},{logo:{src:'logo'}});
    assert.ok(prompt.includes('ÉTÉ « OUI » !')); assert.ok(prompt.includes('POUR 5 €')); assert.ok(prompt.includes('SECOND attached image')); assert.ok(prompt.includes('bottom left')); assert.ok(prompt.includes('15%'));
  });
  test('Overlay prompt reserves logo area and never attaches/invents brand',()=>{
    const prompt=TF.buildOneShotPrompt({logoEnabled:true,logoMode:'overlay',logoPosition:'top-left'}, {a:'EXACT !'}, {logo:{src:'logo'}});
    assert.ok(prompt.includes('overlaid locally')); assert.ok(prompt.includes('top left')); assert.ok(!prompt.includes('SECOND attached image')); assert.ok(prompt.includes('EXACT !'));
  });
  test('Disabled or absent logo does not request a brand mark',()=>{
    for(const [settings,logo] of [[{logoEnabled:false},{src:'logo'}],[{logoEnabled:true},null]]) {
      const prompt=TF.buildOneShotPrompt(settings,{}, {logo});
      assert.ok(prompt.includes('No logo is attached')); assert.ok(prompt.includes('render NO text')); assert.ok(!prompt.includes('SECOND attached image'));
    }
  });
  test('Custom prompt without placeholders receives text/brief/logo safeguards',()=>{
    const prompt=TF.buildOneShotPrompt({oneShotPrompt:'PERSONNALISÉ {{A}}',brief:'Un train',logoMode:'overlay'}, {a:'ÇA MARCHE',b:'',c:''},{logo:{src:'logo'}});
    assert.ok(prompt.startsWith('PERSONNALISÉ ÇA MARCHE')); assert.ok(prompt.includes('VIDEO CONCEPT')); assert.ok(prompt.includes('Un train')); assert.ok(prompt.includes('Render ONLY these exact strings')); assert.ok(prompt.includes('overlaid locally'));
    assert.equal((prompt.match(/ZONE B/g)||[]).length,0);
  });
  test('Flow project identity survives trailing slash, editor subroutes and SPA query/hash changes',()=>{
    const id='p_123-ABC';
    for(const url of [
      'https://flow.google.com/project/'+id,
      'https://flow.google.com/project/'+id+'/',
      'https://flow.google.com/project/'+id+'/images/image-1?view=detail#canvas',
      'https://flow.google/project/'+id+'/edit',
      'https://labs.google/fx/tools/flow/project/'+id,
      'https://labs.google/fx/fr/tools/flow/project/'+id+'/images/image-2'
    ]) assert.equal(TF.flowProjectId(url),id,url);
    assert.notEqual(TF.flowProjectId('https://flow.google.com/project/first'),TF.flowProjectId('https://flow.google.com/project/second'));
    assert.notEqual(TF.flowProjectId('https://flow.google.com/project/ABC'),TF.flowProjectId('https://flow.google.com/project/abc'));
  });
  test('Flow project identity rejects home routes, foreign hosts, credentials and malformed IDs',()=>{
    for(const url of [
      undefined,'','not a URL','https://flow.google.com/','https://labs.google/fx/tools/flow/',
      'https://foreign.invalid/project/legit','https://flow.google.com.evil.invalid/project/legit',
      'http://flow.google.com/project/legit','https://labs.google/project/legit',
      'https://user:secret@flow.google.com/project/legit','https://flow.google.com/project/',
      'https://flow.google.com/project/has%20space','https://flow.google.com/projects/not-singular',
      'https://flow.google.com/project/'+'x'.repeat(161)
    ]) assert.equal(TF.flowProjectId(url),null,String(url));
  });
  test('Current image models preserve Lite and Pro, migrate the old default and retain the shared project',()=>{
    for(const model of ['Nano Banana Pro','Nano Banana 2 Lite','Nano Banana 2.1'])assert.equal(TF.normalizeState({settings:{model}}).settings.model,model);
    assert.equal(TF.normalizeState({settings:{model:'Nano Banana 2'}}).settings.model,'Nano Banana 2.1');
    assert.equal(TF.normalizeState({flowProjectUrl:'https://flow.google.com/project/shared'}).flowProjectUrl,'https://flow.google.com/project/shared');
    assert.equal(TF.normalizeState({flowProjectUrl:'https://evil.example/project/shared'}).flowProjectUrl,null);
  });
  return results;
}
module.exports={runShared};
if(require.main===module){const results=runShared(); console.log(JSON.stringify({suite:'shared',results},null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;}
