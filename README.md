# 檢討點題

考卷檢討時，讓學生用手機匿名點選「想聽講解的題目」，老師即時看到每一題有幾個人想問，由多到少排序。

- 學生：掃 QR code，不用登入、不用密碼，點題號後按送出。
- 老師：打開 `/teacher`，輸入密碼，用講的或打字設定這次的題型和題號，看排序，檢討完按「結束這次檢討」，資料全部清掉。
- 同一時間只有一場檢討。網址和 QR code 永遠不變，每堂課重新設定題目即可。

## 檔案（全部放在最外層，沒有資料夾）

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 學生頁（QR code 指向這裡） |
| `teacher.html` | 老師頁（網址是 `/teacher`） |
| `student.js` | 學生頁程式 |
| `teacher.js` | 老師頁程式 |
| `style.css` | 共用樣式 |
| `_worker.js` | 後端：儲存題目和投票、檢查老師密碼 |
| `README.md` | 這份說明（不上傳也可以） |

檔名要一字不差，包括 `_worker.js` 開頭的底線。

## 上線步驟（只做一次，約 10–15 分鐘，手機可以做）

### 1. 把檔案放到 GitHub

1. 用手機瀏覽器開 GitHub 的 repository 頁面。
2. 按 **Add file → Upload files**。
3. 按 **choose your files**，一次選好 6 個檔案：`index.html`、`teacher.html`、`student.js`、`teacher.js`、`style.css`、`_worker.js`。
4. 等檔案列出後，按 **Commit changes**。

如果下載到手機的檔名被改成 `index (1).html` 這種，先改回原本的檔名再上傳。

### 2. 註冊 Cloudflare

到 cloudflare.com 註冊免費帳號。

### 3. 建立資料庫

1. 登入後，在左側選單找到 **D1 SQL database**。
2. 按 **Create Database**，名稱填 `review-poll`，按 **Create**。

不用建立任何資料表，網頁第一次使用時會自己建好。

### 4. 連接 GitHub 並部署

1. 左側選單進入 **Workers & Pages**。
2. 按 **Create application**，選 **Pages**，再選 **Connect to Git**。
3. 選 **GitHub**，登入授權，選你的 repository，按 **Begin setup**。
4. 設定如下：
   - Production branch：`main`（或你 repository 的主要分支）
   - Framework preset：**None**
   - Build command：`exit 0`
   - Build output directory：`/`（代表最外層）
5. 按 **Save and Deploy**，等它跑完。

完成後會得到一個網址，例如 `https://review-poll.pages.dev`。

如果部署失敗，並提示找不到輸出資料夾，到專案的 **Settings → Build** 把 Build output directory 改成留空，或改填 `.`，再到 **Deployments** 重新部署。

### 5. 設定老師密碼和資料庫

在剛剛的 Pages 專案裡，進入 **Settings**：

1. **Variables and Secrets** → **Add**
   - Variable name：`TEACHER_PASSWORD`
   - Value：你想用的老師密碼
   - 選 **Encrypt**（加密），按 **Save**
2. **Bindings** → **Add** → **D1 database bindings**
   - Variable name：`DB`（要全大寫，一字不差）
   - D1 database：選 `review-poll`
   - 按 **Save**

設定要在「Production」（正式環境）那一欄。

### 6. 重新部署

綁定和密碼要重新部署才會生效：進入專案的 **Deployments**，找到最新一筆，按右邊的 `⋯`，選 **Retry deployment**。

### 7. 試用

- 老師頁：`https://你的網址/teacher`，輸入密碼。
- 學生頁：`https://你的網址/`。

老師頁登入時如果出現「還沒設定老師密碼」或「還沒綁定資料庫」，代表第 5、6 步有漏，回去檢查變數名稱（`TEACHER_PASSWORD`、`DB`）和是否重新部署。

### 8. 做 QR code

把學生頁的網址（`https://你的網址/`）丟進任何免費的 QR code 產生器，下載圖片，交給班導師印在考卷上。網址不會變，所以只要做一次。

## 每堂課怎麼用

1. 打開老師頁（第一次輸入密碼後，這支手機會記住）。
2. 在「這次考卷」的框裡用講的或打字，例如：
   `選擇 1 到 20，題組 21 到 23，素養 A 到 E`
   確認下方「辨識到：…」正確後，按「建立這次的題目」。
3. 學生掃 QR code，點想問的題號，按送出。
4. 老師畫面每 3 秒自動更新，由人數多到少排序。講完一題就點一下那一題，標記為已講解。
5. 檢討完按「結束這次檢討」，題目和所有回覆都會清掉。

### 設定題目的說法

- 題號可以跳著說：`選擇 1 到 10，13，15 到 18`
- 排除題目：`選擇 1 到 20 不含 11 12`
- 素養題用字母：`素養 A 到 E`
- 中文數字也可以：`選擇一到二十`
- 支援的題型名稱：選擇、單選、多選、填充、進階、素養、題組、簡答、計算、非選擇等，其他名稱會直接當作題型名稱。

### 語音輸入被聽錯時

手機鍵盤的語音辨識可能把「題組」聽成別的字。程式內建一張「聽錯對照表」，會自動換回正確的題型，目前有「題主題、題組提、提組、題祖、題族、主題 → 題組」等。

如果發現新的聽錯寫法，請把「你念的」和「手機打出來的字」告訴我，我補進對照表。對照表在 `teacher.js` 裡，搜尋 `MISHEAR` 就能找到。按建立之前，也可以直接在輸入框裡手動改字。

## 費用和限制

- Cloudflare 的免費方案，一般補習班的使用量夠用（官方每日額度：Workers 請求 10 萬次、D1 每日寫入 10 萬列）。
- 一場檢討最多收 300 份回覆，一份考卷最多 300 題、6 種題型。
- 學生手機每 30 秒向伺服器確認一次老師有沒有換題，老師畫面每 3 秒更新一次。

## 注意

- 老師密碼只能擋住好奇的學生，不是銀行等級的防護。
- 學生的回覆是匿名的：資料庫只存「一組隨機代號」和選了哪些題，不存姓名或其他個人資料。隨機代號只用來讓同一支手機重送時覆蓋舊的，不會重複計算。
- 同一支手機換瀏覽器或清除網站資料後，會被當成新的一位，可以再投一次。
- 老師頁網址是 `/teacher`，後面不要加斜線。
