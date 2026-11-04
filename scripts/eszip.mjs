// WHAT:       A minimal, dependency-free READER for the ESZIP v2 bundle format (ESZIP_V2, ESZIP2.1,
//             ESZIP2.2, ESZIP2.3) -- enough to list a bundle's modules and pull out each module's
//             stored source bytes. Used by check-edge-deploy-drift.mjs to compare deployed SOURCE
//             against tree SOURCE.
// WHY:        The Supabase Management API's `GET /functions/{slug}/body` returns the deployed
//             function as an ESZIP2.3 bundle (measured 2026-10-26, run 40414573682 job
//             121893535258: every body began `ESZIP2.3\0\0\0\x04...`). The drift check diffed that
//             binary line by line against index.ts, so all 51 functions "drifted" while both deploys
//             on that commit had succeeded -- a guard crying wolf on every run.
// SUPERSEDES: nothing (new). The checker previously treated the body as plain text.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RECORD-drift-check-eszip.md; layout read from the eszip crate's
//             src/v2.rs (crates.io eszip-0.109.0: `into_bytes` and `parse_with_version`); parser
//             cross-checked against the live `ping` bundle in scripts/fixtures/eszip/ping.eszip.
//
// FORMAT (all integers u32 big-endian), as written by eszip's `EszipV2::into_bytes`:
//   magic(8)                                   "ESZIP_V2" | "ESZIP2.1" | "ESZIP2.2" | "ESZIP2.3"
//   [v2.2+] options: len | (key,value) byte pairs | hash(checksum_size)
//             key 0 = checksum kind (0 none, 1 sha256, 2 xxhash3), key 1 = checksum size in bytes
//   modules header: len | entries | hash
//     entry = specifier_len | specifier | kind(1)
//       kind 0 module:   source_off | source_len | map_off | map_len | module_kind(1)
//       kind 1 redirect: target_len | target
//       kind 2 npm:      package_id                                         (v2.1+)
//   [v2.1+] npm section: len | bytes | hash
//   sources:     len | concatenated (source bytes + hash) -- offsets are relative to this section
//   source maps: len | concatenated (map bytes + hash)
// Pre-2.2 bundles carry no options and default to SHA-256 (32-byte hashes).
//
// Anything that does not fit this layout throws EszipFormatError. The caller MUST treat that as
// "could not verify", never as "matched" -- a parser that guessed would be a second guard that lies.

import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';

export class EszipFormatError extends Error {}

const MAGICS = new Map([
  ['ESZIP_V2', '2'],
  ['ESZIP2.1', '2.1'],
  ['ESZIP2.2', '2.2'],
  ['ESZIP2.3', '2.3'],
]);
const CHECKSUM_KINDS = { 0: 'none', 1: 'sha256', 2: 'xxhash3' };
const MODULE_KINDS = ['javascript', 'json', 'jsonc', 'opaque', 'wasm'];

/** True when `buf` starts with a magic this module claims to understand (incl. EZBR wrapper). */
export function looksLikeEszip(buf) {
  if (!buf || buf.length < 8) return false;
  const head = Buffer.from(buf.subarray(0, 8)).toString('latin1');
  return MAGICS.has(head) || head.startsWith('EZBR') || head.startsWith('ESZIP');
}

/**
 * Parse an ESZIP v2 bundle. Returns { version, checksum, modules } where modules is a Map of
 * specifier -> { type: 'module', kind, source: Buffer, sourceMap: Buffer }
 *            | { type: 'redirect', target }
 *            | { type: 'npm', packageId }.
 */
