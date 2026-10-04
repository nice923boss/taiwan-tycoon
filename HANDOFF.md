# 交接提示詞：ComfyUI 生圖與 GitHub Pages 上架

這份文件給另一台電腦使用。兩件工作各有一段可以直接貼給 Claude Code 的提示詞，也附不用 Claude 時的手動步驟。

| 節 | 內容 |
|----|------|
| 1 | 解壓縮與環境確認 |
| 2 | ComfyUI 生圖（提示詞 A） |
| 3 | GitHub Pages 上架（提示詞 B） |
| 4 | 上架後要實測的項目 |
| 5 | 之後更新網站 |

建議順序：1 → 2 → 3 → 4。圖還沒生完也可以先上架，缺的圖會顯示佔位圖，之後再補上傳。

---

## 1. 解壓縮與環境確認

1. 解壓縮 `taiwan-tycoon-20261004.zip`，得到 `taiwan-tycoon` 資料夾，`index.html` 在資料夾第一層。
2. 壓縮檔不含 `node_modules/`（測試用套件，執行 `npm install` 會重建）與 `.claude/`（原電腦的預覽設定）。遊戲本身用不到這兩個資料夾。
3. 需要的軟體：

| 軟體 | 用途 | 是否必要 |
|------|------|---------|
| Python 3 + Pillow | 本機伺服器；圖片後製與檢查 | 必要 |
| ComfyUI | 生圖 | 必要 |
| Git | 用指令上傳到 GitHub | 走網頁上傳時不需要 |
| GitHub CLI（`gh`） | 用指令建立儲存庫、開啟 Pages | 選用 |
| Node.js 22 以上 | `npm test` 跑 124 項測試 | 選用（只換圖、不改程式時可略過） |

4. 確認檔案完整：在 `taiwan-tycoon` 資料夾執行下列指令，瀏覽器開 `http://localhost:5173/`，看到大廳就代表可以運作。

```bash
python -m http.server 5173
```

找不到 `python` 時改用 `py -m http.server 5173`。不能直接雙擊 `index.html`，ES 模組不能用 `file://` 開啟。

---

## 2. ComfyUI 生圖

提示詞、參數、尺寸、去背方法、驗收清單都以 `PROMPTS.md` 為準，這一節只整理流程。

### 2.1 要產生的 11 張圖

| 檔名 | 內容 | 最終尺寸 | 透明背景 |
|------|------|---------|---------|
| `char-bear.png` | 台灣黑熊 | 1024×1024 | 必要 |
| `char-leopardcat.png` | 石虎 | 1024×1024 | 必要 |
| `char-magpie.png` | 台灣藍鵲 | 1024×1024 | 必要 |
| `char-pangolin.png` | 穿山甲 | 1024×1024 | 必要 |
| `char-macaque.png` | 台灣獼猴 | 1024×1024 | 必要 |
| `char-deer.png` | 梅花鹿 | 1024×1024 | 必要 |
| `bg-lobby.png` | 大廳背景 | 1920×1080 | 不需要 |
| `bg-table.png` | 遊戲桌背景 | 1920×1080 | 不需要 |
| `board-center.png` | 棋盤中央 | 1024×1024 | 不需要 |
| `card-chance.png` | 機會卡背 | 512×768 | 可選（圓角） |
| `card-fate.png` | 命運卡背 | 512×768 | 可選（圓角） |

全部放進 `assets/generated/`，不需要改程式。遊戲先找這裡的 PNG，缺的那張改用 `assets/placeholders/` 的 SVG，所以可以分批放。

### 2.2 提示詞 A（貼給 Claude Code）

用 Claude Code 開啟 `taiwan-tycoon` 資料夾，貼上：

