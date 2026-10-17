import * as THREE from "./vendor/three.module.min.js";

const canvas = document.getElementById("scene");
const tooltip = document.getElementById("tooltip");
const tooltipImage = document.getElementById("tooltipImage");
const tooltipDate = document.getElementById("tooltipDate");
const tooltipTitle = document.getElementById("tooltipTitle");
const panel = document.getElementById("panel");
const panelClose = document.getElementById("panelClose");
const panelImageWrap = document.getElementById("panelImageWrap");
const panelImage = document.getElementById("panelImage");
const panelDate = document.getElementById("panelDate");
const panelTitle = document.getElementById("panelTitle");
const panelCategory = document.getElementById("panelCategory");
const panelCategorySwatch = document.getElementById("panelCategorySwatch");
const panelCategoryName = document.getElementById("panelCategoryName");
const panelTags = document.getElementById("panelTags");
const panelDescription = document.getElementById("panelDescription");
const panelLink = document.getElementById("panelLink");
const legend = document.getElementById("legend");
const imageToggleBtn = document.getElementById("imageToggleBtn");

// ---------- tuning ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CAM_Z = 11;
const MAX_YAW = 0.17;      // radians the rod can seesaw either way
const MAX_FWD = 1.8;       // how far the rod slides toward the viewer
const TUBE_SIDES = 24;
const WIRE_TUBE_SIDES = 8; // fewer radial segments when the rod is wireframe, or it reads as a dense tube rather than a cage
const SCREEN_FIT = 0.94;  // fraction of the screen half-width the rod may reach
// line thickness and node size are both defined in actual screen pixels,
// not world units, so they read the same regardless of window size — see
// 3-axis-map/script.js for the fuller explanation of why. Recomputed every
// layout() call; these are only the fallbacks if a skin doesn't set one.
const DEFAULT_LINE_PIXEL_THICKNESS = 5;
const DEFAULT_NODE_PIXEL_RADIUS = 11;
const HIT_RADIUS_MULTIPLE = 4.5; // click/hover target vs. the visible dot
const WIRE_CIRCLE_SEGMENTS = [8, 5]; // sparse sphere just for wireframe circle nodes

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
// everything visual — background, line/label/node style — comes from a
// skins/<name>.json file named by data/config.json's "skin" field, so this
// whole tool can be reskinned without touching code. Mirrors 3-axis-map's
// skin schema (same css token names, same nodes.fill/outlineSource ideas)
// so the two stay easy to fold into one shared system later; "lines" here
// always has exactly one entry (the rod), colorMode "category" replaces
// 3-axis-map's "region" since a 1D timeline has no spatial region.
let SKIN = {
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
  lines: { style: "chrome", color: "#a9cdff", thickness: DEFAULT_LINE_PIXEL_THICKNESS },
  labels: { color: "#e6f4ff", minorColor: "#8fb8e8", glow: true, glowColor: "#4cb8ff" },
  nodes: {
    style: "glossy",
    fill: "solid",
    colorMode: "category",
    saturation: 0.62,
    lightness: 0.6,
    palette: [],
    outlineColor: "",
    outlineSource: "line",
    pixelRadius: DEFAULT_NODE_PIXEL_RADIUS,
    useImages: false,
    imageToggle: false
  },
  // the rod normally seesaws and slides toward the cursor; a skin can turn
  // that off for a calmer, static line
  motion: { tilt: true }
};

function applySkinCSS() {
  const root = document.documentElement.style;
  const css = SKIN.css;
  root.setProperty("--bg", css.bg);
  root.setProperty("--surface", css.surface);
  root.setProperty("--border", css.border);
  root.setProperty("--text", css.text);
  root.setProperty("--text-dim", css.textDim);
  root.setProperty("--accent", css.accent);
  root.setProperty("--header-shadow", css.headerShadow);
  root.setProperty("--tooltip-glow", css.tooltipGlow);
  root.setProperty("--panel-glow", css.panelGlow);
}

