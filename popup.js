console.log("Popup loaded");

let allLibrarySteps = [];

function compileLibrarySteps(testLibrary) {
  const stepsSet = new Set();
  (testLibrary || []).forEach(item => {
    (item.steps || []).forEach(step => {
      let stepText = "";
      if (typeof step === 'string') {
        stepText = step.trim();
      } else if (step && step.action) {
        stepText = step.action.trim();
      }
      if (stepText) {
        stepsSet.add(stepText);
      }
    });
  });
  allLibrarySteps = Array.from(stepsSet);
}

function getRelevantStepsForPrompt(issueSummary, issueDescription, limit = 30) {
  if (allLibrarySteps.length === 0) return [];

  // Tokenize ticket text to find matching keywords
  const textToTokenize = `${issueSummary} ${issueDescription || ""}`.toLowerCase();
  const tokens = textToTokenize.replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
  const stopWords = new Set(["the", "and", "a", "an", "of", "to", "in", "is", "for", "with", "on", "at", "by", "this", "that", "from", "user", "should", "ability", "be", "able", "as", "i", "want", "so"]);
  const keywords = new Set();

  tokens.forEach(tok => {
    if (tok.length >= 3 && !stopWords.has(tok)) {
      keywords.add(tok);
    }
  });

  const scoredSteps = allLibrarySteps.map(step => {
    const stepLower = step.toLowerCase();
    let score = 0;
    keywords.forEach(kw => {
      if (stepLower.includes(kw)) {
        score += 10;
      }
    });
    return { step, score };
  });

  scoredSteps.sort((a, b) => b.score - a.score);

  const matched = scoredSteps.filter(item => item.score > 0).map(item => item.step);
  const unmatched = scoredSteps.filter(item => item.score === 0).map(item => item.step);
  const finalSteps = [...matched, ...unmatched];

  return finalSteps.slice(0, limit);
}

function levenshteinDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  let matrix = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[len1][len2];
}

function getFuzzyScore(stepCleaned, queryText) {
  const queryWords = queryText.split(/\s+/).filter(w => w.length > 0);
  if (queryWords.length === 0) return 0;

  const stepWords = stepCleaned.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  let totalScore = 0;
  queryWords.forEach(qw => {
    let maxWordScore = 0;
    stepWords.forEach(sw => {
      // Direct substring match gets maximum score
      if (sw.includes(qw)) {
        maxWordScore = Math.max(maxWordScore, 1.0);
      } else {
        // Calculate Levenshtein similarity
        const dist = levenshteinDistance(qw, sw);
        const maxLen = Math.max(qw.length, sw.length);
        const sim = 1.0 - (dist / maxLen);
        // Only count if similarity is reasonable (e.g. >= 0.5)
        if (sim >= 0.5) {
          maxWordScore = Math.max(maxWordScore, sim);
        }
      }
    });
    totalScore += maxWordScore;
  });

  return totalScore / queryWords.length;
}

function getCaretCoordinates(textarea, position) {
  const styles = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";

  const properties = [
    "direction", "boxSizing", "borderStyle", "borderWidth", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "fontStretch",
    "lineHeight"
  ];

  properties.forEach(prop => {
    mirror.style[prop] = styles[prop];
  });

  mirror.textContent = textarea.value.substring(0, position);

  const span = document.createElement("span");
  span.textContent = textarea.value.substring(position) || ".";
  mirror.appendChild(span);

  // Position mirror exactly overlayed on the textarea's screen coordinates
  const textareaRect = textarea.getBoundingClientRect();
  mirror.style.top = (textareaRect.top + window.scrollY) + "px";
  mirror.style.left = (textareaRect.left + window.scrollX) + "px";
  mirror.style.width = textareaRect.width + "px";
  mirror.style.height = textareaRect.height + "px";

  document.body.appendChild(mirror);

  const spanRect = span.getBoundingClientRect();
  const wrapperRect = textarea.parentElement.getBoundingClientRect();

  // Deduct scroll progress from caret offsets
  const top = (spanRect.top - wrapperRect.top) - textarea.scrollTop;
  const left = (spanRect.left - wrapperRect.left) - textarea.scrollLeft;

  document.body.removeChild(mirror);

  return { top, left };
}

