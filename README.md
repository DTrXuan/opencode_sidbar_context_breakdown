# opencode-sidbar-context-breakdown

OpenCode TUI plugin that replaces the built-in `internal:sidebar-context` and adds a detailed **percentage breakdown** of how the context window is composed.

## What it shows

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

- **Input %** — share of total tokens that are input tokens
  - **System** — estimated % from the system prompt
  - **User** — estimated % from user messages
  - **History** — estimated % from prior assistant messages
  - **Tools** — estimated % from tool call inputs/outputs
- **Output %** — share from model-generated text
- **Reasoning %** — share from reasoning/thinking tokens (models that support it)
- **Cache read/write %** — share from prompt cache

> **Note:** System/User/History/Tool numbers are *estimates* (chars ÷ 4 ≈ tokens) because the API only returns aggregate input token counts. This is the same approach used by opencode's built-in context tab.

## Installation

```bash
# install from npm
bun add opencode-sidbar-context-breakdown   # or npm / pnpm

# then add to your opencode config  (~/.config/opencode/config.json)
{
  "plugins": ["opencode-sidbar-context-breakdown"]
}
```

Or point directly at the built file:

```json
{
  "plugins": ["/path/to/dist/index.js"]
}
```

## Development

```bash
bun install
bun build ./src/index.tsx --outdir dist --target bun \
  --external "@opencode-ai/plugin" \
  --external "@opencode-ai/sdk" \
  --external "solid-js" \
  --external "@opentui/core" \
  --external "@opentui/solid"
```

With mise:

```bash
mise run build   # one-shot build
mise run dev     # watch mode
mise run link    # symlink dist/index.js into ~/.config/opencode/plugin/
```

## License

MIT
