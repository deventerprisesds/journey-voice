// WHAT:       journey-specific checks for scripts/uat/run-uat.mjs: PR #93's "Coursework Work Sessions" Settings card
// WHY:        owner asked "Uat verify 93" (2026-11-08); the client ships via Lovable publish, so merged != live
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   docs/qc-evidence/UAT-93-settings.md
//
// READ-ONLY: never clicks Save, never focuses/edits a field. SchedulingSettings persists ONLY in
// handleSave (an explicit Save click), so rendering the tab writes nothing.
//
// Auth: the workflow writes a Supabase session (minted via admin generate_link -> /auth/v1/verify)
// to UAT_SESSION_FILE; we put it under the app's own storage key and reload. Never logged.
import { readFileSync, existsSync } from "node:fs";

const STORAGE_KEY = "sb-wwxgajrtmslzklnyplah-auth-token"; // src/integrations/supabase/client.ts
const OWNER_ID = "a3378f93-d655-4913-b2fa-ca5b1d8020f1";
const OUT_DIR = process.env.SHOT_DIR || "uat-shots";
const CARD_TITLE = "Coursework Work Sessions";
const CHECKBOX_LABEL = "Only one paper a night (a reading or PowerPoint can share the night)";
const FIELD_LABEL = "Words that mark a lighter, finite assignment (comma-separated)";
// src/config/schedulingRules.ts:190 joined the way the Input renders it (', ').
const DEFAULT_WORDS = "reading, readings, read, chapter, chapters, powerpoint, slides, slide deck, presentation, ppt";

let origin = null;

async function bundleHasStrings({ page, check }) {
  // C0: independent of auth -- is #93's text in what Lovable is SERVING right now?
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
    if (js.includes("Only one paper a night")) { found = p; break; }
    for (const m of js.matchAll(/assets\/[A-Za-z0-9_.-]+\.js/g)) {
      const q = "/" + m[0];
      if (!seen.has(q)) queue.push(q);
    }
  }
  check("C0 live bundle contains #93 text 'Only one paper a night'", !!found,
    found ? `found in ${found} (scanned ${seen.size} JS files on ${origin})` : `NOT in any of ${seen.size} JS files served by ${origin} -- #93 is likely not published`);
}

async function signIn({ page, check }) {
  const f = process.env.UAT_SESSION_FILE;
  if (!f || !existsSync(f)) { check("C1 signed in as owner", false, "no UAT_SESSION_FILE -- session mint step failed"); return; }
  const session = JSON.parse(readFileSync(f, "utf8"));
  const uid = session?.user?.id;
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session)]);
  await page.goto(origin + "/settings", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.getByRole("tab", { name: /Scheduling/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
  const path = new URL(page.url()).pathname;
  check("C1 signed in as owner -> /settings renders (not /auth)", uid === OWNER_ID && path === "/settings",
    `session user ${uid === OWNER_ID ? "= owner" : "MISMATCH " + uid}; landed on ${path}`);
}

async function openScheduling({ page, check, screenshot }) {
  await page.getByRole("tab", { name: /Scheduling/ }).first().click({ timeout: 15000 });
  const title = page.getByText(CARD_TITLE, { exact: true });
  await title.first().waitFor({ timeout: 20000 }).catch(() => {});
  const n = await title.count();
  if (n) await title.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await screenshot("scheduling-tab");
  check(`C2 Scheduling tab shows '${CARD_TITLE}' card`, n === 1, `matches: ${n}`);
  if (n) {
    const card = title.first().locator("xpath=ancestor::div[contains(@class,'bg-card')][1]");
    await card.screenshot({ path: `${OUT_DIR}/93-coursework-card.png` }).catch((e) => console.log("card shot failed: " + e.message));
  }
}

async function checkbox({ page, check }) {
  const box = page.locator("#assignment-sessions-one-paper");
  const label = page.locator('label[for="assignment-sessions-one-paper"]');
  const nBox = await box.count();
  const text = (await label.count()) ? (await label.first().innerText()).trim() : null;
  const state = nBox ? await box.first().getAttribute("data-state") : null;
  check("C3 checkbox 'Only one paper a night (...)' present", nBox === 1 && text === CHECKBOX_LABEL,
    `checkbox count ${nBox}; label "${text}"; state ${state} (read only, not toggled)`);
}

async function wordsField({ page, check }) {
  const label = page.locator("label", { hasText: FIELD_LABEL });
  const nLabel = await label.count();
  const input = label.first().locator("xpath=following-sibling::input[1]");
  const nInput = nLabel ? await input.count() : 0;
  const value = nInput ? await input.first().inputValue() : null;
  check("C4a text field 'Words that mark a lighter, finite assignment' present", nLabel === 1 && nInput === 1,
    `label count ${nLabel}; input count ${nInput}`);
  check("C4b field pre-filled with the default word list", value === DEFAULT_WORDS,
    value === DEFAULT_WORDS ? `value "${value}"` : `value "${value}" (expected "${DEFAULT_WORDS}" -- a difference may be the owner's own saved list)`);
}

export const checks = [bundleHasStrings, signIn, openScheduling, checkbox, wordsField];
