// PICO-8 cart <-> printable black and white code. No dependencies; runs in browsers and Node 18+.
//
// Code format:
// - a letter sheet, both sides, folded in quarters: on each quarter but the cover (the front's top
//   left) one TILE of 0.4 mm black and white modules, with at least 6 mm of white round it, read and
//   corrected on its own. A cart takes the tiles it needs, in order: the front's three, then the
//   back's four (QUARTERS). All the modules are on one C x R grid, the front's quarters then the back's.
//   Black and white because a phone photo keeps brightness sharp and smears colour: a test sheet
//   read black/white at under 1% wrong, and 0.4 mm colour at over a third. 0.4 mm so the biggest
//   cart PICO-8 can make (45 KB packed) fits one sheet: 0.6 mm read better from 20 cm, but a sheet
//   held only 24 KB.
// - alignment targets (TARGETS) on a ~76-module lattice per tile, its outer ones at the tile's edges
//   (so curl is measured right out to them), so a phone can read the sheet a part at a time: an
//   11x11 square, a 9x9 bullseye (black border, white ring, black ring, 3x3 white centre: 1:1:3:1:1
//   at one module a unit) in a ring of 40 bits (RIM) of its ID (lattice column and row, 4 bits
//   each), a CRC-24 of the ID, and the format's 8 bits (how many tiles the cart takes, 6 bits, and
//   its error-correction level, 2 bits, LEVELS). So any one target says where it is, which way up
//   it is (the ring read from another side fails the CRC), and how many tiles the cart takes.
// - data: the rest of each tile, its modules row-major, 1 bit each (white = 1), XORed with MASK; the
//   bytes are interleaved Reed-Solomon blocks (up to 255 bytes, parity the level's share), whose
//   data is the tile's share of the payload and its crc32 (so a tile read with its parity nearly all
//   spent on gaps can't pass off a wrong guess). Unused tiles are blank, targets and all. The shares hold
//   u32 len | zlib(raw) | u32 crc32, raw = name | palette | pixel indices | cart bytes,
//   which is enough to rebuild the .p8.png pixel for pixel.

// The sheet, in printer pixels of 0.1 mm (254 dpi): letter, both sides, folded in quarters. Each
// quarter but the cover (the front's top left) can hold one tile of code, QW x QH modules of
// 0.4 mm (M px) with at least 6 mm of white all round: to the paper's edge (past any printer's
// margin) and either side of the folds, so each quarter reads on its own and the folded cart's
// edges stay clean. A cart takes as many tiles as it needs, in order: the front's three (top right,
// bottom left, bottom right), then the back's four (bottom left, bottom right, top right, top left).
// Modules are numbered on one grid of C x R: the front's two columns of quarters, then the back's,
// QP x QR modules apart (half a page), so a module's place on the grid is its place on its page.
export const PW = 2159, PH = 2794, M = 4;
export const QP = Math.round(PW / 2 / M), QR = Math.round(PH / 2 / M), QW = Math.floor((PW / 2 - 120) / M), QH = Math.floor((PH / 2 - 120) / M);
export const OX = Math.round((PW / 2 - QW * M) / 2), OY = Math.round((PH / 2 - QH * M) / 2); // a page's first module, in printer pixels
export const C = 4 * QP, R = 2 * QR;
export const PALETTE = [[0, 0, 0], [255, 255, 255]]; // the code's black and white
const BLACK = 0, WHITE = 1;
const PAPER = 12, FMT = 16, DATA = 255; // LAYOUT codes besides the fixed colours
const N = 160 * 205;
const LEVELS = [0.1, 0.15, 0.2, 0.3]; // error correction: the share of each block that's parity

// The tiles, [x0, y0, x1, y1) on the grid, in order. As laid out, front then back:  C 1 | 7 6
//                                                                                   2 3 | 4 5
const QUARTERS = [[1, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0], [2, 0]];
export const TILES = QUARTERS.map(([i, j]) => [i * QP, j * QR, i * QP + QW, j * QR + QH]), NT = TILES.length;
export const side = x => x >= 2 * QP ? 1 : 0; // 0 the front, 1 the back
// k target centres from 5 modules in from a to 5 in from b (a target's half): the outer ones flush
// with the tile's edges. 4 a tile across and 5 down, so an ID's column fits 4 bits.
const lattice = (a, b, k) => Array.from({ length: k }, (_, i) => a + 5 + Math.floor(i * (b - a - 11) / (k - 1)));
const LX = [0, 1, 2, 3].flatMap(i => lattice(i * QP, i * QP + QW, 4)), LY = [0, 1].flatMap(j => lattice(j * QR, j * QR + QH, 5)); // alignment target centres, each quarter its own
const TARGETS = []; // [column, row, x, y] of each target printed, x y its centre module
// A target's ring, clockwise from its top-left corner: [dx, dy] from its centre, 10 a side
const RIM = Array.from({ length: 40 }, (_, t) => { const s = t / 10 | 0, k = t % 10 - 5; return [[k, -5], [5, k], [-k, 5], [-5, -k]][s]; });
// The ring's first 32 bits: the ID and a CRC-24 of it, xored so an all-black or all-white ring isn't valid,
// and so a ring read from another side (whatever the format) is at least 5 bits from any valid one
const tag = id => { let r = id << 24 >>> 0; for (let b = 31; b >= 24; b--) if (r >>> b & 1) r = (r ^ 0x1864cfb << b - 24) >>> 0; return (id << 24 | (r ^ 0x16b4e9) & 0xffffff) >>> 0; };

