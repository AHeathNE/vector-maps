# Timeline

A 3D timeline in the browser — a rod running through your dated entries,
seesawing toward wherever the cursor sits along it. Hover a point for a
preview, click for details.

Pure static files (HTML/CSS/JS + [Three.js](https://threejs.org/)), no
build step, no backend. Open `index.html` through any static file server
(not directly as a `file://` URL — browsers block module imports from
local files) and it just runs.

```bash
python3 serve.py
```

(`serve.py` is just `python3 -m http.server` with a `Cache-Control: no-store`
header added — this project gets edited and reloaded constantly, especially
while iterating on skins, and the plain stdlib server's default caching can
leave a browser serving a stale `script.js` or `skins/*.json` indefinitely.
Any static server works for actually deploying this; `serve.py` is just for
local editing.)

## Two views

The same entries come in two views, side by side in this folder:

- **`index.html`** — the 3D timeline described above (Three.js).
- **`flat.html`** — a flat timeline: the same dated entries along a plain
  horizontal line, with date gridlines, a category legend, a "Show
  thumbnails" switch (remembered per viewer), and a detail panel beside it.
  Plain HTML/CSS/JS, no Three.js. Entries that land close together stack
  above and below the line instead of overlapping. (`flat.html`, `flat.css`
  and `flat.js` are self-contained — only `data/`, `images/` and `skins/`
  are shared with the 3D page.)

Both read the same `data/`. A deployed site would normally show just one of
them (copy it to `index.html`, as the editor does for the scatter map's
two views); `flat.html` is reachable directly at `/flat.html` while you work.

## Your own data

Edit `data/nodes.json` and `data/categories.json`. Each node needs a
`date` (`"2019"`, `"2019-06"`, or `"2019-06-14"`), a `title`, and
optionally a `category` (id from categories.json), `description`, `tags`,
`link`, `image`, and `shape` (`circle` | `cube` | `pyramid`).

## Configuring the page

`data/config.json` controls the page title, subtitle, default node shape,
and how dates are displayed:

```json
{
  "title": "Timeline",
  "subtitle": "...",
  "dateScheme": "year",
  "nodeShape": "circle",
  "skin": "default",
  "skin2d": "default-2d",
  "subtitleFlat": "..."
}
```

`dateScheme` is `"year"`, `"month"`, or `"day"` — how much of each date
gets shown in tooltips, the detail panel, and tick labels.

Each view has its own skin: `skin` is the 3D page's (a **3d** skin, described
below) and `skin2d` is the flat page's (a **2d** skin, see "The flat view's
skins"). `subtitleFlat` is the flat page's subtitle — optional, since the
3D page's subtitle talks about tilting the line, which the flat page doesn't
do.

A node's color is never set directly from its data. Each skin picks how
color is derived, via `nodes.colorMode`:

- `"category"` (the default) — color comes from the node's `category`
  (via `data/categories.json`), with a fallback color for nodes with no
  category. The legend at the bottom-left always reflects the raw
  category list regardless of this setting.
- `"palette"` — color cycles through a fixed list of colors
  (`nodes.palette`) by the node's position in `data/nodes.json`, no
  category meaning at all — just visual variety.

## Skins

Everything visual — background, line style, label style, node style — is
a "skin": a JSON file in `skins/`, selected by `config.json`'s `"skin"`
field (just the filename, no `.json`). This is the same system
[3-axis-map](../3-axis-map) uses (same CSS token names, same
`nodes.fill`/`outlineSource` ideas), adapted for a timeline: `"lines"`
here always describes the one rod, and `colorMode` is `"category"`
instead of `"region"`, since a 1D timeline has no spatial region.

Only `default` ships with this repo so far — it matches the original
hardcoded look (dark blue-black background, glossy chrome rod, glowing
labels, nodes colored by category).

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
  "lines": { "style": "flat", "color": "#111111", "thickness": 5 },
  "labels": { "color": "#111111", "minorColor": "#555555", "glow": false },
  "nodes": {
    "style": "flat",
    "fill": "solid",
    "colorMode": "category",
    "palette": [],
    "outlineColor": "",
    "outlineSource": "line",
    "useImages": false,
    "imageToggle": false,
    "pixelRadius": 11
  }
}
```

- `css` maps straight onto the page's CSS custom properties (header,
  tooltip, and detail-panel styling).
- `lines.style` is `"chrome"` (lit, specular highlight), `"flat"` (solid,
  unlit), `"wireframe"` (just the tube's edges — a cage look for the
  rod), or `"sketch"` (a hand-drawn look — the rod follows a gently wavy
  path instead of a straight line). `nodes.style` is `"glossy"` or
  `"flat"`, same meaning, but only applies to the `"solid"` and
  `"solid-outline"` fills below.
- `lines.thickness` is the rod's radius, **in actual screen pixels** (same
  pixel-based sizing as `nodes.pixelRadius` — recomputed from the live
  canvas size, so it looks the same everywhere).
- `nodes.fill` is `"solid"` (a filled shape, no border), `"outline"` (just
  a ring/edges, no fill), `"solid-outline"` (filled AND stroked — a doodle
  look), `"wireframe"` (the node's actual geometry rendered as a sparse
  wire mesh), `"sketch"` (a hand-drawn jittery double-stroke circle
  outline), or `"sketch-fill"` (the same, filled with the node's color).
  With a sketch fill, photos (`nodes.useImages`) get the same hand-drawn
  clip and border. All of these except `"solid"` draw a "line color" (the
  ring, the stroke, the wireframe, or the sketch), controlled by
  `nodes.outlineSource`:
  `"line"` (default — matches `lines.color`), `"node"` (follows the same
  per-node category/palette color as the fill), or `"custom"` (uses
  `nodes.outlineColor` directly).
- `nodes.colorMode` is `"category"` (default) or `"palette"` — see above.
- `nodes.palette` is the list of hex colors to cycle through when
  `colorMode` is `"palette"`.
- `nodes.pixelRadius` is how big a node draws, in actual screen pixels.
- `nodes.useImages`: when `true`, any node with an `image` starts out
  showing that thumbnail (cover-fit, clipped to a circle) instead of a
  flat color fill.
- `nodes.imageToggle`: when `true` (and `useImages` is also `true`, and
  at least one node has an image), a pill button appears top-right
  letting the **viewer** flip every node between its photo and its flat
  color fill live, no reload.
- `labels.color`/`labels.minorColor` are the major-tick (year, or
  month-at-year-boundary) and minor-tick label colors.
- `motion.tilt` (default `true`): whether the rod seesaws and slides toward
  the cursor as you move along it. Set it `false` for a static rod — the
  camera holds still too; hovering and clicking nodes work the same.

To add your own: drop a new file in `skins/`, set `"skin"` in
`data/config.json` to its filename (no extension), reload. No code
changes needed.

### The flat view's skins

`flat.html` takes a **2d** skin — the same kind `site/flat.html` uses, so a
2D skin works on both — chosen by `config.json`'s `"skin2d"` field. Each
skin file says which kind it is (`"kind": "2d"` or `"3d"`), so one `skins/`
folder can hold both, and each page ignores a skin of the wrong kind.

```json
{
  "name": "My Skin",
  "kind": "2d",
  "css": { "accent": "#7dd3fc", "accent2": "#f0abfc" },
  "lines": { "color": "#ffffff", "thickness": 3 },
  "nodes": { "size": 14, "thumbSize": 40 }
}
```

- `css.accent`/`accent2` are the highlight colors (switch, hover and
  selection rings, dates, links).
- `css.bg`/`surface`/`surface2`/`border`/`text`/`textDim` are **optional**:
  leave one out and it keeps following the viewer's light/dark system theme;
  set it to lock that color.
- `lines.thickness` is the line's thickness in px; `lines.color` (optional)
  its color, otherwise the dim text color.
- `nodes.size`/`nodes.thumbSize` are the dot and thumbnail diameters in px.
  Node color always comes from the entry's category.

Only `default-2d` ships with this repo; the editor's library has more.

### Designer

Skins are built in the shared [designer](../../designer) — one tool for
every map in this repo, not a per-project copy. Point it at this folder, pick
the page (`index.html` for 3D, `flat.html` for flat — each saves and
activates its own kind of skin, under `skin` / `skin2d`), and it previews
that page live, builds its controls from what this page
supports (everything in the schema above), and saves straight into this
folder's own `skins/` (optionally setting `"skin"` in `data/config.json` for
you). The skin files stay plain JSON that ship with this folder; the editor
is a dev-time tool that nothing here depends on.

The editor's library holds 3D skins shared with 3-axis-map and any other 3D
map: pull one in and the timeline just uses the parts it understands (e.g.
a skin colored "by region" falls back to "by category" here, since a 1D
timeline has no regions).
