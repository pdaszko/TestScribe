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

let savedSettings = {};
let pendingTabSwitch = null;

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

function hasUnsavedChanges(tabId) {
  if (tabId === "agent-tab") {
    const selectedAgent = document.querySelector('input[name="defaultAgent"]:checked')?.value || "ollama";
    if (selectedAgent !== (savedSettings.defaultAgent || "ollama")) return true;

    if (selectedAgent === "ollama") {
      const host = document.getElementById("host").value;
      const ollamaModel = document.getElementById("ollamaModel").value;
      if (host !== (savedSettings.host || "")) return true;
      if (ollamaModel !== (savedSettings.ollamaModel || "")) return true;
    } else if (selectedAgent === "gemini") {
      const geminiKey = document.getElementById("geminiKey").value;
      const geminiModel = document.getElementById("geminiModelSelect")?.value || "";
      if (geminiKey !== (savedSettings.geminiKey || "")) return true;
      if (geminiModel !== (savedSettings.geminiModel || "")) return true;
    } else if (selectedAgent === "mtplx") {
      const mtplxHost = document.getElementById("mtplxHost").value;
      const mtplxModel = document.getElementById("mtplxModel").value;
      if (mtplxHost !== (savedSettings.mtplxHost || "http://127.0.0.1:8000")) return true;
      if (mtplxModel !== (savedSettings.mtplxModel || "")) return true;
    } else if (selectedAgent === "groq") {
      const groqKey = document.getElementById("groqKey").value;
      const groqModel = document.getElementById("groqModel").value;
      if (groqKey !== (savedSettings.groqKey || "")) return true;
      if (groqModel !== (savedSettings.groqModel || "")) return true;
    } else if (selectedAgent === "openai") {
      const openaiHost = document.getElementById("openaiHost").value;
      const openaiKey = document.getElementById("openaiKey").value;
      const openaiModel = document.getElementById("openaiModel").value;
      if (openaiHost !== (savedSettings.openaiHost || "")) return true;
      if (openaiKey !== (savedSettings.openaiKey || "")) return true;
      if (openaiModel !== (savedSettings.openaiModel || "")) return true;
    }
  } else if (tabId === "integration-tab") {
    const clientId = document.getElementById("clientId").value;
    const clientSecret = document.getElementById("clientSecret").value;
    if (clientId !== (savedSettings.clientId || "")) return true;
    if (clientSecret !== (savedSettings.clientSecret || "")) return true;
  } else if (tabId === "context-tab") {
    const contextDefaultParent = document.getElementById("contextDefaultParent")?.checked;
    const contextDefaultConfluence = document.getElementById("contextDefaultConfluence")?.checked;
    const contextPanelHidden = document.getElementById("contextPanelHidden")?.checked;
    const libraryStepsEnabled = document.getElementById("libraryStepsEnabled")?.checked === true;
    const libraryStepsLimit = parseInt(document.getElementById("libraryStepsLimit")?.value || "30", 10);

    const savedParent = savedSettings.contextDefaultParent !== false;
    const savedConfluence = savedSettings.contextDefaultConfluence !== false;
    const savedHidden = savedSettings.contextPanelHidden === true;
    const savedEnabled = savedSettings.libraryStepsEnabled !== false;
    const savedStepsLimit = parseInt(savedSettings.libraryStepsLimit ?? "30", 10);

    if (contextDefaultParent !== savedParent) return true;
    if (contextDefaultConfluence !== savedConfluence) return true;
    if (contextPanelHidden !== savedHidden) return true;
    if (libraryStepsEnabled !== savedEnabled) return true;
    if (libraryStepsLimit !== savedStepsLimit) return true;
  }
  return false;
}

