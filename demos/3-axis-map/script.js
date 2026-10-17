import * as THREE from "./vendor/three.module.min.js";

// ---------------------------------------------------------------------
// 3 Axis Map — a standalone three-axis scatter plot (X, Y, Z all equal
// length, forming a cube). Not wired into the editor; data/nodes.json
// and data/categories.json here are just a static sample dataset.
// ---------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const tooltip = $("tooltip");
const tooltipImage = $("tooltipImage");
const tooltipDate = $("tooltipDate");
const tooltipTitle = $("tooltipTitle");
const panel = $("panel");
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
const imageToggleBtn = $("imageToggleBtn");

// ---------- tuning ----------
const SCREEN_FIT = 0.92; // fraction of the screen the map may reach
// axis rod thickness, like node size, is defined in screen pixels (see
// DEFAULT_NODE_PIXEL_RADIUS below) so it reads the same regardless of
// window size. The actual radius is SKIN.lines.thickness (editable per
// skin); this is only the fallback if a skin doesn't set one.
const DEFAULT_AXIS_PIXEL_THICKNESS = 4;
const MIN_RADIUS = 4;
const MAX_RADIUS = 24;
const MIN_PHI = 0.12; // how close to straight-down/up the orbit may get
const MAX_PHI = Math.PI - 0.12;
const DRAG_ROTATE_SPEED = 0.006; // radians per pixel dragged
const CLICK_DRAG_THRESHOLD = 12; // px of movement before a pointerdown+up stops counting as a "click"
// node size is defined in actual screen pixels, not world units — the
// axis/grid auto-scales to fill whatever window it's in, but a node sized
// in fixed world units would NOT: the same code would draw a visibly
// bigger dot in a wide 1600px browser window than in a narrow 700px one,
// since more screen pixels end up covering the same patch of 3D space.
// Recomputed every layout() call from the live canvas size, so it looks
// the same size everywhere. The actual radius is SKIN.nodes.pixelRadius
// (editable per skin); this is only the fallback if a skin doesn't set one.
const DEFAULT_NODE_PIXEL_RADIUS = 10;
const HIT_RADIUS_MULTIPLE = 6.5; // click/hover target vs. the visible dot
let defaultShape = "circle"; // data/config.json "nodeShape"; a node's own "shape" wins

// axis pole labels — [negative end, positive end] per axis. Overridden by
// data/config.json's "axes" so this whole tool can be relabeled for a
// different dataset without touching code.
let AXIS_LABELS = {
  x: ["Irreverent", "Reverent"],
  y: ["Low Fidelity", "High Fidelity"],
  z: ["Ephemeral", "Archival"]
};

// a node's color either comes from which of the 8 regions (octant) of the
// cube it sits in — so color always tells you where something is, no
// legend needed — or, if the skin opts in, a fixed palette cycled by
// index. Never from category; that was the whole point of moving away
// from a theme-driven palette.
function nodeColor(d, i) {
  if (SKIN.nodes.colorMode === "palette" && SKIN.nodes.palette && SKIN.nodes.palette.length) {
    return new THREE.Color(SKIN.nodes.palette[i % SKIN.nodes.palette.length]);
  }
  const octant = (d.x >= 0 ? 1 : 0) | (d.y >= 0 ? 2 : 0) | ((d.z || 0) >= 0 ? 4 : 0);
  return new THREE.Color().setHSL(octant / 8, SKIN.nodes.saturation, SKIN.nodes.lightness);
}

// the color used for a node's outline/ring/wireframe lines — independent
// of the node's own fill color, except when nodes.outlineSource is "node",
// which makes the outline follow the same region/palette color source as
// the fill instead of a single flat color for every node
function outlineColorFor(d, i) {
  if (SKIN.nodes.outlineSource === "node") return `#${nodeColor(d, i).getHexString()}`;
  if (SKIN.nodes.outlineSource === "custom") return SKIN.nodes.outlineColor || SKIN.lines.color;
  return SKIN.lines.color; // "line" (default)
}

