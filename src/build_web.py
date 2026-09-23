# -*- coding: utf-8 -*-
"""배포할 파일을 docs/ 에 만든다.

소스는 web/ 에 세 개로 나뉘어 있다.

    web/index.html   뼈대
    web/style.css    화면
    web/app.js       동작

하는 일은 두 가지뿐이다.

  1. 세 파일을 docs/ 로 옮긴다. index.html 의 __BUNDLE__ 자리는 그대로 둔다 —
     급여 데이터는 페이지가 열린 뒤 금고에서 받아오므로 공개 저장소에 올라가지
     않는다.
  2. style.css 와 app.js 주소 뒤에 내용 지문을 붙인다. 안 그러면 고쳐서 올려도
     브라우저가 예전 파일을 그대로 쓴다.
"""
import hashlib
import io
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

SRC = Path("web")
OUT = Path("docs")
ASSETS = ("style.css", "app.js")


def stamp(text):
    """style.css → style.css?v=1a2b3c4d. 내용이 바뀔 때만 주소가 바뀐다."""
    for name in ASSETS:
        h = hashlib.md5((SRC / name).read_bytes()).hexdigest()[:8]
        text = re.sub(r'(?<=["/])' + re.escape(name) + r'(?=["?])', f"{name}?v={h}", text)
    return text


subprocess.run([sys.executable, "src/export_web.py"], check=True)

OUT.mkdir(exist_ok=True)

html = stamp((SRC / "index.html").read_text(encoding="utf-8"))
(OUT / "index.html").write_text(html, encoding="utf-8")
for name in ASSETS:
    shutil.copyfile(SRC / name, OUT / name)
(OUT / ".nojekyll").write_text("", encoding="utf-8")

assert "__BUNDLE__" in html, "자리표시자가 사라졌습니다 — 데이터가 섞여 들어갔는지 확인하세요"

for f in [OUT / "index.html"] + [OUT / n for n in ASSETS]:
    print(f"{f}  {f.stat().st_size:,}바이트")
