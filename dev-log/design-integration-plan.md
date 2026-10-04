# 設計整合規劃：JS 工具清單混搭進大富翁

- **日期**：2026-10-04
- **來源**：`C:\Users\user\Downloads\JS工具功能清單.xlsx`（328 個工具、22 組配方）
- **狀態**：[Doc] spike S1 到 S6 已回填（第 6 節）；引擎、連線層、UI 完成；2026-10-04 加入電腦代打與觀戰者接手空位（第 9 節）

## 1. 目標轉換：「沒人做過的品質」改成可量測標準

「沒人做過」無法驗證（R4），改用下列可在本機量測的標準。每條都寫明量測方法，量不到的列入 GAPS.md，不宣稱達成。

| 編號 | 標準 | 門檻 | 量測方法 |
|------|------|------|---------|
| Q1 | 首屏 JS 傳輸量 | ≤ 600 KB（壓縮後） | `performance.getEntriesByType('resource')` 的 `transferSize` 加總 |
| Q2 | 擲骰到骰子靜止 | ≤ 2.5 秒 | spike 記錄模擬步數 × 1/60 秒 |
| Q3 | 桌機擲骰動畫幀率 | 中位數 ≥ 55 fps（1280×800） | requestAnimationFrame 間隔統計 |
| Q4 | 3D 骰面與主機結果一致 | 300 次 100% | spike 自動比對 |
| Q5 | 無 WebGL 仍可完整遊玩 | 2D 棋盤可走完一局 | `?gl=0` 強制關閉 3D 實測 |
| Q6 | 減少動態 | 系統開啟 reduced-motion 或設定關閉動畫時，動畫等待 ≤ 300ms | 設定切換後量測回合流程 |
| Q7 | 語系一致 | 中英 key 100% 對齊；切換後棋盤貼圖、日誌、圖表全部更新 | 單元測試 + 瀏覽器實測 |
| Q8 | 網路封包 | 完整狀態快照 ≤ 40 KB | 序列化後量測 |
| Q9 | 鍵盤與報讀 | 按鈕皆有可讀名稱；只用鍵盤能完成一回合 | 瀏覽器 accessibility tree 檢查 |
| Q10 | 引擎穩定 | 500 局隨機對局 0 卡死、不變量 0 違反 | `node --test` 模糊測試 |

已量測：Q8 🟢 最大狀態廣播 JSON 23,783 B、BinaryPack 19,649 B（6 人後期局面、觀戰上限）；換主機 hello 一次性 46,068 B（`tests/net.protocol.test.js`）。其餘項目於 UI 完成後量測。

## 2. 選用工具

全部用 import map 指向 jsDelivr 並鎖版本，不需建置步驟，GitHub Pages 直接可用。版本與授權來源：npm registry（2026-10-04 查詢，B 級證據）。

| 工具 | 版本 | 授權 | 用途 | 載入時機 |
|------|------|------|------|---------|
| Three.js | 0.186.1 | MIT | 3D 棋盤、棋子立牌、房屋、鏡頭 | 首屏 |
| cannon-es | 0.20.0 | MIT | 物理擲骰（配方 #6），骰面依主機結果重新對應 | 首屏 |
| GSAP（含 SplitText） | 3.15.0 | GSAP 標準授權（免費含商用） | 棋子逐格跳動、鏡頭跟隨、卡片翻面、新聞逐字浮現、金額跳動 | 首屏 |
| Lightweight Charts | 5.2.1 | Apache-2.0（需標示 TradingView 連結） | 股票 K 線、結算時的資產走勢 | 開啟股市面板時 |
| ZzFX | 1.4.0 | MIT | 程序化音效（擲骰、腳步、收錢、入獄），不需音檔 | 首屏 |
| Tone.js | 15.1.22 | MIT | 背景音樂（預設關閉），最後 5 回合加快節奏 | 開啟音樂時 |
| canvas-confetti | 1.9.4 | ISC | 紅包 emoji 彩帶：經過起點、標下地產、蓋旅館 | 首屏 |
| fireworks-js | 2.10.8 | MIT | 遊戲結束煙火 | 遊戲結束時 |
| qr-code-styling | 1.9.2 | MIT | 大廳邀請 QR Code（掃碼加入同一房間） | 開啟邀請時 |
| Driver.js | 1.9.0 | MIT | 中英雙語新手導覽 | 第一次進入或按說明 |
| html-to-image | 1.11.13 | MIT | 結算成績卡匯出 PNG | 按下分享時 |
| Atropos | 2.0.2 | MIT | 選角卡、地契卡的多層視差 | 首屏 |
| Floating UI | 1.8.0 | MIT | 棋盤格子與按鈕的提示框（Tippy.js 已封存，改用這個） | 首屏 |
| Lucide | 1.51.0 | ISC | 介面圖示 | 首屏 |
| Zod | 4.6.5 | MIT | P2P 訊息驗證（系統邊界） | 首屏；node 測試用 npm 版 |
| PeerJS | 1.5.5 | MIT | P2P 連線（已有 spike） | 首屏 |

