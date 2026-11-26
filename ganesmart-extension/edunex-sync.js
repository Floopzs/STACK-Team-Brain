// Ganesmart: direct Edunex sync (no screen reading).
//
// Runs inside an edunex.itb.ac.id tab and asks Edunex's own API for every enrolled course and
// its upcoming tasks and exams, the same way the Edunex website does in that tab. It uses the
// login the website already keeps in this tab. The login token never leaves this page: it is
// not copied into the extension, stored, or sent anywhere except to Edunex's own API.
//
// What it returns to the extension: course code/name/class, item title, due/posted date and a
// link back to Edunex. Nothing else (no answers, files, scores, IDs or messages).
(() => {
  if (window.__ganesmartEdunexSync) return;
  window.__ganesmartEdunexSync = true;

  const API = "https://api-edunex.cognisia.id";
  const WEB = "https://edunex.itb.ac.id";
  const LOOKBACK_DAYS = 7; // keep items that went overdue in the last week; AI sorts them later
  const PARENT_RE = /\s*\[parent class\]\s*/i;

  class SignedOutError extends Error {}

  // The Edunex website keeps its login as localStorage.auth = { accessToken, ... }.
  function readAccessToken() {
    try {
      const auth = JSON.parse(localStorage.getItem("auth") || "null");
      const token = auth && auth.accessToken;
      return typeof token === "string" && token.split(".").length === 3 ? token : null;
    } catch (_err) {
      return null;
    }
  }

  async function api(token, path, params = {}) {
    const url = new URL(path, API);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit"
    });
    if (res.status === 401) throw new SignedOutError("Edunex login expired");
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  }

  // Edunex compares task deadlines in WIB with no zone: "2026-11-19 21:00:00".
  function wibNaive(ms) {
    return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }

  function asList(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    return [];
  }

  function normTitle(title = "") {
    return String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function isSent(answer) {
    const v = answer && answer.is_sent;
    return v === 1 || v === "1" || v === true;
  }

  // 1. Every course and class this term, from the list Edunex's attendance page uses.
  //    A class's "[Parent Class]" shows up as its own course with the same code and class.
  async function fetchCourses(token) {
    const rows = asList(await api(token, "/course/presences/list"));
    const byId = new Map();
    for (const r of rows) {
      const id = Number(r.course_id);
      if (!id || byId.has(id)) continue;
      const rawName = String(r.courses_name || "");
      byId.set(id, {
        id,
        code: String(r.course_code || "").toUpperCase(),
        name: rawName.replace(PARENT_RE, " ").trim(),
        className: String(r.class_name || ""),
        isParent: PARENT_RE.test(rawName)
      });
    }
    return byId;
  }

  // 2. Tasks due from a week ago onwards, for all courses in one call.
  //    Falls back to one call per course if Edunex refuses the combined filter.
  async function fetchTasks(token, courseIds) {
    const since = wibNaive(Date.now() - LOOKBACK_DAYS * 86400 * 1000);
    try {
      return asList(
        await api(token, "/course/tasks", {
          "filter[course_id][in]": courseIds.join(","),
          "filter[end_at][gte]": since,
          "page[limit]": 0
        })
      );
    } catch (err) {
      if (err instanceof SignedOutError) throw err;
      const all = [];
      for (const id of courseIds) {
        try {
          all.push(...asList(await api(token, "/course/tasks", { "filter[course_id][is]": id, "page[limit]": 0 })));
        } catch (inner) {
          if (inner instanceof SignedOutError) throw inner;
        }
      }
      return all;
    }
  }

  // 3. Exams per course. Best effort: Edunex's exam fields are not confirmed yet.
  async function fetchExams(token, courseIds) {
    const out = [];
    for (const id of courseIds) {
      try {
        for (const e of asList(await api(token, "/exam/exams", { "filter[course_id][is]": id, "page[limit]": 0 }))) {
          out.push({ courseId: id, exam: e });
        }
      } catch (err) {
        if (err instanceof SignedOutError) throw err;
      }
    }
    return out;
  }

  function courseFields(course, fallbackName, fallbackCode) {
    return {
      courseId: course ? course.id : null,
      courseCode: (course && course.code) || String(fallbackCode || "").toUpperCase() || "GEN",
      courseName: (course && course.name) || String(fallbackName || "").replace(PARENT_RE, " ").trim(),
      className: course ? (course.isParent ? "Parent Class" : course.className) : "",
      isParent: Boolean(course && course.isParent)
    };
  }

  function taskToItem(task, courses, stats) {
    const a = task.attributes || {};
    if (!a.name || !a.end_at) return null;
    if (Array.isArray(a.answers) && a.answers.some(isSent)) {
      stats.submittedSkipped += 1;
      return null; // already handed in; the answer itself is never kept
    }
    const domain = String(a.domain || "").toLowerCase();
    const isExam = domain === "uts" || domain === "uas" || /\b(quiz|kuis|ujian|exam|uts|uas)\b/i.test(a.name);
    return {
      key: `task-${task.id}`,
      ...courseFields(courses.get(Number(a.course_id)), a.course_name, a.course_code),
      type: isExam ? "EXAM" : "ASSIGNMENT",
      title: String(a.name).trim().slice(0, 120),
      dueDate: a.end_at,
      postedDate: a.start_at || a.created_at || null,
      sourceUrl: `${WEB}/assignment/take/${task.id}`
    };
  }

  function examToItem({ courseId, exam }, courses) {
    const a = exam.attributes || {};
    const title = a.name || a.title;
    const due = a.end_at || a.start_at;
    if (!title || !due) return null;
    if (Date.parse(due) < Date.now() - LOOKBACK_DAYS * 86400 * 1000) return null;
    return {
      key: `exam-${exam.id}`,
      ...courseFields(courses.get(courseId)),
      type: "EXAM",
      title: String(title).trim().slice(0, 120),
      dueDate: due,
      postedDate: a.start_at || null,
      sourceUrl: `${WEB}/courses/${courseId}`
    };
  }

  // The same task posted in a class and in its "[Parent Class]" becomes one item that links to
  // the class's own copy first and lists the other copy under alsoIn.
  function mergeParentDuplicates(items) {
    const groups = new Map();
    for (const it of items) {
      const key = [it.courseCode, normTitle(it.title), String(it.dueDate).slice(0, 16)].join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const merged = [];
    for (const group of groups.values()) {
      group.sort((x, y) => Number(x.isParent) - Number(y.isParent));
      const [primary, ...rest] = group;
      merged.push({
        ...primary,
        mergedCount: group.length,
        alsoIn: rest.map((r) => ({ className: r.className, sourceUrl: r.sourceUrl }))
      });
    }
    return merged;
  }

  async function syncEdunex() {
    const token = readAccessToken();
    if (!token) return { ok: false, reason: "signed_out" };

    try {
      const courses = await fetchCourses(token);
      const ids = [...courses.keys()];
      if (ids.length === 0) return { ok: true, courses: [], items: [], stats: { courses: 0, tasks: 0, merged: 0, submittedSkipped: 0 } };

      const stats = { courses: 0, tasks: 0, merged: 0, submittedSkipped: 0 };
      const [tasks, exams] = await Promise.all([fetchTasks(token, ids), fetchExams(token, ids)]);

      const raw = [
        ...tasks.map((t) => taskToItem(t, courses, stats)),
        ...exams.map((e) => examToItem(e, courses))
      ].filter(Boolean);
      const items = mergeParentDuplicates(raw);

      const courseList = [];
      const seenCodes = new Set();
      for (const c of courses.values()) {
        if (!c.code || seenCodes.has(c.code)) continue;
        seenCodes.add(c.code);
        courseList.push({ code: c.code, name: c.name, class_name: c.className, is_enrolled: true, is_from_six: false });
      }

      stats.courses = courseList.length;
      stats.tasks = items.length;
      stats.merged = raw.length - items.length;
      return { ok: true, courses: courseList, items, stats };
    } catch (err) {
      if (err instanceof SignedOutError) return { ok: false, reason: "signed_out" };
      return { ok: false, reason: "failed", detail: String(err && err.message ? err.message : err) };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "EDUNEX_SYNC") {
      syncEdunex().then(sendResponse);
      return true; // async reply
    }
    return false;
  });

  // Let the extension know an Edunex tab is open, so it can sync on its own if the last sync
  // is old. Only signed-in tabs say so.
  if (readAccessToken()) {
    chrome.runtime.sendMessage({ type: "EDUNEX_TAB_READY" }).catch(() => {});
  }
})();
