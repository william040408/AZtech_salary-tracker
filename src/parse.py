# -*- coding: utf-8 -*-
"""이카운트 급여명세서 텍스트 -> 구조화 데이터."""
import re
from pathlib import Path

NUM = re.compile(r"-?[\d,]+")
TITLE = re.compile(r"(\d{4})/(\d{2})\s*(\d+)차수")
PAYDAY = re.compile(r"지급일자\s*:\s*(\d{4})/(\d{2})/(\d{2})")
NAME = re.compile(r"성명\s*:\s*(\S+)")
NET = re.compile(r"실지급액\s*:\s*([\d,]+)")

# 명세서에 등장하는 항목명 (지급/공제)
EARN_ITEMS = {"기본급", "직무수당", "개근수당", "연차수당", "상여금", "연장수당", "야간수당", "휴일수당", "식대"}
DEDUCT_ITEMS = {"소득세", "주민세", "국민연금", "건강보험", "장기요양", "고용보험", "산재보험"}


def _n(s):
    return int(s.replace(",", ""))


def parse(text):
    """명세서 한 장을 dict로. 표가 2열씩 붙어 있어 라인 단위로 항목명/금액 쌍을 훑는다."""
    ps = {"earnings": {}, "deductions": {}, "totals": {}}

    m = TITLE.search(text)
    if not m:
        raise ValueError("차수 제목(YYYY/MM N차수)을 찾지 못했습니다")
    ps["year"], ps["month"], ps["round"] = int(m[1]), int(m[2]), int(m[3])
    ps["period"] = f"{m[1]}-{m[2]}"

    m = PAYDAY.search(text)
    ps["pay_date"] = f"{m[1]}-{m[2]}-{m[3]}" if m else None
    m = NAME.search(text)
    ps["name"] = m[1] if m else None

    for line in text.splitlines():
        cells = [c.strip() for c in line.split("\t")]
        cells = [c for c in cells if c]
        for i, c in enumerate(cells):
            if c in EARN_ITEMS or c in DEDUCT_ITEMS:
                # 항목명 뒤 첫 숫자 셀이 금액
                for nxt in cells[i + 1:]:
                    if NUM.fullmatch(nxt):
                        bucket = "earnings" if c in EARN_ITEMS else "deductions"
                        ps[bucket][c] = _n(nxt)
                        break
        if cells and cells[0] == "공제총액":
            for nxt in cells[1:]:
                if NUM.fullmatch(nxt):
                    ps["totals"]["공제총액"] = _n(nxt)
                    break

    m = NET.search(text)
    if m:
        ps["totals"]["실지급액"] = _n(m[1])

    ps["totals"]["지급총액"] = sum(ps["earnings"].values())
    return ps


def load_dir(d):
    out = []
    for f in sorted(Path(d).glob("*.txt")):
        ps = parse(f.read_text(encoding="utf-8"))
        ps["source"] = f.name
        out.append(ps)
    return out
