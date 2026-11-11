// node test.mjs [cart.p8.png]
// Round trips a cart through: PNG read/write, the code grid with damage, and simulated phone photos.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { C, R, PALETTE, encode, decodeGrid, scan, pngDecode, pngEncode, squareToQuad } from './p8per.js';

let seed = 8;
const rnd = () => (seed = Math.imul(seed, 1103515245) + 12345 & 0x7fffffff) / 0x80000000;

const { w, h, rgba } = await pngDecode(readFileSync(process.argv[2] || 'carts/status.p8.png'));
assert.deepEqual([w, h], [160, 205]);
assert.deepEqual((await pngDecode(await pngEncode(rgba, w, h))).rgba, rgba);
console.log('png round trip ok');

const { grid, ecc } = await encode(rgba, 'test');
const hurt = grid.slice();
for (let y = 150; y < 175; y++) for (let x = 100; x < 125; x++) hurt[y * C + x] = 0; // 1 cm scuff
for (let i = 0; i < C * R / 100; i++) hurt[rnd() * C * R | 0] = rnd() * 8 | 0; // 1% misreads
const back = await decodeGrid(hurt);
assert.equal(back.name, 'test');
assert.deepEqual(back.rgba, rgba);
console.log(`grid round trip ok, ${Math.round(ecc * 100)}% error correction`);

// A fake photo: the card seen in perspective on a table, with curl, uneven warm light, blur, noise.
function photo(W, H, quad, curl) {
  const [a, b, c, d, e, f, g, hh] = squareToQuad(quad);
  // inverse of [[a,b,c],[d,e,f],[g,hh,1]]
  const A = e - f * hh, B = c * hh - b, Cc = b * f - c * e, D = f * g - d, E = a - c * g, F = c * d - a * f, G = d * hh - e * g, Hh = b * g - a * hh, I = a * e - b * d;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const acc = [0, 0, 0];
    for (const oy of [0.1, 0.5, 0.9]) for (const ox of [0.1, 0.5, 0.9]) {
      const X = x + ox, Y = y + oy, wz = G * X + Hh * Y + I, u = (A * X + B * Y + Cc) / wz, v = (D * X + E * Y + F) / wz;
      const mx = u * C + curl * Math.sin(Math.PI * v), my = v * R + curl * Math.sin(Math.PI * u);
      const col = mx >= 0 && my >= 0 && mx < C && my < R ? PALETTE[grid[(my | 0) * C + (mx | 0)]]
        : mx > -15 && my > -15 && mx < C + 15 && my < R + 41 ? [0, 0, 0] : [200, 180, 150];
      const lightness = 0.6 + 0.4 * u;
      [1, 0.94, 0.82].forEach((cast, k) => acc[k] += (25 + col[k] * 0.85) * cast * lightness / 9);
    }
    const o = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) data[o + k] = acc[k] + (rnd() - 0.5) * 16;
    data[o + 3] = 255;
  }
  return { data, width: W, height: H };
}

for (const [label, W, H, quad, curl] of [
  ['12 MP photo, tilted, curled', 4000, 3000, [[900, 300], [3050, 420], [3200, 2800], [760, 2650]], 1.5],
  ['4K video frame, card sideways', 3840, 2160, [[3200, 250], [3250, 1900], [800, 2000], [850, 180]], 1],
  ['1080p video frame, card sideways', 1920, 1080, [[1700, 100], [1720, 980], [220, 1000], [240, 80]], 0.5],
]) {
  const t = Date.now();
  try {
    assert.deepEqual((await scan(photo(W, H, quad, curl))).rgba, rgba);
    console.log(`${label}: ok (${Date.now() - t} ms incl. rendering)`);
  } catch (err) {
    console.log(`${label}: FAILED, ${err.message}`);
    process.exitCode = 1;
  }
}
