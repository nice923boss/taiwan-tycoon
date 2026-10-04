# 台灣大富翁 美術資產 ComfyUI 提示詞

本文件提供 11 張美術資產的生成提示詞。說明用繁體中文，提示詞本身用英文（SDXL 與 Flux 模型以英文訓練為主）。
生成前遊戲使用 `assets/placeholders/` 的 SVG 佔位圖；PNG 放進 `assets/generated/` 後自動替換，不需改程式。

---

## 1. 使用說明

### 1.1 建議模型與參數（皆為建議，可自行替換）

| 項目 | 建議 |
|------|------|
| 模型 | SDXL 動漫系 checkpoint，例如 Illustrious-XL 系列、NoobAI-XL、Animagine XL 4.0；或 Flux.1（dev / schnell） |
| SDXL 起始參數 | steps 25~30、CFG 5~6、sampler `euler_ancestral` 或 `dpmpp_2m`、scheduler `karras` 或 `normal` |
| Flux 起始參數 | dev：steps 20~28、guidance 3.5；schnell：steps 4。CFG 固定 1，**不使用負向提示詞** |
| 授權 | 各模型授權不同（例如 Flux.1 dev 為非商業授權，schnell 為 Apache-2.0）。公開發布前請自行確認模型、LoRA、去背模型的授權 |

以上參數是動漫系 SDXL 模型常見的起始值，不同模型的最佳值不同，請以模型頁面的建議為準。

### 1.2 基本工作流（SDXL）

```
Load Checkpoint
  → CLIP Text Encode（正向：共用風格前綴 + 類別共用段 + 個別提示詞）
  → CLIP Text Encode（負向：共用負向 + 類別追加 + 個別追加）
  → Empty Latent Image（生成解析度見 1.3）
  → KSampler → VAE Decode
  → （僅角色）去背節點 → Join Image with Alpha（視節點輸出而定）
  → Save Image
```

Flux 的提示詞寫法不同，每張資產另附「Flux 描述句」，用法見 2.4。

### 1.3 尺寸、檔名、透明背景

| 資產 | 檔名 | 生成解析度（SDXL） | 最終輸出尺寸 | 比例 | 透明背景 |
|------|------|------------------|-------------|------|---------|
| 6 隻角色 | `char-<id>.png` | 1024×1024 | 1024×1024（最小 512×512） | 1:1 | 必要 |
| 大廳背景 | `bg-lobby.png` | 1344×768 | 1920×1080 | 16:9 | 不需要 |
| 遊戲桌背景 | `bg-table.png` | 1344×768 | 1920×1080 | 16:9 | 不需要 |
| 棋盤中央 | `board-center.png` | 1024×1024 | 1024×1024 | 1:1 | 不需要 |
| 機會卡背 | `card-chance.png` | 832×1216 | 512×768（或 1024×1536） | 2:3 | 可選（圓角） |
| 命運卡背 | `card-fate.png` | 832×1216 | 512×768（或 1024×1536） | 2:3 | 可選（圓角） |

角色 id 固定為：`bear`、`leopardcat`、`magpie`、`pangolin`、`macaque`、`deer`。

- 1344×768 的比例是 1.75，不是 16:9。放大（例如 4x upscaler 節點）後再裁切成 1920×1080。
- Flux 可直接生成 1920×1088（寬高需為 16 的倍數），再裁掉 8 px 成為 1920×1080。
- 832×1216 的比例約 0.684，裁成 2:3 後再縮放到 512×768。
- 最終比例請與佔位圖一致，避免顯示時被拉伸。

### 1.4 放置位置與檔名規則

1. PNG 放到 `assets/generated/`，檔名與上表完全一致（全小寫、連字號、副檔名 `.png`）。
2. ComfyUI 的 Save Image 會自動加流水號（例如 `char-bear_00001_.png`），放進資料夾前要改名。
3. 缺少的檔案會自動改用 `assets/placeholders/` 的 SVG，所以可以一張一張替換。每張缺少的 PNG 在瀏覽器開發者工具會出現一筆 404，屬正常現象。
4. 替換後若畫面沒變，按 Ctrl+F5 強制重新整理（瀏覽器快取）。
5. 背景 PNG 可能有數 MB，部署到 GitHub Pages 前可用 pngquant 或 oxipng 壓縮（格式仍是 PNG，檔名不變）。

