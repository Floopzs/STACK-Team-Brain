# STACK 2026 — Team Context (as of Thu 26 Nov, evening)

**Team "i'm stacking it":** Hafidz (Akemi, leader), Marvell, Shakila, Rasha
**Project title:** Ganesmart: All-in-one academic announcement dashboard for ITB Students
**Event:** STACK 2026 by GDGoC ITB, Case 1: Smarter Campus and Learning
**Stage:** Semifinal. Our abstract scored 94/100. We lost 1 point on Problem Clarity because our evidence was anecdotal and we had no data of our own.
**Evidence we have:** student experience, and a formal email to DITSAMA ITB on 12 Oct 2026 (acknowledged, no solution offered).
**Evidence we're collecting by Sat 28 Nov:** the survey (target 30+ ITB students), a table of which platforms each of our courses uses, and 2–3 anonymized screenshots of announcements that only appeared on one platform.

## The product
A web dashboard that pulls course deadlines and announcements from Edunex, SIX, Teams, Outlook and Google Classroom into one place.
- The user installs a **browser extension**. It uses their existing login session to read the data and sends it to the **dashboard website**.
- **Gemini API** extracts, ranks and dedupes deadlines from announcement text.
- **Gemini** turns every item into one format: `{ course, platform, title, deadline, urgency_rank, summary, original_url }`. A rule-based parser takes over if Gemini fails.
- **Feasibility (26 Nov):** Rasha's extension build works on Edunex and SIX. Teams, Outlook and Classroom have not been tested yet.
- **Name:** Ganesmart (used in the files from 25 Nov).
- **Edunex parent vs normal class (key pain point, from Marvell):** a course often has a parent class and a normal class that both show the same assignment, so students can't tell where an assignment or quiz actually lives. Ganesmart should merge those duplicates into one item and link to the class where it should be submitted. Good example for the problem section and the demo (back it with a screenshot or survey answers, not just our word).
- **Why it's different:** it sits on top of the existing tools, so nobody has to migrate.
- **Distribution:** free, as an unpacked Chrome extension and open-source repo for the pilot (no Chrome Web Store fee yet).

## How each platform is read
- **Edunex:** the extension reads the JSON API (`api-edunex.cognisia.id`) using the token already in the browser: course list, notification bell, modules. On the Assignment List page it was verified live: it keeps only unsubmitted items, parses `DD/MM/YY HH:mm` dates, and links to `/assignment/take/<id>`.
- **SIX:** page text from `/home` and `/kelas`, plus the `/KalenderPendidikan-ics` calendar, while SIX is open.
- **Outlook, Teams, Classroom: ⚠ not agreed yet.** Hafidz's spec reads them in the browser like Edunex (avoids Microsoft/Google sign-in approval problems). Rasha's dump says the backend pulls them through official APIs (Graph, Classroom API). The team needs to pick one.

## Built so far (prototype)
- **Dashboard** (`index.html`, Tailwind + vanilla JS): course table, feed sorted by deadline and urgency with duplicates merged, source filters, manual paste with rule-based fallback, privacy panel with per-source toggles and "Delete Everything".
- **Extension** (Manifest V3): popup with privacy notice, Scan Open Tab, Delete Everything and saved deadlines; background script for course matching, dedupe, urgency and Gemini/fallback; Edunex content script verified live.
- **Tested working (26 Nov, Rasha):** extension on Edunex and SIX. The extension → dashboard link is done: the dashboard shows real data, each item with a link to where it came from.
- **Direction (Marvell, 26 Nov):** the extension should grab data directly (API/token sync) instead of reading what's on screen. Being worked on now.
- **Known demo limits:** it scans only the open tab, and overdue items still show (e.g. PR 03, due 13 Oct). Filtering/sorting these will be handled by AI later.
- **Not built/tested yet:** Teams, Outlook and Classroom readers, remaining Edunex notifications/modules extractors, backend server, Teams/Outlook/Classroom connectors, user testing.

## Data policy (decided)
- We pull only the course name, item title, due/posted date and source link.
- The login token is used only inside the browser. It is never stored and never sent to our server or to Gemini.
- We never touch passwords, grades, student IDs, submissions or private messages.
- Data is stored locally by default, and the user can view and delete all of it.
- Gemini gets only announcement text, and nothing is stored there.
- ⚠ Rasha's demo popup says Teams/Outlook/Classroom connect through official sign-in and that it "never touches your login session". Once the extension syncs directly with the login token (being built now), change it to: "uses your existing login inside the browser, never stores or sends it".

## Semifinal deliverables, due Mon 30 Nov 23:59 WIB
1. **Proposal PDF:** in English, at most 10 content pages, with the 7 required sections. It needs a **signed Declaration of Originality** as an appendix (Hafidz signs) and an AI-use disclosure.
2. **Video:** at most 2 minutes, 1080p, in English. It must show the user flow or prototype and say clearly what's done and what's still planned.

**Scoring:** Problem Understanding 25, Solution Design 25, Technical Feasibility 20, Execution & Validation 20, Communication 10 (the video is 5 of that).
**After that:** Top 10 announced 7 Dec, build 7–16 Dec, Final Day 19 Dec in Bandung. We should keep 2–3 tasks to finish on Final Day.

## Who's doing what
- **Shakila:** survey poster (posted). The survey is anonymous and is being shared on WhatsApp.
- **Hafidz/Akemi:** extension tests and milestones. Sends the extension's output format to Rasha.
- **Rasha:** HTML dashboard prototype.
- **Marvell:** proposal writing and competitor/alternatives research.

## Timeline
- **Thu 26:** survey running, connect the extension to the dashboard ✓ (done)
- **Fri 27:** finish the extension → dashboard link
- **Sat 28:** close the survey, get a working demo with real data, take screenshots
- **Sun 29:** write the evidence sections and the video script, record the video
- **Mon 30:** review, Hafidz signs the declaration, submit around 20:00

## Proposal status
Done: identity block, 2.1 problem context, 2.2 target users.
Can be written now: roles, alternatives, solution, features and architecture, privacy, milestones, risks, AI disclosure.
Blocked: survey results (evidence), prototype screenshots, signed declaration.

## Known risks (for the proposal)
Extension only works when the page is open in desktop Chrome; Edunex/SIX layout changes can break it; ITB's Microsoft tenant may block API access; local storage means no cross-device sync by default; Gemini limits (rule-based fallback). Manual paste is the fallback for everything.

## Rules from the judges
- Target one specific user group.
- Don't present planned features as finished.
- Don't invent data, and label any estimates.

## Shared files
- GitHub team brain: https://github.com/Floopzs/STACK-Team-Brain (one folder per day; this file is in `25 Nov - Wednesday`).
- Proposal draft (Google Doc). Older Team Brain Google Doc with daily tables.
