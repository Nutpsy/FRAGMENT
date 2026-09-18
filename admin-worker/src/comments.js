// Private inbox: there is deliberately no anonymous read/list endpoint.
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

export function validateComment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail(400, "留言格式错误");
  if (!["home", "bside"].includes(input.channel)) fail(400, "留言栏目无效");
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 2000) fail(400, "留言须为 1–2000 字");
  if (input.nickname !== undefined && (typeof input.nickname !== "string" || input.nickname.length > 40)) fail(400, "称呼不能超过 40 字");
  if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) fail(400, "提交标识无效");
  if (typeof input.token !== "string" || !input.token || input.token.length > 2048) fail(400, "请完成防刷验证");
  return { channel: input.channel, nickname: input.nickname?.trim() || "匿名", message: input.message.trim(), requestId: input.requestId, token: input.token };
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) fail(415, "请使用 JSON 提交");
  if (Number(request.headers.get("Content-Length")) > 16000) fail(413, "请求过大");
  // Bound streamed bodies as well as Content-Length (untrusted clients may omit it).
  const reader = request.body?.getReader();
  if (!reader) fail(400, "请求为空");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16000) { await reader.cancel(); fail(413, "请求过大"); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); } catch { fail(400, "JSON 格式错误"); }
}

async function fingerprint(ip, date, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${date}:${ip}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function handleComments(request, env, { requireSession }) {
  const url = new URL(request.url);
  if (!env.COMMENTS_DB) fail(503, "留言服务尚未启用");

  if (url.pathname === "/api/comments/inbox" && request.method === "GET") {
    if (!env.SESSION_SECRET || !env.GITHUB_ALLOWED_USER_ID) fail(503, "留言管理尚未配置");
    await requireSession(request, env);
    const raw = url.searchParams.get("before");
    const before = raw === null ? Number.MAX_SAFE_INTEGER : Number(raw);
    if (!Number.isSafeInteger(before) || before < 1) fail(400, "分页标识无效");
    const { results } = await env.COMMENTS_DB.prepare(
      "SELECT seq, channel, nickname, message, created_at FROM comments WHERE seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT 51"
    ).bind(before).all();
    const items = results.slice(0, 50);
    return reply({ items, next: results.length > 50 ? items.at(-1).seq : null });
  }

  if (url.pathname === "/api/comments/remove" && request.method === "POST") {
    if (!env.SESSION_SECRET || !env.GITHUB_ALLOWED_USER_ID) fail(503, "留言管理尚未配置");
    await requireSession(request, env);
    if (request.headers.get("Origin") !== env.ADMIN_ORIGIN) fail(403, "请求来源不被允许");
    const input = await readJson(request);
    if (!Number.isSafeInteger(input?.seq) || input.seq < 1) fail(400, "留言编号无效");
    await env.COMMENTS_DB.prepare("UPDATE comments SET deleted_at = ? WHERE seq = ? AND deleted_at IS NULL").bind(new Date().toISOString(), input.seq).run();
    return reply({ ok: true });
  }

  if (url.pathname !== "/api/comments" || request.method !== "POST") return reply({ error: "Not found" }, 404);
  if (!env.ADMIN_ORIGIN || !env.TURNSTILE_SECRET || !env.COMMENTS_SECRET || env.COMMENTS_SECRET.length < 32) fail(503, "留言服务尚未启用");
  if (request.headers.get("Origin") !== env.ADMIN_ORIGIN) fail(403, "请求来源不被允许");
  const input = validateComment(await readJson(request));
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) fail(503, "无法验证请求来源");
  const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: input.token, remoteip: ip }),
    signal: AbortSignal.timeout(10000)
  });
  if (!verification.ok) fail(503, "验证服务暂不可用，请稍后重试");
  const check = await verification.json();
  if (!check.success || check.hostname !== new URL(env.ADMIN_ORIGIN).hostname || check.action !== "comments") fail(400, "防刷验证失效，请重新验证");

  // Same request ID retries are safe even after an uncertain network response.
  const existing = await env.COMMENTS_DB.prepare("SELECT channel, nickname, message FROM comments WHERE request_id = ?").bind(input.requestId).first();
  if (existing) {
    if (existing.channel !== input.channel || existing.nickname !== input.nickname || existing.message !== input.message) fail(409, "提交标识已使用，请刷新后重试");
    return reply({ ok: true });
  }
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const digest = await fingerprint(ip, day, env.COMMENTS_SECRET);
  const buckets = [`${digest}:day`, `${digest}:${Math.floor(now / 60000)}`];
  const limits = [20, 2];
  const counts = await env.COMMENTS_DB.batch(buckets.map((bucket, i) => env.COMMENTS_DB.prepare(
    "INSERT INTO comment_limits (bucket, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = MIN(hits + 1, ?) RETURNING hits"
  ).bind(bucket, now + 2 * 86400000, limits[i] + 1)));
  if (counts.some((result, i) => result.results[0].hits > limits[i])) fail(429, "留言太频繁，请稍后再试");
  // No raw IP, email, or user-agent is stored with the message.
  await env.COMMENTS_DB.prepare(
    "INSERT INTO comments (request_id, channel, nickname, message, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING"
  ).bind(input.requestId, input.channel, input.nickname, input.message, new Date(now).toISOString()).run();
  await env.COMMENTS_DB.prepare("DELETE FROM comment_limits WHERE expires_at < ?").bind(now).run();
  return reply({ ok: true }, 201);
}
