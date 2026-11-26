# Edunex Plus vs. Ganesmart (Current Prototype State)

## Executive Summary

Right now, your teammate's Chrome extension (`ganesmart-extension/`) scrapes live assignment rows from **Edunex** (`https://edunex.itb.ac.id/`) and feeds them into your local-first dashboard (`index.html`), while **SIX, Outlook, Teams, and Google Classroom** are only supported via manual text paste or simulated payloads.

Because live automated scraping is currently limited to Edunex, **Ganesmart's current prototype overlaps directly with Edunex Plus's home turf**—but with a radically different philosophy: **zero-credential onboarding, minimal data scope, and AI/rule-based deadline triage** rather than full portal replacement.

---

## Side-by-Side Comparison (Current Built State)

| Dimension | Edunex Plus | Ganesmart (Current Prototype) |
| :--- | :--- | :--- |
| **Live Automated Coverage** | **2 systems + public calendar:** Full automated reading of Edunex API, SIX HTML pages (`/home`, `/kelas`, grades, attendance, UKT), and ITB's `Kalender Pendidikan`. | **1 live system + manual paste:** Live DOM extraction on Edunex (`Unanswered` assignments + `/assignment/take/<id>` deep links); manual paste/payload simulation for SIX, Teams, Outlook, and Classroom. |
| **Onboarding & User Psychology** | **Standalone desktop app with sign-in:** Requires installing a cross-platform desktop client and signing in with your ITB **INA account** credentials. | **Zero-credential onboarding:** Chrome Manifest V3 extension piggybacks on an already logged-in browser tab. Students never enter their INA password into a third-party app, eliminating credential-entry anxiety. |
| **Product Scope** | **Full academic workstation:** Replaces portal browsing with PDF/Word highlighting (`Sorotan`), page notes (`Catatanku`), attendance tracking (`Kehadiran` / `Tandai Hadir` alerts), UKT bills, KRS, and GPA (`IP`/`IPK`). | **Lightweight deadline radar:** Strips away grades (`Score` explicitly ignored), transcripts, attendance counts, and UKT bills—surfacing only course, title, start/due dates, urgency rank, and direct action links. |
| **Parsing & Intelligence** | **Deterministic schema mapping (no AI):** Maps rigid Edunex JSON entities (`course/tasks`, `Handed back`, `Catatan dosen`) and SIX HTML tables directly to UI screens. | **Hybrid AI + deterministic fallback:** Uses ephemeral per-snippet **Gemini API** extraction paired with a rule-based regex parser and duplicate-title merging (`updates merged` counter). |
| **Data Privacy & Storage** | Local-first storage for notes and `Snooze`/`Handled` states; scrubs HTML before sending `Problem reports` to a maintainer relay and logs anonymized daily `Usage data`. | **Strict minimal-data policy:** Never touches grades, NIM details, or submitted files. Keeps stripped deadline items locally in `chrome.storage` / `localStorage` with one-click **Delete Everything** and zero usage telemetry. |
| **Distribution** | Packaged desktop installers with automated GitHub `fix-bot` workflows for portal layout drift. | Unpacked Chrome Extension (Manifest V3) + static/responsive web dashboard (`HTML + Tailwind + Vanilla JS`). |

---

## Honest Gap Analysis (Current State)

### Where Edunex Plus Currently Leads
* **Live Multi-Portal Depth:** Edunex Plus already pulls live SIX timetables, attendance thresholds (`Kehadiran`), UKT invoices, and Edunex lecturer feedback (`Catatan dosen` / `Komentar`), whereas Ganesmart's current extension only reads Edunex's unsubmitted assignment table.
* **Resilience to Portal Drift:** Edunex Plus has dedicated `Changed page` / `Unrecognised row` handling and a `Report relay` + `fix-bot` pipeline; Ganesmart's current `content.js` relies on specific Edunex table CSS classes (`tr-values vs-table--tr`) plus manual paste fallback.

### Where Ganesmart's Current Prototype Already Wins
* **Psychological Trust & Zero Password Entry:** Many students hesitate to enter their central ITB INA credentials into an unofficial desktop executable. Piggybacking on an existing Chrome tab lets skeptical students verify what data leaves their browser without handing over login credentials.
* **Noise & Anxiety Reduction:** By intentionally ignoring `Score`, `Submitted` rows, and administrative clutter, Ganesmart solves immediate deadline triage rather than acting as a heavy secondary portal.
* **Unstructured Text Readiness:** Unlike Edunex Plus's rigid table parsers, Ganesmart's Gemini + regex pipeline is already built to ingest messy, pasted text from outside ITB's walls—setting the foundation for Teams, Outlook, and Classroom.

---

## How to Frame This for STACK 2026 (Built vs. Planned)

1. **Never claim Ganesmart currently out-features Edunex Plus on SIX or Edunex internals.** Judges familiar with ITB student tools will immediately spot the difference.
2. **Highlight the architectural & psychological distinction:** Pitch the current prototype as proof of a **zero-credential, privacy-first triage engine** that already works live on Edunex without asking for INA passwords, while demonstrating cross-platform AI normalization via the dashboard's paste/simulation pipeline.