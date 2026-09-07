#!/usr/bin/env python3
"""Serve the dashboard and proxy PMC19 county data for local development."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
import argparse


PMC_CURRENT_URL = "https://pmc19.com/maps/data/current.json"


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/pmc-current":
            return super().do_GET()

        try:
            request = Request(PMC_CURRENT_URL, headers={"User-Agent": "COVID-Wastewater-YoY/1.0"})
            with urlopen(request, timeout=20) as response:
                data = response.read()
        except OSError as error:
            self.send_error(502, f"Could not retrieve PMC19 data: {error}")
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    DashboardHandler.directory = str(root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), DashboardHandler)
    print(f"Dashboard available at http://127.0.0.1:{args.port}")
    server.serve_forever()