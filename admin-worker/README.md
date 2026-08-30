# 碎屑管理员认证服务

这个 Worker 负责 GitHub 登录、管理员身份校验、图片上传和 `data.js` 发布。静态网站与 B-side 页面仍由 GitHub Pages 提供。

## 1. 创建 GitHub OAuth App

在 GitHub `Settings → Developer settings → OAuth Apps` 新建应用：

- Homepage URL：`https://nutpsy.github.io/FRAGMENT/admin/`
- Authorization callback URL：`https://你的-worker-地址/auth/callback`

把 Client ID 写入 `wrangler.jsonc` 的 `GITHUB_CLIENT_ID`。

## 2. 创建细粒度仓库令牌

创建只允许访问 `Nutpsy/FRAGMENT` 的 fine-grained personal access token，只授予 `Contents: Read and write`。不要把令牌写进文件。

## 3. 配置 Worker 密钥

安装依赖后执行：

```bash
npm install
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_CONTENT_TOKEN
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 使用至少 32 字节的随机字符串。

## 4. 部署

```bash
npm test
npm run deploy
```

首次打开 `https://nutpsy.github.io/FRAGMENT/admin/` 时，粘贴部署完成后显示的 Worker 地址。也可以把地址写入 `admin/config.js`。

Worker 只允许 GitHub 用户 ID `52111111`，仅允许来自 `https://nutpsy.github.io` 的管理请求，并只更新本仓库的 `data.js` 与 `images/uploads/`。
