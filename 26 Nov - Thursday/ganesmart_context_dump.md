# Ganesmart — Project & Development Context Dump
**Event:** STACK 2026 Semifinal (Google Developer Group — Institut Teknologi Bandung)  
**Team Name:** i'm stacking it  
**Project Title:** Ganesmart: All-in-one academic announcement dashboard for ITB Students  
**Selected Case:** Case 1: Smarter Campus and Learning  
**Team Members:** Muhammad Hafidz Akemi Pasha (Leader), Marvell Arya Prabowo, Shakila Naira Indrayana, Rasha Pradipta Saleh  
**Semifinal Submission Deadline:** Monday, 30 November 2026, 23:59 WIB (Proposal PDF ≤ 10 content pages + Signed Declaration of Originality + ≤ 2-minute 1080p English Video)  
**Final Day Date:** 19 December 2026 (Top 10 announced 7 December 2026)

---

## 1. Problem & User Context (Verified from Abstract & Semifinal Review)
* **Core Problem:** ITB students face severe information fragmentation across disconnected academic platforms:
  * **SIX:** Used primarily for recording attendance and checking class schedules.
  * **EduNex & Google Classroom:** Primary course websites and lecture materials.
  * **Microsoft Teams:** Frequently used by professors to share supplementary materials in chat threads.
  * **Outlook:** Delivers critical schedule changes and official campus announcements.
