# -*- coding: utf-8 -*-
"""web/template.html + web/data.json -> web/index.html

템플릿에는 급여 데이터가 없어 공개 저장소에 올려도 되고,
빌드 결과물인 index.html에는 데이터가 박히므로 커밋하지 않는다.
"""
import sys, io, subprocess
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

subprocess.run([sys.executable, "src/export_web.py"], check=True)

tpl = Path("web/template.html").read_text(encoding="utf-8")
data = Path("web/data.json").read_text(encoding="utf-8").replace("</", "<" + chr(92) + "/")
out = Path("web/index.html")
out.write_text(tpl.replace("__BUNDLE__", data), encoding="utf-8")
print(f"web/index.html  {out.stat().st_size:,}바이트")
