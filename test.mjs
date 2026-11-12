// node test.mjs [cart.p8.png]
// Round trips a cart, and the biggest PICO-8 can make, through: PNG read/write, the code
// grid with damage and gaps, a simulated sweep of phone frames, and a photo of each side whole.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { C, R, M, QP, QR, OX, OY, PW, PH, TILES, PALETTE, DATA_POS, side, encode, decodeGrid, sweep, pngDecode, pngEncode } from './p8per.js';

let seed = 8;
const rnd = () => (seed = Math.imul(seed, 1103515245) + 12345 & 0x7fffffff) / 0x80000000;

const { w, h, rgba } = await pngDecode(readFileSync(process.argv[2] || 'carts/status.p8.png'));
assert.deepEqual([w, h], [160, 205]);
assert.deepEqual((await pngDecode(await pngEncode(rgba, w, h))).rgba, rgba);
console.log('png round trip ok');

// A cart of random bytes (k of them, the rest zero) under a label of random colours (l a side)
function noise(k, l) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = i / w | 0, c = x >= 16 && x < 16 + l && y >= 24 && y < 24 + l ? rnd() * 16 | 0 : 5, b = i < k ? rnd() * 256 | 0 : 0;
    out.set([c * 16 & 252 | b >> 4 & 3, 252 - c * 16 | b >> 2 & 3, c * 8 & 252 | b & 3, 252 | b >> 6], i * 4);
  }
  return out;
}
// The biggest cart PICO-8 can make: all 32 KB of it incompressible (a full compressed-code section,
// random sprites, map and sound), under a label of noise
const full = noise(0x8000, 128);

// Unit square -> quad [TL, TR, BR, BL], as coefficients of (au+bv+c, du+ev+f) / (gu+hv+1)
function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

// A fake photo: one side of the sheet (on: 0 front, 1 back) seen in perspective, with curl, uneven
// warm light, blur, noise. quad is where the grid's own corners land (off the frame, for a close-up).
const inTile = (x, y) => TILES.some(([x0, y0, x1, y1]) => x >= x0 && y >= y0 && x < x1 && y < y1);
function photo(grid, W, H, quad, curl, on) {
  const [a, b, c, d, e, f, g, hh] = squareToQuad(quad);
  const A = e - f * hh, B = c * hh - b, Cc = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f, G = d * hh - e * g, Hh = b * g - a * hh, I = a * e - b * d;
  const px = on * 2 * QP - OX / M, py = -OY / M; // the page's corner on the grid
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (const oy of [0.25, 0.75]) for (const ox of [0.25, 0.75]) {
      const X = x + ox, Y = y + oy, wz = G * X + Hh * Y + I, u = (A * X + B * Y + Cc) / wz, v = (D * X + E * Y + F) / wz;
      const mx = u * C + curl * Math.sin(Math.PI * v), my = v * R + curl * Math.sin(Math.PI * u * 2);
      const paper = mx >= px && my >= py && mx < px + PW / M && my < py + PH / M;
      const col = paper && side(mx) === on && inTile(mx, my) ? PALETTE[grid[(my | 0) * C + (mx | 0)]] : paper ? [250, 248, 240] : [200, 180, 150];
      const lightness = 0.6 + 0.4 * Math.min(1, Math.max(0, u * 2 - on));
      [1, 0.94, 0.82].forEach((cast, k) => acc[k] += (25 + col[k] * 0.85) * cast * lightness / 4);
    }
    const o = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) data[o + k] = acc[k] + (rnd() - 0.5) * 16;
    data[o + 3] = 255;
  }
  return { data, width: W, height: H };
}

// Where the code's corners land for a frame looking at module (x, y) at s px a module, turned t
// radians, the far side shrunk by tilt
function aim(W, H, x, y, s, t, tilt) {
  return [[0, 0], [C, 0], [C, R], [0, R]].map(([u, v]) => {
    const dx = (u - x) * s, dy = (v - y) * s, k = 1 / (1 + tilt * dy / H);
    return [W / 2 + (dx * Math.cos(t) - dy * Math.sin(t)) * k, H / 2 + (dx * Math.sin(t) + dy * Math.cos(t)) * k];
  });
}

