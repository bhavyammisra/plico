// Refraction map for the liquid glass lens, drawn to the lens's exact size so the curved edge is
// the same all the way round. Red and green hold how far each pixel's view is shifted (128 = none):
// the middle stays clear, and only a rim `bezel` px wide bends the rows beneath it, like a pane of
// glass with rounded edges.

const cache = new Map();

export function lensMap(w, h, radius = 14, bezel = 12) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const key = `${w}x${h}`;
  if (cache.has(key)) return cache.get(key);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const r = Math.min(radius, w / 2, h / 2), hx = w / 2, hy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance to the rounded rectangle's edge, and the direction straight out of it
      const px = x + 0.5 - hx, py = y + 0.5 - hy;
      const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
      let nx = 0, ny = 0, inside;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        inside = r - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        inside = r - qx;
        nx = Math.sign(px);
      } else {
        inside = r - qy;
        ny = Math.sign(py);
      }
      let dx = 0, dy = 0;
      if (inside > 0 && inside < bezel) {
        // bends most at the very edge and fades smoothly to nothing where the flat middle starts
        const k = (1 - inside / bezel) ** 2;
        // look inwards near the edge, so the rim gathers what is under the middle of the row
        dx = -nx * k;
        dy = -ny * k;
      }
      const i = (y * w + x) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  cache.set(key, url);
  return url;
}
