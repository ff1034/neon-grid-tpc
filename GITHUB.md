# 把 NEON GRID TPC 上傳到 GitHub（Windows 教學）

這份是給你自己操作的步驟。有兩種方式：

- **方式 A：全部在網頁上操作**（下一節）。不用打指令，適合第一次上傳。缺點是之後每次修改都要手動重新上傳檔案。
- **方式 B：用 Git 指令**（第 1～7 節）。之後改了程式只要三行指令就能更新，長期比較方便。所有指令都在 **Git Bash** 裡執行（開始選單搜尋「Git Bash」）。

指令或網址裡的 `<你的帳號>` 要換成你自己的 GitHub 帳號名稱。

---

## 方式 A：全部在 GitHub 網頁上操作

### A1. 建立儲存庫

1. 登入 <https://github.com>，點右上角 **＋ → New repository**。
2. Repository name 填 `neon-grid-tpc`；選 **Public**（要用 GitHub Pages 免費架網站就選這個）或 **Private**。
3. 「Add README」「Add .gitignore」「Choose a license」**都不要勾**。專案裡已經有 README 和 .gitignore，網頁上傳時同名檔案會互相覆蓋，容易搞混。
4. 按 **Create repository**。

### A2. 先挑出要上傳的檔案

網頁上傳**不會看 `.gitignore`**，拖進去的東西全部都會上傳。所以**不要把整個 `neon-grid-tpc` 資料夾拖進去**，裡面有幾樣東西不能或不該上傳：

