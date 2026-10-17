# 3 Axis Map

A three-axis scatter plot in the browser — drag to orbit around it, hover a
point for a preview, click for details. X, Y, and Z are all the same
length, so the data forms a real cube rather than a flat board with a
shallow third axis.

Pure static files (HTML/CSS/JS + [Three.js](https://threejs.org/)), no
build step, no backend. Open `index.html` through any static file server
(not directly as a `file://` URL — browsers block module imports from
local files) and it just runs.

```bash
python3 serve.py
```

The map opens head-on. To open it at an angle (so the third axis is visible),
add a starting view to the address: `?theta=0.7&phi=1.15` (and optionally
`&radius=12` for zoom). Drag to orbit from there.

(`serve.py` is just `python3 -m http.server` with a `Cache-Control: no-store`
header added — this project gets edited and reloaded constantly, especially
while iterating on skins, and the plain stdlib server's default caching can
leave a browser serving a stale `script.js` or `skins/*.json` indefinitely.
Any static server works for actually deploying this; `serve.py` is just for
local editing.)

## Your own data

Edit `data/nodes.json` and `data/categories.json`. Each node needs `x`,
`y`, `z` (each -1 to 1), a `title`, and optionally a `category` (id from
categories.json), `description`, `tags`, `link`, `image`, and `shape`
(`circle` | `cube` | `pyramid`).

## Configuring the labels

`data/config.json` controls the page title, subtitle, default node shape,
and the six axis-pole labels — nothing else needs to change to point this
at a different dataset:

```json
{
  "title": "3 Axis Map",
  "subtitle": "...",
  "skin": "default",
  "nodeShape": "circle",
  "axes": {
    "x": ["Negative pole", "Positive pole"],
    "y": ["Negative pole", "Positive pole"],
    "z": ["Negative pole", "Positive pole"]
  }
}
```

A node's color is never set directly from its data (never from category —
that's deliberate). Each skin picks how color is derived, via
`nodes.colorMode`:

- `"region"` (the default) — color comes from which of the 8 regions
  (octant) of the cube the node sits in, based on the sign of its x/y/z.
  Color always tells you *where* something is, no legend needed.
- `"palette"` — color cycles through a fixed list of colors (`nodes.palette`)
  by the node's position in `data/nodes.json`, no spatial meaning at all —
  just visual variety.

## Skins

Everything visual — background, line style, label style, node style — is
a "skin": a JSON file in `skins/`, selected by `config.json`'s `"skin"`
field (just the filename, no `.json`). Five ship with this repo:

- `default` — dark, glossy chrome axes, glowing labels
- `paper` — flat black lines on an off-white background, bold flat (unlit)
  data points
- `blueprint` — white flat lines and labels on a blueprint-blue background;
  nodes cycle through a fixed palette instead of region coloring (still
  being tried out, not final)
- `sketchy` — notebook-yellow background, black flat lines, nodes filled
  with their region color and outlined in black like a doodle. Set its
  `nodes.useImages` to `true` to show each node's thumbnail image (when it
  has one) instead of a flat color fill — still off by default
- `hand-drawn` — a genuinely wobbly, sketched-pen look (not just a color
  swap): axis rods follow a wavy path instead of a straight line, and
  circles are drawn as a jittery double-stroke, both in dark grey on a
  cool white background. Uses `lines.style`/`nodes.fill: "sketch"` — see
  below

A skin file looks like this:

```json
{
  "name": "My Skin",
  "css": {
    "bg": "#ffffff",
    "surface": "rgba(255, 255, 255, 0.94)",
    "border": "#111111",
    "text": "#111111",
    "textDim": "#555555",
    "accent": "#111111",
    "headerShadow": "none",
    "tooltipGlow": "0 2px 10px rgba(0, 0, 0, 0.15)",
    "panelGlow": "0 4px 20px rgba(0, 0, 0, 0.18)"
  },
  "lines": { "style": "flat", "color": "#111111", "thickness": 4 },
  "labels": { "color": "#111111", "glow": false },
  "nodes": {
    "style": "flat",
    "fill": "solid",
    "colorMode": "region",
    "saturation": 0.8,
    "lightness": 0.5,
    "palette": [],
    "outlineColor": "",
    "outlineSource": "line",
    "useImages": false,
    "imageToggle": false,
    "pixelRadius": 10
  }
}
```

- `css` maps straight onto the page's CSS custom properties (header,
  tooltip, and detail-panel styling).
