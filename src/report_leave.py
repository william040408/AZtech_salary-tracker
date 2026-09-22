# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")
from parse import load_dir
from model import verify, DAY_PAY
from leave import reconstruct
from calendar_kr import weekday_holidays

slips = [verify(p) for p in load_dir("data/raw")]
rows = reconstruct(slips, first_accrual_month="2026-04")  # 입사 3/2 -> 첫 발생 4/2

print("■ 명세서로 역산한 휴가 사용 내역")
print(f"{'급여월':<9}{'발생':>5}{'현금화':>7}{'유급휴가':>9}{'무급휴가':>9}{'총 쉰날':>8}{'차감액':>11}   근거")
print("-" * 86)
tot = {k: 0 for k in ("accrued", "cashed", "paid_off", "unpaid_off", "total_off", "deducted_won")}
for r in rows:
    for k in tot:
        tot[k] += r[k]
    why = ("연차수당 지급됨 → 안 쉼" if r["cashed"]
           else ("연차수당 없음 + 기본급 차감 → 유급 1일 + 무급 추가" if r["unpaid_off"]
                 else "연차수당 없음, 차감 없음 → 유급 1일 사용"))
    if r["accrued"] == 0:
        why = "입사 첫 달, 연차 미발생"
    print(f"{r['period']:<9}{r['accrued']:>5}{r['cashed']:>7}{r['paid_off']:>9g}{r['unpaid_off']:>9g}"
          f"{r['total_off']:>8g}{r['deducted_won']:>11,}   {why}")
print("-" * 86)
print(f"{'합계':<9}{tot['accrued']:>5}{tot['cashed']:>7}{tot['paid_off']:>9g}{tot['unpaid_off']:>9g}"
      f"{tot['total_off']:>8g}{tot['deducted_won']:>11,}")

print(f"\n■ 결론")
print(f"  총 쉰 날: {tot['total_off']:g}일  (유급 {tot['paid_off']:g}일 + 무급 {tot['unpaid_off']:g}일)")
print(f"  무급으로 처리되어 못 받은 금액: {tot['deducted_won']:,}원")
print(f"  연차수당으로 받은 금액:         {tot['cashed']*DAY_PAY:,}원")
print(f"  잔여 연차: 0일  (매달 정산되어 이월되지 않는 구조)")
