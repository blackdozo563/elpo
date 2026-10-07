/* Thumbnail Forge 5 — verified DOM automation for Google Flow.
 * No API tokens, no private endpoints, no inference that dispatch == success.
 * Flow may change its DOM: every step has a bounded wait and an explicit stop.
 */
(() => {
  'use strict';
  if (window.__TF5_FLOW__) return;
  window.__TF5_FLOW__ = true;
  const HOST_OK = /^(labs\.google|flow\.google|flow\.google\.com)$/.test(location.hostname);
  const PATH_OK = location.hostname !== 'labs.google' || /\/flow(?:\/|$)/.test(location.pathname);
  if (!HOST_OK || !PATH_OK) return;
  const BUTTONS = 'button,[role="button"],[role="combobox"],select,input[type="submit"]';
  const OPTIONS = '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],button,[role="tab"],label';
  let current = null;
  let cancelRequested = false;
  let submitted = false;
  let badge;
  let lastDiagnostic = null;
  let progress = 0;
  let composerAnchor = null;
  const handledJobs = new Set();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const compact = text => String(text || '').replace(/\s+/g, ' ').trim();
  const norm = text => compact(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function error(code, message) { return Object.assign(new Error(message), { code }); }
  function check() { if (cancelRequested) throw error('CANCELLED', 'Automatisation arrêtée.');if(current?.projectId&&(TF.flowProjectId(location.href)!==current.projectId||location.origin!==current.projectOrigin))throw error('PROJECT_CHANGED','Le projet Flow a changé pendant la préparation. Aucun nouvel envoi.'); }
  function visible(el) {
    if (!el || !el.isConnected || el.closest('[data-tf5-ui]') || !el.getClientRects().length) return false;
    const style = getComputedStyle(el), r = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && r.width > 3 && r.height > 3;
  }
  function enabled(el) { return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true'; }
  function label(el) { return compact([el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ')); }
  function all(selector, root = document) { try { return [...root.querySelectorAll(selector)]; } catch { return []; } }
  function shown(selector, root = document) { return all(selector, root).filter(visible); }
  function override(name, aliases = []) {
    const selectors = current?.settings?.selectors || {};
    for (const key of [name, ...aliases]) if (selectors[key]) {
      let el; try { el = document.querySelector(selectors[key]); } catch { throw error('INVALID_SELECTOR', 'Sélecteur invalide : ' + key); }
      if (el && (name === 'fileInput' || visible(el))) return el;
    }
    return null;
  }
  function near(el, box = promptBox()) {
    if (!box) return 0;
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
    return Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2);
  }
  function promptBox() {
    const custom = override('prompt', ['input']);
    if (custom) return custom;
    const candidates = shown('[data-slate-editor="true"],textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"]')
      .filter(el => !el.closest('[role="dialog"]') && !/search|recherch|filter|filtr|rename|renommer|titre du projet/.test(norm(label(el) + ' ' + el.getAttribute('placeholder'))));
    const score = el => (el.matches('[data-slate-editor="true"]') ? 100 : 0) + (el.getBoundingClientRect().bottom / Math.max(1, innerHeight)) * 30 + Math.min(el.getBoundingClientRect().width / 30, 40);
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }
  const EXTERNAL_CONTROLS = 'header,nav,aside,[role="menu"],[role="listbox"],[role="dialog"],[data-generation-id],[data-testid*="generated"],[data-testid*="result"]';
  function controlNames(el) {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    return [el.getAttribute('aria-label'), el.getAttribute('title'), labelled, el.textContent, el.matches('input[type="submit"]') ? el.value : null].filter(Boolean).map(norm);
  }
  function toolbarControl(el) {
    return /settings trigger|^(?:settings|parametres|reglages|tune)(?:\s|$)/.test(norm(label(el))) || glyph(el, ['tune', 'settings']);
  }
  function generateScore(el) {
    const popup = el.getAttribute('aria-haspopup');
    if (!visible(el) || el.closest(EXTERNAL_CONTROLS) || (popup && popup !== 'false') || el.matches('select,[role="combobox"]')) return 0;
    const names = controlNames(el), combined = names.join(' ');
    if (/video|project|projet|download|telecharg|upload|import|settings|parametres|reglages|add to prompt|ajouter au prompt|cancel|annul|stop|arreter|save|enregistr|delete|supprim|remove|retirer/.test(combined)) return 0;
    const action = /^(?:start generation|generate(?: (?:an? )?images?)?|send|submit(?: prompt)?|generer(?: (?:une|des|les) images?)?|lancer(?: la generation)?|demarrer la generation|envoyer|creer(?: une image)?)(?:\s*(?:\([^)]*\)|[→↑]|arrow_forward|arrow_upward|send))*[.!…]?$/;
    if (names.some(name => action.test(name))) return 100;
    const testid = norm(el.getAttribute('data-testid'));
    if (/^(?:(?:generate|generation|send|submit)(?:-(?:button|prompt))?|(?:button|prompt)-(?:generate|send|submit))$/.test(testid)) return 90;
    if (glyph(el, ['arrow_forward', 'arrow_upward', 'send']) || names.some(n => /^(?:arrow_forward|arrow_upward|send)$/.test(n))) return 70;
    // type=submit alone is not enough: it could save/delete another form.
    return 0;
  }
  function composer() {
    const box = promptBox(); if (!box) { composerAnchor = null; return null; }
    const custom = override('composer'); if (custom?.contains(box)) return custom;
    const candidateControls = el => shown(BUTTONS, el).filter(b => !b.closest(EXTERNAL_CONTROLS));
    // Keep the verified panel when typing changes its height. Never use viewport
    // height as a boundary: a long Slate prompt can push the toolbar below it.
    if (composerAnchor?.isConnected && composerAnchor.contains(box)) {
      const controls = candidateControls(composerAnchor);
      if (controls.some(toolbarControl) && controls.some(b => generateScore(b))) return composerAnchor;
    }
    let el = box.parentElement, fallback = box.parentElement;
    for (let i = 0; el && i < 24; i++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      // Do not absorb the gallery or page chrome just to find a distant button.
      if (all('header,nav,aside,[data-generation-id],[data-testid*="generated"],[data-testid*="result"]', el).length) break;
      const otherEditor = shown('textarea,[contenteditable="true"]', el).some(other => other !== box && !box.contains(other) && !other.contains(box));
      if (otherEditor) break;
      const controls = candidateControls(el), hasToolbar = controls.some(toolbarControl);
      const hasSend = controls.some(b => generateScore(b) >= 70);
      const hasUpload = controls.some(b => /^(?:add|add_2|add_photo_alternate|attach_file|upload)(?:\s|$)|add image|add reference|ajouter.*image|importer/.test(norm(label(b)))) || all('input[type="file"]', el).length > 0;
      if (hasToolbar || hasSend || hasUpload) fallback = el;
      if (hasSend && (hasToolbar || hasUpload)) {
        composerAnchor = el; return el;
      }
    }
    return fallback;
  }
  function generateCandidates() {
    const root = composer(); if (!root) return [];
    return shown(BUTTONS, root).map(el => ({ el, score: generateScore(el) }))
      .filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score);
  }
  function sendButton() {
    const custom = override('generate', ['sendBtn']); if (custom) return custom;
    const candidates = generateCandidates();
    if (!candidates.length) return null;
    // Two equally plausible actions are not permission to click the nearest.
    if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
    return candidates[0].el;
  }
  async function message(type, extras = {}, timeout = 12000) {
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'Extension sans réponse.' }); } }, timeout);
      try {
        chrome.runtime.sendMessage({ type, ...extras }, response => {
          if (done) return; done = true; clearTimeout(timer);
          const failure = chrome.runtime.lastError;
          resolve(failure ? { ok: false, error: failure.message } : response || { ok: false, error: 'Réponse vide.' });
        });
      } catch (e) { done = true; clearTimeout(timer); resolve({ ok: false, error: e.message }); }
    });
  }
  function showBadge(text, status) {
    if (!badge) {
      const host = document.createElement('div'); host.dataset.tf5Ui = 'status';
      document.documentElement.append(host);
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = '<style>:host{all:initial}.box{position:fixed;right:20px;top:18px;z-index:2147483647;max-width:340px;padding:14px 16px;border:1px solid #364139;border-radius:15px;background:#13251eeF;color:#f4f8f5;box-shadow:0 12px 38px #0004;font:13px/1.5 system-ui;backdrop-filter:blur(12px)}b{display:block;color:#9beaaf;font-size:11px;letter-spacing:.12em;margin-bottom:5px}button{margin-top:8px;padding:6px 11px;background:#203a2c;border:1px solid #406b4c;border-radius:7px;color:white;cursor:pointer;font:12px system-ui}button:focus-visible{outline:2px solid #a5f6af}.error{border-color:#c38265}.hidden{display:none}</style><div class="box"><b>THUMBNAIL FORGE · FLOW</b><div class="text" role="status" aria-live="polite"></div><button type="button">Arrêter</button></div>';
      badge = { box: root.querySelector('.box'), text: root.querySelector('.text'), button: root.querySelector('button') };
      badge.button.addEventListener('click', () => { if (current) cancelRequested = true; else badge.box.classList.add('hidden'); });
    }
    badge.box.classList.remove('hidden');
    badge.box.classList.toggle('error', ['error', 'uncertain'].includes(status));
    badge.text.textContent = text;
    badge.button.textContent = ['done', 'error', 'uncertain', 'cancelled'].includes(status) ? 'Fermer' : 'Arrêter';
  }
  async function report(stage, text, value, extra = {}) {
    progress = value ?? progress;
    const patch = { status: 'running', stage, message: text, progress, updatedAt: Date.now(), ...extra };
    showBadge(text, patch.status);
    return message('tf:flowProgress', { jobId: current.id, pageUrl: location.href, patch });
  }
  async function until(fn, timeout = 6000, interval = 180) {
    const stop = Date.now() + timeout;
    do { check(); const result = await fn(); if (result) return result; await sleep(interval); } while (Date.now() < stop);
    return null;
  }
  async function click(el, button = 'left') {
    check();
    if (!visible(el) || !enabled(el)) throw error('CONTROL_UNAVAILABLE', 'Un contrôle Flow a disparu ou reste désactivé.');
    // The status badge must never block the page action it describes. Hide our
    // own overlay only; an actual Flow dialog still fails the hit-target check.
    if (badge) badge.box.style.visibility = 'hidden';
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await sleep(70);
      const r = el.getBoundingClientRect();
      const points=[[.5,.5],[.15,.5],[.85,.5],[.5,.15],[.5,.85],[.15,.15],[.85,.15],[.15,.85],[.85,.85]];
      let target=null;
      for(const [fx,fy] of points){const x=Math.max(1,Math.min(innerWidth-1,r.x+r.width*fx)),y=Math.max(1,Math.min(innerHeight-1,r.y+r.height*fy));const top=document.elementFromPoint(x,y);if(top&&(top===el||el.contains(top))){target={x,y};break;}}
      if(!target)throw error('CONTROL_OBSCURED','Un panneau recouvre entièrement le contrôle Flow. Aucun clic envoyé.');
      const {x,y}=target;
      const reply = await message('tf:cdpClick', { x, y, button });
      if (!reply.ok) throw error('TRUSTED_INPUT', 'Chrome ne peut pas piloter Flow : ' + (reply.error || 'fermez DevTools et rechargez l’extension.'));
    } finally { if (badge) badge.box.style.visibility = ''; }
  }
  function textOf(el) { return el ? compact('value' in el ? el.value : el.innerText || el.textContent) : ''; }
  async function fillPrompt(text) {
    const box = promptBox(); if (!box) throw error('NO_COMPOSER', 'Champ de prompt Flow introuvable.');
    await click(box);
    const key = await message('tf:cdpKey', { key: { key: 'a', code: 'KeyA', keyCode: 65, modifiers: /Mac/.test(navigator.platform) ? 4 : 2 } });
    if (!key.ok) throw error('PROMPT_FOCUS', 'La sélection du champ Flow a échoué.');
    const typed = await message('tf:cdpType', { text });
    if (!typed.ok) throw error('PROMPT_INPUT', 'Impossible de saisir le prompt : ' + typed.error);
    const verified = await until(() => textOf(promptBox()) === compact(text), 5500);
    if (!verified) throw error('PROMPT_MISMATCH', 'Flow n’a pas conservé le prompt complet. Génération bloquée pour ne pas perdre vos textes.');
    // Rerender stability prevents a transient DOM-only value from passing.
    await sleep(500);
    if (textOf(promptBox()) !== compact(text)) throw error('PROMPT_REJECTED', 'Flow a annulé la saisie du prompt.');
  }
  function glyph(el, names) { return all('i,[class*="symbol"],[class*="material"]', el).some(i => names.includes(compact(i.textContent))); }
  function selected(el) { return el.matches(':checked,[aria-selected="true"],[aria-checked="true"],[aria-pressed="true"],[data-state="checked"],[data-state="active"]') || !!el.querySelector('input:checked,[data-state="checked"]') || glyph(el, ['check', 'check_small', 'done']); }
  const settingPatterns = {
    mode: /^(?:image|images|create image|create images|creer une image|creer des images)(?:\s|$)/,
    model: /\bnano\s*banana\s*2\b/,
    aspect: /16\s*[:/]\s*9/,
    count: /(?:^|\s)(?:x\s*4|4\s*x|4\s+(?:outputs?|images?|results?|resultats?|sorties?))(?:\s|$)|^4$/
  };
  function wanted(kind, el) {
    const str = norm(label(el));
    if (kind === 'model') {const name=str.match(/nano\s*banana\s*(?:pro|2(?:\s*\.\s*1)?(?:\s+lite)?)/)?.[0];return !!name&&name.replace(/\s+/g,'')===norm(current?.settings?.model||TF.DEFAULT_SETTINGS.model).replace(/\s+/g,'');}
    if (kind === 'aspect') {
      const aspect = current?.settings?.aspect || '16:9';
      const token = { '16:9': 'crop_16_9', '9:16': 'crop_9_16', '1:1': 'crop_square' }[aspect];
      const explicitRatio = str.match(/\b(\d+)\s*[:/]\s*(\d+)\b/);
      if (explicitRatio) return explicitRatio[1] + ':' + explicitRatio[2] === aspect;
      return str.includes(aspect) || (token && new RegExp('(?:^|\\s)' + token + '(?:\\s|$)').test(str)) ||
        (aspect === '16:9' && /landscape|paysage/.test(str)) || (aspect === '1:1' && /(?:^|\s)(?:square|carre)(?:\s|$)/.test(str));
    }
    return settingPatterns[kind].test(str);
  }
  function settingName(kind) { return ({ mode: 'Image', model: current?.settings?.model || TF.DEFAULT_SETTINGS.model, aspect: current?.settings?.aspect || '16:9', count: '4 images' })[kind]; }
  function kindLabel(kind, el) {
    const s = norm(label(el));
    if (s.length > 220) return false;
    if (kind === 'mode') return /^(?:image|images|video|videos|text to video|frames to video|ingredients to video|create image|create images|creer une image|texte vers video|images vers video|mode)(?:\s|$)/.test(s);
    if (kind === 'model') return /nano\s*banana|imagen|veo\s*[\d.]|model|modele/.test(s);
    if (kind === 'aspect') return /\b(?:aspect|format|ratio|landscape|portrait|paysage|square|carre)\b|(?:^|\s)crop_\w+(?:\s|$)|\b(?:16:9|9:16|1:1|4:3|3:4)\b/.test(s);
    if (/outputs?|sorties?|results? per|resultats? par|number of|nombre|(?:^|\s)(?:x\s*[1-4]|[1-4]\s*x)(?:\s|$)/.test(s)) return true;
    // Flow sometimes shows a bare “1” below an “Outputs per prompt” label.
    const parent = el.parentElement;
    return /^[1-4]$/.test(s) && parent && label(parent).length < 160 && /outputs?|sorties?|results? per|resultats? par|nombre d.images/.test(norm(label(parent)));
  }
  function settingTrigger(kind) {
    const custom = override(kind, [kind + 'Button']); if (custom) return custom;
    const candidates = shown(BUTTONS).filter(el => {
      if (el.matches('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="tab"]')) return false;
      const popup = el.closest('[role="menu"],[role="listbox"],[role="radiogroup"]');
      if (popup && !el.matches('select,[role="combobox"],[aria-haspopup]')) return false;
      return kindLabel(kind, el);
    });
    return candidates.sort((a, b) => near(a) - near(b))[0] || null;
  }
  // Flow's current toolbar combines family, ratio and output count in one
  // Settings trigger. A selected image-only family establishes image mode even
  // when there is no separate Image switch. Unselected menu options never do.
  function settingsSummary() {
    const root = composer(); if (!root) return null;
    return shown(BUTTONS, root).filter(el => !el.closest('[role="menu"],[role="listbox"],[role="radiogroup"]') &&
      !el.matches('[role="option"],[role="menuitem"],[role="radio"],[role="tab"]') &&
      (/settings trigger|^(?:settings|parametres|reglages|tune)(?:\s|$)/.test(norm(label(el))) || glyph(el, ['tune', 'settings'])))
      .sort((a, b) => near(a) - near(b))[0] || null;
  }
  function agentControl() {
    const root = composer();
    return root && shown('button,[role="switch"],[role="checkbox"]', root).find(el => /^(?:agent|use agent|utiliser l.agent)(?:\s+(?:on|off|active|desactive|enabled|disabled))?$/.test(norm(el.getAttribute('aria-label') || el.textContent)));
  }
  function agentEnabled() {
    const el = agentControl();
    if (!el) return false;
    return el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-state') === 'checked' || /agent\s+(?:on|active|enabled)$/.test(norm(label(el)));
  }
  async function ensureStandardMode() {
    if (!agentEnabled()) return;
    await click(agentControl());
    if (!(await until(() => {
      const el = agentControl();
      return el && (el.getAttribute('aria-pressed') === 'false' || el.getAttribute('aria-checked') === 'false' || el.getAttribute('data-state') === 'unchecked' || /agent\s+(?:off|desactive|disabled)$/.test(norm(label(el))));
    }, 2500))) throw error('AGENT_MODE_ACTIVE', 'Le mode Agent reste activé. Désactivez-le dans Flow pour utiliser directement Nano Banana 2.1. Aucun envoi effectué.');
  }
  function imageModeFromModel() {
    if (agentEnabled()) return false;
    const explicit = settingTrigger('mode');
    if (explicit && !wanted('mode', explicit)) return false;
    const root = composer(); if (!root) return false;
    const controls = [settingsSummary(), settingTrigger('model')].filter(Boolean);
    return controls.some(el => root.contains(el) && !el.closest('[role="menu"],[role="listbox"],[role="radiogroup"],[role="dialog"]') &&
      !el.matches('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="tab"]') && wanted('model', el));
  }
  function configured(kind) {
    if (kind === 'mode' && imageModeFromModel()) return true;
    const trigger = settingTrigger(kind);
    if (trigger?.tagName === 'SELECT') return wanted(kind, trigger.options[trigger.selectedIndex]);
    if (trigger && wanted(kind, trigger) && !trigger.matches('[role="tab"],[role="radio"]')) {
      // Toggle buttons inside preferences need a selected marker; a current
      // combobox value or top-level toolbar trigger is already a state display.
      if (!trigger.closest('[role="dialog"]') || trigger.matches('[role="combobox"],[aria-haspopup]') || selected(trigger)) return true;
    }
    return shown(OPTIONS).some(el => wanted(kind, el) && selected(el));
  }
  async function openSettings() {
    // Prefer the actual settings drawer, not its nested family/model dropdown.
    if (settingsPanels().length) return true;
    const button = override('settings') || settingsSummary();
    if (button) {
      if (button.getAttribute('aria-expanded') !== 'true') await click(button);
      await sleep(250); return true;
    }
    const model = settingTrigger('model');
    if (!model) return false;
    if (model.getAttribute('aria-expanded') !== 'true') await click(model);
    await sleep(250); return true;
  }
  function optionFor(kind) {
    const allOptions = shown(OPTIONS).filter(el => wanted(kind, el) && label(el).length < 140);
    // A bare “4” may be a project title: restrict it to an open choice panel.
    const safe = allOptions.filter(el => kind !== 'count' || !/^4$/.test(norm(label(el))) || el.closest('[role="menu"],[role="listbox"],[role="dialog"],[data-state="open"]'));
    return safe.sort((a, b) => Number(b.matches('[role="option"],[role="menuitemradio"],[role="radio"],[role="tab"]')) - Number(a.matches('[role="option"],[role="menuitemradio"],[role="radio"],[role="tab"]')) || label(a).length - label(b).length)[0] || null;
  }
  function settingEditor(kind) {
    // The toolbar opens preferences; the family dropdown INSIDE that panel
    // opens the actual model choices. They are different controls in new Flow.
    const summary = settingsSummary();
    const candidates = shown(BUTTONS).filter(el => el !== summary &&
      !el.matches('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],[role="tab"]') &&
      kindLabel(kind, el) && (el.closest('[role="menu"],[role="dialog"],[data-state="open"]') ||
        (kind === 'model' && /select model family|select model|selectionner.*modele|choisir.*modele/.test(norm(el.getAttribute('aria-label'))))));
    return candidates.sort((a, b) => Number(b.matches('select,[role="combobox"],[aria-haspopup]')) - Number(a.matches('select,[role="combobox"],[aria-haspopup]')))[0] || settingTrigger(kind);
  }
  async function setSetting(kind) {
    if (configured(kind)) return;
    let trigger = settingTrigger(kind), option;
    if (trigger?.tagName === 'SELECT') {
      const value = [...trigger.options].find(o => wanted(kind, o));
      if (!value) throw error('SETTING_UNAVAILABLE', 'Flow ne propose pas ' + settingName(kind) + '.');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(trigger, value.value);
      trigger.dispatchEvent(new Event('input', { bubbles: true })); trigger.dispatchEvent(new Event('change', { bubbles: true }));
      if (await until(() => configured(kind), 2000)) return;
    }
    // Flow's model button opens the Image / Video and preference panel.
    await openSettings();
    if (configured(kind)) return;
    option = optionFor(kind);
    if (!option) {
      trigger = settingEditor(kind);
      if (trigger && trigger.getAttribute('aria-expanded') !== 'true') { await click(trigger); await sleep(300); }
      option = await until(() => optionFor(kind), 2500);
    }
    if (!option) throw error('SETTING_NOT_FOUND', 'Réglage Flow introuvable : ' + settingName(kind) + '. Aucun lancement effectué. Consultez le diagnostic ou les sélecteurs avancés.');
    await click(option);
    if (!(await until(() => configured(kind), 3500))) throw error('SETTING_UNVERIFIED', 'La sélection « ' + settingName(kind) + ' » n’a pas été confirmée dans Flow.');
  }
  function settingsPanels() {
    return shown('flow-prompt-box-settings,.cdk-overlay-pane,[role="dialog"],[data-flow-settings-panel]').filter(el =>
      !el.closest('[data-tf5-ui]') && (el.matches('flow-prompt-box-settings,[data-flow-settings-panel]') ||
      shown(OPTIONS,el).some(o=>wanted('count',o)) && shown(OPTIONS,el).some(o=>wanted('aspect',o))));
  }
  async function closeMenus() {
    // Escape closes nested model menus; the Material settings drawer needs its toggle.
    for (let i = 0; i < 2 && shown('[role="menu"],[role="listbox"]').length; i++) {
      const r = await message('tf:cdpKey', { key: { key: 'Escape', code: 'Escape', keyCode: 27 } });
      if (!r.ok) break; await sleep(120);
    }
    if (settingsPanels().length) {
      const trigger=override('settings')||settingsSummary();
      if(!trigger)throw error('SETTINGS_NOT_CLOSED','Le panneau de réglages Flow est ouvert mais son bouton est introuvable. Aucun envoi.');
      await click(trigger);
      if(!(await until(()=>!settingsPanels().length,3000)))throw error('SETTINGS_NOT_CLOSED','Flow ne ferme pas son panneau de réglages. Aucun envoi.');
    }
    if(shown('[role="menu"],[role="listbox"]').length)throw error('SETTINGS_NOT_CLOSED','Un menu Flow reste ouvert. Aucun envoi.');
  }
  async function configure() {
    await report('configuration', 'Configuration Flow : Image · '+settingName('model')+' · 4 résultats…', 15);
    await ensureStandardMode();
    // Legacy switch where present; current Flow derives mode from its family.
    if (!settingTrigger('mode') && !configured('mode')) await setSetting('model');
    await setSetting('mode');
    await setSetting('model');
    await setSetting('aspect');
    await setSetting('count');
    await closeMenus();
  }
  function imageKey(src) {
    try { const u = new URL(src, location.href); for (const key of ['w', 'h', 'width', 'height', 'sz', 's', 'quality', 'q']) u.searchParams.delete(key); return u.href; } catch { return src; }
  }
  function imgSrc(img) { return img.currentSrc || img.src || ''; }
  function attachments() {
    const custom = current?.settings?.selectors?.attachment;
    const root = composer();
    return (custom ? shown(custom) : root ? shown('img', root) : []).filter(img => {
      const r = img.getBoundingClientRect();
      return img.tagName === 'IMG' && r.width >= 20 && r.height >= 20 && !/avatar|profile|profil|logo google/.test(norm(img.alt));
    });
  }
  function attachmentKeys() { return new Set(attachments().map(img => imageKey(imgSrc(img)))); }
  function uploading() {
    const root = composer();
    return !!root && (shown('[role="progressbar"],[aria-busy="true"]', root).length > 0 || /\buploading\b|importation en cours|televersement en cours/.test(norm(root.innerText)));
  }
  function bridge(op, image, target) {
    return new Promise(resolve => {
      const id = crypto.randomUUID(); const token = 'tf_' + crypto.randomUUID().replace(/-/g, '');
      if (target) target.setAttribute('data-tf5-target', token);
      const cleanup = () => { window.removeEventListener('message', handler); if (target?.getAttribute('data-tf5-target') === token) target.removeAttribute('data-tf5-target'); };
      const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: 'Adaptateur image indisponible.' }); }, 2500);
      function handler(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'TF5_UPLOAD_ACK' || event.data.id !== id) return;
        clearTimeout(timer); cleanup(); resolve(event.data);
      }
      window.addEventListener('message', handler);
      window.postMessage({ channel: 'TF5_UPLOAD', id, op, target: target ? token : null, dataUrl: image?.src, name: image?.name }, location.origin);
    });
  }
  function fileInput() {
    const custom = override('fileInput'); if (custom) return custom;
    const candidates = all('input[type="file"]').filter(el => !el.disabled && (!el.accept || /image|\.png|\.jpg|\.jpeg|\.webp/.test(el.accept)) && !el.closest('header,nav,[data-testid*="avatar"],[data-testid*="profile"]'));
    const root = composer();
    const local = candidates.find(el => root?.contains(el)); if (local) return local;
    const dialog = candidates.find(el => el.closest('[role="dialog"],[role="menu"]') && visible(el.closest('[role="dialog"],[role="menu"]')));
    if (dialog) return dialog;
    // An unlabelled global input is acceptable only when it is unambiguous.
    return candidates.length === 1 ? candidates[0] : null;
  }
  function addButton() {
    return override('addImage', ['addImageButton']) || shown(BUTTONS, composer() || document).filter(el => /^(?:add|add_2|add_photo_alternate|attach_file|upload)(?:\s|$)/.test(norm(label(el))) || /add image|add reference|ajouter.*image|ajouter.*reference|importer/.test(norm(label(el))) || glyph(el, ['add', 'add_2', 'add_photo_alternate', 'attach_file'])).sort((a, b) => near(a) - near(b))[0];
  }
  async function attachImage(image, role) {
    check();
    if (!image?.src || !/^data:image\/(png|jpeg|webp);base64,/.test(image.src)) throw error('REFERENCE_INVALID', 'Image de référence absente ou invalide.');
    const before = attachmentKeys(), mediaBefore = new Set(all('img').map(img => imageKey(imgSrc(img))));
    const freshAttachment = () => attachments().find(img => !before.has(imageKey(imgSrc(img))) && img.complete && img.naturalWidth >= 32 && !uploading());
    const confirm = async timeout => {
      const hit = await until(freshAttachment, timeout);
      if (!hit) return false;
      const key = imageKey(imgSrc(hit)); await sleep(650);
      return attachments().some(img => imageKey(imgSrc(img)) === key) && !uploading();
    };
    // A transfer ACK is intentionally ignored until a new composer preview exists.
    await bridge('paste', image, promptBox());
    if (await confirm(5500)) return;
    if (uploading()) {
      if (await confirm(30000)) return;
      throw error('UPLOAD_PENDING', 'Flow traite encore l’image. Relancez après la fin de l’import pour éviter un doublon.');
    }
    let fi = fileInput();
    if (fi) { await bridge('input', image, fi); if (await confirm(10000)) return; }
    else {
      const add = addButton();
      if (add) {
        await click(add); await sleep(350);
        fi = fileInput();
        if (fi) await bridge('input', image, fi);
        else {
          const upload = override('upload', ['addImageMenuItem']) || shown(OPTIONS).find(el => /upload|importer|depuis.*ordinateur|from.*computer|televerser/.test(norm(label(el))) && label(el).length < 130);
          if (upload) { const armed = await bridge('arm', image); if (!armed.ok) throw error('UPLOAD_BRIDGE', armed.error); await click(upload); }
        }
        if (await confirm(9000)) { await bridge('disarm'); await closeMenus(); return; }
        // Some versions place the upload in the asset picker. Only choose a NEW
        // tile, never the last image in the entire page (the old V4 bug).
        const picker = shown('[role="dialog"],[role="menu"],[data-state="open"]').find(el => shown('img', el).some(img => !mediaBefore.has(imageKey(imgSrc(img)))));
        const tile = picker && shown('img', picker).find(img => !mediaBefore.has(imageKey(imgSrc(img))) && img.naturalWidth >= 64);
        if (tile) {
          const target = tile.closest('button,[role="button"]') || tile;
          await click(target); await sleep(350);
          const addPrompt = override('addToPrompt', ['addToPromptItem']) || shown(OPTIONS).find(el => /add to prompt|ajouter au prompt|use in prompt|utiliser dans.*prompt|ajouter a.*requete/.test(norm(label(el))) && label(el).length < 100);
          if (addPrompt) await click(addPrompt);
          if (await confirm(10000)) { await bridge('disarm'); await closeMenus(); return; }
        }
      }
    }
    await bridge('disarm'); await closeMenus();
    if (uploading()) {
      if (await confirm(25000)) return;
      throw error('UPLOAD_PENDING', 'L’import de ' + role + ' reste en cours. Aucun prompt envoyé.');
    }
    await bridge('drop', image, composer() || promptBox());
    if (await confirm(14000)) return;
    throw error('ATTACHMENT_UNVERIFIED', 'L’image a été transmise, mais aucune nouvelle référence n’est visible dans le prompt Flow. Génération bloquée : vérifiez l’import et le diagnostic.');
  }
  function generatedImages() {
    const root = composer();
    const selector = current?.settings?.selectors?.results;
    const desiredAspect = String(current?.settings?.aspect || '16:9').split(':').map(Number);
    const ratio = desiredAspect[0] / desiredAspect[1];
    return shown(selector || 'img').filter(img => {
      if (img.tagName !== 'IMG' || !img.complete || img.naturalWidth < 240 || img.naturalHeight < 128 || root?.contains(img) || img.closest('[role="dialog"],[role="menu"]')) return false;
      const r = img.getBoundingClientRect(), ar = img.naturalWidth / img.naturalHeight;
      if (r.width < 90 || r.height < 60 || Math.abs(ar - ratio) > .25) return false;
      if (/avatar|profile|profil|reference|ingredient/.test(norm(img.alt))) return false;
      if (selector) return true;
      let card = img.parentElement;
      for (let depth = 0; card && depth < 5; depth++, card = card.parentElement) {
        if (card === root || card === document.body || card.getBoundingClientRect().height > innerHeight * .9) break;
        if (card.querySelector('video')) return false;
        const actions = all(BUTTONS, card).map(label).join(' ');
        if (/download|telecharger|add to prompt|ajouter au prompt|more_vert|more_horiz|more options|plus d.options|favorite|favorite_border|edit image|modifier.*image/.test(norm(actions))) return true;
        if (/generated image|image generee/.test(norm(img.alt))) return true;
        if (card.matches('[data-generation-id],[data-testid*="generated"],[data-testid*="result"]')) return true;
      }
      return false;
    });
  }
  function activeError() {
    return shown('[role="alert"],[data-sonner-toast],[role="status"]').map(el => compact(el.textContent)).find(text => text.length < 500 && /generation failed|couldn.t generate|unable to generate|insufficient|not enough credits|echec.*gener|impossible.*gener|credits insuffisants|try again later|reessayez plus tard|policy violation|safety|violation.*regle/i.test(text));
  }
  function busyEvidence() {
    return shown('[role="progressbar"],[aria-busy="true"]').length > 0 || shown(BUTTONS).some(el => /^(stop generating|cancel generation|arreter.*gener|annuler.*gener)/.test(norm(label(el)))) || /\b(generating|generation en cours)\b/.test(norm(document.body.innerText));
  }
  async function captureImage(img, index) {
    const result = { index, src: imgSrc(img), width: img.naturalWidth, height: img.naturalHeight };
    try {
      // Canvas uses already displayed pixels; no hidden endpoint or auth fetch.
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const data = canvas.toDataURL('image/png'); if (data.length <= 12000000) result.dataUrl = data;
    } catch { /* Cross-origin images remain downloadable via their visible URL. */ }
    return result;
  }
  async function waitForResults(baseline) {
    const found = new Map(); const deadline = Date.now() + 300000;
    const projectURL = location.href;
    let lastReported = 0;
    while (Date.now() < deadline) {
      check();
      if (location.href !== projectURL) throw error('PROJECT_CHANGED', 'Le projet Flow a changé pendant le suivi. Vérifiez le projet initial avant toute nouvelle génération.');
      const failure = activeError(); if (failure) throw error('FLOW_GENERATION_ERROR', failure);
      for (const img of generatedImages()) {
        const key = imageKey(imgSrc(img));
        if (baseline.has(key) || found.has(key)) continue;
        found.set(key, await captureImage(img, found.size + 1));
      }
      if (found.size !== lastReported) {
        lastReported = found.size;
        await report('results', found.size + ' / 4 miniatures détectées dans Flow…', 75 + Math.min(found.size, 4) * 5, { results: [...found.values()].slice(0, 4) });
      }
      if (found.size >= 4) {
        await sleep(1500); check();
        return [...found.values()].slice(0, 4);
      }
      await sleep(1000);
    }
    const e = error('RESULTS_UNCERTAIN', found.size + ' / 4 résultats vérifiés. Flow peut continuer à générer. Consultez le projet avant de relancer.');
    e.results = [...found.values()]; throw e;
  }
  function diagnostic() {
    const box = promptBox(), root = composer(), gen = sendButton(), candidates = generateCandidates();
    return {
      url: location.href, version: '5.1.5', hostSupported: HOST_OK && PATH_OK,
      prompt: !!box, promptType: box?.tagName || null, generate: !!gen, generateEnabled: enabled(gen),
      generateAmbiguous: !gen && candidates.length > 1 && candidates[0].score === candidates[1].score,
      generateCandidates: candidates.slice(0, 6).map(({el, score}) => ({label: label(el).slice(0, 100), tag: el.tagName, testId: el.getAttribute('data-testid'), enabled: enabled(el), score})),
      composer: !!root, composerTag: root?.tagName || null,
      composerHeight: root ? Math.round(root.getBoundingClientRect().height) : null,
      attachmentCount: attachments().length, fileInputs: all('input[type="file"]').length,
      addImage: !!addButton(), modelControl: settingTrigger('model') ? label(settingTrigger('model')).slice(0, 160) : null,
      settings: Object.fromEntries(['mode', 'model', 'aspect', 'count'].map(kind => [kind, { control: settingTrigger(kind) ? label(settingTrigger(kind)).slice(0, 160) : null, detected: !!settingTrigger(kind) || (kind === 'mode' && imageModeFromModel()), verified: configured(kind), ...(kind === 'mode' && imageModeFromModel() ? { source: 'selected-model-family' } : {}) }])),
      activeJob: current?.id || null,
      settingsControl: settingsSummary() ? label(settingsSummary()).slice(0, 160) : null,
      agentEnabled: agentEnabled(),
      // Labels only, no page HTML or account data, prompt text intentionally omitted.
      controls: shown(BUTTONS, root || document).map(label).filter(Boolean).slice(0, 30).map(s => s.slice(0, 100)),
      nearbyControls: shown(BUTTONS).filter(el => !el.closest(EXTERNAL_CONTROLS)).sort((a,b) => near(a,box)-near(b,box)).slice(0,12)
        .map(el => ({label:label(el).slice(0,100),tag:el.tagName,testId:el.getAttribute('data-testid'),type:el.getAttribute('type'),insideComposer:!!root?.contains(el),enabled:enabled(el)}))
    };
  }
  async function ensureProject() {
    const ready=()=>TF.flowProjectId(location.href)&&promptBox()&&generateCandidates().length&&settingsSummary();
    if(ready())return;
    if (/\/about(?:\/|$)/.test(location.pathname) || shown('a,button').some(el => /^(?:sign in|se connecter|connexion|create with google flow)(?:\s|$)/.test(norm(label(el))))) throw error('FLOW_SIGN_IN', 'Connectez-vous à Google Flow et terminez son écran d’accueil.');
    await report('opening', 'Ouverture du projet Flow…', 5);
    const found=await until(()=>ready()||(!TF.flowProjectId(location.href)&&(override('newProject',['newProjectBtn'])||shown(BUTTONS).find(el=>/^(?:add(?:_2)?\s*)?(?:new project|nouveau projet|create project|creer un projet)(?:\s|$)/.test(norm(label(el)))))),18000);
    if(found&&!ready()){
      if(current.projectCreationRequested)throw error('PROJECT_ALREADY_REQUESTED','Un projet a déjà été demandé. Attendez son ouverture au lieu d’en créer un second.');
      const checkpoint=await report('opening','Création du premier projet Flow…',5,{projectCreationRequested:true});
      if(!checkpoint.ok)throw error('CHECKPOINT_FAILED','Impossible de sauvegarder l’ouverture du projet.');
      current.projectCreationRequested=true;await click(found);
    }
    if(!(await until(ready,30000)))throw error('FLOW_NOT_READY','Le projet Flow n’est pas encore utilisable. Aucun nouveau projet ni aucune génération supplémentaire n’a été envoyé.');
  }
  function draftSnapshot(){return {projectUrl:location.origin+location.pathname,prompt:textOf(promptBox()),attachmentKeys:[...attachmentKeys()]};}
  async function clearOwnedAttachments(){
    // Remove only individual reference chips whose ownership was verified beforehand.
    await saveDraftCheckpoint();
    while(attachments().length){
      const image=attachments()[0],before=attachments().length;
      let container=image.parentElement,remove=null;
      for(let depth=0;container&&depth<5&&container!==composer();depth++,container=container.parentElement){
        if(shown('img',container).length!==1)break;
        const buttons=shown(BUTTONS,container).filter(b=>/cancel|remove|retirer|supprim/.test(norm(label(b)))||glyph(b,['cancel','close','delete']));
        if(buttons.length===1){remove=buttons[0];break;}
      }
      if(!remove)throw error('REFERENCE_REMOVE_UNAVAILABLE','Les anciennes références Forge ne peuvent pas être retirées avec certitude. Retirez-les dans ce projet avant de relancer.');
      await click(remove);
      if(!(await until(()=>attachments().length<before,5000)))throw error('REFERENCE_REMOVE_UNVERIFIED','Flow n’a pas confirmé le retrait de l’ancienne référence. Aucun envoi.');
      await saveDraftCheckpoint();
    }
  }
  async function saveDraftCheckpoint(){const r=await report('prepared','Préparation conservée dans le projet Flow.',progress,{draftSnapshot:draftSnapshot()});if(!r.ok)throw error('CHECKPOINT_FAILED','Impossible de sauvegarder la préparation. Aucun envoi.');}
  async function run(job) {
    current = job; current.settings = { aspect: '16:9', outputs: 4, ...job.settings };
    cancelRequested = false; submitted = false; progress = 0; composerAnchor = null;
    try {
      if (!job.reference?.src || !job.prompt?.trim()) throw error('JOB_INVALID', 'Référence et prompt complets requis.');
      await report('opening', 'Connexion au projet Flow…', 2);
      const cdp = await message('tf:cdpAttach');
      if (!cdp.ok) throw error('TRUSTED_INPUT', 'Accès au pilotage Chrome refusé : ' + cdp.error);
      await ensureProject();
      current.projectId=TF.flowProjectId(location.href);current.projectOrigin=location.origin;
      const candidates=generateCandidates();
      if(candidates.length>1&&candidates[0].score===candidates[1].score)throw error('GENERATE_AMBIGUOUS','Plusieurs boutons Générer sont possibles. Aucun envoi.');
      const projectReady=await report('project-ready','Projet Flow connecté et mémorisé.',8);
      if(!projectReady.ok)throw error('CHECKPOINT_FAILED','Impossible de mémoriser le projet Flow.');
      // Never silently overwrite a user's draft or include unrelated images.
      let prepared=0,cleanOwned=false;
      if (textOf(promptBox()) || attachments().length) {
        const resume=job.resumeDraft,owned=job.ownedDraft,snapshot=draftSnapshot();
        const exact=d=>d&&d.projectUrl===snapshot.projectUrl&&d.prompt===snapshot.prompt&&JSON.stringify(d.attachmentKeys)===JSON.stringify(snapshot.attachmentKeys);
        if(exact(resume))prepared=attachments().length;
        else if(exact(owned)||owned&&owned.completed&&snapshot.prompt===''&&owned.projectUrl===snapshot.projectUrl&&JSON.stringify(owned.attachmentKeys)===JSON.stringify(snapshot.attachmentKeys))cleanOwned=true;
        else throw error('COMPOSER_NOT_EMPTY','Le prompt Flow contient un brouillon ou une image qui ne correspond pas à la préparation Forge enregistrée. Videz ce brouillon dans le même projet, puis relancez.');
      }
      await configure();
      if(cleanOwned)await clearOwnedAttachments();
      await report('reference', 'Import et vérification de la miniature de référence…', 30);
      if(prepared<1){await attachImage(job.reference, 'la référence');await saveDraftCheckpoint();}
      if (job.logo?.src) { await report('logo', 'Import et vérification du logo…', 40); if(prepared<2){await attachImage(job.logo, 'votre logo');await saveDraftCheckpoint();} }
      const expectedAttachments = job.logo?.src ? 2 : 1;
      if (attachments().length !== expectedAttachments) throw error('ATTACHMENT_COUNT', 'Le prompt doit contenir exactement ' + expectedAttachments + ' image(s). Vérifiez les références dans Flow avant de relancer.');
      await report('prompt', 'Saisie et contrôle du prompt avec vos textes A, B et C…', 52);
      await closeMenus();
      if(textOf(promptBox())!==compact(job.prompt))await fillPrompt(job.prompt);
      await saveDraftCheckpoint();
      const ready = await until(() => enabled(sendButton()) && !uploading(), 20000);
      if (!ready) {
        const candidates = generateCandidates();
        if (!sendButton() && candidates.length > 1) throw error('GENERATE_AMBIGUOUS', 'Plusieurs boutons de génération sont possibles. Aucun clic envoyé. Copiez le diagnostic Flow.');
        if (!sendButton()) throw error('GENERATE_NOT_FOUND', 'Le bouton Générer est introuvable près du prompt. Aucun clic envoyé. Copiez le diagnostic Flow.');
        throw error('GENERATE_DISABLED', 'Le bouton Générer est trouvé, mais Flow ne l’a pas activé ou traite encore les images. Aucune demande envoyée.');
      }
      // Keep verified current toolbar values. Opening a nested model menu can
      // obscure controls; expand preferences only when a value needs evidence.
      await ensureStandardMode();
      if (['mode', 'model', 'aspect', 'count'].some(kind => !configured(kind))) await openSettings();
      for (const kind of ['mode', 'model', 'aspect', 'count']) {
        if (!configured(kind)) throw error('SETTING_CHANGED', 'Le réglage « ' + settingName(kind) + ' » n’est plus vérifiable. Aucune génération envoyée.');
      }
      await closeMenus();
      if (textOf(promptBox()) !== compact(job.prompt) || attachments().length !== expectedAttachments) throw error('DRAFT_CHANGED', 'Le prompt ou les références ont changé pendant la préparation. Aucun envoi.');
      const baseline = new Set(all('img').map(img => imageKey(imgSrc(img))));
      // Persist intent BEFORE a potentially chargeable click. If the tab reloads,
      // the background knows not to auto-submit this job for a second time.
      const checkpoint = await report('submitting', 'Envoi d’une génération de 4 images…', 67, { submittedAt: Date.now(), submitted: true });
      if (!checkpoint.ok) throw error('CHECKPOINT_FAILED', 'Impossible de sauvegarder le lancement. Aucune génération envoyée.');
      if (checkpoint.job && ['cancelled', 'error', 'uncertain', 'done'].includes(checkpoint.job.status)) throw error('CANCELLED', 'Le lancement a été arrêté avant l’envoi.');
      check(); submitted = true;
      await click(sendButton());
      const acknowledgement = await until(() => activeError() || busyEvidence() || textOf(promptBox()) === '' || generatedImages().some(img => !baseline.has(imageKey(imgSrc(img)))), 15000);
      if (typeof acknowledgement === 'string') throw error('FLOW_GENERATION_ERROR', acknowledgement);
      if (!acknowledgement) throw error('SUBMIT_UNCERTAIN', 'Le clic a été envoyé, mais Flow n’a pas confirmé la génération. Consultez le projet avant de relancer pour éviter des crédits en double.');
      await report('results', 'Flow génère vos 4 miniatures. Vous pouvez revenir à l’extension.', 75);
      await message('tf:cdpDetach');
      const results = await waitForResults(baseline);
      await report('done', '4 miniatures détectées et vérifiées dans Flow.', 100, { status: 'done', results, finishedAt: Date.now() });
    } catch (e) {
      try { lastDiagnostic = diagnostic(); }
      catch (diagnosticError) { lastDiagnostic = { version: '5.1.5', url: location.href, error: diagnosticError.message }; }
      const status = e.code === 'CANCELLED' ? 'cancelled' : submitted ? 'uncertain' : 'error';
      const text = e.code === 'CANCELLED' && submitted ? 'Suivi arrêté. La génération déjà envoyée peut continuer dans Flow.' : e.message;
      await report(status, text, progress, { status, error: { code: e.code || 'FLOW_ERROR', message: text }, diagnostic: lastDiagnostic, ...(e.results ? { results: e.results } : {}), finishedAt: Date.now() });
    } finally {
      await bridge('disarm');
      await message('tf:cdpDetach');
      handledJobs.add(job.id);
      if (handledJobs.size > 30) handledJobs.delete(handledJobs.values().next().value);
      current = null;
    }
  }
  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'tf:flowPing') { respond({ ok: true, jobId: current?.id || null, version: '5.1.5' }); return false; }
    if (msg.type === 'tf:flowStart') {
      if (handledJobs.has(msg.job?.id)) { respond({ ok: true, accepted: true, duplicate: true, finished: true }); return false; }
      if (current) { respond(current.id === msg.job?.id ? { ok: true, accepted: true, duplicate: true } : { ok: false, error: 'Une génération est déjà en cours dans cet onglet.' }); return false; }
      if (!msg.job?.id || !msg.job?.prompt || !msg.job?.reference?.src) { respond({ ok: false, error: 'Tâche incomplète.' }); return false; }
      current = msg.job; respond({ ok: true, accepted: true });
      void run(msg.job); return false;
    }
    if (msg.type === 'tf:flowCancel') { if (!msg.jobId || current?.id === msg.jobId) cancelRequested = true; respond({ ok: true, submitted }); return false; }
    if (msg.type === 'tf:flowDiagnose') {
      const previous = current;
      if (!current && msg.settings) current = { id: null, settings: msg.settings };
      try { respond({ ok: true, diagnostic: diagnostic(), previous: lastDiagnostic }); }
      catch (e) { respond({ ok: false, error: e.message }); }
      finally { current = previous; }
      return false;
    }
    return false;
  });
  void message('tf:flowReady');
})();
