const STORAGE_KEYS = {
  ITEMS: "ganesmart_items_v1",
  COURSES: "ganesmart_courses_v1",
  SETTINGS: "ganesmart_settings_v1"
};

const DEFAULT_SETTINGS = {
  edunexEnabled: true,
  sixEnabled: true,
  teamsEnabled: true,
  intervalDays: 7,
  intervalStartDate: "",
  intervalEndDate: "",
  backendSyncEnabled: false,
  backendEndpoint: "",
  geminiEnabled: false,
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash"
};

const DEFAULT_COURSES = [
  { code: "IF1210", name: "Dasar Pemrograman", class_name: "K-01", is_enrolled: true, is_from_six: true },
  { code: "MA1101", name: "Matematika I", class_name: "K-03", is_enrolled: true, is_from_six: true },
  { code: "KI1101", name: "Kimia Dasar I", class_name: "K-02", is_enrolled: true, is_from_six: true },
  { code: "FI1101", name: "Fisika Dasar I", class_name: "K-04", is_enrolled: true, is_from_six: true },
  { code: "WI1102", name: "Berpikir Komputasional", class_name: "", is_enrolled: true, is_from_six: true },
  { code: "WI1103", name: "Pengantar Prinsip Keberlanjutan", class_name: "", is_enrolled: true, is_from_six: true },
  { code: "WI1111", name: "Laboratorium Fisika Dasar", class_name: "", is_enrolled: true, is_from_six: true },
  { code: "WI1116", name: "Computer Interaction Laboratory", class_name: "", is_enrolled: true, is_from_six: true },
  { code: "WI2005", name: "Bahasa Indonesia", class_name: "", is_enrolled: true, is_from_six: true }
];

async function getState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ITEMS,
    STORAGE_KEYS.COURSES,
    STORAGE_KEYS.SETTINGS
  ]);

  const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  const courses =
    Array.isArray(data[STORAGE_KEYS.COURSES]) && data[STORAGE_KEYS.COURSES].length > 0
      ? data[STORAGE_KEYS.COURSES]
      : DEFAULT_COURSES;
  const items = Array.isArray(data[STORAGE_KEYS.ITEMS]) ? data[STORAGE_KEYS.ITEMS] : [];

  return { items, courses, settings };
}

function normalizeTitleKey(title = "") {
  return title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(rev\.?\s*\d+|v\d+|final|updated|update|lampiran|revisi)\b/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function computeUrgencyScore(type, dueDateIso) {
  let base = type === "EXAM" ? 35 : type === "ASSIGNMENT" ? 25 : type === "SCHEDULE" ? 20 : 10;
  if (!dueDateIso) return base;
  const dueMs = Date.parse(dueDateIso);
  if (Number.isNaN(dueMs)) return base;

  const hoursLeft = (dueMs - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft <= 24) return Math.min(100, base + 65);
  if (hoursLeft <= 72) return Math.min(100, base + 50);
  if (hoursLeft <= 168) return Math.min(100, base + 30);
  return Math.min(100, base + 15);
}

function fallbackParseText(rawText = "") {
  const cleaned = String(rawText).replace(/\s+/g, " ").trim();
  const isoMatch = cleaned.match(
    /\b(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/
  );
  const dueDate = isoMatch ? `${isoMatch[1]}T${isoMatch[2] || "23:59"}` : null;

  const codeMatch = cleaned.match(/\b([A-Z]{2,4}\d{4})\b/);
  const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;

  return {
    courseCode,
    title: cleaned.slice(0, 120),
    dueDate
  };
}

// Sends ONLY the single announcement text to Gemini and discards rawText immediately after
async function parseWithGeminiEphemeral(rawText, apiKey, model) {
  if (!apiKey || !rawText) {
    return fallbackParseText(rawText);
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = [
      "Extract academic deadline details from this single snippet.",
      "Return JSON only with keys: courseCode (string or null), title (concise string), dueDate (ISO 8601 local/UTC date or date-time string or null).",
      "Snippet:",
      rawText.slice(0, 1500)
    ].join("\n");

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              courseCode: { type: "STRING", nullable: true },
              title: { type: "STRING" },
              dueDate: { type: "STRING", nullable: true }
            },
            required: ["title"]
          }
        }
      })
    });

    if (!res.ok) return fallbackParseText(rawText);

    const data = await res.json();
    const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) return fallbackParseText(rawText);

    const parsed = JSON.parse(jsonText);
    const fb = fallbackParseText(rawText);
    return {
      courseCode: (parsed.courseCode || fb.courseCode || "").toUpperCase() || null,
      title: (parsed.title || fb.title).trim().slice(0, 120),
      dueDate: parsed.dueDate || fb.dueDate
    };
  } catch (_err) {
    return fallbackParseText(rawText);
  }
}