const LAYOUT = new Uint8Array(C * R).fill(PAPER);
{
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < C && y < R) LAYOUT[y * C + x] = v; };
  const ring = (dx, dy, n) => Math.min(dx, dy, n - 1 - dx, n - 1 - dy);
  for (const [x0, y0, x1, y1] of TILES) for (let y = y0; y < y1; y++) LAYOUT.fill(DATA, y * C + x0, y * C + x1);
  LY.forEach((cy, j) => LX.forEach((cx, i) => {
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (LAYOUT[(cy + dy) * C + cx + dx] !== DATA) return;
    for (let dy = 0; dy < 9; dy++) for (let dx = 0; dx < 9; dx++) set(cx - 4 + dx, cy - 4 + dy, ring(dx, dy, 9) % 2 ? WHITE : ring(dx, dy, 9) < 3 ? BLACK : WHITE);
    const word = tag(i << 4 | j); // 32 bits, then the format's 8
    RIM.forEach(([dx, dy], t) => set(cx + dx, cy + dy, t < 32 ? (word >>> 31 - t & 1 ? WHITE : BLACK) : FMT + t - 32));
    TARGETS.push([i, j, cx, cy]);
  }));
}
const BLANK = LAYOUT.map(v => v >= FMT && v <= DATA ? WHITE : v); // the sheet with no cart: the code all white
export const DATA_POS = []; // the data modules
LAYOUT.forEach((v, i) => v === DATA && DATA_POS.push(i));
const MASK = new Uint8Array(C * R);
for (let i = 0, x = 1; i < C * R; i++) { x = Math.imul(x, 1103515245) + 12345 & 0x7fffffff; MASK[i] = x >> 16 & 1; }
const TILE_OF = new Int8Array(C * R).fill(-1), TILE_POS = TILES.map(([x0, y0, x1, y1], t) => {
  const pos = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (LAYOUT[y * C + x] === DATA) { pos.push(y * C + x); TILE_OF[y * C + x] = t; }
  return pos;
});
const GEOM = TILE_POS.map(pos => { const cap = pos.length >> 3, nb = Math.ceil(cap / 255); return { nb, L: Math.floor(cap / nb) }; }); // nb blocks of L bytes
const nsymOf = (t, lv) => Math.max(2, Math.round(GEOM[t].L * LEVELS[lv]));
const dataOf = (t, lv) => GEOM[t].nb * (GEOM[t].L - nsymOf(t, lv)) - 4; // the bytes of payload a tile holds, besides its own crc32

// ---- zlib, crc32, PNG ----

const pipe = async (bytes, s) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(s)).arrayBuffer());
const deflate = b => pipe(b, new CompressionStream('deflate'));
const inflate = b => pipe(b, new DecompressionStream('deflate'));

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n; });
function crc32(b) {
  let c = ~0;
  for (const x of b) c = CRC[(c ^ x) & 255] ^ c >>> 8;
  return ~c >>> 0;
}

const SIG = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

// Canvas premultiplies alpha, which would wreck the cart bits in the low bits of each channel,
// so carts go through these instead. 8-bit RGBA only, which is what PICO-8 writes.
export async function pngDecode(buf) {
  if (SIG.some((v, i) => buf[i] !== v)) throw new Error('not a PNG file');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), idat = [];
  let w, h;
  for (let p = 8; p < buf.length;) {
    const len = dv.getUint32(p), type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      if (buf[p + 16] !== 8 || buf[p + 17] !== 6 || buf[p + 20]) throw new Error('not an 8-bit RGBA PNG');
    }
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = await pipe(new Blob(idat), new DecompressionStream('deflate')), s = w * 4, rgba = new Uint8Array(s * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (s + 1)];
    for (let i = 0; i < s; i++) {
      const o = y * s + i, a = i >= 4 ? rgba[o - 4] : 0, b = y ? rgba[o - s] : 0, c = i >= 4 && y ? rgba[o - s - 4] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      rgba[o] = raw[o + y + 1] + [0, a, b, a + b >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
    }
  }
  return { w, h, rgba };
}

