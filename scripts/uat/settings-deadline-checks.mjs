// WHAT:       Live browser check, READ ONLY: journey Settings -> Scheduling shows the "Deadline reminders" card (#143)
//             with the owner's saved "Submit time card" item switched On, email On and chat On.
// WHY:        Owner 2026-11-22/26: the time card must be "an actual feature ... i can edit turn on and off". The web
//             app publishes via Lovable, outside Actions, so a browser is the only proof the card is live.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md "Shipped 2026-11-26"; owner config.deadlineReminders saved 2026-11-26T19:10:44Z.
// RUN IT:     verify-uat.yml, checks_file = scripts/uat/settings-deadline-checks.mjs. Never toggles or saves.
import { readFileSync, existsSync } from "node:fs";

const STORAGE_KEY = "sb-wwxgajrtmslzklnyplah-auth-token"; // src/integrations/supabase/client.ts
const OWNER_ID = "a3378f93-d655-4913-b2fa-ca5b1d8020f1";
const CARD_TITLE = "Ignore these calendar events";
const LABEL = "Also ignore Tentative group invites"; // tentative box, same card
const CAT_HEADING = "Deadline reminders"; // #143 card title
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
    found ? `found in ${found} (scanned ${seen.size} JS files on ${origin})` : `NOT in any of ${seen.size} JS files on ${origin} -- #143's Deadline reminders card is not published yet (publish from Lovable)`);
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

async function deadlineCard({ page, check, screenshot }) {
  await page.getByRole("tab", { name: /Scheduling/ }).first().click({ timeout: 15000 }).catch(() => {});
  const title = page.getByText(CAT_HEADING, { exact: true });
  await title.first().waitFor({ timeout: 20000 }).catch(() => {});
  if (await title.count()) await title.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await screenshot("deadline-reminders-card");
  check(`D2 Scheduling tab shows the '${CAT_HEADING}' card`, (await title.count()) === 1, `title count ${await title.count()}`);
  const name = page.locator('input[aria-label="Reminder name"]');
  const names = [];
  for (let i = 0; i < (await name.count()); i++) names.push(await name.nth(i).inputValue());
  check("D3 the saved 'Submit time card' item is listed", names.includes("Submit time card"), JSON.stringify(names));
  const state = async (id) => {
    const el = page.locator(`#${id}`);
    if (!(await el.count())) return null;
    const a = await el.first().getAttribute("aria-checked");
    return a === null ? await el.first().isChecked().catch(() => null) : a === "true";
  };
  const on = await state("time-card-enabled"), email = await state("time-card-email"), chat = await state("time-card-chat");
  check("D4 it is switched On, with email On and chat On (owner's saved setting)", on === true && email === true && chat === true, JSON.stringify({ on, email, chat }));
}

export const checks = [bundleHasCategoryCard, signIn, deadlineCard];
