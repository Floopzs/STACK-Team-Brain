const PENDING_SIX_MODAL_KEY = "ganesmart_pending_six_modal";

const statusEl = document.getElementById("status");
const feedListEl = document.getElementById("feedList");
const itemCountEl = document.getElementById("itemCount");

const intervalDaysSelect = document.getElementById("intervalDaysSelect");
const intervalStartInput = document.getElementById("intervalStartInput");
const intervalEndInput = document.getElementById("intervalEndInput");

const edunexToggle = document.getElementById("edunexToggle");
const sixToggle = document.getElementById("sixToggle");
const teamsToggle = document.getElementById("teamsToggle");
const geminiToggle = document.getElementById("geminiToggle");
const geminiKeyInput = document.getElementById("geminiKeyInput");
const backendToggle = document.getElementById("backendToggle");
const backendUrlInput = document.getElementById("backendUrlInput");

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false }));
  });
}

function getActiveWindowSettings() {
  return {
    intervalDays: Number(intervalDaysSelect.value),
    intervalStartDate: intervalStartInput.value || "",
    intervalEndDate: intervalEndInput.value || ""
  };
}

function isWithinInterval(item, windowSettings) {
  if (!item.dueDate) return true;
  const itemMs = Date.parse(item.dueDate);
  if (Number.isNaN(itemMs)) return true;

  if (windowSettings.intervalStartDate && windowSettings.intervalEndDate) {
    const startMs = Date.parse(`${windowSettings.intervalStartDate}T00:00:00`);
    const endMs = Date.parse(`${windowSettings.intervalEndDate}T23:59:59`);
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      return itemMs >= startMs && itemMs <= endMs;
    }
  }

  const days = Number(windowSettings.intervalDays ?? 7);
  if (!days || days <= 0) return true;

  const todayStartMs = new Date().setHours(0, 0, 0, 0);
  const maxMs = todayStartMs + days * 24 * 60 * 60 * 1000;
  return itemMs >= todayStartMs && itemMs <= maxMs;
}

function formatDue(iso) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function handleOpenSource(item) {
  if (item.sourcePlatform === "SIX" && item.sixTarget) {
    const targetPayload = {
      ...item.sixTarget,
      createdAt: Date.now()
    };
    await chrome.storage.local.set({ [PENDING_SIX_MODAL_KEY]: targetPayload });

    const sixTabs = await chrome.tabs.query({ url: "*://*.itb.ac.id/*" });
    const jadwalTab = sixTabs.find((t) => (t.url || "").includes("/kelas/jadwal"));

    if (jadwalTab?.id) {
      await chrome.tabs.update(jadwalTab.id, { active: true });
      if (jadwalTab.windowId) {
        await chrome.windows.update(jadwalTab.windowId, { focused: true });
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: jadwalTab.id },
          files: ["content.js"]
        });
      } catch (_e) {}

      chrome.tabs.sendMessage(jadwalTab.id, {
        type: "OPEN_SIX_MODAL",
        target: targetPayload
      });
      return;
    }
  }

  if (item.sourcePlatform === "Teams") {
    await sendMsg({
      type: "OPEN_TEAMS_ASSIGNMENT",
      item
    });
    return;
  }

  if (item.sourceUrl) {
    await chrome.tabs.create({ url: item.sourceUrl });
  }
}

async function refreshUI() {
  const res = await sendMsg({ type: "GET_DASHBOARD_STATE" });
  if (!res.ok) return;

  const { items = [], settings = {} } = res;
  edunexToggle.checked = Boolean(settings.edunexEnabled);
  sixToggle.checked = Boolean(settings.sixEnabled);
  teamsToggle.checked = settings.teamsEnabled !== false;
  geminiToggle.checked = Boolean(settings.geminiEnabled);
  geminiKeyInput.value = settings.geminiApiKey || "";
  backendToggle.checked = Boolean(settings.backendSyncEnabled);
  backendUrlInput.value = settings.backendEndpoint || "";

  intervalDaysSelect.value = String(settings.intervalDays ?? 7);
  intervalStartInput.value = settings.intervalStartDate || "";
  intervalEndInput.value = settings.intervalEndDate || "";

  const windowSettings = getActiveWindowSettings();

  const visibleItems = items.filter((item) => {
    if (item.sourcePlatform === "Edunex" && !settings.edunexEnabled) return false;
    if (item.sourcePlatform === "SIX" && !settings.sixEnabled) return false;
    if (item.sourcePlatform === "Teams" && settings.teamsEnabled === false) return false;
    return isWithinInterval(item, windowSettings);
  });

  itemCountEl.textContent = visibleItems.length;

  if (visibleItems.length === 0) {
    feedListEl.innerHTML = `<div class="item-meta">No items in this window. Open Edunex, SIX, or Teams and click "Scan Open Tab".</div>`;
    return;
  }

  feedListEl.innerHTML = visibleItems
    .map((item) => {
      const doneClass = item.isCompleted ? "done" : "";
      const mergedBadge = (item.mergedCount || 1) > 1 ? ` · ${item.mergedCount} merged` : "";
      const linkHtml = item.sourceUrl
        ? `<a class="item-link" data-id="${item.id}" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`
        : "";

      return `
        <div class="item">
          <div style="display:flex;gap:6px;align-items:flex-start;">
            <input type="checkbox" class="complete-cb" data-id="${item.id}" ${item.isCompleted ? "checked" : ""} />
            <div>
              <div class="item-title ${doneClass}">${escapeHtml(item.title)}</div>
              <div class="item-meta">
                ${escapeHtml(item.courseCode)} · ${escapeHtml(item.sourcePlatform)} (${escapeHtml(item.type || "ITEM")}) · ${escapeHtml(formatDue(item.dueDate))}${mergedBadge}
              </div>
              ${linkHtml}
            </div>
          </div>
          <button class="btn-danger del-btn" data-id="${item.id}" style="padding:3px 7px;font-size:10px;">✕</button>
        </div>
      `;
    })
    .join("");

  feedListEl.querySelectorAll(".complete-cb").forEach((cb) => {
    cb.addEventListener("change", async () => {
      await sendMsg({ type: "TOGGLE_COMPLETE", id: cb.dataset.id });
      refreshUI();
    });
  });

  feedListEl.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await sendMsg({ type: "DELETE_ITEM", id: btn.dataset.id });
      refreshUI();
    });
  });

  feedListEl.querySelectorAll(".item-link").forEach((linkEl) => {
    linkEl.addEventListener("click", (e) => {
      const item = visibleItems.find((i) => i.id === linkEl.dataset.id);
      if (
        item &&
        ((item.sourcePlatform === "SIX" && item.sixTarget) || item.sourcePlatform === "Teams")
      ) {
        e.preventDefault();
        handleOpenSource(item);
      }
    });
  });
}

