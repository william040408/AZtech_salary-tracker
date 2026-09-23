# -*- coding: utf-8 -*-
"""개발용 서버 — 고치고 저장하면 브라우저가 알아서 새로 그린다.

    python src/dev.py

web/index.html · web/style.css · web/app.js 중 아무거나 고치고 저장하면
열려 있는 화면이 바로 바뀐다. 빌드도 커밋도 푸시도 필요 없다. 다 마음에
들면 그때

    python src/build_web.py && git add -A && git commit -m "..." && git push

폰에서도 보려면 같은 와이파이에 물린 뒤 아래에 찍히는 주소를 치면 된다.

급여 데이터는 web/data.json 에, 달력에 찍은 기록은 금고에 있다. 둘을 합쳐
페이지에 박아 내려 주므로 배포된 화면과 같은 숫자가 나온다. 다만 여기서
달력을 고쳐도 금고에 저장되지는 않는다 — 디자인을 볼 때 쓰는 서버라 그렇다.
"""
import http.server
import io
import json
import socket
import socketserver
import sys
import urllib.request
import webbrowser
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web"
DOCS = ROOT / "docs"
DATA = SRC / "data.json"
WATCH = ["index.html", "style.css", "app.js"]     # 이 중 하나라도 바뀌면 새로 그린다
PORT = 8787

TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
         ".png": "image/png", ".webmanifest": "application/manifest+json",
         ".json": "application/json"}

# 저장하면 바로 다시 그리도록, 파일이 바뀌었는지만 계속 물어보는 조각
RELOAD = """
<script>
(() => {
  let seen = null;
  setInterval(async () => {
    try {
      const t = await (await fetch("/__mtime", { cache: "no-store" })).text();
      if (seen === null) seen = t;
      else if (t !== seen) location.reload();
    } catch {}
  }, 600);
})();
</script>
"""

LEAVE = {}


def env():
    out = {}
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def fetch_leave():
    """달력에 찍은 기록은 web/data.json 이 아니라 금고에만 있다.
    배포된 화면과 숫자를 맞추려면 여기서 한 번 가져와야 한다."""
    e = env()
    if not e.get("WORKER_URL") or not e.get("WORKER_PASS"):
        return None, "WORKER_URL·WORKER_PASS 가 없어 달력 기록 없이 띄웁니다"
    req = urllib.request.Request(
        e["WORKER_URL"].rstrip("/") + "/leave",
        headers={"x-pass": e["WORKER_PASS"],
                 # 클라우드플레어가 파이썬 기본 요청을 봇으로 보고 막는다
                 "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                               "AppleWebKit/537.36 Chrome/131.0 Safari/537.36"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read()), None
    except Exception as ex:
        return None, f"금고에서 달력 기록을 못 읽었습니다 ({ex.__class__.__name__})"


def page():
    """index.html 의 __BUNDLE__ 자리에 데이터를 박고 새로고침 조각을 끼운다."""
    data = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    data["leave"] = LEAVE
    data["dev"] = True
    blob = json.dumps(data, ensure_ascii=False).replace("</", "<" + chr(92) + "/")
    html = (SRC / "index.html").read_text(encoding="utf-8")
    return html.replace("__BUNDLE__", blob).replace("</body>", RELOAD + "</body>")


def mtimes():
    return "|".join(str((SRC / n).stat().st_mtime) for n in WATCH if (SRC / n).exists())


def lan_ip():
    """폰에서 칠 주소를 알아내려고 바깥으로 한 번 찔러 본다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass                                   # 요청마다 한 줄씩 찍히면 시끄럽다

    def send_bytes(self, body, ctype):
        self.send_response(200)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]         # ?v=... 는 배포용이라 여기선 버린다

        if path == "/__mtime":
            return self.send_bytes(mtimes().encode(), "text/plain")

        if path in ("/", "/index.html"):
            try:
                return self.send_bytes(page().encode("utf-8"), TYPES[".html"])
            except Exception as ex:            # 고치다 깨져도 서버는 살아 있어야 한다
                msg = f"<pre style='padding:20px;font:14px monospace;color:#b4485c'>{ex}</pre>"
                return self.send_bytes((msg + RELOAD).encode("utf-8"), TYPES[".html"])

        name = path.lstrip("/")
        for base in (SRC, DOCS):               # 소스 먼저, 없으면 아이콘 쪽
            f = base / name
            if f.is_file() and base in f.resolve().parents:
                return self.send_bytes(f.read_bytes(),
                                       TYPES.get(f.suffix, "application/octet-stream"))
        self.send_error(404)


class Server(socketserver.ThreadingTCPServer):
    # 윈도우에서 allow_reuse_address 를 켜면 이미 듣고 있는 포트에 하나 더
    # 붙을 수 있다. 그러면 옛 서버가 요청을 가로채 고친 것이 안 보인다.
    allow_reuse_address = False
    daemon_threads = True


if __name__ == "__main__":
    missing = [n for n in WATCH if not (SRC / n).exists()]
    if missing:
        sys.exit(f"  web/ 에 {', '.join(missing)} 가 없습니다")
    if not DATA.exists():
        print("  [i] web/data.json 이 없습니다 — python src/export_web.py 를 먼저 돌리세요")

    LEAVE, why = fetch_leave()
    if LEAVE is None:
        LEAVE = {}
        print(f"  [i] {why}")
    else:
        print(f"  금고에서 달력 기록 {len(LEAVE)}건을 가져왔습니다")

    try:
        srv = Server(("0.0.0.0", PORT), Handler)
    except OSError:
        sys.exit(f"  {PORT} 번 포트를 이미 쓰고 있습니다. 먼저 띄운 서버를 Ctrl+C 로 끄세요.")

    here, lan = f"http://localhost:{PORT}", f"http://{lan_ip()}:{PORT}"
    print(f"\n  이 컴퓨터   {here}")
    print(f"  폰·태블릿   {lan}   (같은 와이파이)")
    print(f"\n  web/{' · web/'.join(WATCH)} 을 고치고 저장하면 화면이 바로 바뀝니다.")
    print("  멈추려면 Ctrl+C\n")
    webbrowser.open(here)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("  멈췄습니다.")
