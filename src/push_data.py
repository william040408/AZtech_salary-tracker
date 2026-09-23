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

# 계약 조건도 금고에 둔다. 시급이 바뀌면 여기 한 곳만 고치면 되고,
# 수집 작업은 실행할 때마다 최신 값을 받아 간다.
cfg = Path("config.json")
if cfg.exists():
    rc = requests.put(url.rstrip("/") + "/config", data=cfg.read_bytes(),
                      headers={"x-pass": pw, "content-type": "application/json"}, timeout=30)
    print(f"  설정 올림 — HTTP {rc.status_code}")

subprocess.run([sys.executable, "src/export_web.py"], check=True)

import json
bundle = json.loads(Path("web/data.json").read_text(encoding="utf-8"))

# 금고에 이미 있는 것과 합친다. 통째로 덮어쓰면 안 되는 이유가 둘 있다.
#  - 명세서 링크는 3개월이면 만료된다. 새로 받은 것만 올리면 옛 명세서가 사라지고
#    다시 받아올 방법이 없다.
#  - 근무현황 엑셀이 없는 환경(GitHub Actions)에서는 근태가 비어 나온다.
prev = {}
try:
    old = requests.get(url.rstrip("/") + "/bundle", headers={"x-pass": pw}, timeout=30)
    if old.status_code == 200:
        prev = old.json()
        if isinstance(prev, str):
            prev = json.loads(prev)
except requests.RequestException as e:
    sys.exit(f"[!] 금고를 읽지 못해 중단합니다 (덮어쓰면 자료가 사라집니다): {e}")

merged = {p["period"]: p for p in (prev.get("payslips") or [])}
added = [p["period"] for p in bundle["payslips"] if p["period"] not in merged]
merged.update({p["period"]: p for p in bundle["payslips"]})
bundle["payslips"] = [merged[k] for k in sorted(merged)]
if added:
    print(f"  새 명세서 {len(added)}장: {', '.join(added)}")
print(f"  명세서 {len(bundle['payslips'])}장 (금고에 있던 것 포함)")

if not bundle.get("attendance"):
    kept = prev.get("attendance") or []
    bundle["attendance"] = kept
    bundle["attendanceFrom"] = prev.get("attendanceFrom")
    print(f"  근태 {len(kept)}일은 금고에 있던 것을 그대로 둡니다")

body = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))

r = requests.put(url.rstrip("/") + "/bundle", data=body.encode("utf-8"),
                 headers={"x-pass": pw, "content-type": "application/json"}, timeout=30)
if r.status_code == 200:
    print(f"  올림 완료 — {r.json().get('bytes', 0):,}바이트")
else:
    print(f"  [!] 실패 HTTP {r.status_code}: {r.text[:200]}")
    sys.exit(1)
