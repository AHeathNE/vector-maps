// ---------------------------------------------------------------------
// What a skin contains, per kind. The designer builds its whole form from
// these specs, so supporting a new map type is a matter of the app saying
// which kind it is and which capabilities it has (window.__designer.meta)
// — not of writing another designer.
//
//   "3d" — Three.js maps: 1-axis timeline, 2-axis 3D scatter, 3-axis map
//   "2d" — plain DOM/CSS maps: 2-axis flat scatter, flat (2D) timeline
//
// A field with `requires` only shows when the app lists that capability;
// `when(skin, caps)` hides a field depending on other values. Skins stay
// portable between apps of the same kind because an app simply ignores
// fields it doesn't understand — the designer just doesn't offer them.
// ---------------------------------------------------------------------

const DEFAULT_PALETTE = ["#f97316", "#ef4444", "#fbbf24", "#4ade80", "#38bdf8", "#a78bfa"];

// which color source is actually in effect for an app: the skin's value if
// the app supports it, otherwise the app's own first-choice fallback
export function colorModeOf(skin, caps) {
  const supported = ["region", "category", "palette"].filter((mode) => mode === "palette" || caps.includes(mode === "region" ? "regionColor" : "categoryColor"));
  return supported.includes(skin.nodes.colorMode) ? skin.nodes.colorMode : supported[0];
}

const SECTIONS_3D = [
  {
    title: "Page colors",
    fields: [
      { type: "color", path: "css.bg", label: "Background" },
      { type: "cssColor", path: "css.surface", label: "Panel surface (CSS color)", placeholder: "rgba(10, 18, 40, 0.88)" },
      { type: "cssColor", path: "css.border", label: "Border (CSS color)", placeholder: "rgba(120, 190, 255, 0.35)" },
      { type: "color", path: "css.text", label: "Text" },
      { type: "color", path: "css.textDim", label: "Dim text" },
      { type: "color", path: "css.accent", label: "Accent" },
      { type: "text", path: "css.headerShadow", label: "Header text-shadow (CSS)", placeholder: "none" },
      { type: "text", path: "css.tooltipGlow", label: "Tooltip box-shadow (CSS)" },
      { type: "text", path: "css.panelGlow", label: "Panel box-shadow (CSS)" }
    ]
  },
  {
    title: "Lines",
    fields: [
      {
        type: "select",
        path: "lines.style",
        label: "Style",
        options: [
          { value: "chrome", label: "Chrome (glossy)" },
          { value: "flat", label: "Flat" },
          { value: "wireframe", label: "Wireframe" },
          { value: "sketch", label: "Sketch (hand-drawn)", requires: "sketch" }
        ]
      },
      { type: "color", path: "lines.color", label: "Color" },
      { type: "range", path: "lines.thickness", label: "Thickness (px)", min: 1, max: 16, step: 1 }
    ]
  },
  {
    title: "Labels",
    fields: [
      { type: "color", path: "labels.color", label: "Color" },
      { type: "color", path: "labels.minorColor", label: "Minor tick color", requires: "minorLabels" },
      { type: "checkbox", path: "labels.glow", label: "Glow" },
      { type: "color", path: "labels.glowColor", label: "Glow color", when: (s) => s.labels.glow }
    ]
  },
  {
    title: "Quadrant panes",
    requires: "quadrants",
    note: "The four faintly tinted panes behind the quadrants (not on the 3-axis map, which colors by region instead).",
    fields: [
      { type: "checkbox", path: "quadrants.show", label: "Show the tinted panes" },
      { type: "range", path: "quadrants.opacity", label: "Strength", min: 0.02, max: 0.5, step: 0.01, when: (s) => s.quadrants.show },
      { type: "color", path: "quadrants.irreverentHigh", label: "Irreverent · High fidelity", when: (s) => s.quadrants.show },
      { type: "color", path: "quadrants.reverentHigh", label: "Reverent · High fidelity", when: (s) => s.quadrants.show },
      { type: "color", path: "quadrants.irreverentLow", label: "Irreverent · Low fidelity", when: (s) => s.quadrants.show },
      { type: "color", path: "quadrants.reverentLow", label: "Reverent · Low fidelity", when: (s) => s.quadrants.show }
    ]
  },
  {
    title: "Nodes",
    fields: [
      {
        type: "select",
        path: "nodes.style",
        label: "Material",
        options: [
          { value: "glossy", label: "Glossy" },
          { value: "flat", label: "Flat" }
        ]
      },
      {
        type: "select",
        path: "nodes.fill",
        label: "Fill",
        options: [
          { value: "solid", label: "Solid" },
          { value: "outline", label: "Outline only" },
          { value: "solid-outline", label: "Solid + outline" },
          { value: "wireframe", label: "Wireframe" },
          { value: "sketch", label: "Sketch (hand-drawn)", requires: "sketch" },
          { value: "sketch-fill", label: "Sketch, filled (hand-drawn)", requires: "sketch" }
        ]
      },
      {
        type: "select",
        path: "nodes.outlineSource",
        label: "Outline / wireframe color",
        when: (s) => s.nodes.fill !== "solid",
        options: [
          { value: "line", label: "Match line color" },
          { value: "node", label: "Match node's own color" },
          { value: "custom", label: "Custom color" }
        ]
      },
      {
        type: "color",
        path: "nodes.outlineColor",
        label: "Custom outline color",
        when: (s) => s.nodes.fill !== "solid" && s.nodes.outlineSource === "custom"
      },
      {
        type: "select",
        path: "nodes.colorMode",
        label: "Color source",
        options: [
          { value: "region", label: "By region (octant)", requires: "regionColor" },
          { value: "category", label: "By category", requires: "categoryColor" },
          { value: "palette", label: "Fixed palette" }
        ],
        onSet: (s, value) => {
          if (value === "palette" && !(s.nodes.palette || []).length) s.nodes.palette = [...DEFAULT_PALETTE];
        }
      },
      {
        type: "range",
        path: "nodes.saturation",
        label: "Saturation",
        min: 0,
        max: 1,
        step: 0.01,
        requires: "regionColor",
        when: (s, caps) => colorModeOf(s, caps) === "region"
      },
      {
        type: "range",
        path: "nodes.lightness",
        label: "Lightness",
        min: 0,
        max: 1,
        step: 0.01,
        requires: "regionColor",
        when: (s, caps) => colorModeOf(s, caps) === "region"
      },
      { type: "palette", path: "nodes.palette", label: "Palette colors", when: (s, caps) => colorModeOf(s, caps) === "palette" },
      { type: "range", path: "nodes.pixelRadius", label: "Size (px)", min: 2, max: 30, step: 1 },
      {
        type: "checkbox",
        path: "nodes.useImages",
        label: "Show photos in the circle",
        onSet: (s, value) => {
          if (!value) s.nodes.imageToggle = false;
        }
      },
      {
        type: "checkbox",
        path: "nodes.imageToggle",
        label: "Let viewers switch between photo and color view",
        when: (s) => s.nodes.useImages
      }
    ]
  },
  {
    title: "Motion",
    requires: "tilt",
    fields: [{ type: "checkbox", path: "motion.tilt", label: "Tilt toward the cursor" }]
  }
];

