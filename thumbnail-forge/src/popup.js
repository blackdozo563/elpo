/* Thumbnail Forge 5 · local studio. No external scripts or remote UI assets. */
"use strict";
(() => {
  const $ = id => document.getElementById(id);
  $("appVersion").textContent = TF.VERSION;
  $("appVersion").setAttribute("aria-label", `Version ${TF.VERSION}`);
  const params = new URLSearchParams(location.search);
  if (params.has("studio")) document.body.classList.add("studio");
  if (params.has("sidepanel") || params.has("panel")) document.body.classList.add("sidepanel");
  const RUNNING = new Set(["opening", "running", "submitting", "generating", "queued", "preparing", "uploading"]);
  let state = TF.normalizeState(null), hydrated = false, refreshDraft = true, sourceTab = null, saving = Promise.resolve();
  let revision = 0, savedRevision = 0, busyCapture = false, starting = false, lastGallery = "", lastResults = "";
  let diagnostic = "", noticeIsError = false, lastJobId = null, downloadingAll = false;
  const pendingDownloads = new Set();
  const isRunning = () => state.job && RUNNING.has(state.job.status);
  const hasActiveDownloads = () => Object.values(state.job?.downloads || {}).some(item => ["pending", "starting", "in_progress"].includes(item?.state));
  function send(type, payload = {}) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type, ...payload }, response => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, error: error.message } : (response || { ok: false, error: "L’extension ne répond pas. Recharge-la dans chrome://extensions." }));
        });
      } catch (error) { resolve({ ok: false, error: error.message }); }
    });
  }
  function notice(message, error = false) {
    if (!message) { $("notice").hidden = true; noticeIsError = false; return; }
    noticeIsError = error;
    $("noticeText").textContent = message;
    $("notice").className = "notice" + (error ? " error" : "");
    $("notice").hidden = false;
  }
  function applyState(nextState) {
    const next = TF.normalizeState(nextState);
    // Keep unsaved input, but allow clean fields to sync from another studio.
    if (hydrated) {
      const localZones = zones(), localSettings = draftSettings();
      if (revision !== savedRevision) {
        next.zones = localZones;
        next.settings = { ...next.settings, ...localSettings };
      } else {
        const focused = document.activeElement;
        const zoneKey = ({ zoneA: "a", zoneB: "b", zoneC: "c" })[focused?.id];
        if (zoneKey) next.zones = { ...next.zones, [zoneKey]: localZones[zoneKey] };
        const settingKey = focused?.dataset?.aspect ? "aspect" : focused?.id;
        if (Object.prototype.hasOwnProperty.call(localSettings, settingKey)) {
          next.settings = { ...next.settings, [settingKey]: localSettings[settingKey] };
        }
      }
    }
    state = next;
    refreshDraft = true;
  }
  function accept(response) {
    if (response?.state) applyState(response.state);
    render();
    return response;
  }
  async function action(type, payload = {}, success = "") {
    const response = accept(await send(type, payload));
    if (!response.ok) notice(response.error || "Cette action n’a pas abouti.", true);
    else if (success) notice(success);
    return response;
  }
  function zones() { return { a: $("zoneA").value, b: $("zoneB").value, c: $("zoneC").value }; }
  function draftSettings() {
    return {
      model: $("model").value, aspect: document.querySelector("[data-aspect][aria-pressed='true']")?.dataset.aspect || "16:9", brief: $("brief").value,
      autoDownload: $("autoDownload").checked, filePrefix: $("filePrefix").value,
      logoEnabled: $("logoEnabled").checked, logoMode: $("logoMode").value,
      logoPosition: $("logoPosition").value, logoSize: Math.max(5, Math.min(30, Number($("logoSize").value) || 12))
    };
  }
  function setSaveLabel(text) { $("saveLabel").textContent = text; }
  function queueSave() {
    const currentRevision = ++revision;
    const z = zones(), patch = draftSettings();
    state.zones = z;
    state.settings = { ...state.settings, ...patch };
    setSaveLabel("Enregistrement…");
    updatePrompt();
    updateExportControls();
    // Send the snapshot immediately, before a popup can close. The service
    // worker serializes atomic writes even if this document disappears.
    saving = send("tf:saveDraft", { zones: z, settings: patch }).then(response => {
      if (!response.ok) throw new Error(response.error || "Impossible d’enregistrer le brouillon.");
      savedRevision = Math.max(savedRevision, currentRevision);
      if (revision === currentRevision) setSaveLabel("Enregistré ✓");
    }).catch(error => {
      if (revision === currentRevision) { setSaveLabel("Non enregistré"); notice(error.message, true); }
      throw error;
    });
    // Avoid an unhandled rejection during typing; flush still sees failures.
    saving.catch(() => {});
  }
  async function flush() { queueSave(); do { await saving; } while (savedRevision !== revision); }
  function safeSrc(src) {
    return typeof src === "string" && (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(src) || /^https:\/\//i.test(src)) ? src : "";
  }
  function activeReference() { return state.thumbs.find(item => item.id === state.activeId) || null; }
  function revealTexts() {
    if (document.body.classList.contains("studio")) return;
    document.querySelector(".compose-column").scrollIntoView({ block: "start" });
  }
  function render() {
    const active = activeReference();
    $("capacity").textContent = `${state.thumbs.length} / ${TF.MAX_THUMBS || 20}`;
    const src = safeSrc(active?.src);
    $("referenceImage").hidden = !src;
    $("emptyReference").hidden = !!src;
    $("referenceBadge").hidden = !src;
    $("referenceTools").hidden = !src;
    if (src && $("referenceImage").getAttribute("src") !== src) $("referenceImage").src = src;
    if (!src) $("referenceImage").removeAttribute("src");
    $("referenceTitle").textContent = active?.title || active?.videoId || (src ? "Image importée" : "Aucune référence sélectionnée");
    $("referenceSize").textContent = active?.w && active?.h ? `${active.w} × ${active.h}` : "JPG, PNG ou WebP";
    const galleryKey = state.thumbs.map(t => t.id + ":" + (t.id === state.activeId)).join("|");
    if (lastGallery !== galleryKey || !$("library").childElementCount) {
      lastGallery = galleryKey;
      $("library").replaceChildren();
      if (!state.thumbs.length) {
        const empty = document.createElement("div"); empty.className = "library-empty"; empty.textContent = "Tes références restent enregistrées ici."; $("library").append(empty);
      }
      for (const thumb of state.thumbs) {
        const button = document.createElement("button"); button.className = "thumb-item";
        button.setAttribute("aria-pressed", String(thumb.id === state.activeId));
        button.setAttribute("aria-label", `Sélectionner ${thumb.title || thumb.videoId || "cette référence"}`);
        button.title = thumb.title || thumb.videoId || "Référence importée";
        const image = document.createElement("img"); image.src = safeSrc(thumb.src); image.alt = ""; image.loading = "lazy"; button.append(image);
        button.addEventListener("click", () => action("tf:setActive", { id: thumb.id }));
        $("library").append(button);
      }
    }
    if (!hydrated || refreshDraft) {
      for (const key of ["a", "b", "c"]) {
        const input = $("zone" + key.toUpperCase()), value = state.zones[key] || "";
        if (input.value !== value) input.value = value;
      }
      if ($("brief").value !== (state.settings.brief || "")) $("brief").value = state.settings.brief || "";
      $("model").value=state.settings.model;
      for (const button of document.querySelectorAll("[data-aspect]")) button.setAttribute("aria-pressed", String(button.dataset.aspect === state.settings.aspect));
      $("autoDownload").checked = state.settings.autoDownload !== false;
      const prefix = typeof state.settings.filePrefix === "string" ? state.settings.filePrefix : "miniature";
      if ($("filePrefix").value !== prefix) $("filePrefix").value = prefix;
      $("logoEnabled").checked = state.settings.logoEnabled !== false;
      $("logoMode").value = state.settings.logoMode === "overlay" ? "overlay" : "flow";
      $("logoPosition").value = ["top-left", "top-right", "bottom-left", "bottom-right"].includes(state.settings.logoPosition) ? state.settings.logoPosition : "top-right";
      if (!hydrated || document.activeElement !== $("logoSize")) $("logoSize").value = Math.max(5, Math.min(30, Number(state.settings.logoSize) || 12));
      refreshDraft = false;
    }
    hydrated = true;
    $("logoPreview").replaceChildren();
    if (state.logo && safeSrc(state.logo.src)) {
      const img = document.createElement("img"); img.src = state.logo.src; img.alt = "Logo enregistré"; $("logoPreview").append(img);
    } else $("logoPreview").textContent = "+";
    $("logoName").textContent = state.logo?.name || "PNG transparent conseillé · 8 Mo maximum";
    $("logoUploadLabel").textContent = state.logo ? "Changer le logo" : "Importer le logo";
    $("removeLogo").hidden = !state.logo;
    const running = !!isRunning();
    const exporting = hasActiveDownloads();
    $("startBtn").disabled = !active || running || exporting || starting;
    $("startLabel").textContent = starting ? "Préparation…" : running ? "Génération en cours…" : exporting ? "Téléchargements en cours…" : "Générer mes 4 miniatures";
    $("launchHint").textContent = !active ? "Ajoute une référence pour commencer." : running ? "Tu peux fermer ce panneau : le suivi reste enregistré." : exporting ? "Attends la fin des téléchargements avant de lancer une nouvelle génération." : "Lance la génération dans ton compte Flow. Des crédits Flow peuvent être utilisés.";
    updatePrompt();
    updateExportControls();
    renderJob();
    renderHistory();
  }
  function updatePrompt() {
    const currentZones = zones();
    for (const key of ["A", "B", "C"]) $("count" + key).textContent = `${currentZones[key.toLowerCase()].length} / ${key === "C" ? 120 : 220}`;
    try { $("promptPreview").textContent = TF.buildOneShotPrompt({ ...state.settings, ...draftSettings() }, currentZones, { logo: state.logo }); }
    catch { $("promptPreview").textContent = "Le prompt sera prêt après le chargement des réglages."; }
  }
  function updateExportControls() {
    const running = !!isRunning() || starting, hasLogo = !!state.logo;
    $("logoEnabled").disabled = !hasLogo || running;
    $("logoSettings").hidden = !hasLogo || !$("logoEnabled").checked;
    $("overlayControls").hidden = false;
    for (const id of ["logoUpload", "removeLogo", "logoMode", "logoPosition", "logoSize"]) $(id).disabled = running;
    $("logoUploadLabel").setAttribute("aria-disabled", String(running));
    $("logoUploadLabel").tabIndex = running ? -1 : 0;
    $("logoLockHint").hidden = !running || !hasLogo;
    $("nextLaunchHint").hidden = !running;
    $("logoModeHint").textContent = $("logoMode").value === "overlay"
      ? "Ton logo exact est ajouté localement aux fichiers PNG téléchargés. Les aperçus dans Flow et ci-dessous restent sans ce logo."
      : "Flow reçoit le logo comme seconde image. La position et la taille sont demandées au modèle ; le rendu peut varier.";
    try {
      $("filenamePreview").textContent = TF.exportFilename({ generationNumber: (Number(state.generationCounter) || 0) + 1, exportSettings: { ...state.settings, ...draftSettings() } }, 0);
    } catch { $("filenamePreview").textContent = "Le nom sera prêt après le chargement des réglages."; }
  }
  function stageIndex(job) {
    const stage = String(job?.stage || "").toLowerCase();
    if (job?.status === "done" || /generat|result|monitor|complete|wait/.test(stage)) return 3;
    if (/prompt|send|submit/.test(stage) || job?.status === "submitting") return 2;
    if (/attach|upload|image|reference|config|model/.test(stage)) return 1;
    return job?.status === "generating" ? 3 : 0;
  }
  function statusLabel(status) {
    return ({ done: "Terminé", error: "À vérifier", cancelled: "Arrêté", uncertain: "Confirmation nécessaire", opening: "Ouverture de Flow", running: "Automatisation", submitting: "Envoi à Flow", generating: "Génération", queued: "En attente" })[status] || "Préparation";
  }
  function downloadLabel(status) {
    return ({ pending: "En attente", starting: "Préparation du fichier…", in_progress: "Téléchargement en cours…", complete: "Téléchargement terminé ✓", interrupted: "Téléchargement interrompu", error: "Échec du téléchargement", uncertain: "État à vérifier dans les téléchargements Chrome" })[status] || "Prêt à télécharger";
  }
  async function downloadResult(jobId, index) {
    const key = `${jobId}:${index}`;
    if (pendingDownloads.has(key)) return;
    pendingDownloads.add(key); renderJob();
    try { await action("tf:downloadResult", { jobId, index }, "Téléchargement lancé."); }
    finally { pendingDownloads.delete(key); renderJob(); }
  }
  function renderJob() {
    const job = state.job;
    $("idleState").hidden = !!job; $("jobPanel").hidden = !job;
    if (!job) return;
    $("jobStatus").textContent = statusLabel(job.status);
    $("jobStatus").className = "status-badge " + (job.status || "");
    $("jobNumber").textContent = job.generationNumber ? `Génération ${String(job.generationNumber).padStart(3, "0")}` : "";
    $("jobMessage").textContent = job.message || "Préparation de ton espace de création…";
    $("cancelBtn").hidden = !isRunning();
    $("jobProgress").value = Math.min(100, Math.max(0, Number(job.progress) || 0));
    const index = stageIndex(job);
    for (const step of $("jobSteps").children) {
      const value = Number(step.dataset.step);
      step.classList.toggle("active", value === index && job.status !== "done");
      step.classList.toggle("complete", value < index || job.status === "done");
    }
    const error = typeof job.error === "string" ? job.error : job.error?.message;
    $("jobError").hidden = !error && job.status !== "uncertain";
    $("jobError").textContent = error || (job.status === "uncertain" ? "L’envoi a peut-être eu lieu. Vérifie Flow avant de relancer pour éviter un doublon." : "");
    const results = Array.isArray(job.results) ? job.results : [];
    const overlay = !!job.exportLogo?.src && job.exportSettings?.logoEnabled !== false && job.exportSettings?.logoMode === "overlay";
    $("resultExportHint").hidden = !results.length || !overlay;
    $("resultExportHint").textContent = "Aperçus originaux de Flow. Le logo est ajouté aux fichiers téléchargés avec les réglages de cette génération.";
    const availableDownloads = results.some((_r, i) => !["starting", "in_progress", "complete"].includes(job.downloads?.[i]?.state) && !pendingDownloads.has(`${job.id}:${i}`));
    $("downloadAll").hidden = !results.length;
    $("downloadAll").disabled = downloadingAll || !availableDownloads;
    $("downloadAll").textContent = downloadingAll ? "Lancement des téléchargements…" : "Télécharger les résultats manquants ↓";
    const resultKey = job.id + ":" + results.map(r => r.dataUrl || r.src || r.url || "").join("|") + JSON.stringify(job.downloads || {}) + Array.from(pendingDownloads).join("|");
    if (lastResults !== resultKey || lastJobId !== job.id) {
      lastJobId = job.id; lastResults = resultKey; $("results").replaceChildren();
      results.forEach((result, index) => {
        const source = safeSrc(result.dataUrl || result.src || result.url);
        const card = document.createElement("div"); card.className = "result-card";
        const image = document.createElement(source ? "img" : "button");
        if (source) { image.src = source; image.alt = `Miniature générée ${index + 1}`; image.loading = "lazy"; }
        else {
          image.type = "button"; image.className = "result-unavailable";
          image.textContent = "Aperçu indisponible — ouvrir Flow ↗";
          image.addEventListener("click", () => action("tf:openFlow"));
        }
        const info = job.downloads?.[index], pending = pendingDownloads.has(`${job.id}:${index}`);
        const footer = document.createElement("div"), label = document.createElement("span"), download = document.createElement("button");
        footer.className = "result-footer";
        label.textContent = `Création ${index + 1}`; download.className = "text-btn";
        download.textContent = info?.state === "complete" ? "Retélécharger ↓" : ["error", "interrupted", "uncertain"].includes(info?.state) ? "Réessayer ↓" : "Télécharger ↓";
        download.disabled = pending || ["starting", "in_progress"].includes(info?.state);
        download.addEventListener("click", () => downloadResult(job.id, index));
        const detail = document.createElement("div"), filename = document.createElement("span"), status = document.createElement("span");
        detail.className = "download-detail"; filename.className = "download-filename";
        try { filename.textContent = info?.filename || TF.exportFilename(job, index); }
        catch { filename.textContent = `Création ${index + 1}`; }
        status.className = "download-state " + (info?.state || "");
        status.textContent = pending ? "Lancement du téléchargement…" : downloadLabel(info?.state);
        detail.append(filename, status);
        if (["error", "interrupted"].includes(info?.state) && info.attemptVersion !== TF.VERSION) {
          const previousFailure = document.createElement("span"); previousFailure.className = "download-previous-error";
          previousFailure.textContent = "Ancien échec — cliquez sur Réessayer.";
          detail.append(previousFailure);
        }
        if (info?.error) {
          const message = document.createElement("span"); message.className = "download-error";
          message.textContent = typeof info.error === "string" ? info.error : info.error.message || "Le téléchargement n’a pas abouti.";
          detail.append(message);
        }
        footer.append(label, download); card.append(image, footer, detail); $("results").append(card);
      });
    }
  }
  function renderHistory() {
    const history = Array.isArray(state.history) ? state.history.slice(0, 8) : [];
    $("historyCount").textContent = String(history.length); $("history").replaceChildren();
    if (!history.length) { const p = document.createElement("p"); p.className = "history-empty"; p.textContent = "Tes prochaines générations apparaîtront ici."; $("history").append(p); return; }
    for (const item of history) {
      const row = document.createElement("div"); row.className = "history-item";
      const info = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("small"), status = document.createElement("span");
      title.textContent = (item.generationNumber ? `#${String(item.generationNumber).padStart(3, "0")} · ` : "") + (item.title || item.zones?.a || item.referenceTitle || "Miniature sans titre");
      const date = new Date(item.createdAt || item.finishedAt || Date.now());
      detail.textContent = date.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      status.textContent = statusLabel(item.status); info.append(title, detail); row.append(info, status); $("history").append(row);
    }
  }
  async function detectTab() {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      sourceTab = tabs.find(tab => tab.active && TF.extractVideoId(tab.url || "")) || tabs.filter(tab => TF.extractVideoId(tab.url || "")).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
      $("grabTab").disabled = !sourceTab || busyCapture;
      $("tabHint").textContent = sourceTab ? (sourceTab.title || "Vidéo YouTube ouverte").replace(/\s*[-–]\s*YouTube$/, "") : "Ouvre une vidéo YouTube ou colle son lien ci-dessous.";
    } catch { $("grabTab").disabled = true; }
  }
  async function grab(url, title = "") {
    if (busyCapture) return;
    if (!TF.extractVideoId(url)) { notice("Colle un lien de vidéo YouTube valide (watch, Shorts ou youtu.be).", true); return; }
    busyCapture = true; $("grabUrl").disabled = true; $("grabTab").disabled = true;
    notice("Récupération de la meilleure miniature disponible…");
    try { const response = await action("tf:grab", { url, meta: { title } }, "Miniature capturée et sélectionnée."); if (response.ok) { $("urlInput").value = ""; revealTexts(); } }
    finally { busyCapture = false; $("grabUrl").disabled = false; detectTab(); }
  }
  async function readImage(file) {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choisis une image PNG, JPG ou WebP.");
    if (file.size > 8 * 1024 * 1024) throw new Error("L’image dépasse 8 Mo. Réduis-la avant de l’importer.");
    const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Lecture du fichier impossible.")); reader.readAsDataURL(file); });
    await new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = () => reject(new Error("Cette image semble endommagée.")); img.src = src; });
    return src;
  }
  async function importFile(input, logo = false) {
    const file = input.files?.[0]; if (!file) return;
    if (logo && (isRunning() || starting)) { input.value = ""; return; }
    try {
      const src = await readImage(file);
      if (logo && (isRunning() || starting)) throw new Error("Attends la fin de la génération pour changer le logo.");
      const response = await action(logo ? "tf:setLogo" : "tf:import", logo ? { src, name: file.name } : { src, title: file.name }, logo ? "Logo enregistré." : "Référence importée et sélectionnée.");
      if (response.ok && !logo) revealTexts();
      if (response.ok && logo) { $("logoEnabled").checked = true; queueSave(); }
    }
    catch (error) { notice(error.message, true); }
    finally { input.value = ""; }
  }
  async function copy(text, message) {
    try { await navigator.clipboard.writeText(text); notice(message); }
    catch { notice("Copie impossible. Ouvre le grand studio et réessaie.", true); }
  }
  function bind() {
    $("dismissNotice").addEventListener("click", () => notice(""));
    $("jumpToTexts").addEventListener("click", revealTexts);
    $("backToReference").addEventListener("click", () => window.scrollTo({ top: 0 }));
    document.querySelector(".brand").addEventListener("click", event => { if (!document.body.classList.contains("studio")) { event.preventDefault(); window.scrollTo({ top: 0 }); } });
    $("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("editPrompt").addEventListener("click", () => chrome.runtime.openOptionsPage());
    $("expandBtn").addEventListener("click", () => action("tf:openStudio"));
    $("openFlow").addEventListener("click", () => action("tf:openFlow"));
    $("grabTab").addEventListener("click", () => { if (sourceTab) grab(sourceTab.url, sourceTab.title); });
    $("captureForm").addEventListener("submit", event => { event.preventDefault(); grab($("urlInput").value.trim()); });
    $("imageUpload").addEventListener("change", event => importFile(event.target));
    $("logoUpload").addEventListener("change", event => importFile(event.target, true));
    for (const label of document.querySelectorAll("label[for='imageUpload'],label[for='logoUpload']")) {
      label.tabIndex = 0; label.setAttribute("role", "button");
      label.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $(label.htmlFor).click(); } });
    }
    $("removeLogo").addEventListener("click", () => { if (!isRunning() && !starting) action("tf:clearLogo", {}, "Logo retiré."); });
    $("downloadReference").addEventListener("click", () => { const active = activeReference(); if (active) action("tf:download", { id: active.id }, "Téléchargement lancé."); });
    $("deleteReference").addEventListener("click", () => { const active = activeReference(); if (active) action("tf:delete", { id: active.id }, "Référence supprimée."); });
    for (const id of ["zoneA", "zoneB", "zoneC", "brief", "filePrefix", "logoSize"]) $(id).addEventListener("input", queueSave);
    for (const id of ["logoEnabled", "logoMode", "logoPosition", "autoDownload"]) $(id).addEventListener("change", queueSave);
    $("logoSize").addEventListener("change", () => { $("logoSize").value = draftSettings().logoSize; queueSave(); });
    for (const button of document.querySelectorAll("[data-aspect]")) button.addEventListener("click", () => {
      for (const choice of document.querySelectorAll("[data-aspect]")) choice.setAttribute("aria-pressed", String(choice === button));
      queueSave();
    });
    $("model").addEventListener("change",queueSave);
    $("copyPrompt").addEventListener("click", () => copy($("promptPreview").textContent, "Prompt complet copié."));
    $("startBtn").addEventListener("click", async () => {
      if (starting || isRunning() || hasActiveDownloads() || !activeReference()) return;
      starting = true; render();
      try {
        await flush();
        const response = await action("tf:start", { zones: zones(), settings: draftSettings() });
        if (response.ok) {
          if (response.job) state.job = response.job;
          notice("Automatisation démarrée. Le navigateur doit rester ouvert.");
          render();
        }
      } catch (error) { notice(error.message, true); }
      finally { starting = false; render(); }
    });
    $("cancelBtn").addEventListener("click", async () => {
      if (!state.job) return;
      $("cancelBtn").disabled = true;
      try { await action("tf:cancel", { jobId: state.job.id }, "Automatisation arrêtée. Une génération déjà envoyée peut continuer dans Flow."); }
      finally { $("cancelBtn").disabled = false; }
    });
    $("downloadAll").addEventListener("click", async () => {
      if (!state.job || downloadingAll) return;
      const jobId = state.job.id;
      downloadingAll = true; renderJob();
      try { await action("tf:downloadAll", { jobId }, "Téléchargements demandés. Le suivi apparaît sous chaque création."); }
      finally { downloadingAll = false; renderJob(); }
    });
    $("diagnoseBtn").addEventListener("click", async () => {
      $("diagnoseBtn").disabled = true; $("diagnosticsPanel").hidden = false; $("diagnosticsOutput").textContent = "Inspection de l’onglet Flow…";
      const response = await send("tf:diagnose");
      diagnostic = JSON.stringify(response.diagnostics || response, null, 2);
      $("diagnosticsOutput").textContent = diagnostic; $("diagnoseBtn").disabled = false;
      if (!response.ok) notice(response.error || "Ouvre un projet Flow puis relance le diagnostic.", true);
    });
    $("copyDiagnostic").addEventListener("click", () => copy(diagnostic, "Diagnostic copié."));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.tf_state?.newValue) { applyState(changes.tf_state.newValue); render(); }
    });
    chrome.tabs.onActivated?.addListener(detectTab);
    chrome.tabs.onUpdated?.addListener((_id, info) => { if (info.status === "complete" || info.url) detectTab(); });
  }
  (async () => {
    bind();
    const response = await send("tf:getState");
    if (response.state) { applyState(response.state); setSaveLabel("Enregistré ✓"); }
    else { setSaveLabel("Connexion impossible"); notice(response.error || "Impossible de charger les données de l’extension.", true); }
    render(); detectTab();
    if (activeReference()) requestAnimationFrame(revealTexts);
  })();
})();
