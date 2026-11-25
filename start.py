#!/usr/bin/env python3
"""Serve only this package locally; requires Python 3, no pip packages."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0,
                        help="Port number; default chooses a free port")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(SimpleHTTPRequestHandler, directory=str(root))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as exc:
        parser.exit(1, f"Could not start: {exc}. Try omitting --port.\n")
    url = f"http://127.0.0.1:{server.server_port}/"
    print(f"Open: {url}", flush=True)
    print("Press Ctrl+C to stop. No internet or API is required.", flush=True)
    if not args.no_browser:
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