const SECTIONS_2D = [
  {
    title: "Accent colors",
    fields: [
      { type: "color", path: "css.accent", label: "Accent" },
      { type: "color", path: "css.accent2", label: "Accent 2" }
    ]
  },
  {
    title: "Quadrant tints",
    requires: "quadrants",
    fields: [
      { type: "cssColor", path: "css.quadrantIrreverentHigh", label: "Irreverent · High fidelity (CSS color)", placeholder: "rgba(240, 171, 252, 0.07)" },
      { type: "cssColor", path: "css.quadrantReverentHigh", label: "Reverent · High fidelity (CSS color)", placeholder: "rgba(125, 211, 252, 0.07)" },
      { type: "cssColor", path: "css.quadrantIrreverentLow", label: "Irreverent · Low fidelity (CSS color)", placeholder: "rgba(251, 191, 36, 0.06)" },
      { type: "cssColor", path: "css.quadrantReverentLow", label: "Reverent · Low fidelity (CSS color)", placeholder: "rgba(52, 211, 153, 0.06)" }
    ]
  },
  {
    title: "Axis line",
    requires: "axisLine",
    note: "The timeline's line. Leave the color blank to follow the page's dim text color.",
    fields: [
      { type: "cssColor", optional: true, path: "lines.color", label: "Color (CSS color)", placeholder: "follows dim text" },
      { type: "range", path: "lines.thickness", label: "Thickness (px)", min: 1, max: 10, step: 1 }
    ]
  },
  {
    title: "Page colors (optional)",
    note: "Leave any of these blank to keep following the page's own light/dark system theme. Fill one in to lock that color regardless of the viewer's theme.",
    fields: [
      { type: "cssColor", optional: true, path: "css.bg", label: "Background (CSS color)", placeholder: "follows system theme" },
      { type: "cssColor", optional: true, path: "css.surface", label: "Surface / panel (CSS color)", placeholder: "follows system theme" },
      { type: "cssColor", optional: true, path: "css.surface2", label: "Surface 2 / tags (CSS color)", placeholder: "follows system theme" },
      { type: "cssColor", optional: true, path: "css.border", label: "Border (CSS color)", placeholder: "follows system theme" },
      { type: "cssColor", optional: true, path: "css.text", label: "Text (CSS color)", placeholder: "follows system theme" },
      { type: "cssColor", optional: true, path: "css.textDim", label: "Dim text (CSS color)", placeholder: "follows system theme" }
    ]
  },
  {
    title: "Nodes",
    note: "Node color always comes from each entry's category on 2D pages.",
    fields: [
      { type: "range", path: "nodes.size", label: "Dot size (px)", min: 6, max: 30, step: 1 },
      { type: "range", path: "nodes.thumbSize", label: "Thumbnail size (px)", min: 20, max: 80, step: 2 }
    ]
  }
];

