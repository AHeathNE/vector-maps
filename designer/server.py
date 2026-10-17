#!/usr/bin/env python3
"""Local server for the designer.

One designer for every map in this repo (1-axis timeline, 2-axis scatter,
3-axis map...). Like the editor, it works on a *separate* app folder that can
live anywhere on disk and ships on its own: it serves that folder's pages
into a preview iframe, reads and writes the folder's skins/ directory and
the "skin" field of its data/config.json, and leaves nothing behind that
the app depends on at runtime. A skin is a plain JSON file copied into
each app's own skins/ folder — library/ here is just a shelf to pull
skins from, or add to, not something any app reads.

Unlike a static file server this one writes to disk, so it only binds to
127.0.0.1, only answers requests addressed to localhost, and refuses any
POST that doesn't carry the designer's own header (a plain cross-site form
post can't set it).

Not hardened for production use — this is a local prototyping tool only.
"""

import argparse
import json
import mimetypes
import re
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

DESIGNER_ROOT = Path(__file__).resolve().parent
LIBRARY_DIR = DESIGNER_ROOT / "library"
CONFIG_FILE = DESIGNER_ROOT / "config.json"
KINDS = ("3d", "2d")
# which data/config.json key holds a page's active skin: a folder can have a
# 3D page and a flat page side by side, each with its own skin
CONFIG_KEYS = ("skin", "skin2d")
PORT = 8430
MAX_BODY = 512 * 1024
SKIN_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$")
SCRIPT_SRC_RE = re.compile(r"""<script[^>]+\bsrc=["']([^"']+)["']""", re.I)
DESIGNER_ASSET_EXTS = {".html", ".js", ".css", ".svg", ".png", ".ico"}
TEXT_TYPES = {".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".md"}

_lock = threading.Lock()


class ApiError(Exception):
    pass


# ---------- small file helpers ----------

def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


# ---------- config: which app folder the designer is pointed at ----------

def load_config():
    config = read_json(CONFIG_FILE, {})
    if not isinstance(config, dict):
        config = {}
    config.setdefault("targetFolder", None)
    config.setdefault("recentFolders", [])
    if not config["targetFolder"]:
        # first run: guess a map folder next to this one (or in a demos/
        # folder, as in the published repo) if one exists
        for guess in (DESIGNER_ROOT.parent / "3-axis-map", DESIGNER_ROOT.parent / "demos" / "3-axis-map"):
            if guess.is_dir():
                config["targetFolder"] = str(guess)
                break
    if config["targetFolder"] and config["targetFolder"] not in config["recentFolders"]:
        config["recentFolders"].insert(0, config["targetFolder"])
    return config


def save_config(config):
    write_json(CONFIG_FILE, config)


def parse_folder_path(raw_path):
    """Forgiving parsing for a pasted/typed folder path: trims whitespace,
    strips a matching pair of surrounding quotes, expands ~, and resolves a
    relative path against the folder this one sits in (so just typing
    "timeline" works when the designer sits next to it), then against a
    demos/ folder there (where a bare "timeline" matches "1-axis-timeline"),
    falling back to the user's home directory."""
    text = raw_path.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in ("'", '"'):
        text = text[1:-1].strip()
    folder = Path(text).expanduser()
    if folder.is_absolute():
        return folder
    demos = DESIGNER_ROOT.parent / "demos"
    for base in (DESIGNER_ROOT.parent, demos):
        if (base / folder).is_dir():
            return base / folder
    if demos.is_dir() and len(folder.parts) == 1:
        matches = [d for d in sorted(demos.iterdir()) if d.is_dir() and d.name.endswith("-" + folder.name)]
        if len(matches) == 1:
            return matches[0]
    return Path.home() / folder


def target_root():
    folder = load_config().get("targetFolder")
    if not folder:
        return None
    root = Path(folder)
    return root if root.is_dir() else None


def require_target():
    root = target_root()
    if root is None:
        raise ApiError("No map folder is open. Enter a folder path first.")
    return root


# ---------- what's in a map folder ----------

def page_has_hook(root, page):
    """A page supports skins if one of the local scripts it loads exposes
    the designer hook (window.__designer) — that hook is the contract
    between an app and this tool."""
    try:
        html = page.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    if "__designer" in html:
        return True
    root_resolved = root.resolve()
    for src in SCRIPT_SRC_RE.findall(html):
        if re.match(r"^[a-z]+:", src) or src.startswith("//"):
            continue
        script = (root / src.split("?")[0]).resolve()
        try:
            script.relative_to(root_resolved)
        except ValueError:
            continue
        if script.is_file() and "__designer" in script.read_text(encoding="utf-8", errors="replace"):
            return True
    return False


def list_pages(root):
    pages = []
    for page in sorted(root.glob("*.html")):
        if page.name == "designer.html":
            continue
        pages.append({"file": page.name, "skinnable": page_has_hook(root, page)})
    return pages


def skin_summary(path):
    data = read_json(path, None)
    if not isinstance(data, dict):
        return None
    return {
        "file": path.stem,
        "name": str(data.get("name") or path.stem),
        "description": str(data.get("description") or ""),
        "kind": data.get("kind") if data.get("kind") in KINDS else None,
    }


def list_skin_dir(folder):
    if not folder.is_dir():
        return []
    summaries = (skin_summary(p) for p in sorted(folder.glob("*.json")))
    return [s for s in summaries if s]


def active_skins(root):
    config = read_json(root / "data" / "config.json", {})
    if not isinstance(config, dict):
        config = {}
    return {
        key: config[key] if isinstance(config.get(key), str) and config[key] else "default"
        for key in CONFIG_KEYS
    }


def build_state():
    config = load_config()
    root = target_root()
    state = {
        "targetFolder": str(root) if root else config.get("targetFolder"),
        "targetMissing": bool(config.get("targetFolder")) and root is None,
        "recentFolders": config["recentFolders"],
        "library": {kind: list_skin_dir(LIBRARY_DIR / kind) for kind in KINDS},
        "pages": [],
        "skins": [],
        "activeSkins": {},
    }
    if root:
        state["pages"] = list_pages(root)
        state["skins"] = list_skin_dir(root / "skins")
        state["activeSkins"] = active_skins(root)
    return state


# ---------- writes ----------

def clean_skin_file(raw):
    name = str(raw or "").strip()
    if name.lower().endswith(".json"):
        name = name[:-5]
    if not SKIN_FILE_RE.match(name):
        raise ApiError("Skin file names can only use letters, numbers, dashes, underscores and dots.")
    return name


def clean_skin(skin, stem):
    if not isinstance(skin, dict):
        raise ApiError("A skin must be a JSON object.")
    skin = dict(skin)
    if not str(skin.get("name") or "").strip():
        skin["name"] = stem
    return skin


def set_target(payload):
    raw = str(payload.get("path", "")).strip()
    if not raw:
        raise ApiError("A folder path is required.")
    folder = parse_folder_path(raw)
    if not folder.is_dir():
        raise ApiError(f"“{folder}” isn't a folder.")
    if not any(folder.glob("*.html")):
        raise ApiError(f"“{folder}” has no .html pages — point this at a map folder (the one with index.html and data/).")
    config = load_config()
    config["targetFolder"] = str(folder)
    recents = [f for f in config["recentFolders"] if f != str(folder)]
    config["recentFolders"] = ([str(folder)] + recents)[:6]
    save_config(config)
    return build_state()


def refuse_kind_clash(path, skin):
    """A folder's skins/ can hold both kinds, so a file with the same name
    may already be a skin of the *other* kind — never silently replace that."""
    existing = read_json(path, None)
    old_kind = existing.get("kind") if isinstance(existing, dict) else None
    new_kind = skin.get("kind")
    if old_kind in KINDS and new_kind in KINDS and old_kind != new_kind:
        raise ApiError(f"{path.name} is already a {old_kind.upper()} skin — pick another file name for this {new_kind.upper()} one.")


def save_skin(payload):
    root = require_target()
    stem = clean_skin_file(payload.get("file"))
    skin = clean_skin(payload.get("skin"), stem)
    config_key = payload.get("configKey", "skin")
    if config_key not in CONFIG_KEYS:
        raise ApiError("Unknown skin setting.")
    path = root / "skins" / f"{stem}.json"
    refuse_kind_clash(path, skin)
    write_json(path, skin)
    if payload.get("activate"):
        data_dir = root / "data"
        if not data_dir.is_dir():
            raise ApiError("Saved the skin, but this folder has no data/ folder to set it active in.")
        config_path = data_dir / "config.json"
        site_config = read_json(config_path, {})
        if not isinstance(site_config, dict):
            site_config = {}
        site_config[config_key] = stem
        write_json(config_path, site_config)
    return build_state()


def save_library_skin(kind, payload):
    if kind not in KINDS:
        raise ApiError("Unknown skin kind.")
    stem = clean_skin_file(payload.get("file"))
    skin = clean_skin(payload.get("skin"), stem)
    if skin.get("kind") not in (None, kind):
        raise ApiError(f"That's a {skin['kind'].upper()} skin — it can't go in the {kind.upper()} library.")
    write_json(LIBRARY_DIR / kind / f"{stem}.json", skin)
    return build_state()


# ---------- http ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "Designer"

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        # this tool gets edited and reloaded constantly — stale browser
        # caching of html/css/js (or of the previewed app) is never wanted
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _host_ok(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].lower()
        return host in ("localhost", "127.0.0.1")

    def _send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status, payload):
        self._send_bytes(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _send_file(self, path):
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        if path.suffix.lower() in TEXT_TYPES and "charset" not in content_type:
            content_type += "; charset=utf-8"
        self._send_bytes(200, path.read_bytes(), content_type)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError("That request is too large.")
        raw = self.rfile.read(length) if length else b""
        data = json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(data, dict):
            raise ApiError("Expected a JSON object.")
        return data

    def _serve_app(self, path):
        root = target_root()
        if root is None:
            self._send_json(404, {"error": "No map folder is open."})
            return
        rel = unquote(path[len("/app/"):]) or "index.html"
        resolved_root = root.resolve()
        target = (root / rel).resolve()
        try:
            target.relative_to(resolved_root)
        except ValueError:
            self._send_json(403, {"error": "Outside the map folder."})
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            self._send_json(404, {"error": f"{rel} not found in the map folder."})
            return
        self._send_file(target)

    def _serve_designer_asset(self, path):
        name = "index.html" if path in ("", "/") else path.lstrip("/")
        asset = DESIGNER_ROOT / name
        if "/" in name or asset.suffix.lower() not in DESIGNER_ASSET_EXTS or not asset.is_file():
            self._send_json(404, {"error": "not found"})
            return
        self._send_file(asset)

    def do_GET(self):
        if not self._host_ok():
            self._send_json(403, {"error": "Forbidden host."})
            return
        path = urlparse(self.path).path
        if path == "/api/state":
            self._send_json(200, build_state())
            return
        match = re.fullmatch(r"/api/library/(3d|2d)/([^/]+)", path)
        if match:
            kind, name = match.groups()
            try:
                stem = clean_skin_file(unquote(name))
            except ApiError as exc:
                self._send_json(400, {"error": str(exc)})
                return
            data = read_json(LIBRARY_DIR / kind / f"{stem}.json", None)
            if data is None:
                self._send_json(404, {"error": "That library skin doesn't exist."})
            else:
                self._send_json(200, data)
            return
        if path.startswith("/app/"):
            self._serve_app(path)
            return
        self._serve_designer_asset(path)

    def do_POST(self):
        if not self._host_ok():
            self._send_json(403, {"error": "Forbidden host."})
            return
        if self.headers.get("X-Requested-With") != "designer":
            self._send_json(403, {"error": "Missing X-Requested-With header."})
            return
        path = urlparse(self.path).path
        try:
            payload = self._read_json_body()
            with _lock:
                if path == "/api/target":
                    result = set_target(payload)
                elif path == "/api/skins":
                    result = save_skin(payload)
                else:
                    match = re.fullmatch(r"/api/library/(3d|2d)", path)
                    if not match:
                        self._send_json(404, {"error": "not found"})
                        return
                    result = save_library_skin(match.group(1), payload)
            self._send_json(200, result)
        except Exception as exc:  # local tool: surface the error, don't crash the server
            self._send_json(400, {"error": str(exc)})


def main():
    parser = argparse.ArgumentParser(description="Designer for the map apps.")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--no-open", action="store_true", help="don't open a browser window")
    args = parser.parse_args()

    mimetypes.add_type("application/json", ".json")
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}"
    root = target_root()
    print(f"Designer serving at {url}")
    print(f"  Map folder: {root if root else '(not set — enter one in the designer)'}")
    if not args.no_open:
        print("Opening in your browser... (leave this window open — closing it stops the server)")
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
