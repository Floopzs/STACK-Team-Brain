const STORAGE_KEYS = {
  ITEMS: "ganesmart_items_v1",
  COURSES: "ganesmart_courses_v1",
  SETTINGS: "ganesmart_settings_v1",
  SYNC: "ganesmart_sync_v1"
};

const EDUNEX_WEB = "https://edunex.itb.ac.id";
const EDUNEX_SYNC_PIPELINE = "Edunex Sync";
const AUTO_SYNC_MIN_GAP_MS = 30 * 60 * 1000;

const DEFAULT_SETTINGS = {
  edunexEnabled: true,
  sixEnabled: true,
  backendSyncEnabled: false,
  backendEndpoint: "",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  autoSyncEdunex: true
};

const DEFAULT_COURSES = [
  { code: "IF1210", name: "Dasar Pemrograman", class_name: "K-01", is_enrolled: true, is_from_six: true },
  { code: "MA1101", name: "Matematika I", class_name: "K-03", is_enrolled: true, is_from_six: true },
  { code: "KI1101", name: "Kimia Dasar I", class_name: "K-02", is_enrolled: true, is_from_six: true },
  { code: "FI1101", name: "Fisika Dasar I", class_name: "K-04", is_enrolled: true, is_from_six: true }
];

async function getState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ITEMS,
    STORAGE_KEYS.COURSES,
    STORAGE_KEYS.SETTINGS
  ]);

  const settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };
  const courses = Array.isArray(data[STORAGE_KEYS.COURSES]) && data[STORAGE_KEYS.COURSES].length > 0
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

// Rule-based date & title fallback when Gemini isn't configured or fails
function fallbackParseText(rawText = "") {
  const cleaned = String(rawText).replace(/\s+/g, " ").trim();
  const isoMatch = cleaned.match(/\b(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/);
  const dueDate = isoMatch
    ? `${isoMatch[1]}T${isoMatch[2] || "23:59"}`
    : null;

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
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

    if (!res.ok) {
      return fallbackParseText(rawText);
    }

    const data = await res.json();
    const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!jsonText) {
      return fallbackParseText(rawText);
    }

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

function matchCourse(courses, candidateCode, fallbackText = "") {
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
    name: "Academic Course",
    class_name: "",
    is_enrolled: true,
    is_from_six: false
  };
}

// Strips any forbidden/sensitive keys before storing or optional backend sync
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
    urgencyScore: record.urgencyScore,
    mergedCount: record.mergedCount,
    alsoIn: Array.isArray(record.alsoIn)
      ? record.alsoIn.map((a) => ({ className: String(a.className || ""), sourceUrl: String(a.sourceUrl || "") }))
      : [],
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

// Sort by active status, urgencyScore desc, then nearest dueDate asc
function sortItems(list) {
  list.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const urgDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
    if (urgDiff !== 0) return urgDiff;
    return Date.parse(a.dueDate || "2099-12-31") - Date.parse(b.dueDate || "2099-12-31");
  });
  return list;
}

function mergeCourses(existing, incoming) {
  const courseMap = new Map(existing.map((c) => [c.code.toUpperCase(), c]));
  for (const c of incoming || []) {
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
  return Array.from(courseMap.values());
}

async function ingestExtractedBatch(batch) {
  const { items, courses: existingCourses, settings } = await getState();
  let courses = [...existingCourses];

  // 1. Update course lookup table from /course/courses records
  if (Array.isArray(batch.courses) && batch.courses.length > 0) {
    courses = mergeCourses(courses, batch.courses);
    await chrome.storage.local.set({ [STORAGE_KEYS.COURSES]: courses });
  }

  // 2. Parse candidate alerts/modules/SIX items ephemerally & merge duplicates
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

    const course = matchCourse(courses, cand.courseCode || parsed.courseCode, snippetForParsing);
    const title = (cand.title || parsed.title || "Academic Update").trim().slice(0, 120);
    const dueDate = cand.dueDate || parsed.dueDate || null;
    const type = cand.type || "ASSIGNMENT";
    const pipeline = cand.pipeline || "Notification Bell";
    const sourcePlatform = cand.sourcePlatform || "Edunex";
    const postedDate = cand.postedDate || new Date().toISOString();
    const sourceUrl = cand.sourceUrl || "";
    const urgencyScore = computeUrgencyScore(type, dueDate);

    const dedupeKey = `${course.code}|${normalizeTitleKey(title)}`;
    const existingIdx = nextItems.findIndex((existing) => {
      const existingKey = `${existing.courseCode}|${normalizeTitleKey(existing.title)}`;
      return existingKey === dedupeKey && !existing.isCompleted;
    });

    if (existingIdx !== -1) {
      const existing = nextItems[existingIdx];
      const updated = sanitizeStrippedPayload({
        ...existing,
        title,
        dueDate: dueDate || existing.dueDate,
        sourceUrl: sourceUrl || existing.sourceUrl,
        urgencyScore: Math.max(existing.urgencyScore || 0, urgencyScore),
        mergedCount: (existing.mergedCount || 1) + 1
      });
      nextItems[existingIdx] = updated;
      touchedStripped.push(updated);
    } else {
      const created = sanitizeStrippedPayload({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        courseCode: course.code,
        courseName: course.name,
        className: course.class_name,
        type,
        pipeline,
        sourcePlatform,
        title,
        dueDate,
        postedDate,
        sourceUrl,
        urgencyScore,
        mergedCount: 1,
        isCompleted: false
      });
      nextItems.push(created);
      touchedStripped.push(created);
    }
  }

  sortItems(nextItems);

  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: nextItems });
  await maybePushStrippedToBackend(settings, touchedStripped);

  return {
    savedCount: rawCandidates.length,
    totalItems: nextItems.length,
    totalCourses: courses.length
  };
}

