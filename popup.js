console.log("Popup loaded");

function autoResizeTextarea(textarea) {
  const hiddenSpan = document.createElement("span");
  hiddenSpan.style.visibility = "hidden";
  hiddenSpan.style.position = "absolute";
  hiddenSpan.style.whiteSpace = "pre";
  hiddenSpan.style.fontFamily = getComputedStyle(textarea).fontFamily;
  hiddenSpan.style.fontSize = getComputedStyle(textarea).fontSize;
  hiddenSpan.style.fontWeight = getComputedStyle(textarea).fontWeight;
  document.body.appendChild(hiddenSpan);

  const lines = textarea.value.split("\n");
  let maxWidth = 0;

  lines.forEach((line) => {
    hiddenSpan.innerText = line || " ";
    maxWidth = Math.max(maxWidth, hiddenSpan.offsetWidth);
  });

  textarea.style.width =
    Math.min(maxWidth + 20, window.innerWidth * 0.8) + "px";

  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";

  document.body.removeChild(hiddenSpan);
}

async function fetchPopupOllamaModels(host, savedModel) {
  const bar = document.getElementById("ollama-model-bar");
  const select = document.getElementById("popup-ollama-model");
  if (!bar || !select) return;

  bar.style.display = "flex";
  select.innerHTML = `<option value="">Loading models...</option>`;
  select.disabled = true;

  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);

    if (models.length === 0) {
      select.innerHTML = `<option value="">No models found</option>`;
      return; // finally still runs and re-enables the select
    }

    select.innerHTML = "";
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    // Pre-select saved model, or save the first one if nothing saved yet
    if (savedModel && models.includes(savedModel)) {
      select.value = savedModel;
    } else {
      select.value = models[0];
      chrome.storage.sync.set({ ollamaModel: models[0] });
    }
  } catch (err) {
    console.warn("fetchPopupOllamaModels failed:", err);
    select.innerHTML = `<option value="">Ollama unreachable</option>`;
  } finally {
    select.disabled = false;
  }
}

const GEMINI_PAID_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.0-pro",
  "gemini-1.5-pro",
  "gemini-exp",
  "gemini-pro",
];

async function fetchPopupGeminiModels(apiKey, savedModel) {
  const bar = document.getElementById("gemini-model-bar");
  const select = document.getElementById("popup-gemini-model");
  if (!bar || !select) return;

  bar.style.display = "flex";

  if (!apiKey) {
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "Set Gemini API Key in Settings";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.textContent = "Loading models...";
  select.appendChild(loadingOpt);
  select.disabled = true;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => ({ name: m.name.replace("models/", ""), displayName: m.displayName || m.name.replace("models/", "") }));

    if (models.length === 0) {
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.textContent = "No models found";
      select.appendChild(opt);
      return; // finally still runs and re-enables the select
    }

    select.innerHTML = "";
    models.forEach(({ name, displayName }) => {
      const opt = document.createElement("option");
      const isPaid = GEMINI_PAID_MODELS.some(paid => name.includes(paid));
      opt.disabled = isPaid;
      opt.value = isPaid ? "" : name;
      opt.textContent = isPaid ? `${displayName} (Paid plan required)` : displayName;
      select.appendChild(opt);
    });

    // Pre-select saved model or save the first free-tier one
    const freeModels = models.filter(({ name }) => !GEMINI_PAID_MODELS.some(paid => name.includes(paid)));
    const isSavedFree = savedModel && freeModels.some(m => m.name === savedModel);
    if (isSavedFree) {
      select.value = savedModel;
    } else if (freeModels.length > 0) {
      select.value = freeModels[0].name;
      chrome.storage.sync.set({ geminiModel: freeModels[0].name });
    }
  } catch (err) {
    console.warn("fetchPopupGeminiModels failed:", err);
    select.innerHTML = "";
    const opt = document.createElement("option");
    opt.textContent = "Gemini API unreachable";
    select.appendChild(opt);
  } finally {
    select.disabled = false;
  }
}

/* ===============================
   GHERKIN PARSER
================================= */

