console.log("Merge tab loaded");

/* ===== STATE ===== */
let mergeSession = null;
let existingTests = [];
let currentTicketIndex = 0;
// pendingChanges: ticketKey -> steps[] (full replacement list, copy-on-first-write)
const pendingChanges = new Map();

let projectLibrary = [];

/* ===== HISTORY STATE & UTILITIES ===== */
const undoStack = [];
const redoStack = [];

function saveHistoryState() {
  const stateSnapshot = {
    generatedSteps: JSON.parse(JSON.stringify(mergeSession.generatedTest.steps)),
    pendingChanges: Array.from(pendingChanges.entries()).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v))
    ])
  };
  undoStack.push(stateSnapshot);
  // Clear redo stack on new action
  redoStack.length = 0;
  updateHistoryButtons();
}

function undoChange() {
  if (undoStack.length === 0) return;
  const currentStateSnapshot = {
    generatedSteps: JSON.parse(JSON.stringify(mergeSession.generatedTest.steps)),
    pendingChanges: Array.from(pendingChanges.entries()).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v))
    ])
  };
  redoStack.push(currentStateSnapshot);

  const prevState = undoStack.pop();
  applyHistoryState(prevState);
}

function redoChange() {
  if (redoStack.length === 0) return;
  const currentStateSnapshot = {
    generatedSteps: JSON.parse(JSON.stringify(mergeSession.generatedTest.steps)),
    pendingChanges: Array.from(pendingChanges.entries()).map(([k, v]) => [
      k,
      JSON.parse(JSON.stringify(v))
    ])
  };
  undoStack.push(currentStateSnapshot);

  const nextState = redoStack.pop();
  applyHistoryState(nextState);
}

function applyHistoryState(state) {
  mergeSession.generatedTest.steps = state.generatedSteps;
  pendingChanges.clear();
  state.pendingChanges.forEach(([k, v]) => {
    pendingChanges.set(k, v);
  });

  renderGeneratedSteps();
  renderExistingSteps();
  updateHistoryButtons();
  updateSaveButton();
}

function updateHistoryButtons() {
  const revertBtn = document.getElementById("revert-btn");
  const repeatBtn = document.getElementById("repeat-btn");
  if (revertBtn) revertBtn.disabled = undoStack.length === 0;
  if (repeatBtn) repeatBtn.disabled = redoStack.length === 0;
}

const SIMILARITY_THRESHOLD = 0.6;

// Duplicated from background.js, options.js, popup.js — keep all four in sync
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

/* ===== BOOTSTRAP ===== */

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const storage = await chrome.storage.local.get(["mergeSession", "testLibrary"]);
  mergeSession = storage.mergeSession;
  projectLibrary = storage.testLibrary || [];
  compileLibrarySteps(projectLibrary);

  if (!mergeSession) {
    document.body.innerHTML =
      '<p style="padding:20px;color:#de350b;">No merge session found. Close this tab and click "Review &amp; Merge" again.</p>';
    return;
  }

  // Filter out any initial "Feature:" line from step rows for Cucumber tests
  if (mergeSession.generatedTest) {
    if (mergeSession.generatedTest.type === "cucumber" && Array.isArray(mergeSession.generatedTest.steps)) {
      const featureLines = mergeSession.generatedTest.steps.filter(s => s.trim().startsWith("Feature:"));
      if (featureLines.length > 0) {
        const featureMatch = featureLines[0].match(/Feature:\s*(.*)/i);
        if (featureMatch && (!mergeSession.generatedTest.summary || mergeSession.generatedTest.summary === "Generated Test")) {
          mergeSession.generatedTest.summary = featureMatch[1].trim();
        }
        mergeSession.generatedTest.steps = mergeSession.generatedTest.steps.filter(s => !s.trim().startsWith("Feature:"));
      }
    }
  }

  document.getElementById("issue-label").textContent = mergeSession.issueKey;

  const issueKey = mergeSession.issueKey;
  const projectKey = issueKey.split("-")[0];
  const scopeSelect = document.getElementById("scope-select");
  if (scopeSelect) {
    const testPlanOpt = scopeSelect.querySelector('option[value="testplan"]');
    const testSetOpt = scopeSelect.querySelector('option[value="testset"]');
    const projectOpt = scopeSelect.querySelector('option[value="project"]');

    if (testPlanOpt) testPlanOpt.textContent = `Test Plans linked to ${issueKey} ticket`;
    if (testSetOpt) testSetOpt.textContent = `Test Sets linked to ${issueKey} ticket`;
    if (projectOpt) projectOpt.textContent = `All tests in ${projectKey} project`;
  }

  // Resolve baseUrl dynamically
  if (mergeSession.jiraTabId && !mergeSession.baseUrl) {
    try {
      const tab = await chrome.tabs.get(mergeSession.jiraTabId);
      if (tab && tab.url) {
        mergeSession.baseUrl = new URL(tab.url).origin;
      }
    } catch (e) {
      console.warn("Could not retrieve tab URL in merge.js:", e);
    }
  }
  
  if (!mergeSession.baseUrl) {
    try {
      const tabs = await chrome.tabs.query({ url: "*://*.atlassian.net/*" });
      if (tabs && tabs.length > 0 && tabs[0].url) {
        mergeSession.baseUrl = new URL(tabs[0].url).origin;
      }
    } catch (e) {
      console.warn("Fallback query for baseUrl failed in merge.js:", e);
    }
  }

  // Setup live feature summary input listener
  const summaryInput = document.getElementById("gen-summary");
  if (summaryInput && mergeSession.generatedTest) {
    summaryInput.value = mergeSession.generatedTest.summary || "";
    summaryInput.addEventListener("input", () => {
      mergeSession.generatedTest.summary = summaryInput.value;
      chrome.storage.local.set({ mergeSession });
    });
  }

  setupScopePicker();
  setupBottomBar();
  setupKeyboardShortcuts();
  renderMergeColumns();
}

