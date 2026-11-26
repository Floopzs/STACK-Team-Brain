# STACK 2026 — Team Context (as of Thu 26 Nov)

**Team "i'm stacking it":** Hafidz (Akemi), Marvell, Shakila, Rasha
**Event:** STACK 2026 by GDGoC ITB, Case 1: Smarter Campus and Learning
**Stage:** Semifinal. Our abstract scored 94/100. We lost 1 point on Problem Clarity because our evidence was anecdotal and we had no data of our own, which the survey fixes.

## The product
A web dashboard that pulls course deadlines and announcements from Edunex, SIX, Teams, Outlook and Google Classroom into one place.
- The user installs a **browser extension**. It uses their existing login session to read the data and sends it to the **dashboard website**.
- **Gemini API** extracts, ranks and dedupes deadlines from announcement text.
- **Feasibility:** Edunex and SIX are confirmed working. Teams is being tested. Outlook and Classroom are not confirmed yet.
- **Name:** not decided. GaneSmart is a candidate, and we want something that isn't ITB-specific.

## Data policy (decided)
- We pull only the course name, item title, due/posted date and source link.
- The login token is used only inside the browser. It is never stored and never sent to our server or to Gemini.
- We never touch passwords, grades, student IDs, submissions or private messages.
- Data is stored locally by default, and the user can view and delete all of it.
- Gemini gets only announcement text, and nothing is stored there.

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
- **Thu 26:** survey running, connect the extension to the dashboard
- **Fri 27:** finish the extension → dashboard link
- **Sat 28:** close the survey, get a working demo with real data, take screenshots
- **Sun 29:** write the evidence sections and the video script, record the video
- **Mon 30:** review, Hafidz signs the declaration, submit around 20:00

## Proposal status
Done: identity block, 2.1 problem context, 2.2 target users.
Can be written now: roles, alternatives, solution, features and architecture, privacy, milestones, risks, AI disclosure.
Blocked: survey results (evidence), prototype screenshots, signed declaration.

## Rules from the judges
- Target one specific user group.
- Don't present planned features as finished.
- Don't invent data, and label any estimates.

## Shared files
- Proposal draft (Google Doc) and the Team Brain doc, which has one table per day for updates. Upload files to the "Team Brain files" Drive folder.
