const GITHUB_API_VERSION = "2026-03-10";
const SESSION_SECONDS = 2 * 60 * 60;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      validateEnvironment(env);
      if (request.method === "OPTIONS") return cors(request, env, new Response(null, { status: 204 }));
      if (url.pathname === "/auth/login" && request.method === "GET") return beginLogin(url, env);
      if (url.pathname === "/auth/callback" && request.method === "GET") return finishLogin(request, url, env);
      if (url.pathname === "/api/session" && request.method === "GET") {
        const session = await requireSession(request, env);
        return apiJson(request, env, { user: { id: session.sub, login: session.login }, expiresAt: session.exp });
      }
      if (url.pathname === "/api/content" && request.method === "GET") {
        await requireSession(request, env);
        const file = await getRepositoryFile(env.CONTENT_PATH, env);
        const parsed = parseDataSource(file.text);
        return apiJson(request, env, parsed);
      }
      if (url.pathname === "/api/publish" && request.method === "POST") {
        const session = await requireSession(request, env);
        return publishContent(request, env, session);
      }
      if (url.pathname === "/api/upload" && request.method === "POST") {
        const session = await requireSession(request, env);
        return uploadImage(request, env, session);
      }
      if (url.pathname === "/health") return json({ ok: true });
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = Number(error.status) || 500;
      const message = status >= 500 ? "服务暂时不可用" : error.message;
      if (status >= 500) console.error(error);
      return cors(request, env, json({ error: message }, status));
    }
  }
};

function validateEnvironment(env) {
  const required = ["ADMIN_ORIGIN", "ADMIN_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GITHUB_CONTENT_TOKEN", "SESSION_SECRET", "GITHUB_ALLOWED_USER_ID", "GITHUB_OWNER", "GITHUB_REPO", "GITHUB_BRANCH", "CONTENT_PATH"];
  const missing = required.filter((key) => !env[key] || String(env[key]).startsWith("REPLACE_"));
  if (missing.length) throw httpError(503, `缺少 Worker 配置：${missing.join(", ")}`);
}

async function beginLogin(url, env) {
  const state = randomToken(24);
  const verifier = randomToken(32);
  const challenge = base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const redirectUri = `${url.origin}/auth/callback`;
  const target = new URL("https://github.com/login/oauth/authorize");
  target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("state", state);
  target.searchParams.set("code_challenge", challenge);
  target.searchParams.set("code_challenge_method", "S256");
  target.searchParams.set("allow_signup", "false");
  target.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": `fragment_oauth=${state}.${verifier}; Path=/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function finishLogin(request, url, env) {
  const cookie = readCookie(request.headers.get("Cookie"), "fragment_oauth");
  const [storedState, verifier] = cookie ? cookie.split(".") : [];
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!code || !state || !storedState || !verifier || !constantTimeEqual(state, storedState)) {
    return authRedirect(env, "error=登录状态已失效，请重试");
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "fragment-admin-worker" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
      code_verifier: verifier
    })
  });
  const tokenPayload = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenPayload.access_token) return authRedirect(env, "error=GitHub 登录失败");

  const userResponse = await fetch("https://api.github.com/user", {
    headers: githubHeaders(tokenPayload.access_token)
  });
  const user = await userResponse.json();
  if (!userResponse.ok || !user.id) return authRedirect(env, "error=无法读取 GitHub 身份");
  if (String(user.id) !== String(env.GITHUB_ALLOWED_USER_ID)) return authRedirect(env, "error=此账号没有管理权限");

  const session = await signSession({ sub: String(user.id), login: user.login, iat: nowSeconds(), exp: nowSeconds() + SESSION_SECONDS }, env.SESSION_SECRET);
  return authRedirect(env, `session=${encodeURIComponent(session)}`);
}