/* ===== SCOPE PICKER ===== */

function setupScopePicker() {
  const scopeSelect = document.getElementById("scope-select");
  const customJqlInput = document.getElementById("custom-jql");
  const changeScope = document.getElementById("change-scope-btn");

  scopeSelect.addEventListener("change", () => {
    customJqlInput.style.display = scopeSelect.value === "specific" ? "inline-block" : "none";
  });

  document.getElementById("search-btn").addEventListener("click", runSearch);

  if (changeScope) {
    changeScope.addEventListener("click", () => {
      document.getElementById("no-results").style.display = "none";
      document.getElementById("history-toolbar").style.display = "none";
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

  if (scope === "specific" && !customJql) {
    searchStatus.textContent = "Enter a specific test key first.";
    searchStatus.style.color = "#de350b";
    return;
  }

  searchBtn.disabled = true;
  searchStatus.style.color = "#6b778c";
  searchStatus.textContent = "Searching\u2026";

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
    const errorMsg = response?.error || "Unknown error";
    if (errorMsg.includes("Xray credentials not found")) {
      searchStatus.innerHTML = `Error: ${errorMsg} Please <a href="#" id="error-settings-link" style="color: #0052cc; text-decoration: underline; font-weight: bold; cursor: pointer;">Open Settings</a>.`;
      document.getElementById("error-settings-link")?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    } else {
      searchStatus.textContent = `Error: ${errorMsg}`;
    }
    searchStatus.style.color = "#de350b";
    return;
  }

  existingTests = response.tests || [];
  pendingChanges.clear();

  if (existingTests.length === 0) {
    searchStatus.textContent = "No tests found in this scope.";
    searchStatus.style.color = "#de350b";
    document.getElementById("no-results").style.display = "none";
    renderMergeColumns();
    return;
  }

  searchStatus.textContent = `Found ${existingTests.length} test(s).`;
  searchStatus.style.color = "#36b37e";

  autoSelectMostSimilarTicket();

  document.getElementById("no-results").style.display = "none";
  renderMergeColumns();
}

function autoSelectMostSimilarTicket() {
  if (existingTests.length === 0) return;

  const genSteps = getGenSteps();
  if (genSteps.length === 0) {
    currentTicketIndex = 0;
    return;
  }

  let bestIndex = 0;
  let bestScore = -1;

  existingTests.forEach((ticket, index) => {
    let totalMaxScore = 0;
    genSteps.forEach(genStep => {
      const genText = stepToText(genStep);
      let maxStepScore = 0;
      (ticket.steps || []).forEach(exStep => {
        const score = jaccardSimilarity(genText, stepToText(exStep));
        if (score > maxStepScore) {
          maxStepScore = score;
        }
      });
      totalMaxScore += maxStepScore;
    });

    const score = totalMaxScore / genSteps.length;
    console.log(`[TestScribe] Similarity score for ticket ${ticket.key}:`, score);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  console.log(`[TestScribe] Auto-selected ticket index: ${bestIndex} (${existingTests[bestIndex].key}) with score: ${bestScore}`);
  currentTicketIndex = bestIndex;
}

/* ===== RENDER MERGE COLUMNS ===== */

function renderMergeColumns() {
  document.getElementById("history-toolbar").style.display = "flex";
  document.getElementById("merge-columns").style.display = "flex";
  renderTicketDropdown();
  renderGeneratedSteps();
  renderExistingSteps();
}

function renderTicketDropdown() {
  const trigger = document.getElementById("ticket-dropdown-trigger");
  const menu = document.getElementById("ticket-dropdown-menu");
  const searchInput = document.getElementById("ticket-search-input");
  const listContainer = document.getElementById("ticket-options-list");

  const closeMenu = () => {
    menu.style.display = "none";
  };

  if (existingTests.length === 0) {
    const statusText = document.getElementById("search-status").textContent;
    trigger.textContent = statusText ? "No tests found in search scope..." : "Search JIRA project first...";
    trigger.classList.add("disabled");
    closeMenu();
    return;
  }

  trigger.classList.remove("disabled");
  const selectedTicket = existingTests[currentTicketIndex] || existingTests[0];
  if (selectedTicket) {
    trigger.textContent = `${selectedTicket.key} — ${selectedTicket.summary}`;
  }

  trigger.onclick = (e) => {
    e.stopPropagation();
    if (trigger.classList.contains("disabled")) return;

    const isShowing = menu.style.display === "flex";
    if (!isShowing) {
      menu.style.display = "flex";
      searchInput.value = "";
      filterOptions("");
      setTimeout(() => searchInput.focus(), 50);
    } else {
      closeMenu();
    }
  };

  function filterOptions(queryText) {
    listContainer.innerHTML = "";
    const q = queryText.toLowerCase();

    existingTests.forEach((t, i) => {
      const matchKey = t.key.toLowerCase().includes(q);
      const matchSummary = t.summary.toLowerCase().includes(q);
      if (q && !matchKey && !matchSummary) return;

      const item = document.createElement("div");
      item.className = "option-item";
      if (i === currentTicketIndex) {
        item.classList.add("selected");
      }
      item.textContent = `${t.key} — ${t.summary}`;
      item.onclick = (e) => {
        e.stopPropagation();
        currentTicketIndex = i;
        trigger.textContent = `${t.key} — ${t.summary}`;
        closeMenu();
        renderExistingSteps();
        updateFuzzyMatches();
      };
      listContainer.appendChild(item);
    });
  }

  searchInput.oninput = (e) => {
    filterOptions(e.target.value);
  };

  if (existingTests.length <= 1) {
    searchInput.style.display = "none";
  } else {
    searchInput.style.display = "block";
  }
}

// Close custom dropdown when clicking outside
document.addEventListener("click", (e) => {
  const menu = document.getElementById("ticket-dropdown-menu");
  const container = document.getElementById("ticket-dropdown-container");
  if (menu && container && !container.contains(e.target)) {
    menu.style.display = "none";
  }
});

function getGenSteps() {
  return mergeSession.generatedTest.steps;
}

function getPendingStepsForCurrentTicket() {
  const ticket = existingTests[currentTicketIndex];
  if (!ticket) return [];
  if (!pendingChanges.has(ticket.key)) {
    pendingChanges.set(ticket.key, ticket.steps.map(s =>
      typeof s === "string" ? s : { ...s }
    ));
  }
  return pendingChanges.get(ticket.key);
}

let dragSrcIndex = null;
let dragSrcList = null;
let isGrabbed = false;

window.addEventListener("mouseup", () => {
  isGrabbed = false;
});

function makeDraggable(row, index, listType) {
  row.addEventListener("dragstart", (e) => {
    if (!isGrabbed) {
      e.preventDefault();
      return;
    }
    isGrabbed = false; // Reset immediately
    dragSrcIndex = index;
    dragSrcList = listType;
    e.dataTransfer.effectAllowed = "move";
    row.style.opacity = "0.5";
  });

  row.addEventListener("dragend", () => {
    row.style.opacity = "1";
    document.querySelectorAll(".steps-list .drag-over").forEach(el => el.classList.remove("drag-over"));
  });

  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    return false;
  });

  row.addEventListener("dragenter", (e) => {
    if (dragSrcList === listType) {
      row.classList.add("drag-over");
    }
  });

  row.addEventListener("dragleave", (e) => {
    // Only remove class if we are actually leaving the row, not just entering a child element
    if (e.relatedTarget && !row.contains(e.relatedTarget)) {
      row.classList.remove("drag-over");
    }
  });

  row.addEventListener("drop", (e) => {
    e.stopPropagation();
    if (dragSrcList !== listType) return;
    const targetIndex = index;
    if (dragSrcIndex !== targetIndex) {
      saveHistoryState();
      if (listType === "generated") {
        const steps = getGenSteps();
        const [moved] = steps.splice(dragSrcIndex, 1);
        steps.splice(targetIndex, 0, moved);
        renderGeneratedSteps();
      } else if (listType === "existing") {
        const steps = getPendingStepsForCurrentTicket();
        const [moved] = steps.splice(dragSrcIndex, 1);
        steps.splice(targetIndex, 0, moved);
        updateSaveButton();
        renderExistingSteps();
      }
    }
  });
}

function renderGeneratedSteps() {
  const container = document.getElementById("gen-steps");
  container.innerHTML = "";

  const summaryEl = document.getElementById("gen-summary");
  if (summaryEl) {
    summaryEl.value = mergeSession.generatedTest.summary || "";
  }

  const genSteps = getGenSteps();

  genSteps.forEach((step, gi) => {
    const row = document.createElement("div");
    row.className = "gen-step-row";
    row.dataset.genIndex = gi;
    row.setAttribute("draggable", "true");

    // Drag handle
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.addEventListener("mousedown", () => {
      isGrabbed = true;
    });
    row.appendChild(handle);

    makeDraggable(row, gi, "generated");

    if (mergeSession.generatedTest.type === "cucumber") {
      const ta = document.createElement("textarea");
      ta.className = "gen-step-text";
      ta.value = typeof step === "string" ? step : "";
      ta.rows = 1;
      autoGrow(ta);
      ta.addEventListener("focus", () => {
        ta.dataset.origValue = ta.value;
      });
      ta.addEventListener("change", () => {
        if (ta.value !== ta.dataset.origValue) {
          saveHistoryState();
          mergeSession.generatedTest.steps[gi] = ta.value;
          autoGrow(ta);
        }
      });
      ta.addEventListener("input", () => {
        mergeSession.generatedTest.steps[gi] = ta.value;
        autoGrow(ta);
        updateFuzzyMatches();
      });
      attachAutocomplete(ta, () => {
        saveHistoryState();
        mergeSession.generatedTest.steps[gi] = ta.value;
        autoGrow(ta);
        updateFuzzyMatches();
      });
      row.appendChild(ta);
    } else {
      ["action", "data", "result"].forEach(field => {
        const ta = document.createElement("textarea");
        ta.className = "gen-step-text";
        ta.value = (step && step[field]) ? step[field] : "";
        ta.rows = 1;
        ta.placeholder = field;
        autoGrow(ta);
        ta.addEventListener("focus", () => {
          ta.dataset.origValue = ta.value;
        });
        ta.addEventListener("change", () => {
          if (ta.value !== ta.dataset.origValue) {
            saveHistoryState();
            mergeSession.generatedTest.steps[gi][field] = ta.value;
            autoGrow(ta);
          }
        });
        ta.addEventListener("input", () => {
          mergeSession.generatedTest.steps[gi][field] = ta.value;
          autoGrow(ta);
          updateFuzzyMatches();
        });
        row.appendChild(ta);
      });
    }

    const btnGroup = document.createElement("div");
    btnGroup.className = "step-action-btns";

    const pushBtn = document.createElement("button");
    pushBtn.className = "action-btn push-btn";
    pushBtn.textContent = "→ Add";
    pushBtn.title = "Add this step to the existing ticket";
    pushBtn.addEventListener("click", () => pushStepToExisting(gi));
    btnGroup.appendChild(pushBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "action-btn remove-btn";
    removeBtn.textContent = "✕ Remove";
    removeBtn.title = "Remove this step from the generated test";
    removeBtn.addEventListener("click", () => removeGeneratedStep(gi));
    btnGroup.appendChild(removeBtn);

    row.appendChild(btnGroup);
    container.appendChild(row);
  });

  // Add the low-profile "+ Add step" row at the bottom
  const addRow = document.createElement("div");
  addRow.className = "add-step-row";
  const addBtn = document.createElement("button");
  addBtn.className = "add-step-btn";
  addBtn.innerHTML = "<span>+</span> Add step";
  addBtn.addEventListener("click", () => {
    saveHistoryState();
    const isManual = mergeSession.generatedTest.type === "manual";
    const newStep = isManual ? { action: "", data: "", result: "" } : "";
    mergeSession.generatedTest.steps.push(newStep);
    renderGeneratedSteps();
    
    // Auto-focus new textarea
    const textareas = container.querySelectorAll(".gen-step-text");
    if (textareas.length > 0) {
      textareas[textareas.length - 1].focus();
    }
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);

  updateFuzzyMatches();
}

function renderExistingSteps() {
  const container = document.getElementById("existing-steps");
  container.innerHTML = "";

  const ticket = existingTests[currentTicketIndex];
  if (!ticket) {
    const placeholder = document.createElement("div");
    placeholder.className = "existing-steps-placeholder";
    placeholder.innerHTML = `<p style="text-align:center;color:#6b778c;font-size:12px;padding:40px 20px;">Use the Search panel above to find existing tests in this JIRA project.</p>`;
    container.appendChild(placeholder);
    return;
  }

  const steps = getPendingStepsForCurrentTicket();
  steps.forEach((step, ei) => {
    container.appendChild(buildExistingStepRow(step, ei));
  });

  // Add the low-profile "+ Add step" row at the bottom
  const addRow = document.createElement("div");
  addRow.className = "add-step-row";
  const addBtn = document.createElement("button");
  addBtn.className = "add-step-btn";
  addBtn.innerHTML = "<span>+</span> Add step";
  addBtn.addEventListener("click", () => {
    saveHistoryState();
    const isManual = mergeSession.generatedTest.type === "manual";
    const newStep = isManual ? { action: "", data: "", result: "" } : "";
    const pending = getPendingStepsForCurrentTicket();
    pending.push(newStep);
    updateSaveButton();
    renderExistingSteps();
    
    // Auto-focus new textarea
    const selector = isManual ? ".manual-cell" : ".existing-step-text";
    const textareas = container.querySelectorAll(selector);
    if (textareas.length > 0) {
      textareas[textareas.length - 1].focus();
    }
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);

  updateFuzzyMatches();
}

function buildExistingStepRow(step, ei) {
  const isManual = mergeSession.generatedTest.type === "manual";
  const row = document.createElement("div");
  row.className = isManual ? "manual-step-row" : "existing-step-row";
  row.dataset.existingIndex = ei;
  row.setAttribute("draggable", "true");

  // Drag handle
  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "⠿";
  handle.addEventListener("mousedown", () => {
    isGrabbed = true;
  });
  row.appendChild(handle);

  makeDraggable(row, ei, "existing");

  if (isManual) {
    ["action", "data", "result"].forEach(field => {
      const ta = document.createElement("textarea");
      ta.className = "manual-cell";
      ta.value = (step && step[field]) ? step[field] : "";
      ta.rows = 1;
      ta.placeholder = field;
      autoGrow(ta);
      ta.addEventListener("focus", () => {
        ta.dataset.origValue = ta.value;
      });
      ta.addEventListener("change", () => {
        if (ta.value !== ta.dataset.origValue) {
          saveHistoryState();
          getPendingStepsForCurrentTicket()[ei][field] = ta.value;
          autoGrow(ta);
          updateSaveButton();
        }
      });
      ta.addEventListener("input", () => {
        getPendingStepsForCurrentTicket()[ei][field] = ta.value;
        autoGrow(ta);
        updateSaveButton();
        updateFuzzyMatches();
      });
      row.appendChild(ta);
    });
  } else {
    const ta = document.createElement("textarea");
    ta.className = "existing-step-text";
    ta.value = typeof step === "string" ? step : "";
    ta.rows = 1;
    autoGrow(ta);
    ta.addEventListener("focus", () => {
      ta.dataset.origValue = ta.value;
    });
    ta.addEventListener("change", () => {
      if (ta.value !== ta.dataset.origValue) {
        saveHistoryState();
        getPendingStepsForCurrentTicket()[ei] = ta.value;
        autoGrow(ta);
        updateSaveButton();
      }
    });
    ta.addEventListener("input", () => {
      getPendingStepsForCurrentTicket()[ei] = ta.value;
      autoGrow(ta);
      updateSaveButton();
      updateFuzzyMatches();
    });
    attachAutocomplete(ta, () => {
      saveHistoryState();
      getPendingStepsForCurrentTicket()[ei] = ta.value;
      autoGrow(ta);
      updateSaveButton();
      updateFuzzyMatches();
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

function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = ta.scrollHeight + "px";
}

/* ===== UPDATE FUZZY MATCHES DYNAMICALLY ===== */

function updateFuzzyMatches() {
  const currentTicket = existingTests[currentTicketIndex];
  if (!currentTicket) return;

  const genSteps = getGenSteps();
  const currentSteps = getPendingStepsForCurrentTicket();

  // For each generated step row in DOM:
  const genRows = document.querySelectorAll(".gen-step-row");
  genRows.forEach((row, gi) => {
    const genStep = genSteps[gi];
    if (!genStep) return;
    const genText = stepToText(genStep);

    // 1. Find best match in the currently selected ticket's steps
    let bestCurrentScore = 0;
    let bestCurrentStepIndex = -1;

    currentSteps.forEach((exStep, ei) => {
      const score = jaccardSimilarity(genText, stepToText(exStep));
      if (score > bestCurrentScore) {
        bestCurrentScore = score;
        bestCurrentStepIndex = ei;
      }
    });

    // 2. Find best match in the entire project library (excluding the current ticket)
    let bestLibScore = 0;
    let bestLibTicketKey = "";
    let bestLibStepIndex = -1;
    let bestLibStepText = "";

    projectLibrary.forEach((libTicket) => {
      if (libTicket.key === currentTicket.key) return;

      (libTicket.steps || []).forEach((libStep, lei) => {
        const score = jaccardSimilarity(genText, stepToText(libStep));
        if (score > bestLibScore) {
          bestLibScore = score;
          bestLibTicketKey = libTicket.key;
          bestLibStepIndex = lei;
          bestLibStepText = stepToText(libStep);
        }
      });
    });

    // 3. Compare and select the best overall match
    let finalScore = 0;
    let badgeText = "";
    let tooltipText = "";

    if (bestCurrentScore >= bestLibScore && bestCurrentScore >= SIMILARITY_THRESHOLD) {
      finalScore = bestCurrentScore;
      const pct = Math.round(finalScore * 100);
      badgeText = `~${pct}%`;
      const matchedStep = currentSteps[bestCurrentStepIndex];
      const stepNum = bestCurrentStepIndex + 1;
      tooltipText = `Fuzzy match (~${pct}%) with step #${stepNum} of current ticket ${currentTicket.key}:\n"${stepToText(matchedStep)}"`;
    } else if (bestLibScore >= SIMILARITY_THRESHOLD) {
      finalScore = bestLibScore;
      const pct = Math.round(finalScore * 100);
      badgeText = `~${pct}% (${bestLibTicketKey})`;
      const stepNum = bestLibStepIndex + 1;
      tooltipText = `Fuzzy match (~${pct}%) with step #${stepNum} of other ticket ${bestLibTicketKey}:\n"${bestLibStepText}"`;
    }

    // Update badge & styles based on bestScore
    let badge = row.querySelector(".match-badge");
    if (finalScore >= SIMILARITY_THRESHOLD) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "match-badge";
        row.insertBefore(badge, row.querySelector(".step-action-btns"));
      }
      badge.textContent = badgeText;
      badge.style.display = "";
      badge.dataset.genIndex = gi;
      badge.title = tooltipText;

      const pct = Math.round(finalScore * 100);
      row.className = "gen-step-row";
      if (pct >= 80) {
        row.classList.add("match-high");
      } else {
        row.classList.add("match-medium");
      }
    } else {
      if (badge) {
        badge.style.display = "none";
      }
      row.className = "gen-step-row";
    }
  });

  // Also update colors of similar steps in the EXISTING column!
  const exRows = document.querySelectorAll("#existing-steps > div");
  exRows.forEach((row, ei) => {
    const exStep = currentSteps[ei];
    if (!exStep) return;
    const exText = stepToText(exStep);

    let bestGenScore = 0;
    genSteps.forEach((genStep) => {
      const score = jaccardSimilarity(exText, stepToText(genStep));
      if (score > bestGenScore) {
        bestGenScore = score;
      }
    });

    row.className = currentTicket.testtype === "manual" ? "manual-step-row" : "existing-step-row";
    if (bestGenScore >= SIMILARITY_THRESHOLD) {
      const pct = Math.round(bestGenScore * 100);
      if (pct >= 80) {
        row.classList.add("match-high");
      } else {
        row.classList.add("match-medium");
      }
    }
  });

  syncStepRowHeights();
}

function syncStepRowHeights() {
  const genRows = document.querySelectorAll(".gen-step-row");
  const exRows = document.querySelectorAll("#existing-steps > div");

  // Reset custom heights first
  genRows.forEach(row => { row.style.height = "auto"; });
  exRows.forEach(row => { row.style.height = "auto"; });

  const count = Math.max(genRows.length, exRows.length);
  for (let i = 0; i < count; i++) {
    const genRow = genRows[i];
    const exRow = exRows[i];

    if (genRow && exRow) {
      const genHeight = genRow.offsetHeight;
      const exHeight = exRow.offsetHeight;
      const maxHeight = Math.max(genHeight, exHeight);

      genRow.style.height = `${maxHeight}px`;
      exRow.style.height = `${maxHeight}px`;
    }
  }
}

/* ===== STEP MOVE ACTIONS ===== */

function pushStepToExisting(genIndex) {
  saveHistoryState();
  const step = mergeSession.generatedTest.steps[genIndex];
  const pending = getPendingStepsForCurrentTicket();
  const newStep = typeof step === "string" ? step : { ...step };
  pending.push(newStep);
  updateSaveButton();
  renderExistingSteps();
}

function pullStepToGenerated(existingIndex) {
  saveHistoryState();
  const pending = getPendingStepsForCurrentTicket();
  const step = pending[existingIndex];

  if (mergeSession.generatedTest.type === "cucumber") {
    mergeSession.generatedTest.steps.push(typeof step === "string" ? step : "");
  } else {
    mergeSession.generatedTest.steps.push(
      typeof step === "object" && step !== null
        ? { ...step }
        : { action: String(step), data: "", result: "" }
    );
  }
  renderGeneratedSteps();
}

function removeExistingStep(existingIndex) {
  saveHistoryState();
  const pending = getPendingStepsForCurrentTicket();
  pending.splice(existingIndex, 1);
  updateSaveButton();
  renderExistingSteps();
}

function removeGeneratedStep(genIndex) {
  saveHistoryState();
  mergeSession.generatedTest.steps.splice(genIndex, 1);
  renderGeneratedSteps();
}

function updateSaveButton() {
  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) {
    saveBtn.disabled = pendingChanges.size === 0;
    const ticket = existingTests[currentTicketIndex];
    if (ticket) {
      saveBtn.textContent = `Save Changes (${ticket.key})`;
    } else {
      saveBtn.textContent = "Save Changes";
    }
  }
}

/* ===== CREATE NEW TEST CASE ===== */

async function createNewTestCase() {
  const btn = document.getElementById("create-test-btn");
  const statusEl = document.getElementById("create-test-status");
  if (!btn || !statusEl) return;

  btn.disabled = true;
  statusEl.textContent = "Creating test case...";
  statusEl.style.color = "#6b778c";

  try {
    const isManual = mergeSession.generatedTest.type === "manual";
    const testSummary = mergeSession.generatedTest.summary || `Merged Test for ${mergeSession.issueKey}`;
    
    let msgType = "IMPORT_XRAY_TEST";
    let payload = {
      type: msgType,
      issueKey: mergeSession.issueKey,
      testSummary: testSummary
    };

    if (isManual) {
      payload.type = "IMPORT_XRAY_MANUAL_TEST";
      payload.steps = mergeSession.generatedTest.steps.map(s => ({
        action: s.action || "",
        data: s.data || "",
        result: s.result || ""
      }));
    } else {
      const featureTitle = mergeSession.generatedTest.summary || "Generated Test";
      payload.scenario = `Feature: ${featureTitle}\n\n${mergeSession.generatedTest.steps.join("\n")}`;
    }

    const response = await new Promise(resolve =>
      chrome.runtime.sendMessage(payload, resolve)
    );

    if (!response || !response.success) {
      throw new Error(response?.error || "Creation failed");
    }

    const jiraLink = mergeSession.baseUrl 
      ? `${mergeSession.baseUrl}/browse/${response.testIssueKey}` 
      : `https://testitright.atlassian.net/browse/${response.testIssueKey}`;

    statusEl.innerHTML = `✓ Created: <a href="${jiraLink}" target="_blank" style="color: #36b37e; text-decoration: underline; font-weight: bold;">${response.testIssueKey}</a>`;
    statusEl.style.color = "#36b37e";

    setTimeout(() => {
      runSearch();
    }, 2000);

  } catch (err) {
    console.error("Create Test Case error:", err);
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = "#de350b";
    btn.disabled = false;
  }
}

/* ===== SAVE CHANGES ===== */

function setupBottomBar() {
  document.getElementById("save-btn").addEventListener("click", saveAllChanges);
  document.getElementById("revert-btn")?.addEventListener("click", undoChange);
  document.getElementById("repeat-btn")?.addEventListener("click", redoChange);
  document.getElementById("create-test-btn")?.addEventListener("click", createNewTestCase);
  document.getElementById("done-btn").addEventListener("click", () => window.close());
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (isCmdOrCtrl) {
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoChange();
        } else {
          undoChange();
        }
      } else if (key === "y") {
        e.preventDefault();
        redoChange();
      }
    }
  });
}

async function saveAllChanges() {
  const saveBtn = document.getElementById("save-btn");
  const statusEl = document.getElementById("save-status");

  saveBtn.disabled = true;
  statusEl.textContent = "Saving\u2026";
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

  const makeTicketLinks = (keys) => {
    const baseUrl = mergeSession.baseUrl || "";
    return keys.map(k => {
      if (baseUrl) {
        return `<a href="${baseUrl}/browse/${k}" target="_blank" style="color: #0052cc; text-decoration: underline; font-weight: bold;">${k}</a>`;
      }
      return k;
    }).join(", ");
  };

  if (failed.length === 0) {
    statusEl.innerHTML = `✓ Saved: ${makeTicketLinks(succeeded)}`;
    statusEl.style.color = "#36b37e";
    pendingChanges.clear();
  } else {
    const failMsg = failed.map(f => `${f.key}: ${f.error}`).join("; ");
    statusEl.innerHTML =
      `Errors: ${failMsg}` +
      (succeeded.length > 0 ? ` | Saved: ${makeTicketLinks(succeeded)}` : "");
    statusEl.style.color = "#de350b";
    succeeded.forEach(k => pendingChanges.delete(k));
    saveBtn.disabled = pendingChanges.size === 0;
  }
}

/* ===== GHERKIN STEP AUTOCOMPLETE ===== */

let allLibrarySteps = [];
let activeTextarea = null;
let activeDropdownIndex = 0;
let currentMatches = [];

const GHERKIN_KEYWORDS = [
  "Given", "When", "Then", "And", "But",
  "Background:", "Examples:", "Feature:", "Scenario:", "Scenario Outline:"
];

function compileLibrarySteps(testLibrary) {
  const stepsSet = new Set();
  (testLibrary || []).forEach(item => {
    (item.steps || []).forEach(step => {
      let stepText = "";
      if (typeof step === "string") {
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
      if (sw.includes(qw)) {
        maxWordScore = Math.max(maxWordScore, 1.0);
      } else {
        const dist = levenshteinDistance(qw, sw);
        const maxLen = Math.max(qw.length, sw.length);
        const sim = 1.0 - (dist / maxLen);
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

  const textareaRect = textarea.getBoundingClientRect();
  mirror.style.top = (textareaRect.top + window.scrollY) + "px";
  mirror.style.left = (textareaRect.left + window.scrollX) + "px";
  mirror.style.width = textareaRect.width + "px";
  mirror.style.height = textareaRect.height + "px";

  document.body.appendChild(mirror);
  
  const spanRect = span.getBoundingClientRect();
  const wrapperRect = document.body.getBoundingClientRect();

  const top = spanRect.top - wrapperRect.top - textarea.scrollTop;
  const left = spanRect.left - wrapperRect.left - textarea.scrollLeft;

  document.body.removeChild(mirror);

  return { top, left };
}

function updateMergeSuggestions(textarea, forceShow = false, onSelectCallback) {
  const dropdown = document.getElementById("step-autocomplete");
  const currentLineText = textarea.value;
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

  const isCurrentlyVisible = dropdown.style.display === "block";
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
    const typedKeywordLower = keyword.toLowerCase();
    const scoredMatches = allLibrarySteps.map(step => {
      const stepCleaned = step.replace(/^(Given|When|Then|And|But)\b\s*/i, "").trim();
      const stepKeywordMatch = step.match(/^(Given|When|Then|And|But)\b/i);
      const stepKeyword = stepKeywordMatch ? stepKeywordMatch[1].toLowerCase() : "";
      
      let score = 0;
      if (queryText) {
        if (stepCleaned.toLowerCase().includes(queryText)) {
          score = 2.0;
        } else {
          score = getFuzzyScore(stepCleaned, queryText);
        }
      } else {
        score = 1.0;
      }

      return { step, stepCleaned, stepKeyword, score };
    }).filter(item => {
      if (!queryText && hasKeyword && ["given", "when", "then"].includes(typedKeywordLower)) {
        if (item.stepKeyword !== typedKeywordLower) {
          return false;
        }
      }
      return item.score >= 0.4;
    });

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

    if (m.isKeywordSuggestion) {
      if (queryText) {
        const escapedQuery = queryText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`(${escapedQuery})`, "gi");
        item.innerHTML = m.step.replace(regex, "<strong>$1</strong>");
      } else {
        item.textContent = m.step;
      }
    } else {
      const stepText = hasKeyword ? m.stepCleaned : m.step;
      if (queryText) {
        try {
          const escapedQuery = queryText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const regex = new RegExp(`(${escapedQuery})`, "gi");
          if (regex.test(stepText)) {
            item.innerHTML = stepText.replace(regex, "<strong>$1</strong>");
          } else {
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

    item.addEventListener("mousedown", (e) => {
      e.preventDefault(); // Prevent textarea blur before click is handled
    });

    item.addEventListener("click", () => {
      selectMergeSuggestion(m, indent, keyword, textarea, onSelectCallback);
    });

    dropdown.appendChild(item);
  });

  const coords = getCaretCoordinates(textarea, textarea.selectionStart);
  dropdown.style.left = `${coords.left}px`;
  dropdown.style.top = `${coords.top + 20}px`;
  dropdown.style.display = "block";
}

function selectMergeSuggestion(m, indent, keyword, textarea, onSelectCallback) {
  const dropdown = document.getElementById("step-autocomplete");
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

  textarea.focus();
  textarea.value = replacementText;
  
  // Set cursor to the end
  textarea.selectionStart = textarea.selectionEnd = replacementText.length;

  dropdown.style.display = "none";
  if (onSelectCallback) onSelectCallback();
}

function renderMergeDropdownActiveState() {
  const dropdown = document.getElementById("step-autocomplete");
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

function attachAutocomplete(textarea, onSelectCallback) {
  textarea.addEventListener("keydown", (e) => {
    const dropdown = document.getElementById("step-autocomplete");
    
    // Trigger autocomplete on Ctrl+Space
    if ((e.ctrlKey || e.metaKey) && e.code === "Space") {
      e.preventDefault();
      activeDropdownIndex = 0;
      activeTextarea = textarea;
      updateMergeSuggestions(textarea, true, onSelectCallback);
      return;
    }

    if (dropdown.style.display === "block" && activeTextarea === textarea) {
      const currentLineText = textarea.value;
      const indentMatch = currentLineText.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[0] : "";
      const keywordMatch = currentLineText.trim().match(/^(Given|When|Then|And|But)\b/i);
      const keyword = keywordMatch ? keywordMatch[1] : "";

      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeDropdownIndex = (activeDropdownIndex + 1) % currentMatches.length;
        renderMergeDropdownActiveState();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        activeDropdownIndex = (activeDropdownIndex - 1 + currentMatches.length) % currentMatches.length;
        renderMergeDropdownActiveState();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const selected = currentMatches[activeDropdownIndex];
        if (selected) {
          selectMergeSuggestion(selected, indent, keyword, textarea, onSelectCallback);
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
    if (["ArrowUp", "ArrowDown", "Enter", "Escape", "Control", "Meta", "Shift", "Alt", "Tab"].includes(e.key)) {
      return;
    }
    activeTextarea = textarea;
    updateMergeSuggestions(textarea, false, onSelectCallback);
  });
}

// Global listeners to dismiss dropdown on scroll or clicking outside
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("step-autocomplete");
  if (dropdown && dropdown.style.display === "block") {
    if (!dropdown.contains(e.target) && (!activeTextarea || e.target !== activeTextarea)) {
      dropdown.style.display = "none";
    }
  }
});

document.addEventListener("scroll", (e) => {
  const dropdown = document.getElementById("step-autocomplete");
  if (dropdown) {
    dropdown.style.display = "none";
  }
}, true);

