---
title: Chrome Web Store Description — TestScribe
date: 2026-04-06
status: approved
---

# Chrome Web Store Description

## Context

- **Audience:** QA Engineers, Business Analysts, Product Owners, Product Managers
- **Approach:** Problem → Solution → Features → Installation → Setup → Troubleshooting
- **Status:** Pre-publication — extension not yet listed on the Chrome Web Store; all installation is via Developer Mode

---

## Note on Chrome Web Store Formatting

The Chrome Web Store description field is **plain text only**. Markdown (bold, tables, code blocks) will not render. The formatted section below is the design reference. A plain-text version ready to paste into the store is included at the end of this document.

---

## Short Description (132 chars max)

> AI-powered test case generator for JIRA. Turn ticket descriptions into Gherkin or Manual test cases in one click.

---

## Full Description

Writing test cases from JIRA tickets by hand is slow, repetitive, and inconsistent — especially under sprint pressure. TestScribe reads your ticket, thinks like a tester, and generates ready-to-use Gherkin (Cucumber) or Manual test cases in seconds. Works directly inside Chrome on any JIRA Cloud instance.

---

### What TestScribe does

- Opens on any JIRA ticket — extracts the title and description automatically
- Generates Cucumber (Gherkin) BDD scenarios: Feature / Scenario / Given / When / Then
- Generates Manual test cases: step tables with Action / Data / Expected Result columns
- Edit, copy, or push each test directly to JIRA as a linked task
- Import tests straight into Xray Cloud with one click
- Switch between AI backends without leaving the popup

### Two AI backends — your choice

- **Ollama (local, recommended)** — runs entirely on your machine, no data leaves your network, no API costs
- **Google Gemini (cloud)** — no local setup, uses your Gemini API key

---

### Installation (Developer Mode)

TestScribe is not yet listed in the Chrome Web Store. Install it manually in a few steps:

1. Download or clone the repository: https://github.com/pdaszko/TestScribe
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer Mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the repository folder

The TestScribe icon will appear in your Chrome toolbar.

---

### Required: Fix Ollama CORS (Ollama users only)

Chrome extensions send requests with a special `Origin` header that Ollama blocks by default, returning a 403 error. You must allow it once before TestScribe can reach your local Ollama instance.

**macOS:**
```
launchctl setenv OLLAMA_ORIGINS "*"
```
Then quit and restart Ollama from the menu bar.

**Linux (systemd):**
```
sudo systemctl edit ollama.service
```
Add inside the file:
```
[Service]
Environment="OLLAMA_ORIGINS=*"
```
Then run: `sudo systemctl daemon-reload && sudo systemctl restart ollama`

**Windows (PowerShell):**
```
[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
```
Then quit and restart Ollama from the system tray.

---

### Setup: Ollama (Local AI — Recommended)

1. Download and install Ollama from ollama.com
2. Pull the recommended model:
   ```
   ollama pull qwen2.5-coder
   ```
   *(Optimised for structured output — produces better Gherkin and test tables than general-purpose models)*
3. Click the TestScribe icon → **Settings**
4. Select **Ollama (Local)**, set host URL (default: `http://localhost:11434`)
5. Click **Refresh** next to the Model dropdown → select `qwen2.5-coder` → **Save**

---

### Setup: Gemini (Cloud AI)

1. Get a free API key at aistudio.google.com/app/apikey
2. Click the TestScribe icon → **Settings**
3. Select **Gemini (Cloud)**, paste your API key → **Save**

TestScribe automatically selects the best available Gemini Flash model.

---

### Setup: Xray Integration (Optional)

1. In JIRA: go to **Apps → Xray → API Keys**, create a key pair, copy Client ID + Secret
2. Click the TestScribe icon → **Settings → Xray Integration**
3. Enter your credentials → **Test** to verify → **Save**

---

### Troubleshooting

| Problem | Fix |
|---|---|
| 403 Forbidden from Ollama | Set `OLLAMA_ORIGINS=*` — see CORS section above |
| Ollama unreachable | Start Ollama; check the host URL in Settings matches your port |
| No models found | Run `ollama pull qwen2.5-coder` |
| Gemini API Key missing | Settings → Gemini tab → paste key → Save |
| Popup opens but no JIRA data | Navigate to a ticket URL (`/browse/PROJ-123`) first |
| Tests not appearing | Right-click the popup → Inspect → check Console for errors |

