"""NEON GRID TPC 本機伺服器（不需要 Node）。
用法：python serve.py [port]       預設 8800，然後開 http://localhost:8800/
- 一律回 no-store，改完檔案重新整理就會讀到新版。
- 明確設定 .js / .mjs 的 MIME（Windows 登錄檔有時把 .js 設成 text/plain，ES module 會被瀏覽器拒絕）。
- 綁 0.0.0.0：同一個 Wi-Fi 的手機可以用 http://<電腦 IP>:8800/ 測手機版。
"""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary",
                      ".css": "text/css", ".json": "application/json", ".html": "text/html; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if args and str(args[1]) not in ("200", "304"):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8800
    print(f"NEON GRID TPC: http://localhost:{port}/")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), functools.partial(Handler, directory=ROOT)).serve_forever()
