// Ganesmart: direct SIX sync (no screen reading).
//
// SIX has no API: every page is plain HTML. This script runs inside a six.itb.ac.id tab and asks
// SIX for the student's own timetable pages in the background (this month and next), the same
// pages the student would open by hand, using the login SIX already has in this browser. It never
// sees or keeps the password or the session cookie.
//
// What it returns to the extension: exams and other non-lecture meetings (UTS, UAS, quizzes...)
// with course, date/time, room and a link back to the SIX timetable. Nothing else is read.
(() => {
  if (window.__ganesmartSixSync) return;
  window.__ganesmartSixSync = true;

  const WEB = "https://six.itb.ac.id";
  const PAGE_GAP_MS = 1500; // SIX is rate limited: one page at a time, with a pause
  const EXAM_RE = /\b(uts|uas|kuis|quiz|ujian|exam|midterm|final)\b/i;

  class SignedOutError extends Error {}

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  let lastFetchAt = 0;
  async function page(path) {
    const wait = lastFetchAt + PAGE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastFetchAt = Date.now();
    const res = await fetch(new URL(path, WEB), { credentials: "include", headers: { Accept: "text/html" } });
    const finalPath = new URL(res.url).pathname;
    if (finalPath.startsWith("/login") || finalPath.startsWith("/logout")) throw new SignedOutError("SIX login needed");
    if (!res.ok) throw new Error(`${path.split("?")[0]} answered ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  function hrefs(doc) {
    return [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "");
  }

  // The NIM, from SIX's home page links ("/home?context=mahasiswa:18223901").
  function readNim(doc) {
    for (const href of hrefs(doc)) {
      const m = /(?:\/app\/|[?&]context=)mahasiswa:(\d+)/.exec(href);
      if (m) return m[1];
    }
    return null;
  }

  // SIX's own id for the student, from the timetable link on the status page.
  function readTimetablePath(doc, nim) {
    for (const href of hrefs(doc)) {
      const m = /^(\/app\/mahasiswa:[^/]+\/kelas\/jadwal\/mahasiswa\/\d+)/.exec(href);
      if (m && m[1].includes(nim)) return m[1];
    }
    return null;
  }

  function wibMonth(ms) {
    const d = new Date(ms + 7 * 3600 * 1000);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function nextMonth(month) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(4));
    return m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, "0")}`;
  }

  // The month tabs on the timetable page: { "202611": "/app/mahasiswa:...?bulan=202611", ... }
  function monthTabs(doc) {
    const out = {};
    for (const a of doc.querySelectorAll("ul.nav-tabs a[href*='bulan=']")) {
      const href = a.getAttribute("href");
      const m = /[?&]bulan=(\d{6})/.exec(href);
      if (m) out[m[1]] = href;
    }
    return out;
  }

  const pad = (n) => String(n).padStart(2, "0");

  // Reads one month grid. The grid starts on the Monday of the month's first week, which can be
  // in the month before, so the date is tracked cell by cell.
  function readMonth(doc, month, pageUrl) {
    const grid = [...doc.querySelectorAll("table")].find(
      (t) => t.querySelector("td") && t.querySelectorAll("thead th").length >= 5
    );
    if (!grid) throw new Error("SIX timetable grid not found");

    let year = Number(month.slice(0, 4));
    let index = Number(month.slice(4)) - 1; // 0-based month
    let prevDay = 0;
    const meetings = [];

    for (const td of grid.querySelectorAll("tr > td")) {
      const firstDiv = td.querySelector(":scope > div");
      const day = Number((/^(\d{1,2})\b/.exec(clean(firstDiv && firstDiv.textContent)) || [])[1]);
      if (!(day >= 1 && day <= 31)) continue;
      if (prevDay === 0 && day > 7) index -= 1;
      else if (day < prevDay) index += 1;
      prevDay = day;
      const date = new Date(Date.UTC(year, index, day));
      year = date.getUTCFullYear();
      index = date.getUTCMonth();
      const ymd = `${year}-${pad(index + 1)}-${pad(day)}`;

      for (const link of td.querySelectorAll("a[data-url*='/pertemuan/']")) {
        const id = (/\/pertemuan\/(\d+)\//.exec(link.getAttribute("data-url") || "") || [])[1];
        const course = /^([A-Z]{2}\d{4})\s+(\S.*)$/.exec(clean(link.getAttribute("data-kuliah")));
        const holder = link.closest("[title]");
        const activity = (/\(([^()]+)\)$/.exec(clean(holder && holder.getAttribute("title"))) || [])[1];
        const text = clean(link.textContent);
        const time = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(text);
        if (!id || !course || !activity || !time) continue;

        // The room follows the activity at the end of the line: "(UTS TVST C)".
        const roomMatch = new RegExp(`\\(${activity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([^()]*)\\)\\s*$`).exec(text);
        const room = roomMatch ? clean(roomMatch[1]) : "";

        meetings.push({
          id,
          courseCode: course[1],
          courseName: course[2],
          activity: activity.trim(),
          room,
          start: `${ymd}T${pad(time[1])}:${time[2]}:00+07:00`,
          end: `${ymd}T${pad(time[3])}:${time[4]}:00+07:00`,
          pageUrl
        });
      }
    }
    return meetings;
  }

  async function syncSix() {
    try {
      const home = await page("/home");
      const nim = readNim(home);
      if (!nim) return { ok: false, reason: "signed_out" };

      const status = await page(`/app/mahasiswa:${nim}/statusmhs`);
      const timetablePath = readTimetablePath(status, nim);
      if (!timetablePath) return { ok: false, reason: "failed", detail: "SIX timetable link not found" };

      const first = await page(timetablePath);
      const tabs = monthTabs(first);
      const thisMonth = wibMonth(Date.now());
      const wanted = [thisMonth, nextMonth(thisMonth)];

      const meetings = [];
      for (const month of wanted) {
        const href = tabs[month];
        if (!href && month !== thisMonth) continue; // SIX doesn't offer that month for this term
        const doc = href ? await page(href) : first;
        meetings.push(...readMonth(doc, month, new URL(href || timetablePath, WEB).href));
      }

      // Lectures repeat every week and are not deadlines. Keep exams and other special meetings.
      const now = Date.now();
      const items = [];
      const seen = new Set();
      const courses = new Map();
      for (const m of meetings) {
        courses.set(m.courseCode, m.courseName);
        if (/^kuliah$/i.test(m.activity)) continue;
        if (Date.parse(m.end) < now) continue;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        items.push({
          key: `meeting-${m.id}`,
          courseCode: m.courseCode,
          courseName: m.courseName,
          className: "",
          type: EXAM_RE.test(m.activity) ? "EXAM" : "SCHEDULE",
          title: `${m.activity}: ${m.courseName}${m.room ? ` (${m.room})` : ""}`.slice(0, 120),
          dueDate: m.start,
          postedDate: null,
          sourceUrl: m.pageUrl
        });
      }

      return {
        ok: true,
        courses: [...courses].map(([code, name]) => ({ code, name, class_name: "", is_enrolled: true, is_from_six: true })),
        items,
        stats: { courses: courses.size, tasks: items.length, merged: 0, meetingsRead: meetings.length }
      };
    } catch (err) {
      if (err instanceof SignedOutError) return { ok: false, reason: "signed_out" };
      return { ok: false, reason: "failed", detail: String(err && err.message ? err.message : err) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "SIX_SYNC") {
      syncSix().then(sendResponse);
      return true;
    }
    return false;
  });

  // Tell the extension a signed-in SIX tab is open (SIX shows a /logout link only when signed in).
  if (document.querySelector("a[href*='/logout']")) {
    chrome.runtime.sendMessage({ type: "SIX_TAB_READY" }).catch(() => {});
  }
})();
