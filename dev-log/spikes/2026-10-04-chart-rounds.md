# Spike S4：K 線以回合為時間軸

- **日期**：2026-10-04
- **狀態**：🟢 通過
- **程式**：`dev-log/spikes/chart-spike.html`（結果寫在 `window.S4`）

## 1. 要驗證的假設

Lightweight Charts 5.2.1 的時間軸是給日期用的。把回合數直接當成時間值，再用自訂格式器顯示成 R1、R2…，可以正常排序、縮放與更新，不需要換成假日期。

## 2. 成功標準（事前訂定）

- [x] X 軸刻度顯示 R 加回合數
- [x] 畫出 40 根 K 棒
- [x] 收盤新增一根時，最舊的一根移出，總數維持 40
- [x] 依台灣習慣紅漲綠跌
- [x] 圖表上有 TradingView 標示連結（Apache-2.0 授權要求）
- [x] 手機寬度 375 px 沒有水平捲動，刻度不重疊

## 3. 環境

Windows 11、Claude 內建瀏覽器（Chrome 152）、`python -m http.server 5173`、lightweight-charts 5.2.1（jsDelivr standalone.production.mjs）。

資料來源：正式引擎 `js/engine/stocks.js` 的 `createMarket` + `closeMarket`，固定亂數種子 20261004，跑 39 回合收盤，產生 r0 到 r39 共 40 根。不是手寫假資料。

## 4. 執行紀錄

| 情境 | K 棒數 | 第一根／最後一根 | 刻度 | setData 時間 |
|-----|-----:|----|----|----:|
| 桌機 1280×800，CHIP | 40 | R0／R39 | R0、R4、R8…R36 | 0.9 ms |
| 再收盤 1 回合 | 40 | R1／R40 | | 0.2 ms |
| 再收盤 1 回合 | 40 | R2／R41 | | 0.1 ms 以下 |
| 切換 SHIP | 40 | R2／R41 | R2、R6…R38 | 0.1 ms |
| 手機 375×812，CHIP | 40 | R0／R39 | R0、R12、R24、R36 | 0.2 ms |

- CHIP 40 根中漲 21、跌 18、平 1，截圖確認紅色為漲、綠色為跌，價格軸兩位小數。
- 標示連結：`#k a` 指向 `https://www.tradingview.com/?utm_medium=lwc-link…`，左下角顯示 TV 標誌（`layout.attributionLogo: true`）。
- 手機寬度：`innerWidth` 375、`scrollWidth` 375、圖表寬 343。

## 5. 過程中發現的問題

| 問題 | 原因 | 處理 |
|-----|-----|-----|
| 手機寬度頁面被撐到 802 px | 除錯輸出的長 JSON 沒有斷行點 | 除錯區加 `overflow-wrap: anywhere`，之後為 375 px；圖表本身沒有超出 |
| 頁面載入後格式器尚未被呼叫 | 窗格隱藏時 rAF 暫停，圖表延後繪製 | 截圖時才繪製，屬內建瀏覽器限制，不影響正式使用 |

## 6. 結論

通過。**設計決定**：

1. 時間值直接用回合數 `r`，刻度與十字線標籤都用 `R{n}` 格式器。
2. 每回合收盤用 `setData` 重設 40 根（0.2 ms），不必處理 `update` 只能附加、不能移除最舊一根的限制。
3. 漲跌色：漲 `#e8453c`、跌 `#2fa36b`（台灣慣例），與一般國際紅跌綠漲相反，英文介面也維持台灣慣例。
4. 保留 `attributionLogo`，另在 README 的第三方授權段落列出 TradingView。
5. 關閉圖表拖曳與縮放（`handleScroll`、`handleScale` 為 false），避免手機上與頁面捲動衝突。

## 7. 限制與已知問題

1. 結算畫面的資產走勢（6 條折線）沒有在本 spike 畫，只驗證了同一條回合時間軸。
2. 刻度格式 `R{n}` 中英文共用，沒有翻成「第 n 回合」；十字線標籤也是 `R{n}`。
3. 只在桌機瀏覽器模擬手機寬度，未在實機觸控測試。

## 8. 過期條件

lightweight-charts 升版（尤其 v6 若改時間軸型別）時重測。