export function parseEszip(input) {
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(input);

  // Supabase's edge-runtime can wrap a bundle as "EZBR" + brotli(eszip). Not observed live as of
  // 2026-10-26 (the API served raw ESZIP2.3), so this path is best-effort: if it does not decode to
  // a real eszip the error propagates and the caller reports UNVERIFIABLE.
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'EZBR') {
    try {
      buf = brotliDecompressSync(buf.subarray(4));
    } catch (err) {
      throw new EszipFormatError(`EZBR wrapper did not brotli-decode: ${err.message}`);
    }
  }

  if (buf.length < 8) throw new EszipFormatError('shorter than the 8-byte magic');
  const magic = buf.subarray(0, 8).toString('latin1');
  const version = MAGICS.get(magic);
  if (!version) throw new EszipFormatError(`unknown magic ${JSON.stringify(magic)}`);

  let pos = 8;
  const need = (n, what) => {
    if (pos + n > buf.length) {
      throw new EszipFormatError(`truncated: need ${n} byte(s) for ${what} at offset ${pos}, have ${buf.length - pos}`);
    }
  };
  const u32 = (what) => {
    need(4, what);
    const v = buf.readUInt32BE(pos);
    pos += 4;
    return v;
  };
  const bytes = (n, what) => {
    need(n, what);
    const b = buf.subarray(pos, pos + n);
    pos += n;
    return b;
  };

  let checksum = 'sha256';
  let checksumSize = 32;
  if (version === '2.2' || version === '2.3') {
    const optLen = u32('options length');
    if (optLen % 2 !== 0) throw new EszipFormatError('options header is not byte pairs');
    const opts = bytes(optLen, 'options');
    let kind = 0;
    let size;
    for (let i = 0; i < opts.length; i += 2) {
      if (opts[i] === 0) kind = opts[i + 1];
      else if (opts[i] === 1) size = opts[i + 1];
    }
    checksum = CHECKSUM_KINDS[kind];
    if (!checksum) throw new EszipFormatError(`unknown checksum kind ${kind}`);
    if (size === undefined) size = { none: 0, sha256: 32, xxhash3: 8 }[checksum];
    checksumSize = size;
    bytes(checksumSize, 'options hash');
  }

  const headerLen = u32('modules header length');
  const header = bytes(headerLen, 'modules header');
  const headerHash = bytes(checksumSize, 'modules header hash');
  verifyHash(checksum, header, headerHash, 'modules header');

  const pending = [];
  const modules = new Map();
  let h = 0;
  const hNeed = (n, what) => {
    if (h + n > header.length) throw new EszipFormatError(`modules header truncated reading ${what}`);
  };
  const hU32 = (what) => { hNeed(4, what); const v = header.readUInt32BE(h); h += 4; return v; };
  const hByte = (what) => { hNeed(1, what); return header[h++]; };
  const hStr = (n, what) => {
    hNeed(n, what);
    const s = header.subarray(h, h + n);
    h += n;
    const str = s.toString('utf8');
    if (Buffer.from(str, 'utf8').length !== s.length || str.includes('�')) {
      throw new EszipFormatError(`${what} is not valid UTF-8`);
    }
    return str;
  };

  while (h < header.length) {
    const specifier = hStr(hU32('specifier length'), 'specifier');
    const entryKind = hByte('entry kind');
    if (entryKind === 0) {
      const sourceOff = hU32('source offset');
      const sourceLen = hU32('source length');
      const mapOff = hU32('source map offset');
      const mapLen = hU32('source map length');
      const mk = hByte('module kind');
      if (mk >= MODULE_KINDS.length) throw new EszipFormatError(`unknown module kind ${mk} for ${specifier}`);
      const mod = { type: 'module', kind: MODULE_KINDS[mk], source: Buffer.alloc(0), sourceMap: Buffer.alloc(0) };
      modules.set(specifier, mod);
      pending.push({ mod, sourceOff, sourceLen, mapOff, mapLen, specifier });
    } else if (entryKind === 1) {
      modules.set(specifier, { type: 'redirect', target: hStr(hU32('redirect target length'), 'redirect target') });
    } else if (entryKind === 2 && version !== '2') {
      modules.set(specifier, { type: 'npm', packageId: hU32('npm package id') });
    } else {
      throw new EszipFormatError(`unknown entry kind ${entryKind} for ${specifier}`);
    }
  }

  if (version !== '2') {
    const npmLen = u32('npm section length');
    bytes(npmLen, 'npm section');
    bytes(checksumSize, 'npm section hash');
  }

  const sourcesLen = u32('sources length');
  const sources = bytes(sourcesLen, 'sources');
  const mapsLen = u32('source maps length');
  const maps = bytes(mapsLen, 'source maps');
  if (pos !== buf.length) {
    throw new EszipFormatError(`${buf.length - pos} unexpected trailing byte(s) after the source maps section`);
  }

  const slice = (section, name, off, len, specifier) => {
    if (off === 0 && len === 0) return Buffer.alloc(0);
    if (off + len + checksumSize > section.length) {
      throw new EszipFormatError(`${name} for ${specifier} (offset ${off}, length ${len}) runs past its section`);
    }
    const body = section.subarray(off, off + len);
    verifyHash(checksum, body, section.subarray(off + len, off + len + checksumSize), `${name} of ${specifier}`);
    return body;
  };
  for (const p of pending) {
    p.mod.source = slice(sources, 'source', p.sourceOff, p.sourceLen, p.specifier);
    p.mod.sourceMap = slice(maps, 'source map', p.mapOff, p.mapLen, p.specifier);
  }

  return { version, checksum, modules };
}