// a node's color comes from its category by default — the one thing a
// timeline naturally groups by — or, if the skin opts in, a fixed palette
// cycled by the node's position in data/nodes.json
function nodeColor(d) {
  if (SKIN.nodes.colorMode === "palette" && SKIN.nodes.palette && SKIN.nodes.palette.length) {
    return new THREE.Color(SKIN.nodes.palette[d._i % SKIN.nodes.palette.length]);
  }
  const cat = categoriesById[d.category];
  return new THREE.Color(cat ? cat.color : "#7fd6ff");
}

// the color used for a node's outline/ring/wireframe lines — independent of
// the node's own fill color, except when nodes.outlineSource is "node"
function outlineColorFor(d) {
  if (SKIN.nodes.outlineSource === "node") return `#${nodeColor(d).getHexString()}`;
  if (SKIN.nodes.outlineSource === "custom") return SKIN.nodes.outlineColor || SKIN.lines.color;
  return SKIN.lines.color; // "line" (default)
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);

scene.add(new THREE.AmbientLight(0x3a5a9a, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(4, 8, 10);
scene.add(key);
const rim = new THREE.PointLight(0x55ccff, 60, 40);
rim.position.set(0, 3, 6);
scene.add(rim);

// ---------- stiff-rod rig ----------
// The whole line is one rigid body: it slides forward toward the cursor and
// yaws about the view centre, so it seesaws as the cursor moves along it.
const pointer = { x: -1, y: -1, inside: false };          // client px
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const hitPoint = new THREE.Vector3();

// spring-damped scalars: yaw (radians), forward offset, vertical offset
function makeSpring(k, zeta) {
  return { v: 0, vel: 0, target: 0, k, c: 2 * zeta * Math.sqrt(k) };
}
const yaw = makeSpring(70, 0.55);
const fwd = makeSpring(60, 0.6);
const lift = makeSpring(60, 0.7);
function stepSpring(s, dt) {
  s.vel += (s.k * (s.target - s.v) - s.c * s.vel) * dt;
  s.v += s.vel * dt;
}

const pivotX = 0;
// rigid transform of a point (x, y) on the rod
function displace(x, y, out) {
  const rel = x - pivotX;
  const cos = Math.cos(yaw.v);
  const sin = Math.sin(yaw.v);
  out.x = rel * (cos - 1);
  out.y = lift.v;
  out.z = rel * sin + fwd.v;
  return out;
}
const tmp = { x: 0, y: 0, z: 0 };

// ---------- line ----------
const rig = new THREE.Group();   // carries the rod's rigid motion
let tube = null;

// "chrome" is the glossy lit look, "flat" is solid and unaffected by scene
// lighting, "wireframe" is just the tube's edges — same three styles as
// 3-axis-map's axis rods
function lineMaterial() {
  const color = new THREE.Color(SKIN.lines.color);
  if (SKIN.lines.style === "wireframe") return new THREE.MeshBasicMaterial({ color, wireframe: true });
  if (SKIN.lines.style === "flat" || SKIN.lines.style === "sketch") return new THREE.MeshBasicMaterial({ color });
  return new THREE.MeshPhongMaterial({ color, specular: 0xffffff, shininess: 140, emissive: color.clone().multiplyScalar(0.08) });
}

// "sketch" rod: a tube following a gently wavy path instead of a straight
// cylinder, for a hand-drawn line look (same idea as 3-axis-map's sketch
// axes). Same wobble every rebuild (seeded).
function sketchRodGeometry(x0, x1, radius) {
  const segments = 18;
  const rand = seededRandom(44.4);
  const seedA = rand() * 10;
  const seedB = rand() * 10;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wobbleY = Math.sin(t * Math.PI * 7 + seedA) * radius * 1.4 + (rand() - 0.5) * radius;
    const wobbleZ = Math.cos(t * Math.PI * 6 + seedB) * radius * 1.4 + (rand() - 0.5) * radius;
    points.push(new THREE.Vector3(x0 + t * (x1 - x0), wobbleY, wobbleZ));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 72, radius, 8, false);
}

function buildTube(x0, x1, tubeRadius) {
  let geo;
  if (SKIN.lines.style === "sketch") {
    geo = sketchRodGeometry(x0, x1, tubeRadius);
  } else {
    const sides = SKIN.lines.style === "wireframe" ? WIRE_TUBE_SIDES : TUBE_SIDES;
    geo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, x1 - x0, sides, 1, false);
    geo.rotateZ(Math.PI / 2);
  }
  const solid = new THREE.Mesh(geo, lineMaterial());
  tube = new THREE.Group();
  tube.add(solid);
  rig.add(tube);
  scene.add(rig);
}