### 1.5 角色透明背景（必要）

角色在 3D 場景中當立牌使用，必須是含 alpha 通道的 PNG。

1. **生成時用單色背景**：提示詞已含 `plain white background`。角色有白色部位（黑熊胸口 V 字、石虎額頭白紋與耳背白斑、藍鵲尾羽白端、梅花鹿白斑）時，去背容易把白色部位一起挖掉；遇到這種情況把 `plain white background` 改成 `plain green background` 重生。
2. **去背節點**（需自行用 ComfyUI Manager 安裝，以下僅為範例）：
   - ComfyUI-RMBG（內含 RMBG-2.0、BiRefNet 等去背模型）
   - BiRefNet 系列自訂節點
   - 授權提醒：RMBG-2.0 模型為非商業授權（CC BY-NC 4.0）；BiRefNet 為 MIT。
3. **輸出含 alpha 的 PNG**：
   - 去背節點直接輸出 RGBA 影像時，接到 Save Image 即可。
   - 去背節點輸出 IMAGE 與 MASK 兩個結果時，用內建節點 `Join Image with Alpha` 合併後再存檔。
   - 若結果是角色變透明、背景留下，代表遮罩方向相反，在中間加 `InvertMask` 節點。
4. **位置調整**：角色水平置中，腳底約在畫面高度 94%（1024 高度約 y=960，與佔位圖的 y≈480/512 相同），頭頂與左右不可被裁切。ComfyUI 不易精準對位，可在影像編輯軟體中移動角色或調整畫布。

### 1.6 讓六隻角色畫風一致

1. 固定「共用風格前綴」「角色共用段」「共用負向」、checkpoint、sampler、steps、CFG、解析度，**只替換角色描述**。
2. 若使用風格 LoRA（例如 chibi 或吉祥物風格 LoRA，自行挑選），六隻都用同一個 LoRA、同一個權重（建議從 0.6~0.8 開始試）。
3. 種子策略：每隻角色都用同一組種子出圖（例如 1001~1008，每隻 8 張），再從中挑選。同一組種子讓構圖與光線傾向接近，但不保證完全一致。挑定後記下每隻的最終種子，方便日後重現或微調。
4. 先定稿一隻（建議黑熊）當風格基準。其餘五隻可選用 IPAdapter（ComfyUI_IPAdapter_plus，需自行安裝）以基準圖做風格參考，權重從 0.3~0.5 開始試；權重太高會把熊的外型帶到其他動物身上。
5. 道具保持小巧，不可遮住動物的輪廓與特徵。

---

## 2. 共用提示詞

### 2.1 共用風格前綴（所有資產，放在正向提示詞最前面）

```
masterpiece, best quality, amazing quality, japanese anime style, clean lineart, flat cel shading, soft pastel colors
```

### 2.2 角色共用段（接在共用風格前綴之後，6 隻角色都要加）

```
chibi, mascot character, cute, solo, no humans, animal focus, full body, standing upright, front three-quarter view, centered, feet visible, big head, small body, big sparkling eyes, thick outline, plain white background, simple background
```

### 2.3 共用負向提示詞（SDXL）

```
worst quality, low quality, normal quality, lowres, blurry, jpeg artifacts, text, letters, words, numbers, watermark, signature, logo, username, nsfw
```

角色另加以下負向（6 隻角色都要加）：

```
human, girl, boy, kemonomimi, humanoid, multiple characters, duplicate, multiple views, cropped, out of frame, feet out of frame, extra limbs, extra legs, extra tail, bad anatomy, deformed, realistic, photo, 3d render, complex background, scenery, cast shadow, drop shadow, gradient background
```

### 2.4 Flux 用法

Flux 不使用負向提示詞，請用自然語句。角色模板如下，把 `{描述句}` 換成各角色的「Flux 描述句」：

```
Japanese anime style chibi mascot illustration of {描述句}, standing upright, full body, front three-quarter view, centered with feet visible, big head and small body, big sparkling eyes, thick clean outlines, flat cel shading, soft pastel colors, isolated on a plain pure white background, single character, no text, no watermark.
```

