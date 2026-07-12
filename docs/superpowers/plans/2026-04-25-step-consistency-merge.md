# Step Consistency Merge UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After generating tests in the popup, let the user find existing Cucumber/Manual test tickets with similar steps and merge changes step-by-step in a dedicated side-by-side tab.

**Architecture:** A new `merge.html` tab is opened from the popup; it reads session data from `chrome.storage.local` (same pattern as popup). Two new `background.js` message handlers cover search (JIRA REST + Xray API) and step write-back (Xray REST). Popup gains a "Review & Merge" button on each generated card.

**Tech Stack:** Vanilla ES6+, Chrome Extension APIs (MV3), Xray Cloud REST API v2, JIRA REST API v3. No build step, no npm.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `background.js` | Modify | Add `SEARCH_XRAY_TESTS` and `UPDATE_TEST_STEPS` handlers |
| `popup.js` | Modify | Add "Review & Merge" button to Cucumber and Manual cards |
| `merge.html` | Create | Merge tab page shell |
| `merge.css` | Create | Two-column layout, step rows, badges, action buttons |
| `merge.js` | Create | All merge tab logic: bootstrap, scope picker, fuzzy match, render, actions, save |

`manifest.json` requires no changes — all needed permissions (`tabs`, `storage`, `scripting`, host permissions for Atlassian + Xray) already exist.

---

## Task 1: `background.js` — SEARCH_XRAY_TESTS handler

**Files:**
- Modify: `background.js`

This handler runs in two phases:
1. **JIRA REST** — find test issue keys by scope (test plan links, project search, or custom JQL)
2. **Xray REST** — for each key, fetch the actual steps

> **Note on Xray step-fetch endpoints:** Verify against Xray Cloud REST API v2 docs. Based on the v2 pattern in this codebase, the expected paths are `GET /api/v2/test/{issueKey}` (returns test object with `steps` for Manual, `gherkin` for Cucumber) or a search endpoint `GET /api/v2/tests?jql=...`. Adjust the URLs if the actual endpoints differ.

**Message shape (inbound):**
```javascript
{
  type: "SEARCH_XRAY_TESTS",
  scope: "testplan" | "project" | "custom",
  customJql: "...",       // only when scope === "custom"
  issueKey: "PROJ-123",
  testType: "Cucumber" | "Manual",
  jiraTabId: 42
}
```

**Response shape:**
```javascript
// success
{ success: true, tests: [{ key, summary, testtype, id, steps }] }
// error
{ success: false, error: "..." }
```

For Cucumber: `steps` is `string[]` (individual Gherkin lines, empty lines stripped).
For Manual: `steps` is `{ action, data, result }[]`.

- [ ] **Step 1: Add the message handler entry point**

In `background.js`, inside the `chrome.runtime.onMessage.addListener` callback, add before the closing brace (after the last existing `if` block):

```javascript
  if (message.type === "SEARCH_XRAY_TESTS") {
    handleSearchXrayTests(message).then(sendResponse);
    return true;
  }
```

- [ ] **Step 2: Implement `handleSearchXrayTests`**

Add at the bottom of `background.js`, after `handleStandardJiraCreate`:

```javascript
/* ===============================
   SEARCH EXISTING TESTS
================================= */

async function handleSearchXrayTests(data) {
  try {
    const { scope, customJql, issueKey, testType, jiraTabId } = data;

    // Phase 1: get JIRA base URL from the stored tab
    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = tab.url.split("/browse/")[0];
    const projectKey = issueKey.split("-")[0];

    let testKeys = [];

    if (scope === "testplan") {
      testKeys = await fetchTestKeysFromTestPlans(baseUrl, issueKey, testType);
    } else if (scope === "project") {
      const jql = `project = ${projectKey} AND issuetype = Test`;
      testKeys = await fetchTestKeysByJql(baseUrl, jql, testType);
    } else if (scope === "custom") {
      testKeys = await fetchTestKeysByJql(baseUrl, customJql, testType);
    }

    if (testKeys.length === 0) {
      return { success: true, tests: [] };
    }

    // Phase 2: fetch steps from Xray for each key
    const settings = await chrome.storage.sync.get(["clientId", "clientSecret"]);
    if (!settings.clientId || !settings.clientSecret) {
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const authRes = await fetch("https://xray.cloud.getxray.app/api/v2/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: settings.clientId, client_secret: settings.clientSecret }),
    });
    if (!authRes.ok) throw new Error(`Xray auth failed: ${authRes.status}`);
    const token = (await authRes.text()).replace(/"/g, "");

    const tests = await Promise.all(
      testKeys.map(({ key, summary, id }) =>
        fetchXrayTestSteps(key, summary, id, testType, token)
      )
    );

    return { success: true, tests: tests.filter(Boolean) };
  } catch (err) {
    console.error("SEARCH_XRAY_TESTS error:", err);
    return { success: false, error: err.message };
  }
}
```

- [ ] **Step 3: Implement `fetchTestKeysFromTestPlans`**

Add after `handleSearchXrayTests`:

```javascript
async function fetchTestKeysFromTestPlans(baseUrl, issueKey, testType) {
  // Find Test Plan issues linked to this ticket via JIRA issue links
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${issueKey}?fields=issuelinks`,
    { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
  );
  if (!res.ok) throw new Error(`JIRA issue fetch failed: ${res.status}`);
  const data = await res.json();

  const linkedIssues = (data.fields?.issuelinks || []).map(
    link => link.inwardIssue || link.outwardIssue
  ).filter(Boolean);

  // Filter for Test Plan issue type — fetch each to confirm issuetype
  const testPlanKeys = [];
  await Promise.all(
    linkedIssues.map(async linked => {
      const detailRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${linked.key}?fields=issuetype`,
        { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
      );
      if (!detailRes.ok) return;
      const detail = await detailRes.json();
      if (detail.fields?.issuetype?.name === "Test Plan") {
        testPlanKeys.push(linked.key);
      }
    })
  );

  if (testPlanKeys.length === 0) return [];

  // Fetch tests from each test plan via JIRA JQL (Xray injects testPlanTests() JQL function)
  const jql = `issue in testPlanTests(${testPlanKeys.map(k => `"${k}"`).join(",")})`;
  return fetchTestKeysByJql(baseUrl, jql, testType);
}
```

- [ ] **Step 4: Implement `fetchTestKeysByJql`**

Add after `fetchTestKeysFromTestPlans`:

```javascript
async function fetchTestKeysByJql(baseUrl, jql, testType) {
  // Xray stores testtype in a custom field; filter by summary text is impractical here.
  // We fetch all Test issues and filter by testType after fetching steps from Xray.
  const res = await fetch(
    `${baseUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,issuetype&maxResults=100`,
    { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
  );
  if (!res.ok) throw new Error(`JIRA search failed: ${res.status} for JQL: ${jql}`);
  const data = await res.json();
  return (data.issues || []).map(issue => ({
    key: issue.key,
    summary: issue.fields?.summary || issue.key,
    id: issue.id,
  }));
}
```

- [ ] **Step 5: Implement `fetchXrayTestSteps`**

Add after `fetchTestKeysByJql`:

```javascript
async function fetchXrayTestSteps(key, summary, jiraId, testType, token) {
  try {
    // Xray Cloud REST API v2: GET /api/v2/test/{issueId} returns the test with type and steps.
    // Verify this endpoint against Xray Cloud REST API v2 docs if it returns 404.
    // Alternative: use the GraphQL API at /api/v2/graphql if REST doesn't expose steps.
    const res = await fetch(`https://xray.cloud.getxray.app/api/v2/test/${jiraId}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!res.ok) {
      console.warn(`Could not fetch Xray steps for ${key}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const actualType = data.type?.kind || data.testType || "";

    // Type-scope: skip if this test is not the requested type
    if (testType === "Cucumber" && !actualType.toLowerCase().includes("cucumber")) return null;
    if (testType === "Manual" && !actualType.toLowerCase().includes("manual")) return null;

    let steps = [];
    if (testType === "Cucumber") {
      // Gherkin definition
      const gherkinRes = await fetch(
        `https://xray.cloud.getxray.app/api/v2/test/${jiraId}/gherkin`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (gherkinRes.ok) {
        const gherkinText = await gherkinRes.text();
        steps = gherkinText.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
      }
    } else {
      // Manual steps
      steps = (data.steps || []).map(s => ({
        action: s.action || "",
        data: s.data || "",
        result: s.result || "",
      }));
    }

    return { key, summary, testtype: testType, id: jiraId, steps };
  } catch (err) {
    console.warn(`fetchXrayTestSteps error for ${key}:`, err);
    return null;
  }
}
```

- [ ] **Step 6: Manually verify the handler is reachable**

Load the extension unpacked (`chrome://extensions/` → Load unpacked → select the extension directory). Open the background service worker console. Run:

```javascript
chrome.runtime.sendMessage({
  type: "SEARCH_XRAY_TESTS",
  scope: "project",
  issueKey: "PROJ-1",
  testType: "Cucumber",
  jiraTabId: /* any open JIRA tab id */
}, r => console.log(r));
```

Expected: response object (may be `{ success: true, tests: [] }` if no tests exist, or an error if credentials aren't set). No `undefined` or uncaught exception.

---

## Task 2: `background.js` — UPDATE_TEST_STEPS handler

**Files:**
- Modify: `background.js`

Updates the steps of an existing Xray test ticket (does not create a new one).

**Message shape (inbound):**
```javascript
{
  type: "UPDATE_TEST_STEPS",
  ticket: { key: "PROJ-45", id: "12345", testtype: "Cucumber" | "Manual" },
  steps: []
  // Cucumber: string[] of Gherkin lines (joined with \n before sending)
  // Manual: { action, data, result }[]
}
```

**Response shape:**
```javascript
{ success: true }  |  { success: false, error: "..." }
```

- [ ] **Step 1: Add message handler entry point**

In `background.js`, inside `chrome.runtime.onMessage.addListener`, add after the `SEARCH_XRAY_TESTS` block:

```javascript
  if (message.type === "UPDATE_TEST_STEPS") {
    handleUpdateTestSteps(message).then(sendResponse);
    return true;
  }
```

- [ ] **Step 2: Implement `handleUpdateTestSteps`**

Add after `fetchXrayTestSteps`:

```javascript
/* ===============================
   UPDATE EXISTING TEST STEPS
================================= */

async function handleUpdateTestSteps(data) {
  try {
    const { ticket, steps } = data;

    const settings = await chrome.storage.sync.get(["clientId", "clientSecret"]);
    if (!settings.clientId || !settings.clientSecret) {
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const authRes = await fetch("https://xray.cloud.getxray.app/api/v2/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: settings.clientId, client_secret: settings.clientSecret }),
    });
    if (!authRes.ok) throw new Error(`Xray auth failed: ${authRes.status}`);
    const token = (await authRes.text()).replace(/"/g, "");

    if (ticket.testtype === "Cucumber") {
      // PUT /api/v2/test/{id}/gherkin — replaces the full Gherkin definition.
      // Verify this endpoint against Xray Cloud REST API v2 docs.
      const gherkinText = steps.join("\n");
      const res = await fetch(`https://xray.cloud.getxray.app/api/v2/test/${ticket.id}/gherkin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ gherkin: gherkinText }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Xray Cucumber update failed: ${res.status} — ${errText}`);
      }
    } else {
      // PUT /api/v2/test/{id}/steps — replaces all steps.
      // Verify this endpoint against Xray Cloud REST API v2 docs.
      const res = await fetch(`https://xray.cloud.getxray.app/api/v2/test/${ticket.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ steps: steps.map((s, i) => ({ ...s, index: i + 1 })) }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Xray Manual update failed: ${res.status} — ${errText}`);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("UPDATE_TEST_STEPS error:", err);
    return { success: false, error: err.message };
  }
}
```

- [ ] **Step 3: Manually verify handler is reachable**

In the background service worker console:

```javascript
chrome.runtime.sendMessage({
  type: "UPDATE_TEST_STEPS",
  ticket: { key: "PROJ-1", id: "fake", testtype: "Manual" },
  steps: [{ action: "test", data: "", result: "pass" }]
}, r => console.log(r));
```

Expected: error response (auth or HTTP error) but NOT an uncaught exception or undefined. The handler is reachable.

---

## Task 3: `merge.html` + `merge.css` — layout skeleton

**Files:**
- Create: `merge.html`
- Create: `merge.css`

- [ ] **Step 1: Create `merge.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>TestScribe — Step Merge</title>
  <link rel="stylesheet" href="merge.css">