// ---------- skins ----------
// everything visual — background, line/label/node style — comes from a
// skins/<name>.json file named by data/config.json's "skin" field, so this
// whole tool can be reskinned without touching code. These are the
// defaults, overwritten once the chosen skin loads in boot().
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
  lines: { style: "chrome", color: "#a9cdff", thickness: DEFAULT_AXIS_PIXEL_THICKNESS },
  labels: { color: "#cfe6ff", glow: true, glowColor: "#4cb8ff" },
  nodes: {
    style: "glossy",
    fill: "solid",
    colorMode: "region",
    saturation: 0.62,
    lightness: 0.6,
    palette: [],
    outlineColor: "",
    outlineSource: "line", // "line" | "node" | "custom" — see outlineColorFor()
    pixelRadius: DEFAULT_NODE_PIXEL_RADIUS,
    useImages: false,
    imageToggle: false
  }
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

const content = new THREE.Group(); // rebuilt on resize
scene.add(content);

// ---------- orbit camera: click-and-drag to look around ----------
// standard spherical orbit around the origin; theta = azimuth (around the
// vertical axis), phi = polar angle from +Y (PI/2 ~= looking in head-on)
const orbit = { theta: 0, phi: Math.PI / 2, radius: 11 };

function applyOrbit() {
  const { theta, phi, radius } = orbit;
  camera.position.set(
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.cos(theta)
  );
  camera.lookAt(0, 0, 0);
}

// ---------- helpers ----------
function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = 'bold 30px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (SKIN.labels.glow) {
    ctx.shadowColor = SKIN.labels.glowColor;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = SKIN.labels.color;
  ctx.fillText(text.toUpperCase(), 192, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(2.4, 0.4, 1);
  return sprite;
}

// node geometry — (re)built every layout() call at a world-space size
// derived from SKIN.nodes.pixelRadius, since that depends on the live
// canvas size. Empty placeholders here; see layout().
const SHAPE_NAMES = ["circle", "cube", "pyramid"];
let SHAPES = { circle: null, cube: null, pyramid: null };
let hitGeo = null;
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

// a separate, much lower-segment sphere used only for "wireframe" circle
// nodes — SHAPES.circle's 24x16 segments (needed for a smooth lit look in
// every other fill mode) read as solid black once drawn as a wireframe at
// typical node sizes, so wireframe gets its own sparser geometry
const WIRE_CIRCLE_SEGMENTS = [8, 5];
let wireCircleGeo = null;

// "outline" node fill: a hollow ring for circles (billboarded, so it always
// reads as a clean circle regardless of viewing angle) or just the edges
// for cube/pyramid — no fill color, just linework, to match a skin where
// everything is drawn rather than colored in
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
// map would shimmer. Seeds are per node / per axis, so shapes still differ
// from one another.
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
// each node's wobble distinct; passing the same seed+pass again (as the
// image clip and its border do) retraces an identical path.
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

// "sketch" node fill: a hand-drawn-looking circle — two overlapping passes
// of a wobbly, irregular stroke instead of a clean arc, like a quick pen
// circle, optionally filled with the node's color first ("sketch-fill").
// Only circles get this treatment; cube/pyramid fall back to the normal
// clean edge outline (or a filled+edged mesh for the fill variant), since
// a wobbled box reads as broken rather than hand-drawn.
function makeSketchCircleSprite(outlineColorStr, diameter, fillColor, seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const cx = 64;
  const cy = 64;
  const r = 46;

  if (fillColor) {
    wobblyCirclePath(ctx, cx, cy, r, seed);
    ctx.fillStyle = `#${fillColor.getHexString()}`;
    ctx.fill();
  }

  ctx.strokeStyle = outlineColorStr;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    wobblyCirclePath(ctx, cx, cy, r, seed + pass * 2.4);
    ctx.stroke();
  }

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