- `lines.style` is `"chrome"` (lit, specular highlight), `"flat"` (solid,
  unlit), `"wireframe"` (just the cylinder's edges — a cage look for
  the axis rods), or `"sketch"` (a hand-drawn look — the rod follows a
  gently wavy path instead of a straight line; the wobble is seeded, so
  it's the same every time the scene rebuilds and doesn't shimmer while
  you adjust other settings). `nodes.style` is `"glossy"` or
  `"flat"`, same meaning, but only applies to the `"solid"` and
  `"solid-outline"` fills below.
- `lines.thickness` is the axis rods' radius, **in actual screen pixels**
  (same pixel-based sizing as `nodes.pixelRadius` — recomputed from the
  live canvas size, so it looks the same everywhere). Applies no matter
  which `lines.style` is active.
- `nodes.fill` is `"solid"` (a filled shape, no border), `"outline"` (just
  a ring/edges, no fill), `"solid-outline"` (filled AND stroked — a
  doodle look), `"wireframe"` (the node's actual geometry rendered as
  a sparse wire mesh — a low-poly ball look for `circle`, a cage for
  `cube`/`pyramid`), `"sketch"` (a hand-drawn jittery double-stroke
  circle outline, no fill), or `"sketch-fill"` (the same hand-drawn
  stroke, but filled with the node's color first). For `cube`/`pyramid`,
  both sketch variants fall back to a clean (non-wobbled) edge outline —
  `"sketch-fill"` additionally fills the box/pyramid solid — since a
  wobbled box reads as broken rather than drawn. When photos are on
  (`nodes.useImages`) and the fill is either sketch variant, the photo's
  circular clip and border both use the same hand-drawn wobble too,
  instead of snapping to a clean circle. All of these except `"solid"`
  draw a "line color" (the ring, the stroke, the wireframe, or the
  sketch), controlled by `nodes.outlineSource`: `"line"` (default —
  matches `lines.color`), `"node"` (follows the same per-node
  region/palette color as the fill, so an outline-only skin still reads
  as color-coded), or `"custom"`
  (uses `nodes.outlineColor` directly).
- `nodes.colorMode` is `"region"` (default) or `"palette"` — see above.
  Only applies when `fill` is `"solid"` or `"solid-outline"`.
- `nodes.useImages`: when `true`, any node with an `image` in
  `data/nodes.json` starts out showing that thumbnail (cover-fit, clipped
  to a circle, with the same outline) instead of a flat color fill. A
  node without an image still falls back to its normal fill. Images are
  preloaded once at startup, whenever this or `nodes.imageToggle` is on.
- `nodes.imageToggle`: when `true` (and `useImages` is also `true`, and
  at least one node has an image), a pill button appears in the top-right
  corner of the page letting the **viewer** flip every node between its
  photo and its flat color fill live, no reload. Useful when you want
  photos on by default but still let someone see the plain color-coded
  view. Off by default; if `useImages` is turned off, this turns off too.
- `nodes.saturation`/`nodes.lightness` tune the HSL region-color palette
  when `colorMode` is `"region"` (hue is fixed per octant; these control
  how punchy vs. muted it reads).
- `nodes.palette` is the list of hex colors to cycle through when
  `colorMode` is `"palette"`.
- `nodes.pixelRadius` is how big a node draws, **in actual screen pixels**
  (not 3D world units — it's recomputed from the live canvas size every
  frame, so it looks the same size in a phone-width window and an
  ultrawide monitor alike). This is the one number to change to resize
  every node on the map. The click/hover target is always ~6.5x this,
  regardless of the value, so it stays comfortably clickable even if you
  make the dots tiny.

To add your own: drop a new file in `skins/`, set `"skin"` in
`data/config.json` to its filename (no extension), reload. No code changes
needed.

### Designer

Skins are built in the shared [designer](../../designer) — one tool for
every map in this repo, not a per-project copy. Point it at this folder, and
it previews this page live, builds its controls from what this page
supports (everything in the schema above), and saves straight into this
folder's own `skins/` (optionally setting `"skin"` in `data/config.json` for
you). The skin files stay plain JSON that ship with this folder; the editor
is a dev-time tool that nothing here depends on.

Skins built here are also portable: the editor's library holds 3D skins
that work across this map, the timeline, and any other 3D map — a skin
simply ignores fields an app doesn't understand.
