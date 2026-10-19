#!/usr/bin/env python3
"""Local server for the portfolio map editor tool.

Serves the editor UI itself (this folder) plus a small JSON API for managing
a *separate* site folder — the actual portfolio map, which can live anywhere
on disk and eventually be published on its own (GitHub Pages, Netlify, a
plain file upload, whatever). The editor never assumes it's sitting next to
that folder: it's told where it is via /api/config and remembers it in
config.json.

If the configured folder is missing site files (a fresh empty folder, or an
existing folder that's only partially set up), the editor fills in whatever's
missing from site-template/ without touching anything that's already there —
so pointing it at a site you already hand-edited after publishing is safe.

Not hardened for production use — this is a local prototyping tool only.
"""

import argparse
import base64
import datetime
import json
import mimetypes
import re
import os
import shutil
import tempfile
import threading
import uuid
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

EDITOR_ROOT = Path(__file__).resolve().parent
SCATTER3D_DIR = EDITOR_ROOT / "scatter3d-template"
VIEWS = ("flat", "3d")
VIEW_FILES = {"flat": "flat.html", "3d": "map3d.html"}
TEMPLATE_DIRS = {
    "scatter": EDITOR_ROOT / "site-template",
    "timeline": EDITOR_ROOT / "timeline-template",
}
CONFIG_FILE = EDITOR_ROOT / "config.json"
PORT = 8420

_lock = threading.Lock()

EXT_BY_MIME = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
}

DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.DOTALL)
DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")
SHAPES = ("circle", "cube", "pyramid")
DATE_SCHEMES = ("year", "month", "day")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_CATEGORY_COLOR = "#7dd3fc"


# ---------- config: which site folder the editor is pointed at ----------

def default_config():
    # first run on this machine: guess a sibling "site" folder (or the scatter
    # demo, in the published repo) if one exists, otherwise leave unset and
    # let the editor UI ask for a path
    guess = next((g for g in (EDITOR_ROOT.parent / "site", EDITOR_ROOT.parent / "demos" / "2-axis-scatter") if g.is_dir()), None)
    target = str(guess) if guess else None
    return {"targetFolder": target, "recentFolders": [target] if target else []}


def load_config():
    if not CONFIG_FILE.exists():
        return default_config()
    try:
        with CONFIG_FILE.open("r", encoding="utf-8") as f:
            config = json.load(f)
    except (json.JSONDecodeError, OSError):
        return default_config()
    # tolerate a config.json written before recentFolders existed
    config.setdefault("recentFolders", [])
    if config.get("targetFolder") and config["targetFolder"] not in config["recentFolders"]:
        config["recentFolders"].insert(0, config["targetFolder"])
    return config


def save_config(config):
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
        f.write("\n")


def target_root():
    folder = load_config().get("targetFolder")
    return Path(folder) if folder else None


def nodes_file(root):
    return root / "data" / "nodes.json"


def categories_file(root):
    return root / "data" / "categories.json"


def site_config_file(root):
    return root / "data" / "config.json"


def images_dir(root):
    return root / "images"


# ---------- site type (scatter map vs. timeline) ----------

def load_site_settings(root):
    path = site_config_file(root)
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def detect_site_type(root, requested=None):
    """A folder is a timeline if its data/config.json says so, a scatter map
    if it already has node data, and otherwise (a brand new folder) whatever
    the user asked for."""
    if load_site_settings(root).get("type") == "timeline":
        return "timeline"
    if nodes_file(root).exists():
        return "scatter"
    return requested if requested in TEMPLATE_DIRS else "scatter"


def sanitize_site_settings(payload, existing, site_type="timeline"):
    settings = dict(existing)
    settings["type"] = site_type
    if payload.get("nodeShape") in SHAPES:
        settings["nodeShape"] = payload["nodeShape"]
    if site_type == "timeline":
        if "title" in payload:
            settings["title"] = str(payload["title"]).strip() or "Timeline"
        if "subtitle" in payload:
            settings["subtitle"] = str(payload["subtitle"]).strip()
        if payload.get("dateScheme") in DATE_SCHEMES:
            settings["dateScheme"] = payload["dateScheme"]
    else:
        settings["view"] = payload["view"] if payload.get("view") in VIEWS else settings.get("view", "flat")
        if "title" in payload:
            title = str(payload["title"]).strip()
            if title:
                settings["title"] = title
            else:
                settings.pop("title", None)  # blank = back to the page's built-in title
        if "subtitle" in payload:
            settings["subtitle"] = str(payload["subtitle"]).strip()
        if "showLegend" in payload:
            settings["showLegend"] = bool(payload["showLegend"])
    return settings


