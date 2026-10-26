#!/usr/bin/env bash
# WHAT:       Drives assert-ref-contains-main.sh against real throwaway git repos.
# WHY:        The guard's whole value is refusing a STALE branch. Asserting that from the
#             session agent's reading of the script is exactly the self-verification this repo
#             has been burned by, so each case builds actual commits and runs the real script.
# EVIDENCE:   Reproduces the 2026-09-03 shape: branch cut BEFORE a fix that later landed on main.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/assert-ref-contains-main.sh"
pass=0; fail=0

# Prints "FAILED:<ac>" ONLY on failure. The AC id also appears in the section headings and in
# the ok lines, so a bare "AC-D1" cannot distinguish a pass from a fail -- mutate.sh rightly
# reported NOTHING IS PROVEN until this token existed.
check() { # check <ac-id> <name> <expected-exit> <actual-exit>
  if [ "$3" = "$4" ]; then echo "  ok   - $1 $2"; pass=$((pass+1))
  else echo "  FAILED:$1 - $2 (expected exit $3, got $4)"; fail=$((fail+1)); fi
}

# Build a repo with `main`, plus a branch cut before main's last commit.
# Returns with CWD inside the new repo.
scaffold() {
  local d; d="$(mktemp -d)"
  cd "$d"
  git init -q -b main
  git config user.email t@t.t; git config user.name t
  echo base > f; git add f; git commit -qm "base"
  git branch stale                     # branch point -- BEFORE the fix below
  echo fix > f;  git add f; git commit -qm "the fix that must not be reverted"
  # Emulate the remote-tracking ref the workflow actually passes.
  git update-ref refs/remotes/origin/main main
}

echo "AC-D1 a branch MISSING a main commit is REFUSED (the 2026-09-03 defect)"
( scaffold; git checkout -q stale; "$GUARD" origin/main HEAD >/dev/null 2>&1 )
check AC-D1 "stale branch -> exit 1" 1 $?

echo "AC-D2 the same branch is ACCEPTED once main is merged in (the documented fix)"
( scaffold; git checkout -q stale
  git merge -q --no-edit -X theirs main >/dev/null 2>&1
  "$GUARD" origin/main HEAD >/dev/null 2>&1 )
check AC-D2 "after merging main -> exit 0" 0 $?

echo "AC-D3 main itself is accepted (a ref trivially contains itself)"
( scaffold; git checkout -q main; "$GUARD" origin/main HEAD >/dev/null 2>&1 )
check AC-D3 "main -> exit 0" 0 $?

echo "AC-D4 a branch AHEAD of main is accepted (the normal, healthy case)"
( scaffold; git checkout -q -b ahead main
  echo more > g; git add g; git commit -qm "new work"
  "$GUARD" origin/main HEAD >/dev/null 2>&1 )
check AC-D4 "ahead of main -> exit 0" 0 $?

echo "AC-D5 a MISSING base ref errors (exit 2), and is not mistaken for 'contains'"
( scaffold; git checkout -q stale; "$GUARD" origin/nonexistent HEAD >/dev/null 2>&1 )
check AC-D5 "absent base ref -> exit 2" 2 $?

echo "AC-D6 a SHALLOW clone is refused rather than answered from truncated history"
( scaffold
  src="$PWD"; d2="$(mktemp -d)"
  git clone -q --depth 1 "file://$src" "$d2/c" 2>/dev/null
  cd "$d2/c"
  git update-ref refs/remotes/origin/main HEAD
  "$GUARD" origin/main HEAD >/dev/null 2>&1 )
check AC-D6 "shallow clone -> exit 2" 2 $?

echo "AC-D7 the refusal names the commits that would be reverted (operator can act on it)"
out="$( scaffold; git checkout -q stale; "$GUARD" origin/main HEAD 2>&1 )"
case "$out" in
  *"the fix that must not be reverted"*) echo "  ok   - AC-D7 refusal lists the missing commit"; pass=$((pass+1));;
  *) echo "  FAILED:AC-D7 - refusal did not name the missing commit"; fail=$((fail+1));;
esac

echo ""
echo "assert-ref-contains-main: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
