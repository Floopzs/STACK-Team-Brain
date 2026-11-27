const STORAGE_KEYS = {
  ITEMS: "ganesmart_items_v1",
  COURSES: "ganesmart_courses_v1",
  SETTINGS: "ganesmart_settings_v1"
};

const DEFAULT_SETTINGS = {
  edunexEnabled: true,
  sixEnabled: true,
  teamsEnabled: true,
  classroomEnabled: true,
  outlookEnabled: true,
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

function computeUrgencyScore(type, dueDateIso, presetScore = 0) {
  let base =
    type === "EXAM"
      ? 35
      : type === "ASSIGNMENT"
      ? 25
      : type === "SCHEDULE"
      ? 20
      : type === "IMPORTANT_MAIL"
      ? 25
      : 10;

  if (!dueDateIso) {
    return Math.max(base, Number(presetScore) || 0);
  }

  const dueMs = Date.parse(dueDateIso);
  if (Number.isNaN(dueMs)) {
    return Math.max(base, Number(presetScore) || 0);
  }

  const hoursLeft = (dueMs - Date.now()) / (1000 * 60 * 60);
  let computed = base + 15;
  if (hoursLeft <= 24) computed = Math.min(100, base + 65);
  else if (hoursLeft <= 72) computed = Math.min(100, base + 50);
  else if (hoursLeft <= 168) computed = Math.min(100, base + 30);

  return Math.max(computed, Number(presetScore) || 0);
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

// Sends ONLY the single announcement/subject snippet to Gemini and discards rawText immediately after
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
    classroomTarget: record.classroomTarget || null,
    outlookTarget: record.outlookTarget || null,
    urgencyScore: record.urgencyScore,
    importanceReasons: Array.isArray(record.importanceReasons) ? record.importanceReasons : [],
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

// --- TEAMS MAIN-WORLD OPENER ---
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

// --- OUTLOOK MAIN-WORLD OPENER ---
function clickOutlookRowInMainWorld(target) {
  const rows = [
    ...document.querySelectorAll('[role="listbox"] [role="option"], [data-convid][role="option"]')
  ];
  if (rows.length === 0) return { clicked: false };

  let chosen = target?.convId
    ? rows.find((r) => r.getAttribute("data-convid") === target.convId)
    : null;

  if (!chosen && target?.subject) {
    const normSubj = target.subject.trim().toLowerCase();
    chosen = rows.find((r) => {
      const label = (r.getAttribute("aria-label") || r.innerText || "").toLowerCase();
      return label.includes(normSubj);
    });
  }

  if (!chosen) return { clicked: false };

  chosen.scrollIntoView({ behavior: "smooth", block: "center" });

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
    return { clicked: true };
  }

  chosen.click();
  return { clicked: true };
}

async function openOutlookMailFlow(item) {
  const target = item.outlookTarget || {};
  const fallbackUrl =
    item.sourceUrl ||
    (target.convId
      ? `https://outlook.cloud.microsoft/mail/inbox/id/${encodeURIComponent(target.convId)}`
      : "https://outlook.cloud.microsoft/mail/");

  const outlookTabs = await chrome.tabs.query({
    url: [
      "*://outlook.cloud.microsoft/*",
      "*://outlook.office.com/*",
      "*://outlook.live.com/*"
    ]
  });

  if (outlookTabs.length > 0 && outlookTabs[0].id) {
    const tab = outlookTabs[0];
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: clickOutlookRowInMainWorld,
        args: [target]
      });
      const clicked = Boolean(results?.[0]?.result?.clicked);
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      if (clicked) {
        return { ok: true, mode: "existing_tab_clicked" };
      }
      await chrome.tabs.update(tab.id, { url: fallbackUrl });
      return { ok: true, mode: "existing_tab_navigated" };
    } catch (_e) {}
  }

  const created = await chrome.tabs.create({ url: fallbackUrl, active: true });
  if (created?.windowId) {
    await chrome.windows.update(created.windowId, { focused: true });
  }
  return { ok: true, mode: "new_tab" };
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
    const dueDate = cand.dueDate !== undefined ? cand.dueDate : parsed.dueDate || null;
    const type = cand.type || "ASSIGNMENT";
    const pipeline = cand.pipeline || "Notification Bell";
    const sourcePlatform = cand.sourcePlatform || "Edunex";
    const postedDate = cand.postedDate || new Date().toISOString();
    const sourceUrl = cand.sourceUrl || "";
    const urgencyScore = computeUrgencyScore(type, dueDate, cand.urgencyScore || 0);

    const outlookConvId = cand.outlookTarget?.convId || "";
    const courseKey =
      course.code === "GEN" && course.name ? `${course.code}:${course.name.toLowerCase()}` : course.code;

    const dedupeKey = outlookConvId
      ? `Outlook|${outlookConvId}`
      : type === "SCHEDULE"
      ? `${courseKey}|${dueDate || ""}|${normalizeTitleKey(title)}`
      : `${courseKey}|${normalizeTitleKey(title)}`;

    const existingIdx = nextItems.findIndex((existing) => {
      if (existing.outlookTarget?.convId && outlookConvId) {
        return existing.outlookTarget.convId === outlookConvId && !existing.isCompleted;
      }
      const existingCourseKey =
        existing.courseCode === "GEN" && existing.courseName
          ? `${existing.courseCode}:${existing.courseName.toLowerCase()}`
          : existing.courseCode;
      const existingKey =
        existing.type === "SCHEDULE"
          ? `${existingCourseKey}|${existing.dueDate || ""}|${normalizeTitleKey(existing.title)}`
          : `${existingCourseKey}|${normalizeTitleKey(existing.title)}`;
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
        courseName: cand.courseName || existing.courseName,
        title,
        dueDate: dueDate || existing.dueDate,
        postedDate: cand.postedDate || existing.postedDate,
        sourceUrl: preservedUrl,
        sixTarget: cand.sixTarget || existing.sixTarget || null,
        teamsTarget: cand.teamsTarget || existing.teamsTarget || null,
        classroomTarget: cand.classroomTarget || existing.classroomTarget || null,
        outlookTarget: cand.outlookTarget || existing.outlookTarget || null,
        urgencyScore: Math.max(existing.urgencyScore || 0, urgencyScore),
        importanceReasons: cand.importanceReasons || existing.importanceReasons || [],
        mergedCount: existing.type === "SCHEDULE" ? 1 : (existing.mergedCount || 1) + 1
      });
      nextItems[existingIdx] = updated;
      touchedStripped.push(updated);
    } else {
      const created = sanitizeStrippedPayload({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        courseCode: course.code,
        courseName: cand.courseName || course.name,
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
        classroomTarget: cand.classroomTarget || null,
        outlookTarget: cand.outlookTarget || null,
        urgencyScore,
        importanceReasons: cand.importanceReasons || [],
        mergedCount: 1,
        isCompleted: false
      });
      nextItems.push(created);
      touchedStripped.push(created);
    }
  }

  // Sort active items first; dated deadlines sort chronologically, while undated items (e.g., important mails) sort by importance score descending
  nextItems.sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    if (a.dueDate && b.dueDate) {
      const diff = Date.parse(a.dueDate) - Date.parse(b.dueDate);
      if (diff !== 0) return diff;
    }
    if (!a.dueDate && !b.dueDate) {
      const scoreDiff = (b.urgencyScore || 0) - (a.urgencyScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Date.parse(b.postedDate || 0) - Date.parse(a.postedDate || 0);
    }
    return a.dueDate ? -1 : 1;
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

    if (message?.type === "OPEN_OUTLOOK_MAIL") {
      const result = await openOutlookMailFlow(message.item || {});
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