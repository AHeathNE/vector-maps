(function () {
  const chart = document.getElementById("chart");
  const nodesContainer = document.getElementById("nodes");
  const legend = document.getElementById("legend");
  const thumbToggle = document.getElementById("thumbToggle");
  const panelEmpty = document.getElementById("panelEmpty");
  const panelContent = document.getElementById("panelContent");
  const panelClose = document.getElementById("panelClose");
  const panelImageWrap = document.getElementById("panelImageWrap");
  const panelImage = document.getElementById("panelImage");
  const panelTitle = document.getElementById("panelTitle");
  const panelCategory = document.getElementById("panelCategory");
  const panelCategorySwatch = document.getElementById("panelCategorySwatch");
  const panelCategoryName = document.getElementById("panelCategoryName");
  const panelTags = document.getElementById("panelTags");
  const panelDescription = document.getElementById("panelDescription");
  const panelLink = document.getElementById("panelLink");

  let selectedEl = null;
  let categoriesById = {};

  // ---------- skins ----------
  // everything visual beyond node color (which always comes from category —
  // see renderNodes()) is a "skin": a JSON file in skins/, selected by
  // data/config.json's "skin" field. Same mechanism as 3-axis-map/timeline
  // (same css token names), but much smaller: this page is plain DOM/CSS,
  // not Three.js, so a skin is nothing more than a set of CSS custom
  // properties plus two node-size numbers — no fill/outline/material modes.
  //
  // bg/surface/surface2/border/text/textDim are deliberately left OUT of
  // the hardcoded default below (only accent/accent2/quadrant tints are
  // defaulted) so the page's existing light/dark theme — driven by
  // prefers-color-scheme and the :root[data-theme] CSS already in
  // style.css — keeps working untouched unless a skin explicitly opts to
  // override those fields itself.
  let SKIN = {
    css: {
      accent: "#7dd3fc",
      accent2: "#f0abfc",
      quadrantIrreverentHigh: "rgba(240, 171, 252, 0.07)",
      quadrantReverentHigh: "rgba(125, 211, 252, 0.07)",
      quadrantIrreverentLow: "rgba(251, 191, 36, 0.06)",
      quadrantReverentLow: "rgba(52, 211, 153, 0.06)"
    },
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
    accent2: "--accent-2",
    quadrantIrreverentHigh: "--q-irreverent-high",
    quadrantReverentHigh: "--q-reverent-high",
    quadrantIrreverentLow: "--q-irreverent-low",
    quadrantReverentLow: "--q-reverent-low"
  };

  function applySkinCSS() {
    const root = document.documentElement.style;
    for (const key in CSS_VAR_MAP) {
      // explicitly remove (not just skip) when unset, so clearing an
      // optional field back to blank in the editor actually reverts to
      // the page's own light/dark theme instead of leaving a stale
      // inline override in place
      if (SKIN.css[key] != null) root.setProperty(CSS_VAR_MAP[key], SKIN.css[key]);
      else root.removeProperty(CSS_VAR_MAP[key]);
    }
    root.setProperty("--node-size", `${SKIN.nodes.size}px`);
    root.setProperty("--node-thumb-size", `${SKIN.nodes.thumbSize}px`);
  }

  // map data range [-1, 1] to percentage position [0, 100]
  // small inset keeps points off the very edge of the chart
  function toPercent(v) {
    const inset = 8;
    return ((v + 1) / 2) * (100 - inset * 2) + inset;
  }

  function loadThumbPref() {
    try {
      const stored = localStorage.getItem("portfolioMap.showThumbs");
      return stored === null ? true : stored === "true";
    } catch (e) {
      return true;
    }
  }

  function saveThumbPref(value) {
    try {
      localStorage.setItem("portfolioMap.showThumbs", String(value));
    } catch (e) {
      // ignore — private browsing / blocked storage
    }
  }

  function applyThumbPref(value) {
    chart.classList.toggle("thumbnails-on", value);
  }

  function renderLegend(categories) {
    legend.innerHTML = "";
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
      row.appendChild(swatch);
      row.appendChild(label);
      legend.appendChild(row);
    });
  }

  function renderNodes(nodes) {
    nodesContainer.innerHTML = "";
    nodes.forEach((node) => {
      const el = document.createElement("div");
      el.className = "node";
      if (node.image) el.classList.add("node--has-image");

      const category = categoriesById[node.category];
      if (category) {
        el.style.setProperty("--node-color", category.color);
      }

      el.style.left = toPercent(node.x) + "%";
      // y=1 (high fidelity) should render near the top, so invert
      el.style.top = toPercent(-node.y) + "%";
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", node.title);
      el.dataset.id = node.id;

      if (node.image) {
        const thumb = document.createElement("span");
        thumb.className = "node__thumb";
        thumb.style.backgroundImage = `url("${node.image}")`;
        el.appendChild(thumb);
      }

      const dot = document.createElement("span");
      dot.className = "node__dot";
      el.appendChild(dot);

      const label = document.createElement("span");
      label.className = "node__label";
      label.textContent = node.title;
      el.appendChild(label);

      el.addEventListener("click", () => selectNode(node, el));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectNode(node, el);
        }
      });

      nodesContainer.appendChild(el);
    });
  }

  function selectNode(node, el) {
    if (selectedEl) selectedEl.classList.remove("is-selected");
    el.classList.add("is-selected");
    selectedEl = el;
    showPanel(node);
  }

  function showPanel(node) {
    panelEmpty.hidden = true;
    panelContent.hidden = false;

    if (node.image) {
      panelImage.src = node.image;
      panelImage.alt = node.title;
      panelImageWrap.hidden = false;
    } else {
      panelImageWrap.hidden = true;
    }

    panelTitle.textContent = node.title;

    const category = categoriesById[node.category];
    if (category) {
      panelCategorySwatch.style.background = category.color;
      panelCategoryName.textContent = category.name;
      panelCategory.hidden = false;
    } else {
      panelCategory.hidden = true;
    }

    panelTags.innerHTML = "";
    (node.tags || []).forEach((tag) => {
      const span = document.createElement("span");
      span.className = "panel__tag";
      span.textContent = tag;
      panelTags.appendChild(span);
    });

    panelDescription.textContent = node.description || "";

    if (node.link) {
      panelLink.href = node.link;
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

  thumbToggle.checked = loadThumbPref();
  applyThumbPref(thumbToggle.checked);
  thumbToggle.addEventListener("change", () => {
    applyThumbPref(thumbToggle.checked);
    saveThumbPref(thumbToggle.checked);
  });

  let designerReady = () => {};
  const designerReadyPromise = new Promise((resolve) => {
    designerReady = resolve;
  });

  fetch("data/config.json")
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((config) => {
      // "skin2d": a folder can hold both a flat and a 3D page, each with
      // its own skin ("skin" is the 3D one)
      const skinName = (config && config.skin2d) || "default-2d";
      return fetch(`skins/${skinName}.json`)
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((skin) => {
          if (skin && skin.kind && skin.kind !== "2d") {
            console.warn(`Skin "${skinName}" is a ${skin.kind} skin, not a 2d one — using the built-in default.`);
            return null;
          }
          return skin;
        });
    })
    .then((skin) => {
      if (skin) {
        SKIN = {
          css: { ...SKIN.css, ...skin.css },
          nodes: { ...SKIN.nodes, ...skin.nodes }
        };
      }
      applySkinCSS();
      designerReady();
    });

  Promise.all([
    fetch("data/nodes.json").then((res) => res.json()),
    fetch("data/categories.json").then((res) => res.json()),
    fetch("data/config.json").then((res) => res.json()).catch(() => ({}))
  ])
    .then(([nodes, categories, config]) => {
      // optional page text and legend toggle from data/config.json
      if (config.title) {
        document.getElementById("title").textContent = config.title;
        document.title = config.title;
      }
      if (typeof config.subtitle === "string") document.getElementById("subtitle").textContent = config.subtitle;
      if (config.showLegend === false) categories = [];
      categoriesById = {};
      categories.forEach((cat) => {
        categoriesById[cat.id] = cat;
      });
      renderLegend(categories);
      renderNodes(nodes);
    })
    .catch((err) => {
      nodesContainer.innerHTML =
        '<p style="padding:24px;color:var(--text-dim)">Couldn\'t load node data. Make sure the site is running through server.py, not opened as a file.</p>';
      console.error(err);
    });

  // ---------- designer hook ----------
  // the designer tool loads this same page in a same-origin
  // iframe and drives it through this tiny API — same mechanism as
  // 3-axis-map/timeline, but applySkin() here is just a CSS-property update,
  // no DOM rebuild needed
  window.__designer = {
    ready: designerReadyPromise,
    // what the designer needs to know to build the right form: which kind
    // of skin this page takes and which optional features it can render
    meta: { label: "Portfolio Map (2D)", kind: "2d", axes: 2, configKey: "skin2d", capabilities: ["quadrants"] },
    getSkin: () => SKIN,
    applySkin(partial) {
      SKIN = {
        css: { ...SKIN.css, ...partial.css },
        nodes: { ...SKIN.nodes, ...partial.nodes }
      };
      applySkinCSS();
    }
  };
})();