function matchCourse(courses, candidateCode, fallbackText = "", candidateCourseName = "") {
  const enrolled = courses.filter((c) => c.is_enrolled !== false);
  if (candidateCode) {
    const exact = enrolled.find((c) => c.code.toUpperCase() === candidateCode.toUpperCase());
    if (exact) return exact;
  }

  const upperText = fallbackText.toUpperCase();
  const inText = enrolled.find((c) => c.code && upperText.includes(c.code.toUpperCase()));
  if (inText) return inText;

  return {
    code: candidateCode || "GEN",
    name: candidateCourseName || "Academic Course",
    class_name: "",
    is_enrolled: true,
    is_from_six: false
  };
}

// Keeps only permitted fields (never tokens, passwords, grades, transcripts, or student IDs)
function sanitizeStrippedPayload(record) {
  return {
    id: record.id,
    courseCode: record.courseCode,
    courseName: record.courseName,
    className: record.className,
    type: record.type,
    pipeline: record.pipeline,
    sourcePlatform: record.sourcePlatform,
    title: record.title,
    dueDate: record.dueDate,
    postedDate: record.postedDate,
    sourceUrl: record.sourceUrl,
    sixTarget: record.sixTarget || null,
    teamsTarget: record.teamsTarget || null,
    urgencyScore: record.urgencyScore,
    mergedCount: record.mergedCount,
    isCompleted: Boolean(record.isCompleted)
  };
}

async function maybePushStrippedToBackend(settings, strippedItems) {
  if (!settings.backendSyncEnabled || !settings.backendEndpoint || strippedItems.length === 0) {
    return;
  }
  try {
    await fetch(settings.backendEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: strippedItems })
    });
  } catch (_err) {
    // Non-blocking in prototype mode
  }
}

async function updateItemSourceUrl(itemId, sourceUrl) {
  if (!itemId || !sourceUrl) return;
  const { items } = await getState();
  const next = items.map((i) => (i.id === itemId ? { ...i, sourceUrl } : i));
  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: next });
}

// Runs inside the page's MAIN JS world to invoke React's onClick prop on the Fluent UI card
function clickTeamsCardInMainWorld(target) {
  const cards = [
    ...document.querySelectorAll(".aui-assignmentListCard, [class*='assignmentListCard']")
  ];
  if (cards.length === 0) return { clicked: false };

  let chosen = target?.cardId ? document.getElementById(target.cardId) : null;

  if (!chosen && target?.title) {
    const normTitle = target.title.trim().toLowerCase();
    const normCourse = (target.courseLine || target.courseCode || "").trim().toLowerCase();

    chosen =
      cards.find((c) => {
        const lines = (c.innerText || "")
          .split(/\n+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const titleOk = lines.some((l) => l === normTitle || l.includes(normTitle));
        const courseOk = !normCourse || lines.some((l) => l.includes(normCourse));
        return titleOk && courseOk;
      }) ||
      cards.find((c) => (c.innerText || "").toLowerCase().includes(normTitle));
  }

  if (!chosen) return { clicked: false };

  chosen.scrollIntoView({ behavior: "smooth", block: "center" });

  // Invoke React's onClick prop directly (bypasses isTrusted restrictions on synthetic events)
  const propsKey = Object.keys(chosen).find((k) => k.startsWith("__reactProps"));
  const reactProps = propsKey ? chosen[propsKey] : null;
  if (reactProps && typeof reactProps.onClick === "function") {
    reactProps.onClick({
      type: "click",
      target: chosen,
      currentTarget: chosen,
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
      persist() {}
    });
    return { clicked: true, cardId: chosen.id || target?.cardId || null };
  }

  // Fallback: keyboard Enter + bubbling click on the card title
  chosen.focus();
  chosen.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    })
  );
  const titleEl = chosen.querySelector("[data-test*='assignment-card-title']") || chosen;
  titleEl.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0
    })
  );

  return { clicked: true, cardId: chosen.id || target?.cardId || null };
}

