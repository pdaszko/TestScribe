# Context Enrichment (Sub-project A) — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Problem

The LLM prompt currently only receives the current ticket's summary and description. This produces test steps that may use different terminology from the actual codebase and business domain — because the LLM has no access to the Epic context, linked specs, or Confluence documentation where the real domain language lives.

## Goal

Allow the user to optionally enrich the LLM prompt with:
1. **Parent ticket** (summary + description + comments)
2. **Confluence pages** linked anywhere in the ticket or its parent (description, comments, remote links)

The result: generated test steps that use the same naming conventions and domain language as developers and business analysts.

**Not in scope for this sub-project:** GitHub links, local repositories, OpenAPI/Swagger, Notion, Google Docs.

---

## Architecture

### Modified Files

| File | Change |
|---|---|
| `background.js` | Add `FETCH_CONTEXT_METADATA` and `FETCH_CONTEXT_CONTENT` message handlers |
| `popup.js` | Add context panel (checkboxes + "Load extra context" button); inject fetched content into prompt |
| `options.js` | Add three new settings fields |
| `options.html` | Add "Context Enrichment" section to settings page |

### New Storage Keys (`chrome.storage.sync`)

| Key | Type | Default | Purpose |
|---|---|---|---|
| `contextPanelHidden` | boolean | false | Hide panel in popup; auto-load all sources on Generate |
| `contextDefaultParent` | boolean | true | Default checkbox state for parent ticket |
| `contextDefaultConfluence` | boolean | true | Default checkbox state for Confluence pages |

---

## Data Flow

### Phase 1: Metadata fetch (on popup load)

When the popup loads and the context panel is visible, `popup.js` sends `FETCH_CONTEXT_METADATA` to `background.js`. This is a lightweight call that returns only titles and keys — no full content yet.

**Message (outbound):**
```javascript
{
  type: "FETCH_CONTEXT_METADATA",
  issueKey: "PROJ-123",
  issueDescription: "...already in jiraData storage...",  // passed to avoid redundant fetch
  jiraTabId: 42
}
```

**background.js fetches (in parallel):**
- `GET /rest/api/3/issue/{issueKey}?fields=parent,summary,description` → parent key + summary; description used as fallback if not passed in message
- `GET /rest/api/3/issue/{issueKey}/remotelink` → remote links for ticket
- `GET /rest/api/3/issue/{parentKey}/remotelink` → remote links for parent (if parent exists)

Confluence URLs are detected by matching `*.atlassian.net/wiki/*` in:
- Ticket description text
- Parent ticket description text
- Ticket comments (`GET /rest/api/3/issue/{issueKey}/comment`)
- Parent comments (`GET /rest/api/3/issue/{parentKey}/comment`)
- Ticket remote links (above)
- Parent remote links (above)

For each discovered Confluence URL, fetch page title via:
`GET /wiki/rest/api/content/{pageId}` — title is included in the default response, no extra params needed

**Response:**
```javascript
{
  success: true,
  parent: { key: "PROJ-45", summary: "Epic: Payment Flow" } | null,
  confluencePages: [
    { pageId: "123456", title: "Payment API Spec", url: "https://..." },
    { pageId: "789012", title: "Domain Model", url: "https://..." }
  ]
}
```

### Phase 2: Context panel renders

`popup.js` renders the panel below the ticket title, above the prompt editor:

```
─────────────────────────────────────────────
  Extra context (used in prompt):
  ☑ Parent: PROJ-45 — Epic: Payment Flow
  ☑ Confluence: Payment API Spec
  ☑ Confluence: Domain Model
  [Load extra context]   (disabled if all unchecked)
─────────────────────────────────────────────
```

- Each item uses the default checkbox state from settings
- "Load extra context" button disabled when all checkboxes unchecked
- If no parent and no Confluence pages found: panel is hidden entirely

### Phase 3: User clicks "Load extra context"

`popup.js` sends `FETCH_CONTEXT_CONTENT` with the list of checked sources.

