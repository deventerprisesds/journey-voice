

The user wants to verify EMBA assignment data integrity in the DB before any scheduling work. Read-only query to dump all `assignments` rows for the dev user.

## Plan

1. Query `assignments` table for dev user `a3378f93-d655-4913-b2fa-ca5b1d8020f1` — all columns, all rows, ordered by due_date.
2. Also report:
   - Total row count
   - Distinct `course` / `source` values
   - Date range (min/max `due_date`)
   - Status breakdown
   - Recently created rows (last sync window)
3. Cross-check with `assignments_mit` row count for context.
4. Present results as a table the user can compare against the source spreadsheet.

If gaps are found, next step will be to inspect the sync source (`sync-google-sheets` edge function) and the spreadsheet ingestion path. No DB writes in this pass.