export async function pngEncode(rgba, w, h) {
  const s = w * 4, raw = new Uint8Array(h * (s + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * s, y * s + s), y * (s + 1) + 1);
  const chunk = (type, d) => {
    const b = new Uint8Array(12 + d.length), v = new DataView(b.buffer);
    v.setUint32(0, d.length); b.set([...type].map(ch => ch.charCodeAt(0)), 4); b.set(d, 8);
    v.setUint32(8 + d.length, crc32(b.subarray(4, 8 + d.length)));
    return b;
  };
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  return new Uint8Array(await new Blob([SIG, chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', [])]).arrayBuffer());
}

// ---- PDF ----

// Letter pages, each filled edge to edge by { w, h, rgb }, an opaque pixel buffer (front, and back if any)
export async function pdf(pages) {
  const parts = [], offs = [], enc = new TextEncoder();
  let len = 0;
  const put = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  const obj = (n, dict, stream) => {
    offs[n] = len;
    put(`${n} 0 obj\n<<${dict}${stream ? `/Length ${stream.length}` : ''}>>\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  const n = 3 + 3 * pages.length; // objects: catalog, page tree, then page, contents, image per page
  put('%PDF-1.4\n');
  obj(1, '/Type/Catalog/Pages 2 0 R');
  obj(2, `/Type/Pages/Kids[${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}]/Count ${pages.length}/MediaBox[0 0 612 792]`);
  for (const [i, pg] of pages.entries()) {
    const o = 3 + 3 * i;
    obj(o, `/Type/Page/Parent 2 0 R/Resources<</XObject<</I ${o + 2} 0 R>>>>/Contents ${o + 1} 0 R`);
    obj(o + 1, '', enc.encode('q 612 0 0 792 0 0 cm /I Do Q'));
    obj(o + 2, `/Type/XObject/Subtype/Image/Width ${pg.w}/Height ${pg.h}/BitsPerComponent 8/ColorSpace/DeviceRGB/Interpolate false/Filter/FlateDecode`, await deflate(pg.rgb));
  }
  const xref = len;
  put(`xref\n0 ${n}\n0000000000 65535 f \n${offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size ${n}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

// ---- Reed-Solomon over GF(256), poly 0x11d, generator 2, first root 2^0 ----

const EXP = new Uint8Array(510), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = EXP[i + 255] = x; LOG[x] = i; x = x << 1 ^ (x & 128 ? 0x11d : 0); }
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
const div = (a, b) => a ? EXP[LOG[a] + 255 - LOG[b]] : 0;

function rsGen(nsym) {
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const n = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => { n[j] ^= c; n[j + 1] ^= mul(c, EXP[i]); });
    g = n;
  }
  return g;
}

function rsEncode(msg, g) {
  const out = new Uint8Array(msg.length + g.length - 1);
  out.set(msg);
  for (let i = 0; i < msg.length; i++) { const c = out[i]; if (c) for (let j = 1; j < g.length; j++) out[i + j] ^= mul(g[j], c); }
  out.set(msg);
  return out;
}

// Polynomials as arrays, highest power first
const pow2 = p => EXP[(p % 255 + 255) % 255];
const inv = x => EXP[255 - LOG[x]];
const pScale = (p, x) => p.map(v => mul(v, x));
const pAdd = (p, q) => { const n = Math.max(p.length, q.length), r = new Array(n).fill(0); p.forEach((v, i) => r[i + n - p.length] = v); q.forEach((v, i) => r[i + n - q.length] ^= v); return r; };
const pMul = (p, q) => { const r = new Array(p.length + q.length - 1).fill(0); q.forEach((b, j) => p.forEach((a, i) => r[i + j] ^= mul(a, b))); return r; };
const pEval = (p, x) => p.reduce((y, v) => mul(y, x) ^ v, 0);

// Corrects c in place, given the byte positions known to be missing (erase). Throws past
// 2 * errors + gaps > nsym. (The errata decoder from
// Wikiversity's "Reed-Solomon codes for coders": Forney syndromes, Berlekamp-Massey, Chien, Forney.)
function rsDecode(c, nsym, erase = []) {
  const n = c.length;
  if (erase.length > nsym) throw new Error('too many gaps');
  for (const e of erase) c[e] = 0;
  const synd = [0];
  for (let i = 0; i < nsym; i++) synd.push(pEval(c, pow2(i)));
  if (synd.every(v => !v)) return;
  const fs = synd.slice(1); // the syndromes with the gaps taken out
  for (const e of erase) { const x = pow2(n - 1 - e); for (let j = 0; j < fs.length - 1; j++) fs[j] = mul(fs[j], x) ^ fs[j + 1]; }
  let loc = [1], old = [1];
  for (let i = 0; i < nsym - erase.length; i++) {
    let d = fs[i];
    for (let j = 1; j < loc.length; j++) d ^= mul(loc[loc.length - 1 - j], fs[i - j]);
    old = [...old, 0];
    if (d) {
      if (old.length > loc.length) { const nw = pScale(old, d); old = pScale(loc, inv(d)); loc = nw; }
      loc = pAdd(loc, pScale(old, d));
    }
  }
  while (loc.length && !loc[0]) loc.shift();
  const errs = loc.length - 1, rev = [...loc].reverse(), pos = [];
  if (errs * 2 + erase.length > nsym) throw new Error('too much damage to correct');
  for (let i = 0; i < n; i++) if (!pEval(rev, pow2(i))) pos.push(n - 1 - i);
  if (pos.length !== errs) throw new Error('too much damage to correct');
  const all = [...erase, ...pos], X = all.map(p => pow2(n - 1 - p));
  const eloc = X.reduce((l, x) => pMul(l, [x, 1]), [1]);
  const prod = pMul([...synd].reverse(), eloc), ev = prod.slice(prod.length - eloc.length);
  X.forEach((x, i) => {
    const xi = inv(x), d = X.reduce((t, y, j) => j === i ? t : mul(t, 1 ^ mul(xi, y)), 1);
    if (!d) throw new Error('too much damage to correct');
    c[all[i]] ^= div(mul(x, pEval(ev, xi)), d);
  });
  for (let i = 0; i < nsym; i++) if (pEval(c, pow2(i))) throw new Error('too much damage to correct');
}

// ---- cart <-> grid ----

function pack(rgba, name) {
  const pal = [], idx = new Uint8Array(N), cart = new Uint8Array(N), seen = new Map();
  for (let i = 0; i < N; i++) {
    const [r, g, b, a] = rgba.subarray(i * 4, i * 4 + 4);
    cart[i] = (a & 3) << 6 | (r & 3) << 4 | (g & 3) << 2 | b & 3;
    const key = r >> 2 << 18 | g >> 2 << 12 | b >> 2 << 6 | a >> 2;
    if (!seen.has(key)) { seen.set(key, seen.size); pal.push(r & 252, g & 252, b & 252, a & 252); }
    idx[i] = seen.get(key);
  }
  if (seen.size > 256) throw new Error('cart image has too many colours');
  const nm = new TextEncoder().encode(name).subarray(0, 255);
  return Uint8Array.from([nm.length, ...nm, seen.size - 1, ...pal, ...idx, ...cart]);
}

function unpack(raw) {
  let p = 1 + raw[0];
  const name = new TextDecoder().decode(raw.subarray(1, p));
  const n = raw[p++] + 1, pal = raw.subarray(p, p += n * 4), idx = raw.subarray(p, p += N), cart = raw.subarray(p, p + N);
  if (cart.length !== N) throw new Error('truncated cart');
  const rgba = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    const c = cart[i], q = idx[i] * 4;
    rgba[i * 4] = pal[q] | c >> 4 & 3; rgba[i * 4 + 1] = pal[q + 1] | c >> 2 & 3;
    rgba[i * 4 + 2] = pal[q + 2] | c & 3; rgba[i * 4 + 3] = pal[q + 3] | c >> 6;
  }
  return { name, rgba };
}

// 160x205 RGBA cart pixels -> { grid: Uint8Array(C*R) of PALETTE indices (data: 0 black, 1 white),
// ecc: parity share, tiles: how many it takes, sides: of the paper it takes }. One side if it fits
// there with 20% error correction or more, both sides if not; the most error correction that fits,
// in as few tiles as hold it.
export async function encode(rgba, name) {
  const z = await deflate(pack(rgba, name)), need = z.length + 8;
  let lv, n, room = 0;
  for (const [most, least] of [[3, 2], [NT, 0]]) {
    for (lv = LEVELS.length - 1; lv >= least; lv--) {
      for (n = 0, room = 0; n < most && room < need;) room += dataOf(n++, lv);
      if (room >= need) break;
    }
    if (room >= need) break;
  }
  if (room < need) throw new Error('cart is too big to fit on a sheet');
  const payload = new Uint8Array(room), dv = new DataView(payload.buffer);
  dv.setUint32(0, z.length); payload.set(z, 4); dv.setUint32(4 + z.length, crc32(z));
  const grid = BLANK.slice(), f = n << 2 | lv;
  for (let t = 0, off = 0; t < n; t++) {
    const { nb, L } = GEOM[t], nsym = nsymOf(t, lv), k = L - nsym, gen = rsGen(nsym), stream = new Uint8Array((TILE_POS[t].length >> 3) + 1);
    const share = new Uint8Array(nb * k), d = share.length - 4;
    share.set(payload.subarray(off, off += d)); new DataView(share.buffer).setUint32(d, crc32(share.subarray(0, d)));
    for (let b = 0; b < nb; b++) rsEncode(share.subarray(b * k, b * k + k), gen).forEach((v, j) => stream[j * nb + b] = v);
    TILE_POS[t].forEach((p, i) => grid[p] = (stream[i >> 3] >> 7 - (i & 7) & 1) ^ MASK[p]);
  }
  LAYOUT.forEach((v, i) => { if (v >= FMT && v < DATA) grid[i] = f >> 7 - (v - FMT) & 1; });
  for (const [x0, y0, x1, y1] of TILES.slice(n)) for (let y = y0; y < y1; y++) grid.fill(WHITE, y * C + x0, y * C + x1); // the tiles it doesn't take: blank
  return { grid, ecc: LEVELS[lv], tiles: n, sides: n > 3 ? 2 : 1 };
}

// The format bits, by majority over the targets whose IDs read right (blank tiles have none):
// { n tiles, lv level }, or null if unsure
function format(sym, seen) {
  const ones = new Array(8).fill(0), all = new Array(8).fill(0);
  for (const [i, j, cx, cy] of TARGETS) {
    const at = t => (cy + RIM[t][1]) * C + cx + RIM[t][0];
    if (seen && !RIM.every((_, t) => seen[at(t)])) continue;
    let word = 0;
    for (let t = 0; t < 32; t++) word = (word << 1 | sym[at(t)] & 1) >>> 0;
    if (word !== tag(i << 4 | j)) continue;
    for (let d = 0; d < 8; d++) { ones[d] += sym[at(32 + d)] & 1; all[d]++; }
  }
  if (all.some(a => !a)) return null;
  const f = ones.reduce((f, o, d) => f << 1 | (o * 2 > all[d]), 0), n = f >> 2;
  return n >= 1 && n <= NT ? { n, lv: f & 3 } : null;
}

// One tile's bits -> { data (its payload bytes), stream (its corrected bytes) }, or throws
function decodeTile(t, { lv }, sym, seen) {
  const { nb, L } = GEOM[t], nsym = nsymOf(t, lv), k = L - nsym, stream = new Uint8Array(nb * L), gap = new Uint8Array(nb * L);
  TILE_POS[t].forEach((p, i) => { if (i >= nb * L * 8) return; if ((sym[p] ^ MASK[p]) & 1) stream[i >> 3] |= 128 >> (i & 7); if (seen && !seen[p]) gap[i >> 3] = 1; });
  const data = new Uint8Array(nb * k), blk = new Uint8Array(L);
  for (let b = 0; b < nb; b++) {
    const erase = [];
    for (let j = 0; j < L; j++) { blk[j] = stream[j * nb + b]; if (gap[j * nb + b]) erase.push(j); }
    rsDecode(blk, nsym, erase);
    data.set(blk.subarray(0, k), b * k);
    for (let j = 0; j < L; j++) stream[j * nb + b] = blk[j];
  }
  const d = data.length - 4;
  if (new DataView(data.buffer).getUint32(d) !== crc32(data.subarray(0, d))) throw new Error('tile checksum mismatch');
  return { data: data.subarray(0, d), stream };
}

// The tiles' payload bytes, in order -> { name, rgba }
async function assemble(parts) {
  const payload = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((off, p) => (payload.set(p, off), off + p.length), 0);
  const dv = new DataView(payload.buffer), len = dv.getUint32(0);
  if (len > payload.length - 8 || dv.getUint32(4 + len) !== crc32(payload.subarray(4, 4 + len))) throw new Error('checksum mismatch');
  return unpack(await inflate(payload.subarray(4, 4 + len)));
}

// Bits (0 black, 1 white per module, fixed modules ignored) -> { name, rgba }. seen, if given, says
// which modules were read at all; the rest are gaps for the error correction to fill.
export async function decodeGrid(sym, seen) {
  const fmt = format(sym, seen);
  if (!fmt) throw new Error('could not read the format marks');
  const parts = [];
  let bad = 0;
  for (let t = 0; t < fmt.n; t++) try { parts.push(decodeTile(t, fmt, sym, seen).data); } catch { bad++; }
  if (bad) throw new Error(`${bad} of ${fmt.n} tiles too damaged to read`);
  return assemble(parts);
}

// ---- reading: the sheet a part at a time ----

// Each pixel's brightness (its brightest channel), at full size and at half (2 x 2 averaged)
function bright({ data, width: W, height: H }) {
  const V = new Uint8Array(W * H), w = W >> 1, h = H >> 1, half = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) V[i] = Math.max(data[p], data[p + 1], data[p + 2]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * W + 2 * x; half[y * w + x] = V[i] + V[i + 1] + V[i + W] + V[i + W + 1] >> 2; }
  return { V, half, w, h };
}

// Finds bullseyes QR-style in a brightness image: a bright/dark 1:1:3:1:1 run pattern both ways.
// -> [{ x, y, u }], u the pattern's unit in px.
function blobs(V, W, H) {
  // Lit = 40% of the way from the darkest thing nearby to the brightest, so glare that lifts black
  // doesn't hide a target, and a shadow doesn't turn grey paper black. Where there's little
  // contrast (bare paper) it's 40% of the brightest.
  const bs = Math.max(W, H) >> 6, BW = Math.ceil(W / bs), BH = Math.ceil(H / bs);
  const peak = new Uint8Array(BW * BH), low = new Uint8Array(BW * BH).fill(255);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const v = V[i], q = (y / bs | 0) * BW + (x / bs | 0);
    if (v > peak[q]) peak[q] = v;
    if (v < low[q]) low[q] = v;
  }
  const floor = 0.2 * peak.reduce((m, v) => Math.max(m, v), 0);
  const cutoff = f => peak.map((_, q) => {
    let hi = 0, lo = 255;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = q % BW + i, y = (q / BW | 0) + j;
      if (x >= 0 && y >= 0 && x < BW && y < BH) { hi = Math.max(hi, peak[y * BW + x]); lo = Math.min(lo, low[y * BW + x]); }
    }
    return Math.max(hi - lo > 0.3 * hi ? lo + f * (hi - lo) : 0.4 * hi, floor);
  });
  let T;
  const lit = (x, y) => V[y * W + x] > T[(y / bs | 0) * BW + (x / bs | 0)];
  const run = (x, y, dx, dy, v) => { let n = 0; while (x >= 0 && y >= 0 && x < W && y < H && lit(x, y) === v) { x += dx; y += dy; n++; } return n; };
  // Checks the pattern through (x, y) along (dx, dy): [offset to the true centre, unit] or null
  const cross = (x, y, dx, dy) => {
    const r = [];
    for (const s of [-1, 1]) {
      let px = x, py = y;
      for (const v of [true, false, true]) { const n = run(px, py, s * dx, s * dy, v); r.push(n); px += s * dx * n; py += s * dy * n; }
    }
    const c = r[0] + r[3] - 1, u = (c + r[1] + r[2] + r[4] + r[5]) / 7;
    if (u < 1.5 || Math.abs(c - 3 * u) > 1.5 * u || [1, 2, 4, 5].some(i => Math.abs(r[i] - u) > 0.7 * u)) return null;
    return [(r[3] - r[0]) / 2, u];
  };
  const cands = [];
  T = cutoff(0.4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W;) {
      if (!lit(x, y)) { x++; continue; }
      const n = run(x, y, 1, 0, true), mx = x + (n >> 1), h = n >= 4 && cross(mx, y, 1, 0);
      x += n;
      if (!h) continue;
      const cx = Math.round(mx + h[0]), v = cross(cx, y, 0, 1);
      if (!v) continue;
      const cy = Math.round(y + v[0]), h2 = cross(cx, cy, 1, 0);
      if (!h2) continue;
      const fx = cx + h2[0], fy = y + v[0], u = (h2[1] + v[1]) / 2; // the unit from the row and column through the centre: off-centre rows of a turned bullseye cut its middle short
      const c = cands.find(c => Math.abs(c.x / c.n - fx) < 3 * u && Math.abs(c.y / c.n - fy) < 3 * u);
      if (c) { c.x += fx; c.y += fy; c.u += u; c.n++; } else cands.push({ x: fx, y: fy, u, n: 1 });
    }
  }
  return cands.map(c => ({ x: c.x / c.n + 0.5, y: c.y / c.n + 0.5, u: c.u / c.n }));
}