def switch_view(root, old_view, new_view):
    """Scatter sites can be shown flat or in 3D. Both entry pages live side by
    side (flat.html / map3d.html) and index.html is a copy of the active one.
    Whatever is currently in index.html is saved back to its slot first, so
    hand edits to the active page survive a switch."""
    if old_view == new_view:
        return
    index = root / "index.html"
    if index.exists():
        shutil.copy2(index, root / VIEW_FILES[old_view])
    if new_view == "3d":
        scaffold_missing(SCATTER3D_DIR, root)
    source = root / VIEW_FILES[new_view]
    if not source.exists():
        raise ValueError(f"Missing {VIEW_FILES[new_view]} in the site folder.")
    shutil.copy2(source, index)


def normalize_date(raw):
    """Accepts YYYY, YYYY-MM or YYYY-MM-DD and returns it if it's a real date."""
    text = str(raw or "").strip()
    match = DATE_RE.match(text)
    if not match:
        raise ValueError("Date must look like 2019, 2019-06 or 2019-06-14.")
    year, month, day = match.groups()
    if year == "0000":
        raise ValueError("That year isn't valid.")
    if month is not None and not 1 <= int(month) <= 12:
        raise ValueError("Month must be between 01 and 12.")
    if day is not None:
        try:
            datetime.date(int(year), int(month), int(day))
        except ValueError:
            raise ValueError("That day doesn't exist in that month.")
    return text


# ---------- scaffolding a site folder from the template ----------

def scaffold_missing(src, dst):
    """Copy anything present in the template but missing from dst. Never
    overwrites a file that's already there — an existing hand-edited site
    is left alone, only genuinely missing pieces get filled in."""
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.name == ".gitkeep":
            continue
        target = dst / item.name
        if item.is_dir():
            scaffold_missing(item, target)
        elif not target.exists():
            shutil.copy2(item, target)


# ---------- data helpers ----------