function getTeamsAssignmentFrameUrl() {
  if (
    window.location.hostname.includes("assignments.edu.cloud.microsoft") &&
    window.location.href.includes("/assignments/")
  ) {
    return window.location.href;
  }
  return null;
}

async function tryTriggerCardOnTab(tabId, target) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: clickTeamsCardInMainWorld,
      args: [target]
    });
    return results?.find((r) => r?.result?.clicked)?.result || null;
  } catch (_e) {
    return null;
  }
}

async function captureAndSaveDeepTeamsUrl(tabId, itemId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 350));
    try {
      const urlResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: "MAIN",
        func: getTeamsAssignmentFrameUrl
      });
      const deepUrl = urlResults?.find((r) => Boolean(r?.result))?.result;
      if (deepUrl) {
        await updateItemSourceUrl(itemId, deepUrl);
        return deepUrl;
      }
    } catch (_e) {}
  }
  return null;
}

async function openTeamsAssignmentFlow(item) {
  // 1. If we already captured the direct /classes/<classId>/assignments/<cardId> URL, open it immediately
  if (
    item.sourceUrl &&
    item.sourceUrl.includes("assignments.edu.cloud.microsoft") &&
    item.sourceUrl.includes("/assignments/")
  ) {
    await chrome.tabs.create({ url: item.sourceUrl });
    return { ok: true, mode: "direct_url" };
  }

  const target = {
    ...(item.teamsTarget || {}),
    title: item.teamsTarget?.title || item.title,
    courseCode: item.teamsTarget?.courseCode || item.courseCode,
    itemId: item.id
  };

  // 2. Try clicking the card inside an already-open Teams / Assignments tab
  const msTabs = await chrome.tabs.query({
    url: ["*://*.cloud.microsoft/*", "*://*.microsoft.com/*", "*://*.office.com/*"]
  });
  const existingTab = msTabs.find((t) =>
    /teams\.cloud\.microsoft|teams\.microsoft\.com|assignments\.edu\.cloud\.microsoft/i.test(
      t.url || ""
    )
  );

  if (existingTab?.id) {
    const hit = await tryTriggerCardOnTab(existingTab.id, target);
    if (hit?.clicked) {
      await chrome.tabs.update(existingTab.id, { active: true });
      if (existingTab.windowId) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
      await captureAndSaveDeepTeamsUrl(existingTab.id, item.id);
      return { ok: true, mode: "existing_tab" };
    }
  }

  // 3. Otherwise open Assignments directly in a new tab and poll in MAIN world until the card renders
  const listUrl =
    item.sourceUrl && item.sourceUrl.includes("assignments.edu.cloud.microsoft")
      ? item.sourceUrl
      : "https://assignments.edu.cloud.microsoft/classes/all/list";

  const createdTab = await chrome.tabs.create({ url: listUrl });
  if (createdTab?.id) {
    for (let attempt = 0; attempt < 24; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const hit = await tryTriggerCardOnTab(createdTab.id, target);
      if (hit?.clicked) {
        await captureAndSaveDeepTeamsUrl(createdTab.id, item.id);
        return { ok: true, mode: "new_tab_clicked" };
      }
    }
  }

  return { ok: false };
}

