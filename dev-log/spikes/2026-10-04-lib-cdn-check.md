# Spike S1：JS 函式庫 CDN 載入與體積

- **日期**：2026-10-04
- **狀態**：🟢 通過
- **程式**：`dev-log/spikes/lib-cdn-check.html`（結果寫在 `window.S1`）

## 1. 要驗證的假設

規劃選用的函式庫都能用「import map + jsDelivr 鎖版本」直接在瀏覽器載入，不需建置步驟；首屏需要的部分合計傳輸量 ≤ 600 KB（Q1）。

## 2. 成功標準（事前訂定）

- [x] 規劃表 16 個函式庫（拆成 20 個匯入點）全部 `import()` 成功，且匯出物件可用
- [x] 記錄每個檔案的壓縮後傳輸量（不含快取）
- [x] 首屏組合估算 ≤ 600 KB

## 3. 環境

Windows 11、Claude 內建瀏覽器（Chrome 152）、`python -m http.server 5173`、jsDelivr CDN（回應為壓縮後傳輸）。

## 4. 執行紀錄

### 4.1 載入結果

20 個匯入點全部 OK，0 失敗。

### 4.2 第一輪發現與修正

| 問題 | 原體積 | 修正 | 修正後 |
|------|-------|------|-------|
| `three.module.min.js` 內部匯入未壓縮的 `three.core.js` | 266 KB | import map 以完整網址把 `three.core.js` 對應到 `three.core.min.js` | 104,614 B |
| cannon-es 預設入口未壓縮 | 77 KB | 改用 `dist/cannon-es.min.js` | 38,228 B |
| gsap 預設入口拆成多個未壓縮檔 | 76 KB | 改用 `gsap@3.15.0/+esm` | 29,144 B |

### 4.3 不經快取的傳輸量（`fetch(url, {cache:'reload'})` 重新抓取 33 個檔案，0 個為 0 位元組）

| 函式庫 | 檔案 | 傳輸量（B） |
|-------|------|-----------:|
| three | three.core.min.js + three.module.min.js | 195,038 |
| three addons | RoundedBoxGeometry | 2,237 |
| three addons | OrbitControls（不一定用） | 9,258 |
| cannon-es | cannon-es.min.js | 38,228 |
| gsap | +esm + SplitText | 33,107 |
| lightweight-charts | standalone.production.mjs | 63,771 |
| zzfx | ZzFX.js | 3,986 |
| tone | +esm + 3 個相依 | 90,670 |
| canvas-confetti | confetti.module.mjs | 7,543 |
| fireworks-js | +esm | 4,126 |
| qr-code-styling | +esm | 22,402 |
| driver.js | +esm | 8,345 |
| html-to-image | +esm | 6,991 |
| atropos | atropos.mjs | 4,261 |
| @floating-ui/dom | +esm + core + utils | 12,541 |
| lucide | createElement + 預設屬性 + 1 個圖示 | 1,860（每多一個圖示約 555） |
| zod | +esm | 95,761 |
| zod/mini | mini/+esm | 89,496（沒有比較小） |
| peerjs | +esm + 4 個相依 | 37,362 |

### 4.4 首屏組合估算

three + RoundedBox、cannon-es、gsap + SplitText、zzfx、canvas-confetti、atropos、floating-ui、lucide（30 個圖示估 18 KB）、zod、peerjs：

**約 448 KB**，加上自寫程式（GitHub Pages 會 gzip，估 30 KB 內）約 480 KB，低於 Q1 門檻 600 KB。

延遲載入（不計入首屏）：lightweight-charts、tone、fireworks-js、qr-code-styling、driver.js、html-to-image。

## 5. 結論

通過。**設計決定**：

1. 正式 `index.html` 的 import map 沿用本 spike 的壓縮版對應（含 `three.core.js` 的完整網址重新對應）。
2. 不用 OrbitControls，鏡頭改由 GSAP 控制，省 9 KB。
3. zod/mini 經 +esm 打包後沒有變小，用完整版 zod。
4. Lucide 用逐一圖示模組，只載入用到的圖示。

## 6. 限制與已知問題

1. 量測在桌機寬頻，沒有量手機 4G 下的載入時間（列 GAPS.md）。
2. jsDelivr 的 `+esm` 是伺服器端即時打包，理論上同版本內容不變，但不是 npm 原始檔；若 CDN 故障，需改成把檔案放進 repo 的 `vendor/`。
3. 傳輸量含 HTTP 標頭，小檔案（lucide 圖示）標頭佔比高。

## 7. 過期條件

任何函式庫升版、或 jsDelivr 改變 `+esm` 打包方式時重測。