// apply the rod transform to the rig (pivot at view centre)
function updateRig() {
  rig.position.set(0, lift.v, fwd.v);
  rig.rotation.y = -yaw.v;
}

// ---------- labels ----------
function makeLabel(text, major) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = `${major ? "bold " : ""}34px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (SKIN.labels.glow) {
    ctx.shadowColor = SKIN.labels.glowColor;
    ctx.shadowBlur = major ? 14 : 6;
  }
  ctx.fillStyle = major ? SKIN.labels.color : SKIN.labels.minorColor;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(1.6, 0.4, 1);
  return sprite;
}

// ---------- ticks ----------
const ticks = [];

function buildTicks(t0, t1, scheme, xOf, perYear) {
  const pick = (steps, unitsPerStep) => steps.find((s) => s * unitsPerStep >= 1.3) || steps[steps.length - 1];

  if (scheme === "year") {
    const step = pick([1, 2, 5, 10, 20, 50, 100], perYear);
    for (let y = Math.ceil(t0 / step) * step; y <= t1; y += step) addTick(xOf(y), String(y), true);
  } else {
    const step = pick([1, 2, 3, 6, 12, 24, 60, 120], perYear / 12);
    const startM = Math.ceil((t0 * 12) / step) * step;
    for (let m = startM; m <= t1 * 12; m += step) {
      const year = Math.floor(m / 12);
      const mo = m - year * 12;
      const label = step >= 12 || mo === 0 ? String(year) : `${MONTHS[mo]}`;
      addTick(xOf(m / 12), label, step >= 12 || mo === 0);
    }
  }
}

function addTick(x, text, major) {
  const sprite = makeLabel(text, major);
  scene.add(sprite);
  ticks.push({ sprite, x });
}

// ---------- node core rendering ----------
// mirrors 3-axis-map's node rendering: solid, outline-only, solid+outline,
// wireframe, or an image thumbnail — all sharing the same fill/outline
// schema so the two skin systems read the same way
const SHAPE_NAMES = ["circle", "cube", "pyramid"];
let SHAPES = { circle: null, cube: null, pyramid: null };
let wireCircleGeo = null;
let hitGeo = null;
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
let defaultShape = "circle";

function makeRingSprite(colorStr, diameter) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

function makeEdgeOutline(shape, color) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(SHAPES[shape]), new THREE.LineBasicMaterial({ color }));
}

function outlineNode(colorStr, shape, nodeR) {
  if (shape === "circle") return makeRingSprite(colorStr, nodeR * 2.2);
  return makeEdgeOutline(shape, new THREE.Color(colorStr));
}

// small seeded generator (mulberry32): a hand-drawn shape has to come out
// the same every time the scene rebuilds, or every slider tick in the skin
// editor (and every window resize) would re-roll every wobble and the whole
// timeline would shimmer. Seeds are per node, so shapes still differ.
function seededRandom(seed) {
  let a = Math.floor(seed * 1e6) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// traces one wobbly pass of a hand-drawn circle onto a 2D context — shared
// by every "sketch" drawing below (plain circle, filled circle, image
// border) so they all wobble the same way. A fresh seed per sprite keeps
// each node's wobble distinct; retracing with the same seed (as the image
// clip and its border do) repeats the same shape.
function wobblyCirclePath(ctx, cx, cy, r, seed) {
  const segments = 28;
  const rand = seededRandom(seed + 0.5);
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const wobble = Math.sin(a * 5 + seed) * 2 + (rand() - 0.5) * 3;
    const rr = r + wobble;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function strokeSketchCircle(ctx, outlineColorStr, cx, cy, r, seed) {
  ctx.strokeStyle = outlineColorStr;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    wobblyCirclePath(ctx, cx, cy, r, seed + pass * 2.4);
    ctx.stroke();
  }
}

// "sketch" node fill: a hand-drawn-looking circle — two overlapping passes
// of a wobbly stroke, optionally filled with the node's color first
// ("sketch-fill"). cube/pyramid keep clean edges (a wobbled box reads as
// broken, not drawn), filled solid for the fill variant.
function makeSketchCircleSprite(outlineColorStr, diameter, fillColor, seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (fillColor) {
    wobblyCirclePath(ctx, 64, 64, 46, seed);
    ctx.fillStyle = `#${fillColor.getHexString()}`;
    ctx.fill();
  }
  strokeSketchCircle(ctx, outlineColorStr, 64, 64, 46, seed);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