function autoResizeTextarea(textarea) {
  textarea.style.width = "100%";
  if (textarea.classList.contains("collapsed")) {
    textarea.style.height = "";
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

function formatServerError(errorMsg) {
  if (typeof errorMsg === "string" && errorMsg.includes("Gemini API Key missing")) {
    return `
      <div style="color: red; border: 1px dashed red; background: #fff5f5; padding: 12px; border-radius: 8px; margin: 10px 0; font-family: sans-serif; line-height: 1.4;">
        <strong>Server error: ${errorMsg}</strong>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          You need to configure your Gemini API Key in the settings before generating test cases.
        </p>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          Please <a href="#" class="error-open-settings-link" style="color: #0052cc; text-decoration: underline; font-weight: bold; cursor: pointer;">Open Settings</a> to paste your API Key.
        </p>
      </div>
    `;
  }

  if (typeof errorMsg === "string" && errorMsg.includes("Xray credentials not found")) {
    return `
      <div style="color: red; border: 1px dashed red; background: #fff5f5; padding: 12px; border-radius: 8px; margin: 10px 0; font-family: sans-serif; line-height: 1.4;">
        <strong>Server error: ${errorMsg}</strong>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          You need to configure your Xray Client ID and Client Secret in settings before creating or merging test cases.
        </p>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          Please <a href="#" class="error-open-settings-link" style="color: #0052cc; text-decoration: underline; font-weight: bold; cursor: pointer;">Open Settings</a> to paste your Xray API credentials.
        </p>
      </div>
    `;
  }

  if (typeof errorMsg === "string" && (errorMsg.includes("403") || errorMsg.toLowerCase().includes("forbidden"))) {
    return `
      <div style="color: red; border: 1px dashed red; background: #fff5f5; padding: 12px; border-radius: 8px; margin: 10px 0; font-family: sans-serif; line-height: 1.4;">
        <strong>Server error: ${errorMsg}</strong>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          This is likely an **Ollama CORS configuration issue**. Local extension origins (e.g. <code>chrome-extension://...</code>) are blocked by default.
        </p>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          <strong>Step 1: Check your setup</strong><br>
          Run this in Terminal / PowerShell to verify if CORS is indeed the blocker:<br>
          <code style="background: #eee; padding: 4px 6px; border-radius: 4px; display: block; margin: 4px 0; font-family: monospace; font-size: 11px; overflow-x: auto; white-space: pre;">curl -I -H "Origin: chrome-extension://test" http://localhost:11434/api/tags</code>
          - If it returns <strong>403 Forbidden</strong>, CORS needs to be fixed.<br>
          - If it returns <strong>200 OK</strong>, CORS is fine (double check your Ollama host settings).
        </p>
        <p style="margin: 6px 0 0 0; font-size: 13px; color: #333;">
          <strong>Step 2: Fix CORS (requires process restart)</strong><br>
          <strong>macOS (Terminal):</strong><br>
          <code style="background: #eee; padding: 6px; border-radius: 4px; display: block; margin: 4px 0; font-family: monospace; font-size: 11px; overflow-x: auto; white-space: pre;">launchctl setenv OLLAMA_ORIGINS "*" && killall Ollama && open -a Ollama</code>
          <strong>Windows (PowerShell):</strong><br>
          <code style="background: #eee; padding: 6px; border-radius: 4px; display: block; margin: 6px 0; font-family: monospace; font-size: 11px; overflow-x: auto; white-space: pre;">[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User'); Stop-Process -Name "ollama*" -Force -ErrorAction SilentlyContinue; Start-Process "$env:LOCALAPPDATA\\Ollama\\ollama app.exe"</code>
        </p>
      </div>
    `;
  }
  return `<p style="color:red; margin: 10px 0;">Server error: ${errorMsg}</p>`;
}

async function fetchPopupOllamaModels(host, savedModel) {
  const bar = document.getElementById("ollama-model-bar");
  const select = document.getElementById("popup-ollama-model");
  if (!bar || !select) return;

  bar.style.display = "flex";
  select.innerHTML = `<option value="">Loading models...</option>`;
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

    if (mapped.length === 0) {
      select.innerHTML = `<option value="">No models found</option>`;
      return;
    }

    select.innerHTML = "";
    mapped.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.running ? `🟢 ${m.name} (running)` : m.name;
      select.appendChild(opt);
    });

    const modelNames = mapped.map(m => m.name);
    // Pre-select saved model, or save the first one (prioritizing running models) if nothing saved yet
    if (savedModel && modelNames.includes(savedModel)) {
      select.value = savedModel;
    } else {
      select.value = modelNames[0];
      chrome.storage.sync.set({ ollamaModel: modelNames[0] });
    }
  } catch (err) {
    console.warn("fetchPopupOllamaModels failed:", err);
    const errMsg = err.message || String(err);
    if (errMsg.includes("403") || errMsg.toLowerCase().includes("forbidden")) {
      select.innerHTML = `<option value="">CORS Error (403) — run: launchctl setenv OLLAMA_ORIGINS "*"</option>`;
    } else {
      select.innerHTML = `<option value="">Ollama unreachable</option>`;
    }
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

/* ===== CONTEXT ENRICHMENT ===== */

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

function updateLoadButton(panel) {
  const btn = panel.querySelector("button");
  if (!btn) return;
  const anyChecked = [...panel.querySelectorAll("input[type=checkbox]")].some(cb => cb.checked);
  btn.disabled = !anyChecked;
  btn.style.opacity = anyChecked ? "1" : "0.5";
}

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
    items.push({
      id: `${panelId}-parent`,
      label: `Parent: ${parent.key} — ${parent.summary}`,
      type: "parent",
      checked: defaults.contextDefaultParent !== false,
    });
  }
  confluencePages.forEach(p => {
    items.push({
      id: `${panelId}-conf-${p.pageId}`,
      label: `Confluence: ${p.title}`,
      type: "confluence",
      pageId: p.pageId,
      checked: !!defaults.contextDefaultConfluence,
    });
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
  btn.addEventListener("click", () => onLoad(panel, btn, confluencePages));
  panel.appendChild(btn);

  const statusEl = document.createElement("div");
  statusEl.id = panelId + "-status";
  statusEl.style.cssText = "font-size: 11px; color: red; margin-top: 4px;";
  panel.appendChild(statusEl);

  updateLoadButton(panel);
}

async function loadContextContent(panel, btn, allConfluencePages, issueKey, jiraTabId) {
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

  // Inject into both prompts
  ["prompt-editor", "prompt-editor-manual"].forEach(editorId => {
    const editor = document.getElementById(editorId);
    if (!editor) {
      console.warn("[TestScribe] Editor not found by ID:", editorId);
      return;
    }
    let val = editor.value;
    const prevIdx = val.indexOf("\n<additional_context>");
    if (prevIdx !== -1) val = val.substring(0, prevIdx);
    const insertIdx = val.indexOf("</ticket_description>");
    if (insertIdx !== -1) {
      editor.value = val.slice(0, insertIdx + "</ticket_description>".length) + contextBlock + val.slice(insertIdx + "</ticket_description>".length);
    } else {
      editor.value = val + contextBlock;
    }
    autoResizeTextarea(editor);
  });

  // Mark both panels as loaded
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

/* ===== END CONTEXT ENRICHMENT ===== */

async function fetchPopupGeminiModels(apiKey, savedModel) {
  const bar = document.getElementById("gemini-model-bar");
  const select = document.getElementById("popup-gemini-model");
  const errContainer = document.getElementById("gemini-model-error");
  if (!bar || !select) return;

  const settingsLink = document.getElementById("open-settings-link");
  if (settingsLink && !settingsLink.dataset.bound) {
    settingsLink.dataset.bound = "true";
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  if (!apiKey) {
    bar.style.display = "none";
    if (errContainer) errContainer.style.display = "inline-flex";
    return;
  }

  if (errContainer) errContainer.style.display = "none";
  bar.style.display = "flex";

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
      bar.style.display = "none";
      if (errContainer) errContainer.style.display = "inline-flex";
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
    bar.style.display = "none";
    if (errContainer) errContainer.style.display = "inline-flex";
  } finally {
    if (bar.style.display !== "none") {
      select.disabled = false;
    }
  }
}

async function fetchPopupMtplxModels(host, savedModel) {
  const bar = document.getElementById("mtplx-model-bar");
  const select = document.getElementById("popup-mtplx-model");
  if (!bar || !select) return;

  bar.style.display = "flex";
  select.innerHTML = `<option value="">Loading models...</option>`;
  select.disabled = true;

  try {
    const res = await fetch(`${host}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    if (models.length === 0) {
      select.innerHTML = `<option value="">No models found</option>`;
      return;
    }

    select.innerHTML = "";
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    if (savedModel && models.includes(savedModel)) {
      select.value = savedModel;
    } else {
      select.value = models[0];
      chrome.storage.sync.set({ mtplxModel: models[0] });
    }
  } catch (err) {
    console.warn("fetchPopupMtplxModels failed:", err);
    select.innerHTML = `<option value="">MTPLX unreachable</option>`;
  } finally {
    select.disabled = false;
  }
}

async function fetchPopupGroqModels(apiKey, savedModel) {
  const bar = document.getElementById("groq-model-bar");
  const select = document.getElementById("popup-groq-model");
  const errContainer = document.getElementById("groq-model-error");
  if (!bar || !select) return;

  const settingsLink = document.getElementById("open-settings-link-groq");
  if (settingsLink && !settingsLink.dataset.bound) {
    settingsLink.dataset.bound = "true";
    settingsLink.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  if (!apiKey) {
    bar.style.display = "none";
    if (errContainer) errContainer.style.display = "inline-flex";
    return;
  }

  if (errContainer) errContainer.style.display = "none";
  bar.style.display = "flex";

  select.innerHTML = "";
  const loadingOpt = document.createElement("option");
  loadingOpt.textContent = "Loading models...";
  select.appendChild(loadingOpt);
  select.disabled = true;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || []).map(m => m.id);

    if (models.length === 0) {
      bar.style.display = "none";
      if (errContainer) errContainer.style.display = "inline-flex";
      return;
    }

    select.innerHTML = "";
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    if (savedModel && models.includes(savedModel)) {
      select.value = savedModel;
    } else if (models.length > 0) {
      select.value = models[0];
      chrome.storage.sync.set({ groqModel: models[0] });
    }
  } catch (err) {
    console.warn("fetchPopupGroqModels failed:", err);
    bar.style.display = "none";
    if (errContainer) errContainer.style.display = "inline-flex";
  } finally {
    if (bar.style.display !== "none") {
      select.disabled = false;
    }
  }
}

async function fetchPopupOpenaiModels(host, apiKey, savedModel) {
  const bar = document.getElementById("openai-model-bar");
  const select = document.getElementById("popup-openai-model");
  if (!bar || !select) return;

  if (!host) {
    bar.style.display = "none";
    return;
  }

  bar.style.display = "flex";
  select.innerHTML = `<option value="">Loading models...</option>`;
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

    if (models.length === 0) {
      select.innerHTML = `<option value="">No models found</option>`;
      return;
    }

    select.innerHTML = "";
    models.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      select.appendChild(opt);
    });

    if (savedModel && models.includes(savedModel)) {
      select.value = savedModel;
    } else {
      if (savedModel) {
        const opt = document.createElement("option");
        opt.value = savedModel;
        opt.textContent = `${savedModel} (Saved)`;
        select.appendChild(opt);
        select.value = savedModel;
      } else if (models.length > 0) {
        select.value = models[0];
        chrome.storage.sync.set({ openaiModel: models[0] });
      }
    }
  } catch (err) {
    console.warn("fetchPopupOpenaiModels failed:", err);
    if (savedModel) {
      select.innerHTML = `<option value="${savedModel}">${savedModel} (Offline)</option>`;
    } else {
      select.innerHTML = `<option value="">Unreachable</option>`;
    }
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
        <div class="editor-wrapper" style="position: relative;">
          <button class="copy-editor-btn" title="Copy test case">&#x1f4c1; Copy</button>
          <pre class="editor-highlight" aria-hidden="true"><code class="editor-code">${highlightGherkin(testText)}</code></pre>
          <textarea class="prompt-editor" spellcheck="false">${testText}</textarea>
          <!-- Floating Autocomplete Dropdown -->
          <div class="step-autocomplete-dropdown" style="display: none;"></div>
        </div>
        <div class="actions">
          <button class="ignore-btn">Ignore</button>
          <button class="create-btn">Create Jira Ticket</button>
          <button class="xray-btn" style="background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Create Xray Test</button>
          <button class="merge-btn" style="background-color: #6554c0; color: white; border: none; border-radius: 3px; cursor: pointer; padding: 5px 10px;">Review &amp; Merge</button>
        </div>
      </div>
    `;

    const textarea = card.querySelector(".prompt-editor");
    const codeObj = card.querySelector(".editor-code");
    const preObj = card.querySelector(".editor-highlight");
    const copyBtn = card.querySelector(".copy-editor-btn");
    const dropdown = card.querySelector(".step-autocomplete-dropdown");

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

    let activeDropdownIndex = 0;
    let currentMatches = [];

    // Caret-aware autocomplete logic
    function updateSuggestions(forceShow = false) {
      const text = textarea.value;
      const caretPos = textarea.selectionStart;
      const lines = text.split("\n");

      let charCount = 0;
      let currentLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for the newline char
        if (caretPos >= charCount && caretPos < charCount + lineLength) {
          currentLineIdx = i;
          break;
        }
        charCount += lineLength;
      }

      if (currentLineIdx === -1) {
        dropdown.style.display = "none";
        return;
      }

      const currentLineText = lines[currentLineIdx] || "";
      const indentMatch = currentLineText.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[0] : "";
      const cleanedLine = currentLineText.trim();

      // Bypass suggestions completely if user is typing structural headers
      const STRUCTURAL_HEADERS = ["Background:", "Examples:", "Feature:", "Scenario:", "Scenario Outline:"];
      const isStructuralHeader = STRUCTURAL_HEADERS.some(header => {
        const cleanHeader = header.toLowerCase().replace(":", "");
        const cleanLineLower = cleanedLine.toLowerCase();
        return cleanLineLower.startsWith(cleanHeader);
      });

      if (isStructuralHeader) {
        dropdown.style.display = "none";
        return;
      }

      const keywordMatch = cleanedLine.match(/^(Given|When|Then|And|But)\b\s*(.*)/i);
      const hasKeyword = !!keywordMatch;
      const keyword = hasKeyword ? keywordMatch[1] : "";
      let queryText = "";

      if (hasKeyword) {
        queryText = keywordMatch[2] ? keywordMatch[2].trim().toLowerCase() : "";
      } else {
        queryText = cleanedLine.toLowerCase();
      }

      // Check if we should suggest Gherkin keywords
      const isCurrentlyVisible = dropdown.style.display === "block";
      const GHERKIN_KEYWORDS = [
        "Given", "When", "Then", "And", "But",
        "Background:", "Examples:", "Feature:", "Scenario:", "Scenario Outline:"
      ];
      let matches = [];

      const shouldSuggestKeywords = !queryText || (!hasKeyword && queryText.length < 3);

      if (shouldSuggestKeywords) {
        if (!forceShow && !isCurrentlyVisible && queryText.length === 0) {
          dropdown.style.display = "none";
          return;
        }

        matches = GHERKIN_KEYWORDS.filter(kw => {
          if (!queryText) return true;
          return kw.toLowerCase().startsWith(queryText);
        }).map(kw => ({
          step: kw,
          stepCleaned: kw,
          stepKeyword: "",
          score: 2.0,
          isKeywordSuggestion: true
        }));
      } else {
        // Suggest step definitions from the library
        // Compile a set of steps already typed in the current textarea to avoid duplicates
        const alreadyTyped = new Set();
        lines.forEach(line => {
          const m = line.match(/^(Given|When|Then|And|But)\b\s*(.*)/i);
          if (m) {
            alreadyTyped.add(m[2].trim().toLowerCase());
          }
        });

        const typedKeywordLower = keyword.toLowerCase();
        const scoredMatches = allLibrarySteps.map(step => {
          const stepCleaned = step.replace(/^(Given|When|Then|And|But)\b\s*/i, "").trim();
          const stepKeywordMatch = step.match(/^(Given|When|Then|And|But)\b/i);
          const stepKeyword = stepKeywordMatch ? stepKeywordMatch[1].toLowerCase() : "";

          let score = 0;
          if (queryText) {
            if (stepCleaned.toLowerCase().includes(queryText)) {
              score = 2.0; // Higher weight for exact substring matches
            } else {
              score = getFuzzyScore(stepCleaned, queryText);
            }
          } else {
            score = 1.0;
          }

          return { step, stepCleaned, stepKeyword, score };
        }).filter(item => {
          // Exclude if already typed
          if (alreadyTyped.has(item.stepCleaned.toLowerCase())) {
            return false;
          }

          // Strict keyword matching (only if query is empty, e.g. browsing via Ctrl+Space)
          if (!queryText && hasKeyword && ["given", "when", "then"].includes(typedKeywordLower)) {
            if (item.stepKeyword !== typedKeywordLower) {
              return false;
            }
          }

          // Only keep matches that are close enough
          return item.score >= 0.4;
        });

        // Sort matches by score descending
        scoredMatches.sort((a, b) => b.score - a.score);
        matches = scoredMatches.slice(0, 5);
      }

      if (matches.length === 0) {
        dropdown.style.display = "none";
        return;
      }

      currentMatches = matches;
      activeDropdownIndex = Math.min(activeDropdownIndex, matches.length - 1);
      if (activeDropdownIndex < 0) activeDropdownIndex = 0;

      dropdown.innerHTML = "";
      matches.forEach((m, idx) => {
        const item = document.createElement("div");
        item.className = "autocomplete-item";
        if (idx === activeDropdownIndex) {
          item.classList.add("active");
        }

        // Highlight matching query characters in bold
        if (m.isKeywordSuggestion) {
          if (queryText) {
            const escapedQuery = queryText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, "gi");
            item.innerHTML = m.step.replace(regex, "<strong>$1</strong>");
          } else {
            item.textContent = m.step;
          }
        } else {
          // Show full step with original keyword if no keyword was typed, else show cleaned step
          const stepText = hasKeyword ? m.stepCleaned : m.step;
          if (queryText) {
            try {
              const escapedQuery = queryText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              const regex = new RegExp(`(${escapedQuery})`, "gi");
              if (regex.test(stepText)) {
                item.innerHTML = stepText.replace(regex, "<strong>$1</strong>");
              } else {
                // Word-level highlight fallback
                let highlighted = stepText;
                const queryWords = queryText.split(/\s+/).filter(w => w.length > 0);
                queryWords.forEach(qw => {
                  const escapedQw = qw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                  const wordRegex = new RegExp(`(${escapedQw})`, "gi");
                  highlighted = highlighted.replace(wordRegex, "<strong>$1</strong>");
                });
                item.innerHTML = highlighted;
              }
            } catch (e) {
              item.textContent = stepText;
            }
          } else {
            item.textContent = stepText;
          }
        }
        item.title = m.step;

        item.addEventListener("click", () => {
          selectSuggestion(m, currentLineIdx, lines, indent, keyword);
        });

        dropdown.appendChild(item);
      });

      // Calculate caret position to position the dropdown
      const coords = getCaretCoordinates(textarea, caretPos);
      dropdown.style.left = `${coords.left}px`;
      dropdown.style.top = `${coords.top + 20}px`; // Shift down for line height
      dropdown.style.display = "block";
    }

    function selectSuggestion(m, currentLineIdx, lines, indent, keyword) {
      let replacementText = "";
      if (m.isKeywordSuggestion) {
        replacementText = `${indent}${m.step} `;
      } else {
        if (keyword) {
          replacementText = `${indent}${keyword} ${m.stepCleaned}`;
        } else {
          replacementText = `${indent}${m.step}`;
        }
      }

      // Calculate start and end offsets of the line to replace
      let lineStart = 0;
      for (let idx = 0; idx < currentLineIdx; idx++) {
        lineStart += lines[idx].length + 1; // +1 for the newline
      }
      const lineEnd = lineStart + lines[currentLineIdx].length;

      // Select line text range
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineEnd);

      // Replace using execCommand to preserve native browser Undo history
      document.execCommand('insertText', false, replacementText);

      // Re-highlight Gherkin syntax
      codeObj.innerHTML = highlightGherkin(textarea.value);

      dropdown.style.display = "none";
    }

    function renderDropdownActiveState() {
      const items = dropdown.querySelectorAll(".autocomplete-item");
      items.forEach((item, idx) => {
        if (idx === activeDropdownIndex) {
          item.classList.add("active");
          item.scrollIntoView({ block: "nearest" });
        } else {
          item.classList.remove("active");
        }
      });
    }

    // Keydown keyboard controls
    textarea.addEventListener("keydown", (e) => {
      // Check for Ctrl + Space (or Cmd + Space on Mac)
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
        e.preventDefault();
        activeDropdownIndex = 0;
        updateSuggestions(true);
        return;
      }

      // Handle dropdown key controls when active
      if (dropdown.style.display === "block") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          activeDropdownIndex = (activeDropdownIndex + 1) % currentMatches.length;
          renderDropdownActiveState();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          activeDropdownIndex = (activeDropdownIndex - 1 + currentMatches.length) % currentMatches.length;
          renderDropdownActiveState();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const selected = currentMatches[activeDropdownIndex];
          if (selected) {
            const caretPos = textarea.selectionStart;
            const lines = textarea.value.split("\n");
            let charCount = 0;
            let currentLineIdx = -1;
            for (let i = 0; i < lines.length; i++) {
              const lineLength = lines[i].length + 1;
              if (caretPos >= charCount && caretPos < charCount + lineLength) {
                currentLineIdx = i;
                break;
              }
              charCount += lineLength;
            }
            if (currentLineIdx !== -1) {
              const currentLineText = lines[currentLineIdx] || "";
              const indentMatch = currentLineText.match(/^(\s*)/);
              const indent = indentMatch ? indentMatch[0] : "";
              const keywordMatch = currentLineText.trim().match(/^(Given|When|Then|And|But)\b/i);
              const keyword = keywordMatch ? keywordMatch[1] : "";
              selectSuggestion(selected, currentLineIdx, lines, indent, keyword);
            }
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dropdown.style.display = "none";
          return;
        }
      }
    });

    textarea.addEventListener("keyup", (e) => {
      // Never trigger suggestions on action, navigation, or modifier keys
      if (["ArrowUp", "ArrowDown", "Enter", "Escape", "Control", "Meta", "Shift", "Alt", "Tab", " "].includes(e.key)) {
        return;
      }
      updateSuggestions();
    });

    textarea.addEventListener("click", () => {
      dropdown.style.display = "none";
    });

    textarea.addEventListener("input", () => {
      codeObj.innerHTML = highlightGherkin(textarea.value);
      updateSuggestions();
    });

    // Hide dropdown on blur with a small timeout so click events can fire
    textarea.addEventListener("blur", () => {
      setTimeout(() => {
        if (dropdown) dropdown.style.display = "none";
      }, 200);
    });

    textarea.addEventListener("scroll", () => {
      preObj.scrollTop = textarea.scrollTop;
      preObj.scrollLeft = textarea.scrollLeft;
      if (dropdown.style.display === "block") {
        const caretPos = textarea.selectionStart;
        const coords = getCaretCoordinates(textarea, caretPos);
        dropdown.style.left = `${coords.left}px`;
        dropdown.style.top = `${coords.top + 20}px`;
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (dropdown.style.display === "block") {
        const caretPos = textarea.selectionStart;
        const coords = getCaretCoordinates(textarea, caretPos);
        dropdown.style.left = `${coords.left}px`;
        dropdown.style.top = `${coords.top + 20}px`;
      }
    });
    resizeObserver.observe(textarea);

    // Existing Create Test (Jira Issue)
    card.querySelector(".create-btn").onclick = (e) =>
      createTestInJira(e.target, textarea.value.trim());

    // NEW: Xray API Import
    card.querySelector(".xray-btn").onclick = (e) =>
      createXrayTestViaAPI(e.target, textarea.value.trim());

    card.querySelector(".ignore-btn").onclick = () => {
      resizeObserver.disconnect();
      card.remove();
    };

    card.querySelector(".merge-btn").onclick = () => {
      const rawText = textarea.value.trim();
      const lines = rawText.split("\n").map(l => l.trimEnd()).filter(l => l.trim().length > 0);
      const featureMatch = rawText.match(/Feature:\s*(.*)/i);
      const steps = lines.filter(l => !l.trim().startsWith("Feature:"));
      openMergeTab({
        type: "cucumber",
        summary: featureMatch ? featureMatch[1].trim() : "Generated Test",
        steps: steps,
        rawText,
      });
    };

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

  // Clear any existing error messages before starting new generation
  container.querySelectorAll(".error-message").forEach(el => el.remove());

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
            "<p class='error-message' style='color:red;'>Could not contact background script.</p>";
          return;
        }

        if (response?.error) {
          console.error("Server error:", response);
          container.innerHTML += formatServerError(response.error);
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

    // Clear any existing error messages before starting new generation
    container.querySelectorAll(".error-message").forEach(el => el.remove());

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
              "<p class='error-message' style='color:red;'>Could not contact background script.</p>";
            return;
          }

          if (response?.error) {
            container.innerHTML += formatServerError(response.error);
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

  // Event delegation to open settings from error container links
  document.addEventListener("click", (e) => {
    if (e.target && e.target.classList.contains("error-open-settings-link")) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    }
  });

  // Collapsible prompt helper
  function togglePrompt(editorId, btnId) {
    const editor = document.getElementById(editorId);
    const btn = document.getElementById(btnId);
    if (!editor || !btn) return;

    const isCollapsed = editor.classList.contains("collapsed");
    const isManual = editorId.includes("manual");
    const bottomBar = document.getElementById(isManual ? "prompt-bottom-bar-manual" : "prompt-bottom-bar");

    if (isCollapsed) {
      editor.classList.remove("collapsed");
      autoResizeTextarea(editor);
      editor.focus();
      btn.querySelector("span").textContent = "Collapse";
      if (bottomBar) bottomBar.style.display = "flex";
    } else {
      editor.classList.add("collapsed");
      btn.querySelector("span").textContent = "✏️ Edit Prompt";
      if (bottomBar) bottomBar.style.display = "none";
    }
  }

  document.getElementById("toggle-prompt-btn")?.addEventListener("click", () => {
    togglePrompt("prompt-editor", "toggle-prompt-btn");
  });

  document.getElementById("toggle-prompt-btn-manual")?.addEventListener("click", () => {
    togglePrompt("prompt-editor-manual", "toggle-prompt-btn-manual");
  });

  document.getElementById("toggle-prompt-btn-bottom")?.addEventListener("click", () => {
    togglePrompt("prompt-editor", "toggle-prompt-btn");
  });

  document.getElementById("toggle-prompt-btn-bottom-manual")?.addEventListener("click", () => {
    togglePrompt("prompt-editor-manual", "toggle-prompt-btn-manual");
  });

  document.getElementById("prompt-editor")?.addEventListener("click", () => {
    const editor = document.getElementById("prompt-editor");
    if (editor && editor.classList.contains("collapsed")) {
      togglePrompt("prompt-editor", "toggle-prompt-btn");
    }
  });

  document.getElementById("prompt-editor-manual")?.addEventListener("click", () => {
    const editor = document.getElementById("prompt-editor-manual");
    if (editor && editor.classList.contains("collapsed")) {
      togglePrompt("prompt-editor-manual", "toggle-prompt-btn-manual");
    }
  });

  const loader = document.getElementById("loader");
  const loaderManual = document.getElementById("loader-manual");
  const container = document.getElementById("test-list");

  chrome.storage.local.get(["jiraData", "jiraTabId", "testLibrary"], (localResult) => {
    chrome.storage.sync.get(["libraryStepsLimit", "libraryStepsEnabled"], (syncResult) => {
      const { issueKey, summary, description } = localResult.jiraData || {};
      const jiraTabId = localResult.jiraTabId;
      const libraryStepsEnabled = syncResult.libraryStepsEnabled !== false;
      const libraryStepsLimit = libraryStepsEnabled
        ? (syncResult.libraryStepsLimit !== undefined ? syncResult.libraryStepsLimit : 30)
        : 0;

      if (!issueKey) {
        document.body.innerHTML = "<h2>No Jira issue detected</h2>";
        return;
      }

      // Compile library steps and extract matching steps for prompt
      compileLibrarySteps(localResult.testLibrary || []);
      const relevantSteps = getRelevantStepsForPrompt(summary, description, libraryStepsLimit);
      let existingStepsBlock = "";
      if (relevantSteps.length > 0) {
        existingStepsBlock = `
REUSABLE EXISTING STEPS:
To maintain consistency and avoid duplicate step definitions, reuse the following existing step phrasings as much as possible in your generated scenarios:
<existing_steps>
${relevantSteps.map(s => `- ${s}`).join("\n")}
</existing_steps>
`;
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

${existingStepsBlock}

INSTRUCTIONS:
1. Analyze all business requirements in the ticket.
2. For each requirement, generate at least one independent testcase.
3. Write declarative steps focusing on business rules, not specific UI interactions.
4. Each Feature must contain EXACTLY ONE Scenario. Do not group multiple Scenarios under one Feature.
5. You may use 'And' and 'But' for cleaner syntax alongside 'Given', 'When', 'Then'.
6. Prepare test cases in the chronological order of the requirements in the description.
7. CRITICAL: Reuse the phrasing from <existing_steps> exactly when writing similar steps to avoid duplicates.

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
    autoResizeTextarea(promptEditor);

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
    autoResizeTextarea(promptEditorManual);

    // --- CONTEXT PANEL ---
    chrome.storage.sync.get(
      ["contextPanelHidden", "contextDefaultParent", "contextDefaultConfluence"],
      (contextSettings) => {
        if (contextSettings.contextPanelHidden === true) {
          const cp = document.getElementById("context-panel");
          const cpm = document.getElementById("context-panel-manual");
          if (cp) cp.style.display = "none";
          if (cpm) cpm.style.display = "none";
          return;
        }

        chrome.runtime.sendMessage(
          {
            type: "FETCH_CONTEXT_METADATA",
            issueKey,
            issueDescription: description,
            jiraTabId,
          },
          (metadata) => {
            if (!metadata || !metadata.success) return;

            const onLoad = (panel, btn, allConfluencePages) =>
              loadContextContent(panel, btn, allConfluencePages, issueKey, jiraTabId);

            renderContextPanel("context-panel", metadata, contextSettings, onLoad);
            renderContextPanel("context-panel-manual", metadata, contextSettings, onLoad);
          }
        );
      }
    );

    // Hide loader and enable buttons when data loads
    loader.style.display = "none";
    if (loaderManual) loaderManual.style.display = "none";

    const generateBtn = document.getElementById("generate-btn");
    if (generateBtn) generateBtn.disabled = false;

    const generateBtnManual = document.getElementById("generate-btn-manual");
    if (generateBtnManual) generateBtnManual.disabled = false;

    console.log("Jira data loaded successfully. Ready to generate tests.");
    });
  });

  function hideAllModelBars() {
    const bars = ["ollama-model-bar", "gemini-model-bar", "mtplx-model-bar", "groq-model-bar", "openai-model-bar"];
    const errors = ["gemini-model-error", "groq-model-error"];
    bars.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    errors.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
  }

  // Handle LLM Selector UI
  const llmSelector = document.getElementById("llm-selector");
  const logLink = document.getElementById("gemini-log-link");
  const ollamaModelBar = document.getElementById("ollama-model-bar");
  const popupOllamaModel = document.getElementById("popup-ollama-model");
  const geminiModelBar = document.getElementById("gemini-model-bar");
  const popupGeminiModel = document.getElementById("popup-gemini-model");

  if (llmSelector) {
    chrome.storage.sync.get(["defaultAgent", "host", "ollamaModel", "geminiKey", "geminiModel", "mtplxHost", "mtplxModel", "groqKey", "groqModel", "openaiHost", "openaiModel"], (prefs) => {
      const currentAgent = prefs.defaultAgent || "ollama";
      const host = prefs.host || "http://localhost:11434";
      const mtplxHost = prefs.mtplxHost || "http://127.0.0.1:8000";

      llmSelector.value = currentAgent;

      if (logLink) logLink.style.display = currentAgent === "gemini" ? "inline" : "none";

      hideAllModelBars();

      if (currentAgent === "ollama") {
        fetchPopupOllamaModels(host, prefs.ollamaModel);
      } else if (currentAgent === "gemini") {
        fetchPopupGeminiModels(prefs.geminiKey, prefs.geminiModel);
      } else if (currentAgent === "mtplx") {
        fetchPopupMtplxModels(mtplxHost, prefs.mtplxModel);
      } else if (currentAgent === "groq") {
        fetchPopupGroqModels(prefs.groqKey, prefs.groqModel);
      } else if (currentAgent === "openai") {
        fetchPopupOpenaiModels(prefs.openaiHost, prefs.openaiKey, prefs.openaiModel);
      }
    });

    llmSelector.addEventListener("change", () => {
      const selectedAgent = llmSelector.value;
      chrome.storage.sync.set({ defaultAgent: selectedAgent }, () => {
        console.log(`Agent switched to: ${selectedAgent}`);
      });

      if (logLink) logLink.style.display = selectedAgent === "gemini" ? "inline" : "none";

      hideAllModelBars();

      if (selectedAgent === "ollama") {
        chrome.storage.sync.get(["host", "ollamaModel"], (prefs) => {
          const host = prefs.host || "http://localhost:11434";
          fetchPopupOllamaModels(host, prefs.ollamaModel);
        });
      } else if (selectedAgent === "gemini") {
        chrome.storage.sync.get(["geminiKey", "geminiModel"], (prefs) => {
          fetchPopupGeminiModels(prefs.geminiKey, prefs.geminiModel);
        });
      } else if (selectedAgent === "mtplx") {
        chrome.storage.sync.get(["mtplxHost", "mtplxModel"], (prefs) => {
          const mtplxHost = prefs.mtplxHost || "http://127.0.0.1:8000";
          fetchPopupMtplxModels(mtplxHost, prefs.mtplxModel);
        });
      } else if (selectedAgent === "groq") {
        chrome.storage.sync.get(["groqKey", "groqModel"], (prefs) => {
          fetchPopupGroqModels(prefs.groqKey, prefs.groqModel);
        });
      } else if (selectedAgent === "openai") {
        chrome.storage.sync.get(["openaiHost", "openaiKey", "openaiModel"], (prefs) => {
          fetchPopupOpenaiModels(prefs.openaiHost, prefs.openaiKey, prefs.openaiModel);
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

  // Save Groq model to storage when changed in popup
  const popupGroqModel = document.getElementById("popup-groq-model");
  if (popupGroqModel) {
    popupGroqModel.addEventListener("change", () => {
      chrome.storage.sync.set({ groqModel: popupGroqModel.value });
    });
  }

  // Save Custom OpenAI model to storage when changed in popup
  const popupOpenaiModel = document.getElementById("popup-openai-model");
  if (popupOpenaiModel) {
    popupOpenaiModel.addEventListener("change", () => {
      chrome.storage.sync.set({ openaiModel: popupOpenaiModel.value });
    });
  }

  // Save MTPLX model to storage when changed in popup
  const popupMtplxModel = document.getElementById("popup-mtplx-model");
  if (popupMtplxModel) {
    popupMtplxModel.addEventListener("change", () => {
      chrome.storage.sync.set({ mtplxModel: popupMtplxModel.value });
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

// Global listener to close suggestions dropdowns on Escape press
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.code === "Escape") {
    const dropdowns = document.querySelectorAll(".step-autocomplete-dropdown");
    dropdowns.forEach(d => {
      if (d.style.display === "block") {
        d.style.display = "none";
      }
    });
  }
});