</head>
<body>

  <div id="header">
    <h2>Step Consistency Review</h2>
    <span id="issue-label"></span>
  </div>

  <div id="scope-panel">
    <label for="scope-select">Search scope:</label>
    <select id="scope-select">
      <option value="testplan">Test Plans linked to this ticket</option>
      <option value="project">All tests in project</option>
      <option value="custom">Custom JQL</option>
    </select>
    <input type="text" id="custom-jql" placeholder="Enter JQL query..." style="display:none">
    <button id="search-btn">Search</button>
    <span id="search-status"></span>
  </div>

  <div id="no-results" style="display:none">
    <p>No existing tests found in this scope.</p>
    <button id="change-scope-btn">Change scope</button>
  </div>

  <div id="merge-columns" style="display:none">

    <div id="col-generated" class="merge-col">
      <div class="col-header">
        <h3>Generated Test</h3>
        <div id="gen-summary" class="test-summary-label"></div>
      </div>
      <div id="gen-steps" class="steps-list"></div>
      <div id="ai-confirm-bar">
        <button id="ai-confirm-btn" disabled title="LLM not configured">Confirm with AI</button>
        <span id="ai-status"></span>
      </div>
    </div>

    <div id="col-existing" class="merge-col">
      <div class="col-header">
        <h3>Existing Ticket</h3>
        <select id="ticket-select"></select>
      </div>
      <div id="existing-steps" class="steps-list"></div>
    </div>

  </div>

  <div id="bottom-bar">
    <button id="save-btn" disabled>Save Changes</button>
    <div id="save-status"></div>
    <button id="done-btn">Done</button>
  </div>

  <script src="merge.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `merge.css`**

```css
* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  padding: 0;
  background: #f4f5f7;
  color: #172b4d;
}

/* ===== HEADER ===== */
#header {
  background: #0052cc;
  color: white;
  padding: 10px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}
#header h2 { margin: 0; font-size: 15px; font-weight: 600; }
#issue-label { font-size: 12px; opacity: 0.8; }

/* ===== SCOPE PANEL ===== */
#scope-panel {
  padding: 10px 20px;
  background: white;
  border-bottom: 1px solid #dfe1e6;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#scope-panel label { font-size: 13px; }
#scope-select, #custom-jql {
  padding: 5px 8px;
  border: 1px solid #dfe1e6;
  border-radius: 3px;
  font-size: 13px;
}
#custom-jql { width: 300px; }
#search-btn {
  padding: 5px 14px;
  background: #0052cc;
  color: white;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}
#search-btn:disabled { background: #a5adba; cursor: not-allowed; }
#search-status { font-size: 12px; color: #6b778c; }

/* ===== NO RESULTS ===== */
#no-results { padding: 40px 20px; text-align: center; color: #6b778c; }
#change-scope-btn {
  margin-top: 8px;
  padding: 6px 14px;
  border: 1px solid #dfe1e6;
  border-radius: 3px;
  cursor: pointer;
  background: white;
}

/* ===== TWO-COLUMN LAYOUT ===== */
#merge-columns {
  display: flex;
  height: calc(100vh - 152px); /* header + scope panel + bottom bar */
}

.merge-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-right: 1px solid #dfe1e6;
  overflow: hidden;
  min-width: 0;
}
.merge-col:last-child { border-right: none; }

.col-header {
  padding: 10px 14px;
  border-bottom: 1px solid #dfe1e6;
  background: #f8f9fa;
  flex-shrink: 0;
}
.col-header h3 { margin: 0 0 4px 0; font-size: 13px; font-weight: 600; }
.test-summary-label { font-size: 11px; color: #6b778c; }

#ticket-select {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid #dfe1e6;
  border-radius: 3px;
  font-size: 12px;
}

.steps-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

/* ===== STEP ROWS — GENERATED (LEFT) ===== */
.gen-step-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  margin-bottom: 6px;
  background: white;
}
.gen-step-row.has-match { border-color: #ff8b00; background: #fffae6; }
.gen-step-row.confirmed-match { border-color: #36b37e; background: #e3fcef; }

.gen-step-text {
  flex: 1;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 2px;
  outline: none;
  background: transparent;
  resize: none;
  min-height: 22px;
}
.gen-step-text:focus { border-color: #0052cc; background: #f8f9fa; }

.match-badge {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 10px;
  background: #ff8b00;
  color: white;
  white-space: nowrap;
  align-self: center;
  flex-shrink: 0;
}
.match-badge.confirmed { background: #36b37e; }

.push-btn {
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  border: 1px solid #0052cc;
  border-radius: 3px;
  background: white;
  color: #0052cc;
  flex-shrink: 0;
  align-self: center;
}
.push-btn:hover { background: #e8f0fe; }

/* ===== STEP ROWS — EXISTING (RIGHT) ===== */
.existing-step-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 7px 8px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  margin-bottom: 6px;
  background: white;
}
.existing-step-row.pending-add { border-color: #36b37e; background: #e3fcef; }
.existing-step-row.pending-remove { border-color: #de350b; background: #ffebe6; opacity: 0.6; }
.existing-step-row.pending-replace { border-color: #0052cc; background: #e8f0fe; }

.existing-step-text {
  flex: 1;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 2px;
  outline: none;
  background: transparent;
  resize: none;
  min-height: 22px;
}
.existing-step-text:focus { border-color: #0052cc; background: #f8f9fa; }

.step-action-btns { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
.action-btn {
  padding: 2px 7px;
  font-size: 10px;
  cursor: pointer;
  border: none;
  border-radius: 3px;
  color: white;
  white-space: nowrap;
}
.action-btn.pull-btn { background: #6b778c; }
.action-btn.pull-btn:hover { background: #505f79; }
.action-btn.remove-btn { background: #de350b; }
.action-btn.remove-btn:hover { background: #bf2600; }
.action-btn.undo-btn { background: #6b778c; }

/* Manual test table rows */
.manual-step-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  margin-bottom: 6px;
  background: white;
  align-items: center;
}
.manual-step-row.pending-add { border-color: #36b37e; background: #e3fcef; }
.manual-step-row.pending-remove { border-color: #de350b; background: #ffebe6; opacity: 0.6; }
.manual-cell {
  font-size: 11px;
  font-family: "SFMono-Regular", Consolas, monospace;
  padding: 2px 4px;
  border: 1px solid transparent;
  border-radius: 2px;
  outline: none;
  background: transparent;
  resize: none;
  min-height: 20px;
}
.manual-cell:focus { border-color: #0052cc; background: #f8f9fa; }

/* ===== AI CONFIRM BAR ===== */
#ai-confirm-bar {
  padding: 8px 14px;
  border-top: 1px solid #dfe1e6;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
#ai-confirm-btn {
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid #0052cc;
  color: #0052cc;
  background: white;
  border-radius: 3px;
}
#ai-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#ai-status { font-size: 11px; color: #6b778c; }

/* ===== BOTTOM BAR ===== */
#bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 20px;
  background: white;
  border-top: 1px solid #dfe1e6;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 10;
}
#save-btn {
  padding: 7px 16px;
  background: #0052cc;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
#save-btn:disabled { background: #a5adba; cursor: not-allowed; }
#done-btn {
  padding: 7px 16px;
  background: white;
  border: 1px solid #dfe1e6;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
#done-btn:hover { background: #f4f5f7; }
#save-status { flex: 1; font-size: 12px; }
```