function sketchNode(colorStr, shape, nodeR, fillColor, seed) {
  if (shape === "circle") return makeSketchCircleSprite(colorStr, nodeR * 2.4, fillColor, seed);
  if (fillColor) return makeSolidOutlinedMesh(shape, fillColor, colorStr);
  return makeEdgeOutline(shape, new THREE.Color(colorStr));
}

function makeFilledCircleSprite(fillColor, outlineColorStr, diameter) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.fillStyle = `#${fillColor.getHexString()}`;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = outlineColorStr;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

function makeImageCircleSprite(img, outlineColorStr, diameter) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const box = 88;
  const scale = Math.max(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, 64 - w / 2, 64 - h / 2, w, h);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = outlineColorStr;
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

// same as makeImageCircleSprite, but both the clip shape and the border use
// the wobbly hand-drawn path — used whenever the skin's node fill is one of
// the "sketch" styles, so a photo still reads as hand-drawn
function makeSketchImageCircleSprite(img, outlineColorStr, diameter, seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  ctx.save();
  wobblyCirclePath(ctx, 64, 64, 46, seed);
  ctx.clip();
  const box = 88;
  const scale = Math.max(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, 64 - w / 2, 64 - h / 2, w, h);
  ctx.restore();
  strokeSketchCircle(ctx, outlineColorStr, 64, 64, 46, seed);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

function makeSolidOutlinedMesh(shape, color, outlineColorStr) {
  const group = new THREE.Group();
  const fillMesh = new THREE.Mesh(SHAPES[shape], nodeMaterial(color, shape));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(SHAPES[shape]),
    new THREE.LineBasicMaterial({ color: new THREE.Color(outlineColorStr) })
  );
  group.add(fillMesh, edges);
  return group;
}

// "flat" is solid and unlit, "glossy" keeps the lit, highlighted look
function nodeMaterial(color, shape) {
  if (SKIN.nodes.style === "flat") return new THREE.MeshBasicMaterial({ color });
  return new THREE.MeshPhongMaterial({
    color,
    specular: 0x555555,
    shininess: 60,
    emissive: color.clone().multiplyScalar(0.25),
    flatShading: shape !== "circle"
  });
}

function buildCore(d, shape, nodeR) {
  const outlineColorStr = outlineColorFor(d);
  const isSketch = SKIN.nodes.fill === "sketch" || SKIN.nodes.fill === "sketch-fill";
  if (showImages && d.image && imageCache[d.image]) {
    return isSketch
      ? makeSketchImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.4, (d._i + 1) * 1.37)
      : makeImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.2);
  }
  if (SKIN.nodes.fill === "wireframe") {
    const geo = shape === "circle" ? wireCircleGeo : SHAPES[shape];
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(outlineColorStr), wireframe: true }));
  }
  if (SKIN.nodes.fill === "outline") return outlineNode(outlineColorStr, shape, nodeR);
  if (isSketch) return sketchNode(outlineColorStr, shape, nodeR, SKIN.nodes.fill === "sketch-fill" ? nodeColor(d) : null, (d._i + 1) * 1.37);
  if (SKIN.nodes.fill === "solid-outline") {
    const color = nodeColor(d);
    return shape === "circle"
      ? makeFilledCircleSprite(color, outlineColorStr, nodeR * 2.2)
      : makeSolidOutlinedMesh(shape, color, outlineColorStr);
  }
  return new THREE.Mesh(SHAPES[shape], nodeMaterial(nodeColor(d), shape));
}