```text
這個資料夾是「台灣大富翁 Online」，純前端網頁遊戲。請用這台電腦的 ComfyUI 產生 11 張美術圖，取代目前的 SVG 佔位圖。

開始前先讀：PROMPTS.md（提示詞、參數、尺寸、去背、驗收清單，全部以它為準）、HANDOFF.md 第 2 節、assets/generated/README.md。

規則：
- 只在 assets/generated/ 新增 PNG。不要改程式，不要改 assets/placeholders/。
- 候選圖留在 ComfyUI 的 output 資料夾，只有我選定並後製完成的圖才放進專案。
- 不要自行安裝自訂節點、模型或 Python 套件，缺什麼先列出來問我。
- 圖好不好看由我決定。你負責篩掉明顯不合格的候選（有文字或浮水印、不只一隻、身體被裁切、白色部位被去背挖空、特徵與 PROMPTS.md 不符），其餘列給我挑。
- 後製用的 Python 腳本放在專案資料夾以外的暫存資料夾，用完刪除。

步驟：
1. 確認 ComfyUI 正在執行：讀取 http://127.0.0.1:8188/system_stats（ComfyUI Desktop 版可能是 8000 埠）。連不上就告訴我，不要自己啟動。
2. 用 /object_info 列出可用的 checkpoint、LoRA 與已安裝的去背節點，然後問我兩件事：用哪個模型；由你透過 ComfyUI API（POST /prompt）出圖，還是我自己在 ComfyUI 介面出圖、你只負責後製與驗收。
3. 先做風格基準 char-bear：依 PROMPTS.md 的組合方式組提示詞，固定 sampler、steps、CFG、解析度，種子 1001 到 1008 各出一張。用 Read 工具看過後，把候選檔案路徑與種子列給我挑。
4. 黑熊定稿後，其餘 5 隻用同一組參數與種子出候選，一隻一隻讓我挑。每張定稿的模型、種子、參數記在 assets/generated/README.md 新增的「定稿紀錄」表格。
5. 背景、棋盤中央、卡背依 PROMPTS.md 第 4 節。需要 img2img 或 ControlNet 時，把對應的 assets/placeholders/*.svg 轉成 PNG 當輸入，轉檔方式先問我。
6. 後製：角色去背並確認 alpha 通道；背景放大後裁成 1920×1080；卡背裁成 2:3 再縮到 512×768；存成 HANDOFF.md 2.1 節表格的檔名。
7. 驗收：
   - 逐張對照 PROMPTS.md 第 5 節清單。
   - 用 Python + Pillow 印出 11 張的尺寸、模式、左上角像素。角色必須是 RGBA，四個角的 alpha 都是 0。
   - 執行 python -m http.server 5173，開 http://localhost:5173/ 按 Ctrl+F5，確認大廳、角色、棋盤、卡片都換成新圖，主控台沒有 assets/generated 的 404。你能操作瀏覽器就自己看，不能就請我看。
8. 11 張都放好後，更新 GAPS.md 的 G13，以及 README.md「已知限制」裡「生成圖尚未產生」那一行。
9. 列出用到的模型、LoRA、去背模型與各自的授權（例如 Flux.1 dev 為非商業授權、RMBG-2.0 為 CC BY-NC 4.0），公開前我要確認。
```

### 2.3 手動流程（不用 Claude）

1. 依 `PROMPTS.md` 在 ComfyUI 生圖，從候選中挑定。
2. ComfyUI 的 Save Image 會加流水號（例如 `char-bear_00001_.png`），改成 2.1 節表格的檔名。
3. 放進 `assets/generated/`。
4. 在 `taiwan-tycoon` 資料夾執行下列指令，一次檢查所有 PNG 的檔名、尺寸、模式、左上角 alpha：

```bash
python -c "from PIL import Image; import pathlib; [print(p.name, Image.open(p).size, Image.open(p).mode, Image.open(p).convert('RGBA').getpixel((0, 0))[3]) for p in sorted(pathlib.Path('assets/generated').glob('*.png'))]"
```

角色那 6 行要是 `(1024, 1024) RGBA 0`，最後的 `0` 代表左上角透明。

5. 開本機伺服器（第 1 節第 4 步），按 Ctrl+F5，確認畫面換成新圖。

---

## 3. GitHub Pages 上架

### 3.1 上架前要決定的事

| 事項 | 建議 | 理由 |
|------|------|------|
| 儲存庫名稱 | `taiwan-tycoon` | 「Monopoly」是 Hasbro 的註冊商標，名稱與網址不要用 |
| 公開或私人 | 公開 | 免費帳號的 GitHub Pages 只能用在公開儲存庫 |
| 授權條款 | 自選，例如 MIT | 沒有 LICENSE 時，別人依法不能複製或改作你的程式碼 |
| 英文版遊戲名稱 | 改成不含 Monopoly 的名稱，例如 Taiwan Tycoon | 英文介面目前顯示「Taiwan Monopoly」（見 GAPS.md 的 G24） |

網址會是 `https://你的帳號.github.io/taiwan-tycoon/`。

### 3.2 提示詞 B（貼給 Claude Code）

