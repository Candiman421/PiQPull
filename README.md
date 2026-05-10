# PiQPull

Chrome extension that downloads Claude.ai conversations into structured format, routed to the PiQuix system. Provider-agnostic by design — Claude.ai first.

**Repo:** [Candiman421/PiQPull](https://github.com/Candiman421/PiQPull)  
**Version:** 1.2.0  
**License:** MIT

---

## What it does

- Exports single conversations or bulk exports all conversations from Claude.ai
- Routes to PiQuix local server (`localhost:7432`) with account/project folder structure
- Extracts artifacts (`create_file` tool outputs + `<antArtifact>` tags) automatically
- Captures image attachments from conversations
- Downloads project home page: name, description, instructions, memory, knowledge files
- Orb export UI with animated progress sphere, character commentary, and shotgun spray

---

## Installation

1. Clone this repo
2. Run `Copy-PiQPullAssets.ps1` to prepare the chrome/ folder (or manually copy)
3. Open Chrome → `chrome://extensions` → Enable Developer mode
4. Click **Load unpacked** → select the `chrome/` folder
5. Ensure PiQuix server is running: `.\PiQScripts\Session\Start-PKScriptsServer.ps1`

---

## Adding characters to the Orb

The orb supports swappable characters via a convention-based folder system.

### Folder structure

```
chrome/characters/
  index.json              ← register character IDs here (ONE LINE per character)
  beavis/
    beavis.png            ← face image (folder name = image name)
    character.json        ← metadata + phrase banks + attribution
  my_character/
    my_character.png
    character.json
```

### To add a character

1. Create `chrome/characters/{id}/`
2. Add `{id}.png` — the face image (see Face Images section below)
3. Add `character.json` — copy the schema from any existing character
4. Add `"{id}"` to `chrome/characters/index.json`
5. Reload the extension — the character appears in the ⚙ config panel

### character.json schema

```jsonc
{
  "id":     "my_character",
  "name":   "Full Name",
  "label":  "Display label in config UI",
  "credit": "Attribution string",
  "colors": ["#rrggbb", "#rrggbb"],   // spray word colors (theme mode)
  "phrases": {
    // All values: string | string[] (random pick)
    // Template tokens: {n} {t} {name} {proj} {msgs} {model} {err} {left} {ok} {pct} {missed}
    "init":         ["Starting {n} conversations{proj}."],
    "fetching":     ["Fetching \"{name}\"..."],
    "hasThink":     ["{n} thinking blocks."],
    "hasArts":      ["{n} artifacts found."],
    "pushing":      ["Pushing \"{name}\"."],
    "pushOk":       ["Saved."],
    "fetchFail":    ["\"{name}\" failed: {err}"],
    "pushFail":     ["\"{name}\" rejected."],
    "retrying":     ["Retry {n} for \"{name}\"."],
    "halfway":      ["{pct}% done."],
    "nearEnd":      ["{left} remaining."],
    "done_all":     ["All {t} complete."],
    "done_partial": ["{ok} of {t} done. {missed} failed."],
    "cancelled":    ["Cancelled."],
    "zipping":      ["Creating ZIP."],
    "zipDone":      ["ZIP ready."],
    "log":          ["Writing session log."]
  },
  "_sources": [
    // Dev-only attribution. Never displayed in UI.
    // Common fields (use what applies):
    {
      "text":        "The original quote text",
      "type":        "song",         // song | album | interview | book | scripture | film | series
      "work":        "Album/Book/Film/Publication name",
      "track":       "Song name",    // if type=song
      "verse":       "John 14:6",    // if type=scripture
      "artist":      "Performer",    // if type=song or album
      "year":        1994,
      "verified":    true
    }
  ]
}
```

---

## Face Images

**Face images are NOT included in this repository.**

Cartoon characters, musician photos, and depictions of real people are subject to copyright and right-of-publicity law. Distributing these images without license would constitute infringement.

### What you can use safely

| Source | Status | Notes |
|--------|--------|-------|
| Your own original artwork | ✅ Safe | Commission an artist or draw your own |
| AI-generated likenesses | ✅ Generally safe | Check your AI tool's terms; avoid training-data disputes |
| Public domain art (pre-1928) | ✅ Safe | Classical paintings, Byzantine icons, etc. |
| Official press kit / promotional images | ⚠️ Risky | Usually "editorial use only" — not for embedding in software |
| Screenshots from TV/film | ❌ Infringement | Copyright held by studio/network |
| Fan-made PNG rips from the web | ❌ Infringement | Copyright held by original owner |
| Paparazzi / celebrity photos | ❌ Infringement | Copyright held by photographer, not the subject |

### Image requirements

- **Format:** PNG preferred (`mix-blend-mode: screen` removes black backgrounds automatically)
- **Size:** 150×200 to 200×250px recommended
- **Background:** Black — screen blend mode makes it transparent on the orb
- **Placement:** SVG left slot clips at `x=52, y=58, w=145, h=185`; right slot at `x=330, y=295, w=115, h=165`

### For personal private use only

If the extension never leaves your machine and is not distributed, fair use arguments for personal parody/commentary use are stronger — but not guaranteed. Consult a lawyer if you're unsure. The safest path is always original artwork.

---

## Orb config

Click the ⚙ icon on the orb during export to:
- Swap characters into left/right slots
- Toggle spray color mode: 🌈 Psychedelic (HSL rotation) or 🎨 Character theme
- Adjust spray speed: 🐢 0.4× (slow) to 🚀 2.5× (rapid)

---

## Folder structure (exported conversations)

```
PiQuixRootDownloads/incoming/PiQPull/
  {accountSlug}/                    ← set in Options → Account Names
    {projectSlug}/                  ← Claude.ai project name, slugified
      project.json                  ← project home page (name, description, files)
      {chatSlug}/
        chat_{timestamp}.json       ← full export payload (accumulates on re-export)
        ArtifactName.md             ← extracted artifacts, flat in chat folder
        img_001_{timestamp}.png     ← extracted images, flat in chat folder
    session_log_{project}_{ts}.txt  ← written after each bulk export
```

---

## Server endpoints required (Start-PKScriptsServer.ps1 v29+)

| Endpoint | Purpose |
|----------|---------|
| `POST /export/incoming` | Structured conversation + artifacts + images |
| `POST /export/project-home` | Project metadata + knowledge files |
| `POST /export/session-log` | Bulk session log |
| `POST /export/write` | Legacy JSONL push |
| `GET  /api/projects` | PiQuix project list for routing picker |

See `SERVER-PATCH.md` in the repo for the PowerShell implementation.

---

## Account names

Configure in the extension Options page (⋮ → Options or right-click extension icon).  
Settings → Account Names maps your org ID to a human-readable folder name like `CandisMan` or `penelope`.

Falls back to email prefix (`jcturpin8069`) if no alias is set.

---

## Source credit

PiQPull was written from scratch with reference to the API surface of [agoramachinia/claude-exporter](https://github.com/agoramachinia/claude-exporter) (MIT). Code is an independent rewrite under MIT license.

---

*PiQuix · PiQPull — Part of the PiQuix knowledge system*
