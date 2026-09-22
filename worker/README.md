# Cloudflare Worker 설정

노트북에 아무것도 설치하지 않고 **브라우저만으로** 끝난다.

## 1. KV 만들기
[dash.cloudflare.com](https://dash.cloudflare.com) → 좌측 **Storage & Databases → KV** → **Create**
이름은 `salary` 정도. 만들고 나면 끝.

## 2. Worker 만들기
좌측 **Compute (Workers)** → **Create** → **Start from Hello World** → 이름 입력 → **Deploy**
배포되면 **Edit code** 를 눌러 편집기를 열고, 안에 있는 내용을 전부 지운 뒤
이 폴더의 `worker.js` 를 통째로 붙여넣고 **Deploy**.

## 3. 바인딩과 시크릿
Worker 화면 → **Settings**

| 위치 | 이름 | 값 |
| --- | --- | --- |
| Bindings → KV namespace | `KV` | 1번에서 만든 네임스페이스 |
| Variables and Secrets → Secret | `PASSPHRASE` | 길게 지은 암구호 (20자 이상) |
| Variables and Secrets → Text | `ALLOW_ORIGIN` | `https://<깃허브아이디>.github.io` |

암구호는 이 저장소의 열쇠다. 짧으면 안 된다.

## 4. 주소 확인
Worker 화면 위쪽의 `https://<이름>.<계정>.workers.dev` 가 API 주소다.
페이지 설정에 이 주소와 암구호를 넣으면 연결된다.
