// WHAT:       Live browser check, READ ONLY: journey Settings -> Scheduling shows the Outlook-category
//             checkboxes (#140) under "Ignore these calendar events", with Purple ticked and Tentative unticked.
// WHY:        Owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now"
//             and "I dont want all tentative ignored at the moment". The web app publishes via Lovable, outside
//             Actions, so a browser is the only proof the card is live.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md ACT:tentative-off-category-ignore
// RUN IT:     verify-uat.yml, checks_file = scripts/uat/settings-categories-checks.mjs. Never toggles or saves.
import { readFileSync, existsSync } from "node:fs";

const STORAGE_KEY = "sb-wwxgajrtmslzklnyplah-auth-token"; // src/integrations/supabase/client.ts
const OWNER_ID = "a3378f93-d655-4913-b2fa-ca5b1d8020f1";
const CARD_TITLE = "Ignore these calendar events";
const LABEL = "Also ignore Tentative group invites"; // tentative box, same card
const CAT_HEADING = "Also ignore events in these Outlook categories"; // #140
const DEFAULTS = ["Red category", "Orange category", "Yellow category", "Green category", "Blue category", "Purple category"];
let origin = null;

async function bundleHasCategoryCard({ page, check }) {
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
    if (js.includes(CAT_HEADING)) { found = p; break; }
    for (const m of js.matchAll(/(?:assets\/|["'`]\.\/)([A-Za-z0-9_.-]+\.js)/g)) {
      const q = "/assets/" + m[1];
      if (!seen.has(q)) queue.push(q);
    }
  }
  check(`T0 live bundle contains '${CAT_HEADING}'`, !!found,
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

async function categoryCard({ page, check, screenshot }) {
  await page.getByRole("tab", { name: /Scheduling/ }).first().click({ timeout: 15000 }).catch(() => {});
  const title = page.getByText(CARD_TITLE, { exact: true });
  await title.first().waitFor({ timeout: 20000 }).catch(() => {});
  if (await title.count()) await title.first().scrollIntoViewIfNeeded();
  const heading = page.getByText(CAT_HEADING, { exact: true });
  await heading.first().waitFor({ timeout: 15000 }).catch(() => {});
  if (await heading.count()) await heading.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await screenshot("ignore-categories-card");
  check(`K2 '${CARD_TITLE}' card shows '${CAT_HEADING}'`, (await heading.count()) === 1, `heading count ${await heading.count()}`);
  const states = {};
  for (const name of DEFAULTS) {
    const label = page.locator("label", { hasText: name });
    const box = (await label.count()) ? label.first().locator('input[type="checkbox"]') : null;
    states[name] = box && (await box.count()) ? await box.first().isChecked() : null;
  }
  check("K3 all six Outlook default colour checkboxes render", DEFAULTS.every((n) => states[n] !== null), JSON.stringify(states));
  check("K4 Purple category is ticked (owner's saved setting) and the other five are not",
    states["Purple category"] === true && DEFAULTS.filter((n) => n !== "Purple category").every((n) => states[n] === false), JSON.stringify(states));
  const tLabel = page.locator("label", { hasText: LABEL });
  const tBox = (await tLabel.count()) ? tLabel.first().locator('input[type="checkbox"]') : null;
  const tChecked = tBox && (await tBox.count()) ? await tBox.first().isChecked() : null;
  check("K5 the Tentative box is UNticked (owner 2026-11-22: don't ignore tentative for now)", tChecked === false, `checked=${tChecked} (read only)`);
}

export const checks = [bundleHasCategoryCard, signIn, categoryCard];
