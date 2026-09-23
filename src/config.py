# -*- coding: utf-8 -*-
"""개인별 설정. config.json 은 커밋하지 않는다 (config.example.json 참고)."""
import json, sys
from pathlib import Path

_p = Path("config.json")
if not _p.exists():
    sys.exit("[!] config.json 이 없습니다. config.example.json 을 복사해 값을 채우세요.")
CFG = json.loads(_p.read_text(encoding="utf-8"))

PERSON = CFG["person"]
HOURLY = CFG["hourly"]
MONTHLY_HOURS = CFG["monthlyHours"]
DAILY_HOURS = CFG["dailyHours"]
FULL_BASE = HOURLY * MONTHLY_HOURS
DAY_PAY = HOURLY * DAILY_HOURS
FIXED_ALLOWANCES = CFG["fixedAllowances"]
EI_RATE = CFG["employmentInsuranceRate"]
WORKBOOK = CFG.get("workbook")   # None 이면 엑셀을 읽지 않는다
