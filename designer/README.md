# Designer

One designer for the look of every map in this repo — the 1-axis timeline, the
2-axis scatter, the 3-axis map. Open a map folder, shape its skin with a live
preview, and save it straight into that folder's own `skins/`.

Like the [editor](../editor), this is a dev-time tool that works on a *separate*
map folder, which can live anywhere on disk and is what you'd actually deploy.
Nothing in a map depends on this tool: each map ships with its own `skins/`
folder of plain JSON files and keeps working on its own. The designer never
leaves anything behind that a map needs at runtime.

## Two ways to use it

- **Hosted demo (no install).** The copy on GitHub Pages runs entirely in your
  browser: pick one of the demo maps, edit its skin with the live preview, and
  **Download JSON**. It can't save into a folder, because a web page can't write
  to your disk — for that, run it locally.
- **Locally (full).** Open any map folder on your machine and save skins
  straight into it. See below.

## Run it locally

Requires Python 3 (standard library only).

```bash
python3 server.py
```

That opens `http://localhost:8430`. On macOS you can double-click
`run.command`; on Windows, `run.bat`. Pass `--no-open` to skip opening a
browser, or `--port 9000` to change the port.

On first run it opens `../demos/3-axis-map` if it finds it; otherwise type a
folder path and press **Open**. A relative name works too — `timeline` or
`scatter` finds the matching map in `../demos/`. Recent folders are remembered.

## Using it

1. **Open a map folder.** The designer lists the folder's pages and picks one
   that supports skins. (A page "supports skins" if its script exposes the
   hook described below; pages that don't are listed but disabled.)
2. **Start from** whatever's showing now, the built-in default, one of this
   map's own skins, or a skin from the **library**.
3. **Edit.** Every control updates the live preview. Every color has both a
   swatch picker and a text field.
4. **Save.**
   - **Save to this map** writes `skins/<name>.json` in the map folder, and
     (if ticked) sets it as the active skin in the map's `data/config.json`
     — leaving every other key in that file as it was.
   - **Add to the library** puts a copy on the shared shelf (below).
   - **Download JSON** if you'd rather place the file yourself.

## The library

`library/3d/` and `library/2d/` are a shelf of skins to pull from — pick one
under **Start from** and edit or save it into whatever map you have open. It
is only a convenience for the designer: a map never reads from it, and saving a
skin to a map copies the file, so each map's `skins/` stays complete and
independent. Anything you build can be added back with **Add to the library**.

## Two kinds of skin

| kind | maps | what a skin covers |
|------|------|--------------------|
| `3d` | Three.js pages: timeline (1-axis), scatter (2-axis), 3-axis map | page colors, line style/color/thickness, labels, node fill/outline/size/photos, quadrant panes, motion |
| `2d` | plain DOM/CSS pages: scatter flat view, timeline flat view | accents, quadrant tints (scatter), axis line (timeline), optional page colors, node sizes |

Skins are portable between maps of the same kind: a map simply ignores
fields it doesn't understand, and the designer only offers what the open map
can render. (A 3D skin colored "by region" opened in the timeline falls
back to "by category", since a 1D timeline has no regions.)

## One folder, two kinds

A map folder can hold both a flat page and a 3D page (the timeline and the
scatter map do), each wanting a different kind of skin. So every skin
file says its `"kind"` (`"3d"` or `"2d"`), and:

- the designer lists only the skins that fit the page you have open, and each
  page has its **own active skin** in `data/config.json` — `"skin"` for 3D
  pages, `"skin2d"` for flat ones (the page reports which in `meta.configKey`);
- a page ignores a skin of the wrong kind (it warns in the console and uses
  its built-in look);
- saving refuses to overwrite a skin file of the *other* kind, so a flat
  skin can't clobber the 3D one that shares its name.

By convention `default` is a map's 3D skin and `default-2d` its flat one.

## How a map plugs in

The designer doesn't know about any map in particular. A page opts in by
exposing this on `window`:

```js
window.__designer = {
  ready,        // a Promise that resolves once the page has loaded its skin
  meta: {
    label: "3 Axis Map",
    kind: "3d",                               // "3d" or "2d" — picks the form
    axes: 3,
    configKey: "skin",                        // which data/config.json key holds its active skin
    capabilities: ["sketch", "regionColor"]   // optional features it can render
  },
  getSkin() {}, // the full skin currently showing
  applySkin(skin) {} // apply a full skin live (merged over the current one)
};
```

Capabilities gate fields in the form (see `schema.js`): `sketch` (hand-drawn
lines and nodes), `regionColor` / `categoryColor` (the node color sources
the map has), `minorLabels` (a separate minor-tick label color), `tilt` (a
cursor-driven motion the skin can switch off), `quadrants` (the four quadrant
tints — CSS tints on the flat scatter, tinted panes on the 3D scatter),
`axisLine` (a single line to style, as on the flat timeline). Adding a new kind
of map means implementing this hook — no new designer.

One merge rule to know: a page merges the skin it's given over its *current*
one, so clearing an optional field has to travel as an explicit `undefined`
rather than a missing key (the designer does this).

## Safety

Unlike the maps, the local server writes to disk, so it only binds to
`127.0.0.1`, only answers requests addressed to `localhost`, and refuses any
POST without its own `X-Requested-With: designer` header (which a
cross-site form post can't set). Skin file names are restricted to letters,
numbers, dashes, underscores and dots, and the map folder is only ever read
(its pages and `skins/`) or written in `skins/` and the `skin` / `skin2d` keys
of `data/config.json`. It's still a local prototyping tool, not hardened for
production use.

## Layout

```
server.py     local server: this UI, the preview of the open map folder, and a small JSON API
index.html    the designer UI
app.js        opening a folder (or a demo), the live-preview bridge, saving
schema.js     what a 3d / 2d skin contains (drives the whole form)
form.js       builds the form from the schema
style.css
library/      shared skins: 3d/ and 2d/
static-state.json   (generated for the hosted demo) the demo maps and their skins
config.json   which folder you last opened (gitignored)
```
