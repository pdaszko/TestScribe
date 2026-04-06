const Storage = {
  DEFAULT_LLM: "DEFAULT_LLM",
  OLLAMA_HOST: "OLLAMA_HOST",
  GEMINI_API_KEY: "GEMINI_API_KEY",
  XRAY_CLIENT_ID: "XRAY_CLIENT_ID",
  XRAY_CLIENT_SECRET: "XRAY_CLIENT_SECRET",
};

const GEMINI_PAID_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.0-pro",
  "gemini-1.5-pro",
  "gemini-exp",
  "gemini-pro",
];

async function setValues() {
  const settings = await chrome.storage.sync.get(["clientId"]);
  console.log("Loaded settings s:", settings);
  // chrome.storage.sync.chrome.storage.sync.get(
  //   ["host", "geminiKey", "clientId", "clientSecret"],
  //   async (prefs) => {
  //     document.getElementById("host").value = prefs.host || "";
  //     document.getElementById("geminiKey").value = prefs.geminiKey || "";
  //     document.getElementById("clientId").value = prefs.clientId || "";
  //     document.getElementById("clientSecret").value = prefs.clientSecret || "";
  //   },
  // );
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab-link");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("data-target");

      // Hide all
      document
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.remove("active"));
      document
        .querySelectorAll(".tab-link")
        .forEach((l) => l.classList.remove("active"));

      // Show selected
      document.getElementById(targetId).classList.add("active");
      tab.classList.add("active");
    });
  });
}

async function updateSetupLink() {
  const defaultUrl =
    "https://<your_jira>.atlassian.net/plugins/servlet/ac/com.xpandit.plugins.xray/xray-global-settings-api-keys?s=com.xpandit.plugins.xray__xray-global-settings-api-keys";
  const linkElement = document.getElementById("setupLink");
  if (!linkElement) return;

  try {
    const tabs = await chrome.tabs.query({});
    const jiraTab = tabs.find((t) => t.url && t.url.includes(".atlassian.net"));
    if (jiraTab) {
      const url = new URL(jiraTab.url);
      linkElement.href = `${url.protocol}//${url.hostname}/plugins/servlet/ac/com.xpandit.plugins.xray/xray-global-settings-api-keys?s=com.xpandit.plugins.xray__xray-global-settings-api-keys`;
    } else {
      linkElement.href = defaultUrl;
    }
  } catch (e) {
    linkElement.href = defaultUrl;
  }
}

async function fetchOllamaModels(host) {
  const select = document.getElementById("ollamaModel");
  const status = document.getElementById("modelFetchStatus");
  if (!select || !status) return;

  status.textContent = "Fetching models...";
  status.style.color = "#999";
  select.disabled = true;

  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);

    select.innerHTML = models.length
      ? models.map(m => `<option value="${m}">${m}</option>`).join("")
      : `<option value="">No models found</option>`;

    status.textContent = models.length ? "" : "No models installed.";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach Ollama</option>`;
    status.textContent = `Could not reach Ollama at ${host}`;
    status.style.color = "red";
  } finally {
    select.disabled = false;
  }
}

async function fetchGeminiModels(apiKey) {
  const select = document.getElementById("geminiModelSelect");
  const status = document.getElementById("geminiModelFetchStatus");
  if (!select || !status) return;

  if (!apiKey) {
    status.textContent = "Enter your Gemini API Key first";
    status.style.color = "red";
    return;
  }

  status.textContent = "Fetching models...";
  status.style.color = "#999";
  select.disabled = true;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const models = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => ({ name: m.name.replace("models/", ""), displayName: m.displayName || m.name.replace("models/", "") }));

    if (models.length === 0) {
      select.innerHTML = `<option value="">No models available for this key</option>`;
      status.textContent = "No models available for this key";
      return;
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

    status.textContent = "";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach Gemini API</option>`;
    status.textContent = "Could not reach Gemini API";
    status.style.color = "red";
  } finally {
    select.disabled = false;
  }
}

function updateAgentSections(agent) {
  const ollamaConfig = document.getElementById("ollama-config");
  const geminiConfig = document.getElementById("gemini-config");
  if (ollamaConfig) ollamaConfig.style.display = agent === "ollama" ? "block" : "none";
  if (geminiConfig) geminiConfig.style.display = agent === "gemini" ? "block" : "none";
}

// (Duplicate Save Agent block removed: handled at the bottom of file)