// "solid-outline" node fill: filled with its color AND stroked with an
// outline — a sketchbook-doodle look, distinct from plain "solid" (no
// stroke) and "outline" (no fill)
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

// same idea, but with a loaded image (cover-fit, clipped to the circle)
// instead of a flat color — used when the skin opts into nodes.useImages
// and this particular node has one
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

// same as makeImageCircleSprite, but both the clip shape and the border are
// the same wobbly hand-drawn path instead of a clean arc — used in place of
// it whenever the active skin's node fill is one of the "sketch" styles, so
// a photo still reads as hand-drawn rather than snapping back to a clean
// circle the moment it loads
function makeSketchImageCircleSprite(img, outlineColorStr, diameter, seed) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  const cx = 64;
  const cy = 64;
  const r = 46;

  ctx.save();
  wobblyCirclePath(ctx, cx, cy, r, seed);
  ctx.clip();
  const box = 88;
  const scale = Math.max(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();

  ctx.strokeStyle = outlineColorStr;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 2; pass++) {
    wobblyCirclePath(ctx, cx, cy, r, seed + pass * 2.4);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

// cube/pyramid version of "solid-outline": the filled mesh plus its edges
// drawn as a separate overlay, grouped so they move/scale/rotate together
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

// picks how to build a node's visible "core" based on the active skin:
// an image (if opted in, available, and currently switched on), a
// wireframe shape, a filled+outlined shape, a plain outline, or a plain
// filled shape — in that priority order
function buildCore(d, i, shape, nodeR) {
  const outlineColorStr = outlineColorFor(d, i);
  const isSketch = SKIN.nodes.fill === "sketch" || SKIN.nodes.fill === "sketch-fill";
  if (showImages && d.image && imageCache[d.image]) {
    return isSketch
      ? makeSketchImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.4, (i + 1) * 1.37)
      : makeImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.2);
  }
  if (SKIN.nodes.fill === "wireframe") {
    const geo = shape === "circle" ? wireCircleGeo : SHAPES[shape];
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(outlineColorStr), wireframe: true }));
  }
  if (SKIN.nodes.fill === "outline") return outlineNode(outlineColorStr, shape, nodeR);
  if (isSketch) {
    const fillColor = SKIN.nodes.fill === "sketch-fill" ? nodeColor(d, i) : null;
    return sketchNode(outlineColorStr, shape, nodeR, fillColor, (i + 1) * 1.37);
  }
  if (SKIN.nodes.fill === "solid-outline") {
    const color = nodeColor(d, i);
    return shape === "circle"
      ? makeFilledCircleSprite(color, outlineColorStr, nodeR * 2.2)
      : makeSolidOutlinedMesh(shape, color, outlineColorStr);
  }
  return new THREE.Mesh(SHAPES[shape], nodeMaterial(nodeColor(d, i), shape));
}

// axis bars: "chrome" is the glossy lit look, "flat" is solid and
// unaffected by scene lighting — proper "flat lines" rather than just a
// dark-colored glossy material
function chrome() {
  const color = new THREE.Color(SKIN.lines.color);
  if (SKIN.lines.style === "wireframe") return new THREE.MeshBasicMaterial({ color, wireframe: true });
  if (SKIN.lines.style === "flat" || SKIN.lines.style === "sketch") return new THREE.MeshBasicMaterial({ color });
  return new THREE.MeshPhongMaterial({ color, specular: 0xffffff, shininess: 140, emissive: color.clone().multiplyScalar(0.08) });
}

