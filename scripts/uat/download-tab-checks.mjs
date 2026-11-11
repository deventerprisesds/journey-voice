// WHAT:       journey checks for scripts/uat/run-uat.mjs: Settings -> "Download" tab (PR #110) on the LIVE app.
// WHY:        owner asked for the latest TaskOS + Huddle APK links in a Settings tab labelled "Download"
//             (2026-11-10). The client ships via Lovable publish, so merged != live -- C0 says which it is.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   verify-uat.yml run with checks_file=scripts/uat/download-tab-checks.mjs
// READ-ONLY: only opens tabs; never clicks Download or Save.
import { readFileSync, existsSync } from "node:fs";

const STORAGE_KEY = "sb-wwxgajrtmslzklnyplah-auth-token"; // src/integrations/supabase/client.ts
const OWNER_ID = "a3378f93-d655-4913-b2fa-ca5b1d8020f1";
const MARK = "Latest Android builds"; // src/components/AppDownloadsSettings.tsx
let origin = null;

async function bundleHasTab({ page, check }) {
  origin = new URL(page.url()).origin;
  const seen = new Set(); const queue = []; let found = null;
  const html = await (await fetch(origin + "/", { cache: "no-store" })).text();
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)) queue.push(m[1]);
  while (queue.length && seen.size < 400 && !found) {
    const p = queue.shift(); if (seen.has(p)) continue; seen.add(p);
    const r = await fetch(origin + p); if (!r.ok) continue;
    const js = await r.text();
    if (js.includes(MARK)) { found = p; break; }
    for (const m of js.matchAll(/(?:assets\/|["'`]\.\/)([A-Za-z0-9_.-]+\.js)/g)) { const q = "/assets/" + m[1]; if (!seen.has(q)) queue.push(q); }
  }
  check(`C0 live bundle contains the Download tab ('${MARK}')`, !!found,
    found ? `found in ${found} (scanned ${seen.size} JS files on ${origin})` : `NOT in any of ${seen.size} JS files served by ${origin} -- #110 is likely not published by Lovable yet`);
}

async function signIn({ page, check }) {
  const f = process.env.UAT_SESSION_FILE;
  if (!f || !existsSync(f)) { check("C1 signed in as owner", false, "no UAT_SESSION_FILE"); return; }
  const session = JSON.parse(readFileSync(f, "utf8"));
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, JSON.stringify(session)]);
  await page.goto(origin + "/settings", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.getByRole("tab", { name: /Notifications/ }).first().waitFor({ timeout: 20000 }).catch(() => {});
  const path = new URL(page.url()).pathname;
  check("C1 signed in as owner -> /settings renders", session?.user?.id === OWNER_ID && path === "/settings", `landed on ${path}`);
}

async function downloadTab({ page, check, screenshot }) {
  const tab = page.getByRole("tab", { name: /^Download$/ });
  const n = await tab.count();
  check("C2 Settings has a tab labelled 'Download'", n === 1, `matches: ${n}`);
  if (!n) { await screenshot("settings-no-download-tab"); return; }
  await tab.first().click();
  const links = page.locator('a[href*=".blob.core.windows.net/bridge-apks/"][href*="sig="]');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && (await links.count()) < 2) await page.waitForTimeout(1000);
  const panel = await page.locator('[role="tabpanel"][data-state="active"]').first().innerText().catch(() => "");
  await screenshot("settings-download-tab");
  check("C3 two signed Download links (TaskOS + Huddle)", (await links.count()) === 2, `links=${await links.count()}`);
  check("C4 TaskOS row shows a version", /TaskOS\s*v\d+\.\d+/.test(panel), panel.slice(0, 220).replace(/\s+/g, " "));
  check("C5 Huddle row shows a version", /Huddle\s*v\d+\.\d+/.test(panel));
  check("C6 no error message", !/not set up|did not answer|Could not load|Sign in to see/.test(panel));
}

export const checks = [bundleHasTab, signIn, downloadTab];
