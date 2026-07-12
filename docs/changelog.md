# Changelog & Feature Releases (Post-v1.0.0)

This document details all the new features, UX refinements, and backend improvements added to TestScribe since the initial release.

---

## Groq Cloud, Custom OpenAI & Context Limits (Latest Updates)

This update expands the available LLM engines to support free cloud inference and local reasoning models, along with prompt size optimization.

### 🚀 New Features & Connectors
* **Groq Cloud Integration**: Connect directly to Groq's high-speed cloud inference. Supporting free cloud keys for Llama 3 and Mixtral.
* **Custom OpenAI-Compatible Connector**: Connect to local LLM servers (LM Studio, LocalAI) or other popular cloud providers (DeepSeek Cloud, OpenRouter) via the standard OpenAI REST specification.
* **Dynamic Model Loaders**: Added dynamic model list loading from host `/models` endpoints inside both the Settings page and the Popup selector.
* **Prompt Steps Limit Control**: Added a new settings toggle under *Context Enrichment* allowing users to enable/disable or configure the exact number of reusable library steps attached to the system prompt (defaults to `30`).
* **Interactive Tab Link**: The disabled steps limit warning displays a clickable link that automatically switches focus to the *Integration* tab if you haven't run a sync yet.

### 🛠️ Robustness & Fixes
* **Reasoning Model Protection**: Automatically detects and strips `<think>...</think>` tags from LLM outputs (e.g., DeepSeek-R1) to prevent parser failures and keep Gherkin editors clean.
* **Response Truncation Fix**: Configured `max_tokens: 4096` payload parameters to ensure reasoning models have enough token space to write the full scenarios.

---

## Step Consistency & Merge Panel

Introduced the **Review & Merge** dashboard to compare generated tests side-by-side with existing Jira/Xray tests and enforce step consistency.

### 🚀 New Features
* **Dual-Column Merge View**: View generated scenarios alongside existing test steps.
* **Fuzzy Step Matcher**: Runs Jaccard similarity to show matched steps in real-time, color-coded by match strength:
  * High match (>= 80% similarity): Highlighted in green, recommending the exact wording.
  * Medium match (>= 50% similarity): Highlighted in yellow, suggesting potential alignments.
* **Jaccard Similarity Algorithm**: Compares the clean token sets of the generated step against every step in the synced step library, stripping Gherkin keywords (`Given`, `When`, `Then`, `And`, `But`) to compare exact semantic overlap:
  $$\text{Similarity} = \frac{|A \cap B|}{|A \cup B|}$$
* **Autocomplete Gherkin Dropdown**: Integrated an interactive step autocomplete search inside test steps editors. When editing a Gherkin step, typing triggers a case-insensitive substring search across all unique steps in the synced project library, displaying matches in a dropdown that can be navigated with arrow keys or mouse.
* **Single-Click Add/Edit**: Drag, insert, delete, or autocomplete steps to quickly align your new scenario with existing project standards.

### 🎨 UX Refinements & Algorithms
* **Improved Target Ticket Auto-Selector (Best Match Logic)**: When looking for the most relevant existing test to merge into, the system ranks candidate tickets using a smart matching algorithm:
  1. For each candidate ticket, every generated step is matched against all of that ticket's existing steps to find its maximum individual Jaccard similarity score.
  2. The sum of these maximum similarity scores is calculated for each ticket.
  3. The ticket with the highest cumulative similarity score is automatically pre-selected, ensuring the suggested target has the highest overall step correlation.
* **Clickable Saved Ticket Logs**: Successful save logs now display ticket IDs as clickable Jira links opening in new browser tabs.
* **Context-aware Search dropdown**: Dropdown options inside the search scope dynamically display the active ticket number and project key prefix (e.g. *All tests in TS project*).
* **Targeted Save Button**: The "Save Changes" button label dynamically appends the target ticket key (e.g. *Save Changes (TS-102)*).

---

## Context Enrichment & Prompt Architecture

Introduces a background-fetching mechanism to inject relevant high-level context (like Epic/Story descriptions) directly into the generation prompt.

### 🚀 Key Capabilities & Architecture
* **Epic/Story (Parent Ticket) Context**: The system automatically queries Jira for the parent issue of the current ticket (if it exists) and fetches its summary and description. It wraps this information in `<parent_ticket>` tags in the prompt, giving the AI access to epic-level constraints or story context.
* **Interactive Context Panel**: Adds a collapsible panel inside the extension popup between the ticket details and prompt editor. The discovered parent ticket is listed, allowing users to choose whether to load and attach this context.
* **Flexible settings options**:
  * **Include parent ticket by default**: Automatically check parent tickets when discovered.
  * **Hide Context Panel**: Hide the panel entirely in the popup for users who want to write/edit prompts without extra context elements.
  * **UX ordering**: Toggles are sorted logically with the most general options at the top.
