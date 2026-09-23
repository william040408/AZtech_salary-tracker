# -*- coding: utf-8 -*-
"""이카운트 명세서 링크를 실제 브라우저로 열어 표를 읽어온다.

이카운트는 메일 링크에서 명세서 화면까지 여러 단계를 자바스크립트로 처리한다.
그 과정을 흉내내는 대신 브라우저가 평소처럼 페이지를 열도록 두고 결과만 읽는다.
이카운트가 내부 방식을 바꿔도 영향을 받지 않는다.
"""
import sys, io, json, re
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

RAW = Path("data/raw")
TITLE = re.compile(r"(\d{4})/(\d{2})\s*\d+차수")
MARKER = "기본급"


def _payslip_text(page):
    """명세서 표가 들어있는 프레임을 찾아 텍스트로."""
    for fr in page.frames:
        try:
            t = fr.locator("body").inner_text(timeout=3000)
        except Exception:
            continue
        if MARKER in t and TITLE.search(t):
            return t
    return None


def period_of(mail_date):
    """메일 받은 달의 전월이 그 명세서의 급여월이다 (9/10 도착 -> 2026-08)."""
    from email.utils import parsedate_to_datetime
    try:
        d = parsedate_to_datetime(mail_date)
    except Exception:
        return None
    y, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
    return f"{y}-{m:02d}"


def already_have():
    """금고에 들어 있는 급여월. 링크를 여는 것은 느리므로 새 것만 연다."""
    env = {}
    f = Path(".env")
    if not f.exists():
        return set()
    for line in f.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    if not env.get("WORKER_URL") or not env.get("WORKER_PASS"):
        return set()
    try:
        import requests
        r = requests.get(env["WORKER_URL"].rstrip("/") + "/bundle",
                         headers={"x-pass": env["WORKER_PASS"]}, timeout=20)
        d = r.json()
        if isinstance(d, str):
            d = json.loads(d)
        return {p["period"] for p in (d.get("payslips") or []) if not p.get("derived")}
    except Exception:
        return set()


def fetch_all(headless=True, only_new=True):
    links = json.loads((RAW / "links.json").read_text(encoding="utf-8"))
    have = already_have() if only_new else set()
    if have:
        print(f"  이미 가진 달 {len(have)}개는 건너뜁니다: {', '.join(sorted(have))}")
    saved, failed = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(locale="ko-KR", viewport={"width": 1400, "height": 1200})
        for entry in links:
            per = period_of(entry.get("date", ""))
            if per and per in have:
                print(f"  [-] {per}  이미 있음 — 건너뜀")
                continue
            for url in entry["links"]:
                code = url.rsplit("/", 1)[-1]
                page = ctx.new_page()
                text = None
                try:
                    page.goto(url, wait_until="networkidle", timeout=45000)
                    page.wait_for_timeout(900)
                    text = _payslip_text(page)
                except PWTimeout:
                    pass
                except Exception as e:
                    print(f"  [!] {code[:8]}...  {type(e).__name__}: {e}")

                if not text:
                    failed.append((code, entry["date"]))
                    print(f"  [x] {code[:8]}...  {entry['date'][:16]}  명세서를 찾지 못함 (만료 추정)")
                    page.close()
                    continue

                m = TITLE.search(text)
                period = f"{m[1]}-{m[2]}"
                out = RAW / f"{period}.txt"
                out.write_text(text, encoding="utf-8")
                saved.append(period)
                print(f"  [o] {code[:8]}...  {entry['date'][:16]}  -> {out.name}  ({len(text)}자)")
                page.close()
        browser.close()

    print(f"\n  저장 {len(saved)}건: {', '.join(sorted(saved))}")
    if failed:
        print(f"  실패 {len(failed)}건: {', '.join(c[:8]+'...' for c, _ in failed)}")
    return saved, failed


if __name__ == "__main__":
    fetch_all(headless="--show" not in sys.argv, only_new="--all" not in sys.argv)
