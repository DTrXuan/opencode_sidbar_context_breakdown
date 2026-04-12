# CLAUDE.md

## Project

OpenCode TUI plugin hiển thị % thành phần context window theo vai trò (system/user/history/tool).

**Source duy nhất:** `src/index.tsx`  
**Plugin ID:** `opencode-sidbar-context-breakdown`  
**Thay thế:** `internal:sidebar-context` (disabled qua `tui.json`)

## Build & Deploy

```bash
# Type check
bun tsc --noEmit

# Sync lên opencode (không cần build — Bun tự transpile .tsx khi load)
mise run sync
# hoặc thủ công:
cp src/index.tsx ~/.config/opencode/node_modules/opencode-sidbar-context-breakdown/src/index.tsx
```

Sau khi sync: **restart opencode** để áp dụng thay đổi.

## Kiến trúc quan trọng

### Tại sao dùng .tsx thay vì build ra .js?

Opencode là **Bun standalone executable**. Khi load plugin từ path ngoài `~/.config/opencode/node_modules/`:
- Bun tải `@opentui/core-win32-x64` (native `.node` file) lần 2
- Native module đã được load bởi opencode → **segmentation fault, RSS ~1.1GB**

Giải pháp: đặt `.tsx` vào `~/.config/opencode/node_modules/opencode-sidbar-context-breakdown/src/` — không có `node_modules` riêng → dùng chung `@opentui/core`, `@opentui/solid`, `solid-js` với opencode.

### JSX pragma

```tsx
/** @jsxImportSource @opentui/solid */
```

Dòng này ở đầu file bắt buộc. Bun đọc pragma này khi transpile `.tsx` on-the-fly, resolve `@opentui/solid` từ `~/.config/opencode/node_modules/`. Không cần cấu hình `tsconfig.json` cho JSX khi deploy.

### Plugin loading flow

```
tui.json plugin[] → resolvePathPluginTarget() → dynamic import(.tsx)
                                                     ↓
                                          Bun transpile JSX (pragma)
                                                     ↓
                                          module.default.tui(api) 
                                                     ↓
                                          api.slots.register(sidebar_content)
```

Nếu dùng bare package name (`"opencode-sidbar-context-breakdown"`), opencode gọi `Npm.add()` → tìm trên npmjs.org → **không tìm thấy vì chưa publish**.

## Config opencode (`~/.config/opencode/tui.json`)

```json
{
  "plugin": [
    "C:/Users/Admin/.config/opencode/node_modules/opencode-sidbar-context-breakdown/src/index.tsx"
  ],
  "plugin_enabled": {
    "internal:sidebar-context": false
  }
}
```

## Token estimation logic

API chỉ trả về `tokens.input` (tổng), không phân tách theo vai trò. Plugin ước tính:

1. Đếm ký tự trong `Part[]` của mỗi message qua `api.state.part(messageID)`
2. Chia cho 4 (chars-per-token approximation)
3. Nếu `estTotal > tokens.input` thực tế → scale down tỉ lệ

Cùng phương pháp với `packages/app/src/components/session/session-context-breakdown.ts` trong opencode-build.

## Cấu trúc file

```
src/index.tsx          ← toàn bộ logic plugin (View component + registration)
package.json           ← exports trỏ vào src/index.tsx; dependencies: @opentui/* + solid-js
tsconfig.json          ← chỉ dùng cho type check local, không ảnh hưởng deploy
.mise/tasks/sync       ← copy src/ + package.json vào opencode node_modules
.mise/tasks/build      ← bun build (kiểm tra bundling, không dùng để deploy)
```

## Lưu ý khi phát triển

- **Không cần rebuild** sau mỗi thay đổi — chỉ cần `mise run sync` rồi restart opencode
- **QUAN TRỌNG: Phải restart OpenCode** sau khi sync để load .tsx mới. Nếu không restart, plugin sẽ chạy code cũ và có thể bị lỗi hoặc không thấy thay đổi.
- **Không thêm node_modules** vào thư mục `~/.config/opencode/node_modules/opencode-sidbar-context-breakdown/` — dependencies phải resolve từ thư mục cha
- **Type errors** với `(part as any)` là chủ ý — `Part` union type không expose hết các trường runtime của từng variant
- **`plugin_enabled`** trong `tui.json` được merge với KV store runtime của opencode — nếu user đã toggle plugin qua UI, KV store override config file

## OpenTUI Event Handlers

**QUAN TRỌNG:** OpenTUI Box components không hỗ trợ `on:click` directive của Solid.js.

### Sự khác biệt với Solid.js

OpenTUI Box không extend EventEmitter, nên không thể dùng `on:` directive cho custom events. Thay vào đó, dùng property-based mouse handlers:

```tsx
// ❌ KHÔNG hoạt động
<box on:click={handler}>

// ✅ Đúng cách
<box onMouseDown={handler}>
```

### Mouse Event Handlers

- `onMouseDown` - click-like interactions
- `onMouseUp` - mouse release
- `onMouseMove` - mouse movement
- `onMouseEnter` / `onMouseLeave` - hover states

### Yêu cầu

Mouse events phải được enable trong `tui.json`:

```json
{
  "mouse": true
}
```

## Troubleshooting

### Plugin không hoạt động sau khi sync

**Triệu chứng:** Sau khi chạy `mise run sync`, plugin vẫn hiển thị UI cũ hoặc tính năng mới không hoạt động.

**Nguyên nhân:** OpenCode đã load .tsx vào memory khi khởi động. File mới đã được copy nhưng chưa được load lại.

**Giải pháp:** Restart OpenCode hoàn toàn (thoát và mở lại). Hot-reload không được hỗ trợ cho plugins.

### Click events không hoạt động

**Triệu chứng:** `on:click={handler}` không trigger khi click vào Box component.

**Nguyên nhân:** OpenTUI Box không hỗ trợ EventEmitter-based events. Box chỉ hỗ trợ property-based mouse handlers.

**Giải pháp:** Dùng `onMouseDown={handler}` thay vì `on:click={handler}`. Đảm bảo `"mouse": true` trong tui.json.
