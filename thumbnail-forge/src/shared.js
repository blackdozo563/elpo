/* Thumbnail Forge 5 — local data and prompt contract. No remote code. */
(function(root){
'use strict';
const TF={VERSION:'5.1.5',SCHEMA:5,STATE_KEY:'tf_state',MAX_THUMBS:20};
TF.ASPECTS={'16:9':{w:1280,h:720,label:'16:9 · YouTube'},'9:16':{w:720,h:1280,label:'9:16 · Shorts'},'1:1':{w:1080,h:1080,label:'1:1 · Carré'}};
TF.DEFAULT_ONESHOT_PROMPT=`You are an expert YouTube thumbnail art director.
The FIRST attached image is a STYLE REFERENCE ONLY. Learn its art direction, palette, lighting, contrast, texture, depth and general typographic energy.
Copy NONE of its characters, faces, poses, clothing, objects, backgrounds, words, logos, watermarks, exact framing or exact composition. Build original visual content from the user's concept and text below.

Create ONE complete original thumbnail per output, never a collage, contact sheet or four-panel grid. Each of the four separate outputs should explore a different original composition while retaining the same concept, exact text and visual style.
Output {{ASPECT}} (approximately {{W}} × {{H}} px or higher-resolution equivalent), edge to edge, no borders or letterboxing. Keep safe margins. One dominant subject, a clear emotional idea, strong contrast, cinematic separation and mobile readability at 160 × 90 px.

{{BRIEF}}
{{ZONES}}
{{LOGO}}

Generate the image immediately. No commentary, no analysis, no questions. Do not reply STYLE STORED. Silently check exact spelling and ensure the content is new.`;
TF.IMAGE_MODELS=['Nano Banana Pro','Nano Banana 2 Lite','Nano Banana 2.1'];
TF.normalizeModel=name=>TF.IMAGE_MODELS.includes(name)?name:'Nano Banana 2.1';
TF.DEFAULT_SETTINGS={flowUrl:'https://flow.google.com/',aspect:'16:9',brief:'',model:'Nano Banana 2.1',outputs:4,oneShotPrompt:TF.DEFAULT_ONESHOT_PROMPT,selectors:{},autoDownload:true,filePrefix:'miniature',logoEnabled:true,logoMode:'flow',logoPosition:'top-right',logoSize:12};
TF.DEFAULT_STATE={v:5,thumbs:[],activeId:null,logo:null,zones:{a:'',b:'',c:''},settings:TF.DEFAULT_SETTINGS,generationCounter:0,job:null,history:[]};
TF.uid=()=> 'tf_'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'_'+Math.random().toString(36).slice(2));
TF.clamp=(s,n)=>String(s??'').slice(0,n);
TF.isFlowURL=raw=>{try{const u=new URL(raw);return u.protocol==='https:'&&((u.hostname==='labs.google'&&/^\/fx\/(?:[a-z-]+\/)?tools\/flow(?:\/|$)/i.test(u.pathname))||['flow.google','flow.google.com'].includes(u.hostname));}catch{return false;}};
// Flow changes its route with history.pushState. Project identity is stable
// across the editor, image detail views and a trailing slash.
TF.flowProjectId=raw=>{try{if(!TF.isFlowURL(raw))return null;const u=new URL(raw);if(u.username||u.password)return null;return u.pathname.match(/(?:^|\/)project\/([A-Za-z0-9_-]{1,160})(?:\/|$)/)?.[1]||null;}catch{return null;}};
TF.extractVideoId=raw=>{const v=String(raw||'').trim(),valid=s=>/^[\w-]{11}$/.test(s||'')?s:null;if(valid(v))return v;try{const u=new URL(v),h=u.hostname.toLowerCase();if(!['https:','http:'].includes(u.protocol))return null;if(h==='youtu.be')return valid(u.pathname.split('/')[1]);if(h==='youtube.com'||h.endsWith('.youtube.com')){if(u.searchParams.has('v'))return valid(u.searchParams.get('v'));const p=u.pathname.split('/').filter(Boolean);if(['shorts','embed','live','v'].includes(p[0]))return valid(p[1]);}if(['i.ytimg.com','i9.ytimg.com','img.youtube.com'].includes(h)){const p=u.pathname.split('/');if(['vi','vi_webp'].includes(p[1]))return valid(p[2]);}}catch{}return null;};
TF.thumbCandidates=id=>['maxresdefault','sddefault','hqdefault','mqdefault'].map((s,i)=>({url:`https://i.ytimg.com/vi/${id}/${s}.jpg`,min:[1000,560,400,200][i]}));
TF.fillTemplate=(t,m)=>String(t).replace(/\{\{(\w+)\}\}/g,(all,k)=>Object.hasOwn(m,k)?m[k]:all);
TF.zoneValue=s=>{s=TF.clamp(s,300).trim();return /^[\s\-–—_.·•]*$/.test(s)?'':s;};
TF.zonesBlock=z=>{const labels={a:'A (largest main headline)',b:'B (secondary supporting text)',c:'C (small accent or badge)'};const parts=Object.keys(labels).filter(k=>TF.zoneValue(z?.[k])).map(k=>`ZONE ${labels[k]}: ${JSON.stringify(TF.zoneValue(z[k]))}`);return parts.length?`Render ONLY these exact strings, once each. Preserve spelling, accents, capitalization, punctuation and language. Do not translate, rewrite or add words. Omit every empty zone. Never print zone labels.\n${parts.join('\n')}`:'No text supplied: render NO text, letters, numerals or signage.';};
TF.LOGO_POSITIONS={'top-right':'top right','top-left':'top left','bottom-right':'bottom right','bottom-left':'bottom left'};
TF.exportSettings=settings=>{
 const s={...TF.DEFAULT_SETTINGS,...settings};
 return {autoDownload:s.autoDownload!==false,
  filePrefix:TF.clamp(s.filePrefix||'miniature',60).normalize('NFKC').replace(/[^\p{L}\p{N}_-]/gu,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'')||'miniature',
  logoEnabled:s.logoEnabled!==false,logoMode:s.logoMode==='overlay'?'overlay':'flow',
  logoPosition:Object.hasOwn(TF.LOGO_POSITIONS,s.logoPosition)?s.logoPosition:'top-right',
  logoSize:Math.max(5,Math.min(30,Number(s.logoSize)||12))};
};
TF.logoForFlow=(settings,logo)=>{const s=TF.exportSettings(settings);return s.logoEnabled&&s.logoMode==='flow'&&logo?.src?logo:null;};
TF.exportFilename=(job,index,extension='png')=>{
 const number=Number.isSafeInteger(job?.generationNumber)&&job.generationNumber>0?job.generationNumber:0;
 const output=Number.isInteger(index)&&index>=0?index+1:1;
 const ext=['png','jpg','webp'].includes(extension)?extension:'png';
 return String(number).padStart(4,'0')+'_'+String(output).padStart(2,'0')+'_'+TF.exportSettings(job?.exportSettings).filePrefix+'.'+ext;
};
TF.logoRect=(width,height,logoWidth,logoHeight,settings)=>{
 if(![width,height,logoWidth,logoHeight].every(v=>Number.isFinite(v)&&v>0))throw Error('Dimensions du logo invalides.');
 const s=TF.exportSettings(settings),margin=Math.max(1,Math.round(Math.min(width,height)*0.03));
 const scale=Math.min(width*s.logoSize/100/logoWidth,height*0.3/logoHeight,(width-2*margin)/logoWidth,(height-2*margin)/logoHeight);
 const w=Math.max(1,Math.round(logoWidth*scale)),h=Math.max(1,Math.round(logoHeight*scale));
 return {x:s.logoPosition.endsWith('right')?width-margin-w:margin,y:s.logoPosition.startsWith('bottom')?height-margin-h:margin,w,h};
};
TF.logoPrompt=(settings,logo)=>{
 const s=TF.exportSettings(settings),position=TF.LOGO_POSITIONS[s.logoPosition];
 if(!s.logoEnabled||!logo?.src)return 'No logo is attached. Do not invent or reproduce any logo, watermark, signature or channel mark.';
 if(s.logoMode==='overlay')return `No logo is attached. Do not draw or invent a logo, watermark or channel mark. A real logo will be overlaid locally after generation in the ${position} corner, at up to ${s.logoSize}% of image width and 30% of image height. Reserve a quiet area there with a 3% safe margin; keep subjects and text clear of that area.`;
 return `The SECOND attached image is the only brand logo. Preserve its exact appearance and proportions; place it in the ${position} corner, at approximately ${s.logoSize}% of image width (maximum 30% of image height), with a 3% safe margin, without covering the subject or text. Do not reproduce branding from the style reference.`;
};
TF.buildOneShotPrompt=(settings,zones,opts={})=>{const s={...TF.DEFAULT_SETTINGS,...settings},a=TF.ASPECTS[s.aspect]||TF.ASPECTS['16:9'];const map={A:TF.zoneValue(zones?.a),B:TF.zoneValue(zones?.b),C:TF.zoneValue(zones?.c),ASPECT:s.aspect,W:a.w,H:a.h,BRIEF:s.brief?.trim()?`VIDEO CONCEPT (not additional overlay text): ${s.brief.trim()}`:'Derive a new visual concept from the supplied text zones.',ZONES:TF.zonesBlock(zones),LOGO:TF.logoPrompt(s,opts.logo)};let out=TF.fillTemplate(s.oneShotPrompt||TF.DEFAULT_ONESHOT_PROMPT,map);
for(const k of ['BRIEF','ZONES','LOGO'])if(!(s.oneShotPrompt||TF.DEFAULT_ONESHOT_PROMPT).includes('{{'+k+'}}'))out+='\n\n'+map[k];return out.trim();};
TF.buildGenPrompt=TF.buildOneShotPrompt;TF.buildStylePrompt=()=>TF.DEFAULT_ONESHOT_PROMPT;
TF.normalizeState=raw=>{const r=raw&&typeof raw==='object'?raw:{},s={...TF.DEFAULT_SETTINGS,...r.settings};s.selectors={...(s.selectors||{})};Object.assign(s,TF.exportSettings(s));s.model=TF.normalizeModel(s.model);s.outputs=4;if(!TF.isFlowURL(s.flowUrl))s.flowUrl=TF.DEFAULT_SETTINGS.flowUrl;if(!TF.ASPECTS[s.aspect])s.aspect='16:9';s.brief=TF.clamp(s.brief,2000);const st={v:5,thumbs:Array.isArray(r.thumbs)?r.thumbs.filter(t=>t&&t.id&&typeof t.src==='string').slice(0,20):[],activeId:r.activeId||null,logo:r.logo?.src?r.logo:null,zones:{a:TF.clamp(r.zones?.a,300),b:TF.clamp(r.zones?.b,300),c:TF.clamp(r.zones?.c,300)},settings:s,generationCounter:Math.max(0,...[r.generationCounter,r.job?.generationNumber,...(Array.isArray(r.history)?r.history.map(h=>h?.generationNumber):[])].filter(n=>Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER)),flowCreationPending:r.flowCreationPending===true,flowProjectUrl:TF.flowProjectId(r.flowProjectUrl)?r.flowProjectUrl:r.job?.projectUrlVerified&&TF.flowProjectId(r.job.projectUrl)?r.job.projectUrl:null,job:r.job||null,history:Array.isArray(r.history)?r.history.slice(0,20):[]};if(!st.thumbs.some(t=>t.id===st.activeId))st.activeId=st.thumbs[0]?.id||null;return st;};
TF.ACTIVE_STATUSES=['opening','running','submitting','generating'];
TF.isActiveJob=j=>!!j&&TF.ACTIVE_STATUSES.includes(j.status);
root.TF=TF;
})(typeof self!=='undefined'?self:globalThis);
