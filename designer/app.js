// ---------------------------------------------------------------------
// The designer's controller: opens a map folder, previews its page in
// an iframe, and drives it live through the window.__designer hook the
// page exposes. The hook's `meta` says what kind of map this is ("3d" or
// "2d") and what it supports, which is all the designer needs to build the
// right form — see schema.js.
//
// It runs in one of two modes. Normally it talks to server.py, which lets
// it open any map folder and save into it. With no server (the copy hosted
// on GitHub Pages) it falls back to a read-only "demo" mode: a fixed list of
// demo maps from static-state.json, live preview and editing as usual, but
// no saving into folders — skins are downloaded instead. All URLs here are
// relative so it works from any subfolder.
// ---------------------------------------------------------------------

import { SCHEMAS, mergeSkin, orderSkin, slugify } from "./schema.js";
import { createForm, getPath, setPath } from "./form.js";

const $ = (id) => document.getElementById(id);
const iframe = $("preview");
const FILE_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

let state = null; // server state: target folder, pages, skins, library
let currentPage = null;
let schema = null;
let caps = [];
let meta = null;
let skin = null;
let form = null;
let filenameTouched = false;
let applyScheduled = false;

let staticMode = false; // true when there's no server (hosted demo)
let staticMaps = []; // demo maps, from static-state.json
let staticLibrary = {};
let appBase = "app/"; // where the open map's files are served from (relative to this page)
let pendingSkin = null; // a ?skin=lib:name in a hosted-demo link, applied once the page is ready
const appUrl = (rel) => new URL(`${appBase}${rel}`, document.baseURI).href;

// ---------- what applies to the open page ----------
// a folder's skins/ can hold both kinds (a 3D page and a flat page side by
// side), and each page has its own active skin. Files with no kind (made
// by hand) count as matching.
const configKey = () => (meta && meta.configKey) || "skin";
const activeFile = () => (state.activeSkins || {})[configKey()];
const skinsForPage = () => (meta ? state.skins.filter((s) => !s.kind || s.kind === meta.kind) : state.skins);

// ---------- server + messages ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Requested-With": "designer" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("designer__toast--error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 9000 : 4000);
}

function showMessage(text) {
  $("previewMessage").textContent = text;
  $("previewMessage").hidden = false;
}

// ---------- target folder ----------
function renderTarget() {
  $("targetPath").value = state.targetFolder || "";

  const recents = state.recentFolders.filter((f) => f !== state.targetFolder);
  const recent = $("targetRecent");
  recent.hidden = recents.length === 0;
  recent.replaceChildren(new Option("Recent folders…", ""), ...recents.map((f) => new Option(f, f)));

  const pageSelect = $("targetPage");
  pageSelect.replaceChildren(
    ...state.pages.map((p) => {
      const name = p.label || p.file;
      const option = new Option(p.skinnable ? name : `${name} (no skin support yet)`, p.file);
      option.disabled = !p.skinnable;
      return option;
    })
  );
  if (currentPage) pageSelect.value = currentPage;

  const status = $("targetStatus");
  status.classList.remove("designer__status--error");
  if (state.targetMissing) {
    status.textContent = "The last folder isn't there anymore — enter another path.";
    status.classList.add("designer__status--error");
  } else if (!state.targetFolder) {
    status.textContent = "";
  } else if (!state.pages.some((p) => p.skinnable)) {
    status.textContent = "No page in this folder supports skins yet.";
  } else {
    const skins = skinsForPage();
    const file = activeFile();
    const active = skins.find((s) => s.file === file);
    const kindLabel = meta ? ` ${meta.kind.toUpperCase()}` : "";
    status.textContent = `${skins.length}${kindLabel} skin${skins.length === 1 ? "" : "s"} in skins/ · active: ${active ? active.name : file || "default"}`;
  }
}

function pickPage() {
  const skinnable = state.pages.filter((p) => p.skinnable);
  if (currentPage && skinnable.some((p) => p.file === currentPage)) return currentPage;
  return (skinnable.find((p) => p.file === "index.html") || skinnable[0] || {}).file || null;
}

function loadPage() {
  currentPage = pickPage();
  renderTarget();
  $("designerBody").hidden = true;
  if (!currentPage) {
    showMessage(state.targetFolder && !state.targetMissing ? "No page in this folder supports skins yet." : "Enter the path to a map folder to begin.");
    return;
  }
  showMessage("Loading…");
  iframe.contentWindow.location.replace(appUrl(currentPage));
  if (staticMode) history.replaceState(null, "", `?map=${encodeURIComponent($("mapPick").value)}&page=${encodeURIComponent(currentPage)}`);
}

async function openTarget(path) {
  try {
    state = await api("POST", "api/target", { path });
    currentPage = null;
    loadPage();
  } catch (err) {
    toast(err.message, true);
  }
}

