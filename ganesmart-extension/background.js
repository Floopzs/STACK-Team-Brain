const STORAGE_KEYS = {
  ITEMS: "ganesmart_items_v1",
  COURSES: "ganesmart_courses_v1",
  SETTINGS: "ganesmart_settings_v1",
  SYNC: "ganesmart_sync_v1"
};

const EDUNEX_WEB = "https://edunex.itb.ac.id";
const EDUNEX_SYNC_PIPELINE = "Edunex Sync";
const SIX_WEB = "https://six.itb.ac.id";
const SIX_SYNC_PIPELINE = "SIX Sync";
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
// Direct sync: each platform is read from inside its own tab, with the login that tab already
// has (edunex-sync.js, six-sync.js). The extension only ever receives the stripped items,
// never a token, cookie or password.
// ---------------------------------------------------------------------------

const SOURCES = {
  edunex: {
    label: "Edunex",
    match: `${EDUNEX_WEB}/*`,
    openUrl: `${EDUNEX_WEB}/`,
    message: "EDUNEX_SYNC",
    pipeline: EDUNEX_SYNC_PIPELINE,
    platform: "Edunex",
    enabledKey: "edunexEnabled"
  },
  six: {
    label: "SIX",
    match: `${SIX_WEB}/*`,
    openUrl: `${SIX_WEB}/home`,
    message: "SIX_SYNC",
    pipeline: SIX_SYNC_PIPELINE,
    platform: "SIX",
    enabledKey: "sixEnabled"
  }
};

// ITB's public academic calendar (linked from SIX's home page). No login involved.
const ITB_CALENDAR_ICS = "https://goitb.id/KalenderPendidikan-ics";
const CALENDAR_DAYS_AHEAD = 45;

function parseIcsEvents(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      cur[name] = line.slice(i + 1).replace(/\\,/g, ",").replace(/\\n/gi, " ").trim();
    }
  }
  return events;
}

// Academic calendar events in the next few weeks, as SIX items. Best effort: a failure here
// never fails the SIX sync.
async function fetchItbCalendarItems() {
  try {
    const res = await fetch(ITB_CALENDAR_ICS, { credentials: "omit" });
    if (!res.ok) return [];
    const now = Date.now();
    const items = [];
    for (const ev of parseIcsEvents(await res.text())) {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(ev.DTSTART || "");
      if (!m || !ev.SUMMARY) continue;
      const isDeadline = /\b(batas|akhir|terakhir|deadline)\b/i.test(ev.SUMMARY);
      const due = `${m[1]}-${m[2]}-${m[3]}T${isDeadline ? "23:59" : "00:00"}:00+07:00`;
      const dueMs = Date.parse(due);
      if (dueMs < now - 86400000 || dueMs > now + CALENDAR_DAYS_AHEAD * 86400000) continue;
      items.push({
        key: `calendar-${ev.UID || `${m[0]}-${ev.SUMMARY}`}`,
        courseCode: "ITB",
        courseName: "ITB Academic Calendar",
        className: "",
        type: "SCHEDULE",
        title: ev.SUMMARY.slice(0, 120),
        dueDate: due,
        postedDate: null,
        sourceUrl: ITB_CALENDAR_ICS
      });
    }
    return items;
  } catch (_err) {
    return [];
  }
}

async function getSyncInfo() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SYNC);
  return data[STORAGE_KEYS.SYNC] || {};
}

