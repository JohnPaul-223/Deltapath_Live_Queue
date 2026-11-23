#!/usr/bin/env python3
"""
Deltapath queue wallboard - local relay (no extra packages needed, Python 3.7+).

It serves queue-wallboard.html and forwards /RESTful/... calls to your PBX, so the
browser sees one single address and the CORS block goes away.

Usage:
    python wallboard-proxy.py https://pbx-datche.dbsone.com
    python wallboard-proxy.py https://pbx-datche.dbsone.com --port 8080
    python wallboard-proxy.py https://10.0.0.5 --insecure      (self-signed certificate)

Then open  http://localhost:8080  (or http://<this-pc-ip>:8080 from the TV).
Keep index.html in the same folder as this script.
"""
import argparse, http.client, json, os, socket, ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ap = argparse.ArgumentParser(description="Deltapath wallboard relay")
ap.add_argument("target", help="PBX address, e.g. https://pbx.example.com")
ap.add_argument("--port", type=int, default=8080, help="local port (default 8080)")
ap.add_argument("--insecure", action="store_true", help="do not verify the PBX TLS certificate")
ap.add_argument("--page", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html"))
args = ap.parse_args()

t = urlparse(args.target if "://" in args.target else "https://" + args.target)
HOST = t.hostname
USE_TLS = t.scheme == "https"
PORT = t.port or (443 if USE_TLS else 80)
TARGET = f"{t.scheme}://{t.netloc}"

ctx = ssl.create_default_context()
if args.insecure:
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

FORWARD_REQ = ("cookie", "content-type", "accept", "x-requested-with")


def fix_cookie(c):
    """Make the PBX session cookie usable on plain http://localhost."""
    out = []
    for part in c.split(";"):
        p = part.strip()
        low = p.lower()
        if low == "secure" or low.startswith("domain="):
            continue
        if low.startswith("samesite="):
            p = "SameSite=Lax"
        out.append(p)
    return "; ".join(out)


class Handler(BaseHTTPRequestHandler):
    server_version = "WallboardRelay/1.0"

    def log_message(self, fmt, *a):
        if "/RESTful/" in (a[0] if a else ""):
            return  # keep the console quiet: the page polls every few seconds
        super().log_message(fmt, *a)

    def _reply(self, code, body, ctype="application/json", extra=()):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _handle(self):
        path = self.path
        if path in ("/", "/index.html") or path.startswith("/?"):
            try:
                with open(args.page, "rb") as f:
                    return self._reply(200, f.read(), "text/html; charset=utf-8")
            except OSError:
                return self._reply(500, f"Cannot find {args.page}. Keep index.html next to this script.", "text/plain")
        if path.startswith("/__proxy"):
            return self._reply(200, json.dumps({"target": TARGET}))
        if not path.startswith("/RESTful/"):
            return self._reply(404, "Not found", "text/plain")

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in FORWARD_REQ}
        headers["User-Agent"] = "DeltapathWallboardRelay/1.0"
        try:
            conn = (http.client.HTTPSConnection(HOST, PORT, context=ctx, timeout=15) if USE_TLS
                    else http.client.HTTPConnection(HOST, PORT, timeout=15))
            conn.request(self.command, path, body, headers)
            resp = conn.getresponse()
            data = resp.read()
        except ssl.SSLError as e:
            return self._reply(502, json.dumps({"success": False, "errors": f"TLS error talking to the PBX: {e}. If it uses a self-signed certificate, restart the relay with --insecure."}))
        except (OSError, http.client.HTTPException, socket.timeout) as e:
            return self._reply(502, json.dumps({"success": False, "errors": f"The relay could not reach {TARGET}: {e}"}))

        extra = [("Set-Cookie", fix_cookie(v)) for k, v in resp.getheaders() if k.lower() == "set-cookie"]
        ctype = resp.getheader("Content-Type") or "application/json"
        conn.close()
        self._reply(resp.status, data, ctype, extra)

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = _handle


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "<this-pc-ip>"


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Relaying to {TARGET}")
    print(f"Open on this PC : http://localhost:{args.port}")
    print(f"Open on the TV  : http://{lan_ip()}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
