// Finds where the return photo differs from the pickup photo, before the AI is asked anything.
// The two photos are retakes, so first line them up (small shift and zoom), even out the light,
// then compare. Gemma then only has to judge one close-up spot instead of two whole photos;
// a 4B model is unreliable at the second job and much better at the first.

const W = 160;                    // working width for alignment and comparison
const MARGIN = 0.06;              // ignore the outer edge, where retakes never line up

const loadImage = (src) => new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = src; });

function grayOf(img, w) {
  const h = Math.round((img.naturalHeight * w) / img.naturalWidth);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  g = blur(g, w, h, 1);
  // Same brightness and contrast for both photos, so a sunnier retake doesn't count as a change.
  let mean = 0; for (const v of g) mean += v; mean /= g.length;
  let sd = 0; for (const v of g) sd += (v - mean) ** 2; sd = Math.sqrt(sd / g.length) || 1;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] - mean) / sd;
  return { g, w, h };
}

function blur(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}

// Where pixel (x, y) of the pickup photo lands in the return photo, for zoom s and shift (dx, dy).
const mapX = (x, A, s, dx) => (x - A.w / 2) * s + A.w / 2 + dx;
const mapY = (y, A, s, dy) => (y - A.h / 2) * s + A.h / 2 + dy;

function cost(A, B, s, dx, dy, step) {
  let sum = 0, n = 0;
  const x0 = Math.round(A.w * 0.12), x1 = A.w - x0, y0 = Math.round(A.h * 0.12), y1 = A.h - y0;
  for (let y = y0; y < y1; y += step) {
    const by = Math.round(mapY(y, A, s, dy));
    if (by < 0 || by >= B.h) continue;
    for (let x = x0; x < x1; x += step) {
      const bx = Math.round(mapX(x, A, s, dx));
      if (bx < 0 || bx >= B.w) continue;
      sum += Math.abs(A.g[y * A.w + x] - B.g[by * B.w + bx]); n++;
    }
  }
  return n ? sum / n : Infinity;
}

function align(A, B) {
  let best = { c: Infinity, s: 1, dx: 0, dy: 0 };
  for (let s = 0.88; s <= 1.121; s += 0.03)
    for (let dx = -14; dx <= 14; dx += 2)
      for (let dy = -14; dy <= 14; dy += 2) {
        const c = cost(A, B, s, dx, dy, 3);
        if (c < best.c) best = { c, s, dx, dy };
      }
  // Refine around the coarse answer, comparing every pixel this time.
  const coarse = best;
  best = { ...coarse, c: Infinity };
  for (let s = coarse.s - 0.02; s <= coarse.s + 0.021; s += 0.005)
    for (let dx = coarse.dx - 2; dx <= coarse.dx + 2; dx += 0.5)
      for (let dy = coarse.dy - 2; dy <= coarse.dy + 2; dy += 0.5) {
        const c = cost(A, B, s, dx, dy, 1);
        if (c < best.c) best = { c, s, dx, dy };
      }
  return best;
}

// Biggest patch that is clearly different after alignment, as fractions of the pickup photo.
function changedRegion(A, B, t) {
  const { w, h } = A;
  let d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const bx = Math.round(mapX(x, A, t.s, t.dx)), by = Math.round(mapY(y, A, t.s, t.dy));
    d[y * w + x] = bx < 0 || by < 0 || bx >= B.w || by >= B.h ? 0 : Math.abs(A.g[y * w + x] - B.g[by * B.w + bx]);
  }
  d = blur(d, w, h, 2);
  const mx = Math.round(w * MARGIN), my = Math.round(h * MARGIN);
  const inside = [];
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) inside.push(d[y * w + x]);
  inside.sort((a, b) => a - b);
  const median = inside[inside.length >> 1];
  const thr = Math.max(0.55, median * 3.5);
  const seen = new Uint8Array(w * h);
  let top = null;
  for (let y = my; y < h - my; y++) for (let x = mx; x < w - mx; x++) {
    const i = y * w + x;
    if (seen[i] || d[i] < thr) continue;
    // flood-fill one patch
    const stack = [i]; seen[i] = 1;
    let area = 0, mass = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    while (stack.length) {
      const j = stack.pop(), jx = j % w, jy = (j / w) | 0;
      area++; mass += d[j] - thr;
      x0 = Math.min(x0, jx); x1 = Math.max(x1, jx); y0 = Math.min(y0, jy); y1 = Math.max(y1, jy);
      for (const k of [j - 1, j + 1, j - w, j + w]) {
        const kx = k % w, ky = (k / w) | 0;
        if (k < 0 || k >= d.length || seen[k] || d[k] < thr) continue;
        if (kx < mx || kx >= w - mx || ky < my || ky >= h - my) continue;
        seen[k] = 1; stack.push(k);
      }
    }
    if (!top || mass > top.mass) top = { area, mass, box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h] };
  }
  // Tiny specks are noise; a real mark covers at least ~0.3% of the photo.
  if (!top || top.area < w * h * 0.003) return { median, region: null };
  return { median, region: top };
}

