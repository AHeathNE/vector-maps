# Editor

A small local tool for managing the *content* behind a map — its entries
(title, position or date, description, tags, link, thumbnail) and the colored
categories they belong to. The [designer](../designer) is its counterpart for
the map's *look*.

It works on a separate map folder that you point it at, and that folder is
what you'd deploy (GitHub Pages, Netlify, a plain file upload, anything that
serves static files). The two are deliberately decoupled: a map never links
back to the editor, and the editor can be pointed at any map folder on your
machine. Everything is saved straight to the folder's `data/*.json` and
`images/` — no database, just files you can read, diff, and hand-edit.

## Quick start

Requires Python 3 (no other dependencies — the whole thing is the standard
library).

```bash
python3 server.py
```

That opens `http://localhost:8420` in your browser (pass `--no-open` to skip
that). On macOS you can double-click `run.command`; on Windows, `run.bat`.
**Don't open `index.html` directly as a file** — it needs the Python server
running to read or save anything.

The first time it runs it opens `../demos/2-axis-scatter` if it finds it.
Otherwise type the path to an existing map folder, or to an empty/new folder
to start a fresh map there (see "Starting a new map" below). A relative path
is tried next to this folder first.

> The editor can't be hosted on GitHub Pages: it writes to disk, which a web
> page can't do. See the README at the top of this repo for screenshots.

## What it does

- Add, edit, and delete entries (title, description, tags, an optional link, an
  optional thumbnail image) and position them — on the chart for a scatter map,
  or on a date for a timeline.
- Define categories with a name and color — assign one to an entry and it's
  reflected on the map, with a legend explaining what each color means.
- Set the map's title, default node shape, and (for a timeline) how dates are
  shown.
- **Title, subtext and legend (scatter maps):** Map settings has a title, a
  subtext line, and a checkbox to show or hide the category legend. They save to
  `title`, `subtitle` and `showLegend` in the map's `data/config.json`, which both
  the flat and 3D pages read.
- **Undo:** the **Undo** button in the header (or Ctrl/Cmd+Z outside a text field)
  reverses the last add, edit or delete of an entry or category, including a
  deleted entry's image. The last 30 changes are kept while the editor is running.

## Three kinds of map

- **Scatter map** — entries placed on two axes (e.g. Irreverent ↔ Reverent,
  Low ↔ High Fidelity). A **Map settings** card has a **View** choice:
  - **Flat** – the 2D chart
  - **3D** – a chrome cross that tilts toward the cursor, with nodes as
    circles, cubes or pyramids

  Both pages live side by side in the map folder (`flat.html` and
  `map3d.html`); `index.html` is a copy of whichever is active. Switching
  saves the current `index.html` back to its slot first, so nothing is lost.
- **Timeline** — entries placed on a date (`2019`, `2019-06` or `2019-06-14`).
  A **Timeline settings** card sets the title, subtitle, **date scheme** (year,
  month & year, or full date) and the default node shape. Both a 3D timeline
  (`index.html`) and a flat one (`flat.html`) come with a new timeline.
- **3-axis map** — see [demos/3-axis-map](../demos/3-axis-map); it's a
  standalone demo rather than something the editor scaffolds.

## Starting a new map

Point the editor at a new, empty folder and pick the type on the setup screen.
It fills in whatever's missing from the starter templates (never overwriting a
file that's already there, so pointing it at a map you've already hand-edited
is safe). A new map comes with skin support built in — the `skins/` folder, the
skin files, and the hook the [designer](../designer) uses — so you can open the
same folder in the designer straight away.

The templates mirror the demo maps in [`demos/`](../demos), so a new map starts
from the same code the demos run.

## Project layout

```
server.py            local server: this UI + a JSON API for the map folder
index.html/js/css    the editor UI
site-template/       starter files for a new scatter map (flat view)
scatter3d-template/  the 3D view files added when you switch a scatter map to 3D
timeline-template/   starter files for a new timeline (3D + flat)
config.json          which folder you last pointed the editor at (gitignored)
```

## Safety

The server writes to your map folder, so it only binds to `127.0.0.1` and
refuses any write that doesn't come from its own page (it requires an
`X-Requested-With: editor` header, which a cross-site form post can't set). It's
a local prototyping tool, not hardened for production use.
