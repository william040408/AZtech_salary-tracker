# -*- coding: utf-8 -*-
"""Gmail에서 이카운트 급여명세서 메일을 찾아 본문 링크를 열고 HTML을 저장한다.

  python src/fetch.py links   # 1단계: 메일에서 링크만 추출 (접속 확인용)
  python src/fetch.py fetch   # 2단계: 링크를 열어 HTML 저장
"""
import sys, io, os, re, imaplib, email, html, json
from email.header import decode_header
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

ENV = Path(".env")
RAW = Path("data/raw")
HTMLDIR = RAW / "html"
SHORT_LINK = re.compile(r"https?://l\.ecount\.com/[A-Za-z0-9]+")
SUBJECT_HINT = "급여명세서"


def load_env():
    if not ENV.exists():
        sys.exit("[!] .env 파일이 없습니다. 아래 형식으로 만들어 주세요:\n"
                 "    GMAIL_USER=본인주소@gmail.com\n"
                 "    GMAIL_APP_PASSWORD=앱비밀번호16자리")
    cfg = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    return cfg


def _decode(s):
    if not s:
        return ""
    return "".join(
        (b.decode(enc or "utf-8", "replace") if isinstance(b, bytes) else b)
        for b, enc in decode_header(s)
    )


def _body_text(msg):
    """메일 본문을 문자열로 (멀티파트면 전부 이어붙임)."""
    out = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            continue
        if not payload:
            continue
        cs = part.get_content_charset() or "utf-8"
        out.append(payload.decode(cs, "replace"))
    return "\n".join(out)


def collect():
    """급여명세서 메일 -> [{subject, date, link}]"""
    cfg = load_env()
    M = imaplib.IMAP4_SSL("imap.gmail.com")
    M.login(cfg["GMAIL_USER"], cfg["GMAIL_APP_PASSWORD"].replace(" ", ""))
    M.select("INBOX")

    # 한글 제목 검색은 IMAP 인코딩 이슈가 있어 발신자로 거르고 제목은 파이썬에서 판정
    typ, data = M.search(None, 'FROM', '"ecount.com"')
    ids = data[0].split()
    print(f"  ecount.com 발신 메일 {len(ids)}통 발견")

    found = []
    for i in ids:
        typ, d = M.fetch(i, "(RFC822)")
        msg = email.message_from_bytes(d[0][1])
        subj = _decode(msg.get("Subject"))
        if SUBJECT_HINT not in subj:
            continue
        body = _body_text(msg)
        links = SHORT_LINK.findall(html.unescape(body))
        found.append({
            "subject": subj,
            "date": msg.get("Date"),
            "links": sorted(set(links)),
        })
    M.logout()
    return found


def cmd_links():
    found = collect()
    print(f"\n  '{SUBJECT_HINT}' 포함 메일 {len(found)}통\n" + "-" * 70)
    for f in found:
        n = len(f["links"])
        print(f"  {f['date']}")
        print(f"    {f['subject']}")
        print(f"    링크 {n}개" + ("  ← 링크를 못 찾음!" if n == 0 else ""))
        for L in f["links"]:
            print(f"      {L[:28]}...")   # 토큰은 가려서 출력
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "links.json").write_text(
        json.dumps(found, ensure_ascii=False, indent=2), encoding="utf-8")
    print("-" * 70)
    print(f"  전체 결과 -> data/raw/links.json  (커밋 제외 대상)")


def cmd_fetch():
    import requests
    found = json.loads((RAW / "links.json").read_text(encoding="utf-8"))
    HTMLDIR.mkdir(parents=True, exist_ok=True)
    s = requests.Session()
    s.headers["User-Agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    for f in found:
        for L in f["links"]:
            code = L.rsplit("/", 1)[-1]
            try:
                r = s.get(L, timeout=30, allow_redirects=True)
            except Exception as e:
                print(f"  [!] {code}: {e}")
                continue
            out = HTMLDIR / f"{code}.html"
            out.write_text(r.text, encoding="utf-8")
            hit = "기본급" in r.text
            print(f"  {code}  HTTP {r.status_code}  {len(r.text):>7,}바이트  "
                  f"최종 {r.url.split('?')[0]}  {'★ 기본급 발견' if hit else '(표 없음 - JS 렌더링 의심)'}")
    print(f"\n  HTML -> {HTMLDIR}/  (커밋 제외 대상)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "links"
    {"links": cmd_links, "fetch": cmd_fetch}[cmd]()
