#!/usr/bin/env python3
# WHAT:       Runs the three Priorities-widget Supabase queries end to end and prints what each returns.
# WHY:        Extracted verbatim from .github/workflows/test-priorities-widget-query.yml (step "Run all three widget queries end-to-end"), whose
#             `run:` block embedded this as `python3 -c "..."` with the Python body at column 0.
#             A YAML block scalar ENDS at the first line indented less than its base, so the
#             workflow did not parse -- and an unparseable workflow makes GitHub create a zero-job
#             startup-failure run on EVERY push, which is why this repo showed a red check on every
#             commit to every branch, `main` included. Re-indenting in place cannot fix it: the
#             shell would pass the leading spaces into `python3 -c` and Python rejects that, which
#             is exactly why the body was left at column 0 in the first place. A real file is the
#             only fix that satisfies both parsers.
# SUPERSEDES: the inline block in .github/workflows/test-priorities-widget-query.yml
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   runs 34759349133 / 34759010059 -- conclusion=failure, ZERO jobs, and `name` falling
#             back to the file path, which is the signature of a workflow that never started.
#
# The Python below is UNCHANGED from the original. Only its location moved.
import json, urllib.request, urllib.parse, urllib.error, sys, collections, os

SB_URL = os.environ['SB_URL']
SB_KEY = os.environ['SB_KEY']

def get(path, params):
    url = f'{SB_URL}{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        'apikey': SB_KEY,
        'Authorization': f'Bearer {SB_KEY}',
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

# Step 1: getPriorityGroups
print('\n=== STEP 1: getPriorityGroups (task_topic_index) ===')
rows, code = get('/rest/v1/task_topic_index', {'select': 'user_id', 'limit': '1'})
if code != 200 or not rows:
    print(f'HTTP {code} — could not fetch user_id from task_topic_index')
    print(rows)
    sys.exit(1)
user_id = rows[0]['user_id']
print(f'user_id prefix: {user_id[:8]}...')

groups, code = get('/rest/v1/task_topic_index', {
    'select': 'id,topic_name,position,category_affinity,parent_topic_id,window_affinity',
    'user_id': f'eq.{user_id}',
    'order': 'position.asc',
})
print(f'HTTP {code} -- {len(groups)} groups returned')
if code != 200:
    print(f'ERROR: {groups}')
    sys.exit(1)

cat_dist = collections.Counter(str(g.get('category_affinity')) for g in groups)
print('\ncategory_affinity distribution:')
for k, v in sorted(cat_dist.items()):
    print(f'  {k!s:20} : {v}')

null_cat = [g for g in groups if g.get('category_affinity') is None]
print(f'\nGroups with null category_affinity: {len(null_cat)}')

has_parent = [g for g in groups if g.get('parent_topic_id')]
print(f'Top-level groups (parent_topic_id=null): {len(groups) - len(has_parent)}')
print(f'Sub-groups (parent_topic_id set):         {len(has_parent)}')

print('\nFirst 5 groups:')
for g in groups[:5]:
    name = g['topic_name'][:35]
    cat  = str(g.get('category_affinity'))
    win  = (g.get('window_affinity') or [None])[0]
    print(f'  {name:35}  cat={cat:15}  win[0]={win}')

topic_ids = [g['id'] for g in groups]

# Step 2: task_topic_mappings
print(f'\n=== STEP 2: task_topic_mappings for {len(topic_ids)} topics ===')
joined = ','.join(topic_ids)
print(f'topic_id=in.(...) param length: {len(joined)} chars')

mappings, code = get('/rest/v1/task_topic_mappings', {
    'select': 'task_id,topic_id',
    'topic_id': f'in.({joined})',
})
print(f'HTTP {code} -- {len(mappings)} mappings returned')
if code != 200:
    print(f'ERROR: {mappings}')
    sys.exit(1)

topic_by_task = {m['task_id']: m['topic_id'] for m in mappings}
tasks_per_topic = collections.Counter(m['topic_id'] for m in mappings)
print(f'Unique task IDs: {len(topic_by_task)}')
print(f'Unique topic IDs with tasks: {len(tasks_per_topic)}')
print('Top 5 topics by task count:')
for tid, cnt in tasks_per_topic.most_common(5):
    name = next((g['topic_name'] for g in groups if g['id'] == tid), tid[:8])
    print(f'  {name[:35]:35}  {cnt} tasks')

if not topic_by_task:
    print('\nNo task mappings found')
    sys.exit(0)

# Step 3: tasks
task_ids = list(topic_by_task.keys())
print(f'\n=== STEP 3: tasks for {len(task_ids)} task IDs ===')
joined_tasks = ','.join(task_ids)
print(f'id=in.(...) param length: {len(joined_tasks)} chars')

tasks, code = get('/rest/v1/tasks', {
    'select': 'id,title,status,is_priority,priority_rank',
    'id': f'in.({joined_tasks})',
    'user_id': f'eq.{user_id}',
    'order': 'is_priority.desc,priority_rank.asc.nullslast',
})
print(f'HTTP {code} -- {len(tasks)} tasks returned')
if code != 200:
    print(f'ERROR: {tasks}')
    sys.exit(1)

for t in tasks:
    t['topic_id'] = topic_by_task.get(t['id'], '')

count_map = collections.Counter(t['topic_id'] for t in tasks if t.get('topic_id'))
print(f'\nTask counts per topic ({len(count_map)} topics have tasks):')
for tid, cnt in count_map.most_common(10):
    name = next((g['topic_name'] for g in groups if g['id'] == tid), tid[:8])
    print(f'  {name[:35]:35}  {cnt} tasks')

print(f'\nGroups: {len(groups)} | Mappings: {len(mappings)} | Tasks: {len(tasks)}')
print('All three queries succeeded.')
