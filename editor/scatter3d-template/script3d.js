import * as THREE from "./vendor/three.module.min.js";

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
const legend = $("legend");
const imageToggleBtn = $("imageToggleBtn");

// ---------- tuning ----------
const CAM_Z = 11;
const MAX_YAW = 0.16;      // radians the map can tilt left/right
const MAX_PITCH = 0.16;    // radians the map can tilt up/down
const MAX_FWD = 1.4;       // how far the map slides toward the viewer
const SCREEN_FIT = 0.92;   // fraction of the screen the map may reach
// line thickness and node size are defined in actual screen pixels, not
// world units, so they read the same regardless of window size — see
// 3-axis-map/script.js for the fuller explanation of why. Recomputed every
// layout() call; these are only the fallbacks if a skin doesn't set one.
const DEFAULT_LINE_PIXEL_THICKNESS = 3;
const DEFAULT_NODE_PIXEL_RADIUS = 12;
const HIT_RADIUS_MULTIPLE = 4.5; // click/hover target vs. the visible dot
const AXIS_SIDES = 20;
const WIRE_AXIS_SIDES = 8; // fewer radial segments when wireframe, or it reads as a dense tube rather than a cage
const WIRE_CIRCLE_SEGMENTS = [8, 5]; // sparse sphere just for wireframe circle nodes
let defaultShape = "circle"; // data/config.json "nodeShape"; a node's own "shape" wins

const QUADRANTS = [
  { key: "irreverentHigh", sx: -1, sy: 1 },
  { key: "reverentHigh", sx: 1, sy: 1 },
  { key: "irreverentLow", sx: -1, sy: -1 },
  { key: "reverentLow", sx: 1, sy: -1 }
];

// ---------- skins ----------
// everything visual — background, line/label/node style, the quadrant
// panes, whether the map tilts — comes from a skins/<name>.json file named
// by data/config.json's "skin" field (the flat page has its own, "skin2d").
// Same schema as the other 3D maps, so a 3D skin works on all of them;
// colorMode "category" because nodes here are colored by what they are.
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
  labels: { color: "#cfe6ff", glow: true, glowColor: "#4cb8ff" },
  nodes: {
    style: "glossy",
    fill: "solid",
    colorMode: "category",
    palette: [],
    outlineColor: "",
    outlineSource: "line",
    pixelRadius: DEFAULT_NODE_PIXEL_RADIUS,
    useImages: false,
    imageToggle: false
  },
  // the four tinted panes behind the quadrants
  quadrants: {
    show: false,
    opacity: 0.1,
    irreverentHigh: "#f0abfc",
    reverentHigh: "#7dd3fc",
    irreverentLow: "#fbbf24",
    reverentLow: "#34d399"
  },
  // the map normally tilts and slides toward the cursor; a skin can turn
  // that off for a calmer, static map
  motion: { tilt: true }
};

function mergeSkin(base, skin) {
  return {
    css: { ...base.css, ...skin.css },
    lines: { ...base.lines, ...skin.lines },
    labels: { ...base.labels, ...skin.labels },
    nodes: { ...base.nodes, ...skin.nodes },
    quadrants: { ...base.quadrants, ...skin.quadrants },
    motion: { ...base.motion, ...skin.motion }
  };
}

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

// a node's color comes from its category by default, or — if the skin opts
// in — a fixed palette cycled by the node's position in data/nodes.json
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

// ---------- stiff rig: the whole map is one rigid body ----------
function makeSpring(k, zeta) {
  return { v: 0, vel: 0, target: 0, k, c: 2 * zeta * Math.sqrt(k) };
}
function stepSpring(s, dt) {
  s.vel += (s.k * (s.target - s.v) - s.c * s.vel) * dt;
  s.v += s.vel * dt;
}
const yaw = makeSpring(70, 0.55);
const pitch = makeSpring(70, 0.55);
const fwd = makeSpring(60, 0.6);

const rig = new THREE.Group();
scene.add(rig);
const content = new THREE.Group(); // rebuilt on resize
rig.add(content);

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

// small seeded generator (mulberry32): a hand-drawn shape has to come out
// the same every time the scene rebuilds, or every slider tick in the skin
// editor (and every window resize) would re-roll every wobble and the whole
// map would shimmer. Seeds are per node / per axis, so shapes still differ.
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