function parseGherkinTests(rawText) {
  if (!rawText) return [];

  const firstFeatureIndex = rawText.indexOf("Feature:");
  if (firstFeatureIndex === -1) return [];

  const cleaned = rawText.slice(firstFeatureIndex).trim();

  // Split by each Feature block
  const blocks = cleaned.split(/\n(?=Feature:)/g);

  // Keep only blocks that have both Feature and Scenario
  return blocks
    .map((b) => b.trim())
    .filter(
      (b) => b.length > 0 && b.includes("Feature:") && b.includes("Scenario:"),
    );
}

/* ===============================
   GHERKIN SYNTAX HIGHLIGHTER
================================= */
function highlightGherkin(text) {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Keywords (Only match at the beginning of a line, allowing optional leading spaces)
  const keywords =
    /^(\s*)(Feature|Scenario|Background|Given|When|Then|And|But|Examples|Scenario Outline|Scenario Template)(:?)/gm;
  html = html.replace(keywords, '$1<span class="gh-keyword">$2$3</span>');

  // Titles (Highlight text following Feature/Scenario keywords)
  const titles =
    /^(\s*<span class="gh-keyword">(?:Feature|Scenario|Scenario Outline|Scenario Template|Background):?<\/span>\s*)(.+)$/gm;
  html = html.replace(titles, '$1<span class="gh-title">$2</span>');

  // Tags
  const tags = /@[^\s]+/g;
  html = html.replace(tags, '<span class="gh-tag">$&</span>');

  // Variables <var>
  const vars = /&lt;.*?&gt;/g;
  html = html.replace(vars, '<span class="gh-var">$&</span>');

  // Comments
  const comments = /(?:^|\s)(#.*)/g;
  html = html.replace(comments, ' <span class="gh-comment">$1</span>');

  // Strings "foo" or 'bar'
  const strings = /&quot;.*?&quot;|&#39;.*?&#39;/g;
  html = html.replace(strings, '<span class="gh-string">$&</span>');

  // Prevent scroll jump issues on final newline
  if (html.length > 0 && html[html.length - 1] === "\n") {
    html += " ";
  }
  return html;
}

/* ===============================
   RENDER TEST CARDS (Updated)
================================= */
function renderTests(rawOutput, append = false) {
  const container = document.getElementById("test-list");
  if (!append) container.innerHTML = "";

  const tests = parseGherkinTests(rawOutput);
  tests.forEach((testText) => {
    const card = document.createElement("div");
    card.className = "test-card";
    card.innerHTML = `
      <div class="prompt-card">
        <div class="editor-wrapper">
          <button class="copy-editor-btn" title="Copy test case">&#x1f4c1; Copy</button>
          <pre class="editor-highlight" aria-hidden="true"><code class="editor-code">${highlightGherkin(testText)}</code></pre>
          <textarea class="prompt-editor" spellcheck="false">${testText}</textarea>
        </div>
        <div class="actions">
          <button class="ignore-btn">Ignore</button>
          <button class="create-btn">Create Test</button>
          <button class="xray-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Test</button>
        </div>
      </div>
    `;

    const textarea = card.querySelector(".prompt-editor");
    const codeObj = card.querySelector(".editor-code");
    const preObj = card.querySelector(".editor-highlight");
    const copyBtn = card.querySelector(".copy-editor-btn");

    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(textarea.value).then(() => {
          const originalHTML = copyBtn.innerHTML;
          copyBtn.innerHTML = "\u2713 Copied";
          copyBtn.style.backgroundColor = "#e3fcef";
          setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
            copyBtn.style.backgroundColor = "";
          }, 1500);
        });
      });
    }

    // Sync scrolling and highlighting
    textarea.addEventListener("input", () => {
      codeObj.innerHTML = highlightGherkin(textarea.value);
    });
    textarea.addEventListener("scroll", () => {
      preObj.scrollTop = textarea.scrollTop;
      preObj.scrollLeft = textarea.scrollLeft;
    });

    // Existing Create Test (Jira Issue)
    card.querySelector(".create-btn").onclick = (e) =>
      createTestInJira(e.target, textarea.value.trim());

    // NEW: Xray API Import
    card.querySelector(".xray-btn").onclick = (e) =>
      createXrayTestViaAPI(e.target, textarea.value.trim());

    card.querySelector(".ignore-btn").onclick = () => card.remove();
    container.appendChild(card);
    //autoResizeTextarea(textarea);
  });
}

/* ===============================
   CREATE TEST (using existing session)
================================= */

