#!/usr/bin/env node
// WHAT:       Static undefined-symbol guard for the Deno edge functions. For every function
//             CALL in a file, asserts the callee is declared in that file, imported into it,
//             or a known runtime global. Anything else is reported and fails the run.
// WHY:        Deno/esbuild/bun bundle cleanly with UNDEFINED identifiers — they do not resolve
//             free variables — so `courseworkOrder(...)` with no import ships green and throws
//             a ReferenceError at runtime, inside a try/catch that downgrades it to a warning.
//             The previous version of this file had three defects, all measured 2026-09-03 and
//             all reproduced verbatim in docs/impl/laneD-test-infra.md before this rewrite:
//               (a) no arguments -> exit 0. A silent pass that checked nothing.
//               (b) `_shared/nudges.ts` -> "uses=0 missing=none", exit 0. A GREEN result on a
//                   file it never examined, because the hardcoded `required` list was a frozen
//                   snapshot of commit 06b0eba's symbols and contained none of that file's.
//               (c) `execute-tool/index.ts` -> "missing=failures", exit 1, on a CLEAN tree,
//                   because the English word "failures" appears in two COMMENTS (:1514, :1644).
//                   A guard that is red on a clean tree trains people to ignore it.
//             (b) and (c) share ONE root cause: a hardcoded list of names matched with a bare
//             regex over raw source. This version has no list — symbols are derived from the
//             file under inspection — and it strips comments and string literals before it
//             looks at anything.
// SUPERSEDES: the hardcoded-`required` implementation of scripts/undef-check.mjs at 611ceca.
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   docs/impl/laneD-test-infra.md (defect reproduction, mutation proofs FIRED/exit
//             codes); docs/verify/nudge-delivery-loop1.md §F5.a;
//             docs/ac/nudge-and-ordering-ACs.md AC-5a..AC-5d.
//
// SCOPE. `--all` checks supabase/functions/**/*.ts. That is deliberate and not laziness: the
// bug class exists because Deno bundles without resolving. `src/` is compiled by vite/tsc,
// which resolves identifiers and already rejects an undefined one, so running this there would
// duplicate a stronger existing check.
//
// LIMIT, stated plainly so it is not over-trusted: this is a lexical checker, not a scope
// analyser. It flags a CALL to a name bound nowhere in the file. It cannot see the shadowing
// hazard at nightly-schedule-builder/index.ts:1718 (`const venueNudge = ...` shadowing the
// imported function of the same name) — the name IS bound there, just to the wrong thing.
// docs/verify/nudge-delivery-loop1.md §F5.b names that limit; no regex checker can close it.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ROOT = 'supabase/functions';

// ---------------------------------------------------------------------------------------
// 1. Blank out comments and string/template literals.
//    Replaced with spaces (not deleted) so byte offsets and line numbers stay exact, which
//    is what lets a finding cite a real line number. This step alone kills defect (c).
// ---------------------------------------------------------------------------------------
// A stack-based scanner, NOT a set of regexes. Template literals may nest arbitrarily
// (`a ${ cond ? `b (${x})` : 'c (d)' }`), and a non-recursive skip over `${...}` leaves the
// strings and nested templates inside it unblanked. That was measured: it produced two false
// positives (`evening` in batch-calendar-scheduler, `completed` in twilio-voice-handler) from
// English prose inside quoted strings nested in an interpolation.
function blankNonCode(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const n = src.length;
  const stack = []; // {k:'tpl'} | {k:'expr', depth:number}
  let i = 0;
  let prevSignificant = ''; // decides regex-literal vs division

  while (i < n) {
    const top = stack[stack.length - 1];

    // Inside the literal text of a template: blank everything until ` or ${
    if (top && top.k === 'tpl') {
      if (src[i] === '\\') { blank(i, i + 2); i += 2; continue; }
      if (src[i] === '`') { stack.pop(); i++; prevSignificant = 'x'; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { stack.push({ k: 'expr', depth: 1 }); i += 2; continue; }
      blank(i, i + 1);
      i++;
      continue;
    }

    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        j++;
      }
      blank(i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
      prevSignificant = 'x';
      continue;
    }
    if (c === '`') { stack.push({ k: 'tpl' }); i++; continue; }

    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { ok = true; break; }
        j++;
      }
      if (ok) {
        blank(i + 1, j);
        i = j + 1;
        prevSignificant = 'x';
        continue;
      }
    }

    // Track brace depth so the end of a `${ ... }` interpolation is found correctly.
    if (top && top.k === 'expr') {
      if (c === '{') top.depth++;
      else if (c === '}') {
        top.depth--;
        if (top.depth === 0) { stack.pop(); i++; continue; }
      }
    }

    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out.join('');
}

