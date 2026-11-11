// PICO-8 cart <-> printable 8-colour code. No dependencies; runs in browsers and Node 18+.
//
// Code format:
// - C x R modules on black. Data colours are PICO-8 8-15; symbol value = index in PALETTE,
//   ordered so the lookalike pairs (red/pink, orange/yellow, blue/lavender) differ by one bit.
// - corners: 14x14 finder (2 peach, 2 black, 6x6 centre: TL red, TR green, BR yellow, BL blue)
//   inside a 16x16 black block
// - beside each finder: the 8 palette colours as 2x2 swatches (outer two rows), then nsym as
//   three base-8 digits, 2x2 each (next two rows)
// - 5x5 alignment targets (green, black ring, green dot) on a ~32-module lattice
// - data: every other module, row-major, 3 bits each, XORed with mask(). The bytes are NBLK
//   interleaved Reed-Solomon blocks of BLK bytes (nsym parity each) holding
//   u32 len | zlib(raw) | u32 crc32, raw = name | palette | pixel indices | cart bytes,
//   which is enough to rebuild the .p8.png pixel for pixel.

export const C = 295, R = 361; // 0.4 mm modules on a half-letter card
export const PALETTE = [[255, 0, 77], [255, 119, 168], [255, 163, 0], [255, 236, 39], [41, 173, 255], [131, 118, 156], [0, 228, 54], [255, 204, 170], [0, 0, 0]];
const RED = 0, YELLOW = 3, BLUE = 4, GREEN = 6, PEACH = 7, BLACK = 8;
const FMT = 16, SWATCH = 32, DATA = 255; // LAYOUT codes besides the fixed colours 0-8
const N = 160 * 205;

const lattice = n => { const k = Math.ceil((n - 49) / 32) + 1; return Array.from({ length: k }, (_, i) => 24 + Math.floor(i * (n - 49) / (k - 1))); };
export const LX = lattice(C), LY = lattice(R); // alignment target centres
const CORNERS = [[0, 0, RED], [1, 0, GREEN], [1, 1, YELLOW], [0, 1, BLUE]]; // TL TR BR BL

const LAYOUT = new Uint8Array(C * R).fill(DATA);
{
  const set = (x, y, v) => LAYOUT[y * C + x] = v;
  const ring = (dx, dy, n) => Math.min(dx, dy, n - 1 - dx, n - 1 - dy);
  for (const [r, b, col] of CORNERS) {
    for (let dy = 0; dy < 16; dy++) for (let dx = 0; dx < 16; dx++) set(r * (C - 16) + dx, b * (R - 16) + dy, BLACK);
    for (let dy = 0; dy < 14; dy++) for (let dx = 0; dx < 14; dx++) {
      const d = ring(dx, dy, 14) >> 1;
      set(r * (C - 14) + dx, b * (R - 14) + dy, d === 0 ? PEACH : d === 1 ? BLACK : col);
    }
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 16; i++) set((r ? C - 32 : 16) + i, b ? R - 1 - j : j, SWATCH + (i >> 1));
      for (let i = 0; i < 6; i++) set((r ? C - 22 : 16) + i, b ? R - 3 - j : 2 + j, FMT + (i >> 1));
    }
  }
  for (const cy of LY) for (const cx of LX) for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++)
    set(cx - 2 + dx, cy - 2 + dy, ring(dx, dy, 5) === 1 ? BLACK : GREEN);
}
const DATA_POS = [];
LAYOUT.forEach((v, i) => v === DATA && DATA_POS.push(i));
const CAP = DATA_POS.length * 3 >> 3, NBLK = Math.ceil(CAP / 255), BLK = Math.floor(CAP / NBLK);

function mask(n) {
  const m = new Uint8Array(n);
  for (let i = 0, x = 1; i < n; i++) { x = Math.imul(x, 1103515245) + 12345 & 0x7fffffff; m[i] = x >> 16 & 7; }
  return m;
}

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

