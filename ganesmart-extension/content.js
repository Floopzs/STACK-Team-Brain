if (!window.__ganesmartLoaded) {
  window.__ganesmartLoaded = true;

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

  // Converts Edunex timestamps like "01/12/26 17:00" (DD/MM/YY HH:mm) to ISO "2026-12-01T17:00"
  function parseEdunexDate(rawDate) {
    if (!rawDate) return null;
    const m = String(rawDate)
      .trim()
      .match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2})$/);
    if (!m) return null;
    const day = m[1];
    const month = m[2];
    const year = `20${m[3]}`;
    const time = m[4];
    return `${year}-${month}-${day}T${time}`;
  }

  // Prefers /assignment/take/<id> or the "Open" action link over /courses/<id>/preview
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

  // Returns true only when the row is NOT already submitted/completed
  function isUnsubmittedRow(row, rowText) {
    const badgeEl = row.querySelector(".badge, [class*='badge']");
    const badgeText = (badgeEl ? badgeEl.innerText : "").trim();
    const combinedStatusText = `${badgeText} ${rowText}`;

    // Skip explicitly submitted / completed / graded assignments
    if (
      /\b(submitted|turned in|completed|done|graded|dikumpulkan|sudah dikumpulkan|selesai)\b/i.test(
        combinedStatusText
      )
    ) {
      return false;
    }

    return true;
  }

  function extractFromTableRows() {
    const candidates = [];
    const seen = new Set();

    // Match table rows or row-like elements containing DD/MM/YY HH:mm timestamps
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

      // Split tabs/newlines into clean non-empty segments, excluding status/action tokens
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

      // Usually parts order is [CourseName, Title] or [CourseCode, CourseName, Title]
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

  // Fallback text-line parser if items are rendered as text lines instead of <tr> elements
  function extractFromTextLines() {
    const candidates = [];
    const seen = new Set();
    const bodyText = document.body ? document.body.innerText || "" : "";
    const lines = bodyText
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const codeMatch = line.match(/^\d+\s+([A-Z]{2,4}\d{4})$/i);
      if (!codeMatch) continue;

      const courseCode = codeMatch[1].toUpperCase();
      const nextLine = lines[i + 1] || "";
      const statusLine = lines[i + 2] || "";

      if (
        /\b(submitted|turned in|completed|done|graded|dikumpulkan|sudah dikumpulkan|selesai)\b/i.test(
          `${nextLine} ${statusLine}`
        )
      ) {
        continue;
      }

      const cols = nextLine.split("\t").map((c) => c.trim()).filter(Boolean);

      // Expected: [Course Name, Title, Start DD/MM/YY HH:mm, End DD/MM/YY HH:mm]
      const title = cols[1] || nextLine.slice(0, 120);
      const postedDate = parseEdunexDate(cols[2]) || new Date().toISOString();
      const dueDate = parseEdunexDate(cols[3]) || null;

      const matchingRow = [...document.querySelectorAll("tr, [role='row']")].find((r) =>
        (r.innerText || "").includes(title)
      );
      const sourceUrl = matchingRow ? extractBestSourceUrl(matchingRow) : window.location.href;

      const key = `${courseCode}|${title}|${dueDate || ""}`;
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

  function scanEdunexPage() {
    const tableCandidates = extractFromTableRows();
    const candidates = tableCandidates.length > 0 ? tableCandidates : extractFromTextLines();
    return { courses: [], candidates };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCAN_OPEN_PAGE") {
      sendResponse({ ok: true, batch: scanEdunexPage() });
    }
  });
}