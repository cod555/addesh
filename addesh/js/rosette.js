// Guilloche rosettes: the looping security pattern engraved on banknotes.
// Each one is a single continuous line, so it can "draw itself" as a progress ring.

export function rosettePath({ cx = 50, cy = 50, radius = 37, amp = 7, freq = -23, phase = 0, steps = 1400 } = {}) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = cx + radius * Math.cos(t) + amp * Math.cos(freq * t + phase);
    const y = cy + radius * Math.sin(t) + amp * Math.sin(freq * t + phase);
    d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** A medallion of three nested rosettes, used on the start screen and icons. */
export function medallionPaths() {
  return [
    rosettePath({ radius: 40, amp: 8, freq: -41, steps: 2400 }),
    rosettePath({ radius: 27, amp: 6, freq: -29, steps: 1800, phase: 0.6 }),
    rosettePath({ radius: 14, amp: 4, freq: -17, steps: 1200, phase: 1.1 }),
  ];
}
