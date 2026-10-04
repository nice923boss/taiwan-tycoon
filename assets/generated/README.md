# 生成圖放置區

把 ComfyUI 產出的 PNG 放在這個資料夾，檔名必須完全一致：`char-bear.png`、`char-leopardcat.png`、`char-magpie.png`、`char-pangolin.png`、`char-macaque.png`、`char-deer.png`、`bg-lobby.png`、`bg-table.png`、`board-center.png`、`card-chance.png`、`card-fate.png`。遊戲會先載入這裡的 PNG，缺少的檔案自動改用 `assets/placeholders/` 的 SVG 佔位圖，所以可以一張一張替換。尺寸、提示詞與驗收清單見專案根目錄的 `PROMPTS.md`。

## 定稿紀錄

### 共用設定

- 工具：本機 ComfyUI 0.20.1。
- 模型：Z-Image Turbo（`zImageTurboQuantized_fp8E4m3fn`）、文字編碼器 Qwen3-4B（`qwen_3_4b`，lumina2 模式）、VAE `ae.safetensors`。未使用 LoRA，也未使用放大模型。授權見專案根目錄 `README.md`。
- 取樣：ModelSamplingAuraFlow shift 3、10 步、cfg 1、`dpmpp_2m_sde`／`sgm_uniform`。cfg 1 時負向提示詞不起作用，所以畫面控制全靠正向提示詞。
- 提示詞：採 `PROMPTS.md` 的 Flux 描述句。角色套用 2.4 節模板，但把白色背景換成淺藍色隔離底（藍鵲本身是藍色，改用淺綠色），避免去背時挖掉白色部位。
- 文生圖（t2i）寫「t2i」；以參考圖重繪（i2i）寫出 denoise 與參考圖。i2i 的輸出尺寸等於參考圖尺寸。
- 角色後製：rembg u2net 去背，貼到 1024×1024 透明畫布，腳底對齊 y=960，頭頂至少留 120 px，左右至少留 40 px。
- 所有 PNG 最後以 Pillow `optimize` 無損重存（像素逐一比對相同）。

### 各檔案

| 檔案 | 提示詞版本（與 PROMPTS.md 的差異） | seed | 生成方式 | 生成尺寸 | 後製 |
|---|---|---|---|---|---|
| `char-bear.png` | v3：白色 V 字胸紋移到描述開頭並加強為「大而醒目的純白」，加開心張嘴笑與有反光的大圓眼 | 1002 | t2i | 1024×1024 | 去背 |
| `char-leopardcat.png` | v2：強調「像小豹一樣」整身成排的實心深色圓斑，避免畫成虎斑貓 | 1006 | t2i | 1024×1024 | 去背 |
| `char-magpie.png` | v3：頭部只描述為「光滑渾圓的黑色球形」（提到冠羽反而會畫出冠羽） | 1004 | t2i，淺綠色隔離底 | 1024×1024 | 去背後補回輪廓內被誤判為背景的白色尾羽端 |
| `char-macaque.png` | 原句，無差異 | 1005 | t2i | 1024×1024 | 去背 |
| `char-pangolin.png` | 原句，無差異 | 1001 | 草圖引導 i2i，denoise 0.45 | 1024×1024 | 見下方說明 |
| `char-deer.png` | v2：鹿角改為「兩支不高於耳朵的短小尖角」 | 1001 | 草圖引導 i2i，denoise 0.45 | 1024×1024 | 去背 |
| `bg-lobby.png` | 原句，無差異 | 1004 | t2i | 1536×864 | Lanczos 放大到 1920×1080 |
| `bg-table.png` | 原句，無差異 | 1004 | t2i | 1536×864 | Lanczos 放大到 1920×1080 |
| `board-center.png` | 原句，無差異 | 1002 | i2i，denoise 0.6，參考圖為 `assets/placeholders/board-center.svg` 點陣化 | 1024×1024 | 無 |
| `card-chance.png` | 原句，無差異 | 1003 | i2i，denoise 0.5，參考圖為 `card-chance.svg` 點陣化 | 832×1216 | 內縮裁成 2:3，縮到 512×768，圓角 32 px 透明遮罩 |
| `card-fate.png` | 原句，無差異 | 1003 | i2i，denoise 0.5，參考圖為 `card-fate.svg` 點陣化 | 832×1216 | 同上 |

### 穿山甲與梅花鹿的草圖引導

純文字提示詞連續失敗後改用草圖引導：

- 穿山甲：v1 到 v3 的 t2i 都畫成圓臉（v2 在圓臉上黏一根管狀鼻子，v3 變成刺蝟）。取 v2 t2i seed 1002 那張，手繪把管狀鼻子改成與臉部相連的尖吻，再用原句 i2i（denoise 0.45，seed 1001）。i2i 後胸口殘留舊嘴型與臉頰一個小點，手動塗回奶油色；去背時頭燈鏡片顏色接近隔離底而變半透明，改為把輪廓內像素全部補回不透明。
- 梅花鹿：v1、v2 的 t2i 鹿角都又高又分岔。取 v2 t2i seed 1002 那張，手繪把鹿角剪成兩支短尖角，再用 v2 提示詞 i2i（denoise 0.45，seed 1001）。
