# -*- coding: utf-8 -*-
"""개발용 서버 — 고치고 저장하면 브라우저가 알아서 새로 그린다.

    python src/dev.py

web/template.html 을 고치고 저장만 하면 열려 있는 화면이 바로 바뀐다.
빌드도 커밋도 푸시도 필요 없다. 다 마음에 들면 그때

    python src/build_web.py && git add -A && git commit -m "..." && git push

폰에서도 보려면 같은 와이파이에 물린 뒤 아래에 찍히는 주소를 치면 된다.

데이터는 web/data.json 을 페이지에 박아서 쓴다. 숫자는 진짜지만 달력에
찍은 것이 금고에 저장되지는 않는다 — 디자인을 볼 때 쓰는 서버라 그렇다.
"""
import http.server
import io
import socket
import socketserver
import sys
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from page import embed, wrap

ROOT = Path(__file__).resolve().parent.parent
TPL = ROOT / "web" / "template.html"
DATA = ROOT / "web" / "data.json"
DOCS = ROOT / "docs"
PORT = 8787

# 저장하면 바로 다시 그리도록, 파일이 바뀌었는지만 계속 물어보는 조각
RELOAD = """
<script>
(() => {
  let seen = null;
  const beat = async () => {
    try {
      const t = await (await fetch("/__mtime", { cache: "no-store" })).text();
      if (seen === null) seen = t;
      else if (t !== seen) location.reload();
    } catch {}
  };
  setInterval(beat, 600);
})();
</script>
"""


def build():
    tpl = TPL.read_text(encoding="utf-8")
    data = DATA.read_text(encoding="utf-8") if DATA.exists() else "{}"
    return wrap(embed(tpl, data), RELOAD).encode("utf-8")


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
        path = self.path.split("?")[0]

        if path == "/__mtime":                 # 템플릿이 언제 바뀌었나
            return self.send_bytes(str(TPL.stat().st_mtime).encode(), "text/plain")

        if path in ("/", "/index.html"):
            try:
                return self.send_bytes(build(), "text/html; charset=utf-8")
            except Exception as e:             # 고치다 깨져도 서버는 살아 있어야 한다
                msg = f"<pre style='padding:20px;font:14px monospace;color:#b4485c'>{e}</pre>"
                return self.send_bytes((msg + RELOAD).encode("utf-8"), "text/html; charset=utf-8")

        f = DOCS / path.lstrip("/")            # 아이콘·manifest 는 docs 에서
        if f.is_file() and DOCS in f.resolve().parents:
            types = {".svg": "image/svg+xml", ".png": "image/png",
                     ".webmanifest": "application/manifest+json"}
            return self.send_bytes(f.read_bytes(), types.get(f.suffix, "application/octet-stream"))

        self.send_error(404)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    if not TPL.exists():
        sys.exit(f"{TPL} 가 없습니다")
    if not DATA.exists():
        print("  [i] web/data.json 이 없습니다 — python src/export_web.py 를 먼저 돌리세요")

    here, lan = f"http://localhost:{PORT}", f"http://{lan_ip()}:{PORT}"
    print(f"\n  이 컴퓨터   {here}")
    print(f"  폰·태블릿   {lan}   (같은 와이파이)")
    print(f"\n  {TPL.relative_to(ROOT)} 을 고치고 저장하면 화면이 바로 바뀝니다.")
    print("  멈추려면 Ctrl+C\n")
    webbrowser.open(here)
    try:
        Server(("0.0.0.0", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("  멈췄습니다.")
