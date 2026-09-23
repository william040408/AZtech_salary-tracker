# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, "src")
from parse import load_dir
from model import verify, DAY_PAY, HOURLY, DAILY_HOURS
from anomaly import report

slips = [verify(p) for p in load_dir("data/raw")]

# 수집 작업은 금고에 없는 달만 받아온다. 새 명세서가 없으면 여기는 빈 상태가
# 되는데, 그건 실패가 아니라 "받을 게 없었다"는 뜻이다.
if not slips:
    print("이번에 새로 받은 명세서가 없습니다. 검산할 것이 없어 넘어갑니다.")
    raise SystemExit(0)

ref, rows = report(slips)

print(f"■ 기준: 만근·연차수당 없는 달의 실수령 = {ref:,}원\n")
print(f"{'급여월':<9}{'실수령':>11}{'기준대비':>11}   변동 사유")
print("-" * 82)
for r in rows:
    why = " / ".join(r["parts"]) or "없음 (기준과 동일)"
    print(f"{r['period']:<9}{r['net']:>11,}{r['delta']:>+11,}   {why}")
print("-" * 82)

print("\n■ 설명되지 않는 금액")
bad = False
for r in rows:
    exp = sum(int(x.split("+")[1].split(" ")[0].replace(",", "")) if "+" in x
              else -int(x.split("-")[1].split(" ")[0].replace(",", "")) for x in r["parts"])
    # 공제는 고정이므로 지급 변동분의 99.1%만 실수령에 반영됨
    resid = r["delta"] - (exp - int(abs(exp) * 0.009) // 10 * 10 * (1 if exp > 0 else -1))
    if abs(resid) > 200:
        print(f"  [!] {r['period']}  잔차 {resid:+,}원"); bad = True
if not bad:
    print("  없음 — 모든 달의 실수령 변동이 연차수당·기본급 차감으로 전부 설명됨")

print("\n■ 평소와 달라진 항목")
any_flag = False
for r in rows:
    for f in r["flags"]:
        print(f"  [!] {r['period']}  {f}"); any_flag = True
if not any_flag:
    print("  없음 — 직무수당·개근수당·소득세·4대보험 전부 6개월 내내 동일")

print("\n■ 명세서에 없어서 확인 불가능한 것")
print("  · 그 달에 며칠/몇 시간 쉬었는지")
print("  · 연차 발생·사용·잔여 일수")
print("  · 기본급 차감분이 무급휴가인지 결근인지 지각인지")
print("  → 명세서에 근태 정보가 전혀 없어 금액 외에는 검증할 수단이 없음")
