<!--
WHAT:          JOB-category scorecard result, run "variantA2-pertitle-list-2026-11-08".
WHY:           proves (or disproves) that the live category AI files employer work as JOB without the name.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      GitHub Actions run 42488130980; produced by scripts/eval-job-category.mjs against http://localhost:8000 at 2026-11-08T14:14:36.201Z.
-->

# JOB category scorecard: variantA2-pertitle-list-2026-11-08

Parser: http://localhost:8000

**27 of 27 single-title rows pass** (3 runs each; (R) rows must be right every run, others at least 2 of 3).
**0 of 3 batch variants pass** (every gated line JOB on every run; B-bare/B-pref gate 17 lines, B-work all 23).

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
| B-bare-1 | Measure my panel | JOB (R) (no signal, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-bare-2 | Develop my panel | JOB (R) (no signal, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-bare-3 | Hang my panel on the wall | JOB (R) (no signal, not gated) | LIFE, LIFE, LIFE | 0/3 | miss |
| B-bare-4 | Clean my office | JOB (R) (no signal, not gated) | LIFE, LIFE, LIFE | 0/3 | miss |
| B-bare-5 | Update my LinkedIn job history and certificates | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-6 | Create two Trinnex images: About page and profile | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-bare-7 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-8 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-9 | Prepare an intro script and questions for introductory meetings | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-10 | Integrate Huddle with my diagram builder app | JOB (R) (own name hint, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-bare-11 | Test reading a repository and generating a set of professional-grade diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-12 | Create a Trinnex slide template for Claude and Copilot | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-13 | Create an AI scrum master setup to edit Jira | JOB (R) | JOB, JOB, VENTURES | 2/3 | FAIL |
| B-bare-14 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-15 | Research software-engineering metrics to track through Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-16 | Create a software-engineering organization maturity curve covering my departments | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-17 | Sign up for Aha! and create initial strategies | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-bare-18 | Sign up for an Esri developer account | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-19 | Prepare agendas for ally meetings to identify what they care about and how I can help | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-20 | Debug Huddle WIP end to end | JOB (R) (own name hint, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-bare-21 | Research and document what can be automated during Scrum/Kanban | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-22 | Research and document what can be automated throughout the SDLC | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-bare-23 | Design an SDLC app from my framework | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| **B-bare total** | no context | | | **14/17 gated** | |
| B-pref-1 | Measure my panel | JOB (R) (no signal, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-pref-2 | Develop my panel | JOB (R) (no signal, not gated) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-3 | Hang my panel on the wall | JOB (R) (no signal, not gated) | LIFE, LIFE, LIFE | 0/3 | miss |
| B-pref-4 | Clean my office | JOB (R) (no signal, not gated) | LIFE, LIFE, LIFE | 0/3 | miss |
| B-pref-5 | Update my LinkedIn job history and certificates | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-6 | Create two Trinnex images: About page and profile | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-pref-7 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-8 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-9 | Prepare an intro script and questions for introductory meetings | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-10 | Integrate Huddle with my diagram builder app | JOB (R) (own name hint, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-pref-11 | Test reading a repository and generating a set of professional-grade diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-12 | Create a Trinnex slide template for Claude and Copilot | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-13 | Create an AI scrum master setup to edit Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-14 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-15 | Research software-engineering metrics to track through Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-16 | Create a software-engineering organization maturity curve covering my departments | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-17 | Sign up for Aha! and create initial strategies | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-pref-18 | Sign up for an Esri developer account | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-19 | Prepare agendas for ally meetings to identify what they care about and how I can help | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-20 | Debug Huddle WIP end to end | JOB (R) (own name hint, not gated) | VENTURES, VENTURES, VENTURES | 0/3 | miss |
| B-pref-21 | Research and document what can be automated during Scrum/Kanban | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-22 | Research and document what can be automated throughout the SDLC | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-pref-23 | Design an SDLC app from my framework | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| **B-pref total** | context: "I have several priorities I need to work on today." | | | **15/17 gated** | |
| B-work-1 | Measure my panel | JOB (R) | JOB, VENTURES, JOB | 2/3 | FAIL |
| B-work-2 | Develop my panel | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-3 | Hang my panel on the wall | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-work-4 | Clean my office | JOB (R) | LIFE, LIFE, LIFE | 0/3 | FAIL |
| B-work-5 | Update my LinkedIn job history and certificates | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-6 | Create two Trinnex images: About page and profile | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-7 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-8 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-9 | Prepare an intro script and questions for introductory meetings | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-10 | Integrate Huddle with my diagram builder app | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-work-11 | Test reading a repository and generating a set of professional-grade diagrams | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-12 | Create a Trinnex slide template for Claude and Copilot | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-13 | Create an AI scrum master setup to edit Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-14 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-15 | Research software-engineering metrics to track through Jira | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-16 | Create a software-engineering organization maturity curve covering my departments | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-17 | Sign up for Aha! and create initial strategies | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-work-18 | Sign up for an Esri developer account | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-19 | Prepare agendas for ally meetings to identify what they care about and how I can help | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-20 | Debug Huddle WIP end to end | JOB (R) | VENTURES, VENTURES, VENTURES | 0/3 | FAIL |
| B-work-21 | Research and document what can be automated during Scrum/Kanban | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-22 | Research and document what can be automated throughout the SDLC | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| B-work-23 | Design an SDLC app from my framework | JOB (R) | JOB, JOB, JOB | 3/3 | PASS |
| **B-work total** | context: "These are my priorities for work today." | | | **17/23 gated** | |
