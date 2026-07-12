# Context Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the LLM prompt with parent ticket content and linked Confluence pages so generated test steps use consistent domain terminology.

**Architecture:** A two-phase fetch (metadata → titles; content → full text) handled by two new `background.js` message handlers. `popup.js` renders a context panel (checkboxes + button) between the ticket title and prompt editor, then appends an `<additional_context>` block to both prompts before generation. Three new `chrome.storage.sync` keys control panel visibility and defaults.

**Tech Stack:** Vanilla ES6+, Chrome Extension APIs (storage.sync, runtime.sendMessage), JIRA REST v3, Confluence REST v1

---

## File Map

| File | What changes |
|---|---|
| `background.js` | Add `FETCH_CONTEXT_METADATA` and `FETCH_CONTEXT_CONTENT` handlers + helper functions |
| `popup.js` | Add context panel render + "Load extra context" click logic + prompt injection |
| `popup.html` | Add context panel `<div>` in both tabs (cucumber and manual) |
| `options.js` | Load/save three new storage keys; wire checkbox for panel-hidden toggle |
| `options.html` | Add "Context Enrichment" section at bottom of settings page |

---

## Task 1: Add `FETCH_CONTEXT_METADATA` handler in `background.js`

**Files:**
- Modify: `background.js` (after the `UPDATE_TEST_STEPS` handler block, before the closing `}`  of the `onMessage.addListener` callback, and add helper functions after the listener)

- [ ] **Step 1: Register the message handler**

In `background.js`, inside `chrome.runtime.onMessage.addListener`, after the `UPDATE_TEST_STEPS` block (line ~50) and before the `GENERATE_TESTS` block, add:

```javascript
  if (message.type === "FETCH_CONTEXT_METADATA") {
    handleFetchContextMetadata(message).then(sendResponse);
    return true;
  }

  if (message.type === "FETCH_CONTEXT_CONTENT") {
    handleFetchContextContent(message).then(sendResponse);
    return true;
  }
```

- [ ] **Step 2: Add `extractConfluenceUrls` helper after all existing handler functions**

At the very end of `background.js` add:

```javascript
/* ===== CONTEXT ENRICHMENT ===== */

function extractConfluenceUrls(text) {
  if (!text) return [];
  const regex = /https?:\/\/[^/]+\.atlassian\.net\/wiki\/[^\s"')]+/g;
  return [...new Set(text.match(regex) || [])];
}

function extractPageIdFromUrl(url) {
  const pagesMatch = url.match(/\/pages\/(\d+)/);
  if (pagesMatch) return pagesMatch[1];
  const viewMatch = url.match(/[?&]pageId=(\d+)/);
  if (viewMatch) return viewMatch[1];
  return null;
}
```

- [ ] **Step 3: Add `handleFetchContextMetadata` function**

Directly after the helpers above, add:

```javascript
async function handleFetchContextMetadata(message) {
  const { issueKey, issueDescription, jiraTabId } = message;

  try {
    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = new URL(tab.url).origin;

    // Fetch parent key + summary (and description fallback)
    const issueRes = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}?fields=parent,summary,description`,
      { credentials: "include" }
    );
    if (!issueRes.ok) throw new Error(`Issue fetch failed: ${issueRes.status}`);
    const issueData = await issueRes.json();

    const parent = issueData.fields?.parent
      ? { key: issueData.fields.parent.key, summary: issueData.fields.parent.fields?.summary || "" }
      : null;

    const ticketDesc = issueDescription || issueData.fields?.description?.content
      ?.map(n => n.content?.map(c => c.text || "").join("") || "").join("\n") || "";

    // Collect all Confluence URLs
    const urlSet = new Set(extractConfluenceUrls(ticketDesc));

    // Fetch ticket comments
    const commentsRes = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/comment`,
      { credentials: "include" }
    );
    if (commentsRes.ok) {
      const commentsData = await commentsRes.json();
      (commentsData.comments || []).forEach(c => {
        const body = c.body?.content?.map(n => n.content?.map(x => x.text || "").join("")).join("\n") || "";
        extractConfluenceUrls(body).forEach(u => urlSet.add(u));
      });
    }

    // Fetch ticket remote links
    const remoteRes = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/remotelink`,
      { credentials: "include" }
    );
    if (remoteRes.ok) {
      const remoteData = await remoteRes.json();
      (remoteData || []).forEach(r => {
        if (r.object?.url) extractConfluenceUrls(r.object.url).forEach(u => urlSet.add(u));
      });
    }

    // If parent exists, fetch its description, comments, remote links
    let parentDesc = "";
    if (parent) {
      const parentRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${parent.key}?fields=summary,description`,
        { credentials: "include" }
      );
      if (parentRes.ok) {
        const parentData = await parentRes.json();
        parent.summary = parentData.fields?.summary || parent.summary;
        parentDesc = parentData.fields?.description?.content
          ?.map(n => n.content?.map(c => c.text || "").join("") || "").join("\n") || "";
        extractConfluenceUrls(parentDesc).forEach(u => urlSet.add(u));
      }

      const parentCommentsRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${parent.key}/comment`,
        { credentials: "include" }
      );
      if (parentCommentsRes.ok) {
        const parentCommentsData = await parentCommentsRes.json();
        (parentCommentsData.comments || []).forEach(c => {
          const body = c.body?.content?.map(n => n.content?.map(x => x.text || "").join("")).join("\n") || "";
          extractConfluenceUrls(body).forEach(u => urlSet.add(u));
        });
      }

      const parentRemoteRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${parent.key}/remotelink`,
        { credentials: "include" }
      );
      if (parentRemoteRes.ok) {
        const parentRemoteData = await parentRemoteRes.json();
        (parentRemoteData || []).forEach(r => {
          if (r.object?.url) extractConfluenceUrls(r.object.url).forEach(u => urlSet.add(u));
        });
      }
    }

    // Resolve Confluence page titles
    const confluencePages = [];
    const pageIdsSeen = new Set();
    for (const url of urlSet) {
      const pageId = extractPageIdFromUrl(url);
      if (!pageId || pageIdsSeen.has(pageId)) continue;
      pageIdsSeen.add(pageId);
      try {
        const pageRes = await fetch(
          `${baseUrl}/wiki/rest/api/content/${pageId}`,
          { credentials: "include" }
        );
        if (pageRes.ok) {
          const pageData = await pageRes.json();
          confluencePages.push({ pageId, title: pageData.title || pageId, url });
        }
      } catch {
        // Skip unreachable pages silently during metadata phase
      }
    }

    return { success: true, parent, confluencePages };
  } catch (err) {
    console.error("FETCH_CONTEXT_METADATA failed:", err);
    return { success: false, parent: null, confluencePages: [] };
  }
}
```

- [ ] **Step 4: Add `handleFetchContextContent` function**

Directly after `handleFetchContextMetadata`, add:

```javascript
async function handleFetchContextContent(message) {
  const { issueKey, jiraTabId, includeParent, confluencePageIds } = message;

  try {
    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = new URL(tab.url).origin;

    let parent = null;
    if (includeParent) {
      // Re-fetch parent key from issue
      const issueRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${issueKey}?fields=parent,summary`,
        { credentials: "include" }
      );
      if (issueRes.ok) {
        const issueData = await issueRes.json();
        const parentKey = issueData.fields?.parent?.key;
        if (parentKey) {
          const [parentIssueRes, parentCommentsRes] = await Promise.all([
            fetch(`${baseUrl}/rest/api/3/issue/${parentKey}?fields=summary,description`, { credentials: "include" }),
            fetch(`${baseUrl}/rest/api/3/issue/${parentKey}/comment`, { credentials: "include" }),
          ]);

          const parentData = parentIssueRes.ok ? await parentIssueRes.json() : null;
          const commentsData = parentCommentsRes.ok ? await parentCommentsRes.json() : null;

          const description = parentData?.fields?.description?.content
            ?.map(n => n.content?.map(c => c.text || "").join("") || "").join("\n") || "";

          const comments = (commentsData?.comments || [])
            .map(c => c.body?.content?.map(n => n.content?.map(x => x.text || "").join("")).join("\n") || "")
            .filter(Boolean)
            .join("\n\n");

          parent = {
            key: parentKey,
            summary: parentData?.fields?.summary || parentKey,
            description,
            comments,
          };
        }
      }
    }

    const confluencePages = [];
    const errors = [];
    let allDenied = confluencePageIds.length > 0;

    for (const pageId of (confluencePageIds || [])) {
      try {
        const res = await fetch(
          `${baseUrl}/wiki/rest/api/content/${pageId}?expand=body.view`,
          { credentials: "include" }
        );
        if (res.status === 401 || res.status === 403) {
          errors.push({ pageId, error: String(res.status) });
          continue;
        }
        if (!res.ok) {
          allDenied = false;
          errors.push({ pageId, error: String(res.status) });
          continue;
        }
        allDenied = false;
        const data = await res.json();
        const title = data.title || pageId;
        const rawHtml = data.body?.view?.value || "";
        const plain = rawHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const words = plain.split(" ");
        const truncated = words.length > 3000;
        const content = (truncated ? words.slice(0, 3000).join(" ") + " (content truncated)" : plain);
        confluencePages.push({ pageId, title, content });
      } catch (err) {
        allDenied = false;
        errors.push({ pageId, error: err.message });
      }
    }

    return {
      success: true,
      parent,
      confluencePages,
      errors,
      confluenceAccessDenied: confluencePageIds.length > 0 && allDenied,
    };
  } catch (err) {
    console.error("FETCH_CONTEXT_CONTENT failed:", err);
    return { success: false, error: err.message };
  }
}
```

- [ ] **Step 5: Manual smoke-test**

Load the extension at `chrome://extensions` → Details → Inspect service worker. Verify no syntax errors in console on extension load.

---

## Task 2: Add context panel HTML in `popup.html`

**Files:**
- Modify: `popup.html`

- [ ] **Step 1: Add context panel div to cucumber tab**

In `popup.html`, inside `<div id="cucumber-tab" ...>` → inside `.ts-generator`, between the `.popup-header` div and the `<h3>Built prompt...` heading, insert:

```html
      <!-- CONTEXT PANEL (rendered by popup.js) -->
      <div id="context-panel"></div>
```

So the section reads:
```html
  <div id="cucumber-tab" class="tab-content active">
    <!-- CUCUMBER GENERATOR -->
    <div class="ts-generator">
      <div class="popup-header">
        <h1 id="ticket-title" style="margin:0; font-size: 1.2rem;"></h1>
      </div>

      <!-- CONTEXT PANEL (rendered by popup.js) -->
      <div id="context-panel"></div>

      <h3>Built prompt from requirements:</h3>
```

- [ ] **Step 2: Add context panel div to manual tab**

Inside `<div id="manual-tab" ...>` → inside `.ts-generator`, between the `.popup-header` div and the `<h3>Built prompt ... (Manual)` heading, insert:

```html
      <!-- CONTEXT PANEL (rendered by popup.js) -->
      <div id="context-panel-manual"></div>
```

So the section reads:
```html
  <div id="manual-tab" class="tab-content">
    <!-- MANUAL GENERATOR -->
    <div class="ts-generator">
      <div class="popup-header">
        <h1 id="ticket-title-manual" style="margin:0; font-size: 1.2rem;"></h1>
      </div>

      <!-- CONTEXT PANEL (rendered by popup.js) -->
      <div id="context-panel-manual"></div>

      <h3>Built prompt from requirements (Manual):</h3>
```

---

## Task 3: Add context panel logic in `popup.js`

**Files:**
- Modify: `popup.js`

The DOMContentLoaded block in `popup.js` (around line 596) builds the prompts and sets `promptEditor.value`. We need to:
1. Load context settings on startup
2. Trigger metadata fetch and render the panel after ticket data loads
3. Handle the "Load extra context" button click
4. Inject `<additional_context>` into both prompts before the generate buttons fire

- [ ] **Step 1: Add `buildContextBlock` helper function**

Add this function near the top of `popup.js` (after the `GEMINI_PAID_MODELS` constant, before any other functions):