$("targetOpen").addEventListener("click", () => openTarget($("targetPath").value));
$("targetPath").addEventListener("keydown", (e) => {
  if (e.key === "Enter") openTarget($("targetPath").value);
});
$("targetRecent").addEventListener("change", (e) => e.target.value && openTarget(e.target.value));
$("targetPage").addEventListener("change", (e) => {
  currentPage = e.target.value;
  loadPage();
});
$("mapPick").addEventListener("change", (e) => openStaticMap(e.target.value));

// ---------- preview bridge ----------
iframe.addEventListener("load", async () => {
  let location;
  try {
    location = iframe.contentWindow.location;
  } catch {
    return;
  }
  if (location.href === "about:blank") return; // the initial blank frame

  const hook = iframe.contentWindow.__designer;
  if (!hook) {
    showMessage("This page doesn't expose the skin hook, so it can't be edited yet.");
    return;
  }
  const outcome = await Promise.race([hook.ready.then(() => "ready"), new Promise((resolve) => setTimeout(() => resolve("timeout"), 8000))]);
  if (outcome === "timeout") {
    showMessage("The page didn't finish loading — check the browser console for what went wrong.");
    return;
  }
  adopt(hook);
});

function adopt(hook) {
  meta = hook.meta || { kind: "3d", capabilities: [], label: currentPage };
  schema = SCHEMAS[meta.kind];
  if (!schema) {
    showMessage(`This page reports an unknown skin kind (“${meta.kind}”).`);
    return;
  }
  caps = meta.capabilities || [];

  // start from whatever skin the page is actually showing right now
  const live = JSON.parse(JSON.stringify(hook.getSkin()));
  const active = skinsForPage().find((s) => s.file === activeFile());
  skin = mergeSkin(schema.defaults(), live);
  skin.name = active ? active.name : "My Skin";
  skin.description = active ? active.description : "";
  filenameTouched = false;
  $("filename").value = active ? active.file : slugify(skin.name);

  $("previewMessage").hidden = true;
  $("designerBody").hidden = false;
  renderTarget();
  form = createForm({ container: $("formRoot"), schema, caps, getSkin: () => skin, onChange: onFormChange });
  renderPresets();
  syncMeta();
  form.refresh();
  updateFilenameHint();
  renderJson();

  if (pendingSkin) {
    const wanted = pendingSkin;
    pendingSkin = null;
    const select = $("preset");
    if ([...select.options].some((o) => o.value === wanted)) {
      select.value = wanted;
      select.dispatchEvent(new Event("change"));
    }
  }
}

// the apps merge a skin over their *current* one, so an optional field the
// user cleared has to travel as an explicit undefined to actually clear
function previewPayload() {
  const payload = structuredClone(skin);
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.optional && getPath(payload, field.path) === undefined) setPath(payload, field.path, undefined);
    }
  }
  return payload;
}

function scheduleApply() {
  if (applyScheduled) return;
  applyScheduled = true;
  requestAnimationFrame(() => {
    applyScheduled = false;
    const hook = iframe.contentWindow && iframe.contentWindow.__designer;
    if (hook && skin) hook.applySkin(previewPayload());
    renderJson();
  });
}

function onFormChange() {
  scheduleApply();
}

// ---------- skin sources: this map's skins, the library, built-in ----------
function renderPresets() {
  const select = $("preset");
  select.replaceChildren(new Option("— what's showing now —", ""), new Option("Built-in default", "builtin"));

  const group = (label, items, prefix) => {
    if (!items.length) return;
    const el = document.createElement("optgroup");
    el.label = label;
    items.forEach((s) => el.append(new Option(`${s.name}${prefix === "app:" && s.file === activeFile() ? " ✓" : ""}`, `${prefix}${s.file}`)));
    select.append(el);
  };
  group("This map's skins", skinsForPage(), "app:");
  group(`Library (${schema.label})`, state.library[meta.kind] || [], "lib:");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return res.json();
}

