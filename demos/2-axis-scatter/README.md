# Portfolio Map

The 2-axis portfolio map comes in two views of the same data, side by side:

- **`flat.html`** — a flat CSS chart (Irreverent ↔ Reverent, Low ↔ High
  Fidelity), a thumbnail/dot toggle, a detail panel.
- **`map3d.html`** — the same map in 3D (Three.js): a chrome
  cross that tilts toward the cursor (the four tinted quadrant panes are an
  optional skin setting, off by default). **`index.html`** is a copy of
  whichever view is active (the editor's "View" setting swaps it), so
  keep the two 3D files identical.

For the full three-axis version (Z through the center, drag to orbit) see
[3-axis-map](../3-axis-map). Both views here take skins — each its own kind,
see below.

Pure static files, no build step, no backend. Open through any static
file server (not directly as a `file://` URL):

```bash
python3 serve.py
```

(`serve.py` is just `python3 -m http.server` with a `Cache-Control: no-store`
header added, same reasoning as the other projects in this repo — local
editing stays fast and never serves a stale file.)

## Your own data

Edit `data/nodes.json` and `data/categories.json`. Each node needs `x`,
`y` (each -1 to 1), a `title`, and optionally a `category` (id from categories.json),
`description`, `tags`, `link`, and `image`.

## Skins

### The flat view's skins

Everything visual beyond node color — which always comes from each
node's category — is a "skin": a JSON file in `skins/`, selected by
`data/config.json`'s `"skin2d"` field (a folder with both a flat and a 3D
page gives each its own: `skin2d` for this one, `skin` for the 3D one; each
skin file says its `"kind"`, and a page ignores a skin of the wrong kind).
Same mechanism as
[3-axis-map](../3-axis-map) and [timeline](../1-axis-timeline) (same CSS token
names), but much smaller: this page is plain DOM/CSS, not Three.js, so a
skin here is just colors and two node-size numbers — no fill/outline/
material modes.

`flat.html` also already has a light/dark theme that follows the
viewer's system preference (`prefers-color-scheme`), from before the
skin system existed. To keep that working, `bg`/`surface`/`surface2`/
`border`/`text`/`textDim` are **optional** in a skin's `css` block —
leave any of them out and that color keeps following the system theme;
set one explicitly to lock it regardless of theme.

A skin file looks like this:

```json
{
  "name": "My Skin",
  "css": {
    "accent": "#7dd3fc",
    "accent2": "#f0abfc",
    "quadrantIrreverentHigh": "rgba(240, 171, 252, 0.07)",
    "quadrantReverentHigh": "rgba(125, 211, 252, 0.07)",
    "quadrantIrreverentLow": "rgba(251, 191, 36, 0.06)",
    "quadrantReverentLow": "rgba(52, 211, 153, 0.06)"
  },
  "nodes": { "size": 14, "thumbSize": 40 }
}
```

- `css.accent`/`accent2` are the two highlight colors (hover rings,
  switch, links).
- `css.quadrant*` are the four background tints behind each quadrant of
  the chart.
- `css.bg`/`surface`/`surface2`/`border`/`text`/`textDim` are the
  optional theme-overriding colors described above.
- `nodes.size`/`nodes.thumbSize` set the dot and thumbnail diameters, in
  pixels.

Only `default-2d` ships with this repo, matching the original look (and
leaving every optional color out, so the system theme keeps working); the
editor's library has more.

### The 3D view's skins

`index.html` / `map3d.html` take a **3d** skin — the same kind the timeline
and 3-axis map use, so a skin built for any of them works here — chosen by
`data/config.json`'s `"skin"` field. The fields are documented in
[3-axis-map](../3-axis-map#skins) (page colors, lines, labels, nodes,
photos); this page's `colorMode` is `"category"` or `"palette"`. Two parts
are specific to the 2-axis map:

```json
{
  "quadrants": { "show": false, "opacity": 0.1, "irreverentHigh": "#f0abfc", "reverentHigh": "#7dd3fc", "irreverentLow": "#fbbf24", "reverentLow": "#34d399" },
  "motion": { "tilt": true }
}
```

- `quadrants` — the four tinted panes behind the chart: whether to show
  them, how strong they are, and each one's color.
- `motion.tilt` — whether the map tilts and slides toward the cursor. Turn
  it off for a static map; hovering and clicking work the same.

Only `default` ships with this repo, matching the original look.

### Designer

Skins are built in the shared [designer](../../designer) — one tool for
every map in this repo, not a per-project copy. Point it at this folder
and pick a page (`flat.html` for 2D, `index.html` for 3D — each saves and
activates its own kind of skin, under `skin2d` / `skin`); it previews that
page live, builds its controls from the schema above, and saves straight
into this folder's own `skins/`. The skin files stay plain JSON that ship
with this folder; the editor is a dev-time tool that nothing here depends
on. (2D skins are their own kind, separate from the 3D skins the other maps
share.)
