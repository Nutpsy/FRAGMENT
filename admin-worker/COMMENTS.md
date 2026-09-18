# 私密留言部署

当前实现：首页与 B-SIDE 分开收信，留言仅站主可见。没有公开读取留言的接口，也不会把留言提交到公开 GitHub 仓库。B-SIDE 原有前端密码不能提供内容保密；本功能不改变这一点。

本地测试使用 Node.js 24（`node:sqlite` 内存数据库验证真实 SQL），`npm test` 不连接远程数据库，也不创建云资源。

## 配置与上线

仅使用 Cloudflare Workers Free / D1 Free / Turnstile Free。不要启用付费计划。当前仓库不含有效的部署地址或密钥，推送代码不等于上线服务。

1. 在 `admin-worker` 中运行 `npx wrangler login`，由站主登录 Cloudflare。不得使用临时预览账户接收真实留言。
2. 执行 `npx wrangler d1 create fragment-comments`，将返回的配置加入 `wrangler.jsonc` 顶层 `d1_databases`，binding 必须为 `COMMENTS_DB`，database_name 为 `fragment-comments`，database_id 使用返回的真实 ID。
3. 执行 `npx wrangler d1 migrations apply fragment-comments --remote` 创建表。
4. 在 Cloudflare 创建免费 Turnstile widget，允许主机名 `nutpsy.github.io`。分别执行 `npx wrangler secret put TURNSTILE_SECRET` 和 `npx wrangler secret put COMMENTS_SECRET`。后者使用独立随机密钥，至少 32 字符，均不可写入仓库。
5. 按 README 完成现有 GitHub 管理员 OAuth 配置，以便接收者能登录并读取留言。必须先确认管理端可用，再开放提交。
6. 执行 `npm test`、`npm run deploy`。保持 `ADMIN_ORIGIN` 为 `https://nutpsy.github.io`。
7. 将真实 Worker HTTPS 地址及公开 Turnstile site key 填入根目录 `comments-config.js`，将 Worker 地址填入 `admin/config.js`；更新 index.html 中 comments-config.js 缓存版本，再推送前端。

未配置前，前端不创建表单、不加载验证脚本，也不会伪装发送成功。生产验证只能从允许的 HTTPS 站点使用，不能直接用 file:// 提交。

## 管理及验收

在 `/admin/` 登录后打开 `/admin/comments.html`，可查看首页 / B-SIDE 来信，按 50 条翻页，移除操作为数据库软删除，误操作可通过数据库恢复。

上线前必须实际验证：首页与解锁后的 B-SIDE 各发送一条测试留言 → 管理页分别收到 → 移除测试留言。另确认未登录不能读收件箱、错误验证码无法发送、移动端表单无横向溢出。验证失败不得声称留言已上线。

防刷：每个日轮换 HMAC 地址标识每分钟最多 2 次、每天最多 20 次新留言，验证码校验 hostname 与 action。限流标识最多保留约两天（下一次成功提交时清理），不保存原始 IP。Turnstile 会接收访问者 IP 用于验证。正文 2000 字、称呼 40 字，仅按纯文本渲染。重试使用相同 requestId 防重复。

匿名投稿者仍可能冒用称呼；管理员登录仅限已有 GitHub 固定用户 ID。不要将匿名昵称当作经过验证的身份。