```javascript
function buildContextBlock(contextData) {
  let block = "\n<additional_context>\n";

  if (contextData.parent) {
    block += `[Parent ticket: ${contextData.parent.key} — ${contextData.parent.summary}]\n`;
    if (contextData.parent.description) block += `Description: ${contextData.parent.description}\n`;
    if (contextData.parent.comments) block += `Comments: ${contextData.parent.comments}\n`;
    block += "\n";
  }

  for (const page of (contextData.confluencePages || [])) {
    block += `[Confluence: ${page.title}]\n${page.content}\n\n`;
  }

  block += `</additional_context>\n\nIMPORTANT: Use the terminology, naming conventions, and domain language from <additional_context> when writing test steps. Prefer existing names for entities, actions, and states over inventing new ones.`;
  return block;
}
```

- [ ] **Step 2: Add `renderContextPanel` function**

After `buildContextBlock`, add:

```javascript
function renderContextPanel(panelId, metadata, defaults, onLoad) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const { parent, confluencePages } = metadata;
  if (!parent && confluencePages.length === 0) {
    panel.style.display = "none";
    return;
  }

  const items = [];
  if (parent) {
    items.push({ id: "ctx-parent", label: `Parent: ${parent.key} — ${parent.summary}`, type: "parent", checked: defaults.contextDefaultParent !== false });
  }
  confluencePages.forEach(p => {
    items.push({ id: `ctx-conf-${p.pageId}`, label: `Confluence: ${p.title}`, type: "confluence", pageId: p.pageId, checked: defaults.contextDefaultConfluence !== false });
  });

  panel.innerHTML = "";
  panel.style.cssText = "border: 1px solid #ddd; border-radius: 4px; padding: 8px 12px; margin: 8px 0; background: #f9f9f9; font-size: 12px;";

  const title = document.createElement("div");
  title.style.cssText = "font-weight: bold; margin-bottom: 6px; color: #555;";
  title.textContent = "Extra context (used in prompt):";
  panel.appendChild(title);

  items.forEach(item => {
    const row = document.createElement("label");
    row.style.cssText = "display: flex; align-items: center; gap: 6px; margin-bottom: 4px; cursor: pointer;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = item.id;
    cb.dataset.type = item.type;
    if (item.pageId) cb.dataset.pageId = item.pageId;
    cb.checked = item.checked;
    cb.addEventListener("change", () => updateLoadButton(panel));
    const lbl = document.createElement("span");
    lbl.textContent = item.label;
    row.appendChild(cb);
    row.appendChild(lbl);
    panel.appendChild(row);
  });

  const btn = document.createElement("button");
  btn.id = panelId + "-load-btn";
  btn.textContent = "Load extra context";
  btn.style.cssText = "margin-top: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; background: #0052cc; color: white; border: none; border-radius: 4px;";
  btn.addEventListener("click", () => onLoad(panel, btn, metadata.confluencePages));
  panel.appendChild(btn);

  const statusEl = document.createElement("div");
  statusEl.id = panelId + "-status";
  statusEl.style.cssText = "font-size: 11px; color: red; margin-top: 4px;";
  panel.appendChild(statusEl);

  updateLoadButton(panel);
}

function updateLoadButton(panel) {
  const btn = panel.querySelector("button");
  if (!btn) return;
  const anyChecked = [...panel.querySelectorAll("input[type=checkbox]")].some(cb => cb.checked);
  btn.disabled = !anyChecked;
  btn.style.opacity = anyChecked ? "1" : "0.5";
}
```

- [ ] **Step 3: Add `loadContextContent` function**

After `renderContextPanel`, add:

