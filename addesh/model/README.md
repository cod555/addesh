# Model

The app loads the trained Teachable Machine model from its shareable link
(set in `js/config.js`):

https://teachablemachine.withgoogle.com/models/jqdKjxKh0/

12 classes: LBP 5000, LBP 10000, LBP 20000, LBP 50000, LBP 100000,
USD 1, USD 5, USD 10, USD 20, USD 50, USD 100, Nothing.

To run fully offline instead, export the model from Teachable Machine
(TensorFlow.js -> Download), put model.json, metadata.json and the .bin
file in this folder, and set `modelUrl: './model/'` in `js/config.js`.