// ---------- nodes ----------
const nodes = []; // { data, group, core, hit, x, y0, scale, phase }
const hitMeshes = [];

function buildNodes(data, xOf, nodeR) {
  // stack nodes that share a position so they stay separately hoverable
  const buckets = new Map();
  data.forEach((d) => {
    const k = d._x.toFixed(2);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(d);
  });
  const lanes = [0, 0.8, -0.8, 1.6, -1.6, 2.4, -2.4];

  buckets.forEach((list) => {
    list.forEach((d, i) => {
      const group = new THREE.Group();
      const shape = SHAPES[d.shape] ? d.shape : defaultShape;
      const core = buildCore(d, shape, nodeR);
      const hit = new THREE.Mesh(hitGeo, hitMat);
      group.add(core, hit);
      scene.add(group);

      // core.scale may already encode the node's actual size — sprite-based
      // fills (outline, solid-outline, image) set it via
      // scale.set(diameter, diameter, 1) when built, while mesh-based fills
      // (solid, wireframe) bake size into the geometry and leave scale at
      // its (1, 1, 1) default. Captured here so the hover/select pulse in
      // frame() can multiply on top of it instead of overwriting it.
      const baseScale = core.scale.clone();
      const node = { data: d, group, core, hit, x: d._x, y0: lanes[i % lanes.length], scale: 1, baseScale, phase: Math.random() * 6.28 };
      hit.userData.node = node;
      hitMeshes.push(hit);
      nodes.push(node);
    });
  });
}

// ---------- interaction ----------
let hovered = null;
let selected = null;
let categoriesById = {};
let scheme = "year";
let data = [];
let imageCache = {}; // url -> loaded HTMLImageElement
// whether nodes currently render as photos or as their color fill — see
// 3-axis-map/script.js for the fuller explanation of this and imageToggleBtn
let showImages = false;

function updateImageToggleButton() {
  const hasImages = data.some((d) => d.image);
  imageToggleBtn.hidden = !(SKIN.nodes.imageToggle && hasImages);
  imageToggleBtn.textContent = showImages ? "Hide Photos" : "Show Photos";
}

imageToggleBtn.addEventListener("click", () => {
  showImages = !showImages;
  updateImageToggleButton();
  if (timeline) layout();
});

function updatePointer(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
}

canvas.addEventListener("pointermove", updatePointer);
canvas.addEventListener("pointerup", (e) => {
  updatePointer(e);
  const hit = pick();
  if (hit) selectNode(hit);
  else closePanel();
});

canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") pointer.inside = false;
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

