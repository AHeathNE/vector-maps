// The flat (2D) timeline: the same entries as the 3D timeline (index.html),
// laid out along a plain horizontal line in DOM/CSS instead of Three.js.
// Reads the same data/ folder, and takes a 2D skin (the same kind as
// site/flat.html uses) instead of a 3D one.
(function () {
  const $ = (id) => document.getElementById(id);
  const chart = $("chart");
  const ticksEl = $("ticks");
  const nodesEl = $("nodes");
  const legend = $("legend");
  const thumbSwitch = $("thumbSwitch");
  const thumbToggle = $("thumbToggle");
  const panelEmpty = $("panelEmpty");
  const panelContent = $("panelContent");
  const panelClose = $("panelClose");
  const panelImageWrap = $("panelImageWrap");
  const panelImage = $("panelImage");
  const panelDate = $("panelDate");
  const panelTitle = $("panelTitle");
  const panelCategory = $("panelCategory");
  const panelCategorySwatch = $("panelCategorySwatch");
  const panelCategoryName = $("panelCategoryName");
  const panelTags = $("panelTags");
  const panelDescription = $("panelDescription");
  const panelLink = $("panelLink");

  // ---------- tuning ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const EDGE = 0.05; // fraction of the chart's width kept clear at each end
  const MIN_TICK_GAP = 76; // px between date labels
  const LANE_GAP = 8; // min px between neighbours stacked in the same lane
  const THUMB_PREF_KEY = "timeline2d.showThumbs";

  // ---------- dates ----------
  // "2019", "2019-06" or "2019-06-14" -> fractional year
  function parseDate(str) {
    const [y, m, d] = String(str).split("-").map(Number);
    if (!y) return NaN;
    const month = (m || 1) - 1;
    if (!d) return y + month / 12;
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    return y + (Date.UTC(y, month, d) - start) / (end - start);
  }

  function formatDate(str, scheme) {
    const [y, m, d] = String(str).split("-").map(Number);
    if (scheme === "year" || !m) return String(y);
    if (scheme === "month" || !d) return `${MONTHS[m - 1]} ${y}`;
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }

  // ---------- skins ----------
  // A 2D skin: a skins/<name>.json file named by data/config.json's
  // "skin2d" field (the 3D page has its own, "skin"). Same CSS token names
  // as site/flat.html, plus `lines` for the axis. bg/surface/surface2/
  // border/text/textDim are left out of the defaults on purpose so the
  // page keeps following the viewer's light/dark system theme unless a skin
  // explicitly sets them.
  let SKIN = {
    css: { accent: "#7dd3fc", accent2: "#f0abfc" },
    lines: { thickness: 3 },
    nodes: { size: 14, thumbSize: 40 }
  };

  const CSS_VAR_MAP = {
    bg: "--bg",
    surface: "--surface",
    surface2: "--surface-2",
    border: "--border",
    text: "--text",
    textDim: "--text-dim",
    accent: "--accent",
    accent2: "--accent-2"
  };

  function applySkinCSS() {
    const root = document.documentElement.style;
    for (const key in CSS_VAR_MAP) {
      // remove (not just skip) when unset, so clearing an optional field in
      // the editor reverts to the system theme instead of leaving a stale
      // inline override behind
      if (SKIN.css[key] != null) root.setProperty(CSS_VAR_MAP[key], SKIN.css[key]);
      else root.removeProperty(CSS_VAR_MAP[key]);
    }
    root.setProperty("--axis-thickness", `${SKIN.lines.thickness}px`);
    if (SKIN.lines.color) root.setProperty("--axis-color", SKIN.lines.color);
    else root.removeProperty("--axis-color");
    root.setProperty("--node-size", `${SKIN.nodes.size}px`);
    root.setProperty("--node-thumb-size", `${SKIN.nodes.thumbSize}px`);
  }

  // ---------- state ----------
  let data = [];
  let categoriesById = {};
  let scheme = "year";
  let defaultShape = "circle";
  let timeline = null; // { t0, t1 }
  let selectedEl = null;
  let lastWidth = 0;

  // ---------- thumbnails (a viewer preference, remembered) ----------
  function loadThumbPref() {
    try {
      const stored = localStorage.getItem(THUMB_PREF_KEY);
      return stored === null ? true : stored === "true";
    } catch (e) {
      return true;
    }
  }

  function saveThumbPref(value) {
    try {
      localStorage.setItem(THUMB_PREF_KEY, String(value));
    } catch (e) {
      // ignore — private browsing / blocked storage
    }
  }

  function applyThumbPref(value) {
    chart.classList.toggle("thumbnails-on", value);
    layout(); // thumbnails are bigger, so entries may need different lanes
  }

  // ---------- legend ----------
  function renderLegend(categories) {
    legend.replaceChildren();
    if (!categories.length) {
      legend.hidden = true;
      return;
    }
    legend.hidden = false;

    const title = document.createElement("span");
    title.className = "legend__title";
    title.textContent = "Category";
    legend.appendChild(title);

    categories.forEach((cat) => {
      const row = document.createElement("span");
      row.className = "legend__item";
      const swatch = document.createElement("span");
      swatch.className = "legend__swatch";
      swatch.style.background = cat.color;
      const label = document.createElement("span");
      label.textContent = cat.name;
      row.append(swatch, label);
      legend.appendChild(row);
    });
  }

  // ---------- nodes ----------
  function renderNodes() {
    nodesEl.replaceChildren();
    data.forEach((d) => {
      const el = document.createElement("div");
      el.className = "node";
      if (d.image) el.classList.add("node--has-image");
      const shape = d.shape || defaultShape;
      if (shape === "cube" || shape === "pyramid") el.classList.add(`node--${shape}`);

      const category = categoriesById[d.category];
      if (category) el.style.setProperty("--node-color", category.color);

      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", d.title);

      if (d.image) {
        const thumb = document.createElement("span");
        thumb.className = "node__thumb";
        thumb.style.backgroundImage = `url("${d.image}")`;
        el.appendChild(thumb);
      }

      const dot = document.createElement("span");
      dot.className = "node__dot";
      el.appendChild(dot);

      const label = document.createElement("span");
      label.className = "node__label";
      label.append(d.title);
      const when = document.createElement("span");
      when.className = "node__label-date";
      when.textContent = formatDate(d.date, scheme);
      label.appendChild(when);
      el.appendChild(label);

      el.addEventListener("click", () => selectNode(d, el));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectNode(d, el);
        }
      });

      d._el = el;
      nodesEl.appendChild(el);
    });
  }

  // ---------- layout ----------
  function addTick(x, text, major) {
    const tick = document.createElement("div");
    tick.className = major ? "tick tick--major" : "tick";
    tick.style.left = `${x}px`;
    const label = document.createElement("span");
    label.className = "tick__label";
    label.textContent = text;
    tick.appendChild(label);
    ticksEl.appendChild(tick);
  }

  function buildTicks(xOf, perYear) {
    const { t0, t1 } = timeline;
    const pick = (steps, unitsPerStep) => steps.find((s) => s * unitsPerStep >= MIN_TICK_GAP) || steps[steps.length - 1];

    if (scheme === "year") {
      const step = pick([1, 2, 5, 10, 20, 50, 100], perYear);
      for (let y = Math.ceil(t0 / step) * step; y <= t1; y += step) addTick(xOf(y), String(y), true);
    } else {
      const step = pick([1, 2, 3, 6, 12, 24, 60, 120], perYear / 12);
      const startM = Math.ceil((t0 * 12) / step) * step;
      for (let m = startM; m <= t1 * 12; m += step) {
        const year = Math.floor(m / 12);
        const mo = m - year * 12;
        const major = step >= 12 || mo === 0;
        addTick(xOf(m / 12), major ? String(year) : MONTHS[mo], major);
      }
    }
  }

  // Positions everything in pixels. Entries that land too close together
  // would sit on top of each other, so each goes in the first lane — centre
  // line, then alternately above and below it — where it clears its
  // neighbour. That depends on node size, so a skin or thumbnail change
  // re-runs this.
  function layout() {
    if (!timeline || !data.length) return;
    const width = chart.clientWidth;
    if (!width) return;
    lastWidth = width;

    const thumbsOn = chart.classList.contains("thumbnails-on");
    const sizeOf = (d) => (thumbsOn && d.image ? SKIN.nodes.thumbSize : SKIN.nodes.size);
    const { t0, t1 } = timeline;
    const usable = width * (1 - 2 * EDGE);
    const xOf = (t) => width * EDGE + ((t - t0) / (t1 - t0)) * usable;

    const laneEnds = [];
    [...data]
      .sort((a, b) => a._t - b._t)
      .forEach((d) => {
        const size = sizeOf(d);
        const x = xOf(d._t);
        let n = 0;
        while (laneEnds[n] !== undefined && x - size / 2 < laneEnds[n] + LANE_GAP) n++;
        laneEnds[n] = x + size / 2;
        d._x = x;
        d._lane = n === 0 ? 0 : n % 2 === 1 ? -Math.ceil(n / 2) : n / 2; // 0, -1, +1, -2, +2 ...
      });

    const maxSize = Math.max(SKIN.nodes.size, ...data.map(sizeOf));
    const step = maxSize + 14;
    const maxLane = Math.max(...data.map((d) => Math.abs(d._lane)));
    const height = Math.max(340, 2 * maxLane * step + maxSize + 150);
    chart.style.setProperty("--chart-height", `${height}px`);

    data.forEach((d) => {
      d._el.style.left = `${d._x}px`;
      d._el.style.top = `calc(50% + ${d._lane * step}px)`;
    });

    ticksEl.replaceChildren();
    buildTicks(xOf, usable / (t1 - t0));
  }

  window.addEventListener("resize", () => {
    if (chart.clientWidth !== lastWidth) layout();
  });

  // ---------- selection + panel ----------
  function selectNode(d, el) {
    if (selectedEl) selectedEl.classList.remove("is-selected");
    el.classList.add("is-selected");
    selectedEl = el;
    showPanel(d);
  }

  function showPanel(d) {
    panelEmpty.hidden = true;
    panelContent.hidden = false;

    if (d.image) {
      panelImage.src = d.image;
      panelImage.alt = d.title;
      panelImageWrap.hidden = false;
    } else {
      panelImageWrap.hidden = true;
    }

    panelDate.textContent = formatDate(d.date, scheme);
    panelTitle.textContent = d.title;

    const category = categoriesById[d.category];
    if (category) {
      panelCategorySwatch.style.background = category.color;
      panelCategoryName.textContent = category.name;
      panelCategory.hidden = false;
    } else {
      panelCategory.hidden = true;
    }

    panelTags.replaceChildren();
    (d.tags || []).forEach((tag) => {
      const span = document.createElement("span");
      span.className = "panel__tag";
      span.textContent = tag;
      panelTags.appendChild(span);
    });

    panelDescription.textContent = d.description || "";

    if (d.link) {
      panelLink.href = d.link;
      panelLink.style.display = "inline-block";
    } else {
      panelLink.style.display = "none";
    }
  }

  function closePanel() {
    panelContent.hidden = true;
    panelEmpty.hidden = false;
    if (selectedEl) {
      selectedEl.classList.remove("is-selected");
      selectedEl = null;
    }
  }

  panelClose.addEventListener("click", closePanel);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  thumbToggle.addEventListener("change", () => {
    applyThumbPref(thumbToggle.checked);
    saveThumbPref(thumbToggle.checked);
  });

  // ---------- boot ----------
  function fail(message) {
    const el = $("error");
    el.textContent = message;
    el.hidden = false;
  }

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.json();
  }

  let designerReady = () => {};
  const designerReadyPromise = new Promise((resolve) => {
    designerReady = resolve;
  });

  async function boot() {
    let config, nodes, categories;
    try {
      [config, nodes, categories] = await Promise.all([
        load("data/config.json").catch(() => ({})),
        load("data/nodes.json"),
        load("data/categories.json").catch(() => [])
      ]);
    } catch (err) {
      console.error(err);
      fail("Couldn't load timeline data. Serve this folder over http instead of opening the file directly.");
      return;
    }

    if (["circle", "cube", "pyramid"].includes(config.nodeShape)) defaultShape = config.nodeShape;
    scheme = ["year", "month", "day"].includes(config.dateScheme) ? config.dateScheme : "year";
    $("title").textContent = config.title || "Timeline";
    // the 3D page's subtitle talks about tilting the line, which this page
    // doesn't do, so this page has its own
    $("subtitle").textContent = config.subtitleFlat || "Hover a point for a preview, click for details.";
    document.title = config.title || "Timeline";

    const skinName = config.skin2d || "default-2d";
    let skin = await load(`skins/${skinName}.json`).catch((skinErr) => {
      console.warn(`Couldn't load skin "${skinName}", using the built-in default.`, skinErr);
      return null;
    });
    if (skin && skin.kind && skin.kind !== "2d") {
      console.warn(`Skin "${skinName}" is a ${skin.kind} skin, not a 2d one — using the built-in default.`);
      skin = null;
    }
    if (skin) {
      SKIN = {
        css: { ...SKIN.css, ...skin.css },
        lines: { ...SKIN.lines, ...skin.lines },
        nodes: { ...SKIN.nodes, ...skin.nodes }
      };
    }
    applySkinCSS();
    designerReady();

    categories.forEach((c) => (categoriesById[c.id] = c));
    renderLegend(categories);

    data = nodes.filter((d) => !isNaN(parseDate(d.date)));
    if (!data.length) {
      fail("No dated entries yet.");
      return;
    }
    data.forEach((d) => (d._t = parseDate(d.date)));

    const tMin = Math.min(...data.map((d) => d._t));
    const tMax = Math.max(...data.map((d) => d._t));
    const pad = Math.max((tMax - tMin) * 0.06, scheme === "year" ? 0.6 : 0.25);
    timeline = { t0: tMin - pad, t1: tMax + pad };

    renderNodes();
    thumbSwitch.hidden = !data.some((d) => d.image);
    thumbToggle.checked = loadThumbPref();
    applyThumbPref(thumbToggle.checked);
  }

  // ---------- designer hook ----------
  // the designer tool loads this same page in a same-origin
  // iframe and drives it through this tiny API, so edits preview live with
  // no duplicated rendering code
  window.__designer = {
    ready: designerReadyPromise,
    // what the designer needs to know to build the right form: which kind
    // of skin this page takes, which data/config.json key holds the active
    // one, and which optional features it can render
    meta: { label: "Timeline (2D)", kind: "2d", axes: 1, configKey: "skin2d", capabilities: ["axisLine"] },
    getSkin: () => SKIN,
    applySkin(partial) {
      SKIN = {
        css: { ...SKIN.css, ...partial.css },
        lines: { ...SKIN.lines, ...partial.lines },
        nodes: { ...SKIN.nodes, ...partial.nodes }
      };
      applySkinCSS();
      layout(); // node sizes change how entries stack
    }
  };

  boot();
})();