$("preset").addEventListener("change", async (e) => {
  const value = e.target.value;
  if (!value || !skin) return;
  try {
    let loaded = {};
    let file = null;
    if (value.startsWith("app:")) {
      file = value.slice(4);
      loaded = await fetchJson(appUrl(`skins/${file}.json`));
    } else if (value.startsWith("lib:")) {
      file = value.slice(4);
      loaded = await fetchJson(staticMode ? `library/${meta.kind}/${file}.json` : `api/library/${meta.kind}/${file}`);
    }
    skin = mergeSkin(schema.defaults(), loaded);
    skin.name = loaded.name || (file ? file : "My Skin");
    skin.description = loaded.description || "";
    filenameTouched = false;
    $("filename").value = file || slugify(skin.name);
    syncMeta();
    form.refresh();
    updateFilenameHint();
    scheduleApply();
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- name / file name ----------
function syncMeta() {
  $("name").value = skin.name || "";
  $("description").value = skin.description || "";
}

$("name").addEventListener("input", (e) => {
  skin.name = e.target.value;
  if (!filenameTouched) $("filename").value = slugify(skin.name);
  updateFilenameHint();
  renderJson();
});
$("description").addEventListener("input", (e) => {
  skin.description = e.target.value;
  renderJson();
});
$("filename").addEventListener("input", () => {
  filenameTouched = true;
  updateFilenameHint();
});

function fileStem() {
  return $("filename").value.trim().replace(/\.json$/i, "");
}

function updateFilenameHint() {
  const stem = fileStem();
  const hint = $("filenameHint");
  hint.classList.remove("designer__status--error");
  if (!stem) {
    hint.textContent = "Enter a file name.";
  } else if (!FILE_OK.test(stem)) {
    hint.textContent = "Use letters, numbers, dashes, underscores and dots.";
    hint.classList.add("designer__status--error");
  } else if (staticMode) {
    hint.textContent = `Downloads as ${stem}.json — drop it into your map's skins/ folder.`;
  } else {
    const existing = state.skins.find((s) => s.file === stem);
    if (existing && existing.kind && existing.kind !== meta.kind) {
      hint.textContent = `skins/${stem}.json is already a ${existing.kind.toUpperCase()} skin — pick another name.`;
      hint.classList.add("designer__status--error");
    } else {
      hint.textContent = existing ? `Replaces skins/${stem}.json in this map.` : `Creates skins/${stem}.json in this map.`;
    }
  }
}

// ---------- output ----------
function outputSkin() {
  return orderSkin(JSON.parse(JSON.stringify(skin)), meta.kind);
}

function renderJson() {
  if (skin) $("jsonPreview").textContent = JSON.stringify(outputSkin(), null, 2);
}

$("toggleJson").addEventListener("click", () => {
  const pre = $("jsonPreview");
  pre.hidden = !pre.hidden;
  $("toggleJson").textContent = pre.hidden ? "Show raw JSON" : "Hide raw JSON";
});

function requireFileName() {
  const stem = fileStem();
  if (!FILE_OK.test(stem)) {
    toast("Pick a file name first — letters, numbers, dashes, underscores and dots.", true);
    return null;
  }
  return stem;
}

$("saveApp").addEventListener("click", async () => {
  const stem = requireFileName();
  if (!stem) return;
  const existing = state.skins.find((s) => s.file === stem);
  if (existing && existing.kind && existing.kind !== meta.kind) {
    toast(`skins/${stem}.json is already a ${existing.kind.toUpperCase()} skin — pick another name.`, true);
    return;
  }
  if (existing && !confirm(`Replace skins/${stem}.json in this map?`)) return;
  const activate = $("activate").checked;
  try {
    state = await api("POST", "api/skins", { file: stem, skin: outputSkin(), activate, configKey: configKey() });
    renderTarget();
    renderPresets();
    updateFilenameHint();
    toast(activate ? `Saved skins/${stem}.json and made it the active skin.` : `Saved skins/${stem}.json.`);
  } catch (err) {
    toast(err.message, true);
  }
});

$("saveLibrary").addEventListener("click", async () => {
  const stem = requireFileName();
  if (!stem) return;
  if ((state.library[meta.kind] || []).some((s) => s.file === stem) && !confirm(`Replace library/${meta.kind}/${stem}.json?`)) return;
  try {
    state = await api("POST", `api/library/${meta.kind}`, { file: stem, skin: outputSkin() });
    renderTarget();
    renderPresets();
    toast(`Added ${stem}.json to the ${schema.label} library.`);
  } catch (err) {
    toast(err.message, true);
  }
});

$("download").addEventListener("click", () => {
  const stem = requireFileName();
  if (!stem) return;
  const blob = new Blob([JSON.stringify(outputSkin(), null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stem}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- boot ----------
// ---------- demo mode (no server) ----------
function openStaticMap(id, wantedPage = null) {
  const map = staticMaps.find((m) => m.id === id) || staticMaps[0];
  $("mapPick").value = map.id;
  appBase = map.path;
  state = {
    targetFolder: map.path,
    targetMissing: false,
    recentFolders: [],
    library: staticLibrary,
    pages: map.pages,
    skins: map.skins,
    activeSkins: map.activeSkins
  };
  // loadPage() keeps currentPage when it's a page this map can skin
  currentPage = wantedPage;
  loadPage();
}

async function bootStatic() {
  const info = await fetchJson("static-state.json");
  staticMode = true;
  staticMaps = info.maps;
  staticLibrary = info.library;
  document.body.classList.add("designer--static");
  $("mapPick").replaceChildren(...staticMaps.map((m) => new Option(m.label, m.id)));
  // a link can say which map and page to open, and a library skin to start
  // from: ?map=2-axis-scatter&page=flat.html&skin=lib:blueprint-2d
  const params = new URLSearchParams(location.search);
  pendingSkin = params.get("skin");
  openStaticMap(params.get("map"), params.get("page"));
}

(async function boot() {
  try {
    state = await api("GET", "api/state");
  } catch (err) {
    // no server answering — this is the hosted copy, so use the demo list
    try {
      await bootStatic();
    } catch {
      showMessage(`Couldn't reach the designer server: ${err.message}`);
    }
    return;
  }
  renderTarget();
  if (state.targetFolder && !state.targetMissing) loadPage();
})();