// Function/method heads, found by matching parentheses rather than by regex. A regex using
// `\([^()]*\)` cannot see a parameter list containing a function-type annotation
// (`(cmp: (a: T, b: T) => number) => ...`), and cannot skip a return-type annotation between
// `)` and `{` (`private async callService(op: string): Promise<any> {`). Both were measured as
// false positives before this was rewritten.
const CONTROL_WORDS = new Set([
  'if', 'for', 'while', 'switch', 'return', 'typeof', 'instanceof', 'void', 'delete', 'await',
  'yield', 'new', 'in', 'of', 'do', 'else', 'case', 'throw', 'super', 'import', 'catch', 'with',
]);

function functionHeads(code) {
  const heads = []; // { name, params }
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '(') continue;

    // Identifier immediately before the paren, if any (the method/function name).
    let b = i - 1;
    while (b >= 0 && /\s/.test(code[b])) b--;
    const nameEnd = b + 1;
    while (b >= 0 && /[\w$]/.test(code[b])) b--;
    const word = code.slice(b + 1, nameEnd);
    // `if (` / `for (` etc. are not function heads; treating them as such would add every
    // identifier in the condition to the declared set and mask real findings.
    if (CONTROL_WORDS.has(word)) continue;

    let depth = 1;
    let j = i + 1;
    while (j < code.length && depth > 0) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
      j++;
    }
    if (depth !== 0) continue;
    const params = code.slice(i + 1, j - 1);

    let k = j;
    while (k < code.length && /\s/.test(code[k])) k++;
    let isFn = false;
    if (code[k] === '=' && code[k + 1] === '>') isFn = true;
    else if (code[k] === '{') isFn = true;
    else if (code[k] === ':') {
      // Skip a return-type annotation, then look for `{` or `=>`.
      let m = k + 1;
      let ang = 0;
      while (m < code.length) {
        const ch = code[m];
        if (ch === '<') ang++;
        else if (ch === '>') { if (ang > 0) ang--; else if (code[m - 1] === '=') { isFn = true; break; } }
        else if (ang === 0 && (ch === '{' || ch === ';' || ch === '\n')) { isFn = ch === '{'; break; }
        m++;
      }
    }
    if (isFn) heads.push({ name: word, params });
  }
  return heads;
}

// ---------------------------------------------------------------------------------------
// 2. Derive the declared/bound names FROM THE FILE. No hardcoded list — that was defect (b).
//    Over-collecting here is the safe direction: it can only cause a missed report, never a
//    false accusation against a clean tree (AC-5c).
// ---------------------------------------------------------------------------------------
const ID = '[A-Za-z_$][\\w$]*';

// Keep only the BINDING half of each parameter, dropping its type annotation and default.
// `cmp: (a: T, b: T) => number` binds `cmp`; `a` and `b` there are annotation-only names that
// are NOT in scope, and harvesting them would mask a genuinely undefined `a(` elsewhere.
// Destructuring patterns are preserved: in `{ a, b: c }: Props` the `:` inside the braces is
// not at top level, so only `: Props` is cut.
function stripAnnotations(params) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  let cut = -1;
  const flush = (end) => {
    pieces.push(params.slice(start, cut >= 0 ? cut : end));
    cut = -1;
  };
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++;
    else if (c === ')' || c === ']' || c === '}' || c === '>') depth--;
    else if (depth === 0 && (c === ':' || c === '=') && cut < 0) cut = i;
    else if (depth === 0 && c === ',') {
      flush(i);
      start = i + 1;
    }
  }
  flush(params.length);
  return pieces.join(',');
}

