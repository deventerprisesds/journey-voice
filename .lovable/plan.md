

# Backfill category_affinity for Existing Topic Groups

## What This Does

Runs a one-time database migration to populate the `category_affinity` column for all existing topic groups that currently have it set to `null`. This will make previously invisible groups appear in their correct category columns on the Priorities page.

## Migration

A single SQL migration with two passes:

1. **Groups with mapped tasks**: Set `category_affinity` to the majority category of their associated tasks
2. **Groups without tasks but with a category key stored in `window_affinity`**: Use that value as a fallback

No code changes are needed -- all application code already references `category_affinity` from the previous implementation.

## Technical Details

| File | Change |
|------|--------|
| New migration | Two `UPDATE` statements to backfill `category_affinity` from task data and `window_affinity` fallback |

### SQL

```sql
-- Pass 1: Groups WITH tasks -- use majority category
UPDATE task_topic_index ti
SET category_affinity = sub.majority_category
FROM (
  SELECT m.topic_id, t.category AS majority_category,
         ROW_NUMBER() OVER (PARTITION BY m.topic_id ORDER BY COUNT(*) DESC) AS rn
  FROM task_topic_mappings m
  JOIN tasks t ON t.id = m.task_id
  WHERE t.category IS NOT NULL
  GROUP BY m.topic_id, t.category
) sub
WHERE sub.topic_id = ti.id AND sub.rn = 1 AND ti.category_affinity IS NULL;

-- Pass 2: Groups WITHOUT tasks but with valid category key in window_affinity
UPDATE task_topic_index
SET category_affinity = window_affinity[1]
WHERE category_affinity IS NULL
  AND array_length(window_affinity, 1) > 0
  AND window_affinity[1] IN (
    'CAREER', 'PROF_EDUCATION', 'EDUCATION',
    'VENTURES', 'LIFE', 'PERSONAL'
  );
```