/*async function createTestInJira(scenario) {
  const originalBtn = window.event.target;
  const card = originalBtn.closest(".test-card");
  const originalText = originalBtn.textContent;

  // Store the scenario text from the textarea
  const textarea = card.querySelector(".prompt-editor");
  const scenarioText = textarea.value.trim();

  // Update button to show loading state
  originalBtn.textContent = "Creating...";
  originalBtn.disabled = true;

  try {
    // Get the original Jira data
    const result = await new Promise((resolve) => {
      chrome.storage.local.get(["jiraData"], resolve);
    });

    const { issueKey } = result.jiraData || {};

    if (!issueKey) {
      throw new Error("No Jira issue data found");
    }

    console.log("Creating test for issue:", issueKey);

    // We need to find the Jira tab and send the message there
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ url: "*://*.atlassian.net/*" }, resolve);
    });

    if (tabs.length === 0) {
      throw new Error("No Jira tab found. Please open the Jira ticket page.");
    }

    // Use the first Jira tab
    const jiraTab = tabs[0];

    // Send message to content script in the Jira tab
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(
        jiraTab.id,
        {
          type: "CREATE_XRAY_TEST",
          scenario: scenarioText,
          originalIssueKey: issueKey,
        },
        resolve,
      );
    });

    if (chrome.runtime.lastError) {
      throw new Error(
        "Could not connect to Jira page. Please refresh the Jira ticket page.",
      );
    }

    if (!response.success) {
      throw new Error(response.error || "Failed to create test");
    }

    const testIssueKey = response.testIssueKey;

    // Update the card to show the created test ticket
    updateCardWithCreatedTest(
      card,
      testIssueKey,
      jiraTab.url.split("/browse/")[0],
    );
  } catch (error) {
    console.error("Error creating test:", error);

    // Restore button with error state
    originalBtn.textContent = "Error - Try Again";
    originalBtn.disabled = false;
    originalBtn.style.backgroundColor = "#ff6b6b";

    // Show temporary error message
    const errorMsg = document.createElement("div");
    errorMsg.className = "error-message";
    errorMsg.textContent = `Failed: ${error.message}`;
    errorMsg.style.color = "#ff6b6b";
    errorMsg.style.fontSize = "12px";
    errorMsg.style.marginTop = "5px";

    const actionsDiv = card.querySelector(".actions");
    actionsDiv.appendChild(errorMsg);

    // Remove error message after 5 seconds
    setTimeout(() => {
      errorMsg.remove();
      originalBtn.textContent = originalText;
      originalBtn.style.backgroundColor = "";
    }, 5000);
  }
}*/

/* ===============================
   UPDATE CARD WITH CREATED TEST
================================= */

function updateCardWithCreatedTest(
  card,
  testIssueKey,
  jiraBaseUrl,
  isXray = false,
) {
  const actionsDiv = card.querySelector(".actions");

  // Remove only the specific button that was used
  if (isXray) {
    const xrayBtn = card.querySelector(".xray-btn");
    const xrayManualBtn = card.querySelector(".xray-manual-btn");
    if (xrayBtn) xrayBtn.remove();
    if (xrayManualBtn) xrayManualBtn.remove();
  } else {
    const createBtn = card.querySelector(".create-btn");
    if (createBtn) createBtn.remove();
  }

  const messageText = isXray
    ? "\u2713 Xray test ticket created:"
    : "\u2713 Test ticket created:";

  // Create the test ticket display
  const testTicketDiv = document.createElement("div");
  testTicketDiv.className = "test-ticket-created";
  testTicketDiv.innerHTML = `
    <span style="color: #36b37e; font-weight: 500;">${messageText}</span>
    <a href="${jiraBaseUrl}/browse/${testIssueKey}" 
       target="_blank" 
       class="test-ticket-link"
       style="margin-left: 5px; color: #0052cc; text-decoration: none;">
      ${testIssueKey}
    </a>
    <span style="margin-left: 5px; color: #666;">
      (opens in new tab)
    </span>
  `;

  // Add click handler to open the ticket
  const link = testTicketDiv.querySelector(".test-ticket-link");
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: link.href });
  });

  // Add a copy button
  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "Copy Link";
  copyBtn.style.marginLeft = "10px";
  copyBtn.style.padding = "2px 8px";
  copyBtn.style.fontSize = "11px";
  copyBtn.style.backgroundColor = "#f4f5f7";
  copyBtn.style.border = "1px solid #dfe1e6";
  copyBtn.style.borderRadius = "3px";
  copyBtn.style.cursor = "pointer";

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(link.href).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = "\u2713 Copied!";
      copyBtn.style.backgroundColor = "#e3fcef";
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = "#f4f5f7";
      }, 2000);
    });
  });

  testTicketDiv.appendChild(copyBtn);
  actionsDiv.appendChild(testTicketDiv);

  // Add a success animation
  card.style.animation = "success-pulse 0.5s ease-in-out";
  setTimeout(() => {
    card.style.animation = "";
  }, 500);
}

