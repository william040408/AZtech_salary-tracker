# -*- coding: utf-8 -*-
"""급여 검산 + 연차 계산 모델."""
from datetime import date
from dateutil.relativedelta import relativedelta  # noqa

# --- 회사/계약 전제 (명세서에서 역산해 확정한 값) ---
HOURLY = 10_000          # 2026년 최저시급 = 적용 시급
MONTHLY_HOURS = 209      # 주40h + 주휴 기준 월 소정근로시간
DAILY_HOURS = 8
FULL_BASE = HOURLY * MONTHLY_HOURS      # 만근 시 기본급 X,XXX,XXX
DAY_PAY = HOURLY * DAILY_HOURS          # 1일 통상임금 XX,XXX

FIXED_ALLOWANCES = {"직무수당": 90_000, "개근수당": 50_000}

EI_RATE = 0.009          # 고용보험 근로자 부담률
HIRE_DATE = date(2026, 3, 2)


def _round10_down(x):
    return int(x) // 10 * 10


def verify(ps):
    """명세서 한 장의 산술 검증. 발견된 이상을 리스트로 반환."""
    issues, notes = [], []
    e, d, t = ps["earnings"], ps["deductions"], ps["totals"]

    # 1) 기본급 -> 차감 시간 역산. 반차(4h) 사용이 있으므로 '일' 단위로 가정하지 않는다.
    base = e.get("기본급", 0)
    shortfall = FULL_BASE - base
    if shortfall % HOURLY == 0:
        ps["deducted_hours"] = shortfall // HOURLY
    else:
        ps["deducted_hours"] = None
        issues.append(
            f"기본급 {base:,}원이 시급({HOURLY:,}원) 단위로 안 떨어짐 "
            f"(만근 {FULL_BASE:,} 대비 {shortfall:,} 차이)"
        )
    h = ps["deducted_hours"]
    if h is not None and h % 4 != 0:
        issues.append(f"차감 {h}시간 — 연차(8h)·반차(4h) 어느 배수도 아님")
    ps["leave_used"] = h / DAILY_HOURS if h is not None else None

    # 2) 연차수당 -> 현금 지급받은 연차일수
    ann = e.get("연차수당", 0)
    ps["leave_cashed"] = ann // DAY_PAY if ann % DAY_PAY == 0 else None
    if ann and ps["leave_cashed"] is None:
        issues.append(f"연차수당 {ann:,}원이 1일치({DAY_PAY:,}원)의 배수가 아님")

    # 3) 고정수당
    for k, v in FIXED_ALLOWANCES.items():
        got = e.get(k)
        if got is None:
            issues.append(f"{k} 항목이 없음 (평소 {v:,}원)")
        elif got != v:
            issues.append(f"{k} {got:,}원 — 평소 {v:,}원과 다름")

    # 4) 지급총액 = 항목 합계
    gross = t["지급총액"]

    # 5) 공제 검산
    ded_sum = sum(d.values())
    if t.get("공제총액") is not None and ded_sum != t["공제총액"]:
        issues.append(f"공제 항목 합 {ded_sum:,} != 공제총액 {t['공제총액']:,}")

    exp_ei = _round10_down(gross * EI_RATE)
    if abs(d.get("고용보험", 0) - exp_ei) > 10:
        issues.append(f"고용보험 {d.get('고용보험',0):,} — 지급총액의 0.9%는 {exp_ei:,}")

    exp_local = _round10_down(d.get("소득세", 0) * 0.1)
    if abs(d.get("주민세", 0) - exp_local) > 10:
        issues.append(f"주민세 {d.get('주민세',0):,} — 소득세의 10%는 {exp_local:,}")

    # 6) 실지급액
    net = gross - ded_sum
    ps["computed_net"] = net
    if t.get("실지급액") is not None and t["실지급액"] != net:
        issues.append(f"실지급액 {t['실지급액']:,} != 지급총액-공제 {net:,}")
    elif t.get("실지급액") is None:
        notes.append(f"명세서에 실지급액 표기 없음 — 계산값 {net:,}원")

    ps["issues"], ps["notes"] = issues, notes
    return ps


def accrued_leave(hire, asof):
    """근로기준법 연차 발생. 1년 미만은 1개월 개근당 1일(최대 11일),
    1년 시점에 15일 일괄 발생."""
    if asof < hire:
        return 0
    months = (asof.year - hire.year) * 12 + (asof.month - hire.month)
    if asof.day < hire.day:
        months -= 1
    if months < 12:
        return max(0, min(11, months))
    years = months // 12
    extra = min(11, 11)  # 1년차에 쌓인 월차 11일은 별도 유지
    annual = 15 + max(0, (years - 1) // 2)  # 3년차부터 2년마다 +1
    return extra + annual