背景、棋盤中央、卡背的 Flux 句子已寫成完整句，直接使用即可。

---

## 3. 角色（6 隻）

正向提示詞組合方式：`共用風格前綴, 角色共用段, 個別正向`。
負向提示詞組合方式：`共用負向, 角色負向, 個別負向追加`。

### 3.1 台灣黑熊

- 檔名：`char-bear.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
formosan black bear, glossy black fur, white V-shaped crescent mark on chest, light brown muzzle, black nose, round black ears, short stubby legs, wearing a small hiking backpack, tiny round mountain badge on the backpack strap
```

- 負向追加：

```
panda, white face, brown bear, polar bear, large backpack, text on badge
```

- Flux 描述句：`a Formosan black bear with glossy black fur, a white V-shaped crescent mark on its chest, a light brown muzzle and round black ears, wearing a small hiking backpack with a tiny round mountain badge on the strap`
- 備註：胸口白色 V 字是最重要的辨識特徵，必須清楚可見；白色部位容易被去背吃掉，建議直接用綠色背景生成。徽章象徵玉山，只畫山形圖案，不要文字。

### 3.2 石虎

- 檔名：`char-leopardcat.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
leopard cat, small wild cat, golden tan fur with dark brown spots, two white stripes between dark stripes on the forehead running up from the eyes, white eye rings, white muzzle, rounded ears with black backs and a white spot, long thick tail with dark rings and a dark tip, holding a small round paper hand fan
```

- 負向追加：

```
tiger, domestic cat, pointed ears, orange tabby, tiger stripes on body, short tail, text on fan
```

- Flux 描述句：`a Taiwanese leopard cat with golden tan fur covered in dark brown spots, two white stripes running from its eyes up the forehead between dark stripes, white eye rings, a white muzzle, rounded ears with black backs and a white spot, and a long thick ringed tail with a dark tip, holding a small round paper hand fan`
- 備註：石虎與家貓的差異在於耳朵圓、耳背黑底白斑、額頭有白色縱紋、身上是斑點而不是條紋。扇子為台灣常見的圓形紙扇，扇面不要有字。

### 3.3 台灣藍鵲

- 檔名：`char-magpie.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
taiwan blue magpie, bird, deep cobalt blue body and wings, black head and neck, bright red beak, red legs and feet, yellow eyes, very long blue tail feathers with white tips and black bands, white tips on wing feathers, holding a small plain red envelope with gold trim in one wing
```

- 負向追加：

```
blue jay, crest, white belly, short tail, peacock, parrot, chinese characters on envelope
```

- Flux 描述句：`a Taiwan blue magpie bird with a deep cobalt blue body and wings, a black head and neck, a bright red beak, red legs and feet, yellow eyes, and a very long blue tail with white tips and black bands, holding a small plain red envelope with gold trim in one wing`
- 備註：長尾巴是辨識關鍵，可讓尾巴往側後方上揚，避免超出畫面被裁切。模型常在紅包上自動寫「福」等字，已列入負向；仍出現就重生。

### 3.4 穿山甲

- 檔名：`char-pangolin.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
chinese pangolin, small head, narrow pointed snout, small eyes, brown overlapping scales covering the back and tail, pale pinkish belly without scales, long thick scaly tail, strong front claws, wearing a tiny yellow miner hard hat with a headlamp
```

- 負向追加：

```
armadillo, anteater, dinosaur, lizard, smooth skin, large hat covering face
```

- Flux 描述句：`a Chinese pangolin with a small head, a narrow pointed snout, small eyes, brown overlapping scales covering its back and long thick tail, a pale pinkish scale-free belly and strong front claws, wearing a tiny yellow miner hard hat with a headlamp`
- 備註：鱗片要一片片疊合，避免畫成犰狳。礦工帽呼應穿山甲擅長挖洞，以及九份、猴硐的礦業歷史；帽子要小，不要蓋住臉。

### 3.5 台灣獼猴

- 檔名：`char-macaque.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
formosan rock macaque, monkey, grey-brown fur, pinkish face, pink ears, small fur tuft on head, long tail, holding a roasted sweet potato
```

- 負向追加：

```
chimpanzee, gorilla, japanese macaque, bright red face, short tail, banana
```

