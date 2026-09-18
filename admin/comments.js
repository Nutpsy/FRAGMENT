(() => {
  "use strict";
  const status = document.getElementById("status");
  const list = document.getElementById("messages");
  const more = document.getElementById("more");
  const reload = document.getElementById("reload");
  let apiBase, token, next = null, busy = false;
  try {
    const url = new URL(window.FRAGMENT_ADMIN_CONFIG?.apiBase || localStorage.getItem("fragment_admin_api"));
    if (url.protocol !== "https:") throw new Error();
    apiBase = url.origin;
    token = sessionStorage.getItem("fragment_admin_session");
    if (!token) throw new Error();
  } catch {
    status.textContent = "请先返回管理页，连接服务并使用 GitHub 登录。";
    reload.disabled = true;
    return;
  }
  async function api(path, body) {
    const response = await fetch(`${apiBase}${path}`, {
      method: body ? "POST" : "GET", credentials: "omit", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (response.status === 401) throw new Error("登录已过期，请返回管理页重新登录。");
    if (!response.ok) throw new Error(data.error || "读取失败");
    return data;
  }
  function render(item) {
    const row = document.createElement("article");
    const heading = document.createElement("header");
    heading.textContent = `${item.channel === "bside" ? "B-SIDE" : "首页"} · ${item.nickname} · ${new Date(item.created_at).toLocaleString("zh-CN")}`;
    const text = document.createElement("p");
    text.textContent = item.message;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", async () => {
      if (!window.confirm("从收件箱移除这条留言？误操作可从数据库恢复。")) return;
      remove.disabled = true;
      try { await api("/api/comments/remove", { seq: item.seq }); row.remove(); status.textContent = "已移除。"; }
      catch (error) { status.textContent = error.message; remove.disabled = false; }
    });
    row.append(heading, text, remove);
    return row;
  }
  async function load(reset) {
    if (busy) return;
    busy = true;
    more.disabled = reload.disabled = true;
    status.textContent = "正在读取…";
    try {
      const data = await api(`/api/comments/inbox${!reset && next ? `?before=${next}` : ""}`);
      if (reset) list.replaceChildren();
      for (const item of data.items) list.append(render(item));
      next = data.next;
      more.hidden = !next;
      status.textContent = list.children.length ? "" : "暂无留言。";
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; more.disabled = reload.disabled = false; }
  }
  reload.addEventListener("click", () => load(true));
  more.addEventListener("click", () => load(false));
  load(true);
})();