/** SHA-256 is verified; xxhash3 has no node built-in, so it is skipped (documented, not hidden). */
function verifyHash(kind, body, hash, what) {
  if (kind !== 'sha256' || hash.length === 0) return;
  const got = createHash('sha256').update(body).digest();
  if (!got.equals(hash)) throw new EszipFormatError(`sha256 mismatch on ${what}`);
}

/**
 * Build an ESZIP v2.x bundle. Used ONLY by the tests to make synthetic fixtures (drift, corrupt
 * header); the live-format fixture is a real captured bundle. Mirrors `EszipV2::into_bytes`.
 * `modules` is an array of { specifier, source, sourceMap?, kind? } | { specifier, redirect }.
 */
export function buildEszip(modules, { version = '2.3', checksum = 'none' } = {}) {
  const magic = [...MAGICS].find(([, v]) => v === version)[0];
  const size = { none: 0, sha256: 32 }[checksum];
  const hash = (b) => (checksum === 'sha256' ? createHash('sha256').update(b).digest() : Buffer.alloc(0));
  const be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([be(b.length), b]); };

  const out = [Buffer.from(magic, 'latin1')];
  if (version === '2.2' || version === '2.3') {
    const opts = Buffer.from([0, checksum === 'sha256' ? 1 : 0, 1, size]);
    out.push(be(opts.length), opts, hash(opts));
  }
  const header = [];
  const sources = [];
  const maps = [];
  let sLen = 0;
  let mLen = 0;
  for (const m of modules) {
    header.push(str(m.specifier));
    if (m.redirect !== undefined) {
      header.push(Buffer.from([1]), str(m.redirect));
      continue;
    }
    header.push(Buffer.from([0]));
    for (const [body, arr, which] of [[m.source, sources, 's'], [m.sourceMap ?? '', maps, 'm']]) {
      const b = Buffer.from(body, 'utf8');
      if (b.length === 0) { header.push(be(0), be(0)); continue; }
      const off = which === 's' ? sLen : mLen;
      arr.push(b, hash(b));
      if (which === 's') sLen += b.length + size; else mLen += b.length + size;
      header.push(be(off), be(b.length));
    }
    header.push(Buffer.from([MODULE_KINDS.indexOf(m.kind ?? 'javascript')]));
  }
  const hdr = Buffer.concat(header);
  out.push(be(hdr.length), hdr, hash(hdr));
  if (version !== '2') out.push(be(0), hash(Buffer.alloc(0)));
  const s = Buffer.concat(sources);
  const mp = Buffer.concat(maps);
  out.push(be(s.length), s, be(mp.length), mp);
  return Buffer.concat(out);
}
