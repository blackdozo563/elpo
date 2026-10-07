"use strict";
(() => {
  const $ = id => document.getElementById(id);
  $("appVersion").textContent = TF.VERSION;
  $("appVersion").setAttribute("aria-label", `Version ${TF.VERSION}`);
  let state = TF.normalizeState(null), diagnostic = "", dirty = false;
  const selectors = [
    ["input", "Champ de prompt", "textarea, [contenteditable=true]"],
    ["sendBtn", "Bouton Générer", "button[aria-label=\"Generate\"]"],
    ["fileInput", "Import d’image", "input[type=file]"],
    ["composer", "Zone de composition", ""],
    ["addImageButton", "Ajouter une image", ""],
    ["addImageMenuItem", "Importer un fichier", ""],
    ["settings", "Bouton de réglages Flow", ""],
    ["mode", "Sélecteur Image / Vidéo", ""],
    ["model", "Sélecteur de modèle", ""],
    ["aspect", "Sélecteur de format", ""],
    ["count", "Nombre de résultats", ""],
    ["attachment", "Images jointes dans le prompt", ""],
    ["results", "Images des résultats", ""]
  ];
  function send(type, payload = {}) {
    return new Promise(resolve => {
      try { chrome.runtime.sendMessage({ type, ...payload }, response => { const err = chrome.runtime.lastError; resolve(err ? { ok: false, error: err.message } : response || { ok: false, error: "Aucune réponse de l’extension." }); }); }
      catch (error) { resolve({ ok: false, error: error.message }); }
    });
  }
  function status(text, error = false) { $("status").textContent = text; $("status").className = "settings-status" + (error ? " error" : ""); $("status").hidden = !text; }
  function buildSelectorFields() {
    for (const [key, label, placeholder] of selectors) {
      const field = document.createElement("div"), title = document.createElement("label"), input = document.createElement("input");
      title.textContent = label; title.htmlFor = "selector-" + key; input.id = title.htmlFor; input.placeholder = placeholder || "Détection automatique"; input.spellcheck = false; input.autocomplete = "off";
      field.append(title, input); $("selectorFields").append(field);
    }
  }
  function fill() {
    $("flowUrl").value = state.settings.flowUrl;
    $("aspect").value = state.settings.aspect;
    $("model").value = state.settings.model;
    $("oneShotPrompt").value = state.settings.oneShotPrompt || TF.DEFAULT_ONESHOT_PROMPT;
    for (const [key] of selectors) $("selector-" + key).value = state.settings.selectors?.[key] || "";
    $("savedAt").textContent = "Réglages enregistrés dans ce navigateur";
  }
  function patch() {
    const flowUrl = $("flowUrl").value.trim();
    if (!TF.isFlowURL(flowUrl)) throw new Error("Utilise une adresse officielle Flow : https://flow.google.com/ ou https://labs.google/fx/…/tools/flow.");
    const values = { ...(state.settings.selectors || {}) };
    for (const [key, label] of selectors) {
      values[key] = $("selector-" + key).value.trim();
      if (values[key]) try { document.querySelector(values[key]); } catch { throw new Error(`Sélecteur CSS invalide : ${label}.`); }
    }
    if (!$("oneShotPrompt").value.trim()) throw new Error("Le prompt ne peut pas être vide. Tu peux rétablir le prompt d’origine.");
    return { flowUrl, model: $("model").value, aspect: $("aspect").value, oneShotPrompt: $("oneShotPrompt").value, selectors: values };
  }
  async function save() {
    $("saveBtn").disabled = true;
    try {
      const response = await send("tf:setSettings", { patch: patch() });
      if (!response.ok) throw new Error(response.error || "Échec de l’enregistrement.");
      if (response.state) state = TF.normalizeState(response.state);
      dirty = false; $("savedAt").textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      status("Réglages enregistrés. Tu peux revenir au studio.");
      return true;
    } catch (error) { status(error.message, true); return false; }
    finally { $("saveBtn").disabled = false; }
  }
  function markDirty() { dirty = true; $("savedAt").textContent = "Modifications à enregistrer"; }
  buildSelectorFields();
  $("settingsForm").addEventListener("submit", event => { event.preventDefault(); save(); });
  $("settingsForm").addEventListener("input", markDirty);
  $("settingsForm").addEventListener("change", markDirty);
  $("resetPrompt").addEventListener("click", () => { $("oneShotPrompt").value = TF.DEFAULT_ONESHOT_PROMPT; markDirty(); status("Prompt d’origine rétabli. Enregistre pour l’utiliser."); });
  $("resetSelectors").addEventListener("click", () => { for (const [key] of selectors) $("selector-" + key).value = ""; markDirty(); status("Détection automatique rétablie. Enregistre pour appliquer."); });
  $("previewPrompt").addEventListener("click", () => {
    try { $("preview").textContent = TF.buildOneShotPrompt({ ...state.settings, ...patch() }, state.zones, { logo: state.logo }); $("preview").hidden = false; }
    catch (error) { status(error.message, true); }
  });
  $("openFlow").addEventListener("click", async () => { if (dirty && !await save()) return; const r = await send("tf:openFlow"); if (!r.ok) status(r.error || "Impossible d’ouvrir Flow.", true); });
  $("diagnose").addEventListener("click", async () => {
    $("diagnose").disabled = true; $("diagnosticPanel").hidden = false; $("diagnosticOutput").textContent = "Inspection de Flow…";
    const response = await send("tf:diagnose"); diagnostic = JSON.stringify(response.diagnostics || response, null, 2);
    $("diagnosticOutput").textContent = diagnostic; $("diagnose").disabled = false;
    if (!response.ok) status(response.error || "Ouvre un projet Flow et relance le diagnostic.", true);
    $("diagnosticPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("copyDiagnostic").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(diagnostic); status("Diagnostic copié."); } catch { status("La copie a échoué. Sélectionne le rapport pour le copier manuellement.", true); }
  });
  $("exportData").addEventListener("click", async () => {
    $("exportData").disabled = true;
    const response = await send("tf:exportData");
    status(response.ok ? "Export lancé dans les téléchargements de Chrome." : response.error || "L’export a échoué.", !response.ok);
    $("exportData").disabled = false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.tf_state?.newValue) return;
    state = TF.normalizeState(changes.tf_state.newValue);
    if (!dirty) fill();
  });
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  (async () => {
    const response = await send("tf:getState");
    if (response.state) { state = TF.normalizeState(response.state); fill(); }
    else { fill(); status(response.error || "Les réglages n’ont pas pu être chargés.", true); }
  })();
})();
