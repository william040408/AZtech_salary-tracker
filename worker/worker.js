/**
 * 급여·연차 기록부 저장소 (Cloudflare Worker + KV)
 *
 * 브라우저에서 쓰는 개인 저장소. 급여 데이터와 연차 분류를 KV 에 담아두고
 * 암구호(PASSPHRASE)를 아는 요청만 받는다.
 *
 *   GET  /bundle    급여·근태 데이터 읽기
 *   PUT  /bundle    급여·근태 데이터 덮어쓰기 (수집 작업이 올림)
 *   GET  /config    계약 조건 (시급, 소정근로시간 등) 읽기
 *   PUT  /config    계약 조건 덮어쓰기 — 노트북에서만 올린다
 *   GET  /leave     연차 분류 읽기
 *   PUT  /leave     연차 분류 덮어쓰기
 *   GET  /meta      마지막 갱신 시각 (가벼움 — 진행 확인용)
 *   POST /refresh   GitHub Actions 의 수집 작업을 깨움
 *
 * 필요한 설정:
 *   - KV 네임스페이스를 변수명 KV 로 바인딩
 *   - 시크릿 PASSPHRASE   페이지와 수집 작업이 쓰는 암구호
 *   - 시크릿 GH_TOKEN     Actions 를 깨울 GitHub 토큰 (Actions: Read and write)
 *   - 변수 ALLOW_ORIGIN, GH_REPO, GH_WORKFLOW 는 wrangler.jsonc 에 있다
 */

const KEYS = { bundle: "bundle", leave: "leave", config: "config" };
const META = "meta";
const MAX_BYTES = 2_000_000;

function headers(env, extra) {
  return {
    "access-control-allow-origin": env.ALLOW_ORIGIN || "*",
    "access-control-allow-headers": "content-type,x-pass",
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    ...extra,
  };
}

const json = (env, body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: headers(env, { "content-type": "application/json; charset=utf-8" }) });

/** GitHub Actions 의 workflow_dispatch 를 호출한다. */
async function wake(env) {
  if (!env.GH_TOKEN) return { ok: false, status: 500, error: "GH_TOKEN 시크릿이 없습니다" };
  if (!env.GH_REPO)  return { ok: false, status: 500, error: "GH_REPO 설정이 없습니다" };

  const wf = env.GH_WORKFLOW || "refresh.yml";
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${wf}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "salary-api",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });

  if (r.status === 204) return { ok: true };
  const text = await r.text();
  const hint = r.status === 401 || r.status === 403
    ? "토큰이 만료됐거나 Actions 권한이 없습니다"
    : r.status === 404
      ? "저장소나 워크플로 파일을 찾지 못했습니다"
      : "GitHub 이 거절했습니다";
  return { ok: false, status: 502, error: `${hint} (HTTP ${r.status}) ${text.slice(0, 200)}` };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers(env) });

    if (!env.PASSPHRASE) return json(env, { error: "PASSPHRASE 시크릿이 설정되지 않았습니다" }, 500);
    if (request.headers.get("x-pass") !== env.PASSPHRASE)
      return json(env, { error: "암구호가 맞지 않습니다" }, 401);

    const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");

    if (name === "meta") {
      if (request.method !== "GET") return json(env, { error: "허용되지 않는 메서드" }, 405);
      return json(env, (await env.KV.get(META)) ?? JSON.stringify({ updatedAt: null }));
    }

    if (name === "refresh") {
      if (request.method !== "POST") return json(env, { error: "허용되지 않는 메서드" }, 405);
      const out = await wake(env);
      return out.ok
        ? json(env, { ok: true, startedAt: new Date().toISOString() })
        : json(env, { error: out.error }, out.status);
    }

    const key = KEYS[name];
    if (!key) return json(env, { error: "없는 경로: " + name }, 404);

    if (request.method === "GET") {
      const v = await env.KV.get(key);
      return v === null ? json(env, {}, 200) : json(env, v);
    }

    if (request.method === "PUT") {
      const body = await request.text();
      if (body.length > MAX_BYTES) return json(env, { error: "내용이 너무 큽니다" }, 413);
      try { JSON.parse(body); } catch { return json(env, { error: "JSON 형식이 아닙니다" }, 400); }
      await env.KV.put(key, body);
      if (key === KEYS.bundle) {
        await env.KV.put(META, JSON.stringify({ updatedAt: new Date().toISOString(), bytes: body.length }));
      }
      return json(env, { ok: true, bytes: body.length });
    }

    return json(env, { error: "허용되지 않는 메서드" }, 405);
  },
};