| 不要上傳 | 原因 |
| --- | --- |
| `node_modules`、`dist` | 安裝 wrangler／部署時產生的，有上千個檔案，而且裡面有超過 25 MB 的檔案，網頁會直接拒絕 |
| `.wrangler` | `wrangler dev` 產生的暫存檔 |
| `blender\src`（ual.glb） | 裡面 8 個 fly* 動作授權不明，不要公開散布 |
| `blender\out` | Blender 中間檔，遊戲用的是 `models\` 裡的複本 |

在檔案總管打開 `C:\esp\neon-grid-tpc`，按住 **Ctrl** 逐一點選下面這些（共約 80 個檔案）：

- 檔案：`.gitignore`、`GITHUB.md`、`README.md`、`index.html`、`package.json`、`package-lock.json`、`serve.py`、`wrangler.toml`
- 資料夾：`models`、`screenshots`、`scripts`、`server`、`src`、`vendor`

### A3. 拖曳上傳

1. 在剛建好的空儲存庫頁面，點「**uploading an existing file**」連結。如果儲存庫裡已經有檔案，就點 **Add file → Upload files**。
2. 把 A2 選好的東西**一起拖進**網頁的虛線框。
   - 要用 **Chrome 或 Edge**，資料夾才會連同裡面的結構一起上傳（例如 `src/main.js` 會在 `src` 資料夾裡）。
   - 網頁一次最多 100 個檔案、每個檔案 25 MB 以內。這個專案約 80 個檔案，最大約 5 MB，一次就傳得完。
3. 等清單跑完，下方「Commit changes」的訊息可以填「第一版」，選 **Commit directly to the main branch**，按 **Commit changes**。

### A4. 補上 blender 腳本（要的話）

`blender` 資料夾不能整個拖，因為裡面有不能上傳的 `src`、`out`：

1. 在桌面新建一個資料夾，取名 `blender`。
2. 把 `C:\esp\neon-grid-tpc\blender` 裡的 5 個 `.py` 檔複製進去：`gen_mech_ual.py`、`run_gen_mech.py`、`inspect_ual.py`、`measure_ual.py`、`probe_pose.py`。
3. 在 GitHub 儲存庫首頁按 **Add file → Upload files**，把桌面這個 `blender` 資料夾拖進去，再按 Commit changes。

### A5. 確認結果

回到儲存庫首頁，應該看到這些資料夾和檔案：`models`、`screenshots`、`server`、`src`、`vendor`、`blender`，以及 `index.html`、`README.md` 等。點進 `src` 確認裡面有 `main.js`、`net.js` 等檔案。

### A6. 之後修改了怎麼更新

- **改了少數檔案**：進到該檔案的資料夾，按 **Add file → Upload files**，把改過的檔案拖進去，同名檔案會被取代。注意要先進到正確的資料夾再上傳，否則檔案會跑到根目錄。
- **只改一兩行文字**：點開檔案，按右上角鉛筆圖示，直接在網頁上改，再按 Commit changes。
- **刪除檔案**：點開檔案，按右上角「⋯ → Delete file」。
- 改動很多的話，用方式 B 的 Git 指令會輕鬆很多。

接下來架網頁（GitHub Pages）、授權、常見問題，跟方式 B 相同，見第 8～10 節。

---

# 方式 B：用 Git 指令

## 1. 確認 Git 已安裝

這台電腦已經裝好 Git（2.54 版）。換一台電腦時，先到 <https://git-scm.com/download/win> 下載安裝，選項全部用預設值就好。預設會一起裝 Git Credential Manager，後面登入會用到它。

```bash
git --version
```

印出 `git version 2.x.x` 就表示裝好了。

## 2. 設定你的名字和 Email（每台電腦只要做一次）

每一筆 commit 都會記錄這兩個值，而且上傳後所有人都看得到。

```bash
git config --global user.name "你想顯示的名字"
```

```bash
git config --global user.email "你的Email"
```

不想公開真實 Email 的話，到 GitHub 網站的 **Settings → Emails** 勾選「Keep my email addresses private」。頁面上會顯示一個 `數字+帳號@users.noreply.github.com` 的地址，把它填進上面的 user.email。

## 3. 確認哪些檔案不會被上傳

專案根目錄的 `.gitignore` 已經排除以下這些：

| 排除項目 | 原因 |
| --- | --- |
| `node_modules/`、`dist/`、`.wrangler/` | 安裝 wrangler、部署時產生的，都可以重新產生（`node_modules` 裡還有 129 MB 的大檔案） |
| `.env`、`.dev.vars`、`*.pem`、`*.key` | 密碼、API 金鑰這類機密，**永遠不要上傳** |
| `blender/out/` | Blender 產生的中間檔。遊戲實際讀的是 `models/` 裡的複本，那份會上傳 |
| `blender/src/`（裡面是 `ual.glb`） | 這個檔案裡有 8 個 `fly*` 動作是 three-player-controller 作者另外加的，授權不明，不要公開散布。要重建角色時，照 README「角色」一節自己下載 |

上傳前可以用下面的指令檢查某個檔案會不會被排除。有印出規則代表會被排除；什麼都沒印代表會上傳。

```bash
git check-ignore -v blender/src/ual.glb
```

## 4. 在電腦上建立 Git 儲存庫並做第一次 commit

```bash
cd /c/esp/neon-grid-tpc
```

```bash
git init -b main
```

```bash
git add .
```

```bash
git status
```

**一定要看一下 `git status` 的清單**，確認裡面沒有不該上傳的檔案（密碼、私人資料、很大的檔案）。沒問題的話：

```bash
git commit -m "NEON GRID TPC：單人第一人稱版本"
```

- 出現 `LF will be replaced by CRLF` 之類的警告可以忽略，那只是換行字元的提示。
- 最大的單一檔案是 `models/agent.glb`，約 5 MB。GitHub 單檔上限是 100 MB，沒有問題。

## 5. 在 GitHub 網站上建立空的儲存庫

1. 登入 <https://github.com>，點右上角 **＋ → New repository**。
2. Repository name 填 `neon-grid-tpc`，或任何你喜歡的名字。
3. 選 **Public**（公開）或 **Private**（私人）。如果要用第 8 節的 GitHub Pages 免費架網站，選 Public 最簡單。
4. **不要**勾「Add a README」「Add .gitignore」「Choose a license」。這三樣電腦上已經有了；在網站上勾選會讓第一次 push 失敗（解法見第 10 節）。
5. 按 **Create repository**。

## 6. 連到 GitHub 並上傳

```bash
git remote add origin https://github.com/<你的帳號>/neon-grid-tpc.git
```

```bash
git push -u origin main
```

第一次 push 時，Git Credential Manager 會跳出視窗，有兩種登入方式：

- **用瀏覽器登入**（推薦）：選「Sign in with your browser」，在瀏覽器裡授權就完成了，之後不用再登入。
- **用 Personal Access Token**：在 GitHub 的 **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 建立一組 token。
  - Repository access 只選這個儲存庫，Permissions 裡的 **Contents** 設成 Read and write。
  - push 時要你輸入密碼的地方，貼上這組 token。
  - token 等同密碼：不要貼到聊天、程式碼或任何檔案裡，也不要 commit 進去。

push 完成後，重新整理 GitHub 網頁，就會看到所有檔案。

## 7. 之後修改了要再上傳

```bash
git add .
```

```bash
git commit -m "這次改了什麼"
```

```bash
git push
```

## 8. 做成公開網頁遊戲（GitHub Pages）

這個遊戲目前完全是靜態檔案（HTML、JS、glb），不需要伺服器，所以可以直接用 GitHub Pages 免費架站：

1. 打開 GitHub 上這個儲存庫，進 **Settings → Pages**。
2. Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
3. 等一兩分鐘，網址會是 `https://<你的帳號>.github.io/neon-grid-tpc/`。手機也可以直接開。

要注意的地方：

- **連線對戰需要伺服器。** GitHub Pages 只能放靜態檔案，不能跑伺服器程式，所以 Pages 上只能玩單人。連線版請照 README「連線對戰」部署到 Cloudflare Workers，網頁和伺服器會一起放上去。也可以讓 Pages 上的網頁連到你的 Worker：網址加 `?server=wss://neon-grid-tpc.<你的子網域>.workers.dev/ws`。
- 免費帳號只有 Public 儲存庫可以開 Pages。Private 儲存庫要付費方案。
- Pages 上的網站任何人都看得到，原始碼也一樣。
- 網址加 `?test` 會進入自動化測試模式（沒有滑鼠鎖定也不會暫停）。一般玩家用不到，不用特別處理。

