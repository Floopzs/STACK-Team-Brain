# Edunex Plus vs. Ganesmart v2 (Full Feature & Architecture Comparison)

## Overview

**Edunex Plus** is a standalone desktop client built to replace daily browsing of ITB's two internal student portals (**Edunex** and **SIX**) with deep academic tracking (grades, GPA, attendance budgets, UKT bills, and PDF/Word annotations).

**Ganesmart v2** is a **zero-credential, cross-ecosystem AI triage layer** (Chrome Extension + Web Dashboard) built to catch scattered academic updates across **five platforms** (**Edunex, SIX, Outlook Web, Microsoft Teams Web, and Google Classroom**) plus manual **WhatsApp/LINE** pastes—without asking students for university passwords or collecting grades.

---

## 1. High-Level Architectural & Strategic Differences

| Dimension | Edunex Plus | Ganesmart v2 |
| :--- | :--- | :--- |
| **Platform Scope** | **2 internal systems:** Edunex + SIX (plus ITB's public `Kalender Pendidikan`). Blind to external lecturer emails and chats. | **5 fragmented platforms + chat paste:** Edunex, SIX, **Outlook Web**, **Microsoft Teams Web**, and **Google Classroom**, plus manual **WA/LINE** paste ingestion. |
| **Onboarding & Login Psychology** | **Standalone desktop app with sign-in:** Students install an executable and authenticate with their ITB **INA account** credentials. | **Zero-credential in-session capture:** Manifest V3 extension piggybacks on open logged-in browser tabs. Students never type their INA, Microsoft, or Google passwords into Ganesmart—eliminating credential-entry anxiety and bypassing enterprise OAuth walls. |
| **Core Intelligence** | **Deterministic schema mapping (no AI):** Parses structured Edunex API entities (`course/tasks`, `Handed back`, `Catatan dosen`) and SIX HTML tables directly. | **Hybrid JSON/DOM capture + Gemini AI + regex fallback:** Extracts deadlines, effort weights, and one-line summaries from unstructured lecturer posts, merges cross-platform duplicates, and powers a read-only deadline Q&A assistant. |
| **Product Philosophy** | **Heavy academic workstation:** Replaces portal browsing with PDF/Word highlighting (`Sorotan`), page notes (`Catatanku`), live `Tandai Hadir` popup polling, attendance budgets (`Kehadiran`), UKT bills, KRS, and GPA (`IP`/`IPK`). | **Lightweight, zero-migration radar:** Intentionally excludes grades, GPA, attendance history, and social features; focuses strictly on deadline triage, schedule updates, and single-channel alert visibility. |
| **Privacy & Telemetry** | Local-first storage for notes and `Snooze`/`Handled` states; scrubs full-page HTML before sending `Problem reports` to a maintainer relay and logs anonymized daily `Usage data`. | **Strict minimal-scope policy:** Never touches grades, NIM details, or submitted files. Ephemeral per-snippet Gemini processing discards raw text immediately; users control per-app toggles and have one-click **Delete Everything**. |
| **Portal Drift & Fallback** | Maintainer-driven `fix-bot` workflow drafts code patches from user-submitted scrubbed HTML reports (`Unrecognised row` / `Changed page`). | **Instant user-driven fallback:** Manual paste modals (#11, #13) allow immediate deadline or notice extraction whenever a platform layout shifts or when announcements arrive on mobile chat apps. |

---

## 2. Complete Ganesmart v2 Feature Breakdown vs. Edunex Plus

The table below maps all **28 features** from Ganesmart's updated roadmap (tagged by milestone: **Semi** = 30 Nov, **Build** = 7–16 Dec, **Final** = 19 Dec, **Later** = Post-Hackathon) against Edunex Plus's existing capabilities.

### A. Multi-Platform Ingestion & Sync
| # | Ganesmart v2 Feature | Milestone | How Edunex Plus Compares |
| :--- | :--- | :--- | :--- |
| **1** | Unified dashboard for announcements, assignments, and academic calendar (core dashboard + Edunex sync) | `Semi` | Edunex Plus unifies Edunex + SIX on its `Beranda` screen, but excludes external platforms (Teams, Outlook, Classroom). |
| **19** | Direct Edunex sync: pull all active courses and updates in one click without manual screen scanning | `Semi` | Edunex Plus syncs Edunex API automatically inside its desktop client after INA sign-in. |
| **20** | SIX reader: class schedule (`Jadwal`), announcements/documents, and `/KalenderPendidikan-ics` with deep link to SIX | `Semi` | Edunex Plus parses full SIX HTML (timetables, rooms, grades, KRS, UKT bills, `Kehadiran` counts) in addition to `.ics`. |
| **21** | Teams reader: in-session browser DOM capture on Teams Web (+ Outlook alert emails & paste fallback; no OAuth) | `Build` | **Not supported** in Edunex Plus. |
| **22** | Outlook reader: in-session browser DOM capture on Outlook Web with Gemini deadline extraction (no OAuth) | `Build` | **Not supported** in Edunex Plus. |
| **23** | Google Classroom reader: in-session browser DOM capture on `classroom.google.com` + paste fallback (no Google OAuth) | `Build` | **Not supported** in Edunex Plus. |

### B. AI Extraction, Effort Ranking & Assistant
| # | Ganesmart v2 Feature | Milestone | How Edunex Plus Compares |
| :--- | :--- | :--- | :--- |
| **24** | Gemini extracts structured deadlines out of messy announcement text | `Build` | Edunex Plus relies purely on rigid API fields and HTML table columns; cannot parse unstructured text deadlines. |
| **25** | Gemini generates a one-line summary and urgency score for every item | `Build` | Edunex Plus displays raw Edunex titles/notes without AI summarization. |
| **4** | Effort + deadline priority ranking (sorts tasks by workload size + due date, not just chronological order) | `Build` | Edunex Plus sorts chronologically (`To Do` / `Tugas & Ujian`) without workload effort scoring. |
| **9** | Read-only AI chatbot to ask questions about deadlines/tasks and generate summaries | `Final` | **Not supported** in Edunex Plus (no conversational AI layer). |

### C. Cross-Platform Deduplication & Change Alerts
| # | Ganesmart v2 Feature | Milestone | How Edunex Plus Compares |
| :--- | :--- | :--- | :--- |
| **6** | Merge parent class, parallel class, and files across platforms into one unified entry | `Build` | Edunex Plus maps SIX classes to Edunex courses via course codes, but does not merge external Teams/Classroom equivalents. |
| **26** | Semantic cross-platform task merging even when titles differ across apps | `Build` | Edunex Plus deduplicates exams (`UTS`/`UAS`) between Edunex and SIX only. |
| **8** | Alert when a *dosen* edits an old post or moves a deadline | `Final` | Edunex Plus tracks moved deadlines/edits within Edunex/SIX (`Beranda` change items), but misses edits posted on Teams/Outlook/Classroom. |
| **12** | Highlight announcements posted on **only one app** ("single-source shadow post" alert) | `Build` | **Not supported** in Edunex Plus (cannot detect whether an update was omitted from official portals). |

### D. Calendar, Schedule & Attendance QOL
| # | Ganesmart v2 Feature | Milestone | How Edunex Plus Compares |
| :--- | :--- | :--- | :--- |
| **2** | Manually add or remove *matkul* on the calendar (for dropped/unlisted courses) | `Build` | Edunex Plus mirrors official SIX KRS/timetable rows automatically (with `Unrecognised row` handling) rather than manual course editing. |
| **3** | Local browser reminder (`chrome.alarms`) during class hours to *Tandai Hadir*, with one-click *"Sudah Tandai Hadir"* dismiss (zero server push) | `Semi` | Edunex Plus polls SIX's live class popup every 2 minutes to detect when the `Tandai Hadir` button appears and tracks full `Kehadiran` absence budgets. Ganesmart uses a lightweight local timer without scraping attendance history. |
| **5** | Export edited calendar file (`.ics`) for Google Calendar import | `Build` | Edunex Plus displays schedules natively in-app without custom edited `.ics` re-export. |
| **16** | *This Week* focused schedule & deadline view | `Build` | Edunex Plus provides `Jadwal` and `Beranda` views inside its desktop window. |

### E. Task Controls, Manual Fallbacks & UX
| # | Ganesmart v2 Feature | Milestone | How Edunex Plus Compares |
| :--- | :--- | :--- | :--- |
| **7** | Hide finished / past-due tasks | `Semi` | Edunex Plus moves completed items out of `To Do` and offers `Snooze` (`Ingatkan nanti`) / `Handled` (`Sudah beres`). |
| **10** | Choose which platforms to sync + one-click **Delete Everything** | `Semi` | Edunex Plus offers sign-out and local note/highlight clearing, whereas Ganesmart provides granular per-app toggles and single-click full data wipe. |
| **14** | Mark a task as done locally on the student's laptop | `Semi` | Comparable to Edunex Plus's local `Mark as done` (`Tandai selesai`) and `Handled` (`Sudah beres`) states. |
| **15** | Filter feed by course or source platform | `Build` | Edunex Plus filters by course (`Warna mata kuliah`), but has no multi-platform filter since it only reads Edunex/SIX. |
| **17** | Live pending item badge count on the Chrome extension icon | `Build` | Edunex Plus uses a desktop system tray menu and OS notifications. |
| **27** | Direct source deep-link on every item to open the original post | `Semi` | Both platforms provide direct deep links back to the source page. |
| **11** | Manual paste fallback to extract deadlines from any text if a platform fails to scan | `Build` | **Not supported** in Edunex Plus (users wait for `fix-bot` parser updates when pages drift). |
| **13** | Manual paste for important non-deadline announcements from WhatsApp or LINE | `Build` | **Not supported** in Edunex Plus (no ad-hoc chat ingestion). |
| **18** | Bilingual ID / EN language toggle | `Final` | Edunex Plus also supports Indonesian and English copy. |
| **28** | Mobile access (Safari extension or responsive phone dashboard view) | `Later` | Edunex Plus is a desktop-first client; Ganesmart plans responsive web/mobile companion access post-hackathon. |

---

## 3. Explicit Scope Boundaries ("Not Doing")

To preserve speed, privacy, and clear differentiation from Edunex Plus, Ganesmart v2 explicitly excludes:
* **No server-side push notifications:** All reminders (including class-hour *Tandai Hadir* alerts) run locally via `chrome.alarms`.
* **No grades, GPA (`IP`/`IPK`), UKT bills, or attendance history:** Sensitive academic records remain untouched in SIX/Edunex.
* **No social features:** Built strictly as a private, single-student personal radar.

---

## 4. Pitch Summary for STACK 2026

> *"Edunex Plus is an impressive desktop replacement for ITB's internal portals—great if you want deep KRS, UKT, attendance budgets, and PDF annotation. **Ganesmart v2** solves a different problem: academic fragmentation outside ITB's walls. By combining zero-credential browser capture across Edunex, SIX, Outlook, Teams, and Google Classroom with Gemini-powered deadline extraction, effort ranking, and single-platform shadow-post alerts, Ganesmart ensures students never miss an update—without ever handing over their university password."*