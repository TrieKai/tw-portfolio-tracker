# 台股基金資產追蹤（tw-portfolio-tracker）

台股與境內基金個人持倉管理：自動更新現價、損益統計、趨勢圖表。

- **匿名模式（預設）**：持倉與價格歷史僅存於瀏覽器 LocalStorage。
- **Google 登入**：持倉同步至雲端（Vercel KV / Redis），可在不同裝置使用同一帳號資料。

## 技術棧

- Next.js 15（App Router）、TypeScript、Tailwind CSS
- 部署：Vercel Serverless
- 價格來源：TWSE（台股）、集保中心（基金淨值）

## 開發

```bash
pnpm install
pnpm dev
```

瀏覽 [http://localhost:3000](http://localhost:3000)。

### Google 登入與雲端同步（選用）

複製 `.env.example` 為 `.env.local` 並填入：

| 變數 | 說明 |
|------|------|
| `AUTH_SECRET` | NextAuth 密鑰（`openssl rand -base64 32`） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 用戶端 |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis（Vercel 整合）供雲端同步 |

Google OAuth 授權重新導向 URI 需包含 `https://你的網域/api/auth/callback/google`（本機為 `http://localhost:3000/api/auth/callback/google`）。

未設定 KV 時仍可登入，但無法寫入雲端；匿名模式不受影響。

## 建置

```bash
pnpm build
pnpm start
```

## 目錄說明

詳見 [AGENTS.md](./AGENTS.md)。

> **備註**：API 路徑 `/api/fund-nav` 等沿用早期命名，指「基金淨值」整合模組，與套件名稱 `tw-portfolio-tracker` 無關。
