#!/usr/bin/env python3
"""Local static server for Timeline.

Just `python3 -m http.server` plus a no-store cache header — this project
gets edited and reloaded constantly (skins especially), and the plain
stdlib server's default caching means a browser can keep serving a stale
script.js or skins/*.json indefinitely, even in a brand-new tab, since
disk cache is shared across tabs in the same browser profile.
"""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 8081


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Serving {ROOT} at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