- [ ] **Step 3: Verify layout renders**

Load the extension. Navigate to `chrome-extension://<id>/merge.html` directly in the browser. You should see the header bar, scope panel, and bottom bar. The merge columns area is hidden until search completes (correct). No console errors.

---

## Task 4: `merge.js` — bootstrap, state, and fuzzy matching utility

**Files:**
- Create: `merge.js`

This task creates the file with state, constants, and the pure fuzzy-matching functions that the rest of the code depends on.

- [ ] **Step 1: Create `merge.js` with state and constants**

```javascript
console.log("Merge tab loaded");

/* ===== STATE ===== */
let mergeSession = null;      // loaded from chrome.storage.local
let existingTests = [];       // array of { key, summary, testtype, id, steps[] }
let currentTicketIndex = 0;   // index into existingTests for right column
// pendingChanges: ticketKey -> steps[] (full replacement list, copy-on-first-write)
const pendingChanges = new Map();

const SIMILARITY_THRESHOLD = 0.6;

// Duplicated from background.js and popup.js — keep all four in sync
const GEMINI_PAID_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.0-pro",
  "gemini-1.5-pro",
  "gemini-exp",
  "gemini-pro",
];

/* ===== FUZZY MATCHING ===== */

function jaccardSimilarity(textA, textB) {
  const tokenize = t => new Set(
    t.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean)
  );
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function stepToText(step) {
  if (typeof step === "string") return step;
  return `${step.action || ""} ${step.data || ""} ${step.result || ""}`.trim();
}

// Returns Map<genStepIndex, { ticketKey, stepIndex, score }[]>
// Only includes entries where at least one existing step scores >= SIMILARITY_THRESHOLD.
function findCandidateMatches(generatedSteps, tests) {
  const result = new Map();
  generatedSteps.forEach((genStep, gi) => {
    const genText = stepToText(genStep);
    tests.forEach(ticket => {
      ticket.steps.forEach((exStep, ei) => {
        const score = jaccardSimilarity(genText, stepToText(exStep));
        if (score >= SIMILARITY_THRESHOLD) {
          if (!result.has(gi)) result.set(gi, []);
          result.get(gi).push({ ticketKey: ticket.key, stepIndex: ei, score });
        }
      });
    });
  });
  return result;
}
```

- [ ] **Step 2: Verify fuzzy matching in browser console**

Open `merge.html` in the extension, open DevTools console, and run:

```javascript
// Test exact match
console.assert(jaccardSimilarity("the user is logged in", "the user is logged in") === 1, "exact match should be 1");

// Test no overlap
console.assert(jaccardSimilarity("open the homepage", "verify the footer") < SIMILARITY_THRESHOLD, "unrelated steps should score low");

// Test partial match
const score = jaccardSimilarity("the user is logged in as admin", "the user is authenticated as admin");
console.assert(score > 0.4, `partial match score should be reasonable: ${score}`);

// Test stepToText normalizes manual step
const text = stepToText({ action: "click login", data: "admin", result: "dashboard shown" });
console.assert(text === "click login admin dashboard shown", `stepToText: ${text}`);

console.log("Fuzzy matching: all assertions passed");
```

