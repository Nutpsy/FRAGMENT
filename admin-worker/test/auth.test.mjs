import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {
  ADMIN_ORIGIN: "https://nutpsy.github.io", ADMIN_URL: "https://nutpsy.github.io/FRAGMENT/admin/",
  GITHUB_CLIENT_ID: "test-client", GITHUB_CLIENT_SECRET: "test-secret",
  SESSION_SECRET: "s".repeat(64), GITHUB_ALLOWED_USER_ID: "52111111"
};
async function loginStart() {
  const response = await worker.fetch(new Request("https://example.workers.dev/auth/login"), env);
  assert.equal(response.status, 302);
  const destination = new URL(response.headers.get("Location"));
  assert.equal(destination.hostname, "github.com");
  assert.equal(destination.searchParams.get("code_challenge_method"), "S256");
  return { state: destination.searchParams.get("state"), cookie: response.headers.get("Set-Cookie").split(";")[0] };
}
test("GitHub OAuth creates an owner session without needing a repository write token", async t => {
  const flow = await loginStart();
  t.mock.method(globalThis, "fetch", async url => {
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "fake-test-token" });
    assert.equal(url, "https://api.github.com/user");
    return Response.json({ id: 52111111, login: "Nutpsy" });
  });
  const response = await worker.fetch(new Request(`https://example.workers.dev/auth/callback?code=test&state=${flow.state}`, { headers: { Cookie: flow.cookie } }), env);
  assert.equal(response.status, 302);
  const destination = new URL(response.headers.get("Location"));
  const token = new URLSearchParams(destination.hash.slice(1)).get("session");
  assert.ok(token);
  const session = await worker.fetch(new Request("https://example.workers.dev/api/session", { headers: { Authorization: `Bearer ${token}` } }), env);
  assert.equal(session.status, 200);
  const payload = await session.json();
  assert.equal(payload.user.login, "Nutpsy");
  assert.equal(payload.publishingEnabled, false);
});
test("OAuth refuses mismatched state and non-owner identities", async t => {
  const flow = await loginStart();
  t.mock.method(globalThis, "fetch", async url => url.includes("access_token") ? Response.json({ access_token: "fake" }) : Response.json({ id: 123, login: "someone-else" }));
  for (const state of ["wrong", flow.state]) {
    const response = await worker.fetch(new Request(`https://example.workers.dev/auth/callback?code=test&state=${state}`, { headers: { Cookie: flow.cookie } }), env);
    const fragment = new URL(response.headers.get("Location")).hash;
    assert.ok(new URLSearchParams(fragment.slice(1)).has("error"));
    assert.ok(!new URLSearchParams(fragment.slice(1)).has("session"));
  }
});
