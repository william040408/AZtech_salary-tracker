# -*- coding: utf-8 -*-
"""법정 연차 발생/사용 원장. 회사 처리분과 대조한다.

근로기준법 제60조 제2항: 계속근로 1년 미만은 1개월 개근 시 1일 발생.
연차휴가를 사용한 날은 결근이 아니므로 개근 판정에 영향을 주지 않는다
(고용노동부 행정해석). 무급 결근은 그 달 개근을 깨뜨린다.
"""
from datetime import date
from dateutil.relativedelta import relativedelta


def accrual_schedule(hire, until, broken_months):
    """입사일 기준 매월 응당일에 1일씩 발생. broken_months에 든 발생일은 건너뛴다.
    broken_months: 개근이 깨진 구간 때문에 발생하지 않는 date 집합."""
    out, i = [], 1
    while True:
        d = hire + relativedelta(months=i)
        if d > until or i > 11:
            break
        out.append((d, 0 if d in broken_months else 1))
        i += 1
    return out