def load_json(path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def save_image_from_data_url(root, data_url):
    match = DATA_URL_RE.match(data_url)
    if not match:
        raise ValueError("Unrecognized image data URL")
    mime = match.group("mime")
    ext = EXT_BY_MIME.get(mime, "png")
    raw = base64.b64decode(match.group("data"))
    img_dir = images_dir(root)
    img_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    (img_dir / filename).write_bytes(raw)
    return f"images/{filename}"


def delete_image_file(root, image_path):
    if not image_path:
        return
    # only ever remove files inside this site's images/, never follow traversal
    candidate = (root / image_path).resolve()
    img_dir = images_dir(root).resolve()
    if img_dir in candidate.parents and candidate.exists():
        candidate.unlink()


# ---------- undo history ----------
# Before every change to nodes/categories, snapshot nodes.json, categories.json
# and images/ (hard-linked, so it's cheap and survives a deleted image) into a
# temp folder. Undo restores the newest snapshot. History lives only for this
# server run and is capped.

HISTORY_LIMIT = 30
_history = []  # [{"root": Path, "dir": Path}]


def _link_or_copy(src, dst):
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def push_history(root):
    snap = Path(tempfile.mkdtemp(prefix="editor-undo-"))
    for f in (nodes_file(root), categories_file(root)):
        if f.exists():
            shutil.copy2(f, snap / f.name)
    img = images_dir(root)
    if img.is_dir():
        shutil.copytree(img, snap / "images", copy_function=_link_or_copy)
    _history.append({"root": root, "dir": snap})
    while len(_history) > HISTORY_LIMIT:
        shutil.rmtree(_history.pop(0)["dir"], ignore_errors=True)


def history_count(root):
    return sum(1 for h in _history if h["root"] == root)


def pop_history(root):
    for i in range(len(_history) - 1, -1, -1):
        if _history[i]["root"] == root:
            return _history.pop(i)
    return None


def restore_snapshot(root, entry):
    snap = entry["dir"]
    for f in (nodes_file(root), categories_file(root)):
        if (snap / f.name).exists():
            shutil.copy2(snap / f.name, f)
    img = images_dir(root)
    snap_img = snap / "images"
    wanted = {p.name for p in snap_img.iterdir()} if snap_img.is_dir() else set()
    if img.is_dir():
        for p in img.iterdir():
            if p.is_file() and p.name not in wanted:
                p.unlink()
    if snap_img.is_dir():
        img.mkdir(parents=True, exist_ok=True)
        for p in snap_img.iterdir():
            dst = img / p.name
            if not dst.exists() or dst.stat().st_ino != p.stat().st_ino:
                shutil.copy2(p, dst)
    shutil.rmtree(snap, ignore_errors=True)


def parse_folder_path(raw_path):
    """Forgiving parsing for a pasted/typed folder path: trims whitespace,
    strips a matching pair of surrounding quotes (common when pasting a path
    copied from Finder/Explorer), expands ~, and resolves a relative path
    against the user's home directory instead of rejecting it outright."""
    text = raw_path.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        text = text[1:-1].strip()
    folder = Path(text).expanduser()
    if not folder.is_absolute():
        folder = Path.home() / folder
    return folder


def add_recent_folder(config, folder_str):
    recents = [f for f in config.get("recentFolders", []) if f != folder_str]
    recents.insert(0, folder_str)
    config["recentFolders"] = recents[:5]
    return config


def clamp(value, lo=-1.0, hi=1.0):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(lo, min(hi, value))


def sanitize_node(root, payload, existing=None):
    node = dict(existing) if existing else {}
    node["title"] = str(payload.get("title", "")).strip() or "Untitled"
    if detect_site_type(root) == "timeline":
        node.pop("x", None)
        node.pop("y", None)
        node.pop("z", None)
        node["date"] = normalize_date(payload.get("date", node.get("date")))
    else:
        node["x"] = clamp(payload.get("x", node.get("x", 0)))
        node["y"] = clamp(payload.get("y", node.get("y", 0)))
        node.pop("z", None)  # two axes only; older maps may still carry a depth
    shape = payload.get("shape", node.get("shape", ""))
    if shape in SHAPES:
        node["shape"] = shape
    else:
        node.pop("shape", None)  # fall back to the site's default shape
    node["description"] = str(payload.get("description", "")).strip()
    node["link"] = str(payload.get("link", "")).strip()
    node["category"] = str(payload.get("category", node.get("category", ""))).strip()

    tags = payload.get("tags", node.get("tags", []))
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    node["tags"] = [str(t) for t in tags][:8]

    image_data_url = payload.get("imageDataUrl")
    if image_data_url:
        old_image = node.get("image")
        node["image"] = save_image_from_data_url(root, image_data_url)
        if existing and old_image and old_image != node["image"]:
            delete_image_file(root, old_image)
    elif payload.get("removeImage"):
        delete_image_file(root, node.get("image"))
        node["image"] = ""
    elif "image" not in node:
        node["image"] = ""

    return node


def sanitize_category(payload, existing=None):
    cat = dict(existing) if existing else {}
    cat["name"] = str(payload.get("name", "")).strip() or "Untitled"
    color = str(payload.get("color", cat.get("color", DEFAULT_CATEGORY_COLOR))).strip()
    cat["color"] = color if HEX_COLOR_RE.match(color) else cat.get("color", DEFAULT_CATEGORY_COLOR)
    return cat


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(EDITOR_ROOT), **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the terminal quiet; errors still raise/print via default handler

    def end_headers(self):
        # this is a local tool that gets edited and reloaded constantly —
        # stale browser caching of html/css/js is more trouble than it's worth
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _resource_and_id(self):
        # expects /api/<resource>[/<id>]
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) >= 2 and parts[0] == "api":
            resource = parts[1]
            item_id = parts[2] if len(parts) >= 3 else None
            return resource, item_id
        return None, None

    def _require_root(self):
        root = target_root()
        if root is None or not root.is_dir():
            self._send_json(400, {"error": "No site folder configured yet. Set one from the editor header."})
            return None
        return root

    def _serve_site_file(self):
        # /site-files/<relative path inside the target folder> — used so the
        # editor UI can show thumbnails/previews that live in the site folder,
        # which is not necessarily anywhere near this editor's own directory
        root = target_root()
        if root is None:
            self.send_error(404, "No site folder configured")
            return
        rel = unquote(urlparse(self.path).path[len("/site-files/"):])
        candidate = (root / rel).resolve()
        try:
            root_resolved = root.resolve()
        except OSError:
            self.send_error(404)
            return
        if root_resolved not in candidate.parents or not candidate.is_file():
            self.send_error(404)
            return
        ctype = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        data = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/site-files/"):
            self._serve_site_file()
            return
        if path == "/api/config":
            config = load_config()
            self._send_json(200, config)
            return
        if path == "/api/site":
            root = self._require_root()
            if root is None:
                return
            with _lock:
                site_type = detect_site_type(root)
                settings = load_site_settings(root)
                if site_type == "scatter":
                    settings.setdefault("view", "flat")
            self._send_json(200, {"type": site_type, "settings": settings})
            return
        if path == "/api/history":
            root = self._require_root()
            if root is None:
                return
            with _lock:
                count = history_count(root)
            self._send_json(200, {"count": count})
            return
        if path == "/api/nodes":
            root = self._require_root()
            if root is None:
                return
            with _lock:
                nodes = load_json(nodes_file(root))
            self._send_json(200, nodes)
            return
        if path == "/api/categories":
            root = self._require_root()
            if root is None:
                return
            with _lock:
                categories = load_json(categories_file(root))
            self._send_json(200, categories)
            return
        super().do_GET()

    def _write_allowed(self):
        """This server writes to disk, so a write only goes through if it
        was addressed to localhost and carries this tool's own header — a
        plain cross-site form post can't set that header, so another web page
        can't change your files through this server."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].lower()
        if host not in ("localhost", "127.0.0.1") or self.headers.get("X-Requested-With") != "editor":
            self._send_json(403, {"error": "Request refused."})
            return False
        return True

    def do_POST(self):
        if not self._write_allowed():
            return
        path = urlparse(self.path).path
        if path == "/api/config":
            try:
                payload = self._read_json_body()
                raw_path = str(payload.get("targetFolder", ""))
                if not raw_path.strip():
                    self._send_json(400, {"error": "A folder path is required."})
                    return
                folder = parse_folder_path(raw_path)
                try:
                    folder.mkdir(parents=True, exist_ok=True)
                except OSError as exc:
                    self._send_json(400, {"error": f"Couldn't use “{folder}”: {exc.strerror or exc}"})
                    return
                with _lock:
                    site_type = detect_site_type(folder, payload.get("siteType"))
                    scaffold_missing(TEMPLATE_DIRS[site_type], folder)
                    config = load_config()
                    config["targetFolder"] = str(folder)
                    add_recent_folder(config, str(folder))
                    save_config(config)
                self._send_json(200, config)
            except Exception as exc:
                self._send_json(400, {"error": str(exc)})
            return

        resource, _ = self._resource_and_id()
        root = self._require_root()
        if root is None:
            return
        try:
            if resource == "undo":
                with _lock:
                    entry = pop_history(root)
                    if entry is None:
                        self._send_json(409, {"error": "Nothing to undo."})
                        return
                    restore_snapshot(root, entry)
                    count = history_count(root)
                self._send_json(200, {"ok": True, "count": count})
                return
            payload = self._read_json_body()
            if resource == "site":
                with _lock:
                    site_type = detect_site_type(root)
                    current = load_site_settings(root)
                    settings = sanitize_site_settings(payload, current, site_type)
                    if site_type == "scatter":
                        switch_view(root, current.get("view", "flat"), settings["view"])
                    save_json(site_config_file(root), settings)
                self._send_json(200, {"type": site_type, "settings": settings})
            elif resource == "nodes":
                with _lock:
                    push_history(root)
                    nodes = load_json(nodes_file(root))
                    node = sanitize_node(root, payload)
                    node["id"] = f"n_{uuid.uuid4().hex[:10]}"
                    nodes.append(node)
                    save_json(nodes_file(root), nodes)
                self._send_json(201, node)
            elif resource == "categories":
                with _lock:
                    push_history(root)
                    categories = load_json(categories_file(root))
                    cat = sanitize_category(payload)
                    cat["id"] = f"c_{uuid.uuid4().hex[:8]}"
                    categories.append(cat)
                    save_json(categories_file(root), categories)
                self._send_json(201, cat)
            else:
                self._send_json(404, {"error": "not found"})
        except Exception as exc:  # local tool: surface the error, don't crash the server
            self._send_json(400, {"error": str(exc)})

    def do_PUT(self):
        if not self._write_allowed():
            return
        resource, item_id = self._resource_and_id()
        if not item_id:
            self._send_json(404, {"error": "not found"})
            return
        root = self._require_root()
        if root is None:
            return
        try:
            payload = self._read_json_body()
            if resource == "nodes":
                with _lock:
                    nodes = load_json(nodes_file(root))
                    idx = next((i for i, n in enumerate(nodes) if n.get("id") == item_id), None)
                    if idx is None:
                        self._send_json(404, {"error": "node not found"})
                        return
                    push_history(root)
                    updated = sanitize_node(root, payload, existing=nodes[idx])
                    updated["id"] = item_id
                    nodes[idx] = updated
                    save_json(nodes_file(root), nodes)
                self._send_json(200, updated)
            elif resource == "categories":
                with _lock:
                    categories = load_json(categories_file(root))
                    idx = next((i for i, c in enumerate(categories) if c.get("id") == item_id), None)
                    if idx is None:
                        self._send_json(404, {"error": "category not found"})
                        return
                    push_history(root)
                    updated = sanitize_category(payload, existing=categories[idx])
                    updated["id"] = item_id
                    categories[idx] = updated
                    save_json(categories_file(root), categories)
                self._send_json(200, updated)
            else:
                self._send_json(404, {"error": "not found"})
        except Exception as exc:
            self._send_json(400, {"error": str(exc)})

    def do_DELETE(self):
        if not self._write_allowed():
            return
        resource, item_id = self._resource_and_id()
        if not item_id:
            self._send_json(404, {"error": "not found"})
            return
        root = self._require_root()
        if root is None:
            return
        if resource == "nodes":
            with _lock:
                nodes = load_json(nodes_file(root))
                idx = next((i for i, n in enumerate(nodes) if n.get("id") == item_id), None)
                if idx is None:
                    self._send_json(404, {"error": "node not found"})
                    return
                push_history(root)
                removed = nodes.pop(idx)
                delete_image_file(root, removed.get("image"))
                save_json(nodes_file(root), nodes)
            self._send_json(200, {"ok": True})
        elif resource == "categories":
            with _lock:
                categories = load_json(categories_file(root))
                idx = next((i for i, c in enumerate(categories) if c.get("id") == item_id), None)
                if idx is None:
                    self._send_json(404, {"error": "category not found"})
                    return
                push_history(root)
                categories.pop(idx)
                save_json(categories_file(root), categories)
                # nodes referencing the deleted category fall back to "no category"
                nodes = load_json(nodes_file(root))
                changed = False
                for node in nodes:
                    if node.get("category") == item_id:
                        node["category"] = ""
                        changed = True
                if changed:
                    save_json(nodes_file(root), nodes)
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "not found"})


def main():
    parser = argparse.ArgumentParser(description="Editor tool for a portfolio map site's content.")
    parser.add_argument("--no-open", action="store_true", help="don't open a browser window")
    args = parser.parse_args()

    mimetypes.add_type("application/json", ".json")
    # localhost only: this server can write to your site folder, so it
    # shouldn't be reachable from other machines on the network
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"Editor serving at {url}")
    root = target_root()
    print(f"  Site folder: {root if root else '(not set — configure it from the editor header)'}")
    if not args.no_open:
        print("Opening in your browser... (leave this window open — closing it stops the server)")
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