```javascript
async function loadContextContent(panel, btn, allConfluencePages, issueKey, jiraTabId, promptEditorId, manualPromptEditorId) {
  const statusEl = document.getElementById(panel.id + "-status");
  btn.disabled = true;
  btn.textContent = "Loading...";
  if (statusEl) statusEl.textContent = "";

  const checkboxes = [...panel.querySelectorAll("input[type=checkbox]")];
  const includeParent = checkboxes.some(cb => cb.dataset.type === "parent" && cb.checked);
  const checkedPageIds = checkboxes
    .filter(cb => cb.dataset.type === "confluence" && cb.checked)
    .map(cb => cb.dataset.pageId);

  const response = await chrome.runtime.sendMessage({
    type: "FETCH_CONTEXT_CONTENT",
    issueKey,
    jiraTabId,
    includeParent,
    confluencePageIds: checkedPageIds,
  });

  if (!response || !response.success) {
    btn.textContent = "Load extra context";
    btn.disabled = false;
    if (statusEl) statusEl.textContent = "Could not load context — check your JIRA session";
    return;
  }

  if (response.confluenceAccessDenied) {
    btn.textContent = "Load extra context";
    btn.disabled = false;
    if (statusEl) statusEl.textContent = "Confluence pages could not be accessed — check your Confluence permissions";
    return;
  }

  const skipped = response.errors?.length || 0;
  const contextBlock = buildContextBlock(response);

  // Inject into Cucumber prompt
  const cucumberEditor = document.getElementById(promptEditorId);
  if (cucumberEditor) {
    let val = cucumberEditor.value;
    // Remove any previously injected context block
    const prevIdx = val.indexOf("\n<additional_context>");
    if (prevIdx !== -1) val = val.substring(0, prevIdx);
    // Insert after </ticket_description>
    const insertIdx = val.indexOf("</ticket_description>");
    if (insertIdx !== -1) {
      cucumberEditor.value = val.slice(0, insertIdx + "</ticket_description>".length) + contextBlock + val.slice(insertIdx + "</ticket_description>".length);
    } else {
      cucumberEditor.value = val + contextBlock;
    }
  }

  // Inject into Manual prompt
  const manualEditor = document.getElementById(manualPromptEditorId);
  if (manualEditor) {
    let val = manualEditor.value;
    const prevIdx = val.indexOf("\n<additional_context>");
    if (prevIdx !== -1) val = val.substring(0, prevIdx);
    const insertIdx = val.indexOf("</ticket_description>");
    if (insertIdx !== -1) {
      manualEditor.value = val.slice(0, insertIdx + "</ticket_description>".length) + contextBlock + val.slice(insertIdx + "</ticket_description>".length);
    } else {
      manualEditor.value = val + contextBlock;
    }
  }

  // Mark both panels as loaded (they share the same prompt editors)
  ["context-panel", "context-panel-manual"].forEach(pid => {
    const p = document.getElementById(pid);
    if (!p) return;
    const b = document.getElementById(pid + "-load-btn");
    if (b) { b.textContent = "✓ Context loaded"; b.style.background = "#36b37e"; b.disabled = true; }
  });

  if (statusEl && skipped > 0) {
    statusEl.style.color = "#e67e22";
    statusEl.textContent = `${skipped} page${skipped > 1 ? "s" : ""} could not be loaded`;
  }
}
```

- [ ] **Step 4: Wire context panel into the DOMContentLoaded block**

Find the `chrome.storage.local.get("jiraData", ...)` callback in `popup.js` (around line 601). After `promptEditorManual.value = manualPrompt;` and before `// Hide loader...`, add:

```javascript
    // --- CONTEXT PANEL ---
    chrome.storage.sync.get(
      ["contextPanelHidden", "contextDefaultParent", "contextDefaultConfluence"],
      (contextSettings) => {
        const hidden = contextSettings.contextPanelHidden === true;

        const buildPanelOnLoad = (panelId) => {
          const onLoad = (panel, btn, allConfluencePages) =>
            loadContextContent(panel, btn, allConfluencePages, issueKey, storage.jiraTabId || window._jiraTabId, "prompt-editor", "prompt-editor-manual");

          if (hidden) {
            // Auto-load all context immediately on Generate — handled in generate button listener below
            document.getElementById(panelId).style.display = "none";
            return;
          }

          chrome.runtime.sendMessage(
            {
              type: "FETCH_CONTEXT_METADATA",
              issueKey,
              issueDescription: description,
              jiraTabId: storage.jiraTabId || window._jiraTabId,
            },
            (metadata) => {
              if (metadata && metadata.success) {
                renderContextPanel(panelId, metadata, contextSettings, onLoad);
              }
            }
          );
        };

        buildPanelOnLoad("context-panel");
        buildPanelOnLoad("context-panel-manual");
      }
    );
```

