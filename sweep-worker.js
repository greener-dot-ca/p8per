// The sweep, off the page's thread: camera frames in, what each one changed out, so the page stays
// smooth while frames are read. Per frame it posts { info, cart, patch }: the sweep's report, the
// cart once there's enough, and the patch of the sheet the frame touched (one code per module: 0
// black, 1 white, 2 shaky, 3 not read yet) with the shaky flag of each 16 x 16 tile in it.
import { C, R, QP, TILES, sweep } from './p8per.js';

const TS = 16;
let sw = sweep();
onmessage = async ({ data: { frame } }) => {
  const info = {};
  let cart;
  try { cart = await sw.add(frame, i => Object.assign(info, i)); } catch (err) { postMessage({ error: String(err) }); return; } // or the page waits forever
  let patch = null;
  if (info.view && !cart) { // what's in view, and any tile decoded this frame (its modules all set now, some maybe out of view)
    const pts = [...info.view, ...info.fresh.flatMap(t => [TILES[t].slice(0, 2), TILES[t].slice(2)])], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.max(info.side * 2 * QP, Math.floor(Math.min(...xs) / TS) * TS), x1 = Math.min((info.side + 1) * 2 * QP, Math.ceil(Math.max(...xs) / TS) * TS); // the side in view
    const y0 = Math.max(0, Math.floor(Math.min(...ys) / TS) * TS), y1 = Math.min(R, Math.ceil(Math.max(...ys) / TS) * TS);
    const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0), cells = new Uint8Array(w * h), tiles = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const p = y * C + x;
      cells[(y - y0) * w + x - x0] = !sw.seen[p] ? 3 : sw.shaky(p) ? 2 : sw.votes[p] > 0 ? 1 : 0;
    }
    for (let ty = y0; ty < y1; ty += TS) for (let tx = Math.floor(x0 / TS) * TS; tx < x1; tx += TS) { // a square is rough when over 3% of what's read there is shaky
      let read = 0, shaky = 0;
      for (let y = ty; y < Math.min(y1, ty + TS); y++) for (let x = Math.max(x0, tx); x < Math.min(x1, tx + TS); x++) {
        const c = cells[(y - y0) * w + x - x0];
        if (c !== 3) { read++; shaky += c === 2; }
      }
      tiles.push([(ty / TS) * Math.ceil(C / TS) + tx / TS, shaky > 0.03 * read]);
    }
    patch = { x0, y0, w, h, cells, tiles };
  }
  postMessage({ info, cart, patch }, patch ? [patch.cells.buffer] : []);
};