function restoreTabValues(tabId) {
  if (tabId === "agent-tab") {
    const defaultAgent = savedSettings.defaultAgent || "ollama";
    const rad = document.querySelector(`input[name="defaultAgent"][value="${defaultAgent}"]`);
    if (rad) rad.checked = true;
    updateAgentSections(defaultAgent);
    document.getElementById("host").value = savedSettings.host || "";
    document.getElementById("ollamaModel").value = savedSettings.ollamaModel || "";
    document.getElementById("geminiKey").value = savedSettings.geminiKey || "";
    const geminiModelSelect = document.getElementById("geminiModelSelect");
    if (geminiModelSelect) geminiModelSelect.value = savedSettings.geminiModel || "";
    document.getElementById("mtplxHost").value = savedSettings.mtplxHost || "http://127.0.0.1:8000";
    document.getElementById("mtplxModel").value = savedSettings.mtplxModel || "";
    document.getElementById("groqKey").value = savedSettings.groqKey || "";
    document.getElementById("groqModel").value = savedSettings.groqModel || "";
    document.getElementById("openaiHost").value = savedSettings.openaiHost || "";
    document.getElementById("openaiKey").value = savedSettings.openaiKey || "";
    document.getElementById("openaiModel").value = savedSettings.openaiModel || "";
  } else if (tabId === "integration-tab") {
    document.getElementById("clientId").value = savedSettings.clientId || "";
    document.getElementById("clientSecret").value = savedSettings.clientSecret || "";
  } else if (tabId === "context-tab") {
    const parent = document.getElementById("contextDefaultParent");
    const confluence = document.getElementById("contextDefaultConfluence");
    const hidden = document.getElementById("contextPanelHidden");
    const note = document.getElementById("contextPanelHiddenNote");
    const stepsEnabledInput = document.getElementById("libraryStepsEnabled");
    const stepsLimitInput = document.getElementById("libraryStepsLimit");
    const stepsLimitContainer = document.getElementById("libraryStepsLimitContainer");
    
    if (parent) parent.checked = savedSettings.contextDefaultParent !== false;
    if (confluence) confluence.checked = savedSettings.contextDefaultConfluence !== false;
    if (stepsEnabledInput) {
      stepsEnabledInput.checked = savedSettings.libraryStepsEnabled !== false;
      if (stepsLimitContainer) {
        stepsLimitContainer.style.display = stepsEnabledInput.checked ? "block" : "none";
      }
    }
    if (stepsLimitInput) stepsLimitInput.value = savedSettings.libraryStepsLimit ?? "30";
    if (hidden) {
      hidden.checked = savedSettings.contextPanelHidden === true;
      if (note) note.style.display = hidden.checked ? "block" : "none";
    }
  }
}

function switchTabTo(targetId) {
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.remove("active"));
  document
    .querySelectorAll(".tab-link")
    .forEach((l) => l.classList.remove("active"));

  const targetEl = document.getElementById(targetId);
  if (targetEl) targetEl.classList.add("active");
  const tab = document.querySelector(`.tab-link[data-target="${targetId}"]`);
  if (tab) tab.classList.add("active");
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab-link");
  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      const activeLink = document.querySelector(".tab-link.active");
      const targetId = tab.getAttribute("data-target");

      if (activeLink) {
        const currentTabId = activeLink.getAttribute("data-target");
        if (currentTabId !== targetId && hasUnsavedChanges(currentTabId)) {
          e.preventDefault();
          e.stopPropagation();
          pendingTabSwitch = { currentTabId, targetTabId: targetId };
          const modal = document.getElementById("unsaved-confirm-modal");
          if (modal) modal.style.display = "flex";
          return;
        }
      }

      switchTabTo(targetId);
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
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${host}/api/tags`),
      fetch(`${host}/api/ps`).catch(() => null)
    ]);

    if (!tagsRes.ok) throw new Error(`HTTP ${tagsRes.status}`);
    const tagsData = await tagsRes.json();
    const allModels = (tagsData.models || []).map(m => m.name);

    let runningModels = [];
    if (psRes && psRes.ok) {
      try {
        const psData = await psRes.json();
        runningModels = (psData.models || []).map(m => m.name || m.model || "");
      } catch (e) {
        console.warn("Failed to parse Ollama ps response:", e);
      }
    }

    const mapped = allModels.map(m => {
      const isRunning = runningModels.some(r => {
        if (!r) return false;
        const rClean = r.includes(":") ? r : r + ":latest";
        const mClean = m.includes(":") ? m : m + ":latest";
        return rClean === mClean || r.split(":")[0] === m.split(":")[0];
      });
      return { name: m, running: isRunning };
    });

    mapped.sort((a, b) => {
      if (a.running && !b.running) return -1;
      if (!a.running && b.running) return 1;
      return a.name.localeCompare(b.name);
    });

    select.innerHTML = mapped.length
      ? mapped.map(m => {
          const label = m.running ? `🟢 ${m.name} (running)` : m.name;
          return `<option value="${m.name}">${label}</option>`;
        }).join("")
      : `<option value="">No models found</option>`;

    status.textContent = mapped.length ? "" : "No models installed.";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach Ollama</option>`;
    const errMsg = err.message || String(err);
    if (errMsg.includes("403") || errMsg.toLowerCase().includes("forbidden")) {
      status.innerHTML = `Could not reach Ollama at ${host} (403 Forbidden).<br>` +
        `<span style="font-size: 11px; font-weight: normal; color: #555; display: block; margin-top: 5px; line-height: 1.4;">` +
        `<strong>1. Verify CORS:</strong> Run <code>curl -I -H "Origin: chrome-extension://test" ${host}/api/tags</code> in Terminal / PowerShell.<br>` +
        `<strong>2. Fix CORS (restarts Ollama):</strong><br>` +
        `• macOS (Terminal): <code>launchctl setenv OLLAMA_ORIGINS "*" && killall Ollama && open -a Ollama</code><br>` +
        `• Windows (PowerShell): <code>[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User'); Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue; Start-Process "$env:LOCALAPPDATA\\Ollama\\ollama app.exe"</code>` +
        `</span>`;
    } else {
      status.textContent = `Could not reach Ollama at ${host}. Details: ${errMsg}`;
    }
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