/* ===============================
   GENERATE BUTTON ACTION
================================= */

document.getElementById("generate-btn")?.addEventListener("click", () => {
  const loader = document.getElementById("loader");
  const container = document.getElementById("test-list");
  const promptEditor = document.getElementById("prompt-editor");

  const prompt = promptEditor.value;
  if (!prompt || !prompt.trim()) {
    alert("Prompt is empty.");
    return;
  }

  console.log("Sending GENERATE_TESTS message to background script...");

  loader.style.display = "flex";
  const generateBtn = document.getElementById("generate-btn");
  generateBtn.disabled = true;

  setTimeout(() => {
    chrome.runtime.sendMessage(
      { type: "GENERATE_TESTS", prompt },
      (response) => {
        console.log("Received response from background:", response);

        loader.style.display = "none";
        generateBtn.disabled = false;

        if (chrome.runtime.lastError) {
          console.error("Message error:", chrome.runtime.lastError);
          container.innerHTML +=
            "<p style='color:red;'>Could not contact background script.</p>";
          return;
        }

        if (response?.error) {
          console.error("Server error:", response);
          container.innerHTML += `<p style='color:red;'>Server error: ${response.error}</p>`;
          return;
        }

        // Append new test cases to the existing list
        renderTests(response.output, true);
      },
    );
  }, 500);
});

document
  .getElementById("generate-btn-manual")
  ?.addEventListener("click", () => {
    const loader = document.getElementById("loader-manual");
    const container = document.getElementById("test-list-manual");
    const promptEditor = document.getElementById("prompt-editor-manual");

    const prompt = promptEditor.value;
    if (!prompt || !prompt.trim()) {
      alert("Prompt is empty.");
      return;
    }

    loader.style.display = "flex";
    const generateBtn = document.getElementById("generate-btn-manual");
    generateBtn.disabled = true;

    setTimeout(() => {
      chrome.runtime.sendMessage(
        { type: "GENERATE_TESTS", prompt },
        (response) => {
          loader.style.display = "none";
          generateBtn.disabled = false;

          if (chrome.runtime.lastError) {
            container.innerHTML +=
              "<p style='color:red;'>Could not contact background script.</p>";
            return;
          }

          if (response?.error) {
            container.innerHTML += `<p style='color:red;'>Server error: ${response.error}</p>`;
            return;
          }

          renderManualTests(response.output, false);
        },
      );
    }, 500);
  });

/* ===============================
   MAIN
================================= */