// The homography that best takes the sheet points to the frame points (least squares, on centred
// and scaled coordinates so it stays well conditioned): { to: sheet -> frame, from: frame -> sheet }
function fit(pairs) {
  const norm = pts => {
    const m = [0, 1].map(k => pts.reduce((t, p) => t + p[k], 0) / pts.length);
    return [m, Math.sqrt(pts.reduce((t, p) => t + (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2, 0) / pts.length / 2) || 1];
  };
  const [ms, ss] = norm(pairs.map(p => p[0])), [mf, sf] = norm(pairs.map(p => p[1]));
  const A = Array.from({ length: 8 }, () => new Float64Array(9));
  for (const [[X0, Y0], [x0, y0]] of pairs) {
    const X = (X0 - ms[0]) / ss, Y = (Y0 - ms[1]) / ss, x = (x0 - mf[0]) / sf, y = (y0 - mf[1]) / sf;
    for (const [row, rhs] of [[[X, Y, 1, 0, 0, 0, -X * x, -Y * x], x], [[0, 0, 0, X, Y, 1, -X * y, -Y * y], y]])
      for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) A[i][j] += row[i] * row[j]; A[i][8] += row[i] * rhs; }
  }
  for (let c = 0; c < 8; c++) { // Gauss-Jordan, partial pivoting
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < 8; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j < 9; j++) A[r][j] -= k * A[c][j]; }
  }
  const [a, b, c, d, e, f, g, h] = A.map((r, i) => r[8] / r[i]);
  const I = [e - f * h, c * h - b, b * f - c * e, f * g - d, a - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  const apply = (M, m0, s0, m1, s1) => (x0, y0) => {
    const x = (x0 - m0[0]) / s0, y = (y0 - m0[1]) / s0, w = M[6] * x + M[7] * y + M[8];
    return [m1[0] + s1 * (M[0] * x + M[1] * y + M[2]) / w, m1[1] + s1 * (M[3] * x + M[4] * y + M[5]) / w];
  };
  return { to: apply([a, b, c, d, e, f, g, h, 1], ms, ss, mf, sf), from: apply(I, mf, sf, ms, ss) };
}

