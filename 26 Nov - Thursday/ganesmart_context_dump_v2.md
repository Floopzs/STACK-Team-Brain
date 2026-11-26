# Ganesmart Reader — Project Context Dump (v2)

**Last Updated:** November 26, 2026  
**Project Type:** Chrome Extension (Manifest V3)  
**Target Domain:** ITB Academic Workflow (Edunex, SIX ITB, Microsoft Teams Assignments)  
**Core Philosophy:** Local-first, read-only DOM extraction from already-authenticated browser tabs—never touching passwords, session tokens, grades, transcripts, student IDs (NIM), or private messages.

---

## 1. High-Level Architecture & File Structure

The extension runs entirely client-side with zero build step (vanilla JS + HTML/CSS):

1. **`manifest.json` (v0.1.0)**
   - **Permissions:** `storage`, `activeTab`, `scripting`
   - **Host Permissions & Content Script Matches:**
     - `*://*.itb.ac.id/*` (SIX & Edunex)
     - `*://*.cognisia.id/*` (Edunex)
     - `*://*.cloud.microsoft/*`, `*://*.microsoft.com/*`, `*://*.office.com/*` (Microsoft Teams & embedded Assignments iframe)
   - **Frame Injection:** `"all_frames": true` at `"document_idle"` so `content.js` runs inside nested iframes (specifically `https://assignments.edu.cloud.microsoft`).

2. **`background.js` (Service Worker)**
   - Manages `chrome.storage.local` state (`items`, `courses`, `settings`).
   - Normalizes titles, deduplicates recurring assignments vs. distinct class schedule sessions, and calculates `urgencyScore` ($0\text{–}100$).
   - Optional ephemeral **Gemini 2.5 Flash** (`gemini-2.5-flash`) extraction: sends only a single snippet (max 1,500 chars) to parse `courseCode`, `title`, and `dueDate`, discarding raw text immediately afterward.
   - Optional stripped-payload sync (`POST` to `backendEndpoint`) containing only sanitized deadline fields.
   - Orchestrates Microsoft Teams assignment deep-linking in the page's `"MAIN"` JS world (`OPEN_TEAMS_ASSIGNMENT`) so execution survives popup closure when switching tabs.

3. **`content.js` (DOM Reader & Page Action Runner)**
   - Guards against sensitive inputs/containers (`form`, `input[type='password']`, `.chat-dm`, `.private-message`, and labels matching `grade|nilai|transkrip|nim|password|pesan|dm`).
   - Implements platform-specific parsers for **Edunex**, **SIX**, and **Microsoft Teams**.
   - Handles `OPEN_SIX_MODAL` messages and `ganesmart_pending_six_modal` storage handoffs on page load.

4. **`popup.html` & `popup.js` (Dashboard Popup UI)**
   - Displays the first-screen privacy commitment.
   - Provides a **Time Interval Picker** (relative windows: `3`, `7`, `14`, `30` days, or `0` for all dates; or exact `start`/`end` date inputs) that filters both SIX ingestion and feed visibility.
   - Renders the deadline/schedule feed sorted chronologically with completion checkboxes, delete buttons, and **Open source ↗** deep-link triggers.
   - Exposes platform toggles (`Edunex`, `SIX`, `Microsoft Teams`), Gemini API key/toggle, and backend ingest URL/toggle.

---

## 2. Storage Schema (`chrome.storage.local`)

### Storage Keys
- `ganesmart_items_v1`: Array of sanitized academic items.
- `ganesmart_courses_v1`: Enrolled course catalog (pre-seeded with ITB TPB/IF courses such as `IF1210`, `MA1101`, `KI1101`, `FI1101`, `WI1102`, `WI1103`, `WI1111`, `WI1116`, `WI2005`).
- `ganesmart_settings_v1`: User preferences (`edunexEnabled`, `sixEnabled`, `teamsEnabled`, `intervalDays`, `intervalStartDate`, `intervalEndDate`, `backendSyncEnabled`, `backendEndpoint`, `geminiEnabled`, `geminiApiKey`, `geminiModel`).
- `ganesmart_pending_six_modal`: Temporary 30-second handoff payload (`{ dateStr, rawText, createdAt }`) for opening a SIX class modal after tab focus.

### Sanitized Item Payload (`sanitizeStrippedPayload`)
```json
{
  "id": "1732636920000-ab12c",
  "courseCode": "MA1101",
  "courseName": "Matematika I",
  "className": "K48",
  "type": "ASSIGNMENT",
  "pipeline": "Teams Assignments",
  "sourcePlatform": "Teams",
  "title": "HOMEWORK XI",
  "dueDate": "2026-11-30T21:00",
  "postedDate": "2026-11-26T16:00:00.000Z",
  "sourceUrl": "https://assignments.edu.cloud.microsoft/classes/<classId>/assignments/1b6dc1e1-c1a4-4c87-9b1f-9fe15eb40d88",
  "sixTarget": null,
  "teamsTarget": {
    "cardId": "1b6dc1e1-c1a4-4c87-9b1f-9fe15eb40d88",
    "title": "HOMEWORK XI",
    "courseCode": "MA1101",
    "courseLine": "MA1101 MATHEMATICS I K48"
  },
  "urgencyScore": 75,
  "mergedCount": 1,
  "isCompleted": false
}
```

---

## 3. Platform Parsers & Deep-Link Mechanics

