import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { validateComment } from "../src/comments.js";
import worker from "../src/index.js";

const schema = await readFile(new URL("../migrations/0001_comments.sql", import.meta.url), "utf8");
const origin = "https://nutpsy.github.io";
const message = () => ({ channel: "home", nickname: "访客", message: "你好，碎屑。", token: "verified-token", requestId: crypto.randomUUID() });

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let params = [];
      return {
        bind(...args) { params = args; return this; },
        async first() { return statement.get(...params) || null; },
        async all() { return { results: statement.all(...params) }; },
        async run() { return statement.run(...params); }
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const results = await Promise.all(statements.map(statement => statement.all())); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
}

async function withService(t, run) {
  const db = database();
  t.after(() => db.sqlite.close());
  const env = { COMMENTS_DB: db, ADMIN_ORIGIN: origin, TURNSTILE_SECRET: "test-secret", COMMENTS_SECRET: "x".repeat(32), SESSION_SECRET: "s".repeat(32), GITHUB_ALLOWED_USER_ID: "52111111" };
  let verifyResult = { success: true, hostname: "nutpsy.github.io", action: "comments" };
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    return Response.json(verifyResult);
  });
  const call = (path, body, extra = {}) => worker.fetch(new Request(`https://example.workers.dev${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  await run({ db, env, call, setVerification: value => { verifyResult = value; } });
}

async function adminToken(env, overrides = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: env.GITHUB_ALLOWED_USER_ID, login: "Nutpsy", exp: Math.floor(Date.now() / 1000) + 3600, ...overrides })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url");
  return `Bearer ${payload}.${signature}`;
}

test("validates channel, plain text, blank input and length limits", () => {
  assert.equal(validateComment({ ...message(), nickname: " " }).nickname, "匿名");
  for (const patch of [{ channel: "admin" }, { message: " " }, { message: "a".repeat(2001) }, { nickname: "a".repeat(41) }, { message: {} }, { token: "" }, { requestId: "x" }]) {
    assert.throws(() => validateComment({ ...message(), ...patch }), error => error.status === 400);
  }
});

test("accepts both channels without requiring unrelated GitHub publishing configuration", async t => withService(t, async ({ call, db }) => {
  assert.equal((await call("/api/comments", message())).status, 201);
  assert.equal((await call("/api/comments", { ...message(), channel: "bside" })).status, 201);
  const rows = db.sqlite.prepare("SELECT * FROM comments ORDER BY seq").all();
  assert.deepEqual(rows.map(row => row.channel), ["home", "bside"]);
  assert.equal(rows[0].message, "你好，碎屑。");
  assert.ok(!JSON.stringify(rows).includes("192.0.2.1"));
}));

test("does not expose anonymous reads or accept unauthenticated management writes", async t => withService(t, async ({ call }) => {
  assert.equal((await call("/api/comments")).status, 404);
  assert.equal((await call("/api/comments/inbox")).status, 401);
  assert.equal((await call("/api/comments/remove", { seq: 1 })).status, 401);
}));

test("validates origin and Turnstile success, hostname and action", async t => withService(t, async ({ call, db, setVerification }) => {
  assert.equal((await call("/api/comments", message(), { Origin: "https://evil.example" })).status, 403);
  for (const check of [
    { success: false, hostname: "nutpsy.github.io", action: "comments" },
    { success: true, hostname: "evil.example", action: "comments" },
    { success: true, hostname: "nutpsy.github.io", action: "login" }
  ]) {
    setVerification(check);
    assert.equal((await call("/api/comments", message())).status, 400);
  }
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 0);
}));

test("applies atomic rate limits and allows safe idempotent retries", async t => withService(t, async ({ call, db }) => {
  const input = message();
  assert.equal((await call("/api/comments", input)).status, 201);
  assert.equal((await call("/api/comments", input)).status, 200);
  assert.equal((await call("/api/comments", { ...input, message: "different" })).status, 409);
  assert.equal((await call("/api/comments", message())).status, 201);
  assert.equal((await call("/api/comments", message())).status, 429);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 2);
}));

test("daily limits apply across minute buckets and stale buckets are cleaned", async t => withService(t, async ({ call, db }) => {
  const realNow = Date.now();
  let time = Math.floor(realNow / 86400000) * 86400000 + 3600000;
  t.mock.method(Date, "now", () => time);
  db.sqlite.prepare("INSERT INTO comment_limits VALUES ('expired', 1, 0)").run();
  for (let n = 0; n < 20; n++) {
    assert.equal((await call("/api/comments", message())).status, 201);
    time += 61000;
  }
  assert.equal((await call("/api/comments", message())).status, 429);
  assert.equal(db.sqlite.prepare("SELECT * FROM comment_limits WHERE bucket='expired'").get(), undefined);
}));

test("administrator can paginate and soft-delete messages; other users cannot", async t => withService(t, async ({ call, db, env }) => {
  for (let n = 0; n < 52; n++) db.sqlite.prepare("INSERT INTO comments(request_id,channel,nickname,message,created_at) VALUES(?,?,?,?,?)").run(crypto.randomUUID(), "home", "访客", "正文", new Date().toISOString());
  const headers = { Authorization: await adminToken(env) };
  const response = await call("/api/comments/inbox", undefined, headers);
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.items.length, 50);
  const second = await (await call(`/api/comments/inbox?before=${first.next}`, undefined, headers)).json();
  assert.equal(second.items.length, 2);
  assert.equal(second.next, null);
  assert.equal((await call("/api/comments/remove", { seq: 52 }, headers)).status, 200);
  assert.ok(db.sqlite.prepare("SELECT deleted_at FROM comments WHERE seq=52").get().deleted_at);
  assert.equal((await (await call("/api/comments/inbox", undefined, headers)).json()).items[0].seq, 51);
  for (const token of ["Bearer fake", await adminToken(env, { sub: "other" }), await adminToken(env, { exp: 1 })]) {
    assert.equal((await call("/api/comments/inbox", undefined, { Authorization: token })).status, 401);
  }
}));

test("handles CORS preflight without secrets and bounds request bodies", async t => withService(t, async ({ env, call }) => {
  const preflight = await worker.fetch(new Request("https://example.workers.dev/api/comments", { method: "OPTIONS", headers: { Origin: origin } }), { ADMIN_ORIGIN: origin });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal((await call("/api/comments", message(), { "Content-Type": "text/plain" })).status, 415);
  const response = await worker.fetch(new Request("https://example.workers.dev/api/comments", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "x".repeat(17000) }), env);
  assert.equal(response.status, 413);
}));