document.addEventListener("DOMContentLoaded", () => {
  // Tab switching logic
  const tabLinks = document.querySelectorAll(".tab-link");
  const tabContents = document.querySelectorAll(".tab-content");

  tabLinks.forEach((link) => {
    link.addEventListener("click", () => {
      tabLinks.forEach((btn) => btn.classList.remove("active"));
      tabContents.forEach((content) => content.classList.remove("active"));
      link.classList.add("active");
      document
        .getElementById(link.getAttribute("data-target"))
        .classList.add("active");
    });
  });

  const loader = document.getElementById("loader");
  const loaderManual = document.getElementById("loader-manual");
  const container = document.getElementById("test-list");

  chrome.storage.local.get("jiraData", (result) => {
    const { issueKey, summary, description } = result.jiraData || {};

    if (!issueKey) {
      document.body.innerHTML = "<h2>No Jira issue detected</h2>";
      return;
    }

    const titleText = `${issueKey} - ${summary}`;
    document.getElementById("ticket-title").innerText = titleText;
    document.getElementById("ticket-title-manual").innerText = titleText;

    const prompt = `
You are an expert QA Engineer and AI test case generator. Your task is to analyze requirements from tickets and create Xray test cases in STRICTLY valid Gherkin syntax.

<ticket_summary>
${summary}
</ticket_summary>

<ticket_description>
${description}
</ticket_description>

INSTRUCTIONS:
1. Analyze all business requirements in the ticket.
2. For each requirement, generate at least one independent testcase.
3. Write declarative steps focusing on business rules, not specific UI interactions.
4. Each Feature must contain EXACTLY ONE Scenario. Do not group multiple Scenarios under one Feature.
5. You may use 'And' and 'But' for cleaner syntax alongside 'Given', 'When', 'Then'.
6. Prepare test cases in the chronological order of the requirements in the description.

FORMATTING RULES:
- CRITICAL: Output ONLY raw Gherkin text.
- Do NOT wrap the output in markdown code blocks (no \`\`\`gherkin).
- Do NOT number the Features or Scenarios.
- Do NOT format output of the feature or scenario. Just write plain Gherkin syntax.
- Do NOT output any introductory, concluding, or explanatory text.
- Separate each complete testcase with exactly one blank line. Do not use any other separator. Do not separate Feature from Scenario with any extra blank line or any separator - just new line.
- Only one Scenario for a feature. If there are multiple Scenarios for Feature then define same Feature. You can give in output multiple Feature
- The very first word of your entire response MUST be "Feature:".

EXPECTED STRUCTURE PER TEST CASE:
Feature: <feature title>
Scenario: <scenario title>
Given <precondition>
And <optional additional precondition>
When <action>
Then <expected result>
And <optional additional expected result>
`;

    const promptEditor = document.getElementById("prompt-editor");
    promptEditor.value = prompt;

    // --- MANUAL PROMPT ---
    const manualPrompt = `
You are an expert QA Engineer. Your task is to analyze requirements from tickets and create Manual Test Cases for Xray.

<ticket_summary>
${summary}
</ticket_summary>

<ticket_description>
${description}
</ticket_description>

INSTRUCTIONS:
1. Analyze all business requirements in the ticket.
2. For each requirement, generate at least one independent manual test case.
3. Each test case must strictly follow the JSON format below.
4. Output ONLY valid JSON inside a JSON array. Do not use markdown blocks (\`\`\`json). Do not include introductory text.

EXPECTED JSON FORMAT:
[
  {
    "summary": "<test case title>",
    "steps": [
      {
        "action": "<step action>",
        "data": "<optional test data>",
        "result": "<expected result>"
      }
    ]
  }
]
`;
    const promptEditorManual = document.getElementById("prompt-editor-manual");
    promptEditorManual.value = manualPrompt;

    // Hide loader and enable buttons when data loads
    loader.style.display = "none";
    if (loaderManual) loaderManual.style.display = "none";

    const generateBtn = document.getElementById("generate-btn");
    if (generateBtn) generateBtn.disabled = false;

    const generateBtnManual = document.getElementById("generate-btn-manual");
    if (generateBtnManual) generateBtnManual.disabled = false;

    console.log("Jira data loaded successfully. Ready to generate tests.");
  });

  // Handle LLM Selector UI
  const llmSelector = document.getElementById("llm-selector");
  const logLink = document.getElementById("gemini-log-link");
  const ollamaModelBar = document.getElementById("ollama-model-bar");
  const popupOllamaModel = document.getElementById("popup-ollama-model");
  const geminiModelBar = document.getElementById("gemini-model-bar");
  const popupGeminiModel = document.getElementById("popup-gemini-model");

  if (llmSelector) {
    chrome.storage.sync.get(["defaultAgent", "host", "ollamaModel", "geminiKey", "geminiModel"], (prefs) => {
      const currentAgent = prefs.defaultAgent || "ollama";
      const host = prefs.host || "http://localhost:11434";

      llmSelector.value = currentAgent;

      if (logLink) logLink.style.display = currentAgent === "gemini" ? "inline" : "none";

      if (currentAgent === "ollama") {
        if (geminiModelBar) geminiModelBar.style.display = "none";
        fetchPopupOllamaModels(host, prefs.ollamaModel);
      } else if (currentAgent === "gemini") {
        if (ollamaModelBar) ollamaModelBar.style.display = "none";
        fetchPopupGeminiModels(prefs.geminiKey, prefs.geminiModel);
      }
    });

    llmSelector.addEventListener("change", () => {
      const selectedAgent = llmSelector.value;
      chrome.storage.sync.set({ defaultAgent: selectedAgent }, () => {
        console.log(`Agent switched to: ${selectedAgent}`);
      });

      if (logLink) logLink.style.display = selectedAgent === "gemini" ? "inline" : "none";

      if (selectedAgent === "ollama") {
        if (geminiModelBar) geminiModelBar.style.display = "none";
        chrome.storage.sync.get(["host", "ollamaModel"], (prefs) => {
          const host = prefs.host || "http://localhost:11434";
          fetchPopupOllamaModels(host, prefs.ollamaModel);
        });
      } else if (selectedAgent === "gemini") {
        if (ollamaModelBar) ollamaModelBar.style.display = "none";
        chrome.storage.sync.get(["geminiKey", "geminiModel"], (prefs) => {
          fetchPopupGeminiModels(prefs.geminiKey, prefs.geminiModel);
        });
      }

      llmSelector.style.borderColor = "#4CAF50";
      setTimeout(() => (llmSelector.style.borderColor = "#ccc"), 1000);
    });
  }

  // Save Ollama model to storage when changed in popup
  if (popupOllamaModel) {
    popupOllamaModel.addEventListener("change", () => {
      chrome.storage.sync.set({ ollamaModel: popupOllamaModel.value });
    });
  }

  // Save Gemini model to storage when changed in popup
  if (popupGeminiModel) {
    popupGeminiModel.addEventListener("change", () => {
      chrome.storage.sync.set({ geminiModel: popupGeminiModel.value });
    });
  }

  // Handle opening settings
  const settingsBtn = document.getElementById("open-settings");
  if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
});

