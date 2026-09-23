# -*- coding: utf-8 -*-
"""조각 HTML 을 온전한 문서로 감싸는 부분.

web/template.html 은 <title> 로 시작하는 조각이다. 아티팩트는 문서 껍데기를
자동으로 씌워 주지만 GitHub Pages 와 개발용 서버는 그대로 내보내므로 여기서
직접 붙인다. 배포와 개발이 같은 껍데기를 쓰도록 한 군데에 둔다.
"""

HEAD = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#fdf7f8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14050a" media="(prefers-color-scheme: dark)">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="icon" href="icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="급여 기록부">
<meta name="mobile-web-app-capable" content="yes">
<style>
:root{color-scheme:light dark;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0}
img{max-width:100%}
[hidden]{display:none!important}
</style>
"""


def wrap(src, extra=""):
    """조각 HTML 을 온전한 문서로 감싼다. 페이지 자신의 <style> 뒤에서 자른다."""
    head, sep, rest = src.partition("</style>")
    return HEAD + head + sep + "\n</head>\n<body>\n" + rest + extra + "\n</body>\n</html>\n"


def embed(tpl, data):
    """__BUNDLE__ 자리에 데이터를 박는다. </ 는 <script> 를 일찍 닫으므로 피한다."""
    return tpl.replace("__BUNDLE__", data.replace("</", "<" + chr(92) + "/"))
