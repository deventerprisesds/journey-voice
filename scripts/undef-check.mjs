// bun/esbuild do not resolve identifiers, so an undefined symbol survives a clean bundle.
// This is the check that would have caught `courseworkOrder` and `getNexusRowsOnce`.
import { readFileSync } from 'fs';
const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const declared = new Set();
  for (const re of [/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
                    /import\s+\{([^}]*)\}/g,
                    /import\s+([A-Za-z_$][\w$]*)\s+from/g]) {
    for (const m of src.matchAll(re)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) declared.add(name);
      }
    }
  }
  // symbols this change introduced that MUST be defined or imported
  const required = ['getNexusRowsOnce','failures','createNexusAssignment','updateNexusAssignment',
                    'nexusWritesConfigured','fetchNexusAssignments','courseworkOrder','scopeToActiveCourses'];
  const used = required.filter(r => new RegExp(`\\b${r}\\b`).test(src));
  const missing = used.filter(r => !declared.has(r));
  console.log(`${f.split('/').slice(-2)[0].padEnd(26)} uses=${used.length} missing=${missing.length ? missing.join(',') : 'none'}`);
  if (missing.length) bad++;
}
process.exit(bad ? 1 : 0);
