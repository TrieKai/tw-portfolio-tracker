# AGENTS.md — 台股基金資產追蹤（tw-portfolio-tracker）

本文件供 AI 代理與協作者快速理解專案結構、慣例與部署限制。

## 專案簡述

- **專案名稱**：`tw-portfolio-tracker`（pnpm 套件；產品稱「台股基金資產追蹤」）
- **框架**：Next.js 15 App Router、TypeScript、Tailwind CSS（`darkMode: 'class'`）
- **部署**：Vercel Serverless
- **資料**：
  - 匿名：僅 **LocalStorage**（`portfolio-tracker-v1`）
  - Google 登入：同上作本機快取 + **KV**（`portfolio:user:{userId}`）跨裝置同步
- **外部 API**（經 Serverless Route 代理，避開 CORS）：
  - 台股即時：TWSE MIS `getStockInfo.jsp`
  - 台股歷史（上市）：TWSE `afterTrading/STOCK_DAY` 月報 API
  - 基金最新淨值：集保 `.../query-simple-data`
  - 基金歷史淨值：集保 `.../query-nav-value/picture`（POST，`startDate`/`endDate` 格式 `YYYY/MM/DD`）

## 目錄結構

```
app/
  layout.tsx, providers.tsx, globals.css
  page.tsx                 # 總覽儀表板
  holdings/page.tsx        # 持倉列表
  holdings/new/page.tsx    # 新增持倉
  trends/page.tsx          # 價格趨勢圖
  api/
    auth/[...nextauth]/route.ts  # NextAuth（Google）
    portfolio/sync/route.ts      # GET/PUT 雲端持倉（需登入）
    fund-nav/route.ts          # 基金最新淨值
    fund-nav/history/route.ts  # 基金歷史淨值
    prices/update/route.ts     # 統一單筆 updatePrice
    prices/batch/route.ts      # 批次更新（最多 15 筆）
components/                # UI 元件
lib/
  types/holding.ts         # Holding、PortfolioStorage 等
  types/price-api.ts       # API 請求/回應型別
  prices/update-price.ts   # 伺服端 updatePrice()
  prices/stock-fetcher.ts
  fund-nav/                # 基金抓取與快取
  portfolio/calculations.ts
  storage/portfolio-store.ts
  storage/cloud-portfolio.ts
  storage/parse-portfolio.ts
auth.ts                    # NextAuth 設定
providers/                 # SessionProvider、ThemeProvider、PortfolioProvider
```

## 核心型別

- `Holding`：單筆持倉（`assetType: 'stock' | 'fund'`）
- `PricePoint`：單日價格快照，key 為 `holdingId`
- `PortfolioStorage`：`{ version, holdings, priceHistory, sales, settings }`
- `SaleTransaction`：單筆賣出與已實現損益（`realizedPnl = proceeds − costBasis`）

## API 慣例

| Route | 用途 |
|-------|------|
| `POST /api/prices/update` | `{ assetType, symbol, market?, name? }` |
| `POST /api/prices/batch` | `{ items: [{ holdingId, assetType, symbol, ... }] }` |
| `POST /api/fund-nav` | 基金最新淨值 |
| `POST /api/fund-nav/history` | `{ fundCode, startDate, endDate }` 或 `{ fundCode, range, buyDate? }` |
| `POST /api/prices/stock-history` | `{ symbol, market?, range }` 或自訂起訖日（僅上市 `tse`） |
| `POST /api/instruments/lookup` | `{ assetType, symbol, market? }` → 官方名稱（TWSE / 集保） |
| `GET/PUT /api/portfolio/sync` | 登入使用者雲端持倉（需 `KV_*`） |

- 所有 price routes：`export const maxDuration = 25`、`dynamic = 'force-dynamic'`
- 錯誤回傳 `{ success: false, error, code, suggestion? }`
- 抓取邏輯使用 `lib/http/fetch-with-retry.ts`（timeout 8s、最多 3 次重試）

## 前端狀態

- `SessionProvider` + `PortfolioProvider`：匿名僅 localStorage；登入後 debounce 同步至 `/api/portfolio/sync`
- 頂部 `AuthMenu`：Google 登入／登出；本機與雲端皆有資料時 `CloudMergeModal`
- `ThemeProvider`：light / dark / system，寫入 `portfolio-theme`
- 頂部「更新全部資產」→ `fetchBatchPriceUpdate`
- 趨勢頁「我的資產」→ `refreshPortfolioForRange(range)` 更新現價並批次載入各持倉歷史；`buildPortfolioTimeline` 加總繪圖
- 趨勢頁「載入歷史」→ `importPriceHistory`（基金→集保；上市股票→TWSE）
- 持倉列表「編輯」→ `edit()` / `EditHoldingModal`（類型不可變，可改正規化代號如 00631L）
- 持倉列表「賣出」→ `sell()` / `SellHoldingModal`；寫入 `storage.sales`（`SaleTransaction`：已實現損益、賣出日等）；部分賣出減少 `quantity`，全部賣出移除持倉
- 持倉頁「資料備份」→ `PortfolioDataPanel` 匯出／匯入 JSON（`lib/storage/portfolio-export.ts`）；登入時匯入後會觸發雲端同步
- 總覽「已實現損益」、持倉頁「賣出紀錄」→ 累加／列表 `sales`

## 修改時注意

1. **持倉上傳伺服器僅在使用者 Google 登入且已設定 KV 時發生**；匿名路徑維持純本機
2. **批次更新**請維持 `MAX_BATCH_SIZE`，避免超過 Vercel 執行時間
3. 新增資產類型時：擴充 `AssetType`、`updatePrice()`、表單與 API schema
4. 圖表使用 **Recharts**；需至少 2 個 `PricePoint` 才繪圖
5. 股票 `market`：`tse`（上市）| `otc`（上櫃）；代號支援 4 碼、`00878`（5 碼）、`00631L`（ETF 槓桿/反向，見 `lib/prices/stock-symbol.ts`）
6. 註解以繁體中文撰寫，說明非顯而易見的業務邏輯

## 本地開發

```bash
pnpm install
pnpm dev
```

## 環境變數

- `AUTH_SECRET`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`：Google 登入（見 `.env.example`）
- `KV_REST_API_URL`、`KV_REST_API_TOKEN`：基金淨值快取 + 登入使用者持倉同步（`@vercel/kv`）

## 測試建議

- `pnpm build` 必須通過
- 手動：新增台股 2330、基金代碼各一筆 → 更新全部 → 趨勢頁確認圖表
- 斷網或錯誤代碼時確認「手動輸入價格」流程
