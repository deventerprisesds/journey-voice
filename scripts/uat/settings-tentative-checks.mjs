// WHAT:       Live browser check, READ ONLY: journey Settings -> Scheduling shows the new
//             "Also ignore Tentative group invites" checkbox under "Ignore these calendar events".
// WHY:        Owner 2026-11-19: "Items that are tentative on my schedule should be on the same exclusion
//             list as 'work block' items" (#130). The web app publishes via Lovable, outside Actions, so
//             this is the only way to see whether the checkbox is live.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md ACT:ignore-tentative
// RUN IT:     verify-uat.yml, checks_file = scripts/uat/settings-tentative-checks.mjs. Never toggles anything.
import { readFileSync, existsSync } from "node:fs";

const STORAGE_KEY = "sb-wwxgajrtmslzklnyplah-auth-token"; // src/integrations/supabase/client.ts
const OWNER_ID = "a3378f93-d655-4913-b2fa-ca5b1d8020f1";
const CARD_TITLE = "Ignore these calendar events";
const LABEL = "Also ignore Tentative group invites"; // label text since 2026-11-20 (group-only rule)
let origin = null;

async function bundleHasLabel({ page, check }) {
  origin = new URL(page.url()).origin;
  const seen = new Set();
  const queue = [];
  const html = await (await fetch(origin + "/", { cache: "no-store" })).text();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)) queue.push(m[1]);
  let found = null;
  while (queue.length && seen.size < 400 && !found) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    const r = await fetch(origin + p);
    if (!r.ok) continue;
    const js = await r.text();
    if (js.includes(LABEL)) { found = p; break; }
    for (const m of js.matchAll(/(?:assets\/|["'`]\.\/)([A-Za-z0-9_.-]+\.js)/g)) {
      const q = "/assets/" + m[1];
      if (!seen.has(q)) queue.push(q);
    }
  }
  check(`T0 live bundle contains '${LABEL}'`, !!found,
    found ? `found in ${found} (scanned ${seen.size} JS files on ${origin})` : `NOT in any of ${seen.size} JS files on ${origin} -- #130's Settings change is not published yet`);
}

async function signIn({ page, check }) {
  const f = process.env.UAT_SESSION_FILE;
  if (!f || !existsSync(f)) { check("T1 signed in as owner", false, "no UAT_SESSION_FILE -- session mint step failed"); return; }
  const session = JSON.parse(readFileSync(f, "utf8"));
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session)]);
  await page.goto(origin + "/settings", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.getByRole("tab", { name: /Scheduling/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
  const path = new URL(page.url()).pathname;
  check("T1 signed in as owner -> /settings renders", session?.user?.id === OWNER_ID && path === "/settings", `landed on ${path}`);
}

async function tentativeBox({ page, check, screenshot }) {
  await page.getByRole("tab", { name: /Scheduling/ }).first().click({ timeout: 15000 }).catch(() => {});
  const title = page.getByText(CARD_TITLE, { exact: true });
  await title.first().waitFor({ timeout: 20000 }).catch(() => {});
  if (await title.count()) await title.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await screenshot("ignore-calendar-card");
  const label = page.locator("label", { hasText: LABEL });
  const n = await label.count();
  const box = n ? label.first().locator('input[type="checkbox"]') : null;
  const checked = box && (await box.count()) ? await box.first().isChecked() : null;
  check(`T2 '${CARD_TITLE}' card shows the '${LABEL}' checkbox`, n === 1, `label count ${n}`);
  check("T3 it is ticked (default on, or the owner's saved choice)", checked === true, `checked=${checked} (read only, not toggled)`);
}

export const checks = [bundleHasLabel, signIn, tentativeBox];