function pick() {
  ndc.set((pointer.x / canvas.clientWidth) * 2 - 1, -(pointer.y / canvas.clientHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  return hits.length ? hits[0].object.userData.node : null;
}

function setHovered(node) {
  if (node === hovered) return;
  hovered = node;
  canvas.classList.toggle("is-hovering", !!node);
  if (!node) {
    tooltip.hidden = true;
    return;
  }
  const d = node.data;
  tooltipTitle.textContent = d.title;
  tooltipDate.textContent = formatDate(d.date, scheme);
  if (d.image) {
    tooltipImage.style.backgroundImage = `url("${d.image}")`;
    tooltipImage.hidden = false;
  } else {
    tooltipImage.hidden = true;
  }
  tooltip.hidden = false;
}

function positionTooltip() {
  if (tooltip.hidden) return;
  const w = tooltip.offsetWidth;
  const h = tooltip.offsetHeight;
  let x = pointer.x + 18;
  let y = pointer.y + 18;
  if (x + w > window.innerWidth - 8) x = pointer.x - w - 18;
  if (y + h > window.innerHeight - 8) y = pointer.y - h - 18;
  tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
}

function selectNode(node) {
  selected = node;
  const d = node.data;
  if (d.image) {
    panelImage.src = d.image;
    panelImage.alt = d.title;
    panelImageWrap.hidden = false;
  } else {
    panelImageWrap.hidden = true;
  }
  panelDate.textContent = formatDate(d.date, scheme);
  panelTitle.textContent = d.title;
  const cat = categoriesById[d.category];
  if (cat) {
    panelCategorySwatch.style.background = cat.color;
    panelCategoryName.textContent = cat.name;
    panelCategory.hidden = false;
  } else {
    panelCategory.hidden = true;
  }
  panelTags.innerHTML = "";
  (d.tags || []).forEach((t) => {
    const span = document.createElement("span");
    span.className = "panel__tag";
    span.textContent = t;
    panelTags.appendChild(span);
  });
  panelDescription.textContent = d.description || "";
  if (d.link) {
    panelLink.href = d.link;
    panelLink.style.display = "inline-block";
  } else {
    panelLink.style.display = "none";
  }
  panel.hidden = false;
  tooltip.hidden = true;
}

function closePanel() {
  selected = null;
  panel.hidden = true;
}
panelClose.addEventListener("click", closePanel);

// ---------- layout ----------
let timeline = null;   // { data, t0, t1 }
let rodHalf = 6;       // half-length of the rod in world units

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (timeline) layout();
}
window.addEventListener("resize", resize);

function clearLayout() {
  ticks.forEach((tk) => {
    scene.remove(tk.sprite);
    tk.sprite.material.map.dispose();
    tk.sprite.material.dispose();
  });
  ticks.length = 0;
  nodes.forEach((n) => {
    scene.remove(n.group);
    n.group.traverse((o) => {
      if (o.geometry && o.geometry !== hitGeo && o.geometry !== SHAPES.circle && o.geometry !== SHAPES.cube && o.geometry !== SHAPES.pyramid && o.geometry !== wireCircleGeo) {
        o.geometry.dispose();
      }
      if (o.material && o.material !== hitMat) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  });
  nodes.length = 0;
  hitMeshes.length = 0;
  hovered = null;
  if (tube) {
    rig.remove(tube);
    tube.children.forEach((m) => {
      m.material.dispose();
      m.geometry.dispose();
    });
    tube = null;
  }
}

// Size the rod so that, even fully seesawed and slid forward (and so
// magnified by perspective), its ends stay on screen.
function layout() {
  clearLayout();
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const halfVisible = CAM_Z * tanHalf * camera.aspect;
  const reach = halfVisible * SCREEN_FIT;
  rodHalf = (reach * (CAM_Z - MAX_FWD)) / (CAM_Z + reach * Math.sin(MAX_YAW));

  // pixel-based sizing for the rod thickness and node radius, same approach
  // as 3-axis-map — see its DEFAULT_NODE_PIXEL_RADIUS comment
  const worldUnitsPerPixel = (2 * CAM_Z * tanHalf) / renderer.domElement.clientHeight;
  const tubeRadius = (SKIN.lines.thickness || DEFAULT_LINE_PIXEL_THICKNESS) * worldUnitsPerPixel;
  const nodeR = SKIN.nodes.pixelRadius * worldUnitsPerPixel;
  SHAPES = {
    circle: new THREE.SphereGeometry(nodeR, 24, 16),
    cube: new THREE.BoxGeometry(nodeR * 1.5, nodeR * 1.5, nodeR * 1.5),
    pyramid: new THREE.ConeGeometry(nodeR * 1.33, nodeR * 2.17, 4)
  };
  wireCircleGeo = new THREE.SphereGeometry(nodeR, WIRE_CIRCLE_SEGMENTS[0], WIRE_CIRCLE_SEGMENTS[1]);
  hitGeo = new THREE.SphereGeometry(nodeR * HIT_RADIUS_MULTIPLE, 8, 6);

  const { data, t0, t1 } = timeline;
  const span = rodHalf * 2 * 0.92;
  const xOf = (t) => ((t - t0) / (t1 - t0) - 0.5) * span;
  data.forEach((d) => (d._x = xOf(d._t)));

  buildTube(-rodHalf, rodHalf, tubeRadius);
  buildTicks(t0, t1, scheme, xOf, span / (t1 - t0));
  buildNodes(data, xOf, nodeR);
}

// ---------- loop ----------
const clock = new THREE.Clock();
const nodePos = { x: 0, y: 0, z: 0 };

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // with motion.tilt off the rod and camera hold still: no seesaw, no
  // camera drift — hovering and clicking nodes work exactly the same
  const tilt = SKIN.motion.tilt !== false;
  camera.position.set(0, tilt ? 1.3 - (pointer.y / window.innerHeight - 0.5) * 0.5 : 1.3, CAM_Z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // where the cursor is along the rod drives the seesaw
  ndc.set((pointer.x / window.innerWidth) * 2 - 1, -(pointer.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const active = tilt && pointer.inside && raycaster.ray.intersectPlane(plane, hitPoint);
  if (active) {
    const u = Math.max(-1, Math.min(1, hitPoint.x / rodHalf));
    yaw.target = u * MAX_YAW;
    fwd.target = MAX_FWD;
    lift.target = Math.max(-1, Math.min(1, hitPoint.y / 4)) * 0.5;
  } else {
    yaw.target = 0;
    fwd.target = 0;
    lift.target = 0;
  }
  // sub-step so the springs stay stable on slow frames
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    stepSpring(yaw, dt / steps);
    stepSpring(fwd, dt / steps);
    stepSpring(lift, dt / steps);
  }

  if (tube) updateRig();

  ticks.forEach((tk) => {
    displace(tk.x, 0, nodePos);
    tk.sprite.position.set(tk.x + nodePos.x, nodePos.y - 0.6, nodePos.z);
  });

  nodes.forEach((n) => {
    displace(n.x, n.y0, nodePos);
    const bob = Math.sin(t * 1.4 + n.phase) * 0.06;
    n.group.position.set(n.x + nodePos.x, n.y0 + nodePos.y + bob, nodePos.z);
    n.core.rotation.y = t * 0.6 + n.phase;
    n.core.rotation.x = t * 0.3;
    const target = n === hovered || n === selected ? 1.6 : 1;
    n.scale += (target - n.scale) * Math.min(1, dt * 10);
    n.core.scale.copy(n.baseScale).multiplyScalar(n.scale);
  });

  if (pointer.inside) setHovered(pick());
  else setHovered(null);
  positionTooltip();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
function fail(msg) {
  const el = document.getElementById("error");
  el.textContent = msg;
  el.hidden = false;
}

async function load(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      imageCache[url] = img;
      resolve();
    };
    img.onerror = () => resolve(); // missing/broken image: that node just falls back to its flat color
    img.src = url;
  });
}

// loads whatever node images aren't already cached — called at boot for the
// skin's initial state, and again from __designer.applySkin() below, since
// a skin can turn useImages/imageToggle on live well after boot()'s own
// one-time preload already ran
function ensureImagesLoaded() {
  const urls = [...new Set(data.map((d) => d.image).filter(Boolean))].filter((url) => !imageCache[url]);
  return urls.length ? Promise.all(urls.map(preloadImage)) : Promise.resolve();
}

async function boot() {
  let config, nodesJson, categories;
  try {
    [config, nodesJson, categories] = await Promise.all([
      load("data/config.json").catch(() => ({})),
      load("data/nodes.json"),
      load("data/categories.json").catch(() => [])
    ]);
  } catch (err) {
    console.error(err);
    fail("Couldn't load timeline data. Serve this folder over http instead of opening the file directly.");
    return;
  }
  data = nodesJson;

  if (SHAPE_NAMES.includes(config.nodeShape)) defaultShape = config.nodeShape;
  scheme = ["year", "month", "day"].includes(config.dateScheme) ? config.dateScheme : "year";
  document.getElementById("title").textContent = config.title || "Timeline";
  document.getElementById("subtitle").textContent = config.subtitle || "";
  document.title = config.title || "Timeline";

  categories.forEach((c) => (categoriesById[c.id] = c));
  if (categories.length) {
    legend.hidden = false;
    categories.forEach((c) => {
      const row = document.createElement("span");
      row.className = "legend__item";
      row.innerHTML = `<span class="legend__swatch" style="background:${c.color};color:${c.color}"></span>`;
      row.append(c.name);
      legend.appendChild(row);
    });
  }

  const skinName = config.skin || "default";
  let skin = await load(`skins/${skinName}.json`).catch((skinErr) => {
    console.warn(`Couldn't load skin "${skinName}", using the built-in default.`, skinErr);
    return null;
  });
  // a folder can hold skins of both kinds; this page only takes 3d ones
  if (skin && skin.kind && skin.kind !== "3d") {
    console.warn(`Skin "${skinName}" is a ${skin.kind} skin, not a 3d one — using the built-in default.`);
    skin = null;
  }
  if (skin) {
    SKIN = {
      css: { ...SKIN.css, ...skin.css },
      lines: { ...SKIN.lines, ...skin.lines },
      labels: { ...SKIN.labels, ...skin.labels },
      nodes: { ...SKIN.nodes, ...skin.nodes },
      motion: { ...SKIN.motion, ...skin.motion }
    };
  }
  applySkinCSS();
  showImages = !!SKIN.nodes.useImages;
  updateImageToggleButton();
  designerReady();

  if (SKIN.nodes.useImages || SKIN.nodes.imageToggle) {
    await ensureImagesLoaded();
  }

  data = data.filter((d) => !isNaN(parseDate(d.date)));
  if (!data.length) {
    fail("No dated entries yet.");
    return;
  }
  data.forEach((d, i) => {
    d._t = parseDate(d.date);
    d._i = i;
  });

  const tMin = Math.min(...data.map((d) => d._t));
  const tMax = Math.max(...data.map((d) => d._t));
  const pad = Math.max((tMax - tMin) * 0.06, scheme === "year" ? 0.6 : 0.25);
  timeline = { data, t0: tMin - pad, t1: tMax + pad };

  resize();
  requestAnimationFrame(frame);
}

// ---------- designer hook ----------
// the designer tool loads this same page in a same-origin
// iframe and drives it through this tiny API — same mechanism as
// 3-axis-map/script.js
let designerReady = () => {};
const designerReadyPromise = new Promise((resolve) => {
  designerReady = resolve;
});
window.__designer = {
  ready: designerReadyPromise,
  // what the designer needs to know to build the right form: which kind
  // of skin this page takes and which optional features it can render
  meta: { label: "Timeline", kind: "3d", axes: 1, configKey: "skin", capabilities: ["minorLabels", "categoryColor", "sketch", "tilt"] },
  getSkin: () => SKIN,
  applySkin(partial) {
    const useImagesChanged = partial.nodes && partial.nodes.useImages !== SKIN.nodes.useImages;
    SKIN = {
      css: { ...SKIN.css, ...partial.css },
      lines: { ...SKIN.lines, ...partial.lines },
      labels: { ...SKIN.labels, ...partial.labels },
      nodes: { ...SKIN.nodes, ...partial.nodes },
      motion: { ...SKIN.motion, ...partial.motion }
    };
    applySkinCSS();
    if (useImagesChanged) showImages = !!SKIN.nodes.useImages;
    updateImageToggleButton();
    if (timeline) layout();
    if (SKIN.nodes.useImages || SKIN.nodes.imageToggle) {
      ensureImagesLoaded().then(() => {
        if (timeline) layout();
      });
    }
  }
};

boot();