Expected: "Fuzzy matching: all assertions passed" with no assertion errors.

---

## Task 5: `merge.js` — bootstrap + scope picker

**Files:**
- Modify: `merge.js`

- [ ] **Step 1: Add `init` and scope picker logic**

Append to `merge.js`:

```javascript
/* ===== BOOTSTRAP ===== */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const storage = await chrome.storage.local.get("mergeSession");
  mergeSession = storage.mergeSession;

  if (!mergeSession) {
    document.body.innerHTML =
      '<p style="padding:20px;color:#de350b;">No merge session found. Close this tab and click "Review & Merge" again.</p>';
    return;
  }

  document.getElementById("issue-label").textContent = mergeSession.issueKey;

  // Enable AI confirm button only if LLM is configured
  chrome.storage.sync.get(["defaultAgent", "geminiKey"], prefs => {
    const canAi = prefs.defaultAgent === "ollama" || (prefs.defaultAgent === "gemini" && prefs.geminiKey);
    const aiBtn = document.getElementById("ai-confirm-btn");
    if (canAi) {
      aiBtn.disabled = false;
      aiBtn.title = "Run LLM to confirm fuzzy matches";
    } else {
      aiBtn.title = "LLM not configured — go to Settings";
    }
  });

  setupScopePicker();
  setupBottomBar();
}

/* ===== SCOPE PICKER ===== */

function setupScopePicker() {
  const scopeSelect = document.getElementById("scope-select");
  const customJqlInput = document.getElementById("custom-jql");
  const searchBtn = document.getElementById("search-btn");
  const changeScope = document.getElementById("change-scope-btn");

  scopeSelect.addEventListener("change", () => {
    customJqlInput.style.display = scopeSelect.value === "custom" ? "inline-block" : "none";
  });

  searchBtn.addEventListener("click", runSearch);

  if (changeScope) {
    changeScope.addEventListener("click", () => {
      document.getElementById("no-results").style.display = "none";
      document.getElementById("merge-columns").style.display = "none";
    });
  }
}

async function runSearch() {
  const scopeSelect = document.getElementById("scope-select");
  const customJqlInput = document.getElementById("custom-jql");
  const searchStatus = document.getElementById("search-status");
  const searchBtn = document.getElementById("search-btn");

  const scope = scopeSelect.value;
  const customJql = customJqlInput.value.trim();

  if (scope === "custom" && !customJql) {
    searchStatus.textContent = "Enter a JQL query first.";
    searchStatus.style.color = "#de350b";
    return;
  }

  searchBtn.disabled = true;
  searchStatus.style.color = "#6b778c";
  searchStatus.textContent = "Searching…";

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage(
      {
        type: "SEARCH_XRAY_TESTS",
        scope,
        customJql,
        issueKey: mergeSession.issueKey,
        testType: mergeSession.generatedTest.type === "cucumber" ? "Cucumber" : "Manual",
        jiraTabId: mergeSession.jiraTabId,
      },
      resolve
    )
  );

  searchBtn.disabled = false;

  if (!response || !response.success) {
    searchStatus.textContent = `Error: ${response?.error || "Unknown error"}`;
    searchStatus.style.color = "#de350b";
    return;
  }

  existingTests = response.tests || [];
  searchStatus.textContent = `Found ${existingTests.length} test(s).`;
  searchStatus.style.color = "#36b37e";

  if (existingTests.length === 0) {
    document.getElementById("no-results").style.display = "block";
    document.getElementById("merge-columns").style.display = "none";
    return;
  }

  document.getElementById("no-results").style.display = "none";
  renderMergeColumns();
}
```

- [ ] **Step 2: Verify scope picker shows/hides custom JQL input**

Open the merge tab. Select "Custom JQL" in the dropdown — the text input should appear. Select another option — it should hide. No console errors.

---

## Task 6: `merge.js` — render merge columns

**Files:**
- Modify: `merge.js`

Renders both left (generated) and right (existing) columns. Cucumber and Manual use different step shapes.

- [ ] **Step 1: Add `renderMergeColumns` and helpers**

Append to `merge.js`:

```javascript
/* ===== RENDER MERGE COLUMNS ===== */

function renderMergeColumns() {
  document.getElementById("merge-columns").style.display = "flex";
  renderTicketDropdown();
  renderGeneratedSteps();
  renderExistingSteps();
  document.getElementById("ai-confirm-btn").addEventListener("click", runAiConfirmation);
}

function renderTicketDropdown() {
  const select = document.getElementById("ticket-select");
  select.innerHTML = "";
  existingTests.forEach((t, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${t.key} — ${t.summary}`;
    select.appendChild(opt);
  });
  select.value = currentTicketIndex;
  select.addEventListener("change", () => {
    currentTicketIndex = Number(select.value);
    renderExistingSteps();
  });
}

function getGenSteps() {
  return mergeSession.generatedTest.steps;
}

function getPendingStepsForCurrentTicket() {
  const ticket = existingTests[currentTicketIndex];
  if (!pendingChanges.has(ticket.key)) {
    pendingChanges.set(ticket.key, ticket.steps.map(s =>
      typeof s === "string" ? s : { ...s }
    ));
  }
  return pendingChanges.get(ticket.key);
}