function collectDeclared(code) {
  const declared = new Set();
  const add = (raw) => {
    if (!raw) return;
    const name = raw.trim().split(/\s+as\s+/).pop()?.trim().replace(/^\.\.\./, '');
    if (name && new RegExp(`^${ID}$`).test(name)) declared.add(name);
  };
  // Every identifier inside a binding pattern: {a, b: c, d = 1, ...rest} / [a, , b]
  const addPattern = (text) => {
    if (!text) return;
    let t = text.replace(/=[^,}\]]*/g, ''); // drop default-value expressions
    for (const m of t.matchAll(new RegExp(`(${ID})\\s*:\\s*(${ID})`, 'g'))) add(m[2]);
    t = t.replace(new RegExp(`(${ID})\\s*:`, 'g'), ' ');
    for (const m of t.matchAll(new RegExp(ID, 'g'))) add(m[0]);
  };

  // import { a, b as c } from '...'   /   import d from '...'   /   import * as ns from '...'
  for (const m of code.matchAll(/import\s+([^;]*?)\s+from/g)) {
    const clause = m[1];
    for (const g of clause.matchAll(/\{([^}]*)\}/g)) {
      for (const part of g[1].split(',')) add(part.replace(/^\s*type\s+/, ''));
    }
    const rest = clause.replace(/\{[^}]*\}/g, '');
    for (const g of rest.matchAll(new RegExp(`\\*\\s+as\\s+(${ID})`, 'g'))) add(g[1]);
    for (const part of rest.replace(/\*\s+as\s+\w+/g, '').split(',')) add(part);
  }
  // const/let/var/function/class/type/interface/enum NAME
  for (const m of code.matchAll(
    new RegExp(`\\b(?:const|let|var|function|class|type|interface|enum)\\s*\\*?\\s*(${ID})`, 'g'),
  )) add(m[1]);
  // Destructured declarations and for-of/for-in bindings
  for (const m of code.matchAll(/\b(?:const|let|var)\s*([{[][^;=]*?[\]}])\s*(?==|of\b|in\b)/g)) {
    addPattern(m[1]);
  }
  // catch (e) / catch ({ message })
  for (const m of code.matchAll(/\bcatch\s*\(([^)]*)\)/g)) addPattern(m[1]);
  // Function/method heads: their NAME is a binding (class methods, object-literal methods,
  // function declarations) and their PARAMETERS are bindings inside the body.
  for (const h of functionHeads(code)) {
    if (h.name) add(h.name);
    // Strip type annotations before harvesting names: `cmp: (a: T) => number` binds `cmp`
    // only — `T` and `number` are types, and adding them is harmless but adding `a`/`b` from
    // the annotation is not, so annotations are dropped at the top level.
    addPattern(stripAnnotations(h.params));
  }
  // Single-parameter arrows without parens: `x => ...`
  for (const m of code.matchAll(new RegExp(`(?:^|[^.\\w$])(${ID})\\s*=>`, 'g'))) add(m[1]);
  return declared;
}

