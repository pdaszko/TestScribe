# TestScribe Chrome Extension

## What This Is

A Chrome extension (Manifest v3) that integrates JIRA, Ollama/Gemini, and Xray to auto-generate test cases from JIRA ticket descriptions. No build step — pure vanilla JavaScript.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension config — permissions, content scripts, service worker |
| `background.js` | Service worker — LLM calls (Ollama/Gemini), JIRA issue creation, Xray import |
| `content.js` | Injected into JIRA pages — extracts issue key, summary, description |
| `popup.js` | Popup UI — renders test cards, Gherkin highlighting, triggers generation |
| `popup.html/css` | Popup layout and styles |
| `options.js/html/css` | Settings page — LLM agent config, Xray credentials |

## Architecture

Message passing between components:

```
JIRA page (content.js) ←→ background.js ←→ popup.js
                                ↓
                         Ollama / Gemini / JIRA API / Xray API
```

- Popup → Background: `chrome.runtime.sendMessage()` for LLM and JIRA/Xray calls
- Background → Content: `chrome.tabs.sendMessage()` for JIRA data extraction
- Storage: Chrome Storage Sync for settings, Local for session data (JIRA issue, tab IDs)

## Tech Stack

- **Language**: Vanilla ES6+ JavaScript — no TypeScript, no bundler, no npm
- **No dependencies**: Only browser APIs + Chrome Extension APIs
- **Storage**: `chrome.storage.sync` (settings) and `chrome.storage.local` (session)

## How to Load / Debug

**Load unpacked:**
1. Go to `chrome://extensions/`
2. Enable Developer Mode
3. Click "Load unpacked" → select this `extension/` directory

**Debug surfaces:**
- Popup: Right-click popup → Inspect
- Background service worker: `chrome://extensions/` → Details → Inspect service worker
- Content script: Inspect the JIRA page tab → Console

## Two Test Generation Modes

1. **Cucumber (Gherkin)** — BDD-style Feature/Scenario/Given/When/Then
2. **Manual** — Step table with Action/Data/Result columns (Markdown format)

## Two LLM Backends

- **Ollama** (local): `POST {host}/api/generate` — default `http://localhost:11434`
- **Gemini** (cloud): Fetches available models dynamically, prefers newest Flash model

## Two Test Creation Paths

- **Standard JIRA**: Creates Task issue via REST API, links to original ticket
- **Xray Cloud**: Authenticates with Client ID/Secret, imports via bulk import API (polls job status)

## Conventions

- Section headers: `/* ===== SECTION NAME ===== */`
- All network calls are `async/await`
- Gherkin parsing and syntax highlighting done with regex in `popup.js`
- Card-based UI built dynamically via DOM manipulation (no framework)
- Error handling: try/catch with red inline status messages, button state management
- JIRA selectors use `data-testid` attributes (brittle if Atlassian changes DOM)
- Storage: `chrome.storage.sync` for settings (`host`, `geminiKey`, `geminiModel`, `defaultAgent`, `ollamaModel`, `clientId`, `clientSecret`), `chrome.storage.local` for session data (jiraData, jiraTabId)
- `GEMINI_PAID_MODELS` constant is intentionally duplicated across `background.js`, `options.js`, and `popup.js` — there is no module system available in this extension, so sharing constants requires duplication. Keep all three in sync when updating the list.

## Do Not

- Do not add a bundler or build step unless explicitly requested
- Do not introduce npm packages or a `package.json`
- Do not convert to TypeScript unless explicitly requested
- Do not use `document.write` or `innerHTML` for user-controlled content (XSS risk)
- Do not store API keys in `manifest.json` or source code — use `chrome.storage.sync`
- Do not use or restart the `ollama-wrapper/` — the extension calls Ollama's native API directly

## Configuration Requirements (for local testing)

- Ollama running locally at `http://localhost:11434` (default). Custom host configurable via Settings. Extension calls `/api/tags` (model list) and `/api/generate` (inference) directly — no wrapper needed.
- Gemini: API key from https://aistudio.google.com/app/apikey
- Xray: Client ID + Secret from Xray Cloud settings