function renderGeneratedSteps() {
  const container = document.getElementById("gen-steps");
  container.innerHTML = "";

  const genSummaryEl = document.getElementById("gen-summary");
  genSummaryEl.textContent = mergeSession.generatedTest.summary || "";

  const genSteps = getGenSteps();
  const matches = findCandidateMatches(genSteps, existingTests);

  genSteps.forEach((step, gi) => {
    const candidatesForStep = matches.get(gi) || [];
    const bestMatch = candidatesForStep.reduce(
      (best, c) => (!best || c.score > best.score ? c : best),
      null
    );

    const row = document.createElement("div");
    row.className = "gen-step-row" + (bestMatch ? " has-match" : "");
    row.dataset.genIndex = gi;

    if (mergeSession.generatedTest.type === "cucumber") {
      const textarea = document.createElement("textarea");
      textarea.className = "gen-step-text";
      textarea.value = step;
      textarea.rows = 1;
      textarea.addEventListener("input", () => {
        mergeSession.generatedTest.steps[gi] = textarea.value;
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
      });
      row.appendChild(textarea);
    } else {
      // Manual: show action / data / result inline
      ["action", "data", "result"].forEach(field => {
        const ta = document.createElement("textarea");
        ta.className = "gen-step-text";
        ta.value = step[field] || "";
        ta.rows = 1;
        ta.placeholder = field;
        ta.addEventListener("input", () => {
          mergeSession.generatedTest.steps[gi][field] = ta.value;
        });
        row.appendChild(ta);
      });
    }

    if (bestMatch) {
      const pct = Math.round(bestMatch.score * 100);
      const badge = document.createElement("span");
      badge.className = "match-badge";
      badge.textContent = `~${pct}%`;
      badge.dataset.genIndex = gi;
      row.appendChild(badge);
    }

    const pushBtn = document.createElement("button");
    pushBtn.className = "push-btn";
    pushBtn.textContent = "→ Add";
    pushBtn.title = "Add this step to the existing ticket";
    pushBtn.addEventListener("click", () => pushStepToExisting(gi));
    row.appendChild(pushBtn);

    container.appendChild(row);
  });
}

function renderExistingSteps() {
  const container = document.getElementById("existing-steps");
  container.innerHTML = "";

  const ticket = existingTests[currentTicketIndex];
  if (!ticket) return;

  const steps = getPendingStepsForCurrentTicket();

  steps.forEach((step, ei) => {
    const row = buildExistingStepRow(step, ei, ticket);
    container.appendChild(row);
  });
}

function buildExistingStepRow(step, ei, ticket) {
  const isManual = mergeSession.generatedTest.type === "manual";
  const row = document.createElement("div");
  row.className = isManual ? "manual-step-row" : "existing-step-row";
  row.dataset.existingIndex = ei;

  if (isManual) {
    ["action", "data", "result"].forEach(field => {
      const ta = document.createElement("textarea");
      ta.className = "manual-cell";
      ta.value = step[field] || "";
      ta.rows = 1;
      ta.placeholder = field;
      ta.addEventListener("input", () => {
        getPendingStepsForCurrentTicket()[ei][field] = ta.value;
        updateSaveButton();
      });
      row.appendChild(ta);
    });
  } else {
    const ta = document.createElement("textarea");
    ta.className = "existing-step-text";
    ta.value = step;
    ta.rows = 1;
    ta.addEventListener("input", () => {
      getPendingStepsForCurrentTicket()[ei] = ta.value;
      updateSaveButton();
    });
    row.appendChild(ta);
  }

  const btnGroup = document.createElement("div");
  btnGroup.className = "step-action-btns";

  const pullBtn = document.createElement("button");
  pullBtn.className = "action-btn pull-btn";
  pullBtn.textContent = "← Pull";
  pullBtn.title = "Copy this step into the generated test";
  pullBtn.addEventListener("click", () => pullStepToGenerated(ei));
  btnGroup.appendChild(pullBtn);

  const removeBtn = document.createElement("button");
  removeBtn.className = "action-btn remove-btn";
  removeBtn.textContent = "✕ Remove";
  removeBtn.title = "Remove this step from the existing ticket";
  removeBtn.addEventListener("click", () => removeExistingStep(ei));
  btnGroup.appendChild(removeBtn);

  row.appendChild(btnGroup);
  return row;
}
```

- [ ] **Step 2: Verify columns render**

Trigger a search that returns results (or temporarily hard-code `existingTests` in the console and call `renderMergeColumns()` manually). Both columns should appear with step rows. Steps should be editable. No console errors.

---

## Task 7: `merge.js` — step move actions + pending changes

**Files:**
- Modify: `merge.js`

Implements the `→ Add`, `← Pull`, and `✕ Remove` actions and keeps `pendingChanges` in sync.

- [ ] **Step 1: Add action functions**

Append to `merge.js`:

```javascript
/* ===== STEP MOVE ACTIONS ===== */

function pushStepToExisting(genIndex) {
  const step = mergeSession.generatedTest.steps[genIndex];
  const ticket = existingTests[currentTicketIndex];
  const pending = getPendingStepsForCurrentTicket();

  // Add a copy at the end
  const newStep = typeof step === "string" ? step : { ...step };
  pending.push(newStep);

  updateSaveButton();
  renderExistingSteps();
}

function pullStepToGenerated(existingIndex) {
  const pending = getPendingStepsForCurrentTicket();
  const step = pending[existingIndex];

  if (mergeSession.generatedTest.type === "cucumber") {
    // Append to generated steps (display only — not persisted to any ticket)
    mergeSession.generatedTest.steps.push(typeof step === "string" ? step : "");
  } else {
    mergeSession.generatedTest.steps.push(
      typeof step === "object" ? { ...step } : { action: step, data: "", result: "" }
    );
  }
  renderGeneratedSteps();
}

function removeExistingStep(existingIndex) {
  const ticket = existingTests[currentTicketIndex];
  const pending = getPendingStepsForCurrentTicket();
  pending.splice(existingIndex, 1);
  updateSaveButton();
  renderExistingSteps();
}

