# -*- coding: utf-8 -*-
"""명세서만으로 '언제 며칠 쉬었는지'를 역산한다.

전제(본인 확인): 그 달 만근하면 발생 연차가 그 달 급여에 연차수당으로 바로 현금 지급된다.
따라서 각 달은 아래 셋 중 하나로 판정된다.

  연차수당 O, 기본급 차감 X  ->  그 달 휴가 0일 (발생분을 현금으로 받음)
  연차수당 X, 기본급 차감 X  ->  발생분 1일을 그 달에 유급으로 사용
  연차수당 X, 기본급 차감 O  ->  발생분 1일 유급 사용 + 차감분만큼 무급 추가
"""
from model import DAY_PAY, HOURLY, DAILY_HOURS

ACCRUAL_PER_MONTH = 1  # 입사 1년 미만: 1개월 개근당 1일


def reconstruct(slips, first_accrual_month):
    """slips: verify() 통과한 명세서 리스트. first_accrual_month: 'YYYY-MM'"""
    rows = []
    for p in sorted(slips, key=lambda x: x["period"]):
        accrued = ACCRUAL_PER_MONTH if p["period"] >= first_accrual_month else 0
        cashed = p.get("leave_cashed") or 0
        ded_h = p.get("deducted_hours") or 0

        if cashed:
            paid_off = 0.0            # 현금으로 받았으니 그 달엔 안 쉼
        else:
            paid_off = float(accrued)  # 발생분을 유급으로 소진
        unpaid_off = ded_h / DAILY_HOURS
        rows.append({
            "period": p["period"],
            "accrued": accrued,
            "cashed": cashed,
            "paid_off": paid_off,
            "unpaid_off": unpaid_off,
            "total_off": paid_off + unpaid_off,
            "deducted_won": ded_h * HOURLY,
            "cashed_won": cashed * DAY_PAY,
        })
    return rows