// "sketch" axis rod: a tube following a gently wobbly path instead of a
// straight cylinder, for a hand-drawn line look. axis is "x"/"y"/"z" — the
// direction the rod runs; the other two dimensions get the wobble.
function sketchAxisPoints(axis, half, radius) {
  const segments = 14;
  const points = [];
  const axisSeed = { x: 11.1, y: 22.2, z: 33.3 }[axis];
  const rand = seededRandom(axisSeed);
  const seedA = rand() * 10;
  const seedB = rand() * 10;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments - 0.5; // -0.5..0.5 along the rod
    const main = t * half * 2;
    const wobble1 = Math.sin(t * Math.PI * 5 + seedA) * radius * 1.4 + (rand() - 0.5) * radius;
    const wobble2 = Math.cos(t * Math.PI * 4 + seedB) * radius * 1.4 + (rand() - 0.5) * radius;
    const v = new THREE.Vector3();
    if (axis === "x") v.set(main, wobble1, wobble2);
    else if (axis === "y") v.set(wobble1, main, wobble2);
    else v.set(wobble1, wobble2, main);
    points.push(v);
  }
  return points;
}

function buildSketchAxis(axis, half, radius, material) {
  const curve = new THREE.CatmullRomCurve3(sketchAxisPoints(axis, half, radius));
  const geo = new THREE.TubeGeometry(curve, 36, radius, 8, false);
  return new THREE.Mesh(geo, material);
}

// node fill: "flat" is solid and unlit (bold, poster-like color with no
// shading gradient), "glossy" keeps the lit, highlighted look
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

let data = [];
let categoriesById = {};
let imageCache = {}; // url -> loaded HTMLImageElement, filled in boot() before the first layout()
// whether nodes currently render as photos or as their color fill — starts
// from SKIN.nodes.useImages, but SKIN.nodes.imageToggle lets the viewer
// flip it live via imageToggleBtn, independent of that starting default
let showImages = false;

// shows/hides and relabels the viewer-facing photo/color switch, based on
// whether the skin opted into it and whether any node actually has an image
function updateImageToggleButton() {
  const hasImages = data.some((d) => d.image);
  imageToggleBtn.hidden = !(SKIN.nodes.imageToggle && hasImages);
  imageToggleBtn.textContent = showImages ? "Hide Photos" : "Show Photos";
}

imageToggleBtn.addEventListener("click", () => {
  showImages = !showImages;
  updateImageToggleButton();
  if (data.length) layout();
});

const nodes = [];
const hitMeshes = [];
let hovered = null;
let selected = null;
let halfW = 6;
let halfH = 4;