* **Impact:** Without a centralized tracking system, students miss critical deadlines, exam dates, and schedule changes, directly hurting academic performance—especially during peak periods like **midterm (UTS) and final (UAS) exam weeks**.
* **Supporting Evidence:**
  * Peer feedback and firsthand student experience across undergraduate channels (2026).
  * Formal escalation to **DITSAMA (Direktorat Persiapan Bersama) ITB** via email on **12 October 2026** (acknowledged, but no official technical solution offered).
  * *Semifinal Action Item:* Collect primary data (5–8 question Google Form survey aiming for 30+ ITB student responses by 28 Nov, course-platform audit table across team members' courses, and 2–3 anonymized real screenshots of single-platform announcements) to push Problem Understanding (25% rubric weight) from 4/5 to 5/5.
* **Differentiator:** Acts as a zero-migration aggregation layer over existing campus tools so neither students nor faculty have to abandon their current software.

---

## 2. Committed Product & Privacy Design
This exact privacy and control commitment is included in both the proposal's privacy section and the Chrome extension's first screen (`popup.html`):

* **The concept:** A Chrome extension reads the Edunex and SIX pages you already open while logged in. It never asks for your password. Teams, Outlook, and Classroom connect through their official sign-in instead. Everything lands in one dashboard sorted by deadline.
* **What it pulls:** Only course name, assignment or announcement title, due date, posted date, and a link back to the original page.
* **What it never touches:** Your password or login session, grades, transcripts, student ID details, files you submit, or private messages.
* **What it keeps:** Just those deadline items, stored on your own device by default. When Gemini reads an announcement to find the date, only that announcement's text is sent, and it isn't stored afterwards.
* **Your control:** You choose which platforms to connect, can see every saved item, and can delete everything with one click.

---

## 3. Verified Technical Architecture & Data Sources

### A. Chrome Extension Pipelines (Edunex & SIX — Stripped Payloads Only)
Based on DevTools verification, the extension only touches four raw data types on open pages and pushes stripped-down payloads (never tokens, credentials, or grades):
1. **Edunex Course List (`JSON` from `/course/courses`)**
   * *Extracts:* `code`, `name`, `class_name`, `is_enrolled`, `is_from_six`.
   * *Output:* Active course lookup table so incoming alerts map to the right class without double-scraping SIX.
2. **Edunex Notification Bell (`JSON` from `/notifications/<id>`)**
   * *Extracts:* `type` (`ASSIGNMENT`, `EXAM`, `CONTENT`), `title`, `message`, `date` (UTC), and `callbackUrl`.
   * *Output:* Normalized alert object → Gemini (with deterministic rule-based fallback) extracts due dates/changes, merges duplicate file uploads, ranks urgency, and attaches the deep link back to Edunex.
3. **Edunex Course Modules (`JSON` from `/course/modules`)**
   * *Extracts:* `name`, `index`, `course_id`, `module_exam`, and `created_at` (skipping dummy `start_at`/`end_at` timestamps).
   * *Output:* Backup assignment/exam trigger in case a lecturer uploads a homework module without firing a bell notification.
4. **SIX Portal Pages & Calendar (`HTML` + `.ics` from `/home`, `/kelas`, `/KalenderPendidikan-ics`)**
   * *Extracts:* Rendered text from `"Jadwal"`, `"Berita"`, `"Dokumen"`, class schedules, and iCalendar events (only when SIX is open).
   * *Output:* Cleaned text/event blocks → Gemini/fallback extracts official campus dates and schedule changes into the unified feed and deadline calendar.

### B. Backend Sync Pipelines (Teams, Outlook, Google Classroom)
* **Outlook, Teams, and Google Classroom** do **not** go through the Chrome extension; the backend pulls those directly via Microsoft Graph API, Google Classroom API, or inbox/manual fallback (noting tenant admin-consent constraints honestly in the proposal).

---

## 4. Verified Edunex DOM Findings (`https://edunex.itb.ac.id/`)
During live testing on `https://edunex.itb.ac.id/`, we verified the exact DOM behavior of the **Assignment List** widget:
* **Table Columns:** `NO`, `Course`, `Title`, `Start`, `End`, `Type`, `Score` (explicitly ignored), `Action`.
* **Date Format:** `DD/MM/YY HH:mm` (e.g., `24/11/26 18:02` for Start/Posted and `01/12/26 17:00` for End/Due), parsed to ISO `YYYY-MM-DDTHH:mm`.
* **Row Link Structure:** Each `<tr class="tr-values vs-table--tr ...">` contains two `<a>` tags:
  1. Course link: `href="/courses/<id>/preview"` (e.g., `/courses/93843/preview`)
  2. Direct assignment action link wrapping `"Open"`: `href="/assignment/take/<id>"` (e.g., `/assignment/take/126473`)
  * *Fix Applied:* `extractBestSourceUrl()` prioritizes `/assignment/take/<id>` (or `"Open"` action links) over `/courses/<id>/preview`.
* **Submission Status Filtering:** Status badges appear as `<span class="font-bold badge inactive"> Unanswered </span>` vs. `Submitted`.
  * *Fix Applied:* `isUnsubmittedRow()` filters out rows marked `Submitted`, `Turned in`, `Completed`, `Done`, `Graded`, `Dikumpulkan`, or `Selesai` so only unsubmitted/unanswered assignments are captured.

---

## 5. Known Design Limitations & Mitigations (For Technical Design / Risks)
1. **Open-tab & desktop-session dependency:** Extension capture for Edunex/SIX requires the student to open those pages in desktop Chrome while logged in; mitigated by backend sync for Teams/Outlook/Classroom and a universal manual-paste fallback.
2. **DOM/API fragility:** Layout or endpoint updates on Edunex/SIX can break automatic extraction; mitigated by resilient selectors, JSON + DOM fallback parsing, and manual paste.
3. **Tenant consent boundaries:** ITB's Microsoft tenant may restrict third-party Graph API permissions; mitigated by testing scopes early and offering inbox/manual fallback.
4. **Local-first storage trade-off:** Storing items locally on the user's device maximizes privacy and zero-server friction, though cross-device sync requires optional backend/export opt-in.
5. **AI parsing latency & rate limits:** Per-snippet Gemini calls discard raw text immediately after extraction, paired with a deterministic regex/rule-based parser fallback if Gemini fails or is offline.
6. **Distribution:** Distributed free via Chrome Developer Mode (**Load unpacked**) and open-source GitHub repo for the hackathon pilot (avoiding the $5 one-time Chrome Web Store developer fee until post-hackathon scaling).

---

## 6. Current Prototype Inventory & Progress Status

### Built & Working in Prototype
* **Web Dashboard (`index.html` — HTML + Tailwind CSS + Vanilla JS):**
  * Active course lookup table modal (`/course/courses` fields: `code`, `name`, `class_name`, `is_enrolled`, `is_from_six`).
  * Urgency-ranked and deadline-sorted unified feed with duplicate-update merging (`updates merged` counter).
  * Separation of Extension Pipelines (`Edunex`, `SIX`) vs. Backend Sync (`Teams`, `Outlook`, `Classroom`) + source/pipeline filter pills.
  * Manual paste / payload simulation modal with rule-based extraction fallback and immediate raw-text discard.
  * Privacy & Data Transparency modal + per-source toggles + one-click **"Delete Everything"**.
* **Chrome Extension (`ganesmart-extension/` — Manifest V3):**
  * `manifest.json`: MV3 config with `storage`, `activeTab`, `scripting`, and `*://*.itb.ac.id/*`, `*://*.cognisia.id/*` permissions.
  * `popup.html` & `popup.js`: First-screen privacy commitment notice, **Scan Open Tab**, **Delete Everything**, saved deadline list with completion checkboxes and deep links, and local parser/sync preferences.
  * `background.js`: Course lookup mapping, duplicate title normalization/merging, urgency scoring, ephemeral per-snippet Gemini extraction + rule-based fallback, and optional stripped-payload backend push.
  * `content.js`: Verified live on `https://edunex.itb.ac.id/` to extract unsubmitted assignments (`Unanswered`), `DD/MM/YY HH:mm` start/due dates, and direct `/assignment/take/<id>` deep links while skipping grades and submitted items.

### Remaining Work (Before 30 Nov Semifinal & 19 Dec Final Day)
* **Before 30 Nov 2026 (Semifinal Submission):**
  1. Collect primary user evidence (ITB student survey + course-platform audit + anonymized single-platform announcement screenshots).
  2. Complete the 10-page Proposal PDF (including existing alternatives comparison table, architecture diagram, honest Built vs. Planned tags, AI disclosure, and signed Declaration of Originality).
  3. Record and edit the ≤ 2-minute, 1080p English team video showcasing the working Edunex extension scan + dashboard flow and stating what is built vs. remaining.
* **Post-Semifinal / Final Day Tasks (7–19 Dec 2026):**
  1. Expand live extension extractors for Edunex `/notifications/<id>`, `/course/modules`, and SIX `/home`, `/kelas`, `/KalenderPendidikan-ics`.
  2. Wire backend ingest server + verified OAuth connectors (Classroom / Outlook / Teams where permitted).
  3. Run usability pass and pilot evaluation with ITB students.