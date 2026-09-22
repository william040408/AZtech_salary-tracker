# -*- coding: utf-8 -*-
"""급여·근태 데이터를 Cloudflare Worker 에 올린다.

  python src/push_data.py

.env 에 주소와 암구호가 있어야 한다:
  WORKER_URL=https://이름.계정.workers.dev
  WORKER_PASS=암구호
"""
import sys, io, subprocess
from pathlib import Path
import requests
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

env = {}
p = Path(".env")
if p.exists():
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()

url, pw = env.get("WORKER_URL"), env.get("WORKER_PASS")
if not url or not pw:
    sys.exit("[!] .env 에 WORKER_URL 과 WORKER_PASS 를 넣어 주세요.")

subprocess.run([sys.executable, "src/export_web.py"], check=True)
body = Path("web/data.json").read_text(encoding="utf-8")

r = requests.put(url.rstrip("/") + "/bundle", data=body.encode("utf-8"),
                 headers={"x-pass": pw, "content-type": "application/json"}, timeout=30)
if r.status_code == 200:
    print(f"  올림 완료 — {r.json().get('bytes', 0):,}바이트")
else:
    print(f"  [!] 실패 HTTP {r.status_code}: {r.text[:200]}")
    sys.exit(1)