### A. Edunex (`*.itb.ac.id` / `*.cognisia.id`)
- **Extraction (`extractEdunexUnsubmitted`):** Scans table rows (`table tr, [role='row']`), skips rows containing submission/completion badges (`submitted`, `turned in`, `completed`, `graded`, `dikumpulkan`, `selesai`), parses `DD/MM/YY HH:MM` timestamps into `20YY-MM-DDTHH:MM`, and extracts course codes (`[A-Z]{2,4}\d{4}`).
- **Deep Link:** Prioritizes links matching `/\/(assignment|task|quiz|exam)\//i` or `Open` buttons over generic course preview links.

### B. SIX ITB (`six.itb.ac.id/app/mahasiswa/kelas/jadwal/...`)
- **Extraction (`extractSixCalendarClasses`):** Iterates through monthly calendar cells (`td`), tracks day-number rollovers across months (`Agu`–`Des`, `Jan`–`Jul`), and parses `a.linkpertemuan` entries (`HH:MM - HH:MM <Course/Topic>`).
- **Privacy Sanitization (`sanitizeSixUrl`):** Strips `/mahasiswa:<NIM>` segments from URLs down to `/mahasiswa`.
- **Deep Link (`openSixClassModal`):** Focuses an existing SIX `/kelas/jadwal` tab, switches to the target month tab (e.g., `Nov 2026`) if needed, and clicks the matching `a.linkpertemuan` anchor to open the class detail modal.

### C. Microsoft Teams (`teams.cloud.microsoft` / `assignments.edu.cloud.microsoft`)
- **Iframe Architecture:** Teams renders Assignments inside a cross-origin iframe at `https://assignments.edu.cloud.microsoft/classes/all/list`.
- **Extraction (`extractTeamsAssignments`):**
  - Skips scanning if the active tab is `Completed`.
  - Queries Fluent UI cards: `.aui-assignmentListCard, [class*='assignmentListCard']`.
  - Reads the 3-line text structure inside each card:
    1. Title (`[data-test="assignment-card-title-all-up-view"]`, e.g., `HOMEWORK XI`)
    2. Due time (e.g., `Due at 9:00 PM` $\rightarrow$ `21:00`)
    3. Course & section (`.row3Text__*`, e.g., `MA1101 MATHEMATICS I K48`)
  - Associates each card with its nearest preceding DOM date header (`Today`, `Tomorrow`, or `Nov 30th Monday`) using `compareDocumentPosition`.
  - Captures the card's unique assignment UUID from `card.id` (e.g., `1b6dc1e1-c1a4-4c87-9b1f-9fe15eb40d88`).
- **Deep Link (`openTeamsAssignmentFlow` in `background.js`):**
  1. **Direct URL fast-path:** If `item.sourceUrl` already contains `/assignments/<uuid>`, opens it directly in a new tab.
  2. **Existing tab `MAIN`-world trigger:** Injects `clickTeamsCardInMainWorld` across all frames of an open Teams tab (`world: "MAIN"`). Because Fluent UI cards have no inner `<a>` or `<button>`, it locates the card by `card.id` (or title/course fallback) and directly invokes `card[__reactProps*].onClick(...)` (with `Enter` keypress + bubbling `MouseEvent` fallback).
  3. **New tab fallback:** Opens `https://assignments.edu.cloud.microsoft/classes/all/list` and polls in `world: "MAIN"` until the card mounts and clicks it.
  4. **URL persistence (`captureAndSaveDeepTeamsUrl`):** Polls the frame URL after navigation and saves `/classes/<classId>/assignments/<cardId>` back to `sourceUrl` in `chrome.storage.local` for instant one-click opening next time.

---

## 4. Key Technical Discoveries & Resolved Issues

- **Cross-Origin Iframe Isolation:** `SCAN_OPEN_PAGE` in `content.js` only sends a response (`shouldRespond: true`) from the specific frame that actually contains `.aui-assignmentListCard` elements, preventing empty parent frames from racing and returning `0` items.
- **React Synthetic Event Handling (`world: "MAIN"`):** Standard `.click()` calls from an isolated content-script world did not trigger Fluent UI card navigation. Inspecting the card revealed `onClick` and `onKeyDown` bound on `card.__reactProps*` with `id="<assignment-uuid>"`, which navigates client-side to `/classes/<classId>/assignments/<assignment-uuid>` when called in `world: "MAIN"`.
- **Popup Unload Race Condition:** Focusing an existing Teams tab immediately closes the extension popup and terminates any `setTimeout` polling in `popup.js`. Moving `OPEN_TEAMS_ASSIGNMENT` into `background.js` guarantees reliable card clicking and deep-URL capture.

---

## 5. Next Steps / Planned Extensions

1. **Google Classroom (`classroom.google.com`) Extraction:** Add host permissions and DOM parser for upcoming coursework/to-do items and direct `/c/<courseId>/a/<assignmentId>/details` links.
2. **Outlook (`outlook.office.com` / `outlook.live.com`) Extraction:** Parse academic announcement/deadline emails or calendar events with strict privacy filtering (ignoring personal/DM threads).
3. **Unified Web Dashboard Sync:** Wire `backendEndpoint` to a local/hosted Ganesmart web dashboard for cross-device viewing of stripped deadline items.
4. **Badge Counter & Auto-Scan:** Add `chrome.action.setBadgeText` for deadlines due within 24 hours and optional passive scanning on allowed portals.