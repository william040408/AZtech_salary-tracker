# -*- coding: utf-8 -*-
"""웹 페이지에 심을 데이터 묶음을 만든다."""
import sys, io, json
from datetime import date
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")
from parse import load_dir
from model import verify, HOURLY, DAY_PAY, FULL_BASE, DAILY_HOURS
from reconcile import read_all, WORKBOOK
from attendance import worked_hours
from calendar_kr import holidays, actual_pay_date

from config import PERSON as ME, CFG
FIRST = date.fromisoformat(CFG["hireDate"])
LAST = date.today()   # 미래 날짜는 엑셀이 비어 있을 뿐이므로 제외

SERVICE_END = date.fromisoformat(CFG["serviceEnd"])

slips = [verify(p) for p in load_dir("data/raw")]
H = holidays(2026)

# 달력은 복무 기간 전체를 그린다. 앞으로의 근태는 엑셀이 아니라 웹에서 직접 찍는다.
HOLIDAYS_ALL = {}
for y in range(FIRST.year, SERVICE_END.year + 1):
    for k, v in holidays(y).items():
        HOLIDAYS_ALL[str(k)] = v

# 근무현황 엑셀은 회사 파일이라 이 저장소에도, GitHub 의 실행 환경에도 없다.
# 없으면 근태를 비워 두고, push_data.py 가 이미 올라가 있던 근태를 그대로 살린다.
if not WORKBOOK:
    days = None
    print("  [i] 근무현황 파일을 쓰지 않습니다 — 근태는 금고에 있는 것을 그대로 둡니다")
else:
    try:
        days = read_all(WORKBOOK)
    except (FileNotFoundError, OSError) as e:
        days = None
        print(f"  [i] 근무현황 파일을 못 읽어 근태는 비워 둡니다 ({type(e).__name__})")

pay = []
for p in sorted(slips, key=lambda x: x["period"]):
    pay.append({
        "period": p["period"],
        "payDate": str(actual_pay_date(p["year"], p["month"])),
        "earnings": p["earnings"],
        "deductions": p["deductions"],
        "gross": p["totals"]["지급총액"],
        "net": p["computed_net"],
        "deductedHours": p.get("deducted_hours") or 0,
        "leaveCashed": p.get("leave_cashed") or 0,
    })

SNAPSHOT = Path("data/attendance.json")   # 엑셀에서 한 번 수입한 기록

att = []
for d in sorted(days or {}):
    if d < FIRST or d > LAST:
        continue
    roster = days[d]
    if ME not in roster:
        continue
    row = roster[ME]
    anyone = any(v["worked"] for v in roster.values())
    hol = H.get(d)
    if row["worked"]:
        h = worked_hours(row)
        kind = "half" if h <= 4.6 else ("short" if h < 8 - 0.01 else "work")
    else:
        if d.weekday() >= 5:
            kind = "weekend"
        elif hol:
            kind = "holiday"
        else:
            kind = "company_off" if not anyone else "personal_off"
        h = 0.0
    att.append({
        "date": str(d),
        "kind": kind,
        "hours": h,
        "start": row["start"].strftime("%H:%M") if row["start"] else None,
        "end": row["end"].strftime("%H:%M") if row["end"] else None,
        "holiday": hol,
    })

if days:
    SNAPSHOT.write_text(json.dumps(att, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
elif SNAPSHOT.exists():
    att = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    print(f"  근태 {len(att)}일은 저장해 둔 기록을 씁니다")

bundle = {
    "person": ME,
    "hourly": HOURLY,
    "dayPay": DAY_PAY,
    "fullBase": FULL_BASE,
    "dailyHours": DAILY_HOURS,
    "hireDate": CFG["hireDate"],
    "serviceStart": CFG["serviceStart"],
    "serviceEnd": CFG["serviceEnd"],
    "company": CFG["company"], "team": CFG["team"],
    "firstDay": str(FIRST),
    "payslips": pay,
    "attendance": att,
    "attendanceFrom": "workbook" if days else ("snapshot" if att else None),
    "calendarFrom": CFG["hireDate"][:7],
    "calendarTo": SERVICE_END.strftime("%Y-%m"),
    "holidays": HOLIDAYS_ALL,
}
out = Path("web/data.json")
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{out}  {out.stat().st_size:,}바이트")
print(f"  명세서 {len(pay)}장, 근태 {len(att)}일, 공휴일 {len(bundle['holidays'])}일")
from collections import Counter
print("  근태 분류:", dict(Counter(a["kind"] for a in att)))
