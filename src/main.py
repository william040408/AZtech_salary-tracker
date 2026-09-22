# -*- coding: utf-8 -*-
import sys, io
from datetime import date
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")
from parse import load_dir
from model import verify, accrued_leave, HIRE_DATE, FULL_BASE, DAY_PAY, HOURLY

slips = [verify(p) for p in load_dir("data/raw")]

print("=" * 78)
print(f"  시급 {HOURLY:,}원 / 만근 기본급 {FULL_BASE:,}원 / 1일치 {DAY_PAY:,}원")
print("=" * 78)

hdr = f"{'급여월':<9}{'지급일':<12}{'기본급':>11}{'연차사용':>7}{'연차현금':>7}{'지급총액':>11}{'실지급':>11}"
print(hdr)
print("-" * 78)
tot_used = tot_cash = 0
for p in slips:
    u, c = p["leave_used"], p["leave_cashed"]
    tot_used += u or 0
    tot_cash += c or 0
    print(f"{p['period']:<9}{p['pay_date'] or '-':<12}{p['earnings'].get('기본급',0):>11,}"
          f"{('%d일'%u) if u else '-':>8}{('%d일'%c) if c else '-':>8}"
          f"{p['totals']['지급총액']:>11,}{p['computed_net']:>11,}")
print("-" * 78)

print("\n■ 검산 결과")
clean = True
for p in slips:
    for i in p["issues"]:
        print(f"  [!] {p['period']}  {i}"); clean = False
    for n in p["notes"]:
        print(f"  [i] {p['period']}  {n}")
if clean:
    print("  모든 명세서의 산술 검산 통과 (지급합계 / 공제합계 / 고용보험 0.9% / 주민세 10% / 실지급액)")

print("\n■ 연차")
acc = accrued_leave(HIRE_DATE, date.today())
print(f"  입사 {HIRE_DATE} 기준 오늘({date.today()})까지 법정 발생: {acc}일")
print(f"  명세서에서 확인된 사용:   {tot_used}일")
print(f"  명세서에서 확인된 현금화: {tot_cash}일")
print(f"  → 잔여(확인된 명세서 기준): {acc - tot_used - tot_cash}일")

print("\n■ 매달 고정된 공제액 (변동 여부 점검)")
keys = ["소득세", "주민세", "국민연금", "건강보험", "장기요양", "고용보험"]
print(f"  {'':<9}" + "".join(f"{k:>10}" for k in keys))
for p in slips:
    print(f"  {p['period']:<9}" + "".join(f"{p['deductions'].get(k,0):>10,}" for k in keys))
