#!/usr/bin/env bash
# WHAT:       Fails when the ref being deployed does not CONTAIN the base branch.
# WHY:        On 2026-09-03 execute-tool was deployed from a feature branch that was four
#             commits behind main. That branch lacked 2fb90ac ("honor an explicit user-chosen
#             time on reschedule/schedule"), so the deploy silently REVERTED a live fix and
#             re-broke rescheduling a task to an explicit clock time for ~2.5 hours. The rule
#             "merge main into your branch before deploying" was already written down in two
#             CLAUDE.md files and was still broken, so this is the mechanical version.
# SUPERSEDES: nothing (the rule previously existed only as prose).
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   .claude/accuracy-log.md entry 6; deploy run 33790603965 log line
#             "Deploying Function: execute-tool" at sha 0969b9d.
#
# USAGE:  assert-ref-contains-main.sh <base-ref> <head-ref>
#         e.g. assert-ref-contains-main.sh origin/main HEAD
#
# Deliberately does NOT fetch. The caller owns fetching (and the depth it needs), which keeps
# this a pure predicate over two refs that a test can drive in a scratch repo. A shallow clone
# makes `merge-base --is-ancestor` answer from truncated history, so the caller must ensure the
# refs are fully available -- see the ANCESTRY-UNKNOWABLE guard below.
set -euo pipefail

BASE_REF="${1:-origin/main}"
HEAD_REF="${2:-HEAD}"

if ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  echo "::error::Base ref '$BASE_REF' is not present. Fetch it before running this check."
  exit 2
fi
if ! git rev-parse --verify --quiet "$HEAD_REF^{commit}" >/dev/null; then
  echo "::error::Head ref '$HEAD_REF' is not present."
  exit 2
fi

# A shallow clone can report a WRONG ancestry answer rather than an error, which would make this
# guard worse than useless -- it would pass a branch it could not actually see the history of.
# Refuse instead of guessing.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null || echo false)" = "true" ]; then
  echo "::error::Repository is a shallow clone, so ancestry cannot be determined reliably."
  echo "         Check out with fetch-depth: 0 before running this check."
  exit 2
fi

BASE_SHA="$(git rev-parse "$BASE_REF")"
HEAD_SHA="$(git rev-parse "$HEAD_REF")"

# ORDER MATTERS AND IS THE WHOLE POINT: `--is-ancestor A B` asks "is A an ancestor of B", i.e.
# "does B contain A". We need HEAD to contain BASE, so BASE comes first. Swapping these two
# arguments produces a check that passes precisely when the branch is stale -- the exact defect
# this exists to catch. `assert-ref-contains-main.test.sh` mutation-proves that swap.
if git merge-base --is-ancestor "$BASE_SHA" "$HEAD_SHA"; then
  echo "✅ $HEAD_REF ($(git rev-parse --short "$HEAD_SHA")) contains $BASE_REF ($(git rev-parse --short "$BASE_SHA"))"
  exit 0
fi

BEHIND="$(git rev-list --count "$HEAD_SHA".."$BASE_SHA")"
echo "::error::REFUSING TO DEPLOY -- $HEAD_REF does not contain $BASE_REF."
echo ""
echo "  $HEAD_REF is missing $BEHIND commit(s) that are on $BASE_REF:"
git log --oneline --no-decorate "$HEAD_SHA".."$BASE_SHA" | sed 's/^/    /'
echo ""
echo "  Deploying this ref would REVERT those commits in production, because a deploy"
echo "  overwrites the live function with whatever this ref contains."
echo ""
echo "  Fix: merge the base branch into your branch, then re-run the deploy."
echo "    git fetch origin && git merge origin/${BASE_REF#origin/} && git push"
exit 1