// Two letter pages for duplex printing (flip on long edge): two fronts, then two backs, with
// dotted cut lines on the front. The cards lie sideways, one above the other, so each fills half
// the sheet. front/back = { w, h, rgb, alpha } pixel buffers.
export async function pdf(front, back) {
  const parts = [], offs = [], enc = new TextEncoder();
  let len = 0;
  const put = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  const obj = (n, dict, stream) => {
    offs[n] = len;
    put(`${n} 0 obj\n<<${dict}${stream ? `/Length ${stream.length}` : ''}>>\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  const W = 612, H = 792, cw = 369, ch = cw * 205 / 160, x = (W - ch) / 2, ys = [18, 405]; // card is cw x ch pt, upright
  const f = v => +v.toFixed(2);
  let p1 = '0.5 G 0.5 w [2 3] 0 d ';
  for (const v of [x, x + ch]) p1 += `${f(v)} 0 m ${f(v)} ${H} l S `;
  for (const v of ys.flatMap(y => [y, y + cw])) p1 += `0 ${v} m ${W} ${v} l S `;
  // Front: card top -> page left. Back: mirrored x, card top -> page right, so it reads upright
  // when the cut card is turned over like a book page.
  for (const y of ys) p1 += `q 0 ${cw} ${f(-ch)} 0 ${f(x + ch)} ${y} cm /I Do Q `;
  const p2 = ys.map(y => `q 0 ${-cw} ${f(ch)} 0 ${f(W - x - ch)} ${y + cw} cm /I Do Q `).join('');
  put('%PDF-1.4\n');
  obj(1, '/Type/Catalog/Pages 2 0 R');
  obj(2, `/Type/Pages/Kids[3 0 R 4 0 R]/Count 2/MediaBox[0 0 ${W} ${H}]`);
  [p1, p2].forEach((c, i) => {
    obj(3 + i, `/Type/Page/Parent 2 0 R/Resources<</XObject<</I ${7 + i} 0 R>>>>/Contents ${5 + i} 0 R`);
    obj(5 + i, '', enc.encode(c));
  });
  for (const [i, im] of [front, back].entries()) {
    const head = `/Type/XObject/Subtype/Image/Width ${im.w}/Height ${im.h}/BitsPerComponent 8/Filter/FlateDecode/ColorSpace`;
    obj(7 + i, `${head}/DeviceRGB/SMask ${9 + i} 0 R`, await deflate(im.rgb));
    obj(9 + i, `${head}/DeviceGray`, await deflate(im.alpha));
  }
  const xref = len;
  put(`xref\n0 11\n0000000000 65535 f \n${offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<</Size 11/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
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

// Corrects c in place; throws when more than nsym/2 bytes are wrong.
function rsDecode(c, nsym) {
  const n = c.length, S = new Uint8Array(nsym);
  let bad = 0;
  for (let j = 0; j < nsym; j++) { let s = 0; for (let i = 0; i < n; i++) s = mul(s, EXP[j]) ^ c[i]; bad |= S[j] = s; }
  if (!bad) return;
  // Berlekamp-Massey -> error locator L, lowest degree first
  let L = new Uint8Array(nsym + 1), B = new Uint8Array(nsym + 1), len = 0, m = 1, b = 1;
  L[0] = B[0] = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i];
    for (let j = 1; j <= len; j++) d ^= mul(L[j], S[i - j]);
    if (!d) { m++; continue; }
    const T = L.slice(), q = div(d, b);
    for (let j = 0; j + m <= nsym; j++) L[j + m] ^= mul(q, B[j]);
    if (2 * len <= i) { len = i + 1 - len; B = T; b = d; m = 1; } else m++;
  }
  const O = new Uint8Array(nsym); // evaluator = S * L mod x^nsym
  for (let i = 0; i < nsym; i++) for (let j = 0; j <= Math.min(i, len); j++) O[i] ^= mul(L[j], S[i - j]);
  let found = 0;
  for (let p = 0; p < n; p++) { // Chien search; p is the power of x, byte index n-1-p
    const xi = EXP[255 - p];
    let l = 0, o = 0, dl = 0;
    for (let j = len; j >= 0; j--) l = mul(l, xi) ^ L[j];
    if (l) continue;
    for (let j = nsym - 1; j >= 0; j--) o = mul(o, xi) ^ O[j];
    for (let j = 1; j <= len; j += 2) dl ^= mul(L[j], EXP[(255 - p) * (j - 1) % 255]);
    if (!dl) break;
    c[n - 1 - p] ^= mul(EXP[p], div(o, dl)); // Forney
    found++;
  }
  if (found !== len) throw new Error('too much damage to correct');
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

// 160x205 RGBA cart pixels -> { grid: Uint8Array(C*R) of PALETTE indices, ecc: parity fraction }
export async function encode(rgba, name) {
  const z = await deflate(pack(rgba, name));
  const k = Math.ceil((z.length + 8) / NBLK), nsym = BLK - k;
  // ponytail: no fallback for carts that don't fit; drop the label image from pack() if this ever fires
  if (nsym < BLK / 10) throw new Error('cart is too big to fit on a card');
  const payload = new Uint8Array(NBLK * k), dv = new DataView(payload.buffer);
  dv.setUint32(0, z.length); payload.set(z, 4); dv.setUint32(4 + z.length, crc32(z));
  const gen = rsGen(nsym), stream = new Uint8Array(NBLK * BLK + 2);
  for (let b = 0; b < NBLK; b++) rsEncode(payload.subarray(b * k, b * k + k), gen).forEach((v, j) => stream[j * NBLK + b] = v);
  const grid = LAYOUT.slice(), m = mask(DATA_POS.length);
  DATA_POS.forEach((pos, i) => {
    const o = i * 3, w = stream[o >> 3] << 8 | stream[(o >> 3) + 1];
    grid[pos] = (w >> 13 - (o & 7) & 7) ^ m[i];
  });
  LAYOUT.forEach((v, i) => {
    if (v >= SWATCH && v < DATA) grid[i] = v - SWATCH;
    else if (v >= FMT && v < SWATCH) grid[i] = nsym >> 6 - 3 * (v - FMT) & 7;
  });
  return { grid, ecc: nsym / BLK };
}

// Symbols (0-7 per module, fixed modules ignored) -> { name, rgba }
export async function decodeGrid(sym) {
  let nsym = 0;
  for (let d = 0; d < 3; d++) {
    const votes = new Array(8).fill(0);
    LAYOUT.forEach((v, i) => v === FMT + d && votes[sym[i] & 7]++);
    nsym = nsym << 3 | votes.indexOf(Math.max(...votes));
  }
  const k = BLK - nsym;
  if (nsym < 2 || k < 1) throw new Error('could not read the format marks');
  const m = mask(DATA_POS.length), stream = new Uint8Array(NBLK * BLK);
  DATA_POS.forEach((pos, i) => {
    const v = (sym[pos] ^ m[i]) & 7;
    for (let j = 0; j < 3; j++) if (v >> 2 - j & 1) stream[i * 3 + j >> 3] |= 128 >> (i * 3 + j & 7);
  });
  const payload = new Uint8Array(NBLK * k), blk = new Uint8Array(BLK);
  for (let b = 0; b < NBLK; b++) {
    for (let j = 0; j < BLK; j++) blk[j] = stream[j * NBLK + b];
    rsDecode(blk, nsym);
    payload.set(blk.subarray(0, k), b * k);
  }
  const dv = new DataView(payload.buffer), len = dv.getUint32(0);
  if (len > payload.length - 8 || dv.getUint32(4 + len) !== crc32(payload.subarray(4, 4 + len))) throw new Error('checksum mismatch');
  return unpack(await inflate(payload.subarray(4, 4 + len)));
}

// ---- photo -> grid ----

// Unit square -> quad [TL, TR, BR, BL], as coefficients of (au+bv+c, du+ev+f) / (gu+hv+1)
export function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

// Finds the four finders QR-style: a bright/dark 1:1:3:1:1 run pattern both ways. The data area
// has no black in it, so there is little else in the code that can match.
function findCorners({ data, width: W, height: H }) {
  // Lit = brighter than 40% of the brightest thing nearby, so a shadow across the card doesn't
  // turn the dimmer colours (lavender is 61% as bright as peach) into black.
  const V = new Uint8Array(W * H), bs = Math.max(W, H) >> 6, BW = Math.ceil(W / bs), BH = Math.ceil(H / bs), peak = new Uint8Array(BW * BH);
  for (let y = 0, i = 0, p = 0; y < H; y++) for (let x = 0; x < W; x++, i++, p += 4) {
    const v = V[i] = Math.max(data[p], data[p + 1], data[p + 2]), q = (y / bs | 0) * BW + (x / bs | 0);
    if (v > peak[q]) peak[q] = v;
  }
  const floor = 0.2 * peak.reduce((m, v) => Math.max(m, v), 0);
  const T = peak.map((_, q) => {
    let m = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = q % BW + i, y = (q / BW | 0) + j;
      if (x >= 0 && y >= 0 && x < BW && y < BH) m = Math.max(m, peak[y * BW + x]);
    }
    return Math.max(0.4 * m, floor);
  });
  const lit = (x, y) => V[y * W + x] > T[(y / bs | 0) * BW + (x / bs | 0)];
  const run = (x, y, dx, dy, v) => { let n = 0; while (x >= 0 && y >= 0 && x < W && y < H && lit(x, y) === v) { x += dx; y += dy; n++; } return n; };
  // Checks the pattern through (x, y) along (dx, dy): [offset to the true centre, module size] or null
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
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W;) {
      if (!lit(x, y)) { x++; continue; }
      const n = run(x, y, 1, 0, true), mx = x + (n >> 1), h = n >= 4 && cross(mx, y, 1, 0);
      x += n;
      if (!h) continue;
      const cx = Math.round(mx + h[0]), v = cross(cx, y, 0, 1);
      if (!v) continue;
      const cy = Math.round(y + v[0]), h2 = cross(cx, cy, 1, 0);
      if (!h2) continue;
      const fx = cx + h2[0], fy = y + v[0], u = h[1];
      const c = cands.find(c => Math.abs(c.x / c.n - fx) < 3 * u && Math.abs(c.y / c.n - fy) < 3 * u);
      if (c) { c.x += fx; c.y += fy; c.n++; } else cands.push({ x: fx, y: fy, n: 1 });
    }
  }
  // The centre colour says which corner it is, so the card can be any way up.
  const quad = CORNERS.map(([, , col]) => {
    let bestC = null;
    for (const c of cands) {
      const p = (Math.round(c.y / c.n) * W + Math.round(c.x / c.n)) * 4, px = [data[p], data[p + 1], data[p + 2]], mx = Math.max(...px, 1);
      const dist = k => PALETTE[k].reduce((s, v, i) => s + (v / Math.max(...PALETTE[k]) - px[i] / mx) ** 2, 0);
      if ([RED, GREEN, YELLOW, BLUE].every(k => dist(col) <= dist(k)) && (!bestC || c.n > bestC.n)) bestC = c;
    }
    return bestC && bestC.n > 1 ? [bestC.x / bestC.n + 0.5, bestC.y / bestC.n + 0.5] : null;
  });
  const n = quad.filter(Boolean).length;
  if (n < 4) throw new Error(`found ${n} of 4 corner marks`);
  return { V, quad };
}

