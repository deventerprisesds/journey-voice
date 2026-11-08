<!--
WHAT:          dedup replay of the 2026-11-07 duplicates, run "2026-11-08".
WHY:           regression check on the owner's live dedup setting (ON since 2026-11-08): catches, and false merges.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      produced by scripts/replay-task-dedup.mjs at 2026-11-08T13:54:04.301Z.
-->

# Dedup replay of 11-07: 2026-11-08

- Live config: `{"enabled":true}` -> enabled=true, high=0.9, possible=0.8, semantic=true
- Open tasks predating the incident (current state): 62
- **Repeats caught (skipped, correct target): 23 of 37**; created but flagged possible-duplicate: 12
- **False merges / wrong-target merges / call-1 matches to review: 1**
  - call 1 "Sign up for an Esri developer account" duplicate ~ older task "Sign up for Esri developer account"

| call | candidate (parsed title) | decision | matched | sim | sim to the line it restates | verdict |
|---|---|---|---|---|---|---|
| 1 | Measure my panel | unique |  |  |  | kept (correct) |
| 1 | Develop my panel | unique |  |  |  | kept (correct) |
| 1 | Hang my panel on the wall | unique |  |  |  | kept (correct) |
| 1 | Clean my office | unique |  |  |  | kept (correct) |
| 1 | Update my LinkedIn job history and certificates | unique |  |  |  | kept (correct) |
| 1 | Create two Trinnex images: About page and profile | unique |  |  |  | kept (correct) |
| 1 | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | unique |  |  |  | kept (correct) |
| 1 | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | unique |  |  |  | kept (correct) |
| 1 | Prepare an intro script and questions for introductory meetings | unique |  |  |  | kept (correct) |
| 1 | Integrate Huddle with my diagram builder app | unique |  |  |  | kept (correct) |
| 1 | Test reading a repository and generating a set of professional-grade diagrams | unique |  |  |  | kept (correct) |
| 1 | Create a Trinnex slide template for Claude and Copilot | unique |  |  |  | kept (correct) |
| 1 | Create an AI scrum master setup to edit Jira | unique |  |  |  | kept (correct) |
| 1 | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | unique |  |  |  | kept (correct) |
| 1 | Research software-engineering metrics to track through Jira | unique |  |  |  | kept (correct) |
| 1 | Create a software-engineering organization maturity curve covering my departments | unique |  |  |  | kept (correct) |
| 1 | Sign up for Aha! and create initial strategies | unique |  |  |  | kept (correct) |
| 1 | Sign up for an Esri developer account | duplicate (signature) | Sign up for Esri developer account |  |  | duplicate vs an OLDER open task -- review |
| 1 | Prepare agendas for ally meetings to identify what they care about and how I can help | unique |  |  |  | kept (correct) |
| 1 | Debug Huddle WIP end to end | unique |  |  |  | kept (correct) |
| 1 | Research and document what can be automated during Scrum/Kanban | unique |  |  |  | kept (correct) |
| 1 | Research and document what can be automated throughout the SDLC | unique |  |  |  | kept (correct) |
| 1 | Design an SDLC app from my framework | unique |  |  |  | kept (correct) |
| 2 | Create Trinnex image for About page | possible (semantic) | Create two Trinnex images: About page and profile | 0.8713 | 0.871 | created + flagged possible-duplicate |
| 2 | Create Trinnex image for Profile | possible (semantic) | Create two Trinnex images: About page and profile | 0.8306 | 0.831 | created + flagged possible-duplicate |
| 2 | Research using Copilot with email and calendar | possible (semantic) | Research how to use Copilot with email and calendar access to create custom scheduled and triggered tasks | 0.8232 | 0.823 | created + flagged possible-duplicate |
| 2 | Develop weekly tasks from 30/60/90 plan | possible (semantic) | Translate my 30/60/90 plan into weekly tasks on a rolling week-to-week schedule | 0.8397 | 0.840 | created + flagged possible-duplicate |
| 2 | Prepare intro script for meetings | possible (semantic) | Prepare an intro script and questions for introductory meetings | 0.853 | 0.853 | created + flagged possible-duplicate |
| 2 | Test reading a repo for diagrams | possible (semantic) | Test reading a repository and generating a set of professional-grade diagrams | 0.8269 | 0.827 | created + flagged possible-duplicate |
| 2 | Enable AI scrum master for estimates | possible (semantic) | Enable the AI scrum master to estimate points and track actuals to improve estimates over time | 0.8469 | 0.847 | created + flagged possible-duplicate |
| 2 | Research software engineering metrics for Jira | duplicate (semantic) | Research software-engineering metrics to track through Jira | 0.9499 | 0.950 | caught (correct) |
| 2 | Create maturity curve for software engineering organization | possible (semantic) | Create a software-engineering organization maturity curve covering my departments | 0.8567 | 0.857 | created + flagged possible-duplicate |
| 2 | Sign up for Aha! | unique |  |  | 0.775 | missed (created again) |
| 2 | Debug WIP in Huddle end to end | duplicate (signature) | Debug Huddle WIP end to end |  | 0.921 | caught (correct) |
| 3 | Prepare intro scripts for meetings | duplicate (semantic) | Prepare intro script for meetings | 0.9674 | 0.853 | caught (correct) |
| 3 | Define software engineering maturity curve | possible (semantic) | Create maturity curve for software engineering organization | 0.8168 | 0.793 | created + flagged possible-duplicate |
| 3 | Debug WIP in Huddle end to end | duplicate (signature) | Debug Huddle WIP end to end |  | 0.921 | caught (correct) |
| 4 | Prepare intro script for meetings | duplicate (signature) | Prepare intro script for meetings |  | 0.853 | caught (correct) |
| 4 | Prepare agendas for ally meetings | possible (semantic) | Prepare agendas for ally meetings to identify what they care about and how I can help | 0.8409 | 0.841 | created + flagged possible-duplicate |
| 5 | Walk backwards from 30/60/90 to weekly tasks | unique |  |  | 0.722 | missed (created again) |
| 5 | Research metrics to track through Jira for software engineering | duplicate (signature) | Research software-engineering metrics to track through Jira |  | 0.913 | caught (correct) |
| 6 | Measure my panel | duplicate (signature) | Measure my panel |  | 1.000 | caught (correct) |
| 6 | Create two Trinnex images for About page and profile | duplicate (signature) | Create two Trinnex images: About page and profile |  | 0.967 | caught (correct) |
| 6 | Research using Copilot with email and calendar | duplicate (signature) | Research using Copilot with email and calendar |  | 0.823 | caught (correct) |
| 6 | Walk backward from 30/60/90-day plan to weekly tasks | duplicate (semantic) | Walk backwards from 30/60/90 to weekly tasks | 0.9006 | 0.778 | caught (correct) |
| 6 | Prepare intro scripts and questions for meetings | duplicate (semantic) | Prepare an intro script and questions for introductory meetings | 0.9356 | 0.936 | caught (correct) |
| 6 | Integrate Huddle with diagram-builder app | duplicate (signature) | Integrate Huddle with my diagram builder app |  | 0.962 | caught (correct) |
| 6 | Test reading a repository and generating diagrams | duplicate (semantic) | Test reading a repository and generating a set of professional-grade diagrams | 0.9271 | 0.927 | caught (correct) |
| 6 | Create AI scrum master setup for Jira | duplicate (semantic) | Create an AI scrum master setup to edit Jira | 0.9416 | 0.942 | caught (correct) |
| 6 | Enable AI scrum master to estimate story points | possible (semantic) | Enable AI scrum master for estimates | 0.8537 | 0.827 | created + flagged possible-duplicate |
| 6 | Establish software-engineering maturity curve | duplicate (semantic) | Define software engineering maturity curve | 0.935 | 0.849 | caught (correct) |
| 6 | Sign up for Aha! and define strategies | duplicate (semantic) | Sign up for Aha! and create initial strategies | 0.9362 | 0.936 | caught (correct) |
| 6 | Debug Huddle's WIP flow end to end | duplicate (semantic) | Debug Huddle WIP end to end | 0.916 | 0.916 | caught (correct) |
| 6 | Design SDLC app based on my framework | duplicate (semantic) | Design an SDLC app from my framework | 0.9404 | 0.940 | caught (correct) |
| 7 | Create Trinnex image for About page | duplicate (signature) | Create Trinnex image for About page |  | 0.871 | caught (correct) |
| 7 | Create Trinnex image for profile | duplicate (signature) | Create Trinnex image for Profile |  | 0.838 | caught (correct) |
| 7 | Break down 30/60/90-day plan into weekly tasks | possible (semantic) | Develop weekly tasks from 30/60/90 plan | 0.8754 | 0.846 | created + flagged possible-duplicate |
| 7 | Enable AI scrum master for story points estimation | duplicate (semantic) | Enable AI scrum master to estimate story points | 0.9648 | 0.818 | caught (correct) |
| 7 | Research software-engineering metrics for Jira | duplicate (semantic) | Research software-engineering metrics to track through Jira | 0.9589 | 0.959 | caught (correct) |
| 7 | Prepare agendas for ally meetings | duplicate (signature) | Prepare agendas for ally meetings |  | 0.841 | caught (correct) |
