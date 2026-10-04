# Spike：PeerJS 固定 ID 搶主機 + 換主機

- **日期**：2026-10-04
- **狀態**：🟢 通過（附一項重大限制，已改設計）
- **程式**：`dev-log/spikes/peer-spike.html`（由瀏覽器 devtools 驅動 `window.S`）

## 1. 要驗證的假設

GitHub Pages 無後端，用 PeerJS 公用信令伺服器（0.peerjs.com）實作「單一房間」：
固定 Peer ID 只能被一個瀏覽器佔用，佔到的人當主機；主機離開後，其他人能接手同一個 ID。

## 2. 成功標準（事前訂定）

- [x] 第二個分頁用同 ID 註冊會收到 `unavailable-id`
- [x] 隨機 ID 的分頁能連上固定 ID 主機，雙向收發資料
- [x] 單則 20KB 以上訊息可正確送達（完整遊戲狀態快照估 10~20KB）
- [x] 主機 `destroy()` 或重新整理後，客戶端在 1 秒內收到 close，且能重新註冊同 ID
- [x] 預設 ICE 設定含 TURN（NAT 穿透不只靠 STUN）

## 3. 環境

Windows 11、Claude 內建瀏覽器（Chrome 152）、兩個分頁、peerjs@1.5.5（jsDelivr CDN）、0.peerjs.com 公用信令。

## 5. 執行紀錄

| 項目 | 結果 |
|------|------|
| 主機註冊固定 ID | 成功，512ms |
| 第二分頁註冊同 ID | `unavailable-id`，472ms |
| 客戶端連線主機 | 成功，468ms |
| `serialization: 'json'` 訊息 100 / 8000 / 15000 / 16000 字元 | 成功（約 20ms） |
| `serialization: 'json'` 訊息 17000 / 20000 / 30000 / 60000 字元 | **靜默丟失，無錯誤事件** |
| `serialization: 'binary'` 訊息 17000 / 60000 / 200000 字元 | 成功（11~22ms，自動分塊） |
| 主機 `destroy()` 後重新註冊同 ID | 成功，476ms |
| 主機分頁重新整理：客戶端偵測 close | 導航後 322ms |
| 主機分頁重新整理後客戶端註冊同 ID | 成功，496ms |
| `peerjs.util.defaultConfig.iceServers` | Google STUN + `turn:eu-0/us-0.turn.peerjs.com:3478` |

## 6. 結論

全部通過。**設計變更**：連線改用預設 `binary` 序列化，禁止 `json`（超過約 16KB 靜默丟包）。

## 7. 限制與已知問題

1. 只測了「乾淨關閉」（destroy、重新整理）。主機斷網或當機時，信令伺服器要等心跳逾時才釋放 ID，
   本 spike 未量測該時間；程式需持續重試「搶 ID / 連線」直到成功。
2. 兩分頁在同一台機器，WebRTC 走本機迴路；跨網路（行動網路 CGNAT）未測，依賴 PeerJS 公用 TURN 的可用度。
3. 0.peerjs.com 為免費公用服務，無 SLA。

## 9. 過期條件

peerjs 升級到 2.x，或 0.peerjs.com 服務政策改變時重測。