- Flux 描述句：`a Formosan rock macaque monkey with grey-brown fur, a pinkish face and pink ears, a small fur tuft on its head and a long tail, holding a roasted sweet potato`
- 備註：台灣獼猴的尾巴比日本獼猴長，臉色偏粉而非鮮紅。地瓜呼應「台灣形狀像地瓜」的說法。

### 3.6 梅花鹿

- 檔名：`char-deer.png`
- 尺寸：生成 1024×1024，輸出 1024×1024 RGBA
- 個別正向：

```
formosan sika deer, chestnut brown coat with white spots, small short antlers, big ears, black nose, cream muzzle, white fluffy tail, wearing a small garland of white and pink flowers around the neck
```

- 負向追加：

```
reindeer, moose, large antlers, red nose, unicorn
```

- Flux 描述句：`a Formosan sika deer with a chestnut brown coat covered in white spots, small short antlers, big ears, a black nose, a cream muzzle and a white fluffy tail, wearing a small garland of white and pink flowers around its neck`
- 備註：白色梅花斑是辨識重點；鹿角保持短小，避免變成馴鹿。花圈要小，不可遮住胸前斑點。

---

## 4. 背景、棋盤中央、卡背

正向提示詞組合方式：`共用風格前綴, 個別正向`。負向提示詞組合方式：`共用負向, 個別負向追加`（不加角色負向）。

### 4.1 大廳背景

- 檔名：`bg-lobby.png`
- 尺寸：生成 1344×768，放大後裁成 1920×1080，不需透明
- 個別正向：

```
scenery, no humans, wide landscape, stylized taiwan landscape, layered green mountains, calm blue sea in the foreground, taipei 101 skyscraper silhouette in the distance, soft clouds, gentle morning sunlight, hazy atmosphere, muted colors, low saturation, low contrast, calm empty area in the center, anime background painting
```

- 負向追加：

```
people, characters, animals, signboards, busy details, high contrast, dark, night, oversaturated
```

- Flux 句子：`A soft, stylized Japanese anime background painting of a Taiwan landscape: layered green mountains, a calm blue sea in the foreground, the Taipei 101 skyscraper as a distant silhouette, soft clouds and gentle morning light, hazy atmosphere, muted low-saturation colors, low contrast, a calm open area in the center, no people, no text.`
- 備註：畫面上會疊介面，整張要淡、低對比，中央保持空曠。模型畫的台北 101 可能不精準，風格化即可；想固定構圖，可把佔位圖 `bg-lobby.svg` 轉成 PNG（瀏覽器開啟後截圖，或用 Inkscape 匯出）做 img2img（denoise 0.55~0.7）。

### 4.2 遊戲桌背景

- 檔名：`bg-table.png`
- 尺寸：生成 1344×768，放大後裁成 1920×1080，不需透明
- 個別正向：

```
abstract background, no humans, dark teal and deep indigo gradient, subtle repeating auspicious cloud and wave pattern, inspired by taiwanese temple ceramic tiles, faint pattern, elegant, minimal, soft vignette, low contrast, flat design
```

- 負向追加：

```
bright colors, busy pattern, objects, characters, scenery, central object, high contrast, glossy
```

- Flux 句子：`An elegant, minimal abstract background: a calm gradient from dark teal in the center to deep indigo at the edges, with a very faint repeating auspicious cloud and wave pattern inspired by Taiwanese temple ceramic tiles, soft vignette, low contrast, flat design, no objects, no text.`
- 備註：中央會被 3D 棋盤蓋住，圖案淡淡的即可；整體要偏暗，讓棋盤與棋子突出。

### 4.3 棋盤中央

- 檔名：`board-center.png`
- 尺寸：生成 1024×1024，輸出 1024×1024，不需透明
- 個別正向：

```
top-down illustrated map of taiwan island, vintage map style, pale pastel colors, watercolor paper texture, faint mountain ridges, gentle sea waves around the island, small islands, very light, low contrast, no labels
```

- 負向追加：

```
labels, place names, roads, compass letters, dark colors, high contrast, people, 3d, perspective
```

