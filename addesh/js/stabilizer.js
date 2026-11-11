// Decides when to speak.
// - A note is announced once, after the same class stays on top above the confidence
//   threshold for holdMs. It is not repeated while it stays in view.
// - When it leaves (the "Nothing" class wins for silentHoldMs, or the note has not been on
//   top for releaseMs) the stabilizer reports `removed` once, so the app can say "No banknote"
//   and then stay quiet until a note is shown again.

export class Stabilizer {
  constructor({ threshold = 0.85, holdMs = 800, silentHoldMs = 1200, releaseMs = 1500, isSilent = () => false } = {}) {
    this.threshold = threshold;
    this.holdMs = holdMs;
    this.silentHoldMs = silentHoldMs;
    this.releaseMs = releaseMs;
    this.isSilent = isSilent; // classes that never speak, e.g. "Nothing"
    this.reset();
  }

  reset() {
    this.candidate = null; // class currently building up confidence
    this.since = 0;
    this.current = null; // class already confirmed
    this.lastSeen = 0;
  }

  update(probs, now) {
    let top = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[top]) top = i;
    const p = probs[top];

    if (p >= this.threshold) {
      if (top !== this.candidate) {
        this.candidate = top;
        this.since = now;
      }
    } else {
      this.candidate = null;
    }

    const need = this.candidate !== null && this.isSilent(this.candidate) ? this.silentHoldMs : this.holdMs;
    const progress = this.candidate === null ? 0 : Math.min(1, (now - this.since) / need);
    const hadNote = this.current !== null && !this.isSilent(this.current);
    let announce = null;
    let removed = false;

    if (this.candidate !== null && progress >= 1 && this.candidate !== this.current) {
      this.current = this.candidate;
      this.lastSeen = now;
      if (!this.isSilent(this.current)) announce = this.current;
      else if (hadNote) removed = true;
    }

    if (this.current !== null && announce === null && !removed) {
      if (top === this.current) this.lastSeen = now;
      else if (now - this.lastSeen >= this.releaseMs) {
        if (!this.isSilent(this.current)) removed = true;
        this.current = null;
      }
    }

    let state = 'searching';
    if (this.candidate !== null && this.candidate !== this.current && !this.isSilent(this.candidate)) state = 'candidate';
    else if (this.current !== null && !this.isSilent(this.current)) state = 'confirmed';

    return { state, top, p, candidate: this.candidate, current: this.current, progress, announce, removed };
  }
}