自製保留：i18n（已完成，比 i18next 輕，且引擎訊息格式已綁定）。

## 3. 不採用的工具與理由

| 類別 | 工具 | 理由 |
|------|------|------|
| 綁框架 | React Three Fiber、Drei、Recharts、Nivo、Motion for React、Threlte、TresJS | 本專案無框架、無建置步驟 |
| GPL 授權 | Typed.js、TypeIt、ScrollReveal、fullPage.js、Flickity、Trianglify | 公開部署有授權傳染風險 |
| 不適用遊戲畫面 | Lenis、ScrollTrigger、Locomotive Scroll、各種視差捲動 | 遊戲畫面不捲動 |
| 版本衝突 | Vanta.js | 綁舊版 three，與 0.186 重複載入 |
| 需金鑰或帳號 | Anthropic SDK、Google Maps、Mapbox、Firebase、Supabase | 公開頁面不放金鑰 |
| 太重 | WebLLM、Transformers.js | 手機下載數百 MB |
| 隱私 | MediaPipe、Human | 要求鏡頭權限，與遊戲無關 |
| 需後端 | Socket.IO | GitHub Pages 無伺服器 |
| 功能重疊 | boardgame.io（取代自有引擎）、SweetAlert2（原生 dialog 足夠）、Howler（ZzFX 已涵蓋）、Chart.js / ECharts（Lightweight Charts 已涵蓋）、CountUp / Odometer（GSAP 已涵蓋）、Tippy.js（已封存） | 避免重複載入 |
| 字型風險 | troika-three-text | 中文要另載 SDF 字型檔，體積大；改用 2D canvas 畫字再貼到 3D |

選配（未排入）：棋盤中央台灣地圖（D3-geo + TopoJSON），需先確認地圖資料授權，列入 GAPS.md。

## 4. 架構

```
index.html（import map 鎖版本）
├─ js/engine/      純函式規則引擎（已完成，node 可測）；bot.js 為離線座位的保守電腦策略
├─ js/i18n/        中英字典 + 切換（已完成）
├─ js/net/         身分、Zod 訊息驗證、PeerJS 傳輸、假傳輸、主機房間、客戶端、換主機
└─ js/ui/
   ├─ board-paint.js   2D canvas 畫棋盤（3D 貼圖與 2D 降級共用）
   ├─ scene3d.js       Three.js 場景、立牌、房屋、點選格子（動態 import，失敗時改用 2D）
   ├─ dice3d.js        cannon-es 預先模擬 + 骰面重新對應
   ├─ board2d.js       無 WebGL 時的 2D 棋盤
   ├─ panels / modals  玩家、股市（K 線）、日誌、聊天、購買、拍賣、交易、負債、設定
   ├─ fx.js            彩帶、煙火、音效、音樂（延遲載入）
   ├─ results.js       結算畫面、資產走勢圖、成績卡 PNG（原規劃的 share.js 併入此檔）
   └─ tour.js          新手導覽
```

降級路線：

1. 設定選 2D、`?gl=0`、或 `scene3d.js`（含 three、cannon-es）載入或 WebGL 建立失敗：改用 `board2d.js` 並提示，同一套 `board-paint.js` 畫格子，棋子畫在 2D canvas 上。3D 模組只在選 3D 時才下載。
2. 系統 reduced-motion 或設定關閉動畫：骰子直接顯示結果、棋子直接到位、不放彩帶煙火。
3. CDN 單一函式庫載入失敗：非核心（圖表、音樂、QR、導覽、分享圖）以動態 import 包 try/catch，失敗只停用該功能並提示。核心（three、peerjs、zod）失敗時顯示錯誤與重新整理按鈕。

骰子同步方式：主機用種子算出點數，客戶端各自跑一次 cannon-es 模擬（不畫面），記下靜止時朝上的面，再把骰子貼圖換位，讓朝上那面正好是主機點數，最後播放記錄的軌跡。各家看到的軌跡不同，但點數一致。

## 5. 畫面與互動設計重點