- Flux 句子：`A very light, low-contrast top-down illustrated map of Taiwan island in a vintage map style, pale pastel colors on watercolor paper texture, faint mountain ridges along the island, gentle sea waves and a few small islands around it, no labels, no text.`
- 備註：中央會疊遊戲標題，整張要淡。模型通常畫不出正確的台灣輪廓，建議把佔位圖 `board-center.svg` 轉成 PNG，當 ControlNet（canny 或 lineart）輸入，或做 img2img（denoise 0.5~0.65），以保留島嶼形狀。指北針常帶 N、E 等字母，出現就重生或移除指北針。

### 4.4 機會卡背

- 檔名：`card-chance.png`
- 尺寸：生成 832×1216，裁成 2:3 後縮放到 512×768（或 1024×1536）
- 個別正向：

```
card back design, flat 2d graphic, symmetrical ornate pattern, warm orange and gold, large question mark symbol in a round cream medallion in the center, sunburst rays, decorative double border, small sparkles in the corners, filling the entire frame, front view
```

- 負向追加：

```
hands, people, table, perspective, tilted card, photo of a card, playing card suits
```

- Flux 句子：`A flat 2D card back design filling the entire frame, front view: warm orange and gold, a large question mark symbol inside a round cream medallion in the center, soft sunburst rays, a decorative double border and small sparkles in the corners, symmetrical, no other text or letters.`
- 備註：共用負向裡的 `text` 可能連問號一起壓掉，這張可從負向移除 `text`，保留 `letters, words, numbers`。問號常畫歪，用佔位圖做 img2img（denoise 0.45~0.6）最穩。佔位圖四角是透明圓角；生成版若是直角，想保持一致可在影像軟體裁圓角（512×768 時半徑約 32 px）並存成含透明的 PNG。

### 4.5 命運卡背

- 檔名：`card-fate.png`
- 尺寸：生成 832×1216，裁成 2:3 後縮放到 512×768（或 1024×1536）
- 個別正向：

```
card back design, flat 2d graphic, symmetrical ornate pattern, deep indigo and purple, golden swirling spiral emblem in a round medallion in the center, golden stars and sparkles, starry night sky, decorative double gold border, filling the entire frame, front view
```

- 負向追加：

```
hands, people, table, perspective, tilted card, photo of a card, zodiac symbols, moon face
```

- Flux 句子：`A flat 2D card back design filling the entire frame, front view: deep indigo and purple starry background, a golden swirling spiral emblem inside a round medallion in the center, small golden stars and sparkles, a decorative double gold border, symmetrical, no text.`
- 備註：與機會卡用同一張構圖做 img2img 或用同一個種子，兩張卡背的版型會比較一致。

---

## 5. 生成圖驗收清單

逐張確認後再放進 `assets/generated/`：

- [ ] 檔名完全正確（全小寫、連字號、`.png`）
- [ ] 比例正確：角色 1:1、背景 16:9（1920×1080）、棋盤中央 1:1、卡背 2:3
- [ ] 角色為 RGBA，四角像素 alpha 為 0；邊緣沒有白邊或綠邊（去背殘留）
- [ ] 角色的白色部位沒有被去背挖空（黑熊 V 字、石虎額頭白紋與耳背白斑、藍鵲尾羽白端、梅花鹿白斑）
- [ ] 角色水平置中，腳底約在畫面高度 94%，頭頂、尾巴、左右都沒有被裁切
- [ ] 畫面只有一隻角色，沒有多餘的腳、手或尾巴
- [ ] 全圖沒有文字、浮水印、簽名（特別檢查紅包、徽章、扇子、指北針、卡片）；機會卡只允許問號
- [ ] 特徵正確（對照第 3 節各角色的個別正向）
- [ ] 六隻角色畫風一致（線條粗細、上色方式、頭身比）
- [ ] 背景與棋盤中央夠淡，疊上文字仍清楚
- [ ] 放入後按 Ctrl+F5，遊戲顯示的是新圖而不是佔位圖

快速檢查尺寸、模式與左上角透明度（需要 Python 與 Pillow）：

```bash
python -c "from PIL import Image; im = Image.open('assets/generated/char-bear.png'); print(im.size, im.mode, im.getpixel((0, 0)))"
```

角色的預期輸出類似 `(1024, 1024) RGBA (255, 255, 255, 0)`：模式必須是 `RGBA`，最後一個數字必須是 `0`。
