<!--
WHAT:          JOB-category scorecard results on the LIVE ai-task-parser, three runs on 2026-11-04.
WHY:           proves (or disproves) that the deployed category AI files employer work as JOB without the name,
               and records the one miss and how the owner's re-ruling resolved it.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      GitHub Actions eval-job-category.yml runs 41871280229, 41876505166, 41889221051 (job logs carry the
               full per-row table between ----- EVAL REPORT ----- markers). 3 calls per title, parse-only path.
-->

# JOB category scorecard: live runs, 2026-11-04

| Run | Code on main | Result | E-21 "Write the SDLC doc for Sidecar" |
|---|---|---|---|
| 41871280229 | #80 (7dad873) | **26 / 27** | expected JOB; got VENTURES, VENTURES, VENTURES -- FAIL |
| 41876505166 | #86 (44b0b59): hint header says SDLC rule wins | **26 / 27** | expected JOB; got JOB, JOB, VENTURES -- FAIL |
| 41889221051 | #89 (d25124e): owner re-ruled E-21 to VENTURES (named own product beats the SDLC default) | **27 / 27** | expected VENTURES; got VENTURES, VENTURES, VENTURES -- PASS |

Final run (41889221051), every row 3/3:

| # | Title | Expected | Got |
|---|---|---|---|
| E-1 | Complete benefits enrollment | JOB (R) | JOB, JOB, JOB |
| E-2 | Prep for my team's standup | JOB (R) | JOB, JOB, JOB |
| E-3 | Create a visual for my SDLC workflow | JOB (R) | JOB, JOB, JOB |
| E-4 | Finalize ops deck | JOB (R) | JOB, JOB, JOB |
| E-5 | Finalize ops process diagrams | JOB (R) | JOB, JOB, JOB |
| E-6 | Build an Esri GIS layer for the water main inventory | JOB (R) | JOB, JOB, JOB |
| E-7 | Update the Power BI dashboard for the weekly ops review | JOB (R) | JOB, JOB, JOB |
| E-8 | Submit Trinnex timesheet | JOB (R) | JOB, JOB, JOB |
| E-9 | 1:1 with my manager | JOB | JOB, JOB, JOB |
| E-10 | Reply to Trinnex client about the asset inventory | JOB | JOB, JOB, JOB |
| E-11 | Document the release checklist for the SDLC pipeline at work | JOB (R) | JOB, JOB, JOB |
| E-12 | Update my LinkedIn headline | CAREER (R) | CAREER, CAREER, CAREER |
| E-13 | Apply for the Director of Data role at Acme | CAREER (R) | CAREER, CAREER, CAREER |
| E-14 | Session with my career coach | CAREER (R) | CAREER, CAREER, CAREER |
| E-15 | Prep for interview with the Esri recruiter | CAREER | CAREER, CAREER, CAREER |
| E-16 | Ship Huddle push notifications | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-17 | Fix the Nexus login bug | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-18 | Send the Howard County proposal | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-19 | Draft the Boost pitch deck | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-20 | Email Prompto beta testers | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-21 | Write the SDLC doc for Sidecar | VENTURES (R) | VENTURES, VENTURES, VENTURES |
| E-22 | Prepare slides for client meeting | JOB | JOB, JOB, JOB |
| E-23 | Take a Power BI course on Coursera | EDUCATION | EDUCATION, EDUCATION, EDUCATION |
| E-24 | Complete MIT assignment 3 | PROF_EDUCATION | PROF_EDUCATION x3 |
| E-25 | Pick up groceries | LIFE | LIFE, LIFE, LIFE |
| E-26 | Pay the credit card bill | LIFE | LIFE, LIFE, LIFE |
| E-27 | Work on my SDLC app | JOB (R) | JOB, JOB, JOB |

## RESULTS (pre-registered pass bar: AC-D9)
- Bar: (R) rows right on every run; other rows at least 2 of 3. Final run meets it on all 27 rows.
- The E-21 expectation changed by OWNER RULING (2026-11-04), not to make the test pass: "that is a case where it
  is not a work related item and a side project so venture is fine." Runs 1-2 are kept above as the record.
- Live sync check (same day): a `Test-JOB sync check` task saved as JOB in journey appeared in Huddle's mirror as
  JOB, was deleted, 0 rows left; the owner's 5 re-filed tasks read JOB in both stores.