async function fetchGroqModels(apiKey) {
  const select = document.getElementById("groqModel");
  const status = document.getElementById("groqModelFetchStatus");
  if (!select || !status) return;

  if (!apiKey) {
    status.textContent = "Enter your Groq API Key first";
    status.style.color = "red";
    return;
  }

  status.textContent = "Fetching models...";
  status.style.color = "#999";
  select.disabled = true;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    select.innerHTML = models.length
      ? models.map(m => `<option value="${m}">${m}</option>`).join("")
      : `<option value="">No models found</option>`;

    status.textContent = models.length ? "" : "No models found.";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach Groq API</option>`;
    status.textContent = `Could not reach Groq API. Details: ${err.message}`;
    status.style.color = "red";
  } finally {
    select.disabled = false;
  }
}

async function fetchOpenaiModels(host, apiKey) {
  const select = document.getElementById("openaiModel");
  const status = document.getElementById("openaiModelFetchStatus");
  if (!select || !status) return;

  if (!host) {
    status.textContent = "Enter your Custom Endpoint Host URL first";
    status.style.color = "red";
    return;
  }

  status.textContent = "Fetching models...";
  status.style.color = "#999";
  select.disabled = true;

  try {
    const headers = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${host}/models`, {
      method: "GET",
      headers: headers
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    select.innerHTML = models.length
      ? models.map(m => `<option value="${m}">${m}</option>`).join("")
      : `<option value="">No models found</option>`;

    status.textContent = models.length ? "" : "No models found.";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach Custom Endpoint</option>`;
    status.textContent = `Could not reach Custom Endpoint. Details: ${err.message}`;
    status.style.color = "red";
  } finally {
    select.disabled = false;
  }
}

function updateAgentSections(agent) {
  const ollamaConfig = document.getElementById("ollama-config");
  const geminiConfig = document.getElementById("gemini-config");
  const mtplxConfig = document.getElementById("mtplx-config");
  const groqConfig = document.getElementById("groq-config");
  const openaiConfig = document.getElementById("openai-config");
  if (ollamaConfig) ollamaConfig.style.display = agent === "ollama" ? "block" : "none";
  if (geminiConfig) geminiConfig.style.display = agent === "gemini" ? "block" : "none";
  if (mtplxConfig) mtplxConfig.style.display = agent === "mtplx" ? "block" : "none";
  if (groqConfig) groqConfig.style.display = agent === "groq" ? "block" : "none";
  if (openaiConfig) openaiConfig.style.display = agent === "openai" ? "block" : "none";
}

async function fetchMtplxModels(host) {
  const select = document.getElementById("mtplxModel");
  const status = document.getElementById("mtplxModelFetchStatus");
  if (!select || !status) return;

  status.textContent = "Fetching models...";
  status.style.color = "#999";
  select.disabled = true;

  try {
    const res = await fetch(`${host}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    select.innerHTML = models.length
      ? models.map(m => `<option value="${m}">${m}</option>`).join("")
      : `<option value="">No models found</option>`;

    status.textContent = models.length ? "" : "No models found.";
  } catch (err) {
    select.innerHTML = `<option value="">Could not reach MTPLX</option>`;
    status.textContent = `Could not reach MTPLX at ${host}. Details: ${err.message}`;
    status.style.color = "red";
  } finally {
    select.disabled = false;
  }
}