function updateSaveButton() {
  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = pendingChanges.size === 0;
}
```

- [ ] **Step 2: Verify actions work**

With the merge columns visible:

1. Click "→ Add" on any generated step → new step row appears at the bottom of the right column.
2. Click "← Pull" on any existing step → new row appears at the bottom of the left column.
3. Click "✕ Remove" on any existing step → that row disappears from the right column.
4. After any of the above, "Save Changes" button becomes enabled.

---

## Task 8: `merge.js` — LLM confirmation

**Files:**
- Modify: `merge.js`

Sends flagged candidate pairs to the LLM and updates the match badges.

- [ ] **Step 1: Add `runAiConfirmation`**

Append to `merge.js`:

```javascript
/* ===== LLM CONFIRMATION ===== */

async function runAiConfirmation() {
  const btn = document.getElementById("ai-confirm-btn");
  const statusEl = document.getElementById("ai-status");

  const genSteps = getGenSteps();
  const matches = findCandidateMatches(genSteps, existingTests);

  if (matches.size === 0) {
    statusEl.textContent = "No fuzzy candidates to confirm.";
    return;
  }

  // Build pairs: each candidate match -> one entry
  const pairs = [];
  matches.forEach((candidates, gi) => {
    candidates.forEach(c => {
      const ticket = existingTests.find(t => t.key === c.ticketKey);
      if (!ticket) return;
      const exStep = ticket.steps[c.stepIndex];
      pairs.push({
        gi,
        ticketKey: c.ticketKey,
        stepIndex: c.stepIndex,
        genText: stepToText(genSteps[gi]),
        exText: stepToText(exStep),
      });
    });
  });

  const pairList = pairs
    .map((p, i) => `Pair ${i + 1}:\nA: "${p.genText}"\nB: "${p.exText}"`)
    .join("\n\n");

  const prompt = `You are a QA test step analyzer. For each pair of test steps below, answer only "yes" if they are semantically equivalent (same intent, different wording) or "no" if they are not. Output one answer per line, in the same order as the pairs. No explanations.\n\n${pairList}`;

  btn.disabled = true;
  statusEl.textContent = "Asking LLM…";

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ type: "GENERATE_TESTS", prompt }, resolve)
  );

  btn.disabled = false;

  if (!response || response.error) {
    statusEl.textContent = `LLM error: ${response?.error || "No response"}`;
    return;
  }

  const answers = (response.output || "").split("\n").map(l => l.trim().toLowerCase());

  pairs.forEach((p, i) => {
    const confirmed = answers[i] === "yes";
    // Update badge in the left column
    const genRows = document.querySelectorAll(".gen-step-row");
    const row = genRows[p.gi];
    if (!row) return;
    const badge = row.querySelector(".match-badge");
    if (badge && confirmed) {
      badge.classList.add("confirmed");
      badge.title = `Confirmed match in ${p.ticketKey}`;
      row.classList.remove("has-match");
      row.classList.add("confirmed-match");
    } else if (badge && !confirmed) {
      badge.style.textDecoration = "line-through";
      badge.title = "LLM: not equivalent";
    }
  });

  statusEl.textContent = `Done. ${answers.filter(a => a === "yes").length}/${pairs.length} confirmed.`;
}
```

- [ ] **Step 2: Verify AI confirmation**

With fuzzy matches visible, click "Confirm with AI". The status should update to "Asking LLM…" then show a result count. Confirmed badges turn green; unconfirmed badges get a strikethrough. If LLM is unavailable, an error message appears (button must be re-enabled, which the code does).

---

## Task 9: `merge.js` — save changes

**Files:**
- Modify: `merge.js`

Sends each modified ticket's pending steps back to `background.js` via `UPDATE_TEST_STEPS`.

- [ ] **Step 1: Add `setupBottomBar` and save logic**

Append to `merge.js`:

```javascript
/* ===== SAVE CHANGES ===== */

function setupBottomBar() {
  document.getElementById("save-btn").addEventListener("click", saveAllChanges);
  document.getElementById("done-btn").addEventListener("click", () => window.close());
}

async function saveAllChanges() {
  const saveBtn = document.getElementById("save-btn");
  const statusEl = document.getElementById("save-status");

  saveBtn.disabled = true;
  statusEl.textContent = "Saving…";
  statusEl.style.color = "#6b778c";

  const results = [];

  for (const [ticketKey, steps] of pendingChanges.entries()) {
    const ticket = existingTests.find(t => t.key === ticketKey);
    if (!ticket) continue;

    const response = await new Promise(resolve =>
      chrome.runtime.sendMessage(
        { type: "UPDATE_TEST_STEPS", ticket, steps },
        resolve
      )
    );

    results.push({ key: ticketKey, success: response?.success, error: response?.error });
  }

  const succeeded = results.filter(r => r.success).map(r => r.key);
  const failed = results.filter(r => !r.success);

  if (failed.length === 0) {
    statusEl.textContent = `✓ Saved: ${succeeded.join(", ")}`;
    statusEl.style.color = "#36b37e";
    pendingChanges.clear();
    // Re-enable save button only if new changes made after this point
  } else {
    const failMsg = failed.map(f => `${f.key}: ${f.error}`).join("; ");
    statusEl.textContent = `Errors: ${failMsg}${succeeded.length > 0 ? ` | Saved: ${succeeded.join(", ")}` : ""}`;
    statusEl.style.color = "#de350b";
    // Remove successfully saved tickets from pending so retry only hits failures
    succeeded.forEach(k => pendingChanges.delete(k));
    saveBtn.disabled = pendingChanges.size === 0;
  }
}
```

- [ ] **Step 2: Verify save flow**

Make a change (add or remove a step). Click "Save Changes". The status area should show "Saving…" then either a success message or a per-ticket error. If Xray returns an error (e.g. wrong endpoint during development), the error message appears inline without crashing. "Done" closes the tab.

---

## Task 10: `popup.js` — "Review & Merge" button

**Files:**
- Modify: `popup.js`

Adds a "Review & Merge" button to both Cucumber cards (in `renderTests`) and Manual cards (in `renderManualTests`). The button writes a `mergeSession` to `chrome.storage.local` and opens `merge.html`.

- [ ] **Step 1: Add helper to open the merge tab**

Append to `popup.js`:

```javascript
/* ===============================
   OPEN MERGE TAB
================================= */