// A synced item replaces itself on every sync (same id), so nothing is double-counted.
// Items the platform no longer returns (handed in, removed, long past) drop out.
async function storeSync(sourceId, result) {
  const source = SOURCES[sourceId];
  const { items, courses, settings } = await getState();
  const previous = new Map(items.filter((i) => i.pipeline === source.pipeline).map((i) => [i.id, i]));

  const synced = (result.items || []).map((it) => {
    const id = `${sourceId}-${it.key}`;
    return sanitizeStrippedPayload({
      id,
      courseCode: it.courseCode,
      courseName: it.courseName,
      className: it.className,
      type: it.type,
      pipeline: source.pipeline,
      sourcePlatform: source.platform,
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

  // Drop older "Scan Open Tab" copies of the same items, so they don't show twice.
  const syncedKeys = new Set(synced.map((i) => `${i.courseCode}|${normalizeTitleKey(i.title)}`));
  const kept = items.filter((i) => {
    if (i.pipeline === source.pipeline) return false;
    if (i.sourcePlatform === source.platform && syncedKeys.has(`${i.courseCode}|${normalizeTitleKey(i.title)}`)) return false;
    return true;
  });

  const nextItems = sortItems([...kept, ...synced]);
  const nextCourses = mergeCourses(courses, result.courses);
  const syncInfo = { ...(await getSyncInfo()), [sourceId]: { lastSyncAt: new Date().toISOString(), stats: result.stats || null } };

  await chrome.storage.local.set({
    [STORAGE_KEYS.ITEMS]: nextItems,
    [STORAGE_KEYS.COURSES]: nextCourses,
    [STORAGE_KEYS.SYNC]: syncInfo
  });
  await maybePushStrippedToBackend(settings, synced);

  return { totalItems: nextItems.length };
}

// Runs a platform's in-tab result through any extra steps, then stores it.
async function finishSync(sourceId, res) {
  if (sourceId === "six") {
    const calendar = await fetchItbCalendarItems();
    res = { ...res, items: [...(res.items || []), ...calendar], stats: { ...(res.stats || {}), calendar: calendar.length } };
  }
  const stored = await storeSync(sourceId, res);
  return { ok: true, stats: res.stats, ...stored };
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

async function askTabToSync(tabId, message) {
  // The content script loads at document_idle, so give a freshly opened tab a few tries.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: message });
      if (res) return res;
    } catch (_err) {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

// One sync per platform at a time: a second request (popup click, another tab) waits for the first.
const inFlight = {};
function once(sourceId, fn) {
  if (!inFlight[sourceId]) inFlight[sourceId] = fn().finally(() => { inFlight[sourceId] = null; });
  return inFlight[sourceId];
}

async function syncNow(sourceId) {
  const source = SOURCES[sourceId];
  return once(sourceId, async () => {
    const open = await chrome.tabs.query({ url: source.match });
    let tab = open.find((t) => t.status === "complete") || open[0];
    let openedByUs = false;

    if (!tab) {
      tab = await chrome.tabs.create({ url: source.openUrl, active: false });
      openedByUs = true;
      await waitForTabComplete(tab.id);
    }

    const res = await askTabToSync(tab.id, source.message);

    if (!res || (!res.ok && res.reason === "signed_out")) {
      // Not signed in (or the site sent the tab to its sign-in page). Show the tab so the
      // student can sign in on the real ITB page; the extension never sees the password.
      await chrome.tabs.update(tab.id, { active: true });
      return { ok: false, reason: "signed_out" };
    }

    if (openedByUs) chrome.tabs.remove(tab.id).catch(() => {});
    if (!res.ok) return res;
    return finishSync(sourceId, res);
  });
}

async function syncAll() {
  const { settings } = await getState();
  const results = {};
  for (const sourceId of Object.keys(SOURCES)) {
    if (settings[SOURCES[sourceId].enabledKey] === false) continue;
    results[sourceId] = await syncNow(sourceId);
  }
  return { ok: true, results };
}

async function syncFromTabIfStale(sourceId, tabId) {
  const source = SOURCES[sourceId];
  const { settings } = await getState();
  if (settings[source.enabledKey] === false || !settings.autoSyncEdunex) return;
  const last = Date.parse((await getSyncInfo())[sourceId]?.lastSyncAt || "");
  if (!Number.isNaN(last) && Date.now() - last < AUTO_SYNC_MIN_GAP_MS) return;

  await once(sourceId, async () => {
    const res = await askTabToSync(tabId, source.message);
    if (res && res.ok) await finishSync(sourceId, res);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "SYNC_ALL") {
      sendResponse(await syncAll());
      return;
    }

    if (message?.type === "SYNC_EDUNEX") {
      sendResponse(await syncNow("edunex"));
      return;
    }

    if (message?.type === "SYNC_SIX") {
      sendResponse(await syncNow("six"));
      return;
    }

    if (message?.type === "EDUNEX_TAB_READY" || message?.type === "SIX_TAB_READY") {
      sendResponse({ ok: true });
      const sourceId = message.type === "SIX_TAB_READY" ? "six" : "edunex";
      if (sender.tab?.id) await syncFromTabIfStale(sourceId, sender.tab.id);
      return;
    }

    if (message?.type === "GET_SYNC_INFO") {
      sendResponse({ ok: true, ...(await getSyncInfo()) });
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