// ---------- layout ----------
function layout() {
  // dispose everything from the previous build — geometries may be shared
  // (SHAPES/hitGeo, reused across every node of that shape) so dispose()
  // gets called on the same instance more than once here; that's a
  // harmless no-op in three.js, simpler than tracking what's already gone
  content.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && o.material !== hitMat) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  content.clear();
  nodes.length = 0;
  hitMeshes.length = 0;
  hovered = null;

  // all three axes share one extent, so x/y/z form a true cube rather than
  // a flat board with a shallow z — sized to fit the tighter screen dimension
  // at the default orbit distance
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const reachY = orbit.radius * tanHalf * SCREEN_FIT * 0.86; // leave room for the header
  const reachX = orbit.radius * tanHalf * camera.aspect * SCREEN_FIT;
  const half = Math.min(reachX, reachY);
  halfW = half;
  halfH = half;
  const halfD = half;

  // node size in world units, derived from a fixed PIXEL size so it reads
  // the same regardless of the actual window/canvas dimensions — the
  // world-space height visible at the content plane is 2*orbit.radius*tanHalf,
  // spread across the canvas's actual CSS pixel height
  const worldUnitsPerPixel = (2 * orbit.radius * tanHalf) / renderer.domElement.clientHeight;
  const nodeR = SKIN.nodes.pixelRadius * worldUnitsPerPixel;
  SHAPES = {
    circle: new THREE.SphereGeometry(nodeR, 24, 16),
    cube: new THREE.BoxGeometry(nodeR * 1.5, nodeR * 1.5, nodeR * 1.5),
    pyramid: new THREE.ConeGeometry(nodeR * 1.33, nodeR * 2.17, 4)
  };
  wireCircleGeo = new THREE.SphereGeometry(nodeR, WIRE_CIRCLE_SEGMENTS[0], WIRE_CIRCLE_SEGMENTS[1]);
  hitGeo = new THREE.SphereGeometry(nodeR * HIT_RADIUS_MULTIPLE, 8, 6);

  // axis rod thickness, same pixel-based sizing as node radius above
  const axisRadius = (SKIN.lines.thickness || DEFAULT_AXIS_PIXEL_THICKNESS) * worldUnitsPerPixel;
  // a wireframe cylinder with the usual 20 radial segments reads as a dense
  // tube rather than a cage, so it gets fewer segments too
  const axisSegments = SKIN.lines.style === "wireframe" ? 8 : 20;

  // chrome axes — x, y, and now z all cross through the board's center
  let xAxis, yAxis, zAxis;
  if (SKIN.lines.style === "sketch") {
    xAxis = buildSketchAxis("x", halfW, axisRadius, chrome());
    yAxis = buildSketchAxis("y", halfH, axisRadius, chrome());
    zAxis = buildSketchAxis("z", halfD, axisRadius, chrome());
  } else {
    xAxis = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, halfW * 2, axisSegments, 1), chrome());
    xAxis.rotation.z = Math.PI / 2;
    yAxis = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, halfH * 2, axisSegments, 1), chrome());
    zAxis = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, halfD * 2, axisSegments, 1), chrome());
    zAxis.rotation.x = Math.PI / 2;
  }
  content.add(xAxis, yAxis, zAxis);

  // axis end labels — negative pole first, positive pole second, per axis
  const labels = [
    [AXIS_LABELS.x[0], -halfW + 1.3, -0.3, 0],
    [AXIS_LABELS.x[1], halfW - 1.3, -0.3, 0],
    [AXIS_LABELS.y[1], 0, halfH - 0.3, 0],
    [AXIS_LABELS.y[0], 0, -halfH + 0.3, 0],
    // data z is -1 (negative pole) to 1 (positive pole); the negative pole
    // sits toward +world-z, the positive pole recedes toward -world-z
    [AXIS_LABELS.z[0], 0.4, 0.3, halfD + 0.5],
    [AXIS_LABELS.z[1], 0.4, 0.3, -halfD - 0.5]
  ];
  labels.forEach(([text, x, y, z]) => {
    const s = makeLabel(text);
    s.position.set(x, y, z + 0.05);
    content.add(s);
  });

  // nodes
  data.forEach((d, i) => {
    const shape = SHAPES[d.shape] ? d.shape : defaultShape;
    const group = new THREE.Group();
    const core = buildCore(d, i, shape, nodeR);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    group.add(core, hit);
    // the 0.9 factor matches on all three axes, so a node at the x/y/z
    // extremes sits the same fraction of the way to each face of the cube
    group.position.set(d.x * halfW * 0.9, d.y * halfH * 0.9, -(d.z || 0) * halfD * 0.9);
    content.add(group);
    // core.scale may already encode the node's actual size — sprite-based
    // fills (outline, solid-outline, sketch, image) set it via
    // scale.set(diameter, diameter, 1) when built, while mesh-based fills
    // (solid, wireframe) bake size into the geometry and leave scale at its
    // (1, 1, 1) default. Captured here so the hover/select pulse below can
    // multiply on top of it instead of overwriting it — see frame().
    const baseScale = core.scale.clone();
    const node = { data: d, group, core, hit, scale: 1, baseScale, phase: i * 1.7 };
    hit.userData.node = node;
    hitMeshes.push(hit);
    nodes.push(node);
  });
}

// ---------- interaction: drag to orbit, click (no drag) to select ----------
const pointer = { x: -1, y: -1, inside: false };
const drag = { active: false, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: 0, startTheta: 0, startPhi: 0 };
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function updatePointer(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
}