```text
這個資料夾是「台灣大富翁 Online」，純靜態網頁（HTML、CSS、JS、圖片），不需要建置。請幫我上傳到 GitHub，並用 GitHub Pages 公開。

開始前先讀：README.md 的「部署步驟」「名稱與商標」「更新版本時」、GAPS.md、HANDOFF.md 第 3、4 節。

規則：
- 帳號登入由我自己做，不要替我輸入密碼或 token。
- 建立公開儲存庫、第一次 push、開啟 Pages 都是公開動作，每一步執行前先跟我確認。
- 不要上傳 node_modules/ 與 .claude/（.gitignore 已排除）。

步驟：
1. 檢查 git、gh 是否已安裝，執行 gh auth status 看是否已登入。缺 gh 或未登入就告訴我，改走 HANDOFF.md 3.3 節的手動流程。
2. 上傳前檢查，結果列給我看：
   a. assets/generated/ 有幾張 PNG、缺哪幾張（缺圖會顯示佔位圖，仍可上架）。
   b. 超過 1 MB 的圖片清單，問我要不要壓縮（格式與檔名不變）。
   c. 根目錄有 index.html 與 .nojekyll；.gitignore 含 node_modules/ 與 .claude/。
   d. 搜尋專案（排除 node_modules）確認沒有金鑰、token、密碼。
   e. 有 Node.js 22 以上就執行 npm install 與 npm test，必須全數通過（目前 124 項）。沒有 Node 就略過並告訴我。
3. 處理 GAPS.md 的 G24：英文介面的 ui.boardTitle 與 ui.lobbyTagline（js/i18n/en.js）含 Monopoly 字樣，問我英文名稱要改成什麼。改完執行 npm test。
4. 問我授權條款（建議 MIT）與著作權人名稱，建立 LICENSE，並把 README.md「本專案程式碼目前未指定授權條款」那段改成實際的授權。
5. git init -b main、git add -A，先給我看 git status，確認沒有 node_modules/ 與 .claude/ 再 commit。
6. 跟我確認後執行：gh repo create taiwan-tycoon --public --source=. --remote=origin --push
7. 跟我確認後開啟 Pages（main 分支、根目錄）：
   gh api --method POST "repos/{owner}/{repo}/pages" -f "source[branch]=main" -f "source[path]=/"
   失敗就請我到 Settings → Pages 手動設定（HANDOFF.md 3.3 節第 4 步）。
8. 每 30 秒用 curl -I 檢查 https://<我的帳號>.github.io/taiwan-tycoon/ ，直到回 200（通常 1 到 3 分鐘）。
9. 開網址確認：大廳出現；主控台除了缺圖的 404 沒有其他錯誤；開兩個分頁能進同一個房間、開局、擲骰。
10. 把網址給我，並列出 HANDOFF.md 第 4 節要我自己實測的項目。
```

第 6、7 步的 `gh` 指令依 GitHub 官方文件撰寫，原電腦沒有 `gh` 與 GitHub 帳號，未實際執行過。失敗時照 3.3 節手動設定即可。

### 3.3 手動流程（只用瀏覽器）

1. 登入 github.com，右上角「+」→ New repository。Repository name 填 `taiwan-tycoon`，選 Public，**不要勾** Add a README file（避免和上傳的 README 衝突），按 Create repository。
2. 在新儲存庫頁面點「uploading an existing file」，把 `taiwan-tycoon` 資料夾**裡面**的檔案與資料夾拖進去（不要拖整個 `taiwan-tycoon` 資料夾，否則網址會多一層）。分兩次上傳，每次按 Commit changes：
   - 第一次：`assets` 以外的全部檔案與資料夾。
   - 第二次：`assets` 資料夾。
3. 確認儲存庫根目錄有 `index.html` 與 `.nojekyll`。缺 `.nojekyll` 就按 Add file → Create new file，檔名填 `.nojekyll`，內容留空，Commit。
4. Settings → Pages → Build and deployment：Source 選「Deploy from a branch」，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
5. 等 1 到 3 分鐘，Pages 設定頁上方會出現網址。
6. 授權：Add file → Create new file，檔名填 `LICENSE`，右側會出現「Choose a license template」，可選 MIT。

想用圖形介面的 git 工具，也可以改用 GitHub Desktop 發布，記得取消勾選「Keep this code private」。

---

## 4. 上架後要實測的項目

以下項目在原電腦沒有環境可測，記在 `GAPS.md`。上架後請實測，把日期、裝置、數據寫回 GAPS.md 對應那一行（也可以把結果貼給 Claude Code，請它更新）。

| GAPS | 測什麼 | 怎麼測 | 要記錄 |
|------|--------|--------|--------|
| G2 | 跨網路連線 | 手機關 Wi-Fi 用行動網路開網址，和電腦上的分頁進同一房、開局、擲骰 | 能否連上；不能連時用的是哪家電信或哪種網路 |
| G1 | 主機卡住時換主機 | 畫面顯示「你是主機」的那位玩家把手機切到背景，或筆電拔網路線，其他人計時 | 其他人恢復操作所需秒數（預估約 100 秒） |
| G3 | iPhone 音效 | iPhone Safari 開網址，點畫面後聽有沒有背景音樂 | 要點幾下才有聲音 |
| G4 | 手機效能 | 中低階手機進遊戲，3D 卡頓就到設定切成 2D | 機型；3D 與 2D 是否流暢 |
| G6 | 載入分數 | 到 pagespeed.web.dev 輸入網址 | 行動版與桌面版分數 |
| G23 | 主機分頁在背景時的電腦代打節奏 | 有人離線、電腦代打時，把顯示「你是主機」的分頁切到別的分頁，計時電腦每一步 | 每步秒數（預估約 2 秒） |

---

## 5. 之後更新網站

1. 換圖或改程式後：用 git 就執行 `git add -A`、`git commit`、`git push`；用網頁就再上傳一次覆蓋同名檔案。
2. GitHub Pages 1 到 3 分鐘後更新。
3. 所有玩家都要重新整理頁面（Ctrl+F5）才會載入新版。新版若提高了通訊協定版本，沒重新整理的分頁會被主機拒絕並顯示提示（目前為第 2 版，見 README「更新版本時」）。
4. 想開另一個獨立房間，在網址後加 `?room=名稱`（小寫英數字與 `-`，最多 24 字），例如 `?room=family`。