Note: The `chrome.storage.local.get("jiraData", ...)` callback needs access to `jiraTabId`. That's already available via a separate `chrome.storage.local.get` call. Read the actual storage access pattern. Since the existing code only reads `jiraData` not `jiraTabId` in that callback, update the storage read to include `jiraTabId`:

Change:
```javascript
  chrome.storage.local.get("jiraData", (result) => {
    const { issueKey, summary, description } = result.jiraData || {};
```

To:
```javascript
  chrome.storage.local.get(["jiraData", "jiraTabId"], (result) => {
    const { issueKey, summary, description } = result.jiraData || {};
    const jiraTabId = result.jiraTabId;
```

Then use `jiraTabId` directly in the context panel message and `loadContextContent` calls.

- [ ] **Step 5: Update `loadContextContent` call signature**

After the above change, update the `loadContextContent` call inside the `onLoad` closure to use `jiraTabId` directly (not `storage.jiraTabId`):

```javascript
          const onLoad = (panel, btn, allConfluencePages) =>
            loadContextContent(panel, btn, allConfluencePages, issueKey, jiraTabId, "prompt-editor", "prompt-editor-manual");
```

And update the metadata message:
```javascript
              chrome.runtime.sendMessage(
                {
                  type: "FETCH_CONTEXT_METADATA",
                  issueKey,
                  issueDescription: description,
                  jiraTabId,
                },
```

- [ ] **Step 6: Manual smoke-test context panel**

1. Open a JIRA ticket that has a parent ticket
2. Click the extension icon → popup opens
3. Verify the context panel appears with parent checkbox
4. Click "Load extra context"
5. Verify the prompt textarea now contains `<additional_context>` block
6. Open a JIRA ticket with no parent and no Confluence links → verify panel is hidden

---

## Task 4: Add Context Enrichment section in `options.html`

**Files:**
- Modify: `options.html`

- [ ] **Step 1: Add Context Enrichment section**

In `options.html`, after the closing `</div>` of `<div id="integration-tab" ...>` and before `<div id="statusMessage" ...>`, insert:

```html
    <div id="context-tab" style="margin-top: 20px; padding: 12px; border: 1px solid var(--border-color); border-radius: 4px; background: #fff;">
      <h3 style="margin: 0 0 10px; font-size: 1rem; color: #333;">Context Enrichment</h3>

      <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; cursor: pointer;">
        <input type="checkbox" id="contextDefaultParent" style="width: auto;" />
        Include parent ticket by default
      </label>

      <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; cursor: pointer;">
        <input type="checkbox" id="contextDefaultConfluence" style="width: auto;" />
        Include Confluence pages by default
      </label>

      <label style="display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 8px; cursor: pointer;">
        <input type="checkbox" id="contextPanelHidden" style="width: auto;" />
        Hide "Load extra context" panel (auto-load on Generate)
      </label>

      <div id="contextPanelHiddenNote" style="font-size: 11px; color: #777; margin-bottom: 10px; display: none;">
        When hidden, the context panel is not shown in the popup. You can still enrich prompts manually via the prompt editor.
      </div>

      <button class="save-btn" id="saveContext">Save Context Settings</button>
    </div>
```

---

## Task 5: Add Context Enrichment logic in `options.js`

**Files:**
- Modify: `options.js`

- [ ] **Step 1: Load context settings in DOMContentLoaded**

In the `document.addEventListener("DOMContentLoaded", ...)` block, inside the `chrome.storage.sync.get(...)` callback (the one that already loads `clientId`, `clientSecret`, etc.), add `"contextPanelHidden"`, `"contextDefaultParent"`, `"contextDefaultConfluence"` to the keys array and handle them:

Change the `chrome.storage.sync.get` array from:
```javascript
    ["clientId", "clientSecret", "host", "geminiKey", "defaultAgent", "ollamaModel", "geminiModel"],
```
To:
```javascript
    ["clientId", "clientSecret", "host", "geminiKey", "defaultAgent", "ollamaModel", "geminiModel",
     "contextPanelHidden", "contextDefaultParent", "contextDefaultConfluence"],
```

