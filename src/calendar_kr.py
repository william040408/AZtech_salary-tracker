# -*- coding: utf-8 -*-
"""한국 공휴일 및 근무일 계산. 공휴일 원본은 holidayskr 패키지."""
import calendar
from datetime import date, timedelta
from functools import lru_cache

import holidayskr

# holidayskr가 공휴일로 넣지만 실제 여부가 불확실한 날. 검증되면 비운다.
# 2026-07-17 제헌절: 본인이 그날 쉬었고 기본급 차감도 없어 유급휴일로 확인됨.
SUSPECT = {}


@lru_cache(maxsize=None)
def holidays(year):
    """{date: 이름}. 토·일에 겹치는 날도 그대로 포함한다."""
    return dict(holidayskr.year_holidays(str(year)))


def month_days(year, month):
    n = calendar.monthrange(year, month)[1]
    return [date(year, month, i + 1) for i in range(n)]


def weekday_holidays(year, month):
    """평일에 걸린 공휴일 — 실제로 쉬게 되는 빨간날."""
    h = holidays(year)
    return [d for d in month_days(year, month) if d.weekday() < 5 and d in h]


def workdays(year, month):
    """공휴일을 뺀 실제 근로일 수."""
    h = holidays(year)
    return sum(1 for d in month_days(year, month)
               if d.weekday() < 5 and d not in h)


def actual_pay_date(year, month):
    """급여월 기준 실제 입금일: 익월 10일, 주말·공휴일이면 다음 평일.
    명세서의 '지급일자'는 급여대장 확정일이라 실제 입금일과 다르다."""
    y, m = (year + 1, 1) if month == 12 else (year, month + 1)
    d = date(y, m, 10)
    h = holidays(y)
    while d.weekday() >= 5 or d in h:
        d += timedelta(days=1)
        h = holidays(d.year)
    return d
