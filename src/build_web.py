# -*- coding: utf-8 -*-
"""템플릿에서 배포할 파일들을 만든다.

  web/index.html    급여 데이터를 페이지 안에 박은 것. 클로드 아티팩트용.
                    데이터가 들어있으므로 커밋하지 않는다.
  docs/index.html   데이터 없이 원격에서 받아오는 것. GitHub Pages 용.

아티팩트는 문서 껍데기(doctype, charset, viewport)를 자동으로 씌워 주지만
GitHub Pages 는 파일을 그대로 내보내므로 docs 쪽에는 직접 붙여야 한다.
"""
import io
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from page import embed, wrap

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

subprocess.run([sys.executable, "src/export_web.py"], check=True)

tpl = Path("web/template.html").read_text(encoding="utf-8")
data = Path("web/data.json").read_text(encoding="utf-8")

Path("docs").mkdir(exist_ok=True)

embedded = Path("web/index.html")
embedded.write_text(embed(tpl, data), encoding="utf-8")

remote = Path("docs/index.html")                 # __BUNDLE__ 자리표시자를 그대로 둔다
remote.write_text(wrap(tpl), encoding="utf-8")

Path("docs/.nojekyll").write_text("", encoding="utf-8")

for f in (embedded, remote):
    print(f"{f}  {f.stat().st_size:,}바이트")
