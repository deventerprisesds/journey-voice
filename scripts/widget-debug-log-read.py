#!/usr/bin/env python3
# WHAT:       Fetches and prints recent widget debug-log entries.
# WHY:        Extracted verbatim from .github/workflows/read-widget-debug-log.yml (step "Fetch recent widget debug log entries"), whose
#             `run:` block embedded this as `python3 -c "..."` with the Python body at column 0.
#             A YAML block scalar ENDS at the first line indented less than its base, so the
#             workflow did not parse -- and an unparseable workflow makes GitHub create a zero-job
#             startup-failure run on EVERY push, which is why this repo showed a red check on every
#             commit to every branch, `main` included. Re-indenting in place cannot fix it: the
#             shell would pass the leading spaces into `python3 -c` and Python rejects that, which
#             is exactly why the body was left at column 0 in the first place. A real file is the
#             only fix that satisfies both parsers.
# SUPERSEDES: the inline block in .github/workflows/read-widget-debug-log.yml
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   runs 34759349133 / 34759010059 -- conclusion=failure, ZERO jobs, and `name` falling
#             back to the file path, which is the signature of a workflow that never started.
#
# The Python below is UNCHANGED from the original. Only its location moved.
import json, urllib.request, urllib.parse, urllib.error, os

SB_URL = os.environ['SB_URL']
SB_KEY = os.environ['SB_KEY']

def get(path, params):
    url = f'{SB_URL}{path}?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code

rows, code = get('/rest/v1/error_log', {'select': 'id,created_at,source,component,error_type,context', 'source': 'eq.widget', 'order': 'created_at.desc', 'limit': '20'})
print(f'HTTP {code} — {len(rows) if isinstance(rows, list) else rows} entries')
if code != 200:
    print('ERROR:', rows)
    exit(1)
for r in rows:
    ctx = r.get('context', {}) or {}
    log = ctx.get('widget_log', '')
    ts = r.get('created_at', '')[:19]
    comp = r.get('component', '')
    print(f'\n=== {ts} [{comp}] ===')
    print(log[-2000:] if log else '(no widget_log in context)')