| 場景 | 工具組合 | 內容 |
|------|---------|------|
| 大廳 | Atropos + qr-code-styling + Lucide | 6 隻台灣動物選角卡（多層視差）、邀請 QR Code、座位與觀戰名單 |
| 回合開始 | GSAP | 鏡頭滑到目前玩家，頭像框發光，倒數環 |
| 擲骰 | Three.js + cannon-es + ZzFX | 物理骰子落在棋盤中央，碰撞音效 |
| 移動 | GSAP + ZzFX | 立牌逐格跳動，經過起點噴紅包（canvas-confetti） |
| 抽卡 | GSAP SplitText | 卡片 3D 翻面，文字逐字浮現 |
| 收盤 | GSAP SplitText + Lightweight Charts | 新聞跑馬燈逐字出現，K 線多一根 |
| 結算 | fireworks-js + Lightweight Charts + html-to-image | 煙火、資產走勢折線、匯出成績卡 |
| 導覽 | Driver.js | 中英雙語，跟著語系切換 |

引擎需要的小幅擴充（為圖表）：

1. 股價歷史從收盤價陣列改為每回合 K 棒 `{o,h,l,c}`，卡片造成的盤中漲跌記入高低點。
2. 每回合收盤記錄各玩家總資產，供結算走勢圖。

## 6. Spike 清單（R2）

| Spike | 成功標準 | 結果 |
|-------|---------|------|
| S1 CDN 載入 | 16 個函式庫都能從 import map 載入，記錄體積與時間 | 🟢 20 個匯入點全部成功；首屏估約 480 KB（`spikes/2026-10-04-lib-cdn-check.md`） |
| S2 預定點數物理骰 | 300 次模擬 100% 正確、靜止時間 ≤ 2.5 秒、桌機中位數 ≥ 55 fps | 🟡 300/300、3000/3000 正確，最長 2.42 秒；fps 只量到每幀成本中位 1.36 到 1.65 ms（`spikes/2026-10-04-scene-dice-board.md`） |
| S3 中文棋盤貼圖 | 2048 貼圖上 40 格中文名稱、價格清楚可讀，切換語系可重畫 | 🟢 中英文截圖確認，重畫 2 到 32 ms（同上） |
| S4 K 線以回合為時間軸 | X 軸顯示 R1、R2…，可畫 40 根 K 棒 | 🟢 引擎實際資料 40 根，刻度 R0 到 R36，滑動視窗正常，紅漲綠跌（`spikes/2026-10-04-chart-rounds.md`） |
| S5 Tone.js iOS 解鎖 | 本機無 iOS 裝置，無法執行 | 列入 GAPS.md |
| S6 連線迴圈實網換主機 | `+esm` 具名匯出可用；3 分頁關主機後 5 秒內換主機且狀態不變 | 🟡 換主機 614 ms、狀態一致；主機卡死時約 100 秒才能接手（GAPS G1）（`spikes/2026-10-04-session-real-network.md`） |

## 7. Pre-mortem 更新

| 新風險 | 機率 | 對策 | 放棄條件 |
|--------|------|------|---------|
| 首屏太重，手機載入慢 | 30% | 非核心延遲載入；Q1 量測不過就把 Atropos、Floating UI 改為延遲載入 | Q1 超過 900 KB 時拿掉 3D，預設 2D |
| 物理骰子面對應錯誤 | 20% | S2 自動比對 300 次 | 不到 100% 就改用 GSAP 補間骰子（非物理） |
| 中低階手機 3D 掉幀 | 35% | 像素比上限 1.5、陰影只開一盞光；設定可切換 2D | 手機未實測，列 GAPS.md |
| CDN 版本消失或改壞 | 5% | 全部鎖精確版本 | 改成把檔案放進 repo 的 vendor 資料夾 |
| 函式庫事件與 i18n 不同步 | 15% | 所有字串走 t()，語系切換時重畫貼圖、重設導覽步驟 | 無 |

## 8. 交付分類（R3）

完成後每個模組標 [實作] / [Shell] / [Spike] / [Doc]，未完成項目寫入 GAPS.md。

## 9. 離線座位：電腦代打與觀戰者接手（2026-10-04 新增）

需求：有人離開後，空位可讓觀戰者選擇接手；沒人接手時由電腦代為擲骰操作。使用者選定的規則如下。

| 項目 | 規則 | 程式位置 |
|------|------|---------|
| 電腦開始代打 | 斷線 8 秒（`offlineActMs`） | `js/net/host-room.js` 的 `updateAway()` |
| 開放接手 | 斷線 30 秒（`seatReleaseMs`），觀戰橫幅出現「接手 {name}」按鈕，確認後接手 | `js/app.js` 的觀戰橫幅、`claim` 指令 |
| 電腦節奏 | 電腦連續兩步之間 1.5 秒（`botStepMs`，`tickSlackMs` 容許主機計時晚到）；人類動作後 1.5 到 2.0 秒（等待從下一次主機計時開始算）；別人改名、買賣股票不會重新計時 | `tick()` |
| 電腦策略（保守） | 擲骰（有出獄卡先用）；買地後現金仍有 $300 以上才買；拍賣一律放棄；交易一律拒絕；不買賣股票；欠款時自動抵押變賣，不夠就破產 | `js/engine/bot.js`、`LIQUIDATE`（主機限定動作） |
| 原玩家回來 | 沒被接手：拿回座位，電腦停止代打；已被接手：改為觀戰 | `join()` |
| 不可接手 | 大廳階段、遊戲結束、已破產的座位、自己已有座位 | `claim` 指令 |

