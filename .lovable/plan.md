

# Add Meetings & Assignments Tabs to Weekly Agenda View

## What Changes

Add a tabbed interface to the Weekly Agenda view with three tabs:
1. **Agenda** (default) — the existing weekly task view, unchanged
2. **Meetings** — shows only external calendar events for the week, grouped by day
3. **Assignments** — shows assignment-sourced tasks: "Up Next" (due within 2 weeks) at top, then remaining grouped by class (EMBA / MIT)

## Technical Approach

### File: `src/components/WeeklyAgendaView.tsx`

**Add Tabs wrapper** around the existing content using `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from the