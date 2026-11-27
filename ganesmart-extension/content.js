if (!window.__ganesmartLoaded) {
  window.__ganesmartLoaded = true;

  const PENDING_SIX_MODAL_KEY = "ganesmart_pending_six_modal";

  function isSensitiveElement(el) {
    if (!el) return true;
    if (
      el.closest(
        "form, input[type='password'], [autocomplete*='password'], [data-private='true'], .chat-dm, .private-message"
      )
    ) {
      return true;
    }
    const label = (el.getAttribute("aria-label") || el.className || "").toLowerCase();
    if (/grade|nilai|transkrip|transcript|nim|password|sandi|message|pesan|dm/i.test(label)) {
      return true;
    }
    return false;
  }

  function sanitizeSixUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, window.location.origin);
      u.hash = "";
      u.pathname = u.pathname.replace(/\/mahasiswa:[^/]+/i, "/mahasiswa");
      return u.href;
    } catch (_e) {
      return "https://six.itb.ac.id/app/mahasiswa/kelas/jadwal/mahasiswa";
    }
  }

  const MONTH_MAP = {
    jan: 1, januari: 1, january: 1,
    feb: 2, februari: 2, february: 2,
    mar: 3, maret: 3, march: 3,
    apr: 4, april: 4,
    mei: 5, may: 5,
    jun: 6, juni: 6, june: 6,
    jul: 7, juli: 7, july: 7,
    agu: 8, agustus: 8, aug: 8, august: 8,
    sep: 9, september: 9,
    okt: 10, oktober: 10, oct: 10, october: 10,
    nov: 11, november: 11,
    des: 12, desember: 12, dec: 12, december: 12
  };

  const SHORT_MONTH_LABELS = [
    "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
  ];

  // --- 1. EDUNEX PARSER (Unsubmitted assignments + /assignment/take/<id> deep links) ---
  function parseEdunexDate(rawDate) {
    if (!rawDate) return null;
    const m = String(rawDate)
      .trim()
      .match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})$/);
    if (!m) return null;
    return `20${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
  }

  function extractBestSourceUrl(row) {
    if (!row) return window.location.href;

    const links = [...row.querySelectorAll("a[href]")].filter((a) => {
      const href = a.getAttribute("href") || "";
      return href && !href.startsWith("javascript:") && href !== "#";
    });

    const assignmentLink = links.find((a) => {
      const href = a.getAttribute("href") || "";
      const text = (a.innerText || "").trim();
      return /\/(assignment|task|quiz|exam)\//i.test(href) || /^open$/i.test(text);
    });
    if (assignmentLink) {
      return new URL(assignmentLink.getAttribute("href"), window.location.origin).href;
    }

    const nonCourseLink = links.find(
      (a) => !/\/courses\/\d+\/preview/i.test(a.getAttribute("href") || "")
    );
    if (nonCourseLink) {
      return new URL(nonCourseLink.getAttribute("href"), window.location.origin).href;
    }

    if (links.length > 0) {
      return new URL(links[0].getAttribute("href"), window.location.origin).href;
    }

    return window.location.href;
  }

  function isUnsubmittedRow(row, rowText) {
    const badgeEl = row.querySelector(".badge, [class*='badge']");
    const badgeText = (badgeEl ? badgeEl.innerText : "").trim();
    const combinedStatusText = `${badgeText} ${rowText}`;

    return !/\b(submitted|turned in|completed|done|graded|dikumpulkan|sudah dikumpulkan|selesai)\b/i.test(
      combinedStatusText
    );
  }

  function extractEdunexUnsubmitted() {
    const candidates = [];
    const seen = new Set();

    const rows = document.querySelectorAll("table tr, [role='row'], tr");
    for (const row of rows) {
      if (isSensitiveElement(row)) continue;
      const rowText = (row.innerText || "").trim();
      if (!rowText || /^NO\b/i.test(rowText)) continue;
      if (!isUnsubmittedRow(row, rowText)) continue;

      const dateMatches = [...rowText.matchAll(/\b(\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2})\b/g)].map(
        (x) => x[1]
      );
      if (dateMatches.length === 0) continue;

      const postedDate = parseEdunexDate(dateMatches[0]) || new Date().toISOString();
      const dueDate = dateMatches.length > 1 ? parseEdunexDate(dateMatches[1]) : null;

      const parts = rowText
        .split(/[\t\n]+/)
        .map((s) => s.trim())
        .filter(
          (s) =>
            s &&
            !/^\d+$/.test(s) &&
            !/^\d{2}\/\d{2}\/\d{2}\s+\d{2}:\d{2}$/.test(s) &&
            !/^(TASK|EXAM|QUIZ|PERSONAL|GROUP|Submitted|Unanswered|Unsubmitted|Open|View|Detail)$/i.test(
              s
            )
        );

      const codeMatch = rowText.match(/\b([A-Z]{2,4}\d{4})\b/);
      const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;

      const filteredParts = parts.filter((p) => p.toUpperCase() !== courseCode);
      const title =
        filteredParts.length >= 2
          ? filteredParts.slice(1).join(" - ")
          : filteredParts[0] || rowText.slice(0, 120);

      const sourceUrl = extractBestSourceUrl(row);
      const key = `${courseCode || ""}|${title}|${dueDate || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        sourcePlatform: "Edunex",
        pipeline: "Notification Bell",
        courseCode,
        type: /\b(exam|ujian|kuis|quiz|uts|uas)\b/i.test(title) ? "EXAM" : "ASSIGNMENT",
        title: title.slice(0, 120),
        postedDate,
        dueDate,
        sourceUrl
      });
    }

    return candidates;
  }

  // --- 2. SIX PARSER & MODAL OPENER ---
  function detectSixBaseYearMonth() {
    const activeTab = document.querySelector(
      ".nav-tabs .active, .active, [aria-selected='true'], button[class*='active']"
    );
    const tabMatch = (activeTab?.innerText || "").match(/\b([A-Za-z]+)\s+(20\d{2})\b/);
    if (tabMatch && MONTH_MAP[tabMatch[1].toLowerCase()]) {
      return { year: Number(tabMatch[2]), month: MONTH_MAP[tabMatch[1].toLowerCase()] };
    }

    const bodyMatch = (document.body?.innerText || "").match(
      /\b(Agu|Sep|Okt|Nov|Des|Jan|Feb|Mar|Apr|Mei|Jun|Jul)\s+(20\d{2})\b/i
    );
    if (bodyMatch && MONTH_MAP[bodyMatch[1].toLowerCase()]) {
      return { year: Number(bodyMatch[2]), month: MONTH_MAP[bodyMatch[1].toLowerCase()] };
    }

    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  function collectSixCalendarNodes() {
    const entries = [];
    let { year: currentYear, month: currentMonth } = detectSixBaseYearMonth();
    let lastDayNum = 0;

    const cells = document.querySelectorAll(".table-responsive td, table td");
    for (const td of cells) {
      if (isSensitiveElement(td) || td.querySelector("td")) continue;

      const lines = (td.innerText || "")
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) continue;

      const dayMatch = lines[0].match(/^(\d{1,2})(?:\s+([A-Za-z]+))?/);
      if (!dayMatch) continue;

      const dayNum = Number(dayMatch[1]);
      if (dayNum < 1 || dayNum > 31) continue;

      if (dayMatch[2] && MONTH_MAP[dayMatch[2].toLowerCase()]) {
        const explicitMonth = MONTH_MAP[dayMatch[2].toLowerCase()];
        if (explicitMonth < currentMonth && currentMonth === 12) currentYear += 1;
        currentMonth = explicitMonth;
      } else if (lastDayNum > 20 && dayNum < 10) {
        currentMonth += 1;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear += 1;
        }
      }
      lastDayNum = dayNum;

      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const meetingLinks = td.querySelectorAll("a.linkpertemuan");

      for (const link of meetingLinks) {
        const rawText = (link.innerText || "").trim().replace(/\s+/g, " ");
        entries.push({ dateStr, rawText, linkEl: link });
      }
    }

    return entries;
  }

  function extractSixCalendarClasses() {
    const candidates = [];
    const seen = new Set();
    const cleanScheduleUrl = sanitizeSixUrl(window.location.href);
    const nodes = collectSixCalendarNodes();

    for (const { dateStr, rawText } of nodes) {
      const m = rawText.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+(.+)$/);
      if (!m) continue;

      const startTime = m[1].padStart(5, "0");
      const endTime = m[2].padStart(5, "0");
      const rest = m[3].trim();
      const codeMatch = rest.match(/\b([A-Z]{2,4}\d{4})\b/);
      const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;
      const isExam = /\b(uts|uas|ujian|exam|kuis|quiz)\b/i.test(rest);
      const startIso = `${dateStr}T${startTime}`;

      const key = `${courseCode || ""}|${startIso}|${rest}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        sourcePlatform: "SIX",
        pipeline: "SIX Portal / ICS",
        courseCode,
        type: isExam ? "EXAM" : "SCHEDULE",
        title: `${rest} (${startTime}–${endTime})`.slice(0, 120),
        postedDate: new Date().toISOString(),
        dueDate: startIso,
        sourceUrl: cleanScheduleUrl,
        sixTarget: {
          dateStr,
          rawText
        }
      });
    }

    return candidates;
  }

  async function openSixClassModal(target) {
    if (!target?.dateStr || !target?.rawText) return false;

    const tryFindAndClick = () => {
      const nodes = collectSixCalendarNodes();
      const exact = nodes.find(
        (n) => n.dateStr === target.dateStr && n.rawText === target.rawText
      );
      const fallback = nodes.find(
        (n) =>
          n.dateStr === target.dateStr &&
          n.rawText.slice(0, 22) === target.rawText.slice(0, 22)
      );
      const chosen = exact || fallback;
      if (chosen?.linkEl) {
        chosen.linkEl.scrollIntoView({ behavior: "smooth", block: "center" });
        chosen.linkEl.click();
        return true;
      }
      return false;
    };

    if (tryFindAndClick()) return true;

    const [yrStr, moStr] = target.dateStr.split("-");
    const expectedTabLabel = `${SHORT_MONTH_LABELS[Number(moStr)]} ${yrStr}`;
    const tabLink = [...document.querySelectorAll("a, button, li")].find(
      (el) => (el.innerText || "").trim() === expectedTabLabel
    );
    if (tabLink) {
      tabLink.click();
    }

    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      if (tryFindAndClick()) return true;
    }

    return false;
  }

  // --- 3. MICROSOFT TEAMS ASSIGNMENTS PARSER ---
  function parseTeamsDateStr(headerText) {
    if (!headerText) return null;
    const clean = headerText.trim();
    const now = new Date();

    if (/^today\b/i.test(clean)) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;
    }

    if (/^tomorrow\b/i.test(clean)) {
      const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      return `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(
        tmrw.getDate()
      ).padStart(2, "0")}`;
    }

    const m = clean.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
    );
    if (!m) return null;

    const monthNum = MONTH_MAP[m[1].toLowerCase()];
    const dayNum = Number(m[2]);
    if (!monthNum || dayNum < 1 || dayNum > 31) return null;

    let year = now.getFullYear();
    if (now.getMonth() + 1 >= 11 && monthNum <= 2) {
      year += 1;
    }

    return `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  }

  function parseTeamsDueTime(dueLine = "") {
    const m12 = dueLine.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
    if (m12) {
      let hours = Number(m12[1]);
      const mins = m12[2];
      const meridiem = m12[3].toUpperCase();
      if (meridiem === "PM" && hours < 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;
      return `${String(hours).padStart(2, "0")}:${mins}`;
    }

    const m24 = dueLine.match(/\b(\d{1,2}):(\d{2})\b/);
    if (m24) {
      return `${String(Number(m24[1])).padStart(2, "0")}:${m24[2]}`;
    }

    return "23:59";
  }

  function extractTeamsAssignments() {
    const selectedTab = document.querySelector(
      '[role="tab"][aria-selected="true"], button[aria-selected="true"]'
    );
    if (selectedTab && /^completed$/i.test((selectedTab.innerText || "").trim())) {
      return [];
    }

    const cards = [
      ...document.querySelectorAll(".aui-assignmentListCard, [class*='assignmentListCard']")
    ];
    if (cards.length === 0) return [];

    const dateHeaders = [...document.querySelectorAll("div, span, h1, h2, h3, h4, p")]
      .filter((el) => {
        if (el.children.length > 1) return false;
        const txt = (el.innerText || "").trim();
        if (!txt || txt.length > 40) return false;
        return (
          /^(Today|Tomorrow)\b/i.test(txt) ||
          /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(
            txt
          )
        );
      })
      .map((el) => ({
        el,
        dateStr: parseTeamsDateStr((el.innerText || "").trim())
      }))
      .filter((h) => Boolean(h.dateStr));

    const candidates = [];
    const seen = new Set();
    const listUrl = window.location.hostname.includes("assignments.edu.cloud.microsoft")
      ? window.location.href
      : "https://assignments.edu.cloud.microsoft/classes/all/list";

    for (const card of cards) {
      if (isSensitiveElement(card)) continue;

      const lines = (card.innerText || "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (lines.length === 0) continue;

      const title = lines[0];
      const dueLine = lines.find((l) => /^due\b/i.test(l)) || lines[1] || "";
      const courseLine = lines.find((l) => l !== title && l !== dueLine) || lines[2] || "";

      let matchedDateStr = null;
      for (const h of dateHeaders) {
        const pos = h.el.compareDocumentPosition(card);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
          matchedDateStr = h.dateStr;
        }
      }

      if (!matchedDateStr) {
        matchedDateStr =
          parseTeamsDateStr(dueLine.replace(/^due\s+/i, "")) || parseTeamsDateStr("Today");
      }

      const timeStr = parseTeamsDueTime(dueLine);
      const dueDate = matchedDateStr ? `${matchedDateStr}T${timeStr}` : null;

      const codeMatch = courseLine.match(/\b([A-Z]{2,4}\d{4})\b/);
      const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;

      const sectionMatch = courseLine.match(/\b(K-?\d{1,2})\b/i);
      const className = sectionMatch ? sectionMatch[1].toUpperCase() : "";

      const cleanedCourseName = courseLine
        .replace(codeMatch ? codeMatch[0] : "", "")
        .replace(sectionMatch ? sectionMatch[0] : "", "")
        .trim();

      const key = `${courseCode || ""}|${title}|${dueDate || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        sourcePlatform: "Teams",
        pipeline: "Teams Assignments",
        courseCode,
        courseName: cleanedCourseName || undefined,
        className,
        type: /\b(exam|ujian|kuis|quiz|uts|uas)\b/i.test(title) ? "EXAM" : "ASSIGNMENT",
        title: title.slice(0, 120),
        postedDate: new Date().toISOString(),
        dueDate,
        sourceUrl: listUrl,
        teamsTarget: {
          cardId: card.id || null,
          title,
          courseCode,
          courseLine
        }
      });
    }

    return candidates;
  }

  // --- 4. GOOGLE CLASSROOM TO-DO PARSER (Assigned & Missing unsubmitted work) ---
  function parseClassroomDateLine(rawLine = "") {
    const clean = String(rawLine).replace(/\s+/g, " ").trim();
    if (!clean || /^no due date$/i.test(clean) || /^tidak ada batas waktu$/i.test(clean)) {
      return null;
    }

    const now = new Date();
    const timeStr = parseTeamsDueTime(clean.replace(/(\d{1,2})\.(\d{2})/, "$1:$2"));

    if (/\b(today|hari ini)\b/i.test(clean)) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}T${timeStr}`;
    }

    if (/\b(tomorrow|besok)\b/i.test(clean)) {
      const tmrw = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      return `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, "0")}-${String(
        tmrw.getDate()
      ).padStart(2, "0")}T${timeStr}`;
    }

    if (/\b(yesterday|kemarin)\b/i.test(clean)) {
      const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(
        yest.getDate()
      ).padStart(2, "0")}T${timeStr}`;
    }

    const mdy = clean.match(
      /\b(Jan|Feb|Mar|Apr|May|Mei|Jun|Jul|Aug|Agu|Sep|Oct|Okt|Nov|Dec|Des)[a-z]*\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i
    );
    if (mdy) {
      const monthNum = MONTH_MAP[mdy[1].toLowerCase()];
      const dayNum = Number(mdy[2]);
      const yearNum = mdy[3] ? Number(mdy[3]) : now.getFullYear();
      if (monthNum && dayNum >= 1 && dayNum <= 31) {
        return `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(
          2,
          "0"
        )}T${timeStr}`;
      }
    }

    const dmy = clean.match(
      /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Mei|Jun|Jul|Aug|Agu|Sep|Oct|Okt|Nov|Dec|Des)[a-z]*(?:,?\s+(20\d{2}))?\b/i
    );
    if (dmy) {
      const dayNum = Number(dmy[1]);
      const monthNum = MONTH_MAP[dmy[2].toLowerCase()];
      const yearNum = dmy[3] ? Number(dmy[3]) : now.getFullYear();
      if (monthNum && dayNum >= 1 && dayNum <= 31) {
        return `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(
          2,
          "0"
        )}T${timeStr}`;
      }
    }

    return null;
  }

  function extractCleanTextWithoutIcons(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll('[aria-hidden="true"], .google-symbols, .material-icons, i')
      .forEach((icon) => icon.remove());
    return (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  function buildClassroomTargetInfo(rawHref) {
    const parsed = new URL(rawHref, window.location.origin);
    const pageUserMatch = window.location.pathname.match(/^(\/u\/\d+)(?:\/|$)/);
    const hrefUserMatch = parsed.pathname.match(/^(\/u\/\d+)(\/c\/.+)$/);

    const userPrefix = hrefUserMatch ? hrefUserMatch[1] : pageUserMatch ? pageUserMatch[1] : "";
    let relativePath = hrefUserMatch ? hrefUserMatch[2] : parsed.pathname;

    if (/^\/c\/[^/]+\/(?:s?a)\/[^/]+$/i.test(relativePath)) {
      relativePath = `${relativePath}/details`;
    }

    const finalUrl = new URL(`${userPrefix}${relativePath}`, window.location.origin);
    const authUserParam = new URLSearchParams(window.location.search).get("authuser");
    if (authUserParam && /^\d+$/.test(authUserParam)) {
      finalUrl.searchParams.set("authuser", authUserParam);
    }

    return {
      sourceUrl: finalUrl.href,
      relativePath,
      userPrefix
    };
  }

  async function extractGoogleClassroomTasks() {
    const path = window.location.pathname.toLowerCase();
    const activeTab = document.querySelector(
      '[role="tab"][aria-selected="true"], a[aria-current="page"]'
    );
    const tabLabel = (activeTab?.innerText || "").trim();

    if (path.includes("/turned-in") || /^done$/i.test(tabLabel)) {
      return [];
    }

    const collapsedSections = [...document.querySelectorAll('[aria-expanded="false"]')].filter(
      (el) => {
        if (el.hasAttribute("aria-haspopup") || el.closest("header, nav")) return false;
        const txt = (el.innerText || "").trim();
        return txt.length > 0 && txt.length < 60;
      }
    );

    if (collapsedSections.length > 0) {
      collapsedSections.forEach((el) => el.click());
      await new Promise((r) => setTimeout(r, 650));
    }

    const anchors = [
      ...document.querySelectorAll('a[href*="/c/"][href*="/a/"], a[href*="/c/"][href*="/sa/"]')
    ].filter((a) => /\/c\/[^/]+\/(?:s?a)\/[^/]+/i.test(a.getAttribute("href") || ""));

    const seen = new Set();
    const candidates = [];

    for (const a of anchors) {
      if (isSensitiveElement(a)) continue;

      const rawHref = a.getAttribute("href");
      if (!rawHref) continue;

      const { sourceUrl, relativePath, userPrefix } = buildClassroomTargetInfo(rawHref);
      if (seen.has(relativePath)) continue;
      seen.add(relativePath);

      const row =
        a.closest('li[data-role="task-row"], [role="listitem"], li') ||
        a.parentElement?.parentElement ||
        a;

      const pNodes = [...row.querySelectorAll("p")];
      const cleanParagraphs = pNodes
        .map((p) => extractCleanTextWithoutIcons(p))
        .filter(Boolean);

      const title = cleanParagraphs[0] || extractCleanTextWithoutIcons(a) || "Classroom Assignment";
      const nonPostedParagraphs = cleanParagraphs
        .slice(1)
        .filter((txt) => !/^(posted|diposting)\b/i.test(txt));

      const courseName = nonPostedParagraphs[0] || "Google Classroom";
      const postedLine =
        cleanParagraphs.find((txt) => /^(posted|diposting)\b/i.test(txt)) || "";
      const postedDate = parseClassroomDateLine(postedLine) || new Date().toISOString();

      const rowClone = row.cloneNode(true);
      rowClone
        .querySelectorAll('[aria-hidden="true"], .google-symbols, .material-icons, i')
        .forEach((icon) => icon.remove());

      const allLines = (rowClone.innerText || rowClone.textContent || "")
        .split(/\n+/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter(Boolean);

      const dueCandidateLine =
        allLines.find(
          (l) =>
            !cleanParagraphs.includes(l) &&
            !/^(posted|diposting|assigned|missing|ditugaskan|tidak ada)\b/i.test(l)
        ) || "";

      const dueDate = parseClassroomDateLine(dueCandidateLine);

      const codeMatch = `${courseName} ${title}`.match(/\b([A-Z]{2,4}\d{4})\b/);
      const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;

      candidates.push({
        sourcePlatform: "Google Classroom",
        pipeline: path.includes("/missing") ? "Classroom Missing" : "Classroom Assigned",
        courseCode,
        courseName,
        type: /\b(exam|ujian|kuis|quiz|uts|uas)\b/i.test(title) ? "EXAM" : "ASSIGNMENT",
        title: title.slice(0, 120),
        postedDate,
        dueDate,
        sourceUrl,
        classroomTarget: {
          relativePath,
          userPrefix,
          title
        }
      });
    }

    return candidates;
  }

  // --- 5. OUTLOOK IMPORTANT MAIL PARSER (Strict Importance Scoring + Noise Suppression) ---
  function parseOutlookRowDate(text = "") {
    const now = new Date();

    const fullDmy = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (fullDmy) {
      const dd = fullDmy[1].padStart(2, "0");
      const mm = fullDmy[2].padStart(2, "0");
      return `${fullDmy[3]}-${mm}-${dd}T09:00`;
    }

    const shortDm = text.match(
      /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Sen|Sel|Rab|Kam|Jum|Sab|Min)?\s*(\d{1,2})\/(\d{1,2})\b/i
    );
    if (shortDm) {
      const dd = shortDm[1].padStart(2, "0");
      const mm = shortDm[2].padStart(2, "0");
      return `${now.getFullYear()}-${mm}-${dd}T09:00`;
    }

    const timeOnly = text.match(/\b(\d{1,2}:\d{2})\b/);
    if (timeOnly) {
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}T${timeOnly[1].padStart(5, "0")}`;
    }

    return now.toISOString();
  }

  function extractOutlookFolderSegment() {
    const m = window.location.pathname.match(/^\/mail\/(?:u\/\d+\/)?([^/]+)/i);
    const folder = m ? m[1].toLowerCase() : "inbox";
    return folder === "id" ? "inbox" : folder;
  }

  function scoreOutlookImportance({
    sender,
    subject,
    metaAndPreview,
    ariaLabel,
    isImportantFolder
  }) {
    const combined = `${sender} ${subject} ${metaAndPreview} ${ariaLabel}`;
    let score = 0;
    const reasons = [];

    // 1. Explicit Outlook Flag / Pin / High Importance / Important Folder
    const hasNativeMarker =
      /\b(flagged|pinned|high importance|ditandai|disematkan|prioritas tinggi)\b/i.test(ariaLabel);
    if (hasNativeMarker || isImportantFolder) {
      score += 100;
      reasons.push(isImportantFolder ? "Important Folder" : "Flagged/Pinned");
    }

    // 2. Noise & Bulk Blast Penalties (unless explicitly Flagged/Pinned)
    const isBulkNoReply = /\b(no[\s-]?reply|noreply|do[\s-]?not[\s-]?reply|suara itb|newsletter|digest|promotions)\b/i.test(
      sender
    );
    const isNoiseTopic = /\b(resi pembayaran|invoice|receipt|kuesioner|survey|mengisi surv|ditemukan dompet|lost and found|beasiswa|founding cohort|promo|diskon|unsubscribe)\b/i.test(
      `${subject} ${metaAndPreview}`
    );

    if (!hasNativeMarker && !isImportantFolder) {
      if (isBulkNoReply) score -= 65;
      if (isNoiseTopic) score -= 55;
    }

    // 3. Enrolled / ITB Course Code Match (e.g., FI1101, MA1101, WI1102)
    const codeMatch = combined.match(/\b([A-Z]{2,4}\d{4})\b/);
    const courseCode = codeMatch ? codeMatch[1].toUpperCase() : null;
    if (courseCode) {
      score += 60;
      reasons.push(`Course ${courseCode}`);
    }

    // 4. High-Priority Academic Assessment, Deadline, or Class Enrollment Action
    const highPriorityAcademic = /\b(midterm|final exam|uts|uas|ujian|kuis|quiz|tugas|assignment|homework|deadline|due date|submission|praktikum|modul|score announcement|nilai|added you to|kuliah pengganti|reschedule|dibatalkan|canceled)\b/i.test(
      `${subject} ${metaAndPreview}`
    );
    if (highPriorityAcademic) {
      score += 45;
      reasons.push("Academic Action/Exam");
    }

    // 5. Personal / Lecturer Sender (academic degrees or non-noreply individual)
    const hasAcademicDegree = /\b(S\.T\.|M\.T\.|M\.Sc\.|M\.Eng\.|Ph\.?D\.?|Dr\.|Prof\.|Ir\.)\b/i.test(
      sender
    );
    if (hasAcademicDegree) {
      score += 35;
      reasons.push("Lecturer/Staff");
    } else if (!isBulkNoReply && sender.split(/\s+/).length >= 2) {
      score += 15;
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      courseCode,
      reasons
    };
  }

  function extractOutlookImportantMails() {
    const activeFolderEl = document.querySelector(
      '[role="treeitem"][aria-selected="true"], [aria-current="page"]'
    );
    const activeFolderLabel = (activeFolderEl?.innerText || "").split(/\n+/)[0].trim();
    const folderSegment = extractOutlookFolderSegment();
    const isImportantFolder = /\b(important|penting|flagged|ditandai)\b/i.test(
      `${activeFolderLabel} ${folderSegment}`
    );

    const rows = [
      ...document.querySelectorAll(
        '[role="listbox"] [role="option"], [data-convid][role="option"]'
      )
    ].filter(
      (el) => el.hasAttribute("data-convid") || (el.getAttribute("aria-label") || "").length > 25
    );

    const scoredCandidates = [];
    const seen = new Set();

    for (const row of rows) {
      // Never read inside the email reading pane
      if (row.closest('[role="main"] [role="region"], .ReadingPaneContainer')) continue;

      const convId = row.getAttribute("data-convid") || "";
      const ariaLabel = (row.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();

      // Strip avatar initials and action buttons so line 0 is the true sender name
      const clone = row.cloneNode(true);
      clone
        .querySelectorAll(
          '[id^="avatar-"], .fui-Avatar, [class*="Avatar"], button, [role="checkbox"], [aria-hidden="true"]'
        )
        .forEach((el) => el.remove());

      const lines = (clone.innerText || clone.textContent || "")
        .split(/\n+/)
        .map((s) => s.replace(/\s+/g, " ").trim())
        .filter((s) => s && !/^[A-Z]{1,2}$/.test(s));

      const sender = lines[0] || "Outlook Sender";
      const subject = lines[1] || ariaLabel.slice(0, 100) || "(No Subject)";
      const metaAndPreview = lines.slice(2).join(" ");

      const dedupeKey = convId || `${sender}|${subject}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const { score, courseCode, reasons } = scoreOutlookImportance({
        sender,
        subject,
        metaAndPreview,
        ariaLabel,
        isImportantFolder
      });

      // Strict threshold: only keep truly important emails (score >= 50)
      if (score < 50) continue;

      const postedDate = parseOutlookRowDate(`${metaAndPreview} ${ariaLabel}`);
      const sourceUrl = convId
        ? `${window.location.origin}/mail/${folderSegment}/id/${encodeURIComponent(convId)}`
        : window.location.href;

      const isExam = /\b(exam|ujian|kuis|quiz|uts|uas|midterm)\b/i.test(
        `${subject} ${metaAndPreview}`
      );

      scoredCandidates.push({
        sourcePlatform: "Outlook",
        pipeline: "Outlook Important Mail",
        courseCode,
        courseName: sender,
        type: isExam ? "EXAM" : "IMPORTANT_MAIL",
        title: `${subject} — ${sender}`.slice(0, 120),
        rawSnippet: `${subject} ${metaAndPreview}`.slice(0, 400),
        postedDate,
        dueDate: null,
        urgencyScore: score,
        importanceReasons: reasons,
        sourceUrl,
        outlookTarget: {
          convId,
          subject,
          sender,
          folderSegment
        }
      });
    }

    // Sort most important first, then newest received date
    scoredCandidates.sort((a, b) => {
      if ((b.urgencyScore || 0) !== (a.urgencyScore || 0)) {
        return (b.urgencyScore || 0) - (a.urgencyScore || 0);
      }
      return Date.parse(b.postedDate || 0) - Date.parse(a.postedDate || 0);
    });

    return scoredCandidates;
  }

  async function checkPendingSixModalOnLoad() {
    if (!window.location.hostname.toLowerCase().includes("six")) return;
    try {
      const data = await chrome.storage.local.get(PENDING_SIX_MODAL_KEY);
      const pending = data?.[PENDING_SIX_MODAL_KEY];
      if (!pending) return;
      await chrome.storage.local.remove(PENDING_SIX_MODAL_KEY);
      if (Date.now() - (pending.createdAt || 0) <= 30000) {
        await openSixClassModal(pending);
      }
    } catch (_e) {}
  }

  async function scanOpenPage() {
    const host = window.location.hostname.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    if (host.includes("six")) {
      return { shouldRespond: true, batch: { courses: [], candidates: extractSixCalendarClasses() } };
    }

    if (host === "classroom.google.com") {
      if (window !== window.top) {
        return { shouldRespond: false, batch: { courses: [], candidates: [] } };
      }
      const classroomCandidates = await extractGoogleClassroomTasks();
      return {
        shouldRespond: true,
        batch: { courses: [], candidates: classroomCandidates }
      };
    }

    if (host.includes("outlook.") || path.startsWith("/mail")) {
      if (window !== window.top) {
        return { shouldRespond: false, batch: { courses: [], candidates: [] } };
      }
      return {
        shouldRespond: true,
        batch: { courses: [], candidates: extractOutlookImportantMails() }
      };
    }

    if (
      host.includes("assignments.edu.cloud.microsoft") ||
      host.includes("cloud.microsoft") ||
      host.includes("microsoft.com") ||
      host.includes("office.com")
    ) {
      const teamsCandidates = extractTeamsAssignments();
      return {
        shouldRespond: teamsCandidates.length > 0,
        batch: { courses: [], candidates: teamsCandidates }
      };
    }

    return { shouldRespond: true, batch: { courses: [], candidates: extractEdunexUnsubmitted() } };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_OPEN_PAGE") {
      scanOpenPage().then((result) => {
        if (result.shouldRespond) {
          sendResponse({ ok: true, batch: result.batch });
        }
      });
      return true;
    }

    if (message?.type === "OPEN_SIX_MODAL") {
      openSixClassModal(message.target).then((opened) => {
        if (opened) sendResponse({ ok: true });
      });
      return true;
    }
  });

  checkPendingSixModalOnLoad();
}