---

### Source code & full documentation

https://github.com/pdaszko/TestScribe

---

## Plain-Text Version (paste into Chrome Web Store)

AI-powered test case generator for JIRA. Turn ticket descriptions into Gherkin or Manual test cases in one click.

Writing test cases from JIRA tickets by hand is slow, repetitive, and inconsistent — especially under sprint pressure. TestScribe reads your ticket, thinks like a tester, and generates ready-to-use Gherkin (Cucumber) or Manual test cases in seconds. Works directly inside Chrome on any JIRA Cloud instance.


WHAT TESTSCRIBE DOES

- Opens on any JIRA ticket — extracts the title and description automatically
- Generates Cucumber (Gherkin) BDD scenarios: Feature / Scenario / Given / When / Then
- Generates Manual test cases: step tables with Action / Data / Expected Result columns
- Edit, copy, or push each test directly to JIRA as a linked task
- Import tests straight into Xray Cloud with one click
- Switch between AI backends without leaving the popup

TWO AI BACKENDS — YOUR CHOICE

Ollama (local, recommended) — runs entirely on your machine, no data leaves your network, no API costs
Google Gemini (cloud) — no local setup, uses your Gemini API key


INSTALLATION (DEVELOPER MODE)

TestScribe is not yet listed in the Chrome Web Store. Install it manually:

1. Download or clone the repository: https://github.com/pdaszko/TestScribe
2. Open Chrome and go to chrome://extensions/
3. Enable Developer Mode (toggle in the top-right corner)
4. Click Load unpacked
5. Select the repository folder

The TestScribe icon will appear in your Chrome toolbar.


REQUIRED: FIX OLLAMA CORS (Ollama users only)

Chrome extensions send requests with a special Origin header that Ollama blocks by default, returning a 403 error. Run the command for your OS once, then restart Ollama.

macOS:
  launchctl setenv OLLAMA_ORIGINS "*"
Then quit and restart Ollama from the menu bar.

Linux (systemd):
  sudo systemctl edit ollama.service
Add inside the file:
  [Service]
  Environment="OLLAMA_ORIGINS=*"
Then run: sudo systemctl daemon-reload && sudo systemctl restart ollama

Windows (PowerShell):
  [System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
Then quit and restart Ollama from the system tray.


SETUP: OLLAMA (LOCAL AI — RECOMMENDED)

1. Download and install Ollama from ollama.com
2. Pull the recommended model: ollama pull qwen2.5-coder
   (Optimised for structured output — produces better Gherkin and test tables than general-purpose models)
3. Click the TestScribe icon > Settings
4. Select Ollama (Local), set host URL (default: http://localhost:11434)
5. Click Refresh next to the Model dropdown, select qwen2.5-coder, then Save


SETUP: GEMINI (CLOUD AI)

1. Get a free API key at aistudio.google.com/app/apikey
2. Click the TestScribe icon > Settings
3. Select Gemini (Cloud), paste your API key, then Save

TestScribe automatically selects the best available Gemini Flash model.


SETUP: XRAY INTEGRATION (OPTIONAL)

1. In JIRA: go to Apps > Xray > API Keys, create a key pair, copy Client ID and Secret
2. Click the TestScribe icon > Settings > Xray Integration
3. Enter your credentials, click Test to verify, then Save


TROUBLESHOOTING

403 Forbidden from Ollama — Set OLLAMA_ORIGINS=* (see CORS section above)
Ollama unreachable — Start Ollama; check the host URL in Settings matches your port
No models found — Run: ollama pull qwen2.5-coder
Gemini API Key missing — Settings > Gemini tab > paste key > Save
Popup opens but no JIRA data — Navigate to a ticket URL (/browse/PROJ-123) first
Tests not appearing — Right-click the popup > Inspect > check Console for errors


SOURCE CODE & FULL DOCUMENTATION

https://github.com/pdaszko/TestScribe