// (Duplicate Save Agent block removed: handled at the bottom of file)

// Save Integration
document.getElementById("saveIntegration")?.addEventListener("click", () => {
  const data = {
    clientId: document.getElementById("clientId").value,
    clientSecret: document.getElementById("clientSecret").value,
  };
  chrome.storage.sync.set(data, () => {
    savedSettings.clientId = data.clientId;
    savedSettings.clientSecret = data.clientSecret;
    showStatus("Xray settings saved!", "green");
  });
});

// Test Connection
document
  .getElementById("testIntegration")
  ?.addEventListener("click", async () => {
    const status = document.getElementById("testStatusMessage");
    if (!status) return;
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
        status.innerText = "Connection Successful!";
        status.style.color = "green";
      } else {
        status.innerText = "Auth Failed (Check Client ID/Secret)";
        status.style.color = "red";
      }
    } catch (error) {
      status.innerText = "Network Error: Check API access";
      status.style.color = "red";
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

let selectedSyncProjects = [];

let allJiraProjects = [];

async function loadJiraProjects() {
  const input = document.getElementById("project-search-input");
  if (!input) return;

  let baseUrl = "";
  try {
    const tabs = await chrome.tabs.query({ url: "*://*.atlassian.net/*" });
    if (tabs.length > 0 && tabs[0].url) {
      baseUrl = new URL(tabs[0].url).origin;
    }
  } catch (e) {}

  if (!baseUrl) {
    input.placeholder = "Open Jira to load projects...";
    input.disabled = true;
    return;
  }

  input.placeholder = "Loading projects...";
  input.disabled = true;

  try {
    const res = await fetch(`${baseUrl}/rest/api/3/project`, {
      headers: {
        "Accept": "application/json",
        "X-Atlassian-Token": "no-check"
      },
      credentials: "include"
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allJiraProjects = await res.json();
    allJiraProjects.sort((a, b) => a.name.localeCompare(b.name));
    
    input.placeholder = "Search projects by name or key...";
    input.disabled = false;
    
    setupSearchDropdown();
  } catch (err) {
    console.error("Failed to load Jira projects:", err);
    input.placeholder = "Could not load projects from Jira.";
  }
}

function setupSearchDropdown() {
  const input = document.getElementById("project-search-input");
  const list = document.getElementById("project-dropdown-list");
  if (!input || !list) return;

  function renderFilteredList() {
    const query = input.value.trim().toLowerCase();
    
    const filtered = allJiraProjects.filter(p => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const keyMatch = p.key.toLowerCase().includes(query);
      const alreadySelected = selectedSyncProjects.some(s => s.key === p.key);
      return (nameMatch || keyMatch) && !alreadySelected;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding: 8px 10px; color: #777; font-size: 12px; font-style: italic;">No matches found</div>';
    } else {
      list.innerHTML = filtered.map(p => `
        <div class="dropdown-item" data-key="${p.key}" data-name="${p.name}" style="padding: 8px 10px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f4f5f7;">
          <span style="font-weight: 600; color: #172b4d;">${p.key}</span> — <span style="color: #5e6c84;">${p.name}</span>
        </div>
      `).join("");

      list.querySelectorAll(".dropdown-item").forEach(item => {
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const key = item.getAttribute("data-key");
          const name = item.getAttribute("data-name");
          addProjectToSyncList(key, name);
          input.value = "";
          input.blur();
          list.style.display = "none";
        });
      });
    }
    list.style.display = "block";
  }

  input.addEventListener("focus", () => {
    renderFilteredList();
  });

  input.addEventListener("click", () => {
    renderFilteredList();
  });

  input.addEventListener("input", () => {
    renderFilteredList();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      list.style.display = "none";
    }, 150);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstItem = list.querySelector(".dropdown-item");
      if (firstItem) {
        const key = firstItem.getAttribute("data-key");
        const name = firstItem.getAttribute("data-name");
        addProjectToSyncList(key, name);
        input.value = "";
        input.blur();
        list.style.display = "none";
      }
    }
  });
}