canvas.addEventListener("pointerdown", (e) => {
  updatePointer(e);
  drag.active = true;
  drag.startX = drag.lastX = e.clientX;
  drag.startY = drag.lastY = e.clientY;
  drag.moved = 0;
  drag.startTheta = orbit.theta;
  drag.startPhi = orbit.phi;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add("is-dragging");
});

canvas.addEventListener("pointermove", (e) => {
  updatePointer(e);
  if (!drag.active) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  // track the farthest distance reached from the start point — not an
  // accumulator. Summing every intermediate move's distance-from-start was
  // a bug: a pointer that fires several move events during ordinary click
  // jitter (very common, especially on trackpads) could rack up well past
  // the threshold despite barely moving, silently turning real clicks into
  // "drags" that never select anything
  const distFromStart = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
  drag.moved = Math.max(drag.moved, distFromStart);
  orbit.theta -= dx * DRAG_ROTATE_SPEED;
  orbit.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, orbit.phi - dy * DRAG_ROTATE_SPEED));
  tooltip.hidden = true;
});

canvas.addEventListener("pointerup", (e) => {
  updatePointer(e);
  canvas.classList.remove("is-dragging");
  const wasClick = drag.active && drag.moved < CLICK_DRAG_THRESHOLD;
  drag.active = false;
  if (!wasClick) return;
  const hit = pick();
  if (hit) selectNode(hit);
  else closePanel();
});

canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse" && !drag.active) pointer.inside = false;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    orbit.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, orbit.radius + e.deltaY * 0.01));
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

function pick() {
  ndc.set((pointer.x / window.innerWidth) * 2 - 1, -(pointer.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  return hits.length ? hits[0].object.userData.node : null;
}

function regionLabel(d) {
  const x = AXIS_LABELS.x[d.x >= 0 ? 1 : 0];
  const y = AXIS_LABELS.y[d.y >= 0 ? 1 : 0];
  const z = AXIS_LABELS.z[(d.z || 0) >= 0 ? 1 : 0];
  return `${x} · ${y} · ${z}`;
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
  tooltipDate.textContent = regionLabel(d);
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
  panelDate.textContent = regionLabel(d);
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
$("panelClose").addEventListener("click", closePanel);

// ---------- loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (data.length) layout();
}
window.addEventListener("resize", resize);

const clock = new THREE.Clock();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  applyOrbit();

  nodes.forEach((n) => {
    n.core.rotation.y = t * 0.6 + n.phase;
    n.core.rotation.x = t * 0.3;
    n.core.position.z = Math.sin(t * 1.4 + n.phase) * 0.04;
    const target = n === hovered || n === selected ? 1.6 : 1;
    n.scale += (target - n.scale) * Math.min(1, dt * 10);
    n.core.scale.copy(n.baseScale).multiplyScalar(n.scale);
  });

  if (pointer.inside && !drag.active) setHovered(pick());
  else if (!pointer.inside) setHovered(null);
  positionTooltip();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
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

// loads whatever node images aren't already cached. Called from boot() for
// the skin's initial state, and again from __designer.applySkin() below —
// a skin can turn useImages/imageToggle on live (e.g. while authoring one in
// the editor), well after boot()'s own one-time preload already ran, and
// without this those nodes would have no image to show until a full reload
function ensureImagesLoaded() {
  const urls = [...new Set(data.map((d) => d.image).filter(Boolean))].filter((url) => !imageCache[url]);
  return urls.length ? Promise.all(urls.map(preloadImage)) : Promise.resolve();
}

async function boot() {
  try {
    const [nodesJson, categories] = await Promise.all([load("data/nodes.json"), load("data/categories.json").catch(() => [])]);
    data = nodesJson;
    const config = await load("data/config.json").catch(() => ({}));
    if (SHAPE_NAMES.includes(config.nodeShape)) defaultShape = config.nodeShape;
    if (config.axes) {
      AXIS_LABELS = {
        x: config.axes.x || AXIS_LABELS.x,
        y: config.axes.y || AXIS_LABELS.y,
        z: config.axes.z || AXIS_LABELS.z
      };
    }
    if (config.title) {
      document.title = config.title;
      $("title").textContent = config.title;
    }
    if (config.subtitle) $("subtitle").textContent = config.subtitle;
    categories.forEach((c) => (categoriesById[c.id] = c));

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
        nodes: { ...SKIN.nodes, ...skin.nodes }
      };
      // skins saved before outlineSource existed only ever set
      // outlineColor directly — infer "custom" for those so they keep
      // rendering exactly as before, instead of silently reverting to the
      // new "line" default
      if (skin.nodes && skin.nodes.outlineColor && !("outlineSource" in skin.nodes)) {
        SKIN.nodes.outlineSource = "custom";
      }
    }
    applySkinCSS();
    showImages = !!SKIN.nodes.useImages;
    updateImageToggleButton();
    designerReady();

    if (SKIN.nodes.useImages || SKIN.nodes.imageToggle) {
      await ensureImagesLoaded();
    }
  } catch (err) {
    console.error(err);
    const el = $("error");
    el.textContent = "Couldn't load data. Serve this folder over http instead of opening the file directly.";
    el.hidden = false;
    return;
  }
  applyViewFromURL();
  resize();
  requestAnimationFrame(frame);
}

