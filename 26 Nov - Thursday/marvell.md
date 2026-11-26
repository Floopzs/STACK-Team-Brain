# Thu 26 Nov — Marvell's context dump

## Done today
- **GitHub team brain set up:** one folder per day, `CONTEXT.md` in `25 Nov - Wednesday`, README explains how to use it with your AI.
- **Team files read:** name is **Ganesmart**, Hafidz is leader. `CONTEXT.md` updated with them.
- **Survey:** 39 responses so far. Target is about 100, spread across faculties.
- **Extension → dashboard link works:** the dashboard shows real data, each item with a link to its source.
- **Rasha's V2 (22:29):** first Teams reader (Assignments tab), SIX calendar reader with jump-to-class, time-range picker in the popup. Edunex still reads the screen.
- **Direct Edunex sync (PR #1):** on hold. We're building from Rasha's V2 instead.

## V2 issues found
- The SIX link breaks if the timetable tab isn't open, because the NIM gets stripped.
- Unknown courses show up as "Academic Course".
- Teams misses cards you haven't scrolled to.
- The popup's privacy text is outdated (it says it never touches the login session).

## Decisions and insights
- **Key pain point:** Edunex parent class vs normal class show the same assignment, so you can't tell where to submit. Ganesmart should merge them into one item and link to the right class.
- **Competitor Edunex Plus** already merges Edunex + SIX. **Our edge:** no app to install or sideload, no separate login, no server storage. Plus Teams/Outlook/Classroom, Gemini, and the Tandai Hadir alert. Caveat: Chrome extensions don't run on phones.
- **Gemini plan (later):** Cloudflare Worker proxy with a free key. Rules handle dedupe, overdue items and sorting first.
- **Feature brainstorm done:** the ideas doc is now a table (Useful / Feasible / Privacy, Effort, When, Owner, Status).
- **Rule:** ask Marvell before changing the repo.

## Still open
- Test V2 on real accounts.
- Fix the popup wording.
- Write the proposal sections.
