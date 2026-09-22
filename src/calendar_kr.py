# -*- coding: utf-8 -*-
"""2026년 한국 공휴일 및 근무일 계산."""
import calendar
from datetime import date, timedelta

HOLIDAYS_2026 = {
    date(2026, 1, 1): "신정",
    date(2026, 2, 16): "설날", date(2026, 2, 17): "설날", date(2026, 2, 18): "설날",
    date(2026, 3, 1): "삼일절", date(2026, 3, 2): "삼일절 대체",
    date(2026, 5, 1): "근로자의날", date(2026, 5, 5): "어린이날",
    date(2026, 5, 24): "부처님오신날", date(2026, 5, 25): "부처님오신날 대체",
    date(2026, 6, 6): "현충일",
    date(2026, 8, 15): "광복절", date(2026, 8, 17): "광복절 대체",
    date(2026, 9, 24): "추석", date(2026, 9, 25): "추석", date(2026, 9, 26): "추석",
    date(2026, 10, 3): "개천절", date(2026, 10, 5): "개천절 대체", date(2026, 10, 9): "한글날",
    date(2026, 12, 25): "성탄절",
}


def month_days(year, month):
    n = calendar.monthrange(year, month)[1]
    return [date(year, month, i + 1) for i in range(n)]


def weekday_holidays(year, month):
    """평일에 걸린 공휴일 목록 (실제로 쉬는 빨간날)."""
    return [d for d in month_days(year, month)
            if d.weekday() < 5 and d in HOLIDAYS_2026]


def workdays(year, month):
    """공휴일을 뺀 실제 근로일 수."""
    return sum(1 for d in month_days(year, month)
               if d.weekday() < 5 and d not in HOLIDAYS_2026)


def actual_pay_date(year, month):
    """급여월 기준 실제 입금일: 익월 10일, 주말/공휴일이면 그 다음 평일.
    명세서의 '지급일자'는 급여대장 확정일이라 신뢰하지 않는다."""
    y, m = (year + 1, 1) if month == 12 else (year, month + 1)
    d = date(y, m, 10)
    while d.weekday() >= 5 or d in HOLIDAYS_2026:
        d += timedelta(days=1)
    return d