// an optional starting view from the URL — e.g. ?theta=0.7&phi=1.15&radius=12
// — so a link can open the map at an angle instead of head-on (head-on hides
// the third axis behind the middle of the map)
function applyViewFromURL() {
  const params = new URLSearchParams(location.search);
  const number = (key) => {
    const value = parseFloat(params.get(key));
    return Number.isFinite(value) ? value : null;
  };
  const theta = number("theta");
  const phi = number("phi");
  const radius = number("radius");
  if (theta !== null) orbit.theta = theta;
  if (phi !== null) orbit.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, phi));
  if (radius !== null) orbit.radius = Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radius));
}

// ---------- designer hook ----------
// the designer tool loads this same page in a same-origin
// iframe and drives it through this tiny API, so skin edits preview live
// without duplicating any rendering code. `meta` tells it which kind of skin
// this page takes and what it can render. Unused by the app on its own —
// harmless if nothing ever calls it.
let designerReady = () => {};
const designerReadyPromise = new Promise((resolve) => {
  designerReady = resolve;
});
window.__designer = {
  ready: designerReadyPromise,
  // what the designer needs to know to build the right form: which kind
  // of skin this page takes and which optional features it can render
  meta: { label: "3 Axis Map", kind: "3d", axes: 3, configKey: "skin", capabilities: ["sketch", "regionColor"] },
  getSkin: () => SKIN,
  applySkin(partial) {
    // only reset the live photo/color state when the editor's "use images"
    // checkbox itself actually changed — the editor always resends the
    // whole nodes object on every edit, so comparing old vs. new here keeps
    // a manual click on imageToggleBtn (while testing it in the preview)
    // from being undone by an unrelated tweak elsewhere in the form
    const useImagesChanged = partial.nodes && partial.nodes.useImages !== SKIN.nodes.useImages;
    SKIN = {
      css: { ...SKIN.css, ...partial.css },
      lines: { ...SKIN.lines, ...partial.lines },
      labels: { ...SKIN.labels, ...partial.labels },
      nodes: { ...SKIN.nodes, ...partial.nodes }
    };
    applySkinCSS();
    if (useImagesChanged) showImages = !!SKIN.nodes.useImages;
    updateImageToggleButton();
    if (data.length) layout();
    // turning useImages/imageToggle on live (e.g. while authoring a skin)
    // can happen well after boot()'s one-time preload already ran, so make
    // sure anything newly needed gets loaded — then re-layout once it's in,
    // since the immediate layout() above only has whatever was cached before
    if (SKIN.nodes.useImages || SKIN.nodes.imageToggle) {
      ensureImagesLoaded().then(() => {
        if (data.length) layout();
      });
    }
  }
};

boot();
