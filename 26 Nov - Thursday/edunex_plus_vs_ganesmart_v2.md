# Edunex Plus vs. Ganesmart (Full 5-Platform Vision)

## Strategic Positioning

**Edunex Plus** is a **single-ecosystem academic workstation** built to replace daily browsing of ITB's two internal portals (Edunex and SIX).  
**Ganesmart** (with **Outlook, Microsoft Teams, and Google Classroom** integrated) is a **cross-ecosystem AI triage layer** built to solve the real reason ITB students miss deadlines: critical academic updates do not stay inside Edunex and SIX.

---

## Side-by-Side Comparison (Full Integrated Architecture)

| Dimension | Edunex Plus | Ganesmart (Full 5-Platform Architecture) |
| :--- | :--- | :--- |
| **Platform Coverage** | **2 internal systems:** Edunex + SIX (plus ITB's public `Kalender Pendidikan`). Completely blind to external communication channels. | **5 fragmented platforms:** Edunex, SIX, **Outlook Web**, **Microsoft Teams Web**, and **Google Classroom**—bridging official portals with lecturer emails and chat threads. |
| **Data Extraction Model** | **Rigid schema parsing:** Relies on structured JSON (`course/tasks`) and predictable SIX HTML table columns. Fails when lecturers post free-form announcements outside standard task fields. | **In-session DOM/API capture + AI normalization:** Reads structured JSON on Edunex and rendered DOM/HTML on SIX, Outlook, Teams, and Classroom, using **Gemini API** (with regex fallback) to extract dates from unstructured text. |
| **Authentication & OAuth Strategy** | Requires standalone desktop app sign-in using ITB **INA account** credentials. | **Zero-credential in-session collection:** Content scripts read open logged-in browser tabs—eliminating INA password entry *and* bypassing ITB Microsoft Entra ID third-party OAuth blocks and Google OAuth verification caps. |
| **Cross-Platform Deduplication** | Deduplicates exams across Edunex and SIX only (`UTS`/`UAS` matching). | **Cross-ecosystem deduplication:** Merges duplicate announcements when a lecturer posts the same deadline or file update across Edunex, Teams, Outlook, and Classroom into one unified feed card. |
| **Core Feature Philosophy** | **Deep portal replacement:** PDF/Word highlighting (`Sorotan`), page notes (`Catatanku`), live `Tandai Hadir` alerts, attendance budgets (`Kehadiran`), UKT bills, KRS, and GPA (`IP`/`IPK`). | **Zero-migration deadline radar:** Ignores grades, transcripts, UKT, and attendance counts; normalizes every source into `{ course, platform, title, deadline, urgency_rank, summary, original_url }`. |
| **Privacy & Data Minimization** | Stores notes and `Snooze`/`Handled` states locally; transmits scrubbed full-page HTML to a maintainer `Report relay` on parser failures and logs anonymized daily `Usage data`. | **Minimal-scope & ephemeral AI processing:** Never touches grades, NIM details, or submitted files. Sends only stripped announcement text to Gemini (discarded immediately after extraction) with local storage and one-click **Delete Everything**. |
| **Fallback Mechanism** | Maintainer-driven `fix-bot` patches code after users submit scrubbed HTML `Problem reports`. | **Instant user-driven fallback:** Universal paste/screenshot dropzone lets students extract deadlines immediately if a platform layout changes or when checking messages on mobile. |

---

## Four Core Differentiators Against Edunex Plus

### 1. Breaking the 2-System Wall (Where Deadlines Actually Get Missed)
Edunex Plus assumes all academic coordination lives inside Edunex and SIX. In reality, ITB lecturers routinely announce schedule shifts via **Outlook**, drop supplementary tasks in **Microsoft Teams** channels, or host entire courses on **Google Classroom**. Ganesmart captures all five in one urgency-ranked feed and deadline calendar.

### 2. AI Triage Over Rigid Schema Mapping
Edunex Plus is a deterministic reader: if a lecturer writes *"Quiz moved to Friday 19:00 on Teams"* inside a chat message or email body rather than creating an Edunex `Task`, Edunex Plus cannot see or parse it. Ganesmart uses **Gemini API** (backed by deterministic regex rules) to turn messy prose from Teams, Outlook, and Classroom into structured deadlines with urgency rankings.

### 3. Zero-Credential Onboarding & Enterprise OAuth Bypass
* **Psychological Trust:** Students never type their ITB INA, Microsoft, or Google passwords into Ganesmart. By running inside the browser tabs the student already has open, Ganesmart removes credential-entry anxiety while keeping sensitive academic records (grades, transcripts, submitted files) completely out of reach.
* **Technical Feasibility:** Because ITB's Microsoft Entra ID tenant restricts unverified third-party OAuth apps (blocking direct Graph API access for Outlook and Teams) and Google Classroom APIs impose strict unverified testing caps, in-session browser collection + manual paste fallback works immediately without waiting months for institutional admin approval.

### 4. Complementary Coexistence, Not Direct Redundancy
Students who want a heavy desktop replacement for SIX attendance, UKT invoices, and PDF slide annotation can still use Edunex Plus—while **Ganesmart** acts as the lightweight, cross-platform safety net that watches Edunex, SIX, Outlook, Teams, and Classroom simultaneously so no external deadline slips through the cracks.