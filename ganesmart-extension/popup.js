const statusEl = document.getElementById("status");
const feedListEl = document.getElementById("feedList");
const itemCountEl = document.getElementById("itemCount");

const edunexToggle = document.getElementById("edunexToggle");
const sixToggle = document.getElementById("sixToggle");
const geminiToggle = document.getElementById("geminiToggle");
const geminiKeyInput = document.getElementById("geminiKeyInput");
const backendToggle = document.getElementById("backendToggle");
const backendUrlInput = document.getElementById("backendUrlInput");

function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => resolve(res || { ok: false }));
  });
}

function formatDue(iso) {
  if (!iso) return "No due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function refreshUI() {
  const res = await sendMsg({ type: "GET_DASHBOARD_STATE" });
  if (!res.ok) return;

  const { items = [], settings = {} } = res;
  edunexToggle.checked = Boolean(settings.edunexEnabled);
  sixToggle.checked = Boolean(settings.sixEnabled);
  geminiToggle.checked = Boolean(settings.geminiEnabled);
  geminiKeyInput.value = settings.geminiApiKey || "";
  backendToggle.checked = Boolean(settings.backendSyncEnabled);
  backendUrlInput.value = settings.backendEndpoint || "";

  const visibleItems = items.filter((item) => {
    if (item.sourcePlatform === "Edunex" && !settings.edunexEnabled) return false;
    if (item.sourcePlatform === "SIX" && !settings.sixEnabled) return false;
    return true;
  });

  itemCountEl.textContent = visibleItems.length;

  if (visibleItems.length === 0) {
    feedListEl.innerHTML = `<div class="item-meta">No saved items yet. Open Edunex or SIX and click "Scan Open Tab".</div>`;
    return;
  }

  feedListEl.innerHTML = visibleItems
    .map((item) => {
      const doneClass = item.isCompleted ? "done" : "";
      const mergedBadge = (item.mergedCount || 1) > 1 ? ` · ${item.mergedCount} merged` : "";
      const linkHtml = item.sourceUrl
        ? `<a class="item-link" href="${item.sourceUrl}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`
        : "";

      return `
        <div class="item">
          <div style="display:flex;gap:6px;align-items:flex-start;">
            <input type="checkbox" class="complete-cb" data-id="${item.id}" ${item.isCompleted ? "checked" : ""} />
            <div>
              <div class="item-title ${doneClass}">${escapeHtml(item.title)}</div>
              <div class="item-meta">
                ${escapeHtml(item.courseCode)} · ${escapeHtml(item.sourcePlatform)} · Due: ${escapeHtml(formatDue(item.dueDate))}${mergedBadge}
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
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.getElementById("scanBtn").addEventListener("click", async () => {
  statusEl.textContent = "Scanning active tab...";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    statusEl.textContent = "No active tab found.";
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: "SCAN_OPEN_PAGE" }, async (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      statusEl.textContent = "Open an allowed Edunex or SIX page first, then scan.";
      return;
    }

    const saved = await sendMsg({ type: "INGEST_BATCH", payload: res.batch });
    statusEl.textContent = saved.ok
      ? `Processed ${saved.savedCount} candidate(s). Total saved: ${saved.totalItems}.`
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
      edunexEnabled: edunexToggle.checked,
      sixEnabled: sixToggle.checked,
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