// ---------------------------------------------------------------------------
// Direct Edunex sync: Edunex's own API, called from inside an Edunex tab (see edunex-sync.js).
// The extension only ever receives the stripped items, never the login token.
// ---------------------------------------------------------------------------

// A synced item replaces itself on every sync (same id), so nothing is double-counted.
// Items that Edunex no longer returns (handed in, removed, more than a week overdue) drop out.
async function storeEdunexSync(result) {
  const { items, courses, settings } = await getState();
  const previous = new Map(items.filter((i) => i.pipeline === EDUNEX_SYNC_PIPELINE).map((i) => [i.id, i]));

  const synced = (result.items || []).map((it) => {
    const id = `edunex-${it.key}`;
    return sanitizeStrippedPayload({
      id,
      courseCode: it.courseCode,
      courseName: it.courseName,
      className: it.className,
      type: it.type,
      pipeline: EDUNEX_SYNC_PIPELINE,
      sourcePlatform: "Edunex",
      title: it.title,
      dueDate: it.dueDate,
      postedDate: it.postedDate,
      sourceUrl: it.sourceUrl,
      urgencyScore: computeUrgencyScore(it.type, it.dueDate),
      mergedCount: it.mergedCount || 1,
      alsoIn: it.alsoIn,
      isCompleted: Boolean(previous.get(id)?.isCompleted)
    });
  });

  // Drop older "Scan Open Tab" copies of the same Edunex items, so they don't show twice.
  const syncedKeys = new Set(synced.map((i) => `${i.courseCode}|${normalizeTitleKey(i.title)}`));
  const kept = items.filter((i) => {
    if (i.pipeline === EDUNEX_SYNC_PIPELINE) return false;
    if (i.sourcePlatform === "Edunex" && syncedKeys.has(`${i.courseCode}|${normalizeTitleKey(i.title)}`)) return false;
    return true;
  });

  const nextItems = sortItems([...kept, ...synced]);
  const nextCourses = mergeCourses(courses, result.courses);
  const syncInfo = { lastSyncAt: new Date().toISOString(), stats: result.stats || null };

  await chrome.storage.local.set({
    [STORAGE_KEYS.ITEMS]: nextItems,
    [STORAGE_KEYS.COURSES]: nextCourses,
    [STORAGE_KEYS.SYNC]: syncInfo
  });
  await maybePushStrippedToBackend(settings, synced);

  return { totalItems: nextItems.length, syncInfo };
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(ok);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === "complete") done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => { if (t.status === "complete") done(true); }).catch(() => done(false));
  });
}

async function askTabToSync(tabId) {
  // The content script loads at document_idle, so give a freshly opened tab a few tries.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: "EDUNEX_SYNC" });
      if (res) return res;
    } catch (_err) {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

// One sync at a time: a second request (popup click, another Edunex tab) waits for the first.
let syncInFlight = null;
function once(fn) {
  if (!syncInFlight) syncInFlight = fn().finally(() => { syncInFlight = null; });
  return syncInFlight;
}

async function syncEdunexNow() {
  return once(syncEdunexNowInner);
}

async function syncEdunexNowInner() {
  const open = await chrome.tabs.query({ url: `${EDUNEX_WEB}/*` });
  let tab = open.find((t) => t.status === "complete") || open[0];
  let openedByUs = false;

  if (!tab) {
    tab = await chrome.tabs.create({ url: `${EDUNEX_WEB}/`, active: false });
    openedByUs = true;
    await waitForTabComplete(tab.id);
  }

  const res = await askTabToSync(tab.id);

  if (!res || (!res.ok && res.reason === "signed_out")) {
    // Not signed in (or Edunex sent the tab to the sign-in page). Show the tab so the student
    // can sign in on the real ITB page; the extension never sees the password.
    await chrome.tabs.update(tab.id, { active: true });
    return { ok: false, reason: "signed_out" };
  }

  if (openedByUs) chrome.tabs.remove(tab.id).catch(() => {});
  if (!res.ok) return res;

  const stored = await storeEdunexSync(res);
  return { ok: true, stats: res.stats, ...stored };
}

async function syncFromTabIfStale(tabId) {
  const { settings } = await getState();
  if (!settings.edunexEnabled || !settings.autoSyncEdunex) return;
  const data = await chrome.storage.local.get(STORAGE_KEYS.SYNC);
  const last = Date.parse(data[STORAGE_KEYS.SYNC]?.lastSyncAt || "");
  if (!Number.isNaN(last) && Date.now() - last < AUTO_SYNC_MIN_GAP_MS) return;

  await once(async () => {
    const res = await askTabToSync(tabId);
    if (res && res.ok) await storeEdunexSync(res);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "SYNC_EDUNEX") {
      const result = await syncEdunexNow();
      sendResponse(result);
      return;
    }

    if (message?.type === "EDUNEX_TAB_READY") {
      sendResponse({ ok: true });
      if (sender.tab?.id) await syncFromTabIfStale(sender.tab.id);
      return;
    }

    if (message?.type === "GET_SYNC_INFO") {
      const data = await chrome.storage.local.get(STORAGE_KEYS.SYNC);
      sendResponse({ ok: true, ...(data[STORAGE_KEYS.SYNC] || {}) });
      return;
    }

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
      await chrome.storage.local.remove(STORAGE_KEYS.SYNC);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type" });
  })();

  return true;
});