async function openMergeTab(generatedTest) {
  const storage = await chrome.storage.local.get(["jiraData", "jiraTabId"]);

  await chrome.storage.local.set({
    mergeSession: {
      generatedTest,
      issueKey: storage.jiraData?.issueKey || "",
      jiraTabId: storage.jiraTabId,
    },
  });

  chrome.tabs.create({ url: chrome.runtime.getURL("merge.html") });
}
```

- [ ] **Step 2: Add "Review & Merge" button to Cucumber cards**

In `popup.js`, find the `renderTests` function. Locate the `.actions` div HTML string inside `card.innerHTML`. It currently ends with:

```javascript
          <button class="xray-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Test</button>
```

Replace the entire `.actions` div with:

```javascript
        <div class="actions">
          <button class="ignore-btn">Ignore</button>
          <button class="create-btn">Create Test</button>
          <button class="xray-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Test</button>
          <button class="merge-btn" style="background-color: #6554c0; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Review &amp; Merge</button>
        </div>
```

Then, after the `card.querySelector(".ignore-btn").onclick` line, add:

```javascript
    card.querySelector(".merge-btn").onclick = () => {
      const rawText = textarea.value.trim();
      const lines = rawText.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
      const featureMatch = rawText.match(/Feature:\s*(.*)/);
      openMergeTab({
        type: "cucumber",
        summary: featureMatch ? featureMatch[1].trim() : "Generated Test",
        steps: lines,
        rawText,
      });
    };
```

- [ ] **Step 3: Add "Review & Merge" button to Manual cards**

In `renderManualTests`, find the `.actions` div inside `card.innerHTML`. It currently ends with:

```javascript
            <button class="xray-manual-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Manual Test</button>
```

Replace the entire `.actions` div with:

```javascript
          <div class="actions">
            <button class="ignore-btn">Ignore</button>
            <button class="create-btn">Create Test</button>
            <button class="xray-manual-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Manual Test</button>
            <button class="merge-manual-btn" style="background-color: #6554c0; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Review &amp; Merge</button>
          </div>
```

Then, immediately after `card.querySelector(".ignore-btn").onclick = () => card.remove();`, add:

```javascript
      card.querySelector(".merge-manual-btn").onclick = () => {
        const rawSummary = card
          .querySelector(".manual-summary")
          .innerText.replace(/^Target Summary:\s*/, "")
          .trim();
        const editedMarkdown = card.querySelector(".manual-markdown-editor").value;

        // Parse the markdown table back into steps (same logic as xray-manual-btn handler)
        const parsedSteps = [];
        const lines = editedMarkdown
          .split("\n")
          .map(l => l.trim())
          .filter(l => l.startsWith("|"));
        if (lines.length > 2) {
          for (let i = 2; i < lines.length; i++) {
            const cells = lines[i]
              .split(/(?<!\\)\|/g)
              .map(c => c.trim().replace(/\\\|/g, "|"));
            if (cells.length >= 5) {
              const action = cells[2] || "";
              const data = cells[3] || "";
              const result = cells[4] || "";
              if (action || data || result) parsedSteps.push({ action, data, result });
            }
          }
        }

        if (parsedSteps.length === 0) {
          alert("Could not parse steps from the table. Make sure the table format is preserved.");
          return;
        }

        openMergeTab({
          type: "manual",
          summary: rawSummary,
          steps: parsedSteps,
        });
      };
```

- [ ] **Step 4: End-to-end manual test — Cucumber flow**

1. Open a JIRA ticket page, activate the extension.
2. Generate Cucumber tests in the popup.
3. Click "Review & Merge" on any generated card.
4. A new tab opens at `merge.html`.
5. The header shows the correct issue key.
6. Select "All tests in project" scope, click "Search".
7. If tests exist: both columns render with step rows. Similarity badges appear on matching steps.
8. If no tests exist: "No existing tests found" message appears.
9. Click "Done" — tab closes.

- [ ] **Step 5: End-to-end manual test — Manual flow**

1. Generate Manual tests in the popup (Manual tab).
2. Click "Review & Merge" on any generated card.
3. Merge tab opens. Steps are shown as `action / data / result` mini-columns.
4. "→ Add" appends a manual step to the right column.
5. "✕ Remove" removes a step from the right column.
6. "Save Changes" sends `UPDATE_TEST_STEPS` and shows per-ticket status.

---

## Self-Review Checklist

After writing the complete plan, checks against spec:

| Spec requirement | Covered by |
|---|---|
| "Review & Merge" button on generated cards | Task 10 |
| Cucumber vs Manual type-scoped search | Tasks 1+5 (`testType` param) |
| Search scope: test plan, project, custom JQL | Tasks 1+5 |
| Fuzzy Jaccard matching ≥ 0.6 | Task 4 |
| LLM confirmation (opt-in) | Task 8 |
| Side-by-side two-column layout | Task 3 |
| Existing ticket dropdown | Task 6 |
| Step move: → Add, ← Pull, ✕ Remove | Task 7 |
| Similarity badges with % score | Task 6 |
| Save Changes per-ticket with individual status | Task 9 |
| Done button closes tab | Task 9 |
| No results message + change scope | Tasks 3+5 |
| Xray auth failure inline error | Tasks 1+2 (return `{ success: false, error }`) |
| LLM unavailable disables AI button | Task 5 |
| `GEMINI_PAID_MODELS` duplicated in merge.js | Task 4 |
| No build step, no npm | All tasks — vanilla JS only |