## 8.5 讓 Cloudflare 自動跟著 GitHub 更新（連線版）

設定一次之後，只要 GitHub 的 main 分支有新的 commit（不論用網頁上傳還是 `git push`），Cloudflare 就會自動重新部署連線版。這是 Cloudflare 內建的 **Workers Builds**，不用另外寫設定檔。

1. 登入 <https://dash.cloudflare.com>，左側選 **Workers & Pages**。
2. 連接 GitHub 儲存庫：
   - **還沒部署過**：按 **Create → Import a repository**（中文介面是「匯入存放庫」），第一次會要你授權 Cloudflare 讀取 GitHub。可以只授權 `neon-grid-tpc` 這一個儲存庫。
   - **已經用 `npx wrangler deploy` 部署過**：點進 `neon-grid-tpc` 這個 Worker，到 **Settings → Builds → Connect**，選你的 GitHub 儲存庫。
3. 設定照下表填：

   | 欄位 | 填什麼 |
   | --- | --- |
   | Project / Worker name | `neon-grid-tpc`（必須跟 `wrangler.toml` 第一行的 `name` 一樣，否則部署會失敗） |
   | Production branch | `main` |
   | Build command | 留空（這個專案不用建置） |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | 留空或 `/`（`wrangler.toml` 在儲存庫最上層） |

4. 按 Save / Deploy，第一次會馬上部署一次。到 **Deployments** 或 **Builds** 頁籤看紀錄，成功後網址跟手動部署時一樣：`https://neon-grid-tpc.<你的子網域>.workers.dev`。

之後的流程：

1. 改程式。
2. 上傳到 GitHub：網頁上傳，或 `git push`。
3. 等一兩分鐘，Cloudflare 自動部署完成。玩家重新整理頁面就是新版。

要注意的地方：

- **GitHub 上要有部署需要的檔案**：`wrangler.toml`、`package.json`、`package-lock.json`、`scripts/`、`server/`、`src/`、`vendor/`、`models/`、`index.html`。方式 A 的上傳清單已經全部包含。
- **不要把 Cloudflare API Token 放進儲存庫。** Workers Builds 是用你在網頁上的授權，不需要 Token。
- **部署失敗時**：到 Builds 頁籤看紀錄。最常見的原因是 Worker 名稱跟 `wrangler.toml` 的 `name` 不一致，或 GitHub 上少了檔案。
- **GitHub Pages 和 Cloudflare 可以同時開**：Pages 那份只能玩單人；Cloudflare 那份可以單人也可以連線。

## 9. 授權與致謝

README 最後的「授權」一節已經寫好第三方素材的致謝。上傳前請確認：

| 內容 | 授權 | 要做的事 |
| --- | --- | --- |
| three.js r169 | MIT | 保留 `vendor/three/LICENSE`（已經在） |
| three-mesh-bvh 0.8.3 | MIT | 保留 `vendor/three-mesh-bvh/LICENSE`（已經在） |
| three-player-controller 0.6.3 | MIT | 保留 `vendor/three-player-controller/LICENSE`（已經在） |
| Quaternius Universal Animation Library（角色身體與動作） | 推定為 CC0（依據見 README「角色」） | CC0 不要求署名，README 裡已經主動註明出處 |
| Google Fonts（Chakra Petch、Noto Sans TC） | SIL Open Font License | 網頁是從 Google 載入字型，不是放進專案，所以不用另外處理 |
| 地圖、武器、道具模型與規則程式 | 你自己原版 NEON GRID 的作品 | 由你決定授權 |

**你自己的程式碼要用什麼授權，由你決定：**

- 不放 LICENSE：別人看得到程式碼，但法律上不能拿去用。
- 想讓別人自由使用：在 GitHub 上新增檔案，檔名打 `LICENSE`，網頁會出現「Choose a license template」可以挑選（例如 MIT）。

## 10. 常見錯誤

- **`! [rejected] main -> main (fetch first)`**：在網站上建立儲存庫時勾了 README 或 LICENSE。先執行下面的指令把網站上的檔案合併下來，再 `git push`：

  ```bash
  git pull --rebase origin main
  ```

- **`remote origin already exists`**：remote 已經設定過了。可以先看目前設定的網址，有錯再用 `git remote set-url origin <正確網址>` 改掉：

  ```bash
  git remote -v
  ```

- **不小心 commit 了密碼或 token**：光是刪檔再 commit 不夠，歷史紀錄裡還會留著。**請立刻到該服務把那組密碼或 token 作廢、換新的**，再處理 git 歷史。
- **登入視窗沒有跳出來，或一直要求輸入密碼**：確認 Git 是用預設選項安裝的（含 Git Credential Manager），或改用第 6 節的 token。