/* ===============================
   FIND JIRA TAB
================================= */

async function findJiraTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "*://*.atlassian.net/*" }, (tabs) => {
      if (tabs.length > 0) {
        // Try to find the exact tab with our issue
        const result = chrome.storage.local.get(["jiraTabId"], (result) => {
          if (result.jiraTabId) {
            const exactTab = tabs.find((tab) => tab.id === result.jiraTabId);
            if (exactTab) {
              resolve(exactTab);
              return;
            }
          }
          // Otherwise use the first Jira tab
          resolve(tabs[0]);
        });
      } else {
        resolve(null);
      }
    });
  });
}

/* ===============================
   NEW: CREATE XRAY TEST VIA API
================================= */
/* ===============================
   NEW: CREATE XRAY TEST VIA API (Fixed URL)
================================= */
// Update the function in popup.js
async function createXrayTestViaAPI(btn, scenarioText) {
  const card = btn.closest(".test-card");
  const originalText = btn.textContent;

  // EXTRACTION LOGIC
  const { summary, scenarioValue } = extractGherkinParts(scenarioText);

  btn.textContent = "Syncing Xray...";
  btn.disabled = true;

  try {
    const storage = await chrome.storage.local.get(["jiraData", "jiraTabId"]);
    const { jiraData, jiraTabId } = storage;

    let jiraBaseUrl = "";
    if (jiraTabId) {
      const tab = await chrome.tabs.get(jiraTabId);
      if (tab?.url) jiraBaseUrl = tab.url.split("/browse/")[0];
    }

    if (!jiraBaseUrl) {
      const tabs = await chrome.tabs.query({ url: "*://*.atlassian.net/*" });
      jiraBaseUrl = tabs.length > 0 ? tabs[0].url.split("/browse/")[0] : "";
    }

    chrome.runtime.sendMessage(
      {
        type: "IMPORT_XRAY_TEST",
        scenario: scenarioValue, // Extracted: Scenario + Steps
        testSummary: summary, // Extracted: Feature text
        issueKey: jiraData.issueKey,
      },
      (response) => {
        if (response && response.success) {
          updateCardWithCreatedTest(
            card,
            response.testIssueKey,
            jiraBaseUrl,
            true,
          );
        } else {
          alert("Xray Error: " + (response?.error || "Unknown error"));
          btn.textContent = originalText;
          btn.disabled = false;
        }
      },
    );
  } catch (error) {
    btn.textContent = "Retry";
    btn.disabled = false;
  }
}

