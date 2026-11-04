"""Serve the map-only static build under the same subpath as GitHub Pages."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parents[1] / 'web/dist'
assert (root / 'index.html').is_file(), 'Build the map-only website first.'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if not path.startswith('/fire-monitoring/'):
            self.send_error(404)
            return
        self.path = self.path[len('/fire-monitoring'):]
        super().do_GET()

ThreadingHTTPServer(('127.0.0.1', 5082), Handler).serve_forever()
