(() => {
  "use strict";
  const config = window.FRAGMENT_COMMENTS_CONFIG || {};
  if (config.enabled === false) return;
  let apiBase;
  try {
    const url = new URL(config.apiBase);
    if (url.protocol !== "https:" || !config.siteKey) return;
    apiBase = url.origin;
  } catch { return; }

  let turnstileReady;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (turnstileReady) return turnstileReady;
    turnstileReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(fail, 15000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        turnstileReady = null;
        reject(new Error("验证服务未加载，请检查网络后重试。"));
      }
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => {
        if (!window.turnstile) return fail();
        window.turnstile.ready(() => { clearTimeout(timer); resolve(window.turnstile); });
      };
      script.onerror = fail;
      document.head.append(script);
    });
    return turnstileReady;
  }

  function createPanel(channel) {
    const panel = document.createElement("section");
    panel.className = "fragment-comments";
    panel.dataset.channel = channel;
    panel.setAttribute("aria-labelledby", `comments-title-${channel}`);
    panel.innerHTML = `
      <h2 id="comments-title-${channel}">${channel === "home" ? "评论" : "留言"}</h2>
      <p>${channel === "home" ? "评论和回复经站主审核后公开。称呼未经身份验证，请勿填写隐私信息。" : "B-SIDE 留言仅站主可见，不公开展示。"}无需注册。</p>
      ${channel === "home" ? `<details data-discussion><summary>查看评论</summary><p data-list-status role="status"></p><div data-list></div><button data-refresh type="button">刷新评论</button><button data-more type="button" hidden>更早的评论</button></details>` : ""}
      <form>
        <p data-reply hidden></p><button data-cancel type="button" hidden>取消回复</button>
        <label>称呼（选填）<input name="nickname" maxlength="40" autocomplete="nickname"></label>
        <label>想说的话<textarea name="message" maxlength="2000" required></textarea></label>
        <p>最多 2000 字。提交使用 Cloudflare 防刷验证，请勿填写敏感信息。</p>
        <button type="button" data-verify>加载验证</button>
        <div data-challenge></div>
        <button type="submit" disabled>发送留言</button>
        <p role="status" aria-live="polite"></p>
      </form>`;
    const form = panel.querySelector("form");
    const send = form.querySelector('[type="submit"]');
    const verify = form.querySelector("[data-verify]");
    const notice = form.querySelector('[role="status"]');
    let token = "", widget, busy = false, requestId = "", lastDraft = "";
    let parentSeq = null, next = null, loading = false;
    const replyLabel = form.querySelector("[data-reply]");
    const cancel = form.querySelector("[data-cancel]");
    function cancelReply() { parentSeq = null; replyLabel.hidden = cancel.hidden = true; }
    cancel.addEventListener("click", cancelReply);
    async function loadComments(reset = true) {
      if (channel !== "home" || loading) return;
      loading = true;
      const status = panel.querySelector("[data-list-status]");
      const list = panel.querySelector("[data-list]");
      const more = panel.querySelector("[data-more]");
      const refresh = panel.querySelector("[data-refresh]");
      more.disabled = refresh.disabled = true;
      status.textContent = "正在读取…";
      try {
        const response = await fetch(`${apiBase}/api/comments/public?channel=home${!reset && next ? `&before=${next}` : ""}`, { credentials: "omit", signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data.items)) throw new Error("评论暂时无法读取，请重试。");
        if (reset) list.replaceChildren();
        for (const item of data.items) {
          const article = document.createElement("article");
          const header = document.createElement("header");
          header.textContent = `${item.nickname} · ${new Date(item.created_at).toLocaleDateString("zh-CN")}${item.reply_to ? ` · 回复 ${item.reply_to}` : ""}`;
          const text = document.createElement("p");
          text.textContent = item.message;
          article.append(header, text);
          if (!item.parent_seq) {
            const reply = document.createElement("button");
            reply.type = "button";
            reply.textContent = "回复";
            reply.addEventListener("click", () => {
              if (busy) return;
              parentSeq = item.seq;
              replyLabel.textContent = `回复 ${item.nickname}`;
              replyLabel.hidden = cancel.hidden = false;
              form.elements.message.focus();
            });
            article.append(reply);
          }
          list.append(article);
        }
        next = data.next;
        more.hidden = !next;
        status.textContent = list.children.length ? "" : "还没有公开评论。";
      } catch (error) { status.textContent = error.message || "读取失败，请重试。"; }
      finally { loading = false; more.disabled = refresh.disabled = false; }
    }
    if (channel === "home") {
      const discussion = panel.querySelector("[data-discussion]");
      discussion.addEventListener("toggle", () => { if (discussion.open) loadComments(); });
      panel.querySelector("[data-refresh]").addEventListener("click", () => loadComments());
      panel.querySelector("[data-more]").addEventListener("click", () => loadComments(false));
    }
    const clearToken = () => { token = ""; send.disabled = true; };
    verify.addEventListener("click", async () => {
      verify.disabled = true;
      notice.textContent = "正在加载验证…";
      try {
        const turnstile = await loadTurnstile();
        if (widget !== undefined) turnstile.remove(widget);
        widget = turnstile.render(form.querySelector("[data-challenge]"), {
          sitekey: config.siteKey, action: "comments", size: "flexible",
          theme: channel === "bside" ? "dark" : "light",
          callback: value => { token = value; send.disabled = busy; notice.textContent = "验证通过，可以发送。"; },
          "expired-callback": () => { clearToken(); notice.textContent = "验证已过期，请重新验证。"; },
          "error-callback": () => { clearToken(); notice.textContent = "验证失败，请重试。"; }
        });
        verify.textContent = "重新验证";
      } catch (error) { notice.textContent = error.message; }
      finally { verify.disabled = false; }
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !token || !form.reportValidity()) return;
      const nickname = form.elements.nickname.value.trim();
      const message = form.elements.message.value.trim();
      if (!message) { notice.textContent = "请写下留言内容。"; return; }
      const visibility = channel === "home" ? "public" : "private";
      const draft = JSON.stringify({ channel, nickname, message, visibility, parentSeq });
      if (draft !== lastDraft || !requestId) { requestId = crypto.randomUUID(); lastDraft = draft; }
      busy = true;
      send.disabled = verify.disabled = true;
      notice.textContent = "正在发送…";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`${apiBase}/api/comments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "omit", signal: controller.signal,
          body: JSON.stringify({ channel, nickname, message, requestId, token, visibility, parentSeq })
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || "留言未发送成功，请重试。");
        form.elements.message.value = "";
        requestId = lastDraft = "";
        cancelReply();
        notice.textContent = channel === "home" ? "已送达，审核通过后公开。" : "已送达，仅站主可见。";
      } catch (error) {
        notice.textContent = error.name === "AbortError" || error instanceof TypeError
          ? "网络异常，暂时无法确认是否送达。文字已保留，重新验证后可重试。"
          : error.message;
      } finally {
        clearTimeout(timer);
        busy = false;
        verify.disabled = false;
        clearToken();
        if (widget !== undefined && window.turnstile) { window.turnstile.remove(widget); widget = undefined; }
      }
    });
    return panel;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const home = document.querySelector("#view-home .footer");
    if (home) home.before(createPanel("home"));
    const wrapper = document.getElementById("archive-page-wrapper");
    const content = document.getElementById("archive-content");
    if (!wrapper || !content) return;
    const bside = createPanel("bside");
    wrapper.append(bside);
    function sync() {
      bside.hidden = location.hash !== "#/archive/b-side" ||
        typeof SkadrateData === "undefined" || !SkadrateData.bSide.isUnlocked();
    }
    sync();
    window.addEventListener("hashchange", sync);
    new MutationObserver(sync).observe(content, { childList: true });
  });
})();
