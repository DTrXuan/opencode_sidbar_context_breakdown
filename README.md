# opencode-sidbar-context-breakdown

OpenCode TUI plugin thay thế `internal:sidebar-context`, hiển thị chi tiết **% thành phần** của context window theo từng vai trò với **3 chế độ hiển thị**.

## Tính năng

- **3 chế độ hiển thị:** ultra (tối giản) | compact (vừa phải) | expanded (đầy đủ)
- **Click để chuyển chế độ:** Click vào tiêu đề "Context" để cycle qua các chế độ
- **Thống kê chi tiết:** Số lượng message, trung bình tokens/message, top 3 tools
- **Lọc thông minh:** Ẩn thành phần < 1% để giảm nhiễu
- **Token estimation chính xác:** Ước tính per-role từ aggregate API tokens

## Hiển thị

### Expanded Mode (mặc định)
```
Context [expanded]
85,432 tokens (42% used)
  Input      78% (45 msgs, avg 1,478/msg)
    System   45% (1 msg, 38,444 tokens)
    User     18% (22 msgs, avg 680/msg)
    History  28% (22 msgs, avg 1,058/msg)
    Tools     9% (15 calls)
      tavily_search    4,200 tokens (3 calls)
      memory_search    2,100 tokens (5 calls)
      read            1,800 tokens (7 calls)
      other (5 tools) 1,200 tokens
  Output     15% (12,800 tokens)
  Cache read  7% (5,980 tokens)
$0.12 spent
```

### Compact Mode
```
Context [compact]
85,432 tokens (42% used)
  Input      78%
    System   45%
    User     18%
    History  28%
    Tools     9%
  Output     15%
  Cache read  7%
$0.12 spent
```

### Ultra Mode
```
Context [ultra]
85,432 tokens (42%)
 In  78%
  Sys 45%
  Usr 18%
  His 28%
  Tls  9%
 Out 15%
 Cch  7%
$0.12
```

## Giải thích các trường

| Trường | Ý nghĩa |
|--------|---------|
| `N tokens (X% used)` | Tổng tokens của lần gọi cuối và % so với giới hạn context của model |
| `Input X%` | % input tokens trong tổng (expanded: + số message, avg tokens/msg) |
| `  System X%` | Ước tính % đến từ system prompt (expanded: + số message, tổng tokens) |
| `  User X%` | Ước tính % đến từ các user message (expanded: + số message, avg tokens/msg) |
| `  History X%` | Ước tính % đến từ lịch sử assistant message (expanded: + số message, avg tokens/msg) |
| `  Tools X%` | Ước tính % đến từ tool call inputs/outputs (expanded: + số calls, top 3 tools) |
| `Output X%` | % output tokens (text model sinh ra) (expanded: + tổng tokens) |
| `Reasoning X%` | % reasoning/thinking tokens (model hỗ trợ) |
| `Cache read/wrt X%` | % prompt cache tokens (expanded: + tổng tokens) |
| `$X.XX spent` | Tổng chi phí của session |

### Chế độ hiển thị

- **Ultra:** Tối giản nhất, dùng viết tắt (Sys/Usr/His/Tls), indentation 1/2/4/6 spaces
- **Compact:** Vừa phải, chỉ hiển thị % không có thống kê chi tiết
- **Expanded:** Đầy đủ, hiển thị số message, avg tokens/msg, top 3 tools với tokens

**Click vào "Context [mode]"** để cycle qua các chế độ.

### Token Estimation

System / User / History / Tools là **ước tính** vì API chỉ trả về tổng input tokens, không phân tách theo vai trò. 

**Cách tính:**
1. Đếm ký tự trong message parts ÷ 4 ≈ tokens
2. Scale tỉ lệ về đúng tổng thực tế nếu estimate > actual
3. Dùng `Math.round` cho độ chính xác cao

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
