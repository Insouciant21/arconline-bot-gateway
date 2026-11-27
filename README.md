# ArcOnline QQ Bot Gateway

独立的固定 IP QQ Bot Webhook 网关，支持多 Bot ↔ 多 `arconline-ext` 实例共享路由与 B50 查询推送。

## 功能

- **Webhook 接入**：支持 `POST /qq/webhook/:botId`，内置 Ed25519 验签、时间戳防重放校验与 OpCode 13 URL 校验。
- **管理控制台**：内置 Astro + React 管理的 `/admin` 控制台（`ADMIN_SECRET` 登录、SQLite 可撤销 `HttpOnly` 会话 Cookie），支持管理多 Bot、自动读取 `userCode` 注册实例、切换出图模式（`custom` / `official` / `text`）、测试连通性与查看/解绑绑定关系。
- **多对多路由**：支持注册多个 QQ Bot 与多个 `arconline-ext` 实例，通过 `/bind <UserCode>:<绑定码>` 绑定到对应实例。
- **自动同步与出图**：收到 `/b50` 后自动调用对应实例 `/api/bot/sync`（与前端共享 `sameB50` 判重），支持推送 Workers 预渲染的 5×10 自定义 B50 海报或官方 B50 图片，并内置 URL 拉取超时转 `file_data` 直传兜底；同步失败或超时自动回退最近一次缓存快照。
- **短效图片代理**：通过 HMAC 签名 `GET /qq/media/:token`（5 分钟有效）中转 R2 私有缓存图片，无需公开 R2 桶。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm build
```

## Docker 部署

```bash
cp .env.example .env
# 填写 ADMIN_SECRET、MASTER_KEY、PUBLIC_BASE_URL 等变量并 chmod 600 .env
docker compose up -d --build
```