function extractGherkinParts(testText) {
  const featureMatch = testText.match(/Feature:\s*(.*)/);
  const scenarioMatch = testText.match(/Scenario:\s*(.*)/);

  const summary = featureMatch ? featureMatch[1].trim() : "Xray Test Case";

  // Extract everything after the Scenario line
  const lines = testText.split("\n");
  const scenarioStartIndex = lines.findIndex((line) =>
    line.includes("Scenario:"),
  );
  const scenarioValue = lines.slice(scenarioStartIndex).join("\n").trim();

  return { summary, scenarioValue };
}

async function createTestInJira(btn, scenarioText) {
  const card = btn.closest(".test-card");
  const originalText = btn.textContent;

  // Extract Feature and Scenario
  const { summary, scenarioValue } = extractGherkinParts(scenarioText);

  btn.textContent = "Linking...";
  btn.disabled = true;

  const { jiraData, jiraTabId } = await chrome.storage.local.get([
    "jiraData",
    "jiraTabId",
  ]);

  // We need the baseUrl to show the final link in the UI
  const tab = await chrome.tabs.get(jiraTabId);
  const jiraBaseUrl = tab.url.split("/browse/")[0];

  chrome.runtime.sendMessage(
    {
      type: "CREATE_STANDARD_JIRA_TICKET",
      scenario: scenarioValue,
      testSummary: summary,
      issueKey: jiraData.issueKey,
      tabId: jiraTabId,
    },
    (response) => {
      if (response && response.success) {
        updateCardWithCreatedTest(card, response.testIssueKey, jiraBaseUrl);
      } else {
        alert("Error: " + response.error);
        btn.textContent = originalText;
        btn.disabled = false;
      }
    },
  );
}

// // Inside DOMContentLoaded...
// chrome.storage.sync.get(["defaultAgent", "host"], (prefs) => {
//   const agentDisplay = document.getElementById("active-llm");
//   const logLink = document.getElementById("gemini-log-link");

//   const currentAgent = prefs.defaultAgent || "ollama";

//   if (currentAgent === "gemini") {
//     agentDisplay.textContent = "Gemini Cloud";
//     agentDisplay.style.background = "#e8f0fe";
//     agentDisplay.style.color = "#1a73e8";
//     logLink.style.display = "flex"; // Show link only for Gemini
//   } else {
//     agentDisplay.textContent = "Ollama (Local)";
//     agentDisplay.style.background = "#f1f3f4";
//     agentDisplay.style.color = "#5f6368";
//     logLink.style.display = "none";
//   }
// });

