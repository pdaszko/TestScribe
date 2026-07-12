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

  if (message.type === "SEARCH_XRAY_TESTS") {
    handleSearchXrayTests(message).then(sendResponse);
    return true;
  }

  if (message.type === "UPDATE_TEST_STEPS") {
    handleUpdateTestSteps(message).then(sendResponse);
    return true;
  }

  if (message.type === "FETCH_CONTEXT_METADATA") {
    handleFetchContextMetadata(message).then(sendResponse);
    return true;
  }

  if (message.type === "FETCH_CONTEXT_CONTENT") {
    handleFetchContextContent(message).then(sendResponse);
    return true;
  }

  if (message.type === "SYNC_STEPS_LIBRARY") {
    handleSyncStepsLibrary(message.syncOnlyFailed).then(sendResponse);
    return true;
  }

  if (message.type === "GENERATE_TESTS") {
    handleGenerateTests(message).then(sendResponse);
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

async function handleGenerateTests(message) {
  const prompt = message.prompt;
  const prefs = await chrome.storage.sync.get([
    "defaultAgent", "host", "geminiKey", "ollamaModel", "geminiModel", "mtplxHost", "mtplxModel",
    "groqKey", "groqModel", "openaiHost", "openaiKey", "openaiModel"
  ]);
  const agent = prefs.defaultAgent || "ollama";

  try {
    let outputText = "";

    if (agent === "gemini") {
      if (!prefs.geminiKey) throw new Error("Gemini API Key missing.");

      let geminiModel = prefs.geminiModel;

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
        await chrome.storage.sync.set({ geminiModel });
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
    } else if (agent === "mtplx") {
      const mtplxHost = prefs.mtplxHost || "http://127.0.0.1:8000";
      let mtplxModel = prefs.mtplxModel;

      if (!mtplxModel) {
        const modelsRes = await fetch(`${mtplxHost}/v1/models`);
        if (!modelsRes.ok) throw new Error(`Could not fetch MTPLX models: HTTP ${modelsRes.status}`);
        const modelsData = await modelsRes.json();
        const models = (modelsData.data || []).map(m => m.id);
        if (models.length === 0) throw new Error("No MTPLX models found.");
        mtplxModel = models[0];
        await chrome.storage.sync.set({ mtplxModel });
      }

      console.log(`Using MTPLX model: ${mtplxModel} at ${mtplxHost}`);

      const response = await fetch(`${mtplxHost}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: mtplxModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096
        }),
      });

      if (!response.ok) {
        throw new Error(`MTPLX error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      outputText = data.choices?.[0]?.message?.content || "";
    } else if (agent === "groq") {
      if (!prefs.groqKey) throw new Error("Groq API Key missing. Please configure it in Settings.");
      let groqModel = prefs.groqModel;

      if (!groqModel) {
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${prefs.groqKey}` }
        });
        if (!res.ok) throw new Error(`Could not fetch Groq models: HTTP ${res.status}`);
        const data = await res.json();
        const models = (data.data || []).map(m => m.id);
        if (models.length === 0) throw new Error("No Groq models found.");
        groqModel = models[0];
        await chrome.storage.sync.set({ groqModel });
      }

      console.log(`Using Groq model: ${groqModel}`);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${prefs.groqKey}`
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        throw new Error(`Groq error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      outputText = data.choices?.[0]?.message?.content || "";
    } else if (agent === "openai") {
      const openaiHost = prefs.openaiHost || "";
      if (!openaiHost) throw new Error("Custom OpenAI Host URL missing. Please configure it in Settings.");
      const openaiModel = prefs.openaiModel || "custom-model";
      const headers = { "Content-Type": "application/json" };
      if (prefs.openaiKey) {
        headers["Authorization"] = `Bearer ${prefs.openaiKey}`;
      }

      console.log(`Using Custom OpenAI model: ${openaiModel} at ${openaiHost}`);
      const response = await fetch(`${openaiHost}/chat/completions`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: openaiModel,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 4096
        })
      });

      if (!response.ok) {
        throw new Error(`Custom OpenAI error: ${response.status} ${await response.text()}`);
      }

      const data = await response.json();
      outputText = data.choices?.[0]?.message?.content || "";
    } else {
      // Direct Ollama native API
      const ollamaHost = prefs.host || "http://localhost:11434";
      let ollamaModel = prefs.ollamaModel;

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
        ollamaModel = models[0];
        await chrome.storage.sync.set({ ollamaModel });
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

    if (outputText) {
      outputText = outputText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }
    return { output: outputText };
  } catch (err) {
    console.error("LLM Selection Error:", err);
    return { output: null, error: err.toString() };
  }
}

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

    const token = await getXrayToken(settings.clientId, settings.clientSecret);

    // const projectKey = settings.projectKey || data.issueKey.split("-")[0];

    const projectKey = settings.projectKey || data.issueKey.split("-")[0];

    // Parser for Cucumber Gherkin:
    const lines = (data.scenario || "").split("\n").map(l => l.trim());
    let featureTitle = data.testSummary || "";
    let scenarioTitle = "";
    let steps = [];
    let inSteps = false;

    for (const line of lines) {
      if (line.startsWith("Feature:")) {
        featureTitle = line.replace(/^Feature:/i, "").trim();
      } else if (line.startsWith("Scenario:")) {
        scenarioTitle = line.replace(/^Scenario:/i, "").trim();
        inSteps = true;
      } else if (inSteps) {
        steps.push(line);
      } else if (line.length > 0) {
        steps.push(line);
      }
    }

    const finalSummary = featureTitle || data.testSummary || `Xray Test for ${data.issueKey}`;
    const descriptionText = scenarioTitle || finalSummary;
    const finalSteps = steps.join("\n").trim();

    const payload = [
      {
        testtype: "Cucumber",
        fields: {
          summary: finalSummary, // Feature maps to ticket title
          project: { key: projectKey },
          description: descriptionText, // Scenario maps to description
        },
        gherkin_def: finalSteps, // Gherkin steps only
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

    const token = await getXrayToken(settings.clientId, settings.clientSecret);

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
  console.log(`[TestScribe] pollXrayJobStatus starting for jobId: ${jobId}`);

  for (let i = 0; i < maxAttempts; i++) {
    console.log(`[TestScribe] pollXrayJobStatus polling attempt ${i + 1}/${maxAttempts} for jobId: ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const statusRes = await fetch(
        `https://xray.cloud.getxray.app/api/v2/import/test/bulk/${jobId}/status`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (!statusRes.ok) {
        console.warn(`[TestScribe] pollXrayJobStatus attempt ${i + 1} returned status ${statusRes.status}`);
        if (statusRes.status === 401 || statusRes.status === 403 || statusRes.status === 400) {
          throw new Error(`Xray job status check failed: ${statusRes.status} — ${await statusRes.text()}`);
        }
        continue;
      }

      const data = await statusRes.json();
      console.log(`[TestScribe] pollXrayJobStatus attempt ${i + 1} data:`, data);

      if (!data || !data.status) {
        console.warn(`[TestScribe] pollXrayJobStatus response missing status field:`, data);
        continue;
      }

      // Xray status can be "SUCCESSFUL", "FAILED", "WORKING", or "TODO"
      const status = data.status.toUpperCase();

      if (status === "SUCCESSFUL") {
        const issueKey = data.result?.issues?.[0]?.key || data.result?.[0]?.key;

        if (issueKey) {
          console.log(`[TestScribe] pollXrayJobStatus job succeeded, issueKey resolved: ${issueKey}`);
          return { success: true, testIssueKey: issueKey };
        } else {
          if (Array.isArray(data.result) && data.result[0]?.key) {
            console.log(`[TestScribe] pollXrayJobStatus job succeeded, issueKey array resolved: ${data.result[0].key}`);
            return { success: true, testIssueKey: data.result[0].key };
          }
          throw new Error("Job succeeded but issue key was not found in result.");
        }
      }

      if (status === "FAILED") {
        throw new Error(
          `Xray Import Failed: ${JSON.stringify(data.errors || data.result?.errors || data)}`,
        );
      }
    } catch (err) {
      console.error(`[TestScribe] pollXrayJobStatus error on attempt ${i + 1}:`, err);
      return { success: false, error: err.message };
    }
  }

  console.warn(`[TestScribe] pollXrayJobStatus timed out after ${maxAttempts} attempts.`);
  return { success: false, error: "Xray job status polling timed out." };
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

/* ===============================
   SEARCH EXISTING TESTS
================================= */

async function handleSearchXrayTests(data) {
  console.log("[TestScribe] SEARCH_XRAY_TESTS request data:", data);
  try {
    const { scope, customJql, issueKey, testType, jiraTabId } = data;

    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = tab.url.split("/browse/")[0];
    console.log("[TestScribe] Resolved baseUrl:", baseUrl);

    let testKeys = [];

    if (scope === "testplan") {
      testKeys = await fetchTestKeysFromTestPlans(baseUrl, issueKey, testType);
      console.log("[TestScribe] Scope 'testplan' fetched testKeys:", testKeys);
    } else if (scope === "testset") {
      testKeys = await fetchTestKeysFromTestSets(baseUrl, issueKey);
      console.log("[TestScribe] Scope 'testset' fetched testKeys:", testKeys);
    } else if (scope === "specific") {
      const res = await fetch(`${baseUrl}/rest/api/3/issue/${customJql}?fields=summary,issuetype`, {
        headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" }
      });
      if (res.status === 404) {
        throw new Error(`Jira ticket "${customJql}" does not exist.`);
      }
      if (!res.ok) {
        throw new Error(`Failed to retrieve Jira ticket "${customJql}" (Status: ${res.status}).`);
      }
      const detail = await res.json();
      const issueTypeName = detail.fields?.issuetype?.name || "unknown type";
      if (issueTypeName !== "Test") {
        throw new Error(`Jira ticket "${customJql}" is not an Xray Test (it is a ${issueTypeName}).`);
      }

      const settings = await chrome.storage.sync.get(["clientId", "clientSecret"]);
      if (!settings.clientId || !settings.clientSecret) {
        return { success: false, error: "Xray credentials not found in Settings." };
      }
      const token = await getXrayToken(settings.clientId, settings.clientSecret);

      const t = await fetchXrayTestSteps(detail.key || customJql, detail.fields?.summary || "", detail.id, testType, token);
      return { success: true, tests: [t] };
    } else if (scope === "project") {
      const projectKey = issueKey.split("-")[0];
      const jql = `project = ${projectKey} AND issuetype = Test`;
      console.log("[TestScribe] Scope 'project' running JQL:", jql);
      testKeys = await fetchTestKeysByJql(baseUrl, jql);
      console.log("[TestScribe] Scope 'project' fetched testKeys:", testKeys);
    }

    if (testKeys.length === 0) {
      console.log("[TestScribe] No test keys retrieved from Jira search.");
      return { success: true, tests: [] };
    }

    const settings = await chrome.storage.sync.get(["clientId", "clientSecret"]);
    if (!settings.clientId || !settings.clientSecret) {
      console.warn("[TestScribe] Missing Xray credentials in storage.");
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const token = await getXrayToken(settings.clientId, settings.clientSecret);
    console.log("[TestScribe] Xray authentication successful. Fetching test steps...");

    const tests = await Promise.all(
      testKeys.map(async ({ key, summary, id }) => {
        console.log("[TestScribe] Fetching steps for test:", key, "ID:", id);
        try {
          const t = await fetchXrayTestSteps(key, summary, id, testType, token);
          console.log("[TestScribe] Fetched step details for:", key, t);
          return t;
        } catch (e) {
          console.error(`[TestScribe] Failed to fetch Xray steps for ${key}:`, e);
          return null;
        }
      })
    );

    const filtered = tests.filter(Boolean);
    console.log("[TestScribe] SEARCH_XRAY_TESTS returning tests:", filtered);
    return { success: true, tests: filtered };
  } catch (err) {
    console.error("[TestScribe] SEARCH_XRAY_TESTS handler failed:", err);
    return { success: false, error: err.message };
  }
}

async function fetchTestKeysFromTestPlans(baseUrl, issueKey, testType) {
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${issueKey}?fields=issuelinks`,
    { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
  );
  if (!res.ok) throw new Error(`JIRA issue fetch failed: ${res.status}`);
  const data = await res.json();

  const linkedIssues = (data.fields?.issuelinks || [])
    .map(link => link.inwardIssue || link.outwardIssue)
    .filter(Boolean);

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

  const jql = `issue in testPlanTests(${testPlanKeys.map(k => `"${k}"`).join(",")})`;
  return fetchTestKeysByJql(baseUrl, jql);
}

async function fetchTestKeysFromTestSets(baseUrl, issueKey) {
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${issueKey}?fields=issuelinks`,
    { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
  );
  if (!res.ok) throw new Error(`JIRA issue fetch failed: ${res.status}`);
  const data = await res.json();

  const linkedIssues = (data.fields?.issuelinks || [])
    .map(link => link.inwardIssue || link.outwardIssue)
    .filter(Boolean);

  const testSetKeys = [];
  await Promise.all(
    linkedIssues.map(async linked => {
      const detailRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${linked.key}?fields=issuetype`,
        { headers: { Accept: "application/json", "X-Atlassian-Token": "no-check" } }
      );
      if (!detailRes.ok) return;
      const detail = await detailRes.json();
      if (detail.fields?.issuetype?.name === "Test Set") {
        testSetKeys.push(linked.key);
      }
    })
  );

  if (testSetKeys.length === 0) return [];

  const jql = `issue in testSetTests(${testSetKeys.map(k => `"${k}"`).join(",")})`;
  return fetchTestKeysByJql(baseUrl, jql);
}

async function fetchTestKeysByJql(baseUrl, jql) {
  const res = await fetch(
    `${baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,issuetype&maxResults=100`,
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

async function fetchXrayTestSteps(key, summary, jiraId, testType, token) {
  try {
    console.log(`[TestScribe] fetchXrayTestSteps querying GraphQL for ${key} (${jiraId})`);
    
    const query = `
      query GetTestDetails($issueId: String!) {
        getTest(issueId: $issueId) {
          issueId
          testType {
            name
            kind
          }
          steps {
            action
            data
            result
          }
          gherkin
        }
      }
    `;

    const res = await fetch("https://xray.cloud.getxray.app/api/v2/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        query,
        variables: { issueId: String(jiraId) }
      })
    });

    if (!res.ok) {
      console.warn(`[TestScribe] Could not fetch Xray test for ${key} via GraphQL: ${res.status}`);
      return null;
    }

    const json = await res.json();
    if (json.errors) {
      console.error(`[TestScribe] GraphQL errors for ${key}:`, json.errors);
      return null;
    }

    const testData = json.data?.getTest;
    if (!testData) {
      throw new Error(`Jira ticket "${key}" is not registered in Xray.`);
    }

    console.log("[TestScribe] Xray GraphQL response for", key, ":", testData);
    const actualType = (testData.testType?.name || testData.testType?.kind || "").toLowerCase();
    console.log("[TestScribe] Test", key, "resolved actualType:", actualType, "target type:", testType);

    if (testType === "Cucumber" && !actualType.includes("cucumber")) {
      const typeLabel = testData.testType?.name || testData.testType?.kind || "Manual";
      throw new Error(`Jira ticket "${key}" has Xray type "${typeLabel}", but this merge requires a Cucumber test.`);
    }
    if (testType === "Manual" && !actualType.includes("manual")) {
      const typeLabel = testData.testType?.name || testData.testType?.kind || "Cucumber";
      throw new Error(`Jira ticket "${key}" has Xray type "${typeLabel}", but this merge requires a Manual test.`);
    }

    let steps = [];
    if (testType === "Cucumber") {
      const gherkinText = testData.gherkin || "";
      steps = gherkinText.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    } else {
      steps = (testData.steps || []).map(s => ({
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

/* ===============================
   UPDATE EXISTING TEST STEPS
================================= */

async function handleUpdateTestSteps(data) {
  try {
    const { ticket, steps } = data;
    console.log("[TestScribe] handleUpdateTestSteps started for ticket:", ticket.key, "type:", ticket.testtype);

    const settings = await chrome.storage.sync.get(["clientId", "clientSecret", "projectKey"]);
    if (!settings.clientId || !settings.clientSecret) {
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const token = await getXrayToken(settings.clientId, settings.clientSecret);

    const projectKey = settings.projectKey || ticket.key.split("-")[0];

    if (ticket.testtype === "Cucumber") {
      const gherkinText = steps.join("\n");
      console.log(`[TestScribe] handleUpdateTestSteps updating Cucumber test ${ticket.key} (${ticket.id}) via GraphQL`);
      
      const query = `
        mutation UpdateGherkin($issueId: String!, $gherkin: String!) {
          updateGherkinTestDefinition(issueId: $issueId, gherkin: $gherkin) {
            issueId
          }
        }
      `;

      const res = await fetch("https://xray.cloud.getxray.app/api/v2/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          query,
          variables: {
            issueId: String(ticket.id),
            gherkin: gherkinText
          }
        })
      });

      if (!res.ok) {
        throw new Error(`Xray GraphQL Cucumber update failed: ${res.status} — ${await res.text()}`);
      }

      const json = await res.json();
      console.log("[TestScribe] handleUpdateTestSteps GraphQL Cucumber update response:", json);
      if (json.errors) {
        throw new Error(`Xray GraphQL errors: ${JSON.stringify(json.errors)}`);
      }
      return { success: true };
    } else {
      console.log(`[TestScribe] handleUpdateTestSteps updating Manual test ${ticket.key} (${ticket.id}) via bulk import`);
      
      const payload = [
        {
          testKey: ticket.key,
          testtype: "Manual",
          steps: steps.map(s => ({
            action: s.action || "",
            data: s.data || "",
            result: s.result || "",
          })),
          fields: {
            project: { key: projectKey }
          }
        }
      ];

      console.log("[TestScribe] handleUpdateTestSteps bulk import payload:", JSON.stringify(payload));

      const importRes = await fetch("https://xray.cloud.getxray.app/api/v2/import/test/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await importRes.json();
      console.log("[TestScribe] handleUpdateTestSteps bulk import response:", result);

      if (importRes.ok) {
        if (result.jobId) {
          return await pollXrayJobStatus(result.jobId, token);
        } else if (Array.isArray(result) && result.length > 0) {
          return { success: true };
        }
        return { success: true };
      }
      throw new Error(`Import Failed: ${JSON.stringify(result)}`);
    }
  } catch (err) {
    console.error("UPDATE_TEST_STEPS error:", err);
    return { success: false, error: err.message };
  }
}

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

function adfToPlainText(adfContent) {
  if (!adfContent || !adfContent.content) return "";
  return adfContent.content
    .map(node => {
      if (node.type === "paragraph" || node.type === "heading") {
        return (node.content || []).map(c => c.text || "").join("") + "\n";
      }
      if (node.type === "bulletList" || node.type === "orderedList") {
        return (node.content || []).map(item =>
          (item.content || []).map(p => (p.content || []).map(c => c.text || "").join("")).join("")
        ).join("\n") + "\n";
      }
      return (node.content || []).map(c => c.text || "").join("");
    })
    .join("")
    .trim();
}

async function handleFetchContextMetadata(message) {
  const { issueKey, issueDescription, jiraTabId } = message;

  try {
    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = new URL(tab.url).origin;

    const issueRes = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}?fields=parent,epic,customfield_10014,summary,description`,
      { credentials: "include" }
    );
    if (!issueRes.ok) throw new Error(`Issue fetch failed: ${issueRes.status}`);
    const issueData = await issueRes.json();

    let parent = null;
    if (issueData.fields?.parent) {
      parent = {
        key: issueData.fields.parent.key,
        summary: issueData.fields.parent.fields?.summary || ""
      };
    } else if (issueData.fields?.epic) {
      parent = {
        key: issueData.fields.epic.key,
        summary: issueData.fields.epic.summary || issueData.fields.epic.name || ""
      };
    } else if (issueData.fields?.customfield_10014) {
      const epicKey = typeof issueData.fields.customfield_10014 === "string"
        ? issueData.fields.customfield_10014
        : issueData.fields.customfield_10014.key;
      if (epicKey) {
        parent = {
          key: epicKey,
          summary: ""
        };
      }
    }

    const ticketDesc = issueDescription || adfToPlainText(issueData.fields?.description || {});

    const urlSet = new Set(extractConfluenceUrls(ticketDesc));

    const commentsRes = await fetch(
      `${baseUrl}/rest/api/3/issue/${issueKey}/comment`,
      { credentials: "include" }
    );
    if (commentsRes.ok) {
      const commentsData = await commentsRes.json();
      (commentsData.comments || []).forEach(c => {
        const body = adfToPlainText(c.body || {});
        extractConfluenceUrls(body).forEach(u => urlSet.add(u));
      });
    }

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

    if (parent) {
      try {
        const parentRes = await fetch(
          `${baseUrl}/rest/api/3/issue/${parent.key}?fields=summary,description`,
          { credentials: "include" }
        );
        if (parentRes.ok) {
          const parentData = await parentRes.json();
          parent.summary = parentData.fields?.summary || parent.summary;
          const parentDesc = adfToPlainText(parentData.fields?.description || {});
          extractConfluenceUrls(parentDesc).forEach(u => urlSet.add(u));
        }
      } catch (e) {
        console.error("[TestScribe] Error fetching parent metadata:", e);
      }

      try {
        const parentCommentsRes = await fetch(
          `${baseUrl}/rest/api/3/issue/${parent.key}/comment`,
          { credentials: "include" }
        );
        if (parentCommentsRes.ok) {
          const parentCommentsData = await parentCommentsRes.json();
          (parentCommentsData.comments || []).forEach(c => {
            const body = adfToPlainText(c.body || {});
            extractConfluenceUrls(body).forEach(u => urlSet.add(u));
          });
        }
      } catch (e) {
        console.error("[TestScribe] Error fetching parent comments:", e);
      }

      try {
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
      } catch (e) {
        console.error("[TestScribe] Error fetching parent remote links:", e);
      }
    }

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

async function handleFetchContextContent(message) {
  const { issueKey, jiraTabId, includeParent, confluencePageIds } = message;

  try {
    const tab = await chrome.tabs.get(jiraTabId);
    const baseUrl = new URL(tab.url).origin;

    let parent = null;
    if (includeParent) {
      const issueRes = await fetch(
        `${baseUrl}/rest/api/3/issue/${issueKey}?fields=parent,epic,customfield_10014,summary`,
        { credentials: "include" }
      );
      if (issueRes.ok) {
        const issueData = await issueRes.json();
        const parentKey = issueData.fields?.parent?.key || 
                           issueData.fields?.epic?.key ||
                           (typeof issueData.fields?.customfield_10014 === "string"
                             ? issueData.fields.customfield_10014
                             : issueData.fields?.customfield_10014?.key);
        if (parentKey) {
          let parentData = null;
          try {
            const parentIssueRes = await fetch(`${baseUrl}/rest/api/3/issue/${parentKey}?fields=summary,description`, { credentials: "include" });
            if (parentIssueRes.ok) parentData = await parentIssueRes.json();
          } catch (e) {
            console.error("[TestScribe] Failed to fetch parent issue:", e);
          }

          let commentsData = null;
          try {
            const parentCommentsRes = await fetch(`${baseUrl}/rest/api/3/issue/${parentKey}/comment`, { credentials: "include" });
            if (parentCommentsRes.ok) commentsData = await parentCommentsRes.json();
          } catch (e) {
            console.error("[TestScribe] Failed to fetch parent comments:", e);
          }

          const description = adfToPlainText(parentData?.fields?.description || {});

          const comments = (commentsData?.comments || [])
            .map(c => adfToPlainText(c.body || {}))
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
    let allDenied = (confluencePageIds || []).length > 0;

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
        const content = truncated ? words.slice(0, 3000).join(" ") + " (content truncated)" : plain;
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
      confluenceAccessDenied: (confluencePageIds || []).length > 0 && allDenied,
    };
  } catch (err) {
    console.error("FETCH_CONTEXT_CONTENT failed:", err);
    return { success: false, error: err.message };
  }
}

/* ===============================
   LOCAL STEPS LIBRARY SYNC
================================= */

async function fetchXrayTestStepsInBulk(testsChunk, token) {
  try {
    let fieldsQuery = "";
    testsChunk.forEach((test) => {
      fieldsQuery += `
        t_${test.id}: getTest(issueId: "${test.id}") {
          issueId
          testType {
            name
            kind
          }
          steps {
            action
            data
            result
          }
          gherkin
        }
      `;
    });

    const query = `
      query GetBulkTestDetails {
        ${fieldsQuery}
      }
    `;

    const maxRetries = 2;
    let attempt = 0;
    let res;

    while (attempt <= maxRetries) {
      res = await fetch("https://xray.cloud.getxray.app/api/v2/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ query })
      });

      if (res.status === 429) {
        attempt++;
        if (attempt <= maxRetries) {
          const retryAfter = res.headers.get("Retry-After");
          const waitSec = retryAfter ? parseInt(retryAfter, 10) : 3;
          console.warn(`[TestScribe] fetchXrayTestStepsInBulk rate limited (429). Retrying chunk in ${waitSec}s (Attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
          continue;
        }
      }
      break;
    }

    if (!res.ok) {
      console.warn(`[TestScribe] fetchXrayTestStepsInBulk Xray HTTP Error: ${res.status}`);
      return testsChunk.map(() => null);
    }

    const json = await res.json();
    if (!json || !json.data) {
      console.warn("[TestScribe] fetchXrayTestStepsInBulk empty GraphQL response or errors:", json?.errors);
      return testsChunk.map(() => null);
    }

    const data = json.data;
    const errors = json.errors || [];

    return testsChunk.map((test) => {
      // If there's an error on this test's path, count it as failed
      const hasError = errors.some(err => err.path && err.path.includes(`t_${test.id}`));
      if (hasError) {
        console.warn(`[TestScribe] GraphQL error for test ${test.key}:`, errors.filter(err => err.path && err.path.includes(`t_${test.id}`)));
        return null;
      }

      const testData = data[`t_${test.id}`];
      if (!testData) {
        return null;
      }

      const actualType = (testData.testType?.name || testData.testType?.kind || "").toLowerCase();
      const isManual = actualType.includes("manual");
      if (isManual) {
        return { key: test.key, isManual: true };
      }

      const testType = "cucumber";
      const gherkinText = testData.gherkin || "";
      const steps = gherkinText.split("\n")
        .map(l => l.trim())
        .filter(l => {
          if (l.length === 0) return false;
          const lower = l.toLowerCase();
          return !lower.startsWith("scenario:") && 
                 !lower.startsWith("scenario outline:") && 
                 !lower.startsWith("feature:") && 
                 !lower.startsWith("background:") &&
                 !lower.startsWith("examples:");
        });

      return { key: test.key, summary: test.summary, testtype: testType, id: test.id, steps };
    });
  } catch (err) {
    console.error("[TestScribe] fetchXrayTestStepsInBulk exception:", err);
    return testsChunk.map(() => null);
  }
}

async function handleSyncStepsLibrary(syncOnlyFailed = false) {
  try {
    console.log(`[TestScribe] Starting handleSyncStepsLibrary. syncOnlyFailed: ${syncOnlyFailed}`);
    const settings = await chrome.storage.sync.get(["clientId", "clientSecret", "projectKey", "selectedSyncProjects"]);
    if (!settings.clientId || !settings.clientSecret) {
      return { success: false, error: "Xray credentials not found in Settings." };
    }

    const storage = await chrome.storage.local.get(["testLibrary", "failedSyncTests"]);
    let library = storage.testLibrary || [];
    let failedSyncTests = storage.failedSyncTests || [];

    let allJiraTests = [];

    if (syncOnlyFailed) {
      allJiraTests = [...failedSyncTests];
      console.log(`[TestScribe] Targeting sync retry for ${allJiraTests.length} previously failed tests.`);
    } else {
      // Clear previously failed tests for a fresh run
      failedSyncTests = [];

      const selectedSyncProjects = settings.selectedSyncProjects || [];
      if (!selectedSyncProjects || selectedSyncProjects.length === 0) {
        return { success: false, error: "No projects selected. Please select at least one project to sync in the settings page." };
      }
      let projectsToSync = selectedSyncProjects.map(p => p.key);

      console.log(`[TestScribe] Resolved projects to sync: ${projectsToSync.join(", ")}`);

      let baseUrl = "https://testitright.atlassian.net";
      try {
        const tabs = await chrome.tabs.query({ url: "*://*.atlassian.net/*" });
        if (tabs.length > 0 && tabs[0].url) {
          baseUrl = new URL(tabs[0].url).origin;
        }
      } catch (e) {}

      for (const projKey of projectsToSync) {
        console.log(`[TestScribe] Fetching Jira tests for project: ${projKey} JQL scope. baseUrl: ${baseUrl}`);
        const jql = `project = ${projKey} AND issuetype = Test`;
        let startAt = 0;
        const maxResults = 100;
        let total = 1;

        while (startAt < total) {
          const searchUrl = `${baseUrl}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,issuetype&startAt=${startAt}&maxResults=${maxResults}`;
          const searchRes = await fetch(searchUrl, {
            headers: {
              "Accept": "application/json",
              "X-Atlassian-Token": "no-check"
            },
            credentials: "include"
          });
          if (!searchRes.ok) {
            console.warn(`[TestScribe] Jira search failed for project ${projKey}: ${searchRes.status}`);
            break;
          }
          const rawText = await searchRes.text();
          console.log(`[TestScribe] Project ${projKey} JQL search raw response snippet:`, rawText.substring(0, 300));
          const data = JSON.parse(rawText);
          total = data.total || 0;
          const issues = data.issues || [];
          issues.forEach(issue => {
            allJiraTests.push({
              id: issue.id,
              key: issue.key,
              summary: issue.fields?.summary || issue.key
            });
          });

          if (issues.length === 0) break;
          startAt += maxResults;
        }
      }
    }

    if (allJiraTests.length === 0) {
      return { success: true, count: library.length, stepsCount: 0, failedCount: 0 };
    }

    const token = await getXrayToken(settings.clientId, settings.clientSecret);

    console.log(`[TestScribe] Starting steps details fetch for ${allJiraTests.length} tests...`);

    const chunkSize = syncOnlyFailed ? 5 : 10;
    const delayMs = syncOnlyFailed ? 2000 : 1000;

    let newlySynced = 0;
    let newlyFailed = 0;

    for (let i = 0; i < allJiraTests.length; i += chunkSize) {
      const chunk = allJiraTests.slice(i, i + chunkSize);
      console.log(`[TestScribe] Syncing steps chunk ${i / chunkSize + 1}: tests ${i} to ${Math.min(i + chunkSize, allJiraTests.length)}`);
      
      const chunkResults = await fetchXrayTestStepsInBulk(chunk, token);

      chunkResults.forEach((item, index) => {
        const originalTest = chunk[index];
        if (item) {
          if (item.isManual) {
            // Silently ignore manual test cases
            return;
          }
          // Always filter out old matching item key and insert fresh copy
          library = library.filter(t => t.key !== item.key);
          library.push(item);
          // If successfully synced, remove from failed list
          failedSyncTests = failedSyncTests.filter(t => t.key !== item.key);
          newlySynced++;
        } else {
          // Failed to sync, record as failed if not already recorded
          if (!failedSyncTests.some(t => t.key === originalTest.key)) {
            failedSyncTests.push(originalTest);
          }
          newlyFailed++;
        }
      });

      // Broadcast progress update to options page
      chrome.runtime.sendMessage({
        type: "SYNC_PROGRESS",
        current: Math.min(i + chunkSize, allJiraTests.length),
        total: allJiraTests.length
      });

      if (i + chunkSize < allJiraTests.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Prune tests that no longer exist in Jira search results (only for full sync runs)
    if (!syncOnlyFailed) {
      library = library.filter(t => allJiraTests.some(j => j.key === t.key));
    }

    // Double check: filter successfully synced tests out of failed list
    failedSyncTests = failedSyncTests.filter(t => !library.some(l => l.key === t.key));

    let totalSteps = 0;
    library.forEach(t => {
      totalSteps += (t.steps || []).length;
    });

    console.log(`[TestScribe] Sync completed. Synced ${library.length} tests and ${totalSteps} steps successfully. ${failedSyncTests.length} failed.`);

    const timestamp = Date.now();
    await new Promise((resolve) => {
      chrome.storage.local.set({
        testLibrary: library,
        failedSyncTests: failedSyncTests,
        lastLibrarySyncTime: timestamp,
        libraryTestsCount: library.length,
        libraryStepsCount: totalSteps,
        failedTestsCount: failedSyncTests.length
      }, resolve);
    });

    return { 
      success: true, 
      count: library.length, 
      stepsCount: totalSteps, 
      failedCount: failedSyncTests.length,
      newlySynced: newlySynced,
      newlyFailed: newlyFailed
    };
  } catch (err) {
    console.error("[TestScribe] Sync error:", err);
    return { success: false, error: err.message };
  }
}

async function getXrayToken(clientId, clientSecret) {
  const cache = await chrome.storage.local.get(["xrayToken", "xrayTokenTime"]);
  const now = Date.now();
  const tokenExpiry = 25 * 60 * 1000; // 25 minutes in milliseconds

  if (cache.xrayToken && cache.xrayTokenTime && (now - cache.xrayTokenTime < tokenExpiry)) {
    console.log("[TestScribe] Reusing cached Xray auth token");
    return cache.xrayToken;
  }

  console.log("[TestScribe] Requesting new Xray auth token...");
  const authRes = await fetch("https://xray.cloud.getxray.app/api/v2/authenticate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  
  if (!authRes.ok) {
    throw new Error(`Xray authentication failed with status ${authRes.status}`);
  }

  const token = (await authRes.text()).replace(/"/g, "");
  
  await chrome.storage.local.set({
    xrayToken: token,
    xrayTokenTime: now
  });

  return token;
}
