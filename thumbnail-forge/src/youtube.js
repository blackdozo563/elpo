/* Thumbnail Forge — YouTube capture, classic cards + SPA view models. */
(() => {
  'use strict';
  const GLOBAL = '__tfYouTubeV5';
  // A reinjection after an extension update must replace, not stack, listeners.
  try { window[GLOBAL]?.destroy(); } catch (_) {}
  const records = new Set();
  const cardRecords = new WeakMap();
  const abort = new AbortController();
  const signal = abort.signal;
  const CARD = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
    'ytd-grid-video-renderer', 'ytd-playlist-video-renderer', 'ytd-reel-item-renderer',
    'yt-lockup-view-model', 'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer', 'ytm-reel-item-renderer',
    'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2'
  ].join(',');
  const LINKS = 'a[href*="/watch?"],a[href*="/shorts/"],a[href*="/live/"],a[href*="youtu.be/"]';
  let state = { thumbs: [] };
  let observer;
  let scanTimer;
  let disposed = false;
  let invalid = false;
  const pending = new Set();
  const busy = new Set();
  const ownedPositions = new Map();
  const timers = new Set();
  const TF = window.TF || {};
  const STATE_KEY = TF.STATE_KEY || 'tf_state';

  function later(fn, delay) {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, delay);
    timers.add(id);
    return id;
  }
  function videoId(raw) {
    try {
      const url = new URL(raw, location.href);
      const host = url.hostname.toLowerCase();
      if (!(host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com'))) return null;
      if (TF.extractVideoId) return TF.extractVideoId(url.href);
      const id = host === 'youtu.be' ? url.pathname.split('/')[1] :
        url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1];
      return /^[\w-]{11}$/.test(id || '') ? id : null;
    } catch (_) { return null; }
  }
  function references() {
    return Array.isArray(state.thumbs) ? state.thumbs : (state.library || []).filter(item => item.kind !== 'logo');
  }
  function hasVideo(id) {
    return references().some(item => item.videoId === id || videoId(item.url || item.sourceUrl) === id);
  }
  function icon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M12 3v6m0 6v6M3 12h6m6 0h6M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8');
    svg.append(path);
    return svg;
  }
  function createButton(className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tf-y5-button ${className}`;
    button.dataset.tfOwned = 'true';
    const label = document.createElement('span');
    label.className = 'tf-y5-label';
    button.append(icon(), label);
    return button;
  }
  const floating = createButton('tf-y5-floating');
  const count = document.createElement('span');
  count.className = 'tf-y5-count';
  floating.append(count);
  const toasts = document.createElement('div');
  toasts.className = 'tf-y5-toasts';
  toasts.dataset.tfOwned = 'true';
  toasts.setAttribute('aria-live', 'polite');
  toasts.setAttribute('aria-atomic', 'false');

  function mountGlobals() {
    if (!document.body) return;
    if (!floating.isConnected) document.body.append(floating);
    if (!toasts.isConnected) document.body.append(toasts);
  }
  function notify(message, kind = 'info') {
    mountGlobals();
    const el = document.createElement('div');
    el.className = `tf-y5-toast tf-y5-${kind}`;
    el.textContent = String(message);
    toasts.append(el);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    later(() => el.remove(), 5500);
  }
  function paintButton(button, id, isFloating = false) {
    const added = hasVideo(id);
    const working = busy.has(id);
    button.dataset.added = String(added);
    button.dataset.busy = String(working);
    button.disabled = working;
    button.querySelector('.tf-y5-label').textContent = working ? 'Capture…' :
      invalid ? 'Actualiser YouTube' : added ? 'Ajoutée à Forge' : isFloating ? 'Capturer la miniature' : 'Ajouter à Forge';
    button.title = invalid ? 'L’extension a été mise à jour. Actualisez cette page.' :
      added ? 'Sélectionner cette référence dans Thumbnail Forge' : 'Ajouter cette miniature comme référence dans Thumbnail Forge';
    button.setAttribute('aria-label', button.title);
    if (isFloating) count.textContent = `${references().length}/${TF.MAX_THUMBS || 20}`;
  }
  function repaint() {
    const id = videoId(location.href);
    floating.hidden = !id || !!document.fullscreenElement;
    paintButton(floating, id, true);
    for (const record of records) paintButton(record.button, record.id);
  }
  function markInvalid() {
    if (invalid) return;
    invalid = true;
    observer?.disconnect();
    repaint();
  }
  function setState(next) {
    if (next && typeof next === 'object') state = next;
    repaint();
  }
  async function capture(id, title) {
    if (!id || busy.has(id)) return;
    if (invalid) { notify('L’extension a été mise à jour. Actualisez YouTube pour continuer.', 'error'); return; }
    busy.add(id);
    repaint();
    try {
      if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
      const result = await chrome.runtime.sendMessage({
        type: 'tf:grab', url: `https://www.youtube.com/watch?v=${id}`,
        meta: { title: String(title || '').replace(/\s*[-–—|]\s*YouTube\s*$/i, '').trim().slice(0, 300) }
      });
      if (result?.state) setState(result.state);
      if (result?.ok) {
        // Background may return only the added object; keep local status accurate.
        if (!result.state && result.thumb && !hasVideo(id)) state.thumbs = [...references(), result.thumb];
        notify(result.duplicate ? 'Référence sélectionnée dans Thumbnail Forge.' : 'Miniature ajoutée. Retrouvez-la dans Thumbnail Forge.', 'success');
      } else {
        notify(result?.error || 'Capture impossible. Réessayez depuis la vidéo.', result?.code === 'DUP' ? 'info' : 'error');
      }
    } catch (error) {
      const message = String(error?.message || error);
      if (/context invalidated|receiving end does not exist|extension.*invalid/i.test(message)) {
        markInvalid();
        notify('L’extension a été mise à jour. Actualisez YouTube pour continuer.', 'error');
      } else notify('Capture interrompue. Réessayez ou ouvrez Thumbnail Forge.', 'error');
    } finally {
      busy.delete(id);
      repaint();
    }
  }
  function currentTitle() {
    return document.querySelector('ytd-watch-metadata h1, ytd-video-primary-info-renderer h1')?.textContent ||
      document.querySelector('ytd-reel-video-renderer[is-active] h2')?.textContent || document.title;
  }
  floating.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    capture(videoId(location.href), currentTitle());
  }, { signal });

  function thumbnailAnchor(anchor) {
    if (!(anchor instanceof Element) || !videoId(anchor.getAttribute('href'))) return false;
    return anchor.id === 'thumbnail' || anchor.matches('[class*="content-image"],[class*="shorts-lockup-view-model__content"]') ||
      !!anchor.querySelector('img[src*="ytimg"],img[data-thumb],yt-image,yt-thumbnail-view-model');
  }
  function cardTitle(root, anchor) {
    const heading = root.querySelector('#video-title,[id="video-title-link"],h3,h4,[class*="metadata"][title]');
    return heading?.getAttribute('title') || heading?.textContent || anchor.getAttribute('title') ||
      anchor.querySelector('img')?.alt || '';
  }
  function findAnchor(root) {
    if (root.matches?.(LINKS) && thumbnailAnchor(root)) return root;
    return [...root.querySelectorAll(LINKS)].find(thumbnailAnchor) || null;
  }
  function prepareMount(mount) {
    if (getComputedStyle(mount).position === 'static' && !ownedPositions.has(mount)) {
      ownedPositions.set(mount, mount.style.position);
      mount.style.position = 'relative';
    }
  }
  function install(anchor) {
    if (!thumbnailAnchor(anchor)) return;
    const root = anchor.closest(CARD) || anchor.parentElement;
    if (!root || root === document.body || root === document.documentElement) return;
    const id = videoId(anchor.href);
    let record = cardRecords.get(root);
    if (record) {
      // YouTube reuses card elements when navigating and scrolling.
      const liveAnchor = record.anchor.isConnected && root.contains(record.anchor) && thumbnailAnchor(record.anchor) ? record.anchor : anchor;
      record.anchor = liveAnchor;
      record.id = videoId(liveAnchor.href);
      if (!record.button.isConnected) record.mount.append(record.button);
      paintButton(record.button, record.id);
      return;
    }
    let mount = anchor.parentElement;
    // Never insert a button inside a link, even if YouTube nests wrappers.
    while (mount?.closest('a')) mount = mount.closest('a').parentElement;
    if (!mount || mount === document.body) return;
    prepareMount(mount);
    const button = createButton('tf-y5-card');
    record = { root, anchor, mount, button, id };
    cardRecords.set(root, record);
    records.add(record);
    mount.append(button);
    // Prevent YouTube's delegated click/navigation handlers from opening video.
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const liveAnchor = record.anchor.isConnected && record.root.contains(record.anchor) ? record.anchor : findAnchor(record.root);
      if (!liveAnchor) { notify('Cette vidéo a changé. Réessayez sur sa miniature.', 'info'); return; }
      record.id = videoId(liveAnchor.href);
      capture(record.id, cardTitle(record.root, liveAnchor));
    }, { capture: true, signal });
    for (const type of ['pointerdown', 'mousedown', 'dblclick']) {
      button.addEventListener(type, event => event.stopPropagation(), { signal });
    }
    paintButton(button, id);
  }
  function scan(root) {
    if (!root?.querySelectorAll || !root.isConnected && root !== document) return;
    if (root.matches?.(LINKS)) install(root);
    for (const anchor of root.querySelectorAll(LINKS)) install(anchor);
  }
  function flush() {
    scanTimer = null;
    if (disposed || invalid) return;
    mountGlobals();
    for (const record of records) {
      if (!record.root.isConnected) {
        records.delete(record);
        cardRecords.delete(record.root);
        if (ownedPositions.has(record.mount)) {
          record.mount.style.position = ownedPositions.get(record.mount);
          ownedPositions.delete(record.mount);
        }
      } else if (!record.mount.isConnected || !record.root.contains(record.mount)) {
        record.button.remove();
        records.delete(record);
        cardRecords.delete(record.root);
        pending.add(record.root);
      } else if (!record.button.isConnected) record.mount.append(record.button);
    }
    const roots = [...pending];
    pending.clear();
    if (roots.includes(document)) scan(document);
    else for (const root of roots) scan(root);
    repaint();
  }
  function schedule(root = document) {
    if (invalid || disposed) return;
    pending.add(root);
    if (!scanTimer) scanTimer = later(flush, 180);
  }
  const navigation = () => schedule(document);
  for (const event of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate', 'pageshow', 'fullscreenchange']) {
    window.addEventListener(event, navigation, { capture: true, signal });
  }
  function onStorage(changes, area) {
    if (area === 'local' && changes[STATE_KEY]) setState(changes[STATE_KEY].newValue || { thumbs: [] });
  }
  function onMessage(message) {
    if (message?.type === 'tf:toast') notify(message.text, message.kind === 'ok' ? 'success' : message.kind === 'err' ? 'error' : 'info');
  }
  function start() {
    if (!document.body) { later(start, 100); return; }
    mountGlobals();
    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.target instanceof Element && mutation.target.closest('[data-tf-owned]')) continue;
        if (mutation.type === 'attributes') {
          const node = mutation.target.closest(CARD) || mutation.target.closest('a') || mutation.target;
          schedule(node);
        } else {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && !node.matches('[data-tf-owned]')) schedule(node.closest(CARD) || node);
          }
          if ([...mutation.removedNodes].some(node => node === floating || node === toasts || node.nodeType === 1 && (node.matches?.('[data-tf-owned]') || node.querySelector?.('[data-tf-owned]')))) schedule(mutation.target);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src'] });
    schedule(document);
    try {
      chrome.storage.local.get(STATE_KEY).then(data => setState(data[STATE_KEY] || { thumbs: [] })).catch(() => {});
      chrome.storage.onChanged.addListener(onStorage);
      chrome.runtime.onMessage.addListener(onMessage);
    } catch (_) { markInvalid(); }
  }
  window[GLOBAL] = {
    destroy() {
      disposed = true;
      observer?.disconnect();
      abort.abort();
      for (const timer of timers) clearTimeout(timer);
      for (const record of records) record.button.remove();
      for (const [mount, position] of ownedPositions) mount.style.position = position;
      floating.remove();
      toasts.remove();
      try { chrome.storage.onChanged.removeListener(onStorage); chrome.runtime.onMessage.removeListener(onMessage); } catch (_) {}
    }
  };
  start();
})();
