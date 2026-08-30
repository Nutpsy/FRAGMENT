(() => {
  "use strict";

  const API_KEY = "fragment_admin_api";
  const SESSION_KEY = "fragment_admin_session";
  const state = { apiBase: "", token: "", user: null, data: null, category: "scintilla" };

  const $ = (selector) => document.querySelector(selector);
  const setupView = $("#setup-view");
  const loginView = $("#login-view");
  const adminView = $("#admin-view");
  const notice = $("#notice");
  const publishButton = $("#publish-button");

  function show(view) {
    [setupView, loginView, adminView].forEach((element) => { element.hidden = element !== view; });
    $("#logout-button").hidden = view !== adminView;
  }

  function notify(message, error = false) {
    notice.textContent = message;
    notice.classList.toggle("error", error);
    notice.classList.add("active");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => notice.classList.remove("active"), 4200);
  }

  function normalizeApiBase(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.hostname !== "127.0.0.1") return "";
      return url.origin;
    } catch {
      return "";
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    const response = await fetch(`${state.apiBase}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      state.token = "";
      show(loginView);
    }
    if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
    return payload;
  }

  function today() {
    const date = new Date();
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function displayDate(value) {
    return value ? value.replace(/-/g, ".") : today().replace(/-/g, ".");
  }

  function createId(category) {
    const prefix = { scintilla: "sci", inlandEmpire: "ie", gravityRainbow: "gr", bSide: "bs" }[category] || "item";
    return `${prefix}_${Date.now()}`;
  }

  function summary(item) {
    return item.title || item.content || item.caption || item.src || "（无标题）";
  }

  function renderFields() {
    state.category = $("#category-input").value;
    document.querySelectorAll("[data-fields]").forEach((group) => {
      group.hidden = !group.dataset.fields.split(" ").includes(state.category);
    });
    renderRecords();
  }

  function renderRecords() {
    const list = $("#record-list");
    list.replaceChildren();
    if (!state.data) return;
    const items = Array.isArray(state.data[state.category]) ? state.data[state.category] : [];
    $("#records-title").textContent = `${state.category} · ${items.length}`;
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "暂无记录";
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("article");
      row.className = "record";
      const time = document.createElement("time");
      time.textContent = item.date || "—";
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = summary(item).slice(0, 100);
      const id = document.createElement("p");
      id.textContent = item.id || "无 ID";
      copy.append(title, id);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "DELETE";
      remove.addEventListener("click", () => removeItem(item.id));
      row.append(time, copy, remove);
      list.append(row);
    });
  }

  async function loadContent() {
    $("#publish-state").textContent = "读取中";
    const payload = await api("/api/content");
    state.data = payload.data;
    $("#publish-state").textContent = `线上版本 ${payload.version}`;
    renderRecords();
  }

  async function uploadImage(file) {
    const response = await api("/api/upload", {
      method: "POST",
      headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) },
      body: file
    });
    return response.path;
  }

  async function publish(message) {
    publishButton.disabled = true;
    $("#publish-state").textContent = "发布中";
    try {
      const payload = await api("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: state.data, message })
      });
      $("#publish-state").textContent = `已发布 ${payload.version}`;
      notify("发布成功。GitHub Pages 正在更新。", false);
      renderRecords();
    } finally {
      publishButton.disabled = false;
    }
  }

  async function removeItem(id) {
    if (!window.confirm("确定删除这条记录并立即发布吗？")) return;
    const items = state.data[state.category];
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [removed] = items.splice(index, 1);
    try {
      await publish(`content: remove ${state.category} ${id}`);
    } catch (error) {
      items.splice(index, 0, removed);
      renderRecords();
      notify(error.message, true);
    }
  }

  async function submitContent(event) {
    event.preventDefault();
    const category = state.category;
    const date = displayDate($("#date-input").value);
    let item;
    try {
      if (category === "scintilla" || category === "bSide") {
        const content = $("#content-input").value.trim();
        if (!content) throw new Error("正文不能为空");
        item = { id: createId(category), date, content };
      } else if (category === "inlandEmpire") {
        const file = $("#image-file-input").files[0];
        let src = $("#image-src-input").value.trim();
        if (file) {
          notify("正在上传图片……");
          src = await uploadImage(file);
        }
        if (!src) throw new Error("请上传图片或填写图片路径");
        item = {
          id: createId(category), date, src,
          alt: $("#image-alt-input").value.trim(),
          category: $("#image-category-input").value,
          caption: $("#image-caption-input").value.trim()
        };
      } else {
        const title = $("#note-title-input").value.trim();
        const mdContent = $("#note-markdown-input").value.trim();
        if (!title || !mdContent) throw new Error("标题和 Markdown 正文不能为空");
        item = {
          id: createId(category), date, title, mdContent,
          tags: $("#note-tags-input").value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
        };
      }
      state.data[category].unshift(item);
      try {
        await publish(`content: publish ${category} ${item.id}`);
        event.target.reset();
        $("#date-input").value = today();
        renderFields();
      } catch (error) {
        state.data[category] = state.data[category].filter((entry) => entry !== item);
        renderRecords();
        throw error;
      }
    } catch (error) {
      notify(error.message || "发布失败", true);
    }
  }

  async function authenticate() {
    try {
      const payload = await api("/api/session");
      state.user = payload.user;
      $("#identity-name").textContent = `@${payload.user.login}`;
      show(adminView);
      await loadContent();
    } catch (error) {
      if (state.token) notify(error.message, true);
      show(loginView);
    }
  }

  function readSessionFromFragment() {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("session");
    const authError = params.get("error");
    if (token) {
      sessionStorage.setItem(SESSION_KEY, token);
      history.replaceState(null, "", location.pathname + location.search);
    } else if (authError) {
      notify(authError, true);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function configureApi(value) {
    const normalized = normalizeApiBase(value);
    if (!normalized) throw new Error("请输入有效的 HTTPS Worker 地址");
    localStorage.setItem(API_KEY, normalized);
    state.apiBase = normalized;
  }

  $("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      configureApi($("#api-base-input").value);
      authenticate();
    } catch (error) {
      notify(error.message, true);
    }
  });
  $("#login-button").addEventListener("click", () => { location.href = `${state.apiBase}/auth/login`; });
  $("#change-api-button").addEventListener("click", () => {
    $("#api-base-input").value = state.apiBase;
    show(setupView);
  });
  $("#logout-button").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    state.token = "";
    state.data = null;
    show(loginView);
  });
  $("#refresh-button").addEventListener("click", () => loadContent().catch((error) => notify(error.message, true)));
  $("#category-input").addEventListener("change", renderFields);
  $("#content-form").addEventListener("submit", submitContent);

  async function init() {
    $("#date-input").value = today();
    readSessionFromFragment();
    state.token = sessionStorage.getItem(SESSION_KEY) || "";
    const configured = window.FRAGMENT_ADMIN_CONFIG?.apiBase || localStorage.getItem(API_KEY) || "";
    state.apiBase = normalizeApiBase(configured);
    if (!state.apiBase) {
      show(setupView);
      return;
    }
    if (!state.token) {
      show(loginView);
      return;
    }
    await authenticate();
  }

  init().catch((error) => {
    notify(error.message || "管理页初始化失败", true);
    show(loginView);
  });
})();
