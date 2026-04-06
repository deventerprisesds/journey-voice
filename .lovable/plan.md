

# Fix CSV Parsing, Date Transfer, and Duplicate Data

## Root Cause Analysis

Three compounding bugs are destroying the assignment data:

### 1. Broken CSV parsing
Both sync functions use naive `line.split(',')` to parse CSV. Google Sheets CSV exports quote fields that contain commas (titles like `"Read: ""Digital Transformation Playbook"" by David Roger"`, descriptions, dates like `"April 5, 2025"`). The naive split breaks these into wrong columns, corrupting title, date, and every field after.

### 2. Date parsing garbage
Even when the date column is reached correctly, `new Date(dueDateStr)` is unreliable for partial/mangled strings. The DB confirms dates like `2001-01-01` stored for assignments that should have real dates — the "Dec 31, 2000" shown in the UI is this bad parse displayed.

### 3. No duplicate protection
There is no unique constraint on `(user_id, sheet_row_number)`. The code uses `.maybeSingle()` to check for existing rows, but once duplicates exist from prior runs, `maybeSingle()` throws on multiple results, and the error is swallowed — creating yet another duplicate. The DB currently has **1,386 rows for only 442 unique titles** (11 duplicates per row from ~11 sync runs).

## Fix

### Step 1: Replace naive CSV split with proper parsing

Both `sync-google-sheets/index.ts` and `sync-mit-sheets/index.ts` need a real CSV field parser that handles:
- Quoted fields containing commas: `"April 5, 2025"` stays as one field
- Escaped quotes within fields: `""Digital Transformation""` becomes `"Digital Transformation"`
- Multiline fields (rare but possible)

Implementation: a small `parseCSVLine(line)` helper that walks characters, tracking quote state.

### Step 2: Robust date parsing

Replace `new Date(dueDateStr)` with explicit format handling:
- Try `MM/DD/YYYY`, `M/D/YYYY`, `YYYY-MM-DD`, `Month D, YYYY`, `M/D/YY`
- Reject dates that parse to before 2020 (no legitimate assignment is from 2001)
- Log unparseable dates for debugging instead of silently storing garbage

### Step 3: Deduplicate on sync

Before inserting, enforce uniqueness:
- Change the existing-row lookup from `.maybeSingle()` to `.limit(1).maybeSingle()` or use `.select().limit(1)` so it never throws on duplicates
- Before the sync loop, delete all duplicate rows per `(user_id, sheet_row_number)` keeping only the most recently updated one
- Add a unique index on `(user_id, sheet_row_number)` via migration for both `assignments` and `assignments_mit`

### Step 4: Clean up existing garbage data

Run a data cleanup:
- Delete duplicate assignment rows, keeping one per `(user_id, sheet_row_number)`
- This reduces 1,386 rows to the correct ~130-200

### Step 5: Remove repair button

Remove the `Wrench` button, `isRepairing` state, and `handleRepair` from `src/pages/Assignments.tsx` as previously discussed.

## Files changed

| File | Change |
|------|--------|
| `supabase/functions/sync-google-sheets/index.ts` | Proper CSV parser, robust date parsing, dedup-safe lookup |
| `supabase/functions/sync-mit-sheets/index.ts` | Same fixes |
| `supabase/migrations/[timestamp]_assignment_dedup.sql` | Unique index on `(user_id, sheet_row_number)` for both tables; delete duplicate rows |
| `src/pages/Assignments.tsx` | Remove repair button/state/handler |

## Technical detail: CSV parser

```text
Input:  Read: ""Digital Transformation Playbook""," April 5, 2025",Strategic IT
Naive split: ["Read: ""Digital Transformation Playbook""", " April 5", " 2025\"", "Strategic IT"]
                                                           ^^^^^^^^   ^^^^^^^
                                                           date broken into 2 fields

Proper parse: ["Read: \"Digital Transformation Playbook\"", "April 5, 2025", "Strategic IT"]
```

## Technical detail: date parser

```text
Input strings to handle:
  "4/5/2025"       → 2025-04-05
  "April 5, 2025"  → 2025-04-05
  "2025-04-05"     → 2025-04-05
  "4/5/25"         → 2025-04-05
  ""               → null
  garbage          → null (logged)
```