async function persistIntervalChange() {
  await sendMsg({
    type: "SAVE_SETTINGS",
    settings: getActiveWindowSettings()
  });
  refreshUI();
}

intervalDaysSelect.addEventListener("change", persistIntervalChange);
intervalStartInput.addEventListener("change", persistIntervalChange);
intervalEndInput.addEventListener("change", persistIntervalChange);

document.getElementById("scanBtn").addEventListener("click", async () => {
  statusEl.textContent = "Scanning active tab...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) {
    statusEl.textContent = "No active tab found.";
    return;
  }

  let host = "";
  let isAllowedHost = false;
  try {
    host = new URL(tab.url).hostname.toLowerCase();
    isAllowedHost =
      host === "itb.ac.id" ||
      host.endsWith(".itb.ac.id") ||
      host === "cognisia.id" ||
      host.endsWith(".cognisia.id") ||
      host === "cloud.microsoft" ||
      host.endsWith(".cloud.microsoft") ||
      host === "microsoft.com" ||
      host.endsWith(".microsoft.com") ||
      host === "office.com" ||
      host.endsWith(".office.com");
  } catch (_e) {
    isAllowedHost = false;
  }

  if (!isAllowedHost) {
    statusEl.textContent = "Open an allowed Edunex, SIX, or Teams page first, then scan.";
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });
  } catch (_injectErr) {
    // Already injected
  }

  chrome.tabs.sendMessage(tab.id, { type: "SCAN_OPEN_PAGE" }, async (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      const isTeamsHost =
        host.includes("cloud.microsoft") ||
        host.includes("microsoft.com") ||
        host.includes("office.com");
      statusEl.textContent = isTeamsHost
        ? "No upcoming assignments found on this Teams view. Open Assignments → Upcoming and try again."
        : "Could not read page. Refresh the tab and try again.";
      return;
    }

    const windowSettings = getActiveWindowSettings();
    const rawCandidates = res.batch?.candidates || [];

    const filteredCandidates = rawCandidates.filter((cand) => {
      if (cand.sourcePlatform === "SIX" && cand.type === "SCHEDULE") {
        return isWithinInterval(cand, windowSettings);
      }
      return true;
    });

    const saved = await sendMsg({
      type: "INGEST_BATCH",
      payload: {
        courses: res.batch?.courses || [],
        candidates: filteredCandidates
      }
    });

    statusEl.textContent = saved.ok
      ? `Pulled ${saved.savedCount} item(s). Total saved: ${saved.totalItems}.`
      : "Could not save extracted items.";
    refreshUI();
  });
});

document.getElementById("clearAllBtn").addEventListener("click", async () => {
  await sendMsg({ type: "DELETE_ALL_DATA" });
  statusEl.textContent = "All local items and course cache deleted.";
  refreshUI();
});

document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
  const res = await sendMsg({
    type: "SAVE_SETTINGS",
    settings: {
      ...getActiveWindowSettings(),
      edunexEnabled: edunexToggle.checked,
      sixEnabled: sixToggle.checked,
      teamsEnabled: teamsToggle.checked,
      geminiEnabled: geminiToggle.checked,
      geminiApiKey: geminiKeyInput.value.trim(),
      backendSyncEnabled: backendToggle.checked,
      backendEndpoint: backendUrlInput.value.trim()
    }
  });
  statusEl.textContent = res.ok ? "Preferences saved locally." : "Failed to save preferences.";
  refreshUI();
});

refreshUI();