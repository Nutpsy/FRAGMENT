// 只填写公开配置。留空时不显示表单，也不请求第三方服务。
// 部署并验证 Worker、D1 和 Turnstile 后再启用，不能放任何 secret。
window.FRAGMENT_COMMENTS_CONFIG = {
  enabled: false,
  apiBase: "https://fragment-admin.fragment-admin-worker.workers.dev",
  siteKey: "0x4AAAAAAFqwfs0K-6h4xn4k"
};
