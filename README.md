# TestScribe

A Chrome extension that generates Gherkin (Cucumber) and Manual test cases from JIRA ticket descriptions using AI — either a local Ollama model or Google Gemini. Generated tests can be pushed directly to JIRA or imported into Xray Cloud.

---

## Requirements

- Google Chrome (or Chromium-based browser)
- A JIRA Cloud instance (`*.atlassian.net`)
- One of the following AI backends:
  - **Ollama** (local, free) — recommended
  - **Google Gemini** (cloud, requires API key)
- *(Optional)* Xray Cloud account for direct test import

---

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder from this repository

The TestScribe icon will appear in your Chrome toolbar.

---

## Setup: Ollama (Local AI — Recommended)

Ollama runs entirely on your machine. No API key, no data sent to the cloud.

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and install it for your OS.

### 2. Pull the recommended model

```bash
ollama pull qwen2.5-coder
```

> **Why `qwen2.5-coder`?** It is optimised for structured code and specification output, which produces better Gherkin and manual test tables than general-purpose models.

### 3. Fix CORS — required for Chrome extensions

Chrome extensions send requests with an `Origin: chrome-extension://...` header. Ollama blocks these by default and returns **403 Forbidden**. You must allow extension origins before TestScribe can reach Ollama.

#### macOS

```bash
launchctl setenv OLLAMA_ORIGINS "*"
```

Then restart Ollama from the menu bar icon (click the Ollama icon → Quit, then reopen).

#### Linux (systemd)

```bash
sudo systemctl edit ollama.service
```

Add the following inside the file that opens:

```ini
[Service]
Environment="OLLAMA_ORIGINS=*"
```

Save, then restart the service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

#### Windows

Open PowerShell and run:

```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
```

Then restart Ollama from the system tray (right-click → Quit, then reopen).

Alternatively, set it via the GUI: **System Properties → Environment Variables → New User variable**
- Name: `OLLAMA_ORIGINS`
- Value: `*`

Restart Ollama after saving.

### 4. Configure TestScribe

1. Click the TestScribe icon → **Settings**
2. Select **Ollama (Local)**
3. Set the host URL (default: `http://localhost:11434` — leave as-is unless you changed Ollama's port)
4. Click **Refresh** next to the Model dropdown — your installed models will appear
5. Select `qwen2.5-coder` (or whichever model you pulled)
6. Click **Save Agent Settings**

---

## Setup: Gemini (Cloud AI)

### 1. Get an API key

Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and create a key.

### 2. Configure TestScribe

1. Click the TestScribe icon → **Settings**
2. Select **Gemini (Cloud)**
3. Paste your API key
4. Click **Save Agent Settings**

TestScribe automatically selects the best available Gemini Flash model.

---

## Setup: Groq (Cloud AI — Free Tier Available)

Groq provides extremely fast cloud inference for Llama 3, DeepSeek, and Mixtral models.

### 1. Get a Groq API Key

Go to [console.groq.com/keys](https://console.groq.com/keys) and create a free API Key.

### 2. Configure TestScribe

1. Click the TestScribe icon → **Settings**
2. Select **Groq (Cloud)**
3. Paste your API key
4. Click **Refresh** to load available models and select one (e.g., `llama-3.3-70b-specdec` or `llama3-8b-8192`)
5. Click **Save Agent Settings**

---

## Setup: Custom OpenAI-Compatible (Local/Cloud AI)

Connect to any service hosting models that mirror the standard OpenAI API structure (such as LM Studio, DeepSeek API, or OpenRouter).

### 1. Configure TestScribe

1. Click the TestScribe icon → **Settings**
2. Select **Custom OpenAI**
3. Configure your endpoint details:
   - **Custom Endpoint Host URL**: e.g., `http://localhost:1234/v1` for LM Studio, or `https://api.deepseek.com/v1` for DeepSeek.
   - **API Key (Optional)**: Paste your key if required by the custom host.
   - **Model**: Click **Refresh** to fetch and select models from the host's `/models` API.
4. Click **Save Agent Settings**

---

## Setup: Xray Integration (Optional)

If you use Xray Cloud for test management, TestScribe can import tests directly.

### 1. Get Xray API credentials

In your JIRA instance, go to:
**Apps → Xray → API Keys** (or use the Settings link inside TestScribe)

Create an API key pair and copy the **Client ID** and **Client Secret**.

### 2. Configure TestScribe

1. Click the TestScribe icon → **Settings → Xray Integration**
2. Enter your **Client ID** and **Client Secret**
3. Click **Test** to verify the connection
4. Click **Save**

---

## Usage

1. Open a JIRA ticket in Chrome (`https://yourcompany.atlassian.net/browse/PROJ-123`)
2. Click the **TestScribe** icon in the toolbar
3. Review the pre-built prompt (you can edit it)
4. Click **Generate Test Cases** (Cucumber) or **Generate Manual Cases**
5. For each generated test you can:
   - **Copy** — paste it anywhere
   - **Edit** — modify directly in the card
   - **Create Test** — creates a linked JIRA task
   - **Create Xray Test** — imports directly into Xray Cloud

---

## Review & Merge (Step Consistency)

TestScribe helps teams maintain consistent Gherkin phrasing across their test suite.

### 1. Syncing the Step Library
To use step consistency, go to **Settings ➔ Integration** and click **Sync Steps Library**. 
* **Under the Hood**: TestScribe queries the Xray Cloud GraphQL API for all tickets of type `Test` in your selected projects. It filters specifically for Cucumber (Gherkin) test issues, parses their scenario definition lines into individual steps, and stores them in the extension's local storage. Manual test types are ignored.

### 2. How Suggestions Work
Once synced, TestScribe leverages this local dictionary in two ways:
* **Prompt Injection**: During initial generation, the extension finds existing steps similar to your active ticket and appends them to the system prompt, encouraging the AI to reuse matching phrasing.
* **Fuzzy Step Matcher**: On the **Review & Merge** dashboard, TestScribe runs a Jaccard set-similarity calculation on word tokens (ignoring keywords like `Given` / `When` / `Then`) to compare your generated steps against the library:
  $$\text{Similarity} = \frac{|A \cap B|}{|A \cup B|}$$
  Matches are highlighted: **Green** for high similarity ($\ge 80\%$) and **Yellow** for medium similarity ($\ge 50\%$).
* **Step Autocomplete**: Inside the merge step editors, start typing any word to see autocomplete suggestions recommending existing library steps.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 Forbidden` | Ollama CORS not configured | Set `OLLAMA_ORIGINS=*` — see [Fix CORS](#3-fix-cors--required-for-chrome-extensions) above |
| `Ollama unreachable` | Ollama is not running or wrong host | Start Ollama; check the host URL in Settings matches your Ollama port |
| `No models found` | No models pulled yet | Run `ollama pull qwen2.5-coder` |
| `Gemini API Key missing` | Key not saved in Settings | Open Settings → Gemini tab → paste key → Save |
| Popup opens but no JIRA data | Not on a JIRA browse page | Navigate to a ticket URL (`/browse/PROJ-123`) first |
| Tests not appearing | Generation failed silently | Open the popup's DevTools console (right-click popup → Inspect) for details |

---

## Documentation & Releases

- **[Feature Changelog](docs/changelog.md)** — Detailed list of all features, enhancements, and bug fixes added since the initial release.