**Message:**
```javascript
{
  type: "FETCH_CONTEXT_CONTENT",
  issueKey: "PROJ-123",
  jiraTabId: 42,
  includeParent: true,
  confluencePageIds: ["123456", "789012"]
}
```

**background.js fetches (checked sources only):**

**Parent ticket content:**
- `GET /rest/api/3/issue/{parentKey}?fields=summary,description`
- `GET /rest/api/3/issue/{parentKey}/comment` → concatenate comment bodies

**Each Confluence page:**
- `GET /wiki/rest/api/content/{pageId}?expand=body.view` → strip HTML tags to plain text
- Truncate at 3000 words; append `(content truncated)` if truncated

**Response:**
```javascript
{
  success: true,
  parent: {
    key: "PROJ-45",
    summary: "...",
    description: "...",
    comments: "..."
  } | null,
  confluencePages: [
    { pageId: "123456", title: "Payment API Spec", content: "..." },
    { pageId: "789012", title: "Domain Model", content: "..." }
  ],
  errors: [
    { pageId: "999", title: "Restricted Page", error: "403" }
  ],
  confluenceAccessDenied: false   // true if ALL confluence fetches returned 403/401
}
```

### Phase 4: Inject into prompt

`popup.js` appends an `<additional_context>` block to both the Cucumber and Manual prompts, immediately after `</ticket_description>`:

```
<additional_context>
[Parent ticket: PROJ-45 — Epic: Payment Flow]
Description: ...
Comments: ...

[Confluence: Payment API Spec]
...page content (up to 3000 words)...

[Confluence: Domain Model]
...page content (up to 3000 words)...
</additional_context>

IMPORTANT: Use the terminology, naming conventions, and domain language from <additional_context> when writing test steps. Prefer existing names for entities, actions, and states over inventing new ones.
```

The "Load extra context" button changes to "✓ Context loaded" (green, disabled) after success.

---

## Settings UI (`options.html`)

New section added at the bottom of the settings page:

```
── Context Enrichment ──────────────────────

☑ Include parent ticket by default
☑ Include Confluence pages by default
☐ Hide "Load extra context" panel (auto-load on Generate)

```

When "Hide panel" is checked: the two default checkboxes become irrelevant labels (both treated as checked = auto-load all). A note explains: "When hidden, all available context is loaded automatically when you click Generate."

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No parent ticket | Parent checkbox not rendered |
| No Confluence links found anywhere | Confluence section not rendered; if also no parent → entire panel hidden |
| Single Confluence page returns 403/404 | That page skipped; status note: "1 page could not be loaded" |
| All Confluence pages return 403/401 | `confluenceAccessDenied: true` → single message: "Confluence pages could not be accessed — check your Confluence permissions" |
| JIRA REST call fails during metadata | Panel hidden; no error shown (silent — doesn't block generation) |
| JIRA REST call fails during content fetch | Inline error below the button: "Could not load context — check your JIRA session" |
| Confluence page content > 3000 words | Truncated; `(content truncated)` appended in prompt |
| Panel hidden + auto-load fails | Generation proceeds with original prompt only; silent failure |
| All sources fail | Generation proceeds normally with original prompt; error shown below button |

---

## Constraints

- Vanilla ES6+, no build step, no npm
- Authentication: Atlassian Cloud session cookie is shared across JIRA and Confluence on `*.atlassian.net` — no separate login needed; permissions enforced per-page by Confluence
- All JIRA/Confluence REST calls made from `background.js` following existing `handleStandardJiraCreate` pattern
- Confluence URL detection uses regex: `/https?:\/\/[^/]+\.atlassian\.net\/wiki\/[^\s"')]+/g`
- Confluence page ID extracted from URL: `/wiki/spaces/.../pages/{pageId}/` or `/wiki/pages/viewpage.action?pageId={pageId}`
- Panel renders for both Cucumber and Manual tabs (same context, injected into both prompts)