協定版本從 1 升為 2（座位多了 `bot`、`vacant` 欄位，新增 `claim` 訊息）。部署新版後，所有人都要重新整理頁面，舊版分頁會收到版本不符的提示。

驗證：
- 單元測試：`tests/engine.bot.test.js`（策略、LIQUIDATE、4 個種子的全電腦對局都能走到結束）、`tests/net.host.test.js`（代打、回座、接手、拒絕條件、全員離線由電腦打完）。全套 120/120 通過（第一版）。
- 覆檢後修正（全套 124/124 通過）：
  - 別人每 500 ms 改名或買股票時，電腦的等待一直被重設而停住，改成只有電腦的決策點改變才重新計時（測試「computer play is not held up by renames or stock trades from others」）。
  - 換主機後代打與空位狀態遺失，改為沿用快照中的 `bot`、`vacant` 並回推離線時間（測試「migration keeps computer and vacant seats as they were」）。
  - 連線中斷時按「接手」沒有反應，改為顯示「重新連線中」提示。
  - 遊戲快照的 sessionStorage 鍵不分房間，同一分頁換 `?room=` 會載入上一個房間的遊戲，改為 `monopoly.snap:房間ID`（測試「a saved game stays with its room」）。
  - 主機計時常晚到幾毫秒，電腦每步常拖到第四次計時（2.0 秒），加 `tickSlackMs` 後固定在第三次（測試「computer moves stay three host ticks apart when a tick runs late」）。
- 瀏覽器實測（本機 3 分頁，PeerJS 公用伺服器）：玩家離線後主機顯示「電腦代打」與紀錄「玩家463 離線，改由電腦代打」；電腦擲骰、以 $150 買電力公司、結束回合，沒有出現「超時」；量到每步間隔 1,582 ms、1,980 ms；台北101 因 $461 − $400 < $300 而放棄購買並放棄競標；原玩家回來後紀錄「回來了，電腦停止代打」；離線約 30 秒後觀戰者出現接手按鈕，確認後紀錄「玩家811 接手了 玩家463 的座位」，現金與地產沿用；原玩家再回來時成為觀戰者。手機寬 375px 下橫幅單行顯示。
- 修正後瀏覽器重測（本機 2 分頁，房間 `pace-m3x`，一位玩家離線）：電腦連續步驟間隔 1,485、1,503、1,504、1,509 ms（修正前同情境為 2,009、1,992 ms）；人類結束回合或放棄競標後電腦出手 1,544、1,626、1,793、1,813、1,964 ms。主機分頁重新整理後從 `monopoly.snap:twmono-r-pace-m3x` 接回第 4 回合，電腦繼續代打。新房間 `pace-m3x` 首次開啟時為空大廳，沒有沿用舊房間的遊戲。


## 10. 交接打包（2026-10-04 新增）

- 新增 `HANDOFF.md`：另一台電腦接手時的 ComfyUI 生圖提示詞（A）與 GitHub Pages 上架提示詞（B），各附手動流程與上架後實測清單。
- 新增空檔 `.nojekyll`（關閉 GitHub Pages 的 Jekyll 處理）；`.gitignore` 加入 `.claude/`。
- 修正：頂部列 logo 與分頁圖示寫死為佔位 SVG，放入 `char-bear.png` 後不會更換。`js/app.js` 新增 `setLogo()`，沿用 `loadImage` 的生成圖優先規則。
- 發現 G24：英文介面名稱「Taiwan Monopoly」含商標，留給部署者決定英文名稱。
- 驗證：壓縮檔 89 個檔案，PowerShell `Expand-Archive` 解壓後逐檔 SHA-256 與原始檔一致；解壓副本 `npm ci` 後 124/124 通過；解壓副本以本機伺服器開啟，大廳顯示，本機檔案全部 200，CDN 21 個資源無失敗，404 只有 9 張尚未生成的 PNG。放入測試用 `char-bear.png` 後，大廳角色、頂部 logo、分頁圖示都改用 PNG；原專案（無 PNG）仍顯示佔位圖，404 數量不變。