function authRedirect(env, fragment) {
  const target = new URL(env.ADMIN_URL);
  target.hash = fragment;
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": "fragment_oauth=; Path=/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function requireSession(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw httpError(401, "请先登录");
  const payload = await verifySession(authorization.slice(7), env.SESSION_SECRET);
  if (!payload || payload.exp < nowSeconds() || String(payload.sub) !== String(env.GITHUB_ALLOWED_USER_ID)) throw httpError(401, "登录已过期，请重新登录");
  return payload;
}

async function publishContent(request, env, session) {
  const raw = await readLimitedBody(request, MAX_JSON_BYTES);
  let input;
  try { input = JSON.parse(new TextDecoder().decode(raw)); } catch { throw httpError(400, "发布数据不是有效 JSON"); }
  const data = validateContent(input.data);
  const current = await getRepositoryFile(env.CONTENT_PATH, env);
  const version = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const source = generateDataSource(current.text, data, version);
  const message = cleanCommitMessage(input.message) || `content: publish from admin by ${session.login}`;
  const result = await putRepositoryFile(env.CONTENT_PATH, source, current.sha, message, env);
  return apiJson(request, env, { ok: true, version, commit: result.commit?.html_url || "" });
}

async function uploadImage(request, env, session) {
  const contentType = (request.headers.get("Content-Type") || "").split(";", 1)[0].toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  if (!extensions[contentType]) throw httpError(415, "仅支持 JPG、PNG、WebP 或 GIF");
  const bytes = await readLimitedBody(request, MAX_IMAGE_BYTES);
  if (!bytes.byteLength) throw httpError(400, "图片为空");
  const requested = decodeURIComponent(request.headers.get("X-Filename") || "image");
  const stem = requested.replace(/\.[^.]+$/, "").normalize("NFKC").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
  const date = new Date();
  const folder = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const path = `images/uploads/${folder}/${Date.now()}-${stem}.${extensions[contentType]}`;
  const result = await putRepositoryBytes(path, bytes, undefined, `media: upload ${stem} by ${session.login}`, env);
  return apiJson(request, env, { ok: true, path, commit: result.commit?.html_url || "" }, 201);
}

async function getRepositoryFile(path, env) {
  const response = await fetch(repositoryUrl(path, env, true), { headers: githubHeaders(env.GITHUB_CONTENT_TOKEN) });
  const payload = await response.json();
  if (!response.ok || payload.type !== "file" || !payload.content) throw httpError(response.status === 404 ? 404 : 502, "无法读取仓库内容");
  const bytes = base64ToBytes(payload.content.replace(/\s/g, ""));
  return { text: new TextDecoder().decode(bytes), sha: payload.sha };
}

async function putRepositoryFile(path, text, sha, message, env) {
  return putRepositoryBytes(path, new TextEncoder().encode(text), sha, message, env);
}

async function putRepositoryBytes(path, bytes, sha, message, env) {
  const body = { message, content: bytesToBase64(bytes), branch: env.GITHUB_BRANCH };
  if (sha) body.sha = sha;
  const response = await fetch(repositoryUrl(path, env, false), {
    method: "PUT",
    headers: { ...githubHeaders(env.GITHUB_CONTENT_TOKEN), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 409) throw httpError(409, "线上内容刚刚发生变化，请刷新后重试");
    throw httpError(502, "GitHub 发布失败");
  }
  return payload;
}

function repositoryUrl(path, env, includeRef) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${encodedPath}`;
  return includeRef ? `${base}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}` : base;
}

function githubHeaders(token) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": GITHUB_API_VERSION, "User-Agent": "fragment-admin-worker" };
}

export function parseDataSource(source) {
  const versionMatch = source.match(/const DATA_VERSION = ['\"]([^'\"]+)['\"];/);
  const startMarker = "const INITIAL_DATA = ";
  const endMarker = "const STORAGE_KEY";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw httpError(500, "data.js 结构不受支持");
  let objectSource = source.slice(start + startMarker.length, end).trim().replace(/;$/, "");
  let data;
  try {
    data = JSON.parse(objectSource);
  } catch {
    objectSource = objectSource
      .replace(/([,{]\s*)([A-Za-z_$][\w$]*):/g, '$1"$2":')
      .replace(/,(\s*[}\]])/g, "$1");
    try { data = JSON.parse(objectSource); } catch { throw httpError(500, "无法解析现有内容"); }
  }
  return { version: versionMatch?.[1] || "unknown", data: validateContent(data) };
}

export function generateDataSource(source, data, version) {
  const startMarker = "const INITIAL_DATA = ";
  const endMarker = "const STORAGE_KEY";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw httpError(500, "data.js 结构不受支持");
  const versionLine = `const DATA_VERSION = ${JSON.stringify(version)};`;
  const withVersion = source.replace(/const DATA_VERSION = [^;]+;/, versionLine);
  const adjustedStart = withVersion.indexOf(startMarker);
  const adjustedEnd = withVersion.indexOf(endMarker, adjustedStart);
  return `${withVersion.slice(0, adjustedStart)}${startMarker}${JSON.stringify(validateContent(data), null, 2)};\n\n${withVersion.slice(adjustedEnd)}`;
}

export function validateContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(400, "内容数据格式错误");
  const result = {
    scintilla: cleanItems(value.scintilla, (item) => ({ id: text(item.id, 200, true), date: text(item.date, 40, true), time: text(item.time, 40), content: text(item.content, 100000, true), moodTag: text(item.moodTag, 100) })),
    inlandEmpire: cleanItems(value.inlandEmpire, (item) => ({ id: text(item.id, 200, true), date: text(item.date, 40, true), time: text(item.time, 40), src: text(item.src, 1000, true), alt: text(item.alt, 500), category: text(item.category, 100), caption: text(item.caption, 1000) })),
    gravityRainbow: cleanItems(value.gravityRainbow, (item) => ({ id: text(item.id, 200, true), date: text(item.date, 40, true), time: text(item.time, 40), title: text(item.title, 500, true), mdFile: text(item.mdFile, 1000), mdContent: text(item.mdContent, 200000), tags: Array.isArray(item.tags) ? item.tags.slice(0, 30).map((tag) => text(tag, 100, true)) : [] })),
    bSide: cleanItems(value.bSide, (item) => ({ id: text(item.id, 200, true), date: text(item.date, 40, true), time: text(item.time, 40), content: text(item.content, 100000, true) })),
    manifesto: { text: text(value.manifesto?.text, 10000), bgStyle: text(value.manifesto?.bgStyle, 100) }
  };
  for (const category of ["scintilla", "inlandEmpire", "gravityRainbow", "bSide"]) {
    const seen = new Set();
    result[category].forEach((item) => {
      if (seen.has(item.id)) throw httpError(400, `${category} 中存在重复 ID`);
      seen.add(item.id);
    });
  }
  return result;
}

function cleanItems(value, mapper) {
  if (!Array.isArray(value) || value.length > 5000) throw httpError(400, "栏目数据格式错误或数量过多");
  return value.map((item) => mapper(item || {}));
}

function text(value, max, required = false) {
  const output = value == null ? "" : String(value).trim();
  if (required && !output) throw httpError(400, "存在必填内容为空");
  if (output.length > max) throw httpError(400, "内容超过允许长度");
  return output;
}

function cleanCommitMessage(value) {
  return text(value, 180).replace(/[\r\n]+/g, " ");
}

async function readLimitedBody(request, limit) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > limit) throw httpError(413, "上传内容过大");
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) throw httpError(413, "上传内容过大");
  return bytes;
}

async function signSession(payload, secret) {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(encoded, secret);
  return `${encoded}.${signature}`;
}

async function verifySession(token, secret) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await hmac(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;
  try { return JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))); } catch { return null; }
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function randomToken(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readCookie(header, name) {
  const entry = (header || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? entry.slice(name.length + 1) : "";
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function apiJson(request, env, payload, status = 200) {
  return cors(request, env, json(payload, status));
}

function cors(request, env, response) {
  const origin = request.headers.get("Origin");
  const headers = new Headers(response.headers);
  if (origin === env.ADMIN_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Filename");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Vary", "Origin");
  }
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
