# -*- coding: utf-8 -*-
"""'평소와 다른 점'만 집어내는 리포트.

회사의 연차 운영 방식은 법정 기준과 다를 수 있고 본인도 그 부분은 문제삼지
않는다. 그래서 법정 계산과 대조하지 않고, 명세서끼리 비교해서 달라진 값과
설명되지 않는 금액만 보고한다.
"""
import sys, io
from collections import Counter
sys.path.insert(0, "src")
from model import FULL_BASE, DAY_PAY, HOURLY, DAILY_HOURS

# 매달 같아야 하는 항목
STABLE_EARN = ["직무수당", "개근수당"]
STABLE_DEDUCT = ["소득세", "주민세", "국민연금", "건강보험", "장기요양"]


def baseline(slips, key, bucket):
    """가장 자주 나온 값을 평소값으로 본다. 명세서가 없으면 0."""
    vals = [p[bucket].get(key, 0) for p in slips]
    if not vals:
        return 0
    return Counter(vals).most_common(1)[0][0]


def report(slips):
    slips = sorted(slips, key=lambda p: p["period"])
    base = {k: baseline(slips, k, "earnings") for k in STABLE_EARN}
    base |= {k: baseline(slips, k, "deductions") for k in STABLE_DEDUCT}

    # 만근·수당 없는 달의 기준 실수령
    ref_gross = FULL_BASE + base["직무수당"] + base["개근수당"]
    ref_ded = sum(base[k] for k in STABLE_DEDUCT) + int(ref_gross * 0.009) // 10 * 10
    ref_net = ref_gross - ref_ded

    out = []
    for p in slips:
        e, d = p["earnings"], p["deductions"]
        flags = []

        for k in STABLE_EARN:
            if e.get(k, 0) != base[k]:
                flags.append(f"{k} {e.get(k,0):,} (평소 {base[k]:,})")
        for k in STABLE_DEDUCT:
            if d.get(k, 0) != base[k]:
                flags.append(f"{k} {d.get(k,0):,} (평소 {base[k]:,})")

        ded_h = p.get("deducted_hours") or 0
        cash = p.get("leave_cashed") or 0
        parts = []
        if cash:
            parts.append(f"연차수당 +{cash*DAY_PAY:,} ({cash}일분)")
        if ded_h:
            half = "" if ded_h % DAILY_HOURS == 0 else f", 반차 포함 가능"
            parts.append(f"기본급 -{ded_h*HOURLY:,} ({ded_h}시간{half})")

        out.append({
            "period": p["period"],
            "net": p["computed_net"],
            "delta": p["computed_net"] - ref_net,
            "parts": parts,
            "flags": flags,
        })
    return ref_net, out