// ---------- lines ----------
// "chrome" is the glossy lit look, "flat" is solid and unaffected by scene
// lighting, "wireframe" is just the tube's edges, "sketch" is flat too (its
// hand-drawn look comes from the wobbly geometry, see buildSketchAxis)
function lineMaterial() {
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
  const rand = seededRandom({ x: 11.1, y: 22.2, z: 33.3 }[axis]);
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

function makeAxis(axis, half, radius) {
  if (SKIN.lines.style === "sketch") {
    const curve = new THREE.CatmullRomCurve3(sketchAxisPoints(axis, half, radius));
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 36, radius, 8, false), lineMaterial());
  }
  const sides = SKIN.lines.style === "wireframe" ? WIRE_AXIS_SIDES : AXIS_SIDES;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, half * 2, sides, 1), lineMaterial());
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// ---------- node core rendering ----------
// mirrors the other 3D maps: solid, outline-only, solid+outline, wireframe,
// hand-drawn sketch, or an image thumbnail — all sharing one fill/outline
// schema so a skin reads the same everywhere
const SHAPE_NAMES = ["circle", "cube", "pyramid"];
let SHAPES = { circle: null, cube: null, pyramid: null };
let wireCircleGeo = null;
let hitGeo = null;
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

function canvasSprite(c, diameter) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(diameter, diameter, 1);
  return sprite;
}

function newCanvas() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  return c;
}

function makeRingSprite(colorStr, diameter) {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  return canvasSprite(c, diameter);
}

function makeEdgeOutline(shape, color) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(SHAPES[shape]), new THREE.LineBasicMaterial({ color }));
}

function outlineNode(colorStr, shape, nodeR) {
  if (shape === "circle") return makeRingSprite(colorStr, nodeR * 2.2);
  return makeEdgeOutline(shape, new THREE.Color(colorStr));
}

// traces one wobbly pass of a hand-drawn circle onto a 2D context — shared
// by every "sketch" drawing below (plain circle, filled circle, image
// border) so they all wobble the same way. Retracing with the same seed (as
// the image clip and its border do) repeats the same shape.
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
  const c = newCanvas();
  const ctx = c.getContext("2d");
  if (fillColor) {
    wobblyCirclePath(ctx, 64, 64, 46, seed);
    ctx.fillStyle = `#${fillColor.getHexString()}`;
    ctx.fill();
  }
  strokeSketchCircle(ctx, outlineColorStr, 64, 64, 46, seed);
  return canvasSprite(c, diameter);
}

function sketchNode(colorStr, shape, nodeR, fillColor, seed) {
  if (shape === "circle") return makeSketchCircleSprite(colorStr, nodeR * 2.4, fillColor, seed);
  if (fillColor) return makeSolidOutlinedMesh(shape, fillColor, colorStr);
  return makeEdgeOutline(shape, new THREE.Color(colorStr));
}

function makeFilledCircleSprite(fillColor, outlineColorStr, diameter) {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.fillStyle = `#${fillColor.getHexString()}`;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = outlineColorStr;
  ctx.stroke();
  return canvasSprite(c, diameter);
}

// cover-fit a loaded image into a circle (the clip is applied by the caller)
function drawCoverImage(ctx, img) {
  const box = 88;
  const scale = Math.max(box / img.width, box / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, 64 - w / 2, 64 - h / 2, w, h);
}

function makeImageCircleSprite(img, outlineColorStr, diameter) {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  drawCoverImage(ctx, img);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(64, 64, 44, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = outlineColorStr;
  ctx.stroke();
  return canvasSprite(c, diameter);
}

// same, but both the clip shape and the border use the wobbly hand-drawn
// path — used whenever the skin's node fill is one of the "sketch" styles
function makeSketchImageCircleSprite(img, outlineColorStr, diameter, seed) {
  const c = newCanvas();
  const ctx = c.getContext("2d");
  ctx.save();
  wobblyCirclePath(ctx, 64, 64, 46, seed);
  ctx.clip();
  drawCoverImage(ctx, img);
  ctx.restore();
  strokeSketchCircle(ctx, outlineColorStr, 64, 64, 46, seed);
  return canvasSprite(c, diameter);
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
  const seed = (d._i + 1) * 1.37;
  if (showImages && d.image && imageCache[d.image]) {
    return isSketch
      ? makeSketchImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.4, seed)
      : makeImageCircleSprite(imageCache[d.image], outlineColorStr, nodeR * 2.2);
  }
  if (SKIN.nodes.fill === "wireframe") {
    const geo = shape === "circle" ? wireCircleGeo : SHAPES[shape];
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(outlineColorStr), wireframe: true }));
  }
  if (SKIN.nodes.fill === "outline") return outlineNode(outlineColorStr, shape, nodeR);
  if (isSketch) return sketchNode(outlineColorStr, shape, nodeR, SKIN.nodes.fill === "sketch-fill" ? nodeColor(d) : null, seed);
  if (SKIN.nodes.fill === "solid-outline") {
    const color = nodeColor(d);
    return shape === "circle"
      ? makeFilledCircleSprite(color, outlineColorStr, nodeR * 2.2)
      : makeSolidOutlinedMesh(shape, color, outlineColorStr);
  }
  return new THREE.Mesh(SHAPES[shape], nodeMaterial(nodeColor(d), shape));
}

