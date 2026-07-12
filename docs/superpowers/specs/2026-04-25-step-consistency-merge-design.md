# Step Consistency & Merge UI — Design Spec

**Date:** 2026-04-25
**Status:** Approved

## Problem

When TestScribe generates new test cases (Cucumber or Manual), there is no mechanism to detect whether similar steps already exist in other test tickets. This causes inconsistent terminology, duplicate steps across the test suite, and no way to update related existing tickets when a new test introduces a better phrasing.

## Goal

After generating tests, allow the user to:
1. Find existing test tickets with similar steps (type-scoped: Cucumber vs Cucumber, Manual vs Manual)
2. See a side-by-side comparison of new and existing steps
3. Decide step-by-step what to push to existing tickets (add / replace / remove)
4. Save those changes back to Xray or JIRA from within the extension

## Approach

**Option B — Dedicated merge tab.** A new `merge.html` page opens as a Chrome tab (matching the pattern used by the existing popup). Data is passed via `chrome.storage.local`. The popup tab remains open for reference.

---

## Architecture

### New Files

| File | Purpose |
|---|---|
| `merge.html` | Merge tab page — side-by-side step comparison UI |
| `merge.js` | Merge tab logic: search scope, fuzzy matching, LLM confirmation, step move actions, write-back |
| `merge.css` | Styles for side-by-side layout |

### Modified Files

| File | Change |
|---|---|
| `popup.js` | Add "Review & Merge" button to each generated card; write `mergeSession` to storage; open merge tab |
| `background.js` | Add `SEARCH_XRAY_TESTS` and `UPDATE_TEST_STEPS` message handlers |
| `manifest.json` | Ensure `merge.html` is accessible as an extension page (web_accessible_resources) |

---

## Data Flow

### 1. Trigger from popup

When the user clicks "Review & Merge" on a generated card, `popup.js` writes to `chrome.storage.local`:

```json
{
  "mergeSession": {
    "generatedTest": {
      "type": "cucumber" | "manual",
      "summary": "...",
      "steps": []
    },
    "issueKey": "PROJ-123",
    "jiraTabId": 42
  }
}
```

Then opens `chrome.runtime.getURL("merge.html")` as a new tab.

### 2. Search scope selection (merge tab)

On load, the merge tab shows a scope picker before fetching existing tests. Options:

| Option | Query |
|---|---|
| Test Plan linked to this ticket | Fetch test plans linked to `issueKey` via Xray API, then fetch all tests in those plans |
| All tests in project | JQL: `project = PROJ AND issuetype = Test` |
| Custom JQL | Free-text input |

The search is **type-scoped**: if `generatedTest.type === "cucumber"`, only `testtype = Cucumber` tickets are returned. If `"manual"`, only `testtype = Manual`.

### 3. Background message: `SEARCH_XRAY_TESTS`

Two-phase fetch:

**Phase 1 — find test issue keys (JIRA REST API):**
- "Test Plan" scope: query JIRA for issues linked to `issueKey` with `issuetype = "Test Plan"`, then call Xray `GET /api/v2/testplans/{testPlanKey}/tests` to get all test keys in those plans
- "All tests in project" scope: `GET /rest/api/3/search?jql=project=PROJ AND issuetype=Test`
- "Custom JQL" scope: user-supplied JQL via JIRA REST search

**Phase 2 — fetch steps (Xray API):**
For each test key found, call Xray to get steps:
- Cucumber: `GET /api/v2/test/{testIssueId}/gherkin` → returns Gherkin text
- Manual: `GET /api/v2/test/{testIssueId}/steps` → returns step objects

Authenticates with Xray (`clientId`/`clientSecret`) only for Phase 2. Phase 1 uses JIRA session cookies (same-origin fetch from the extension, matching the existing `handleStandardJiraCreate` pattern).

Returns:

```json
[
  {
    "key": "PROJ-45",
    "summary": "...",
    "testtype": "Cucumber" | "Manual",
    "steps": []
  }
]
```

For Cucumber tickets, `steps` are individual Gherkin lines (strings). For Manual tickets, `steps` are `{ action, data, result }` objects.

### 4. Fuzzy matching (client-side, `merge.js`)

For each step in the generated test, compute **Jaccard token similarity** against every step from every returned existing ticket. Steps scoring ≥ 0.6 are flagged as candidate duplicates and shown with a similarity badge (e.g. `~82% match`).

This produces a shortlist — not a verdict.

### 5. LLM confirmation (opt-in)

A "Confirm with AI" button sends flagged candidate pairs to Ollama/Gemini:

> "Are these test steps semantically equivalent? Answer yes or no for each pair."

Returns a per-pair boolean. This is a single extra LLM call, user-triggered. If the LLM backend is unavailable, the button is disabled with a tooltip.

### 6. Background message: `UPDATE_TEST_STEPS`

Writes step changes back per ticket. Bulk import is for *creating* tests — updating existing tests requires different endpoints:

- **Xray Cucumber tickets**: `PUT /api/v2/test/{testIssueId}/gherkin` — replaces the full Gherkin definition
- **Xray Manual tickets**: `PUT /api/v2/test/{testIssueId}/steps` — replaces the full step list
- **Standard JIRA tickets**: `PUT /rest/api/3/issue/{key}` — overwrites the description field with the updated step content

Per-ticket success/failure reported independently — a failure on one ticket does not block others.

---

## Merge UI

### Layout

Two fixed columns side by side:

```
[ Generated Test (new)    ] ←→ [ Existing Ticket (dropdown) ]
```

The **right column** has a dropdown to switch between matched existing tickets. The left column stays fixed.

### Step Rows

Each step row contains:
- Step text (editable inline)
- Similarity badge between columns on flagged steps (`~82% match`)
- `→` button: push this generated step to the existing ticket
- `←` button: pull the existing step into the generated test

Actions on right-column steps:
- `Add` — append the generated step after this position
- `Replace` — swap this existing step with the generated one
- `Remove` — delete this step from the existing ticket

### Type-specific rendering

| Type | Step display |
|---|---|
| Cucumber | Gherkin lines with syntax highlighting (reuses existing `highlightGherkin` logic) |
| Manual | `{ action, data, result }` rendered as a mini 3-column table; arrows move whole rows |

### Bottom bar

| Button | Action |
|---|---|
| `Save Changes` | Sends `UPDATE_TEST_STEPS` for each modified existing ticket |
| `Done` | Closes the merge tab |

Per-ticket save status shown inline after save attempt.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No existing tests found | "No existing tests found in this scope" message + option to change scope |
| No fuzzy candidates | "No similar steps detected" per step; manual arrow moves still available |
| Xray auth failure | Inline red error + Retry button |
| Partial save failure | Per-ticket status reported; successful tickets not blocked |
| LLM unavailable | "Confirm with AI" button disabled with tooltip; fuzzy-only still works |
| Standard JIRA (non-Xray) | Step updates overwrite the issue description via JIRA REST API |

---

## Constraints

- No build step, no npm, no TypeScript — vanilla ES6+ only
- No new dependencies — only browser APIs and Chrome Extension APIs
- `GEMINI_PAID_MODELS` constant must remain duplicated across `background.js`, `options.js`, `popup.js`, and now `merge.js` — keep all four in sync
- JIRA selectors already use `data-testid` attributes (brittle) — no new DOM scraping introduced by this feature
- All network calls use `async/await`