function addProjectToSyncList(key, name) {
  if (selectedSyncProjects.some(p => p.key === key)) return;
  selectedSyncProjects.push({ key, name });
  chrome.storage.sync.set({ selectedSyncProjects }, () => {
    savedSettings.selectedSyncProjects = JSON.parse(JSON.stringify(selectedSyncProjects));
    renderSelectedProjects();
  });
}

function renderSelectedProjects() {
  const container = document.getElementById("selected-projects-container");
  const btn = document.getElementById("sync-library-btn");
  const validationMsg = document.getElementById("sync-validation-msg");
  if (!container) return;
  container.innerHTML = "";

  if (selectedSyncProjects.length === 0) {
    container.innerHTML = '<span style="font-size: 11px; color: #777; font-style: italic;">No projects selected.</span>';
    if (btn) btn.disabled = true;
    if (validationMsg) validationMsg.style.display = "block";
    return;
  }

  if (btn) btn.disabled = false;
  if (validationMsg) validationMsg.style.display = "none";

  selectedSyncProjects.forEach((proj) => {
    const chip = document.createElement("div");
    chip.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ebecf0;
      color: #172b4d;
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid #dfe1e6;
    `;
    
    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${proj.name} (${proj.key})`;
    chip.appendChild(nameSpan);

    const removeBtn = document.createElement("span");
    removeBtn.textContent = "✕";
    removeBtn.style.cssText = `
      cursor: pointer;
      color: #6b778c;
      font-weight: bold;
    `;
    removeBtn.addEventListener("mouseover", () => { removeBtn.style.color = "#de350b"; });
    removeBtn.addEventListener("mouseout", () => { removeBtn.style.color = "#6b778c"; });
    removeBtn.addEventListener("click", () => {
      removeProjectFromSyncList(proj.key);
    });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });
}

function removeProjectFromSyncList(key) {
  selectedSyncProjects = selectedSyncProjects.filter(p => p.key !== key);
  chrome.storage.sync.set({ selectedSyncProjects }, () => {
    savedSettings.selectedSyncProjects = JSON.parse(JSON.stringify(selectedSyncProjects));
    renderSelectedProjects();
  });
}