let data = [];
let categoriesById = {};
let imageCache = {}; // url -> loaded HTMLImageElement
// whether nodes currently render as photos or as their color fill — starts
// from SKIN.nodes.useImages, but SKIN.nodes.imageToggle lets the viewer
// flip it live via imageToggleBtn, independent of that starting default
let showImages = false;
const nodes = [];
const hitMeshes = [];
let hovered = null;
let selected = null;
let halfW = 6;
let halfH = 4;

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

  // size the map so its corners stay on screen even fully tilted and slid forward
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const reachY = CAM_Z * tanHalf * SCREEN_FIT * 0.86; // leave room for the header/legend
  const reachX = CAM_Z * tanHalf * camera.aspect * SCREEN_FIT;
  const worstZ = MAX_FWD + reachX * Math.sin(MAX_YAW) + reachY * Math.sin(MAX_PITCH);
  const shrink = (CAM_Z - worstZ) / CAM_Z;
  halfW = Math.min(reachX * shrink, reachY * shrink * 1.7);
  halfH = reachY * shrink;

  // pixel-based sizing for the line thickness and node radius
  const worldUnitsPerPixel = (2 * CAM_Z * tanHalf) / renderer.domElement.clientHeight;
  const nodeR = SKIN.nodes.pixelRadius * worldUnitsPerPixel;
  const lineR = (SKIN.lines.thickness || DEFAULT_LINE_PIXEL_THICKNESS) * worldUnitsPerPixel;
  SHAPES = {
    circle: new THREE.SphereGeometry(nodeR, 24, 16),
    cube: new THREE.BoxGeometry(nodeR * 1.5, nodeR * 1.5, nodeR * 1.5),
    pyramid: new THREE.ConeGeometry(nodeR * 1.33, nodeR * 2.17, 4)
  };
  wireCircleGeo = new THREE.SphereGeometry(nodeR, WIRE_CIRCLE_SEGMENTS[0], WIRE_CIRCLE_SEGMENTS[1]);
  hitGeo = new THREE.SphereGeometry(nodeR * HIT_RADIUS_MULTIPLE, 8, 6);

  // tinted quadrant panes
  if (SKIN.quadrants.show) {
    QUADRANTS.forEach((q) => {
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(halfW, halfH),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(SKIN.quadrants[q.key]),
          transparent: true,
          opacity: SKIN.quadrants.opacity,
          depthWrite: false
        })
      );
      pane.position.set((q.sx * halfW) / 2, (q.sy * halfH) / 2, -0.02);
      content.add(pane);
    });
  }

  // axes
  content.add(makeAxis("x", halfW, lineR), makeAxis("y", halfH, lineR));

  // axis end labels
  const labels = [
    ["Irreverent", -halfW + 1.3, -0.3],
    ["Reverent", halfW - 1.3, -0.3],
    ["High Fidelity", 0, halfH - 0.3],
    ["Low Fidelity", 0, -halfH + 0.3]
  ];
  labels.forEach(([text, x, y]) => {
    const s = makeLabel(text);
    s.position.set(x, y, 0.05);
    content.add(s);
  });

  // nodes
  data.forEach((d, i) => {
    const shape = SHAPES[d.shape] ? d.shape : defaultShape;
    const group = new THREE.Group();
    const core = buildCore(d, shape, nodeR);
    const hit = new THREE.Mesh(hitGeo, hitMat);
    group.add(core, hit);
    // two axes only: every node sits on the x/y plane, just in front of it
    group.position.set(d.x * halfW * 0.9, d.y * halfH * 0.9, 0.15);
    content.add(group);
    // core.scale may already encode the node's actual size — sprite-based
    // fills (outline, solid-outline, sketch, image) set it via
    // scale.set(diameter, diameter, 1) when built, while mesh-based fills
    // (solid, wireframe) bake size into the geometry and leave scale at
    // (1, 1, 1). Captured so the hover/select pulse in frame() multiplies
    // on top of it instead of overwriting it.
    const baseScale = core.scale.clone();
    const node = { data: d, group, core, hit, scale: 1, baseScale, phase: i * 1.7 };
    hit.userData.node = node;
    hitMeshes.push(hit);
    nodes.push(node);
  });
}

// ---------- interaction ----------
const pointer = { x: -1, y: -1, inside: false };
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function updatePointer(e) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.inside = true;
}
canvas.addEventListener("pointermove", updatePointer);
canvas.addEventListener("pointerdown", updatePointer);
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse") pointer.inside = false;
});
canvas.addEventListener("pointerup", (e) => {
  updatePointer(e);
  const hit = pick();
  if (hit) selectNode(hit);
  else closePanel();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePanel();
});

