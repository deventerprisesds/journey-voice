# journey-voice accuracy log

One row per wrong-first-answer: the claim, the ground truth, the single source that would have
settled it up front, the root-cause pattern, and the guard it implies.

---

## 2026-10-08 — "the 11 category-status rows render in no lane"

**The claim I made.** Eleven `public.tasks` rows carry a status drawn from the category enum
(`VENTURES`, `CAREER`, `LIFE`, `PROF_EDUCATION`). I reported that no board column renders them, so
they were invisible and a cleanup UPDATE was purely corrective.

**The ground truth.** Wrong on one of the two board surfaces. `Dashboard.tsx:278` renders
`<KanbanBoard>` **without** the `useStandardColumns` prop, which defaults to `false`
(`KanbanBoard.tsx:104`), so that surface reads its lanes from the live `public.columns` table
rather than from the hardcoded `STANDARD_COLUMNS`. Migration
`20250925163916_5fa170e3-f6ab-4512-acdc-59a3454772c9.sql` seeded that table with lanes literally
named **Career / Prof. Education / Ventures / Planning**, and `20250925195628` added **Life**. In
that generation of the board a category-shaped status IS a legitimate lane. Only `TasksPage` →
`TabbedKanbanBoard` normalises them away, and it does so in memory
(`TabbedKanbanBoard.tsx:22-37`), never in the database.

**The single source that would have settled it.** `public.columns` — the table that DEFINES the
lanes — plus the prop defaults at each `<KanbanBoard>` call site. I had read the hardcoded
`STANDARD_COLUMNS` array and the one component that repairs the data, and generalised from those
two to "no lane renders them". The table that actually decides was never opened.

**Root-cause pattern.** *Answered from the consumers I happened to find, not from the thing that
defines the answer.* The same shape as resolving a field's correctness by comparing two derived
fields. Reading the renderer told me how one surface draws lanes; it could not tell me what the
lanes ARE. Compounded by a default-valued prop: `useStandardColumns` is absent at the Dashboard
call site, so the behaviour that differs is invisible in a grep for the flag's name — it only shows
up by reading the signature's default.

**Caught by.** The owner, directly: *"Have you looked at the journey views to confirm the columns
value of education doesn't point to the status column being used in a way status wouldn't usually
be used?"* Asked before the UPDATE ran, which is the only reason it cost nothing.

**Guard it implies.** Two, and the second is the general one:

1. **Before any claim that a row is invisible, read the table or constant that DEFINES the
   surface's buckets** — not a component that consumes them. For this board that is
   `public.columns`, and it is per-board data, not code.
2. **A boolean prop that changes behaviour and has a default is a second code path that greps
   invisibly.** When a component's behaviour forks on a prop, enumerate the call sites and resolve
   each one's EFFECTIVE value including the default, rather than grepping for the prop name — a
   call site that omits it will not appear in the results at all.

**Status of the work.** The code fix (PR #28) is unaffected and shipped as-is: `BACKLOG` is also a
seeded lane on that board (`20250925200403`), so writing `BACKLOG`/`UP_NEXT` renders correctly on
both surfaces regardless. The 11-row data cleanup is **held**, pending a read of what
`public.columns` contains today.
