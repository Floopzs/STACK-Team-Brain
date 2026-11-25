# Ganesmart — Chrome Extension Extraction & Output Spec

## Overview
The Ganesmart Chrome extension operates inside the student's active logged-in browser sessions to collect raw course data without storing passwords or sending login tokens to the backend. Stripped-down payloads are sent to the server, where the **Gemini API** normalizes every item into one unified output format:

`{ course, platform, title, deadline, urgency_rank, summary, original_url }`

---

## Platform Breakdown

### 1. Edunex (`api-edunex.cognisia.id` — JSON API)
- **Access Method:** Background script reads `accessToken` from `localStorage` (`auth`) and queries JSON:API endpoints directly.
- **Extracts:**
  - Active course metadata (`code`, `name`, `class_name`, `is_enrolled`, `is_from_six`)
  - Notification bell items (`type`, `title`, `message`, `date`, `callbackUrl`)
  - Module lists (`name`, `index`, `course_id`, `module_exam`)
- **Output:** Course-tagged assignment, quiz, and material alerts with UTC timestamps, duplicate file uploads merged, and deep links back to Edunex.

### 2. SIX (`six.itb.ac.id` — HTML + `.ics` Feed)
- **Access Method:** Content script reads rendered HTML and the campus calendar feed inside an active `HttpOnly`-cookie browser session.
- **Extracts:**
  - Rendered HTML text from `/home` (`Jadwal`, `Berita`, `Dokumen`) and `/kelas`
  - iCalendar events from `/KalenderPendidikan-ics`
- **Output:** Official academic calendar dates, class schedule changes, and campus notices deduplicated against Edunex (`is_from_six`).

### 3. Outlook Web (`outlook.cloud.microsoft` / `outlook.office.com` — DOM HTML/Text)
- **Access Method:** Content script reads visible email threads in-session (bypassing Microsoft Entra ID third-party OAuth consent blocks).
- **Extracts:**
  - Email subjects, senders, timestamps, body text, and message URLs from inbox rows and reading panes (including Teams and Classroom alert emails)
- **Output:** AI-extracted deadlines, exam/room changes, and lecturer notices ranked by urgency with a direct link to the email thread.

### 4. Microsoft Teams Web (`teams.cloud.microsoft` / `teams.microsoft.com` — DOM HTML/Text)
- **Access Method:** Content script reads open course channels in-session (paired with Outlook Web email alerts and manual paste/screenshot fallback).
- **Extracts:**
  - Channel post text, course/channel titles, author names, timestamps, and post permalinks
- **Output:** Informal class announcements, rescheduled sessions, and chat-posted tasks converted into prioritized feed cards.

### 5. Google Classroom (`classroom.google.com` — DOM HTML/Text)
- **Access Method:** Content script reads Classroom Web views in-session (avoiding unverified Google OAuth testing caps and 7-day token expirations).
- **Extracts:**
  - Post cards, due-date labels, titles, instructions, and links from the `Stream`, `Classwork`, and `To-do` views
- **Output:** Structured homework deadlines and new material alerts merged into the single feed and deadline calendar.