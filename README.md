# PiQPull

Downloads AI conversations into structured format. Claude.ai to begin with.

**Repo:** [Candiman421/PiQPull](https://github.com/Candiman421/PiQPull)
**Part of:** [PiQuix](https://github.com/Candiman421/PiQuixRoot)

---

## What it does

Chrome extension that exports conversations from AI chat providers into JSON, Markdown, Plain Text, or JSONL. Built provider-agnostic — Claude.ai is the first supported provider.

## Features

- Export current conversation or all conversations (ZIP)
- Browse, search, filter, and sort all conversations
- Artifact extraction — nested, flat, or inline
- JSONL format for pipeline integration with PiQuix server
- New/updated tracking with green dot indicators
- Auto-detects Organization ID — no manual setup required
- Dark/light theme with persistence
- PiQ timestamp format: `YYYY.MM.DD-HHmmss`
- Push to PiQuix server at `localhost:7432`

## Module architecture

```
utils.js           Shared globals: timestamp, model inference, branch reconstruction,
                   artifact extraction, all export converters (MD/TXT/JSON/JSONL), download
content.js         Page context: Claude.ai API calls, message relay, export trigger
background.js      Service worker: install injection, server push proxy (avoids CORS)
popup.css/html/js  Extension popup: single export, bulk export, browse launch
options.css/html/js  Settings: org ID override, server push default, connection test
content.css        Minimal reset for any future injected elements
browse.css         Full theme system — CSS custom properties, zero inline styles
browse.html        Semantic markup — no style= attributes
  browse-state.js    All mutable state + chrome.storage CRUD. No UI, no API calls.
  browse-format.js   Pure display functions: model names, dates, badges. No side effects.
  browse-api.js      Claude.ai relay via content script. One job: talk to the tab.
  browse-table.js    Render, sort, checkbox. No export logic, no API calls.
  browse-export.js   ZIP build, single + bulk export, server push. No business state.
  browse.js          Orchestrator: init sequence + event wiring only.
```

## Installation

1. Clone or download this repo
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `chrome/` folder
5. Open any [claude.ai](https://claude.ai) conversation
6. Click the PiQPull icon

Organization ID is auto-detected on first use. No manual configuration needed.

## PiQuix server integration

When **Push to PiQuix** is enabled, exports also POST JSONL to `localhost:7432/export/write`.
Requires `Start-PKScriptsServer.ps1` to be running.

## License

MIT — see LICENSE.md