// Square-ish close-up around the box, padded so the AI sees some context.
function cropBox([x0, y0, x1, y1], img) {
  const aspect = img.naturalWidth / img.naturalHeight;
  let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let bw = Math.max((x1 - x0) * 2.2, 0.28), bh = Math.max((y1 - y0) * 2.2, 0.28 * aspect);
  bw = Math.min(bw, 1); bh = Math.min(bh, 1);
  cx = Math.min(Math.max(cx, bw / 2), 1 - bw / 2); cy = Math.min(Math.max(cy, bh / 2), 1 - bh / 2);
  return [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2];
}

function crop(img, [x0, y0, x1, y1], size = 448) {
  const sw = (x1 - x0) * img.naturalWidth, sh = (y1 - y0) * img.naturalHeight;
  const k = size / Math.max(sw, sh);
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(sw * k), height: Math.round(sh * k) });
  c.getContext('2d').drawImage(img, x0 * img.naturalWidth, y0 * img.naturalHeight, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}

function outline(img, box) {
  const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const [x0, y0, x1, y1] = box, lw = Math.max(3, c.width / 160), pad = lw * 2;
  g.strokeStyle = '#ff3d6e'; g.lineWidth = lw; g.setLineDash([lw * 3, lw * 2]);
  g.strokeRect(x0 * c.width - pad, y0 * c.height - pad, (x1 - x0) * c.width + 2 * pad, (y1 - y0) * c.height + 2 * pad);
  return c.toDataURL('image/jpeg', 0.88);
}

/**
 * Compare a pickup and a return photo (data URLs or URLs).
 * Returns { aligned, misaligned, region, crops: { before, after }, marked } where `region` is null when
 * nothing on the photo changed beyond light and framing.
 */
export async function findChange(beforeSrc, afterSrc) {
  const [ia, ib] = await Promise.all([loadImage(beforeSrc), loadImage(afterSrc)]);
  const A = grayOf(ia, W), B = grayOf(ib, W);
  const t = align(A, B);
  // After the best alignment, two photos of the same view differ by ~0.2–0.4; different views by 0.8+.
  const misaligned = t.c > 0.75;
  const { region, median } = changedRegion(A, B, t);
  const out = { alignCost: +t.c.toFixed(3), median: +median.toFixed(3), misaligned, region: null };
  if (!region) return out;
  const boxA = region.box;
  // the same spot in the return photo
  const boxB = [mapX(boxA[0] * A.w, A, t.s, t.dx) / B.w, mapY(boxA[1] * A.h, A, t.s, t.dy) / B.h,
    mapX(boxA[2] * A.w, A, t.s, t.dx) / B.w, mapY(boxA[3] * A.h, A, t.s, t.dy) / B.h];
  const cropA = cropBox(boxA, ia);
  const cropB = [mapX(cropA[0] * A.w, A, t.s, t.dx) / B.w, mapY(cropA[1] * A.h, A, t.s, t.dy) / B.h,
    mapX(cropA[2] * A.w, A, t.s, t.dx) / B.w, mapY(cropA[3] * A.h, A, t.s, t.dy) / B.h].map((v) => Math.min(1, Math.max(0, v)));
  out.region = { box: boxB.map((v) => +v.toFixed(3)), size: +(region.area / (A.w * A.h)).toFixed(4), strength: +region.mass.toFixed(1) };
  out.crops = { before: crop(ia, cropA), after: crop(ib, cropB) };
  out.marked = outline(ib, boxB);
  return out;
}
