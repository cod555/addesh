// Addesh settings. Edit these before you deploy.

export const CONFIG = {
  appName: 'Addesh',

  // Where your Teachable Machine model lives. Two options:
  //   './model/'  copy model.json, metadata.json and weights.bin into the /model folder (works offline)
  //   or paste your shareable link, e.g. 'https://teachablemachine.withgoogle.com/models/AbCdEf123/'
  // Anyone can also override it for one visit with ?model=<link or ID> in the address bar.
  // Built-in model (files in ./model/). Trained in Teachable Machine: https://teachablemachine.withgoogle.com/models/jqdKjxKh0/
  modelUrl: './model/',

  // How sure the model must be (0 to 1) before a note counts as recognised.
  threshold: 0.85,

  // How long (milliseconds) the same note must stay recognised before it is spoken.
  holdMs: 800,

  // Also classify the mirrored image and average both. Webcam samples in Teachable
  // Machine are mirrored, phone photos are not; this makes the app work with both.
  mirrorCheck: true,

  // Minimum gap between two predictions (milliseconds). 120 ms is about 8 per second.
  inferenceIntervalMs: 120,
};
