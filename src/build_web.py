# -*- coding: utf-8 -*-
"""템플릿 하나에서 두 가지를 만든다.

  web/index.html   급여 데이터를 페이지 안에 박은 것. 클로드 아티팩트용.
                   데이터가 들어있으므로 커밋하지 않는다.
  docs/index.html  데이터 없이 원격에서 받아오는 것. GitHub Pages 용.
                   코드뿐이라 공개 저장소에 올려도 된다.

아티팩트는 문서 껍데기(doctype, charset, viewport)를 자동으로 씌워 주지만
GitHub Pages 는 파일을 그대로 내보내므로 docs 쪽에는 직접 붙여야 한다.
"""
import io
import subprocess
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HEAD = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#f3f5f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1319" media="(prefers-color-scheme: dark)">
<style>
:root{color-scheme:light dark;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0}
img{max-width:100%}
[hidden]{display:none!important}
</style>
"""

subprocess.run([sys.executable, "src/export_web.py"], check=True)

tpl = Path("web/template.html").read_text(encoding="utf-8")
data = Path("web/data.json").read_text(encoding="utf-8").replace("</", "<" + chr(92) + "/")

embedded = Path("web/index.html")
embedded.write_text(tpl.replace("__BUNDLE__", data), encoding="utf-8")

head, sep, rest = tpl.partition("</style>")
remote = Path("docs/index.html")
remote.parent.mkdir(exist_ok=True)
remote.write_text(                       # __BUNDLE__ 자리표시자를 그대로 둔다
    HEAD + head + sep + "\n</head>\n<body>\n" + rest + "\n</body>\n</html>\n",
    encoding="utf-8",
)
Path("docs/.nojekyll").write_text("", encoding="utf-8")

for f in (embedded, remote):
    print(f"{f}  {f.stat().st_size:,}바이트")
