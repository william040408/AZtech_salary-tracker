# -*- coding: utf-8 -*-
import sys, io, json
from datetime import date
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")
from parse import load_dir
from model import verify, accrued_leave, HIRE_DATE, FULL_BASE, DAY_PAY, HOURLY
from calendar_kr import actual_pay_date, weekday_holidays, workdays

slips = [verify(p) for p in load_dir("data/raw")]
manual = json.loads(Path("data/manual.json").read_text(encoding="utf-8")) if Path("data/manual.json").exists() else {}

print("=" * 96)
print(f"  시급 {HOURLY:,}원  |  만근 기본급 {FULL_BASE:,}원  |  1일치 {DAY_PAY:,}원  |  입사 {HIRE_DATE}")
print("=" * 96)
print(f"{'급여월':<9}{'실입금일':<13}{'근로일':>5}{'공휴일':>6}{'기본급':>11}{'연차사용':>8}{'연차수당':>8}{'지급총액':>11}{'실수령':>11}")
print("-" * 96)

for k in sorted(manual):
    m = manual[k]
    y, mo = map(int, k.split("-"))
    print(f"{k:<9}{str(actual_pay_date(y,mo)):<13}{workdays(y,mo):>5}{len(weekday_holidays(y,mo)):>6}"
          f"{'?':>11}{'-':>8}{'-':>8}{'?':>11}{m['net']:>11,}  ← 명세서 없음")

tot_used = tot_cash = 0
for p in slips:
    y, mo = p["year"], p["month"]
    u, c = p["leave_used"], p["leave_cashed"]
    tot_used += u or 0
    tot_cash += c or 0
    print(f"{p['period']:<9}{str(actual_pay_date(y,mo)):<13}{workdays(y,mo):>5}{len(weekday_holidays(y,mo)):>6}"
          f"{p['earnings'].get('기본급',0):>11,}{("%gh"%(u*8)) if u else "-":>9}{('%d일'%c) if c else '-':>9}"
          f"{p['totals']['지급총액']:>11,}{p['computed_net']:>11,}")
print("-" * 96)

print("\n■ 산술 검산")
bad = False
for p in slips:
    for i in p["issues"]:
        print(f"  [!] {p['period']}  {i}"); bad = True
if not bad:
    print(f"  명세서 {len(slips)}장 전부 통과 — 지급합계 / 공제합계 / 고용보험 0.9% / 주민세 10% / 실지급액")

print("\n■ 연차수당 ↔ 공휴일 상관관계 검증")
ok = True
for p in slips:
    h = len(weekday_holidays(p["year"], p["month"]))
    cashed = bool(p["earnings"].get("연차수당"))
    match = (h == 0) == cashed
    ok &= match
    print(f"  {p['period']}  공휴일 {h}개 → 연차수당 {'있음' if cashed else '없음'}  {'✔' if match else '✘ 반례!'}")
print(f"  → 가설 '{'공휴일 0개인 달에만 연차수당 지급'}': {'현재까지 반례 없음' if ok else '반례 발견, 폐기'}")

print("\n■ 연차 잔여")
acc = accrued_leave(HIRE_DATE, date.today())
print(f"  법정 발생 (1개월 개근당 1일)        : {acc}일")
print(f"  명세서상 사용 (기본급 차감)         : {tot_used}일")
print(f"  명세서상 현금 수령 (연차수당)       : {tot_cash}일")
print(f"    ├ 해석A '선지급' — 현금화해도 연차는 남음 → 잔여 {acc - tot_used}일")
print(f"    └ 해석B '매수'   — 현금화하면 연차 소멸   → 잔여 {acc - tot_used - tot_cash}일")

print("\n■ 미보유 명세서")
have = {p["period"] for p in slips} | set(manual)
for m in range(2, 10):
    k = f"2026-{m:02d}"
    if k not in have:
        print(f"  {k}  (입금 {actual_pay_date(2026,m)}, 평일 공휴일 {len(weekday_holidays(2026,m))}개)")
