# -*- coding: utf-8 -*-
"""설명 문서를 휴대폰에서 읽기 좋은 PDF 로 만든다.

  python src/make_pdf.py

A4 로 뽑으면 휴대폰에서 글자가 작아 확대해야 한다. 그래서 종이를 폰 화면에
가깝게 좁고 길게 잡는다. 폭이 좁아지면 페이지의 반응형 규칙이 걸려
휴대폰용 배치가 그대로 적용된다.
"""
import io
import pathlib
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from playwright.sync_api import sync_playwright

# python src/make_pdf.py [문서이름]  — 기본은 guide
DOCS = {
    "guide":  ("web/guide.html",  "자료/급여기록부_설명.pdf"),
    "deploy": ("web/deploy.html", "자료/급여기록부_구조.pdf"),
}
_name = sys.argv[1] if len(sys.argv) > 1 else "guide"
if _name not in DOCS:
    sys.exit(f"[!] 모르는 문서: {_name} (가능: {', '.join(DOCS)})")
SRC = pathlib.Path(DOCS[_name][0])
OUT = pathlib.Path(DOCS[_name][1])

PAGE_WIDTH = "118mm"      # 여백을 빼면 약 370px — 휴대폰 배치가 걸리는 폭
PAGE_HEIGHT = "210mm"

# 인쇄용 보정. 화면과 달리 종이는 항상 밝은 바탕이고, 표·그림이 페이지 경계에서
# 잘리면 읽기 어려워 통째로 넘긴다.
PRINT_CSS = """
@page { margin: 10mm 9mm 12mm; }
body { background: #fff !important; }

/* 화면에서는 가로로 밀어 볼 수 있지만 종이에서는 잘려 버린다.
   코드와 표는 줄을 접어서 전부 보이게 한다. */
pre { white-space: pre-wrap; word-break: break-word; overflow: visible; }
.tw { overflow: visible; }
table { min-width: 0; font-size: 12.5px; }
th, td { padding: 7px 8px; }
td:first-child { white-space: normal; }

/* 통째로 넘겨야 하는 덩어리. 쪽 경계에서 갈리면 읽을 수 없다. */
figure, .card, pre, .tw, .links a, .steps li { break-inside: avoid; }

/* 제목만 쪽 끝에 남거나, 용어가 뜻과 갈라지지 않게 */
h1, h2, h3, dt { break-after: avoid; }
dd { break-before: avoid; }

/* 문단이 한 줄만 남기고 넘어가지 않게.
   절마다 쪽을 강제하면 빈 쪽이 생겨서, 흐르게 두고 덩어리만 지킨다. */
p, li, dd { orphans: 3; widows: 3; }

h2 { margin-top: 32px !important; }
figure svg { max-height: 150mm; }
a { text-decoration: none; }
"""


def main():
    if not SRC.exists():
        sys.exit(f"[!] {SRC} 가 없습니다.")
    url = "file:///" + SRC.resolve().as_posix()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(color_scheme="light")   # 종이는 밝은 바탕으로
        page.goto(url, wait_until="networkidle", timeout=60000)
        page.add_style_tag(content=PRINT_CSS)
        page.wait_for_timeout(1200)                      # 웹폰트가 자리잡을 시간
        page.pdf(
            path=str(OUT),
            width=PAGE_WIDTH,
            height=PAGE_HEIGHT,
            print_background=True,
            prefer_css_page_size=False,
            display_header_footer=True,
            header_template="<div></div>",
            footer_template=(
                '<div style="width:100%;font-size:7pt;color:#888;'
                'text-align:center;font-family:sans-serif;">'
                '<span class="pageNumber"></span> / <span class="totalPages"></span></div>'
            ),
            margin={"top": "11mm", "bottom": "13mm", "left": "9mm", "right": "9mm"},
        )
        browser.close()

    print(f"{OUT}  {OUT.stat().st_size:,}바이트")
    print(f"  종이 크기 {PAGE_WIDTH} x {PAGE_HEIGHT} — 휴대폰에서 확대 없이 읽히는 폭")


if __name__ == "__main__":
    main()