for (const [label, cart] of [['cart', rgba], ['the biggest cart PICO-8 can make', full]]) {
  const code = await encode(cart, 'test'), { grid } = code;

  // Damage and gaps: a scuff, misreads, and part of the sheet never seen. A tile corrects on its own,
  // so the scuff all lands on one: 1 cm with 15% error correction or more, 5 mm with 10%.
  const hurt = grid.slice(), seen = new Uint8Array(C * R).fill(1), d = Math.round((code.ecc >= 0.15 ? 100 : 50) / M);
  for (let y = 40; y < 40 + d; y++) for (let x = 30; x < 30 + d; x++) hurt[y * C + x] = 0;
  assert.deepEqual((await decodeGrid(hurt)).rgba, cart);
  const noisy = grid.slice(); // misreads: about a fifth of what the error correction can fix, on average
  for (let i = 0; i < C * R * Math.min(0.01, code.ecc / 40); i++) noisy[rnd() * C * R | 0] = rnd() * 2 | 0;
  assert.deepEqual((await decodeGrid(noisy)).rgba, cart);
  const gaps = Math.min(0.3, code.ecc * 0.3); // a gap spoils its whole byte, so spread gaps cost about 8 times their share
  const holed = grid.slice();
  for (const p of DATA_POS) if (rnd() < gaps / 8) { seen[p] = 0; holed[p] = 0; }
  assert.deepEqual((await decodeGrid(holed, seen)).rgba, cart);
  console.log(`${label}: ${code.tiles} tiles on ${code.sides} side${code.sides > 1 ? 's' : ''}, ${Math.round(code.ecc * 100)}% error correction; grid with damage, and with gaps, ok`);

  // A sweep: 1080 x 1920 frames from a phone at about 13 cm (4 px a module), each turned any which
  // way, aimed as a person following the outlines would: at the tiles not decoded yet, in turn, a
  // bit off centre
  let t = Date.now(), frames = 0, got = null, next = 0;
  const sw = sweep(), info = {};
  while (!got && frames < 40) {
    const todo = (info.tiles?.some(v => v < 1) ? info.tiles : [0]).flatMap((v, k) => v < 1 ? [k] : []), [x0, y0, x1, y1] = TILES[todo[next++ % todo.length]];
    frames++;
    got = await sw.add(photo(grid, 1080, 1920, aim(1080, 1920, (x0 + x1) / 2 + (rnd() - 0.5) * 30, (y0 + y1) / 2 + (rnd() - 0.5) * 30, 4, rnd() * 2 * Math.PI, 0.15), 0.7, side(x0)), i => Object.assign(info, i));
  }
  if (got) { assert.deepEqual(got.rgba, cart); console.log(`  sweep, 1080p frames: ok after ${frames} frames (${Date.now() - t} ms incl. rendering)`); }
  else { console.log(`  sweep, 1080p frames: FAILED after ${frames} frames, tiles ${(info.tiles || []).map(v => Math.round(v * 9)).join('')}`); process.exitCode = 1; }

  // A photo of each side whole, upside down: a sweep of a frame or two
  t = Date.now();
  const sw2 = sweep();
  let one = null;
  for (let on = 0; on < code.sides && !one; on++) one = await sw2.add(photo(grid, 4284, 5712, aim(4284, 5712, on * 2 * QP + QP - 11, QR - 11, 7.4, Math.PI + 0.05, 0.1), 2, on), i => Object.assign(info, i));
  if (one) { assert.deepEqual(one.rgba, cart); console.log(`  24 MP photo of each side: ok (${Date.now() - t} ms incl. rendering)`); }
  else { console.log(`  24 MP photo of each side: FAILED, tiles ${(info.tiles || []).map(v => Math.round(v * 9)).join('')}`); process.exitCode = 1; }
}