/* ===============================
   RENDER MANUAL TEST CARDS
================================= */
function renderManualTests(rawOutput, append = false) {
  const container = document.getElementById("test-list-manual");
  if (!append) container.innerHTML = "";

  try {
    const jsonStart = rawOutput.indexOf("[");
    const jsonEnd = rawOutput.lastIndexOf("]") + 1;
    if (jsonStart === -1 || jsonEnd === 0)
      throw new Error("No JSON array found in output.");

    const jsonString = rawOutput.substring(jsonStart, jsonEnd);
    const tests = JSON.parse(jsonString);

    tests.forEach((test, index) => {
      const card = document.createElement("div");
      card.className = "test-card";

      let markdownTable = `| # | Action | Data | Expected Result |\n|---|---|---|---|\n`;
      test.steps.forEach((step, i) => {
        const safeAction = (step.action || "").replace(/\|/g, "\\|");
        const safeData = (step.data || "").replace(/\|/g, "\\|");
        const safeResult = (step.result || "").replace(/\|/g, "\\|");
        markdownTable += `| ${i + 1} | ${safeAction} | ${safeData} | ${safeResult} |\n`;
      });

      card.innerHTML = `
        <div class="prompt-card">
          <div class="manual-summary" contenteditable="true" spellcheck="false" style="font-weight: bold; margin-bottom: 10px; font-size: 15px; color: #172b4d; outline: none; border-bottom: 1px dashed #ccc; padding-bottom: 4px;">Target Summary: ${test.summary}</div>
          <textarea class="manual-markdown-editor" spellcheck="false" style="width: 100%; min-height: 180px; font-family: monospace; font-size: 12px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; resize: vertical; margin-bottom: 15px; background: #fafafa; white-space: pre;">${markdownTable}</textarea>
          <div class="actions">
            <button class="ignore-btn">Ignore</button>
            <button class="create-btn">Create Test</button>
            <button class="xray-manual-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Manual Test</button>
          </div>
        </div>
      `;

      card.querySelector(".ignore-btn").onclick = () => card.remove();

      card.querySelector(".create-btn").onclick = (e) => {
        const editedMarkdown = card.querySelector(
          ".manual-markdown-editor",
        ).value;
        const rawSummary = card
          .querySelector(".manual-summary")
          .innerText.replace(/^Target Summary:\s*/, "")
          .trim();
        let descriptionText = editedMarkdown;

        const btn = e.target;
        const originalText = btn.textContent;
        btn.textContent = "Linking...";
        btn.disabled = true;

        chrome.storage.local
          .get(["jiraData", "jiraTabId"])
          .then(({ jiraData, jiraTabId }) => {
            chrome.tabs.get(jiraTabId).then((tab) => {
              const jiraBaseUrl = tab.url.split("/browse/")[0];
              chrome.runtime.sendMessage(
                {
                  type: "CREATE_STANDARD_JIRA_TICKET",
                  scenario: descriptionText,
                  testSummary: test.summary,
                  issueKey: jiraData.issueKey,
                  tabId: jiraTabId,
                },
                (response) => {
                  if (response && response.success) {
                    updateCardWithCreatedTest(
                      card,
                      response.testIssueKey,
                      jiraBaseUrl,
                      false,
                    );
                  } else {
                    alert("Error: " + response.error);
                    btn.textContent = originalText;
                    btn.disabled = false;
                  }
                },
              );
            });
          });
      };

      card.querySelector(".xray-manual-btn").onclick = (e) => {
        const editedMarkdown = card.querySelector(
          ".manual-markdown-editor",
        ).value;
        const rawSummary = card
          .querySelector(".manual-summary")
          .innerText.replace(/^Target Summary:\s*/, "")
          .trim();

        const parsedSteps = [];
        const lines = editedMarkdown
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("|"));
        if (lines.length > 2) {
          for (let i = 2; i < lines.length; i++) {
            const cells = lines[i]
              .split(/(?<!\\)\|/g)
              .map((c) => c.trim().replace(/\\\|/g, "|"));
            if (cells.length >= 5) {
              const action = cells[2] || "";
              const data = cells[3] || "";
              const result = cells[4] || "";
              if (action || data || result)
                parsedSteps.push({ action, data, result });
            }
          }
        }

        if (parsedSteps.length === 0) {
          alert(
            "Could not parse steps from the markdown table. Make sure the table format is preserved.",
          );
          return;
        }

        const btn = e.target;
        const originalText = btn.textContent;
        btn.textContent = "Syncing Xray...";
        btn.disabled = true;

        chrome.storage.local
          .get(["jiraData", "jiraTabId"])
          .then(({ jiraData, jiraTabId }) => {
            chrome.tabs.get(jiraTabId).then((tab) => {
              let jiraBaseUrl = tab ? tab.url.split("/browse/")[0] : "";
              chrome.runtime.sendMessage(
                {
                  type: "IMPORT_XRAY_MANUAL_TEST",
                  testSummary: rawSummary,
                  steps: parsedSteps,
                  issueKey: jiraData.issueKey,
                },
                (response) => {
                  if (response && response.success) {
                    updateCardWithCreatedTest(
                      card,
                      response.testIssueKey,
                      jiraBaseUrl,
                      true,
                    );
                  } else {
                    alert(
                      "Xray Error: " +
                        (response?.error || JSON.stringify(response)),
                    );
                    btn.textContent = originalText;
                    btn.disabled = false;
                  }
                },
              );
            });
          });
      };

      container.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to parse manual tests:", err);
    container.innerHTML += `<p style='color:red; margin-top: 10px;'>Error parsing LLM output to JSON. The LLM might have returned invalid syntax.</p><pre style="white-space: pre-wrap; font-size: 11px; background:#eee; padding:10px; border-radius:4px;">${rawOutput}</pre>`;
  }
}