async function ingestExtractedBatch(batch) {
  const { items, courses: existingCourses, settings } = await getState();
  let courses = [...existingCourses];

  if (Array.isArray(batch.courses) && batch.courses.length > 0) {
    const courseMap = new Map(courses.map((c) => [c.code.toUpperCase(), c]));
    for (const c of batch.courses) {
      if (!c.code || !c.name) continue;
      const key = c.code.toUpperCase();
      courseMap.set(key, {
        code: key,
        name: String(c.name).trim(),
        class_name: String(c.class_name || "").trim(),
        is_enrolled: c.is_enrolled !== false,
        is_from_six: Boolean(c.is_from_six)
      });
    }
    courses = Array.from(courseMap.values());
    await chrome.storage.local.set({ [STORAGE_KEYS.COURSES]: courses });
  }

  const rawCandidates = Array.isArray(batch.candidates) ? batch.candidates : [];
  const nextItems = [...items];
  const touchedStripped = [];

  for (const cand of rawCandidates) {
    const snippetForParsing = [cand.title, cand.message, cand.rawSnippet].filter(Boolean).join(" — ");
    const parsed = await parseWithGeminiEphemeral(
      snippetForParsing,
      settings.geminiEnabled ? settings.geminiApiKey : "",
      settings.geminiModel
    );

    const course = matchCourse(
      courses,
      cand.courseCode || parsed.courseCode,
      snippetForParsing,
      cand.courseName
    );
    const title = (cand.title || parsed.title || "Academic Update").trim().slice(0, 120);
    const dueDate = cand.dueDate || parsed.dueDate || null;
    const type = cand.type || "ASSIGNMENT";
    const pipeline = cand.pipeline || "Notification Bell";
    const sourcePlatform = cand.sourcePlatform || "Edunex";
    const postedDate = cand.postedDate || new Date().toISOString();
    const sourceUrl = cand.sourceUrl || "";
    const urgencyScore = computeUrgencyScore(type, dueDate);

    const dedupeKey =
      type === "SCHEDULE"
        ? `${course.code}|${dueDate || ""}|${normalizeTitleKey(title)}`
        : `${course.code}|${normalizeTitleKey(title)}`;

    const existingIdx = nextItems.findIndex((existing) => {
      const existingKey =
        existing.type === "SCHEDULE"
          ? `${existing.courseCode}|${existing.dueDate || ""}|${normalizeTitleKey(existing.title)}`
          : `${existing.courseCode}|${normalizeTitleKey(existing.title)}`;
      return existingKey === dedupeKey && !existing.isCompleted;
    });

    if (existingIdx !== -1) {
      const existing = nextItems[existingIdx];
      const isDeepTeamsUrl = (url = "") => url.includes("/assignments/");
      const preservedUrl =
        existing.sourceUrl && isDeepTeamsUrl(existing.sourceUrl) && !isDeepTeamsUrl(sourceUrl)
          ? existing.sourceUrl
          : sourceUrl || existing.sourceUrl;

      const updated = sanitizeStrippedPayload({
        ...existing,
        title,
        dueDate: dueDate || existing.dueDate,
        sourceUrl: preservedUrl,
        sixTarget: cand.sixTarget || existing.sixTarget || null,
        teamsTarget: cand.teamsTarget || existing.teamsTarget || null,
        urgencyScore: Math.max(existing.urgencyScore || 0, urgencyScore),
        mergedCount: existing.type === "SCHEDULE" ? 1 : (existing.mergedCount || 1) + 1
      });
      nextItems[existingIdx] = updated;
      touchedStripped.push(updated);
    } else {
      const created = sanitizeStrippedPayload({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        courseCode: course.code,
        courseName: course.name,
        className: cand.className || course.class_name,
        type,
        pipeline,
        sourcePlatform,
        title,
        dueDate,
        postedDate,
        sourceUrl,
        sixTarget: cand.sixTarget || null,
        teamsTarget: cand.teamsTarget || null,
        urgencyScore,
        mergedCount: 1,
        isCompleted: false
      });
      nextItems.push(created);
      touchedStripped.push(created);
    }
  }

  nextItems.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    return Date.parse(a.dueDate || "2099-12-31") - Date.parse(b.dueDate || "2099-12-31");
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: nextItems });
  await maybePushStrippedToBackend(settings, touchedStripped);

  return {
    savedCount: rawCandidates.length,
    totalItems: nextItems.length,
    totalCourses: courses.length
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "INGEST_BATCH") {
      const result = await ingestExtractedBatch(message.payload || {});
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message?.type === "GET_DASHBOARD_STATE") {
      const state = await getState();
      sendResponse({ ok: true, ...state });
      return;
    }

    if (message?.type === "SAVE_SETTINGS") {
      const { settings } = await getState();
      const updated = { ...settings, ...(message.settings || {}) };
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: updated });
      sendResponse({ ok: true, settings: updated });
      return;
    }

    if (message?.type === "TOGGLE_COMPLETE") {
      const { items } = await getState();
      const next = items.map((i) => (i.id === message.id ? { ...i, isCompleted: !i.isCompleted } : i));
      await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: next });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "OPEN_TEAMS_ASSIGNMENT") {
      const result = await openTeamsAssignmentFlow(message.item || {});
      sendResponse(result);
      return;
    }

    if (message?.type === "DELETE_ITEM") {
      const { items } = await getState();
      const next = items.filter((i) => i.id !== message.id);
      await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: next });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "DELETE_ALL_DATA") {
      await chrome.storage.local.set({
        [STORAGE_KEYS.ITEMS]: [],
        [STORAGE_KEYS.COURSES]: []
      });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});