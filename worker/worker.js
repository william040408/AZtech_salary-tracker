/**
 * 급여·연차 기록부 저장소 (Cloudflare Worker + KV)
 *
 * 브라우저에서 쓰는 개인 저장소. 급여 데이터와 연차 분류를 KV에 담아두고
 * 암구호(PASSPHRASE)를 아는 요청만 받는다.
 *
 *   GET  /bundle   급여·근태 데이터 읽기
 *   PUT  /bundle   급여·근태 데이터 덮어쓰기 (로컬 스크립트가 올림)
 *   GET  /leave    연차 분류 읽기
 *   PUT  /leave    연차 분류 덮어쓰기
 *
 * 필요한 설정 (Cloudflare 대시보드에서):
 *   - KV 네임스페이스를 변수명 KV 로 바인딩
 *   - 시크릿 PASSPHRASE
 *   - 변수 ALLOW_ORIGIN (예: https://아이디.github.io)
 */

const KEYS = { bundle: "bundle", leave: "leave" };
const MAX_BYTES = 2_000_000;

function headers(env, extra) {
  return {
    "access-control-allow-origin": env.ALLOW_ORIGIN || "*",
    "access-control-allow-headers": "content-type,x-pass",
    "access-control-allow-methods": "GET,PUT,OPTIONS",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    ...extra,
  };
}

const json = (env, body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body),
    { status, headers: headers(env, { "content-type": "application/json; charset=utf-8" }) });

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: headers(env) });

    if (!env.PASSPHRASE) return json(env, { error: "PASSPHRASE 시크릿이 설정되지 않았습니다" }, 500);
    if (request.headers.get("x-pass") !== env.PASSPHRASE)
      return json(env, { error: "암구호가 맞지 않습니다" }, 401);

    const name = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "");
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
      return json(env, { ok: true, bytes: body.length });
    }

    return json(env, { error: "허용되지 않는 메서드" }, 405);
  },
};
