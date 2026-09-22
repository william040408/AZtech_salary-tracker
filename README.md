# 급여·연차 기록부

> Automated URL parsing and monitoring system for Korean payroll,
> pre-paid leave allowance, and tax tracking.

산업기능요원으로 근무하며 매달 받는 급여명세서를 자동으로 모으고,
회사 근무현황과 대조해 "이번 달 금액이 왜 이 값인지"를 설명하는 도구.

## 하는 일

1. **수집** — Gmail에 오는 이카운트 전자문서 알림에서 링크를 찾아, 실제 브라우저로 열어 명세서 표를 읽어온다.
2. **검산** — 지급·공제 합계, 고용보험 0.9%, 주민세 10%, 실지급액을 다시 계산해 맞는지 본다.
3. **대조** — 회사 근무현황 엑셀의 출퇴근 기록과 명세서의 기본급 차감을 맞춰본다.
4. **기록** — 쉰 날의 성격(연차·반차·무급·회사휴무·대체휴무)을 휴대폰에서 직접 분류해 남긴다.

## 준비

가상환경을 파서 이 프로젝트 안에만 패키지를 둔다.

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux 는 source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium      # 크롬 엔진, 계정당 한 번만 받으면 된다
```

`activate` 를 한 번 치면 그 터미널에서는 `python` 이 가상환경 것을 가리킨다.
새 터미널을 열 때마다 다시 쳐야 하고, 빠져나올 때는 `deactivate`.

설정 파일 두 개가 필요하다. 둘 다 커밋되지 않는다.

- `config.json` — 시급, 월 소정근로시간, 입사일 등 (`config.example.json` 복사)
- `.env` — Gmail 앱 비밀번호, Cloudflare Worker 주소와 암구호 (`.env.example` 복사)

## 실행

```bash
python src/fetch.py links      # Gmail 에서 명세서 메일의 링크 추출
python src/fetch_doc.py        # 링크를 브라우저로 열어 명세서 저장
python src/report.py           # 평소와 달라진 항목만 보고
python src/build_web.py        # 페이지 빌드 (두 벌)
python src/push_data.py        # Cloudflare 로 데이터 올리기
```

명세서 링크는 **3개월만 살아있다.** 매달 한 번은 돌려야 한다.

## 보는 방법

`src/build_web.py` 가 같은 템플릿에서 두 벌을 만든다.

| 파일 | 어디에 | 데이터 | 연차 기록 저장 |
| --- | --- | --- | --- |
| `web/index.html` | 클로드 아티팩트 | 페이지 안에 박힘 | 아티팩트 DB |
| `docs/index.html` | GitHub Pages | Worker 에서 받아옴 | Worker KV |

저장소가 서로 다르므로 한쪽에서 분류한 값은 다른 쪽에 보이지 않는다.
하나를 정해서 쓴다. Worker 설정은 `worker/README.md` 참고.

## 급여 구조

계약 조건은 `config.json` 에 둔다 (`config.example.json` 참고). 시급, 월 소정근로시간,
정액 수당, 입사일 같은 값이며 저장소에는 올라가지 않는다.

명세서에서 역산한 계산 구조는 이렇다.

- 만근 기본급 = 시급 x 월 소정근로시간
- 1일치 = 시급 x 1일 근로시간
- 연차를 그 달에 쓰지 않으면 `연차수당`으로 현금 지급되고, 쓰면 유급으로 쉰다
- 그보다 더 쉬면 초과분이 기본급에서 시간 단위로 차감된다

## 개인정보

급여 명세서, 근태 기록, 메일 링크, 빌드된 웹 페이지는 모두 커밋되지 않는다
(`.gitignore` 참고). 저장소에는 코드와 데이터 없는 템플릿만 올라간다.
