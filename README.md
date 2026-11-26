# ArcOnline QQ Bot Gateway

独立的固定 IP QQ Bot Webhook 网关，支持多 Bot $\leftrightarrow$ 多 `arconline-ext` 实例共享路由与 B50 查询推送。

## 功能

- **Webhook 接入**：支持 `POST /qq/webhook/:botId`，内置 Ed25519 验签与 OpCode 13 URL 校验。
- **多对多路由**：支持注册多个 QQ Bot 与多个 `arconline-ext` 实例，通过 `/bind <实例ID>:<绑定码>` 绑定到对应实例。
- **自动同步 B50**：收到 `/b50` 后自动调用对应实例 `/api/bot/sync`（走与前端一致的 `sameB50` 判重逻辑），同步完成后回传官方缓存 B50 图片与摘要；若同步失败或超时则自动回退发送最近一次缓存的 B50。
- **短效图片代理**：通过 HMAC 签名 `GET /qq/media/:token`（5 分钟有效）中转 R2 私有缓存图片，无需公开 R2 桶。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm build
```