Then after the existing `updateAgentSections(defaultAgent);` line, add:

```javascript
      const contextDefaultParentEl = document.getElementById("contextDefaultParent");
      const contextDefaultConfluenceEl = document.getElementById("contextDefaultConfluence");
      const contextPanelHiddenEl = document.getElementById("contextPanelHidden");
      const contextPanelHiddenNote = document.getElementById("contextPanelHiddenNote");

      if (contextDefaultParentEl) contextDefaultParentEl.checked = items.contextDefaultParent !== false;
      if (contextDefaultConfluenceEl) contextDefaultConfluenceEl.checked = items.contextDefaultConfluence !== false;
      if (contextPanelHiddenEl) {
        contextPanelHiddenEl.checked = items.contextPanelHidden === true;
        if (contextPanelHiddenNote) {
          contextPanelHiddenNote.style.display = items.contextPanelHidden ? "block" : "none";
        }
        contextPanelHiddenEl.addEventListener("change", () => {
          if (contextPanelHiddenNote) {
            contextPanelHiddenNote.style.display = contextPanelHiddenEl.checked ? "block" : "none";
          }
        });
      }
```

- [ ] **Step 2: Add Save Context Settings handler**

After the existing `document.getElementById("saveAgent")?.addEventListener(...)` block, add:

```javascript
document.getElementById("saveContext")?.addEventListener("click", () => {
  const contextDefaultParent = document.getElementById("contextDefaultParent")?.checked !== false;
  const contextDefaultConfluence = document.getElementById("contextDefaultConfluence")?.checked !== false;
  const contextPanelHidden = document.getElementById("contextPanelHidden")?.checked === true;

  chrome.storage.sync.set(
    { contextDefaultParent, contextDefaultConfluence, contextPanelHidden },
    () => showStatus("Context settings saved!", "green")
  );
});
```

- [ ] **Step 3: Verify options page**

1. Open `chrome://extensions` → click the extension's settings icon (or navigate to the options page)
2. Scroll to the "Context Enrichment" section at the bottom
3. Toggle "Hide panel" checkbox → verify the note appears/disappears
4. Click "Save Context Settings" → verify green "Context settings saved!" message
5. Reload the settings page → verify checkboxes restore to saved state

---

## Task 6: End-to-end verification

- [ ] **Step 1: Test with parent ticket + Confluence links**

1. Navigate to a JIRA ticket that has: a parent ticket, and a Confluence link in the description
2. Click the extension icon
3. Verify the context panel renders with the parent checkbox and Confluence checkbox
4. Uncheck Confluence, click "Load extra context"
5. Inspect the prompt textarea — verify `<additional_context>` contains only the parent block (no Confluence section)
6. Verify the Manual prompt textarea also has the `<additional_context>` block
7. Click "Generate Test Cases" — verify generation works normally

- [ ] **Step 2: Test with no parent and no Confluence links**

1. Navigate to a root JIRA ticket with no parent and no Confluence links in any field
2. Open popup — verify the context panel (`#context-panel`) has `display:none` (not visible)

- [ ] **Step 3: Test Confluence access error**

1. In Settings → Context Enrichment → check "Include Confluence pages by default"
2. On a ticket with a Confluence link, uncheck parent, leave Confluence checked, click "Load extra context"
3. If a 403 comes back → verify message: "Confluence pages could not be accessed — check your Confluence permissions"

- [ ] **Step 4: Test panel-hidden auto-load (settings)**

1. In Settings → check "Hide panel" → Save
2. Open popup on a ticket with parent → verify no context panel visible
3. Click "Generate Test Cases" — generation proceeds (context is not auto-loaded in this iteration; panel is simply hidden)

> Note: For this iteration, `contextPanelHidden = true` hides the panel and prevents manual loading. The options page note already reads "When hidden, all available context is loaded automatically when you click Generate" — to make that true, the generate button click handlers in `popup.js` need to trigger a full context fetch+inject before calling the LLM. That wiring is left as a follow-on task (sub-project A phase 2). For now, update the options note to read "When hidden, the panel is not shown. Context must be loaded manually via prompt editor." to avoid misleading the user.
