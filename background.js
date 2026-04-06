console.log("Background service worker started");

const GEMINI_PAID_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.0-pro",
  "gemini-1.5-pro",
  "gemini-exp",
  "gemini-pro",
];

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["host", "defaultAgent"], (prefs) => {
    const updates = {};
    if (!prefs.host) updates.host = "http://localhost:11434";
    if (!prefs.defaultAgent) updates.defaultAgent = "ollama";
    
    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates, () => {
        console.log("Initialized default settings:", updates);
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "IMPORT_XRAY_TEST") {
    handleXrayImport(message).then(sendResponse);
    return true;
  }

  if (message.type === "IMPORT_XRAY_MANUAL_TEST") {
    handleXrayManualImport(message).then(sendResponse);
    return true;
  }

  if (message.type === "CREATE_STANDARD_JIRA_TICKET") {
    handleStandardJiraCreate(message).then(sendResponse);
    return true;
  }

  if (message.type === "GENERATE_TESTS") {
    const prompt = message.prompt;

    chrome.storage.sync.get(
      ["defaultAgent", "host", "geminiKey", "ollamaModel", "geminiModel"],
      async (prefs) => {
        const agent = prefs.defaultAgent || "ollama";

        try {
          let outputText = "";

          if (agent === "gemini") {
            if (!prefs.geminiKey) throw new Error("Gemini API Key missing.");

            let geminiModel = prefs.geminiModel;

            // Fallback: if no model saved, fetch and pick first free-tier model
            if (!geminiModel) {
              const modelsUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${prefs.geminiKey}`;
              const modelsRes = await fetch(modelsUrl);
              if (!modelsRes.ok) throw new Error(`Could not fetch Gemini models: HTTP ${modelsRes.status}`);
              const modelsData = await modelsRes.json();

              const freeTierModels = (modelsData.models || [])
                .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
                .map(m => m.name.replace("models/", ""))
                .filter(name => !GEMINI_PAID_MODELS.some(paid => name.includes(paid)));

              if (freeTierModels.length === 0) throw new Error("No free-tier Gemini models found for this API key.");

              geminiModel = freeTierModels[0];
              chrome.storage.sync.set({ geminiModel }, () => {
                if (chrome.runtime.lastError) {
                  console.warn("Failed to persist geminiModel:", chrome.runtime.lastError.message);
                }
              });
            }

            console.log(`Using Gemini model: ${geminiModel}`);

            const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${prefs.geminiKey}`;
            const response = await fetch(genUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                safetySettings: [
                  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                ],
              }),
            });

            if (response.status === 403) {
              throw new Error("This model requires a paid Gemini API plan. Select a free-tier model in Settings or the popup.");
            }
            if (response.status === 429) {
              throw new Error("Gemini API rate limit exceeded. Wait a moment and try again, or select a different model.");
            }

            if (!response.ok) {
              const errData = await response.json();
              throw new Error(`Gemini Error: ${errData.error?.message || response.statusText}`);
            }

            const data = await response.json();
            outputText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            if (!outputText) console.warn("Gemini returned an empty response. Model may have blocked the content.");
          } else {
            // Direct Ollama native API
            const ollamaHost = prefs.host || "http://localhost:11434";
            let ollamaModel = prefs.ollamaModel;

            // Fallback: if no model saved, fetch the first available one
            if (!ollamaModel) {
              const tagsRes = await fetch(`${ollamaHost}/api/tags`);
              if (!tagsRes.ok) throw new Error(`Ollama /api/tags failed (${tagsRes.status}) at ${ollamaHost}`);
              let tagsData;
              try {
                tagsData = await tagsRes.json();
              } catch {
                throw new Error(`Ollama /api/tags returned invalid JSON from ${ollamaHost}`);
              }
              const models = (tagsData?.models || []).map(m => m.name);
              if (models.length === 0) throw new Error("No Ollama models installed. Run 'ollama pull <model>' first.");
              ollamaModel = models[0]; // fallback: pick first available; no priority preference for local models
              // Persist the auto-selected model so the UI stays in sync
              chrome.storage.sync.set({ ollamaModel }, () => {
                if (chrome.runtime.lastError) {
                  console.warn("Failed to persist ollamaModel:", chrome.runtime.lastError.message);
                }
              });
            }

            const response = await fetch(`${ollamaHost}/api/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model: ollamaModel, prompt, stream: false }),
            });

            if (!response.ok) {
              throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            outputText = data.response || "";
          }

          sendResponse({ output: outputText });
        } catch (err) {
          console.error("LLM Selection Error:", err);
          sendResponse({ output: null, error: err.toString() });
        }
      },
    );

    return true;
  }
});

// FIXED: Handle extension icon click with correct scoping
chrome.action.onClicked.addListener(async (tab) => {
  const tabId = tab.id;

  try {
    chrome.tabs.sendMessage(tabId, { type: "PING" }, async (response) => {
      if (chrome.runtime.lastError) {
        console.log("Injecting content script...");
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        });
      }
      // Trigger the data extraction helper
      getJiraDataAndOpenPopup(tabId);
    });
  } catch (error) {
    console.error("Injection Error:", error);
    openPopupWithData(null, tabId);
  }
});

// FIXED: Consolidated storage and popup logic
function getJiraDataAndOpenPopup(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "GET_JIRA_DATA" }, (extractedData) => {
    if (chrome.runtime.lastError || !extractedData) {
      openPopupWithData(null, tabId);
    } else {
      openPopupWithData(extractedData, tabId);
    }
  });
}

function openPopupWithData(data, tabId) {
  chrome.storage.local.set(
    {
      jiraData: data,
      jiraTabId: tabId,
    },
    () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    },
  );
}

/* ===============================
   XRAY IMPORT LOGIC
================================= */

async function handleXrayImport(data) {
  try {
    const settings = await chrome.storage.sync.get([
      "clientId",
      "clientSecret",
      "projectKey",
    ]);

    if (!settings.clientId || !settings.clientSecret) {
      return {
        success: false,
        error: "Xray credentials not found in Settings.",
      };
    }

    const authRes = await fetch(
      "https://xray.cloud.getxray.app/api/v2/authenticate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
        }),
      },
    );

    if (!authRes.ok) throw new Error(`Auth Failed: ${authRes.status}`);

    const rawToken = await authRes.text();
    const token = rawToken.replace(/"/g, "");

    // const projectKey = settings.projectKey || data.issueKey.split("-")[0];

    // Use the extracted summary from the popup, fall back to issue key if missing
    const finalSummary = data.testSummary || `Xray Test for ${data.issueKey}`;
    const projectKey = settings.projectKey || data.issueKey.split("-")[0];

    const payload = [
      {
        testtype: "Cucumber",
        fields: {
          summary: finalSummary, // This will now be "Basic Functionality"
          project: { key: projectKey },
        },
        gherkin_def: data.scenario, // This will now start from "Scenario: ..."
        update: {
          issuelinks: [
            {
              add: {
                type: { name: "Test" },
                outwardIssue: { key: data.issueKey },
              },
            },
          ],
        },
      },
    ];

    const importRes = await fetch(
      "https://xray.cloud.getxray.app/api/v2/import/test/bulk",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      },
    );

    const result = await importRes.json();

    if (importRes.ok) {
      if (result.jobId) {
        return await pollXrayJobStatus(result.jobId, token);
      } else if (Array.isArray(result) && result.length > 0) {
        return { success: true, testIssueKey: result[0].key };
      }
    }
    throw new Error(`Import Failed: ${JSON.stringify(result)}`);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleXrayManualImport(data) {
  try {
    const settings = await chrome.storage.sync.get([
      "clientId",
      "clientSecret",
      "projectKey",
    ]);

    if (!settings.clientId || !settings.clientSecret) {
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const authRes = await fetch("https://xray.cloud.getxray.app/api/v2/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      }),
    });

    if (!authRes.ok) throw new Error(`Auth Failed: ${authRes.status}`);

    const rawToken = await authRes.text();
    const token = rawToken.replace(/"/g, "");

    const finalSummary = data.testSummary || `Xray Manual Test for ${data.issueKey}`;
    const projectKey = settings.projectKey || data.issueKey.split("-")[0];

    const payload = [
      {
        testtype: "Manual",
        fields: {
          summary: finalSummary,
          project: { key: projectKey },
        },
        steps: data.steps.map(s => ({
          action: s.action || "",
          data: s.data || "",
          result: s.result || ""
        })),
        update: {
          issuelinks: [
            {
              add: {
                type: { name: "Test" },
                outwardIssue: { key: data.issueKey },
              },
            },
          ],
        },
      },
    ];

    const importRes = await fetch("https://xray.cloud.getxray.app/api/v2/import/test/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const result = await importRes.json();

    if (importRes.ok) {
      if (result.jobId) {
        return await pollXrayJobStatus(result.jobId, token);
      } else if (Array.isArray(result) && result.length > 0) {
        return { success: true, testIssueKey: result[0].key };
      }
    }
    throw new Error(`Import Failed: ${JSON.stringify(result)}`);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pollXrayJobStatus(jobId, token) {
  const maxAttempts = 30;
  const delay = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const statusRes = await fetch(
        `https://xray.cloud.getxray.app/api/v2/import/test/bulk/${jobId}/status`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!statusRes.ok) continue;

      const data = await statusRes.json();

      // Xray status can be "SUCCESSFUL", "FAILED", "WORKING", or "TODO"
      const status = data.status.toUpperCase();

      if (status === "SUCCESSFUL") {
        // FIXED: Using optional chaining to handle different response variations
        const issueKey = data.result?.issues?.[0]?.key || data.result?.[0]?.key;

        if (issueKey) {
          return { success: true, testIssueKey: issueKey };
        } else {
          // Fallback check if result is an array directly
          if (Array.isArray(data.result) && data.result[0]?.key) {
            return { success: true, testIssueKey: data.result[0].key };
          }
          throw new Error(
            "Job succeeded but issue key was not found in result.",
          );
        }
      }

      if (status === "FAILED") {
        throw new Error(
          `Xray Import Failed: ${JSON.stringify(data.errors || data.result?.errors)}`,
        );
      }
    } catch (err) {
      if (err.message.includes("not found") || err.message.includes("Failed")) {
        return { success: false, error: err.message };
      }
    }
  }
  return { success: false, error: "Xray Import timed out." };
}

async function handleStandardJiraCreate(data) {
  try {
    const tab = await chrome.tabs.get(data.tabId);
    const baseUrl = tab.url.split("/browse/")[0];
    const projectKey = data.issueKey.split("-")[0];

    // 1. Create the Jira Issue
    const issueResponse = await fetch(`${baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: data.testSummary,
          issuetype: { name: "Task" },
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: data.scenario }],
              },
            ],
          },
        },
      }),
    });

    if (!issueResponse.ok) {
      const errBody = await issueResponse.text();
      throw new Error(
        `Issue Creation Failed: ${issueResponse.status} - ${errBody}`,
      );
    }
    const newIssue = await issueResponse.json();

    // 2. LINKING LOGIC: Try multiple common names
    // Jira Cloud often uses "Tests" or "Tested by"
    const linkNames = ["Tests", "Test", "Tested by", "Relates"];
    let linked = false;

    for (const name of linkNames) {
      if (linked) break;

      const linkRes = await fetch(`${baseUrl}/rest/api/3/issueLink`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Atlassian-Token": "no-check",
        },
        body: JSON.stringify({
          type: { name: name },
          inwardIssue: { key: newIssue.key }, // The New Test Ticket
          outwardIssue: { key: data.issueKey }, // The Original Requirement (HP-126)
        }),
      });

      if (linkRes.ok) {
        console.log(`Successfully linked using type: ${name}`);
        linked = true;
      }
    }

    return { success: true, testIssueKey: newIssue.key };
  } catch (err) {
    console.error("Standard Create/Link Error:", err);
    return { success: false, error: err.message };
  }
}
