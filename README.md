# 台股基金資產追蹤（tw-portfolio-tracker）

台股與境內基金個人持倉管理：自動更新現價、損益統計、趨勢圖表。持倉與價格歷史僅存於瀏覽器 LocalStorage，不上傳伺服器。

## 技術棧

- Next.js 15（App Router）、TypeScript、Tailwind CSS
- 部署：Vercel Serverless
- 價格來源：TWSE（台股）、集保中心（基金淨值）

## 開發

```bash
npm install
npm run dev
```

瀏覽 [http://localhost:3000](http://localhost:3000)。

## 建置

```bash
npm run build
npm start
```

## 目錄說明

詳見 [AGENTS.md](./AGENTS.md)。

> **備註**：API 路徑 `/api/fund-nav` 等沿用早期命名，指「基金淨值」整合模組，與 npm 套件名無關。