function pick() {
  ndc.set((pointer.x / window.innerWidth) * 2 - 1, -(pointer.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  return hits.length ? hits[0].object.userData.node : null;
}

function quadrantLabel(d) {
  return `${d.x >= 0 ? "Reverent" : "Irreverent"} · ${d.y >= 0 ? "High" : "Low"} fidelity`;
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
  tooltipDate.textContent = quadrantLabel(d);
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
  panelDate.textContent = quadrantLabel(d);
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

  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // cursor position over the map drives the tilt: the side you point at
  // comes forward. With motion.tilt off the map holds still instead —
  // hovering and clicking nodes work exactly the same.
  if (SKIN.motion.tilt !== false && pointer.inside) {
    const u = Math.max(-1, Math.min(1, (pointer.x / window.innerWidth - 0.5) * 2));
    const v = Math.max(-1, Math.min(1, -(pointer.y / window.innerHeight - 0.5) * 2));
    yaw.target = u * MAX_YAW;
    pitch.target = v * MAX_PITCH;
    fwd.target = MAX_FWD;
  } else {
    yaw.target = pitch.target = fwd.target = 0;
  }
  for (let i = 0; i < 4; i++) {
    stepSpring(yaw, dt / 4);
    stepSpring(pitch, dt / 4);
    stepSpring(fwd, dt / 4);
  }
  rig.rotation.set(pitch.v, -yaw.v, 0);
  rig.position.z = fwd.v;

  nodes.forEach((n) => {
    n.core.rotation.y = t * 0.6 + n.phase;
    n.core.rotation.x = t * 0.3;
    n.core.position.z = Math.sin(t * 1.4 + n.phase) * 0.04;
    const target = n === hovered || n === selected ? 1.6 : 1;
    n.scale += (target - n.scale) * Math.min(1, dt * 10);
    n.core.scale.copy(n.baseScale).multiplyScalar(n.scale);
  });

  rig.updateMatrixWorld(true);
  if (pointer.inside) setHovered(pick());
  else setHovered(null);
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

// loads whatever node images aren't already cached — called at boot for the
// skin's initial state, and again from __designer.applySkin() below, since
// a skin can turn useImages/imageToggle on live well after boot()'s own
// one-time preload already ran
function ensureImagesLoaded() {
  const urls = [...new Set(data.map((d) => d.image).filter(Boolean))].filter((url) => !imageCache[url]);
  return urls.length ? Promise.all(urls.map(preloadImage)) : Promise.resolve();
}

async function boot() {
  try {
    const [nodesJson, categories] = await Promise.all([load("data/nodes.json"), load("data/categories.json").catch(() => [])]);
    data = nodesJson;
    data.forEach((d, i) => (d._i = i));
    const config = await load("data/config.json").catch(() => ({}));
    if (SHAPE_NAMES.includes(config.nodeShape)) defaultShape = config.nodeShape;
    // optional page text from data/config.json
    if (config.title) {
      $("title").textContent = config.title;
      document.title = config.title;
    }
    if (typeof config.subtitle === "string") $("subtitle").textContent = config.subtitle;
    categories.forEach((c) => (categoriesById[c.id] = c));
    if (categories.length && config.showLegend !== false) {
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
    if (skin) SKIN = mergeSkin(SKIN, skin);
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
  resize();
  requestAnimationFrame(frame);
}

// ---------- designer hook ----------
// the designer tool loads this same page in a same-origin
// iframe and drives it through this tiny API, so skin edits preview live
// without duplicating any rendering code. `meta` tells it which kind of
// skin this page takes and what it can render. Unused by the app on its own
// — harmless if nothing ever calls it.
let designerReady = () => {};
const designerReadyPromise = new Promise((resolve) => {
  designerReady = resolve;
});
window.__designer = {
  ready: designerReadyPromise,
  meta: {
    label: "Portfolio Map (3D)",
    kind: "3d",
    axes: 2,
    configKey: "skin",
    capabilities: ["categoryColor", "sketch", "tilt", "quadrants"]
  },
  getSkin: () => SKIN,
  applySkin(partial) {
    // only reset the live photo/color state when "use images" itself
    // changed — the editor resends the whole nodes object on every edit, so
    // comparing old vs. new keeps a manual click on imageToggleBtn from
    // being undone by an unrelated tweak elsewhere in the form
    const useImagesChanged = partial.nodes && partial.nodes.useImages !== SKIN.nodes.useImages;
    SKIN = mergeSkin(SKIN, partial);
    applySkinCSS();
    if (useImagesChanged) showImages = !!SKIN.nodes.useImages;
    updateImageToggleButton();
    if (data.length) layout();
    // turning useImages/imageToggle on live can happen well after boot()'s
    // one-time preload, so make sure anything newly needed gets loaded —
    // then re-layout, since the layout() above only had what was cached
    if (SKIN.nodes.useImages || SKIN.nodes.imageToggle) {
      ensureImagesLoaded().then(() => {
        if (data.length) layout();
      });
    }
  }
};

boot();
