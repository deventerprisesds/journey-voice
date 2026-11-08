<!--
WHAT:          JOB-category scorecard result, run "baseline-live-2026-11-08".
WHY:           proves (or disproves) that the live category AI files employer work as JOB without the name.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      GitHub Actions run 42485063427; produced by scripts/eval-job-category.mjs against https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/ai-task-parser at 2026-11-08T13:34:14.716Z.
-->

# JOB category scorecard: baseline-live-2026-11-08

Parser: https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/ai-task-parser

**27 of 27 single-title rows pass** (3 runs each; (R) rows must be right every run, others at least 2 of 3).
**0 of 2 batch variants pass** (all 23 lines JOB on every run).

| # | Title | Expected | Got (per run) | Right | Verdict |
|---|---|---|---|---|---|
| E-1 | Complete benefits enrollment | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-2 | Prep for my team's standup | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-3 | Create a visual for my SDLC workflow | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-4 | Finalize ops deck | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-5 | Finalize ops process diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-6 | Build an Esri GIS layer for the water main inventory | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-7 | Update the Power BI dashboard for the weekly ops review | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-8 | Submit Trinnex timesheet | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-9 | 1:1 with my manager | JOB | JOB, JOB, JOB | 3/3 | PASS |
| E-10 | Reply to Trinnex client about the asset inventory | JOB | JOB, JOB, JOB | 3/3 | PASS |
| E-11 | Document the release checklist for the SDLC pipeline at work | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| E-12 | Update my LinkedIn headline | CAREER (R) | CAREER, CAREER, CAREER | 3/3 | PASS |
| E-13 | Apply for the Director of Data role at Acme | CAREER (R) | CAREER, CAREER, CAREER | 3/3 | PASS |
| E-14 | Session with my career coach | CAREER (R) | CAREER, CAREER, CAREER | 3/3 | PASS |
| E-15 | Prep for interview with the Esri recruiter | CAREER | CAREER, CAREER, CAREER | 3/3 | PASS |
| E-16 | Ship Huddle push notifications | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-17 | Fix the Nexus login bug | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-18 | Send the Howard County proposal | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-19 | Draft the Boost pitch deck | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-20 | Email Prompto beta testers | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-21 | Write the SDLC doc for Sidecar | VENTURES (R) | VENTURES, VENTURES, VENTURES | 3/3 | PASS |
| E-22 | Prepare slides for client meeting | JOB | JOB, JOB, JOB | 3/3 | PASS |
| E-23 | Take a Power BI course on Coursera | EDUCATION | EDUCATION, EDUCATION, EDUCATION | 3/3 | PASS |
| E-24 | Complete MIT assignment 3 | PROF_EDUCATION | PROF_EDUCATION, PROF_EDUCATION, PROF_EDUCATION | 3/3 | PASS |
| E-25 | Pick up groceries | LIFE | LIFE, LIFE, LIFE | 3/3 | PASS |
| E-26 | Pay the credit card bill | LIFE | LIFE, LIFE, LIFE | 3/3 | PASS |
| E-27 | Work on my SDLC app | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |

## Batch rows (the 11-07 23-line call, one multiple-mode call per run)

| # | Line | Expected | Got (per run) | Right | Verdict |
|---|---|---|---|---|---|
| B-bare-1 | Measure my panel | JOB (R) | JOB, VENTURES, VENTURES | 1/3 | FAIL |
| B-bare-2 | Develop my panel | JOB (R) | JOB, VENTURES, VENTURES | 1/3 | FAIL |
| B-bare-3 | Hang my panel on the wall | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-bare-4 | Clean my office | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-bare-5 | Update my LinkedIn job history and certificates | JOB (R) | CAREER, CAREER, CAREER | 0/3 | FAIL |
| B-bare-6 | Create two Trinnex images: About page and profile | JOB (R) | JOB, VENTURES, VENTURES | 1/3 | FAIL |
| B-bare-7 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | JOB (R) | JOB, EDUCATION, EDUCATION | 1/3 | FAIL |
| B-bare-8 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-9 | Prepare an intro script and questions for introductory meetings | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-10 | Integrate Huddle with my diagram builder app | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-bare-11 | Test reading a repository and generating a set of professional-grade diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-12 | Create a Trinnex slide template for Claude and Copilot | JOB (R) | JOB, VENTURES, VENTURES | 1/3 | FAIL |
| B-bare-13 | Create an AI scrum master setup to edit Jira | JOB (R) | JOB, VENTURES, JOB | 2/3 | FAIL |
| B-bare-14 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | JOB (R) | JOB, VENTURES, JOB | 2/3 | FAIL |
| B-bare-15 | Research software-engineering metrics to track through Jira | JOB (R) | JOB, EDUCATION, EDUCATION | 1/3 | FAIL |
| B-bare-16 | Create a software-engineering organization maturity curve covering my departments | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-17 | Sign up for Aha! and create initial strategies | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-bare-18 | Sign up for an Esri developer account | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-bare-19 | Prepare agendas for ally meetings to identify what they care about and how I can help | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-20 | Debug Huddle WIP end to end | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-21 | Research and document what can be automated during Scrum/Kanban | JOB (R) | JOB, EDUCATION, EDUCATION | 1/3 | FAIL |
| B-bare-22 | Research and document what can be automated throughout the SDLC | JOB (R) | JOB, EDUCATION, EDUCATION | 1/3 | FAIL |
| B-bare-23 | Design an SDLC app from my framework | JOB (R) | JOB, VENTURES, VENTURES | 1/3 | FAIL |
| **B-bare total** | no context | | | **6/23** | |
| B-ctx-1 | Measure my panel | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-2 | Develop my panel | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-3 | Hang my panel on the wall | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-ctx-4 | Clean my office | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-ctx-5 | Update my LinkedIn job history and certificates | JOB (R) | CAREER, CAREER, CAREER | 0/3 | FAIL |
| B-ctx-6 | Create two Trinnex images: About page and profile | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-7 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | JOB (R) | JOB, JOB, EDUCATION | 2/3 | FAIL |
| B-ctx-8 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-9 | Prepare an intro script and questions for introductory meetings | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-10 | Integrate Huddle with my diagram builder app | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-11 | Test reading a repository and generating a set of professional-grade diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-12 | Create a Trinnex slide template for Claude and Copilot | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-13 | Create an AI scrum master setup to edit Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-14 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-15 | Research software-engineering metrics to track through Jira | JOB (R) | JOB, JOB, EDUCATION | 2/3 | FAIL |
| B-ctx-16 | Create a software-engineering organization maturity curve covering my departments | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-17 | Sign up for Aha! and create initial strategies | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-18 | Sign up for an Esri developer account | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-ctx-19 | Prepare agendas for ally meetings to identify what they care about and how I can help | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-20 | Debug Huddle WIP end to end | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-ctx-21 | Research and document what can be automated during Scrum/Kanban | JOB (R) | JOB, JOB, EDUCATION | 2/3 | FAIL |
| B-ctx-22 | Research and document what can be automated throughout the SDLC | JOB (R) | JOB, JOB, EDUCATION | 2/3 | FAIL |
| B-ctx-23 | Design an SDLC app from my framework | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| **B-ctx total** | context: "I have several priorities I need to work on today." | | | **8/23** | |