// Reads the sheet a frame at a time, close up, in any order. Each frame finds the alignment targets
// it can see, works out where it is on the sheet from their IDs, and votes on every module it sees
// sharply enough. Once the format bits are read it knows how many tiles the cart takes; each tile is
// decoded as soon as enough of it is read (modules not seen yet are gaps the error correction fills),
// and then its modules are known for sure. add(frame) -> the cart, once every tile is in; null till then.
// see() hears each frame's { locks (where in the frame it recognised targets), side (of the paper it's looking at:
// 0 front, 1 back), view (its outline, on the grid), mod (px a module), tiles (one per tile the cart takes: 1 decoded,
// below that how near it is), fresh (tiles decoded this frame) }.
// shaky(module) says whether one was read only faintly, or with frames disagreeing.
const SURE = 0.25; // how sure a module's votes must be to count as read; below it, it's a gap for the error correction
export function sweep() {
  const votes = new Float32Array(C * R), looks = new Uint8Array(C * R), seen = new Uint8Array(C * R), sym = new Uint8Array(C * R);
  const place = new Map(TARGETS.map(([i, j, x, y]) => [i << 4 | j, [x + 0.5, y + 0.5]]));
  const tseen = new Uint32Array(NT), done = new Map(); // per tile: modules read; decoded ones
  const told = new Map(); // format word -> how many targets have said it: every target carries it
  let fmt = null;
  const tiles = () => fmt && Array.from({ length: fmt.n }, (_, t) => done.has(t) ? 1 : Math.min(0.95, tseen[t] / (TILE_POS[t].length * (1 - LEVELS[fmt.lv]))));
  async function add({ data, width: W, height: H }, see = () => {}) {
    // Spots are found at half size (a quarter of the pixels: anything readable is several pixels a
    // module), then targets and data are read at full size
    const { V, half, w, h } = bright({ data, width: W, height: H });
    const cands = blobs(half, w, h).map(c => ({ x: c.x * 2, y: c.y * 2, u: c.u * 2 }));
    const val = (x, y) => V[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
    // Each candidate's ID, if it's a target: try it at every angle (4 degrees apart) and a few
    // scales (curl and blur put its measured size off), keep the one where the bullseye's ring corners land right and the ID's CRC
    // checks. Random data passes both about once in tens of millions of tries.
    let pairs = [];
    const RING = [[2, 2, 0], [-2, 2, 0], [2, -2, 0], [-2, -2, 0], [3, 3, 1], [-3, 3, 1], [3, -3, 1], [-3, -3, 1], [4, 4, 0], [-4, 4, 0], [4, -4, 0], [-4, -4, 0]];
    for (const c of cands) found: for (const sc of [1, 0.92, 1.08]) for (let a = 0; a < 90; a++) {
      // c.u was measured along a scan row, which crosses a turned bullseye's rings at a slant, so it
      // reads a module as 1 / cos(the turn, folded to 0-45 degrees) too wide
      const turn = a * 4 % 90, m = sc * c.u * Math.cos(Math.min(turn, 90 - turn) * Math.PI / 180);
      const co = Math.cos(a * Math.PI / 45) * m, si = Math.sin(a * Math.PI / 45) * m;
      const at = (dx, dy) => val(c.x + dx * co - dy * si, c.y + dx * si + dy * co);
      const white = (at(0, 0) + at(3, 0) + at(-3, 0) + at(0, 3) + at(0, -3)) / 5, black = (at(2, 0) + at(-2, 0) + at(0, 2) + at(0, -2)) / 4, mid = (white + black) / 2;
      if (white - black < 20 || RING.some(([i, j, v]) => at(i, j) > mid !== !!v)) continue;
      let word = 0;
      for (let t = 0; t < 32; t++) word = (word << 1 | (at(...RIM[t]) > mid)) >>> 0;
      const id = word >>> 24;
      if (word === tag(id) && place.has(id)) {
        let f = 0;
        for (let t = 32; t < 40; t++) f = f << 1 | (at(...RIM[t]) > mid);
        if (f >> 2 >= 1 && f >> 2 <= NT) told.set(f, (told.get(f) || 0) + 1);
        pairs.push([place.get(id), [c.x, c.y], id]); break found;
      }
    }
    // The format: what most targets have said so far. A change (an early misread outvoted) starts the tiles over.
    const f = [...told].reduce((a, b) => b[1] > a[1] ? b : a, [0, 0])[0];
    if (f && (!fmt || f !== (fmt.n << 2 | fmt.lv))) { fmt = { n: f >> 2, lv: f & 3 }; done.clear(); }
    // One side of the paper at a time: the side most targets are on (others are misreads)
    const front = pairs.filter(p => !side(p[0][0])).length, on = front * 2 >= pairs.length ? 0 : 1;
    pairs = pairs.filter(p => side(p[0][0]) === on);
    // Where the frame is on the sheet: fit, and while some target is far off the fit (a misread),
    // drop the worst one and fit again. Curl leaves the rest a module or two off a flat fit; the
    // correction below takes that up.
    let fitted = null, good = pairs;
    while (good.length >= 4) {
      fitted = fit(good);
      if (!fitted) break;
      const px = Math.hypot(...[0, 1].map(k => fitted.to(good[0][0][0] + 1, good[0][0][1])[k] - fitted.to(...good[0][0])[k]));
      const miss = good.map(([s, f]) => { const [x, y] = fitted.to(...s); return Math.hypot(x - f[0], y - f[1]); }), worst = miss.indexOf(Math.max(...miss));
      if (miss[worst] < 6 * px) break;
      good = good.filter((_, k) => k !== worst);
    }
    const spread = new Set(good.map(([s]) => s[0])).size > 1 && new Set(good.map(([s]) => s[1])).size > 1;
    if (!fitted || good.length < 4 || !spread) { see({ locks: pairs.map(p => p[1]), side: pairs.length ? on : undefined, tiles: tiles() }); return null; }
    const { from } = fitted, view = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => from(x, y));
    // Paper curls, so the flat fit is off between targets: each target's leftover offset, spread to
    // the lattice points it didn't see (from their neighbours, in the same quarter), and blended
    // across each lattice cell
    const off = LY.map(() => LX.map(() => null));
    for (const [s, f, id] of good) { const [x, y] = fitted.to(...s); off[id & 15][id >> 4] = [f[0] - x, f[1] - y]; }
    const same = (L, a, b, P) => Math.floor(L[a] / P) === Math.floor(L[b] / P); // in the same quarter, P modules a quarter
    for (let pass = 0; pass < 12; pass++) off.forEach((row, j) => row.forEach((v, i) => {
      if (v) return;
      const nb = [[j - 1, i], [j + 1, i], [j, i - 1], [j, i + 1]].filter(([b, a]) => off[b]?.[a] && same(LY, b, j, QR) && same(LX, a, i, QP)).map(([b, a]) => off[b][a]);
      if (nb.length) row[i] = [0, 1].map(k => nb.reduce((t, o) => t + o[k], 0) / nb.length);
    }));
    off.forEach(row => row.forEach((v, i) => row[i] = v || [0, 0]));
    const cell = (L, v, P) => { // v's lattice cell in its own quarter, the nearest one past the outer targets (extrapolating, as the curl goes on)
      const q = Math.floor(v / P), last = L.findLastIndex(l => Math.floor(l / P) === q);
      let i = L.findIndex(l => Math.floor(l / P) === q);
      while (i < last - 1 && L[i + 1] <= v) i++;
      return [i, (v - L[i]) / (L[i + 1] - L[i])];
    };
    const to = (x, y) => {
      const p = fitted.to(x, y), [i, s] = cell(LX, x, QP), [j, t] = cell(LY, y, QR);
      for (const k of [0, 1]) p[k] += (off[j][i][k] * (1 - s) + off[j][i + 1][k] * s) * (1 - t) + (off[j + 1][i][k] * (1 - s) + off[j + 1][i + 1][k] * s) * t;
      return p;
    };
    const step = Math.hypot(...[0, 1].map(k => fitted.to(C / 2 + 1, R / 2)[k] - fitted.to(C / 2, R / 2)[k])); // px a module, about
    // Every module in view that's still needed, sharp enough: lighter or darker than its
    // neighbourhood (16 x 16 modules, half of them white), weighted by how far from it, voting white or black
    const dirty = new Set();
    if (step >= 2.5) {
      const xs = view.map(p => p[0]), ys = view.map(p => p[1]);
      const x0 = Math.max(on * 2 * QP, Math.floor(Math.min(...xs))), x1 = Math.min((on + 1) * 2 * QP, Math.ceil(Math.max(...xs))); // this side's modules only
      const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(R, Math.ceil(Math.max(...ys)));
      const BWb = Math.ceil(C / 16), light = new Float32Array(BWb * Math.ceil(R / 16) * 2), got = [];
      const rad = step >= 4 ? 1 : 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const p = y * C + x, t = TILE_OF[p];
        if (t < 0 || done.has(t)) continue; // data not decoded yet only
        const [fx, fy] = to(x + 0.5, y + 0.5);
        if (fx < 3 || fy < 3 || fx > W - 4 || fy > H - 4) continue;
        let l = 0;
        for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) { const q = ((Math.floor(fy) + j) * W + Math.floor(fx) + i) * 4; l += data[q] + data[q + 1] + data[q + 2]; }
        const b = ((y >> 4) * BWb + (x >> 4)) * 2;
        light[b] += l; light[b + 1]++;
        got.push(p, l);
      }
      for (let k = 0; k < got.length; k += 2) {
        const p = got[k], x = p % C, y = p / C | 0, b = ((y >> 4) * BWb + (x >> 4)) * 2, m = light[b] / light[b + 1];
        votes[p] += Math.max(-1, Math.min(1, (got[k + 1] / m - 1) * 2));
        if (looks[p] < 255) looks[p]++;
        if (!seen[p] && Math.abs(votes[p]) >= SURE) { seen[p] = 1; tseen[TILE_OF[p]]++; }
        dirty.add(TILE_OF[p]);
      }
    }
    // Each tile this frame added to that's read enough to be worth a try, its bits as voted. A
    // decoded tile's modules are then set for sure, to what the error correction made them.
    const fresh = [];
    if (fmt) for (const t of dirty) {
      if (t >= fmt.n || done.has(t) || tseen[t] < TILE_POS[t].length * (1 - LEVELS[fmt.lv]) * 0.98) continue;
      for (const p of TILE_POS[t]) sym[p] = votes[p] > 0 ? 1 : 0;
      try {
        const d = decodeTile(t, fmt, sym, seen);
        done.set(t, d); fresh.push(t);
        TILE_POS[t].forEach((p, i) => { if (i < d.stream.length * 8) { votes[p] = ((d.stream[i >> 3] >> 7 - (i & 7) & 1) ^ MASK[p]) ? 255 : -255; seen[p] = 1; } });
      } catch { }
    }
    see({ locks: pairs.map(p => p[1]), side: on, view, mod: step, tiles: tiles(), fresh });
    if (!fmt || done.size < fmt.n) return null;
    try { return await assemble([...done.keys()].sort((a, b) => a - b).map(t => done.get(t).data)); } catch { told.clear(); fmt = null; done.clear(); return null; } // the format was misread: hear it again
  }
  // shaky(p): read, but faintly or with frames disagreeing: worth another look
  return { add, votes, seen, shaky: p => seen[p] && Math.abs(votes[p]) < 0.5 * looks[p] };
}
