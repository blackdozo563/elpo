/* Thumbnail Forge 5 — page-realm upload adapter. No private API calls.
 * An ACK means an event was dispatched, NEVER that Flow accepted the file.
 * The isolated controller must verify an attachment in the composer.
 */
(() => {
  'use strict';
  if (window.__TF5_UPLOAD_BRIDGE__) return;
  window.__TF5_UPLOAD_BRIDGE__ = true;
  let armed = null;
  let restore = null;
  const origin = location.origin;
  const validHost = /^(labs\.google|flow\.google|flow\.google\.com)$/.test(location.hostname);
  if (!validHost) return;

  function fileFrom(data, name) {
    if (typeof data !== 'string' || data.length > 15000000 || !/^data:image\/(png|jpeg|webp);base64,/.test(data)) throw new Error('Image PNG, JPEG ou WebP requise (10 Mo max).');
    const [header, body] = data.split(',');
    const raw = atob(body);
    const mime = header.slice(5, header.indexOf(';'));
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
    const filename = String(name || 'forge-reference').replace(/[^\w.\-]/g, '_').replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([Uint8Array.from(raw, c => c.charCodeAt(0))], filename, { type: mime });
  }
  function transfer(file) { const dt = new DataTransfer(); dt.items.add(file); return dt; }
  function disarm() { armed = null; if (restore) { const fn = restore; restore = null; fn(); } }
  function setInput(input, file) {
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') throw new Error('Cible fichier introuvable.');
    input.files = transfer(file).files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return { files: input.files.length };
  }
  function arm(file) {
    disarm();
    armed = file;
    const click = HTMLInputElement.prototype.click;
    const showPicker = HTMLInputElement.prototype.showPicker;
    const open = window.showOpenFilePicker;
    function consume(input) {
      const next = armed;
      if (!next || input.type !== 'file') return false;
      disarm(); setInput(input, next); return true;
    }
    const patchedClick = function (...args) { if (!consume(this)) return click.apply(this, args); };
    const patchedPicker = function (...args) { if (!consume(this)) return showPicker.apply(this, args); };
    const patchedOpen = function (...args) {
      if (!armed) return open.apply(this, args);
      const next = armed; disarm();
      return Promise.resolve([{ kind: 'file', name: next.name, getFile: async () => next }]);
    };
    HTMLInputElement.prototype.click = patchedClick;
    if (showPicker) HTMLInputElement.prototype.showPicker = patchedPicker;
    if (open) window.showOpenFilePicker = patchedOpen;
    const timeout = setTimeout(disarm, 12000);
    restore = () => {
      clearTimeout(timeout);
      if (HTMLInputElement.prototype.click === patchedClick) HTMLInputElement.prototype.click = click;
      if (showPicker && HTMLInputElement.prototype.showPicker === patchedPicker) HTMLInputElement.prototype.showPicker = showPicker;
      if (open && window.showOpenFilePicker === patchedOpen) window.showOpenFilePicker = open;
    };
  }
  window.addEventListener('message', event => {
    const d = event.data;
    if (event.source !== window || event.origin !== origin || !d || d.channel !== 'TF5_UPLOAD' || typeof d.id !== 'string') return;
    if (!['ping', 'arm', 'disarm', 'input', 'paste', 'drop'].includes(d.op)) return;
    let detail = {};
    try {
      if (d.op === 'disarm') disarm();
      else if (d.op !== 'ping') {
        const file = fileFrom(d.dataUrl, d.name);
        if (d.op === 'arm') arm(file);
        else {
          // The controller marks exactly one element; never default to body.
          if (!/^[a-zA-Z0-9_-]{8,100}$/.test(d.target || '')) throw new Error('Cible absente.');
          const el = document.querySelector('[data-tf5-target="' + d.target + '"]');
          if (!el) throw new Error('Cible disparue.');
          if (d.op === 'input') detail = setInput(el, file);
          else if (d.op === 'paste') {
            el.focus();
            const e = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer(file) });
            el.dispatchEvent(e);
          } else {
            const dt = transfer(file); const rect = el.getBoundingClientRect();
            for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
          }
        }
      }
      window.postMessage({ channel: 'TF5_UPLOAD_ACK', id: d.id, ok: true, dispatched: d.op !== 'ping', ...detail }, origin);
    } catch (error) { window.postMessage({ channel: 'TF5_UPLOAD_ACK', id: d.id, ok: false, error: String(error.message || error) }, origin); }
  });
  window.addEventListener('pagehide', disarm);
})();