// Photo ({ data: RGBA, width, height }, like ImageData) of a printed card -> { name, rgba }
export async function scan(img) {
  const { data, width: W, height: H } = img, { V, quad } = findCorners(img);
  const [a, b, c, d, e, f, g, h] = squareToQuad(quad); // finder centres sit 7 modules in from each corner
  const map = (x, y) => { const u = (x - 7) / (C - 14), v = (y - 7) / (R - 14), w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  const val = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x < 0 || y < 0 || x >= W || y >= H ? 255 : V[y * W + x]; };

  // Paper curl and lens distortion bend the grid, so measure how far each alignment target is
  // from where the flat mapping puts it. Its black ring is the only black for modules around.
  // ponytail: no outlier rejection; median-filter the offsets if glare throws single targets off
  const disp = LY.map(cy => LX.map(cx => {
    const pts = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) pts.push(map(cx + 0.5 + i, cy + 0.5 + j));
    const s = Math.hypot(pts[5][0] - pts[4][0], pts[5][1] - pts[4][1]), step = Math.max(1, s / 4);
    let best = -Infinity, off = [0, 0];
    for (let dy = -4 * s; dy <= 4 * s; dy += step) for (let dx = -4 * s; dx <= 4 * s; dx += step) {
      let sc = 2 * val(pts[4][0] + dx, pts[4][1] + dy);
      for (const p of pts) sc -= val(p[0] + dx, p[1] + dy);
      if (sc > best) { best = sc; off = [dx, dy]; }
    }
    return off;
  }));
  const at = (x, y) => {
    const p = map(x, y);
    const fx = Math.min(Math.max((x - 24) / (C - 49) * (LX.length - 1), 0), LX.length - 1.001);
    const fy = Math.min(Math.max((y - 24) / (R - 49) * (LY.length - 1), 0), LY.length - 1.001);
    const i = fx | 0, j = fy | 0, s = fx - i, t = fy - j;
    for (const k of [0, 1]) p[k] += (disp[j][i][k] * (1 - s) + disp[j][i + 1][k] * s) * (1 - t) + (disp[j + 1][i][k] * (1 - s) + disp[j + 1][i + 1][k] * s) * t;
    return p;
  };

  // Mean colour at each module centre
  const rad = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) / (C - 14) >= 4 ? 1 : 0;
  const s = new Float32Array(C * R * 3);
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    const [px, py] = at(x + 0.5, y + 0.5), o = (y * C + x) * 3;
    for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) {
      const q = (Math.min(Math.max(Math.floor(py) + j, 0), H - 1) * W + Math.min(Math.max(Math.floor(px) + i, 0), W - 1)) * 4;
      s[o] += data[q]; s[o + 1] += data[q + 1]; s[o + 2] += data[q + 2];
    }
  }
  // Even out lighting: the data is masked to use all 8 colours equally, so the mean colour of
  // any 16x16 block of it is the same grey times the local light.
  const BW = Math.ceil(C / 16), light = new Float32Array(BW * Math.ceil(R / 16) * 4);
  const block = p => (((p / C | 0) >> 4) * BW + (p % C >> 4)) * 4;
  for (const p of DATA_POS) { const q = block(p); for (let k = 0; k < 3; k++) light[q + k] += s[p * 3 + k]; light[q + 3]++; }
  for (let p = 0; p < C * R; p++) { const q = block(p); for (let k = 0; k < 3; k++) s[p * 3 + k] /= light[q + k] / (light[q + 3] || 1) || 1; }

  // Reference colours from the printed swatches, then refined on the data itself (k-means)
  let ref = new Float32Array(32);
  LAYOUT.forEach((v, p) => { if (v >= SWATCH && v < DATA) { const q = (v - SWATCH) * 4; for (let k = 0; k < 3; k++) ref[q + k] += s[p * 3 + k] / 16; } });
  const nearest = p => {
    let best = 0, bd = Infinity;
    for (let k = 0; k < 8; k++) {
      const d = (s[p * 3] - ref[k * 4]) ** 2 + (s[p * 3 + 1] - ref[k * 4 + 1]) ** 2 + (s[p * 3 + 2] - ref[k * 4 + 2]) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  };
  for (let it = 0; it < 3; it++) {
    const acc = new Float32Array(32);
    for (const p of DATA_POS) { const q = nearest(p) * 4; for (let k = 0; k < 3; k++) acc[q + k] += s[p * 3 + k]; acc[q + 3]++; }
    ref = ref.map((v, i) => acc[i | 3] ? acc[i] / acc[i | 3] : v);
  }
  const sym = new Uint8Array(C * R);
  for (let p = 0; p < C * R; p++) if (LAYOUT[p] >= FMT) sym[p] = nearest(p);
  return decodeGrid(sym);
}
