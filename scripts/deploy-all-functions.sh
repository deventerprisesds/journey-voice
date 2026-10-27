#!/usr/bin/env bash
# WHAT:       mode=all for deploy-supabase-functions.yml. Deploys every edge-function folder with
#             its OWN `supabase functions deploy <slug>` call, keeps going past a failure, prints a
#             deployed / failed / excluded summary, and exits non-zero at the END if anything failed.
# WHY:        All-mode used to be ONE bulk `supabase functions deploy`, which aborts on the first
#             failure. `mcp` bundles to 27 MB and is rejected with HTTP 413, so in runs 39159443758
#             (2026-10-18, c11b1a2) and 40575132776 (2026-10-27, d5c19e2) the CLI deployed the 24
#             functions before `mcp` alphabetically, then quit. Every function after it was never
#             attempted and stayed at its previous version, and the only signal was a red X that
#             named one function.
# SUPERSEDES: the single bulk call in the "Deploy all functions" step (main d5c19e2).
# SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   docs/qc-evidence/FIX-deploy-all-per-function.md; scripts/deploy-all-functions.test.mjs.
#
# USAGE:  deploy-all-functions.sh <project-ref>
# ENV:    FUNCTIONS_DIR        default supabase/functions
#         DEPLOY_ALL_EXCLUDE   newline-separated "slug: reason". An excluded function is NOT
#                              attempted, and its reason is printed in the summary. Exclusion is
#                              not failure, but it is never silent. A function excluded here is
#                              still deployable by name (mode=single).
#         GITHUB_STEP_SUMMARY  when set, the summary table is appended there too.
#
# The slug set matches the CLI's own bulk deploy: every <FUNCTIONS_DIR>/<slug>/index.ts whose slug
# matches ^[A-Za-z][A-Za-z0-9_-]*$. So `_shared`, dot-dirs, and folders without an index.ts are
# skipped, the same way the CLI skips them.
set -uo pipefail   # deliberately NOT -e: one failed deploy must not end the loop.

PROJECT_REF="${1:?usage: deploy-all-functions.sh <project-ref>}"
FUNCTIONS_DIR="${FUNCTIONS_DIR:-supabase/functions}"
SLUG_RE='^[A-Za-z][A-Za-z0-9_-]*$'

declare -A EXCLUDE_REASON=()
while IFS= read -r line; do
  [ -z "${line//[[:space:]]/}" ] && continue
  slug="${line%%:*}"; slug="${slug//[[:space:]]/}"
  if [[ "$line" == *:* ]]; then
    reason="${line#*:}"; reason="${reason#"${reason%%[![:space:]]*}"}"
  else
    reason=""
  fi
  [ -z "$reason" ] && reason="(no reason given)"
  EXCLUDE_REASON["$slug"]="$reason"
done <<< "${DEPLOY_ALL_EXCLUDE:-}"

slugs=()
for dir in "$FUNCTIONS_DIR"/*/; do
  [ -d "$dir" ] || continue
  slug="$(basename "$dir")"
  [[ "$slug" =~ $SLUG_RE ]] || continue
  [ -f "$dir/index.ts" ] || continue
  slugs+=("$slug")
done

# A loop over nothing exits 0 and looks identical to a clean deploy. Refuse that false green.
if [ "${#slugs[@]}" -eq 0 ]; then
  echo "::error::No deployable functions found under $FUNCTIONS_DIR -- refusing to report success."
  exit 2
fi

for ex in "${!EXCLUDE_REASON[@]}"; do
  if [ ! -f "$FUNCTIONS_DIR/$ex/index.ts" ]; then
    echo "::warning::DEPLOY_ALL_EXCLUDE names '$ex', which is not a function folder -- stale exclusion?"
  fi
done

deployed=(); failed=(); failed_reason=(); excluded=()
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

echo "Deploying ${#slugs[@]} function folder(s) to $PROJECT_REF, one call each..."
for slug in "${slugs[@]}"; do
  if [ -n "${EXCLUDE_REASON[$slug]+x}" ]; then
    echo "::warning::SKIPPED $slug (excluded from all-mode): ${EXCLUDE_REASON[$slug]}"
    excluded+=("$slug")
    continue
  fi
  echo "::group::deploy $slug"
  supabase functions deploy "$slug" --project-ref "$PROJECT_REF" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  echo "::endgroup::"
  if [ "$rc" -eq 0 ]; then
    deployed+=("$slug")
  else
    reason="$(grep -v -e '^Try rerunning' -e '^[[:space:]]*$' "$log" | tail -n 1 | cut -c1-200)"
    [ -z "$reason" ] && reason="exit $rc, no output"
    echo "::error::deploy FAILED for $slug: $reason"
    failed+=("$slug"); failed_reason+=("$reason")
  fi
done

summary() {
  echo "| function | result | detail |"
  echo "|---|---|---|"
  local i
  for s in "${deployed[@]}"; do echo "| $s | deployed | |"; done
  for i in "${!failed[@]}"; do echo "| ${failed[$i]} | **FAILED** | ${failed_reason[$i]//|/\\|} |"; done
  for s in "${excluded[@]}"; do echo "| $s | excluded | ${EXCLUDE_REASON[$s]//|/\\|} |"; done
  echo
  echo "deployed: ${#deployed[@]}  failed: ${#failed[@]}  excluded: ${#excluded[@]}  (of ${#slugs[@]} folders)"
}

echo
echo "=== all-mode deploy summary ==="
summary
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Edge function deploy (mode=all)"; echo; summary; } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "${#failed[@]}" -gt 0 ]; then
  echo "::error::${#failed[@]} function(s) failed to deploy: ${failed[*]} -- every other function was still attempted."
  exit 1
fi
echo "✅ all-mode deploy complete"
