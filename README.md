# opencode-sidbar-context-breakdown

OpenCode TUI plugin thay thế `internal:sidebar-context`, hiển thị chi tiết **% thành phần** của context window theo từng vai trò.

## Hiển thị

```
Context
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

| Dòng | Ý nghĩa |
|------|---------|
| `N tokens (X% used)` | Tổng tokens của lần gọi cuối và % so với giới hạn context của model |
| `Input X%` | % input tokens trong tổng |
| `  System X%` | Ước tính % đến từ system prompt |
| `  User X%` | Ước tính % đến từ các user message |
| `  History X%` | Ước tính % đến từ lịch sử assistant message |
| `  Tools X%` | Ước tính % đến từ tool call inputs/outputs |
| `Output X%` | % output tokens (text model sinh ra) |
| `Reasoning X%` | % reasoning/thinking tokens (model hỗ trợ) |
| `Cache read/wrt X%` | % prompt cache tokens |
| `$X.XX spent` | Tổng chi phí của session |

> **Lưu ý:** System / User / History / Tools là **ước tính** vì API chỉ trả về tổng input tokens, không phân tách theo vai trò. Cách tính: đếm ký tự trong message parts ÷ 4 ≈ tokens, sau đó scale tỉ lệ về đúng tổng thực tế. Đây là cùng phương pháp với tab Context trong opencode app chính.

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
