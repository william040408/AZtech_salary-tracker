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

SRC = pathlib.Path("web/guide.html")
OUT = pathlib.Path("급여기록부_설명.pdf")

PAGE_WIDTH = "118mm"      # 여백을 빼면 약 370px — 휴대폰 배치가 걸리는 폭
PAGE_HEIGHT = "210mm"

# 인쇄용 보정. 화면과 달리 종이는 항상 밝은 바탕이고, 표·그림이 페이지 경계에서
# 잘리면 읽기 어려워 통째로 넘긴다.
PRINT_CSS = """
@page { margin: 11mm 9mm 13mm; }
body { background: #fff !important; }
figure, .card, pre, table, .links a, .steps li, dl { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
h2 { break-before: auto; }
a { text-decoration: none; }
.links a { border-color: #dbe1e8 !important; }
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
