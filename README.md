# opencode-sidbar-context-breakdown

OpenCode TUI plugin thay thế `internal:sidebar-context`, hiển thị chi tiết **% thành phần** của context window theo từng vai trò với **2 chế độ hiển thị**.

## Tính năng

- **2 chế độ hiển thị:** detail (đầy đủ) | compact (vừa phải)
- **Click để chuyển chế độ:** Click vào tiêu đề "Context" để cycle qua các chế độ
- **Thống kê chi tiết:** Số lượng message, trung bình tokens/message, chi phí thực tế/ước tính
- **Lọc thông minh:** Ẩn thành phần < 1% để giảm nhiễu
- **Token estimation chính xác:** Ước tính per-role từ aggregate API tokens

## Hiển thị

### Detail Mode (mặc định)
```
▼ Context ███████░ 85,432 tokens (42%)
  85,432 tokens (42%) | $12.00 Act | $0.12 Est | 85 msgs (42U/43A) | avg 2,034/msg
  Input 78% 78,432
    System 45% 38,444
    User 18% 14,200
      text 12% 9,500 (22)
      file 5% 3,900 (15)
      agent 1% 800 (2)
    History 12% 9,488
      text 10% 7,900 (43)
      thnk 2% 1,588 (30)
    Tools 3% 2,300 (25calls)
      tavily_search 1% 800 (5)
      memory_search 1% 700 (8)
      read 1% 800 (12)
  ---
  Out 15%
  Thnk 7%
  CacheR 7%
```

### Compact Mode
```
▷ Context ███████░ 85,432 tokens (42%)
  85,432 tokens (42%) | $12.00 Act | $0.12 Est | 85 msgs (42U/43A) | avg 2,034/msg
  Sys 45% | U 18% | H 12% | T 3%
```

## Giải thích các trường

| Trường | Ý nghĩa |
|--------|---------|
| `N tokens (X%)` | Tổng tokens của lần gọi cuối và % so với giới hạn context của model |
| `Act$` | Chi phí thực tế của session (tổng tất cả API calls đã thực hiện) |
| `Est$` | Chi phí ước tính cho lần gọi cuối dựa trên token usage |
| `N msgs (XU/YA)` | Tổng số messages, trong đó X là user, Y là assistant |
| `avg N/mag` | Trung bình tokens/message |
| `In X%` | % input tokens trong tổng (+ tổng tokens) |
| `  System X%` | Ước tính % đến từ system prompt (+ tokens) |
| `  User X%` | Ước tính % đến từ các user message |
| `    text X%` | User text part (+ tokens, số lượng) |
| `    file X%` | User file part (+ tokens, số lượng) |
| `    agent X%` | User agent part (+ tokens, số lượng) |
| `  History X%` | Ước tính % đến từ lịch sử assistant message |
| `    text X%` | Assistant text part (+ tokens, số lượng) |
| `    thnk X%` | Reasoning/thinking tokens (+ tokens, số lượng) |
| `  Tools X%` | Ước tính % đến từ tool call inputs/outputs (+ tokens, số calls) |
| `Out X%` | % output tokens (text model sinh ra) |
| `Thnk X%` | % reasoning/thinking tokens (model hỗ trợ) |
| `CacheR X%` | % prompt cache read tokens |
| `CacheW X%` | % prompt cache write tokens |

### Chế độ hiển thị

- **Detail:** Đầy đủ, hiển thị số message, chi tiết từng loại (text, file, agent, thnk), top tools
- **Compact:** Vừa phải, chỉ hiển thị % không có thống kê chi tiết

**Click vào "▼ Context" hoặc "▷ Context"** để cycle qua các chế độ.

### Token Estimation

System / User / History / Tools là **ước tính** vì API chỉ trả về tổng input tokens, không phân tách theo vai trò. 

**Cách tính:**
1. Đếm ký tự trong từng Part của message (text, file content, agent content, tool state)
2. Chia cho 4 để ước tính tokens
3. Scale tỉ lệ về đúng tổng thực tế nếu estimate > actual
4. Dùng `Math.round` cho độ chính xác cao

Đây là cùng phương pháp với tab Context trong opencode app chính.

## Cài đặt thủ công (local)

> Plugin này chưa publish lên npm. Cài theo cách thủ công sau.

**1. Copy source vào opencode node_modules:**

```bash
DEST="$HOME/.config/opencode/node_modules/opencode-sidbar-context-breakdown"
mkdir -p "$DEST/src"
cp src/index.tsx "$DEST/src/index.tsx"
cp package.json  "$DEST/package.json"
```

Hoặc dùng mise task:

```bash
mise run sync
```

**2. Cập nhật `~/.config/opencode/tui.json`:**

```json
{
  "plugin": [
    "C:/Users/<tên-user>/.config/opencode/node_modules/opencode-sidbar-context-breakdown/src/index.tsx"
  ],
  "plugin_enabled": {
    "internal:sidebar-context": false
  }
}
```

> Thay `<tên-user>` bằng username thực tế. Dùng forward slash `/` ngay cả trên Windows.

**3. Khởi động lại opencode.**

### Tại sao không dùng file path trực tiếp?

Opencode chạy như Bun standalone executable. Khi load plugin từ path nằm ngoài `~/.config/opencode/node_modules/`, Bun load riêng `@opentui/core-win32-x64` (native module) — trong khi opencode đã load rồi → **segmentation fault**.

Cách fix: đặt plugin vào trong `node_modules` của opencode để dùng chung `@opentui/core`, `@opentui/solid`, `solid-js` với opencode → không duplicate.

## Phát triển

```
D:/AI/opencode/selft_plugin_project/opencode_sidbar_context_breakdown/
├── src/
│   └── index.tsx        ← source duy nhất (TSX + JSDoc JSX pragma)
├── .mise/tasks/
│   ├── sync             ← copy src vào ~/.config/opencode/node_modules/
│   ├── build            ← bun build (không dùng để chạy, chỉ để kiểm tra)
│   ├── dev              ← watch mode
│   └── setup            ← bun install
├── package.json
├── tsconfig.json
└── mise.toml
```

**Workflow khi sửa:**

```bash
# 1. Sửa src/index.tsx
# 2. Sync vào opencode node_modules
mise run sync

# 3. Restart opencode để áp dụng
```

**Type check:**

```bash
bun install   # cài devDependencies (@opencode-ai/plugin, @opencode-ai/sdk, ...)
bun tsc --noEmit
```

## Cơ chế hoạt động

Plugin dùng `TuiPluginApi` của opencode để:

1. **Đọc messages** — `api.state.session.messages(session_id)` lấy toàn bộ message history
2. **Lấy token thực tế** — từ `AssistantMessage.tokens` của lần gọi cuối cùng có output
3. **Ước tính composition** — duyệt qua tất cả `Part[]` của mỗi message qua `api.state.part(messageID)`, đếm ký tự, chia cho 4
4. **Scale về thực tế** — nếu tổng ước tính > `tokens.input` thực tế, scale down tỉ lệ
5. **Render** — dùng `@opentui/solid` JSX vào slot `sidebar_content`

## License

MIT