// ---------------------------------------------------------------------------------------
// 3. Known runtime globals. Deno + web + the JS standard library.
// ---------------------------------------------------------------------------------------
const GLOBALS = new Set([
  // control flow / operators that lexically look like `name(`
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'void', 'delete',
  'await', 'yield', 'function', 'new', 'in', 'of', 'do', 'else', 'case', 'throw', 'super',
  'this', 'import', 'export', 'default', 'as', 'from', 'let', 'const', 'var', 'class', 'extends',
  'try', 'finally', 'break', 'continue', 'static', 'get', 'set', 'async', 'satisfies', 'is',
  // standard library
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError',
  'URIError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'Promise',
  'Proxy', 'Reflect', 'Function', 'Intl', 'globalThis', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'structuredClone',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array', 'escape', 'unescape', 'eval',
  // web / Deno runtime
  'Deno', 'console', 'fetch', 'Request', 'Response', 'Headers', 'FormData', 'URL',
  'URLSearchParams', 'Blob', 'File', 'FileReader', 'AbortController', 'AbortSignal', 'Event',
  'EventTarget', 'CustomEvent', 'MessageChannel', 'MessagePort', 'BroadcastChannel',
  'ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoder', 'TextDecoder',
  'TextEncoderStream', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream',
  'WebSocket', 'Worker', 'crypto', 'Crypto', 'CryptoKey', 'SubtleCrypto', 'performance',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'atob', 'btoa',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'reportError', 'alert', 'confirm',
  'prompt', 'localStorage', 'sessionStorage', 'navigator', 'location', 'self', 'window',
  'document', 'process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename',
  'EdgeRuntime', 'Temporal',
]);

// ---------------------------------------------------------------------------------------
// 4. Find call sites and report the ones bound nowhere.
// ---------------------------------------------------------------------------------------
function checkFile(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const code = blankNonCode(src);
  const declared = collectDeclared(code);

  // `foo(` and `new Foo(`, but never `.foo(` / `?.foo(` (member calls resolve at runtime on
  // the object, not lexically) and never a numeric/keyword lead-in.
  const callRe = new RegExp(`(?:^|[^.\\w$?])(${ID})\\s*(?:<[^<>()]*>\\s*)?\\(`, 'g');

  const calls = new Map(); // name -> first line number
  for (const m of code.matchAll(callRe)) {
    const name = m[1];
    if (GLOBALS.has(name) || declared.has(name)) continue;
    if (!calls.has(name)) {
      calls.set(name, code.slice(0, m.index).split('\n').length);
    }
  }

  // Count of call sites the analyser actually understood. AC-5b: a file whose analysis yields
  // nothing at all must be reported as NOT CHECKED rather than as a pass — that is precisely
  // the "uses=0 missing=none" false green this rewrite exists to kill.
  const examined = (code.match(callRe) || []).length;
  return { examined, declared: declared.size, missing: [...calls.entries()] };
}

function walkTs(abs, out = []) {
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(abs, e.name);
    if (e.isDirectory()) walkTs(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// 5. CLI. AC-5a: bare invocation is a LOUD FAILURE, never a silent pass.
// ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const useAll = argv.includes('--all');
// `--verbose` prints per-file `examined` (call sites the analyser understood). AC-5b: a file
// reporting zero must read as NOT CHECKED, never as a pass — the old guard's "uses=0
// missing=none" green on _shared/nudges.ts is the exact false green this makes visible.
const verbose = argv.includes('--verbose') || argv.includes('-v');
const tap = argv.includes('--tap');
const positional = argv.filter((a) => !a.startsWith('-'));

let targets;
if (useAll) {
  const root = join(REPO, DEFAULT_ROOT);
  if (!existsSync(root)) {
    console.error(`undef-check: --all root "${DEFAULT_ROOT}" does not exist. Nothing checked.`);
    process.exit(2);
  }
  targets = walkTs(root).sort();
} else if (positional.length) {
  targets = positional.map((p) => (p.startsWith('/') ? p : join(REPO, p)));
} else {
  console.error('undef-check: NO FILES GIVEN — nothing was checked, so this is a FAILURE.');
  console.error('');
  console.error('  A checker that is handed no input must never exit 0: an empty run is');
  console.error('  indistinguishable from a clean one, and the previous version of this script');
  console.error('  exited 0 here (verified 2026-09-03), so "I ran the guard" meant nothing.');
  console.error('');
  console.error('  Usage:');
  console.error('    node scripts/undef-check.mjs --all            # every .ts under ' + DEFAULT_ROOT);
  console.error('    node scripts/undef-check.mjs <file> [file...] # specific files');
  process.exit(2);
}

if (!targets.length) {
  console.error('undef-check: resolved ZERO files to check. Failing rather than reporting a pass.');
  process.exit(2);
}

// A RATCHET, not a mute button. Entries are keyed `<path>:<symbol>` — deliberately NOT by line
// number, because a sibling lane editing a file mid-run shifted a finding by 20 lines while this
// was being built. Three properties keep it honest:
//   1. every baselined finding is still PRINTED, loudly, on every run;
//   2. any finding NOT in the baseline fails the run;
//   3. a baseline entry that no longer reproduces ALSO fails the run, so a fixed defect forces
//      the entry's deletion and the file cannot silently accumulate dead exemptions.
const BASELINE_PATH = join(REPO, 'scripts/undef-check.baseline.json');
let baseline = {};
if (existsSync(BASELINE_PATH)) {
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).known ?? {};
  } catch (e) {
    console.error(`undef-check: baseline file is unreadable (${e.message}). Failing.`);
    process.exit(2);
  }
}