function updateLibraryStats() {
  chrome.storage.local.get(["lastLibrarySyncTime", "libraryTestsCount", "libraryStepsCount", "failedTestsCount"], (res) => {
    const statusText = document.getElementById("sync-status-text");
    const timeText = document.getElementById("sync-time-text");
    const countText = document.getElementById("sync-count-text");
    const stepsCountText = document.getElementById("sync-steps-count-text");
    const failedCountText = document.getElementById("sync-failed-count-text");
    const retryLink = document.getElementById("retry-failed-link");

    const failedCount = res.failedTestsCount || 0;
    if (failedCountText) failedCountText.textContent = failedCount;
    if (retryLink) {
      retryLink.style.display = failedCount > 0 ? "inline" : "none";
    }

    const enabledInput = document.getElementById("libraryStepsEnabled");
    const limitInput = document.getElementById("libraryStepsLimit");
    const limitStatus = document.getElementById("libraryStepsLimitStatus");

    if (res.lastLibrarySyncTime) {
      if (statusText) {
        statusText.textContent = "Synced";
        statusText.style.color = "#36b37e";
      }
      if (timeText) timeText.textContent = new Date(res.lastLibrarySyncTime).toLocaleString();
      if (countText) countText.textContent = res.libraryTestsCount || 0;
      if (stepsCountText) stepsCountText.textContent = res.libraryStepsCount || 0;
      
      if (enabledInput) enabledInput.disabled = false;
      if (limitInput) limitInput.disabled = false;
      if (limitStatus) limitStatus.textContent = "";
    } else {
      if (statusText) {
        statusText.textContent = "Not Synced";
        statusText.style.color = "#de350b";
      }
      if (timeText) timeText.textContent = "Never";
      if (countText) countText.textContent = "0";
      if (stepsCountText) stepsCountText.textContent = "0";

      if (enabledInput) enabledInput.disabled = true;
      if (limitInput) limitInput.disabled = true;
      if (limitStatus) {
        limitStatus.innerHTML = `⚠️ Sync steps library first on the <a href="#" id="go-to-integration-tab" style="color: #0052cc; text-decoration: underline; font-weight: bold;">Integration tab</a> to configure this option.`;
        limitStatus.style.color = "#de350b";

        const link = document.getElementById("go-to-integration-tab");
        if (link) {
          link.onclick = (e) => {
            e.preventDefault();
            const integrationTabBtn = document.querySelector('.tab-link[data-target="integration-tab"]');
            if (integrationTabBtn) {
              integrationTabBtn.click();
            }
          };
        }
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  updateSetupLink();
  updateLibraryStats();

  document.getElementById("confirm-discard-btn")?.addEventListener("click", () => {
    if (pendingTabSwitch) {
      restoreTabValues(pendingTabSwitch.currentTabId);
      switchTabTo(pendingTabSwitch.targetTabId);
    }
    closeConfirmModal();
  });

  document.getElementById("confirm-cancel-btn")?.addEventListener("click", () => {
    closeConfirmModal();
  });

  function closeConfirmModal() {
    const modal = document.getElementById("unsaved-confirm-modal");
    if (modal) modal.style.display = "none";
    pendingTabSwitch = null;
  }

  chrome.storage.sync.get(
    ["clientId", "clientSecret", "host", "geminiKey", "defaultAgent", "ollamaModel", "geminiModel",
     "mtplxHost", "mtplxModel", "groqKey", "groqModel", "openaiHost", "openaiKey", "openaiModel",
     "contextPanelHidden", "contextDefaultParent", "contextDefaultConfluence", "selectedSyncProjects", "libraryStepsLimit", "libraryStepsEnabled"],
    (items) => {
      savedSettings = JSON.parse(JSON.stringify(items));
      selectedSyncProjects = items.selectedSyncProjects || [];
      renderSelectedProjects();
      loadJiraProjects();
      if (items.clientId) document.getElementById("clientId").value = items.clientId;
      if (items.clientSecret) document.getElementById("clientSecret").value = items.clientSecret;
      if (items.host) document.getElementById("host").value = items.host;
      if (items.geminiKey) document.getElementById("geminiKey").value = items.geminiKey;
      if (items.groqKey) document.getElementById("groqKey").value = items.groqKey;
      if (items.openaiHost) document.getElementById("openaiHost").value = items.openaiHost;
      if (items.openaiKey) document.getElementById("openaiKey").value = items.openaiKey;
      if (items.openaiModel) document.getElementById("openaiModel").value = items.openaiModel;

      document.getElementById("mtplxHost").value = items.mtplxHost || "http://127.0.0.1:8000";

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

      if (defaultAgent === "mtplx") {
        const mtplxHost = items.mtplxHost || "http://127.0.0.1:8000";
        fetchMtplxModels(mtplxHost).then(() => {
          if (items.mtplxModel) {
            const select = document.getElementById("mtplxModel");
            const status = document.getElementById("mtplxModelFetchStatus");
            if (select) {
              select.value = items.mtplxModel;
              if (select.value !== items.mtplxModel && status) {
                status.textContent = `Saved model "${items.mtplxModel}" not found.`;
                status.style.color = "#e67e22";
              }
            }
          }
        });
      }

      if (defaultAgent === "groq" && items.groqKey) {
        fetchGroqModels(items.groqKey).then(() => {
          if (items.groqModel) {
            const select = document.getElementById("groqModel");
            const status = document.getElementById("groqModelFetchStatus");
            if (select) {
              select.value = items.groqModel;
              if (select.value !== items.groqModel && status) {
                status.textContent = `Saved model "${items.groqModel}" not found.`;
                status.style.color = "#e67e22";
              }
            }
          }
        });
      }

      if (defaultAgent === "openai" && items.openaiHost) {
        fetchOpenaiModels(items.openaiHost, items.openaiKey).then(() => {
          if (items.openaiModel) {
            const select = document.getElementById("openaiModel");
            const status = document.getElementById("openaiModelFetchStatus");
            if (select) {
              select.value = items.openaiModel;
              if (select.value !== items.openaiModel) {
                const opt = document.createElement("option");
                opt.value = items.openaiModel;
                opt.textContent = `${items.openaiModel} (Saved)`;
                select.appendChild(opt);
                select.value = items.openaiModel;
              }
            }
          }
        });
      }

      // Wire up context enrichment settings
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

      const libraryStepsEnabledEl = document.getElementById("libraryStepsEnabled");
      const libraryStepsLimitEl = document.getElementById("libraryStepsLimit");
      const libraryStepsLimitContainer = document.getElementById("libraryStepsLimitContainer");

      if (libraryStepsEnabledEl) {
        libraryStepsEnabledEl.checked = items.libraryStepsEnabled !== false;
        if (libraryStepsLimitContainer) {
          libraryStepsLimitContainer.style.display = libraryStepsEnabledEl.checked ? "block" : "none";
        }
        libraryStepsEnabledEl.addEventListener("change", () => {
          if (libraryStepsLimitContainer) {
            libraryStepsLimitContainer.style.display = libraryStepsEnabledEl.checked ? "block" : "none";
          }
        });
      }

      if (libraryStepsLimitEl) {
        libraryStepsLimitEl.value = items.libraryStepsLimit ?? "30";
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
          if (e.target.value === "mtplx") {
            const host = document.getElementById("mtplxHost").value || "http://127.0.0.1:8000";
            fetchMtplxModels(host);
          }
          if (e.target.value === "groq") {
            const key = document.getElementById("groqKey").value;
            fetchGroqModels(key);
          }
          if (e.target.value === "openai") {
            const host = document.getElementById("openaiHost").value;
            const key = document.getElementById("openaiKey").value;
            fetchOpenaiModels(host, key);
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

document.getElementById("refreshMtplxModels")?.addEventListener("click", () => {
  const host = document.getElementById("mtplxHost").value || "http://127.0.0.1:8000";
  fetchMtplxModels(host);
});

document.getElementById("refreshGroqModels")?.addEventListener("click", () => {
  const key = document.getElementById("groqKey").value;
  fetchGroqModels(key);
});

document.getElementById("refreshOpenaiModels")?.addEventListener("click", () => {
  const host = document.getElementById("openaiHost").value;
  const key = document.getElementById("openaiKey").value;
  fetchOpenaiModels(host, key);
});

// Save Agent Settings
document.getElementById("saveAgent")?.addEventListener("click", () => {
  const host = document.getElementById("host").value;
  const geminiKey = document.getElementById("geminiKey").value;
  const mtplxHost = document.getElementById("mtplxHost").value;
  const defaultAgent = document.querySelector('input[name="defaultAgent"]:checked').value;
  const ollamaModelEl = document.getElementById("ollamaModel");
  const ollamaModel = ollamaModelEl ? ollamaModelEl.value : "";
  const geminiModelEl = document.getElementById("geminiModelSelect");
  const geminiModel = geminiModelEl ? geminiModelEl.value : "";
  const mtplxModelEl = document.getElementById("mtplxModel");
  const mtplxModel = mtplxModelEl ? mtplxModelEl.value : "";
  const groqKey = document.getElementById("groqKey").value;
  const groqModelEl = document.getElementById("groqModel");
  const groqModel = groqModelEl ? groqModelEl.value : "";
  const openaiHost = document.getElementById("openaiHost").value;
  const openaiKey = document.getElementById("openaiKey").value;
  const openaiModel = document.getElementById("openaiModel").value;

  chrome.storage.sync.set(
    { host, geminiKey, mtplxHost, defaultAgent, ollamaModel, geminiModel, mtplxModel, groqKey, groqModel, openaiHost, openaiKey, openaiModel },
    () => {
      savedSettings.host = host;
      savedSettings.geminiKey = geminiKey;
      savedSettings.mtplxHost = mtplxHost;
      savedSettings.defaultAgent = defaultAgent;
      savedSettings.ollamaModel = ollamaModel;
      savedSettings.geminiModel = geminiModel;
      savedSettings.mtplxModel = mtplxModel;
      savedSettings.groqKey = groqKey;
      savedSettings.groqModel = groqModel;
      savedSettings.openaiHost = openaiHost;
      savedSettings.openaiKey = openaiKey;
      savedSettings.openaiModel = openaiModel;
      showStatus(`Settings saved! Default: ${defaultAgent}`, "green");
    }
  );
});

// Save Context Settings
document.getElementById("saveContext")?.addEventListener("click", () => {
  const contextDefaultParent = document.getElementById("contextDefaultParent")?.checked !== false;
  const contextDefaultConfluence = document.getElementById("contextDefaultConfluence")?.checked !== false;
  const contextPanelHidden = document.getElementById("contextPanelHidden")?.checked === true;
  const libraryStepsEnabled = document.getElementById("libraryStepsEnabled")?.checked === true;
  const libraryStepsLimit = parseInt(document.getElementById("libraryStepsLimit")?.value || "30", 10);

  chrome.storage.sync.set(
    { contextDefaultParent, contextDefaultConfluence, contextPanelHidden, libraryStepsLimit, libraryStepsEnabled },
    () => {
      savedSettings.contextDefaultParent = contextDefaultParent;
      savedSettings.contextDefaultConfluence = contextDefaultConfluence;
      savedSettings.contextPanelHidden = contextPanelHidden;
      savedSettings.libraryStepsLimit = libraryStepsLimit;
      savedSettings.libraryStepsEnabled = libraryStepsEnabled;
      showStatus("Context settings saved!", "green");
    }
  );
});

function triggerSync(syncOnlyFailed = false) {
  const btn = document.getElementById("sync-library-btn");
  const progress = document.getElementById("sync-progress");
  if (!btn || !progress) return;

  btn.disabled = true;
  progress.style.display = "block";
  progress.style.color = "#6b778c";
  progress.textContent = syncOnlyFailed 
    ? "Retrying failed steps sync..." 
    : "Syncing local steps library (this may take a minute)...";

  chrome.runtime.sendMessage({ type: "SYNC_STEPS_LIBRARY", syncOnlyFailed }, (response) => {
    btn.disabled = false;
    
    if (chrome.runtime.lastError) {
      console.error("[TestScribe] sendMessage error:", chrome.runtime.lastError);
      progress.textContent = `❌ Sync failed: ${chrome.runtime.lastError.message}`;
      progress.style.color = "#de350b";
      setTimeout(() => {
        progress.style.display = "none";
      }, 5000);
      return;
    }

    if (response && response.success) {
      if (syncOnlyFailed) {
        progress.textContent = `✓ Retry completed! Successfully synced ${response.newlySynced || 0} of the failed tests (${response.newlyFailed || 0} failed again).`;
      } else {
        progress.textContent = `✓ Sync completed! Synced ${response.newlySynced || 0} tests successfully (${response.newlyFailed || 0} failed to sync).`;
      }
      progress.style.color = "#36b37e";
      updateLibraryStats();
    } else {
      progress.textContent = `❌ Sync failed: ${response?.error || "Unknown error"}`;
      progress.style.color = "#de350b";
    }
    setTimeout(() => {
      progress.style.display = "none";
    }, 5000);
  });
}

document.getElementById("sync-library-btn")?.addEventListener("click", () => {
  triggerSync(false);
});

document.getElementById("retry-failed-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  triggerSync(true);
});

document.getElementById("clear-sync-btn")?.addEventListener("click", () => {
  if (confirm("Are you sure you want to delete all synced steps library data? This cannot be undone.")) {
    chrome.storage.local.remove([
      "testLibrary",
      "failedSyncTests",
      "lastLibrarySyncTime",
      "libraryTestsCount",
      "libraryStepsCount",
      "failedTestsCount"
    ], () => {
      updateLibraryStats();
      const progress = document.getElementById("sync-progress");
      if (progress) {
        progress.style.display = "block";
        progress.style.color = "#36b37e";
        progress.textContent = "✓ Synced steps library data cleared successfully.";
        setTimeout(() => {
          progress.style.display = "none";
        }, 3000);
      }
    });
  }
});

// Live Sync Progress Listener
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SYNC_PROGRESS") {
    const progress = document.getElementById("sync-progress");
    if (progress) {
      progress.style.display = "block";
      progress.style.color = "#6b778c";
      progress.textContent = `Syncing steps: ${message.current} of ${message.total} tests completed...`;
    }
  }
});

setValues();