export const SCHEMAS = {
  "3d": {
    kind: "3d",
    label: "3D",
    sections: SECTIONS_3D,
    defaults: () => ({
      name: "My Skin",
      description: "",
      kind: "3d",
      css: {
        bg: "#02040c",
        surface: "rgba(10, 18, 40, 0.88)",
        border: "rgba(120, 190, 255, 0.35)",
        text: "#e8f1ff",
        textDim: "#8ea6c8",
        accent: "#7fd6ff",
        headerShadow: "0 0 12px rgba(0, 0, 0, 0.8)",
        tooltipGlow: "0 0 24px rgba(80, 160, 255, 0.25)",
        panelGlow: "0 0 40px rgba(80, 160, 255, 0.25)"
      },
      lines: { style: "chrome", color: "#a9cdff", thickness: 4 },
      labels: { color: "#cfe6ff", minorColor: "#8fb8e8", glow: true, glowColor: "#4cb8ff" },
      nodes: {
        style: "glossy",
        fill: "solid",
        colorMode: "region",
        saturation: 0.62,
        lightness: 0.6,
        palette: [],
        outlineColor: "",
        outlineSource: "line",
        pixelRadius: 10,
        useImages: false,
        imageToggle: false
      },
      quadrants: {
        show: true,
        opacity: 0.1,
        irreverentHigh: "#f0abfc",
        reverentHigh: "#7dd3fc",
        irreverentLow: "#fbbf24",
        reverentLow: "#34d399"
      },
      motion: { tilt: true }
    })
  },
  "2d": {
    kind: "2d",
    label: "2D",
    sections: SECTIONS_2D,
    defaults: () => ({
      name: "My Skin",
      description: "",
      kind: "2d",
      css: {
        accent: "#7dd3fc",
        accent2: "#f0abfc",
        quadrantIrreverentHigh: "rgba(240, 171, 252, 0.07)",
        quadrantReverentHigh: "rgba(125, 211, 252, 0.07)",
        quadrantIrreverentLow: "rgba(251, 191, 36, 0.06)",
        quadrantReverentLow: "rgba(52, 211, 153, 0.06)"
      },
      lines: { thickness: 3 },
      nodes: { size: 14, thumbSize: 40 }
    })
  }
};

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

// merge a loaded skin over a kind's defaults the way the apps do: each
// top-level section is merged field by field (so a skin only needs to list
// what it changes), anything else just replaces
export function mergeSkin(defaults, loaded) {
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(loaded || {})) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? { ...out[key], ...structuredClone(value) } : structuredClone(value);
  }
  // skins saved before outlineSource existed only ever set outlineColor
  // directly — same backward-compat inference the apps make on load
  if (loaded && loaded.nodes && loaded.nodes.outlineColor && !("outlineSource" in loaded.nodes) && out.nodes) {
    out.nodes.outlineSource = "custom";
  }
  return out;
}

// name/description/kind first, then everything else in its existing order
export function orderSkin(skin, kind) {
  const { name, description, kind: _ignored, ...rest } = skin;
  return { name, description, kind, ...rest };
}

export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "my-skin";
}

// best-effort #rrggbb for a color swatch from "#abc", "#aabbcc" or
// "rgb(a)(r, g, b[, a])" — anything else (named colors, hsl) falls back to
// neutral gray, since <input type="color"> can't show them
export function cssToHex(value) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  if (/^#[0-9a-fA-F]{3}$/.test(text)) return "#" + [...text.slice(1)].map((c) => c + c).join("");
  const m = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
  return "#888888";
}