// Save Integration
document.getElementById("saveIntegration")?.addEventListener("click", () => {
  const data = {
    clientId: document.getElementById("clientId").value,
    clientSecret: document.getElementById("clientSecret").value,
  };
  chrome.storage.sync.set(data, () =>
    showStatus("Xray settings saved!", "green"),
  );
});

// Test Connection
document
  .getElementById("testIntegration")
  ?.addEventListener("click", async () => {
    const status = document.getElementById("statusMessage");
    status.innerText = "Testing...";
    status.style.color = "orange";

    try {
      const response = await fetch(
        "https://xray.cloud.getxray.app/api/v2/authenticate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: document.getElementById("clientId").value,
            client_secret: document.getElementById("clientSecret").value,
          }),
        },
      );

      if (response.ok) {
        showStatus("Connection Successful!", "green");
      } else {
        showStatus("Auth Failed (Check Client ID/Secret)", "red");
      }
    } catch (error) {
      showStatus("Network Error: Check API access", "red");
    }
  });

function showStatus(text, color) {
  const status = document.getElementById("statusMessage");
  if (!status) return;
  status.innerText = text;
  status.style.color = color;
  setTimeout(() => {
    status.innerText = "";
  }, 3000);
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  updateSetupLink();

  chrome.storage.sync.get(
    ["clientId", "clientSecret", "host", "geminiKey", "defaultAgent", "ollamaModel", "geminiModel"],
    (items) => {
      if (items.clientId) document.getElementById("clientId").value = items.clientId;
      if (items.clientSecret) document.getElementById("clientSecret").value = items.clientSecret;
      if (items.host) document.getElementById("host").value = items.host;
      if (items.geminiKey) document.getElementById("geminiKey").value = items.geminiKey;

      const defaultAgent = items.defaultAgent || "ollama";
      document.querySelector(`input[name="defaultAgent"][value="${defaultAgent}"]`).checked = true;

      updateAgentSections(defaultAgent);

      if (defaultAgent === "ollama") {
        const host = items.host || "http://localhost:11434";
        fetchOllamaModels(host).then(() => {
          if (items.ollamaModel) {
            const select = document.getElementById("ollamaModel");
            const status = document.getElementById("modelFetchStatus");
            if (select) {
              select.value = items.ollamaModel;
              if (select.value !== items.ollamaModel && status) {
                status.textContent = `Saved model "${items.ollamaModel}" not found.`;
                status.style.color = "#e67e22";
              }
            }
          }
        });
      }

      if (defaultAgent === "gemini" && items.geminiKey) {
        fetchGeminiModels(items.geminiKey).then(() => {
          if (items.geminiModel) {
            const select = document.getElementById("geminiModelSelect");
            const status = document.getElementById("geminiModelFetchStatus");
            if (select) {
              select.value = items.geminiModel;
              if (select.value !== items.geminiModel && status) {
                status.textContent = `Saved model "${items.geminiModel}" not found.`;
                status.style.color = "#e67e22";
              }
            }
          }
        });
      }

      // Wire up agent radio show/hide + model fetch on switch
      document.querySelectorAll('input[name="defaultAgent"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
          updateAgentSections(e.target.value);
          if (e.target.value === "ollama") {
            const host = document.getElementById("host").value || "http://localhost:11434";
            fetchOllamaModels(host);
          }
          if (e.target.value === "gemini") {
            const key = document.getElementById("geminiKey").value;
            fetchGeminiModels(key);
          }
        });
      });
    }
  );
});

document.getElementById("refreshModels")?.addEventListener("click", () => {
  const host = document.getElementById("host").value || "http://localhost:11434";
  fetchOllamaModels(host);
});

document.getElementById("refreshGeminiModels")?.addEventListener("click", () => {
  const key = document.getElementById("geminiKey").value;
  fetchGeminiModels(key);
});

// Save Agent Settings
document.getElementById("saveAgent")?.addEventListener("click", () => {
  const host = document.getElementById("host").value;
  const geminiKey = document.getElementById("geminiKey").value;
  const defaultAgent = document.querySelector('input[name="defaultAgent"]:checked').value;
  const ollamaModelEl = document.getElementById("ollamaModel");
  const ollamaModel = ollamaModelEl ? ollamaModelEl.value : "";
  const geminiModelEl = document.getElementById("geminiModelSelect");
  const geminiModel = geminiModelEl ? geminiModelEl.value : "";

  chrome.storage.sync.set(
    { host, geminiKey, defaultAgent, ollamaModel, geminiModel },
    () => {
      showStatus(`Settings saved! Default: ${defaultAgent}`, "green");
    }
  );
});
setValues();
