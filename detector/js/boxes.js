// Draws the detector's boxes over the camera view.
let canvas = null;

export function drawBoxes(stage, video, boxes, labels) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'boxes';
    canvas.setAttribute('aria-hidden', 'true');
    video.after(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !boxes) return;
  const s = Math.max(W / vw, H / vh); // the video is shown with object-fit: cover
  const ox = (W - vw * s) / 2;
  const oy = (H - vh * s) / 2;
  const mirrored = stage.classList.contains('mirrored');
  ctx.font = '600 15px "Readex Pro", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  for (const b of boxes) {
    if (b.p < 0.4) continue;
    const name = labels[b.cls];
    const color = name.startsWith('USD') ? '#6FE0A0' : '#FFB547';
    const w = b.w * s;
    const h = b.h * s;
    let x = ox + b.x * s;
    const y = oy + b.y * s;
    if (mirrored) x = W - x - w;
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    const text = name + '  ' + Math.round(b.p * 100) + '%';
    const tw = ctx.measureText(text).width + 14;
    const lx = Math.min(Math.max(4, x), W - tw - 4);
    const ly = Math.max(70, y - 26);
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly, tw, 24);
    ctx.fillStyle = '#0B2421';
    ctx.fillText(text, lx + 7, ly + 13);
  }
}