let hardFail = 0;
let notChecked = 0;
const newFindings = [];
const knownHit = new Set();

for (const abs of targets) {
  if (!existsSync(abs)) {
    console.error(`undef-check: no such file: ${relative(REPO, abs)}`);
    hardFail++;
    continue;
  }
  const r = checkFile(abs);
  const rp = relative(REPO, abs);
  if (r.examined === 0 && r.declared === 0) {
    console.log(`NOT-CHECKED  ${rp}  (0 call sites, 0 declarations — analysis produced nothing)`);
    notChecked++;
    continue;
  }
  if (verbose) {
    console.log(`  examined=${String(r.examined).padStart(4)} declared=${String(r.declared).padStart(4)}  ${rp}`);
  }
  for (const [name, line] of r.missing) {
    const key = `${rp}:${name}`;
    if (key in baseline) knownHit.add(key);
    else newFindings.push(`${rp}:${line}  ${name}`);
  }
}

// Staleness is only decidable on a FULL sweep. On a subset run the baselined file may simply
// not have been among the targets, and reporting that as "no longer reproduces" would fail the
// run for the wrong reason — measured while building this.
const checkedSet = new Set(targets.map((t) => relative(REPO, t)));
const staleBaseline = Object.keys(baseline).filter(
  (k) => !knownHit.has(k) && (useAll || checkedSet.has(k.slice(0, k.lastIndexOf(':')))),
);

console.log(
  `undef-check: ${targets.length} file(s) checked, ${newFindings.length} NEW undefined symbol(s), ` +
    `${knownHit.size} known, ${notChecked} not analysable`,
);

if (knownHit.size) {
  console.log('');
  console.log('KNOWN pre-existing undefined symbols (baselined — fix these, do not add more):');
  for (const k of knownHit) console.log(`  ${k}  — ${baseline[k]}`);
}

if (newFindings.length) {
  console.error('');
  console.error('UNDEFINED SYMBOLS — called but bound nowhere in the file and not a known global:');
  for (const f of newFindings) console.error(`  ${f}`);
  console.error('');
  console.error('  Deno/esbuild bundle these cleanly; they throw at runtime, often inside a');
  console.error('  try/catch that hides them. Import the symbol or define it.');
}

// TAP lines naming each offending SYMBOL. This exists so the guard can be mutation-proved with
// the org's standard scripts/mutate.sh, which recognises `not ok ... <name>` and would otherwise
// report UNDETERMINED against this script's own output format — i.e. prove nothing.
if (tap) {
  let n = 0;
  for (const f of newFindings) console.log(`not ok ${++n} - ${f.trim().split(/\s+/).pop()}`);
  if (!newFindings.length) console.log('ok 1 - no new undefined symbols');
}

if (staleBaseline.length) {
  console.error('');
  console.error('STALE BASELINE — these no longer reproduce. Delete them from');
  console.error(`  ${relative(REPO, BASELINE_PATH)} so the exemption cannot outlive the defect:`);
  for (const k of staleBaseline) console.error(`  ${k}`);
}

process.exit(hardFail || notChecked || newFindings.length || staleBaseline.length ? 1 : 0);
