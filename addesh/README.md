# Addesh (قدّيش؟) — banknote reader

Point a phone at a Lebanese lira, US dollar or euro note and the app says its value out loud, in English or Arabic. It is built for blind and low-vision people, runs the Teachable Machine model on the phone itself, and works offline once opened.

The app has two pages:

- **Scanner** (`index.html`): the camera screen people use.
- **Model Lab** (`lab.html`): for your team. Tests the model on unseen photos and gives you the tables for slides 3, 4 and 5.

## 1. Name the classes in Teachable Machine

The app reads the class names to know what to say, so name them like this (one class per note, both sides of the note in the same class):

| Currency | Class names |
|---|---|
| Lebanese lira | `LBP 5000`, `LBP 10000`, `LBP 20000`, `LBP 50000`, `LBP 100000` |
| US dollar | `USD 1`, `USD 5`, `USD 10`, `USD 20`, `USD 50`, `USD 100` |
| Euro | `EUR 5`, `EUR 10`, `EUR 20`, `EUR 50`, `EUR 100`, `EUR 200` |
| No note | `Nothing` |

Other spellings work too (`20000 LL`, `$20`, `Euro 50`, `Background`). The Model Lab shows how every class name was understood and lets you play what it will say.

## 2. Add your model

The app is connected to the trained model at https://teachablemachine.withgoogle.com/models/jqdKjxKh0/ (12 classes: LBP 5000, 10000, 20000, 50000, 100000; USD 1, 5, 10, 20, 50, 100; Nothing). It is set as `modelUrl` in `js/config.js`.

To switch to a different model later, pick one of these:

- **Model folder (recommended, works offline).** In Teachable Machine: Export Model → TensorFlow.js tab → Download → Download my model. Extract the zip and copy `model.json`, `metadata.json` and `weights.bin` into the `model` folder.
- **Shareable link.** In Teachable Machine: Export Model → TensorFlow.js tab → Upload (shareable link) → Upload my model. Copy the link and paste it as `modelUrl` in `js/config.js`, or in the app under Settings → Model.

## 3. Run it on your Windows computer

The camera only works from `localhost` or an `https://` address, so opening `index.html` by double-clicking won't work.

1. Install Node.js LTS from https://nodejs.org if you don't have it (`node -v` in a terminal tells you).
2. In File Explorer, open the `addesh` folder, click the address bar, type `cmd` and press Enter. A terminal opens in that folder.
3. Run `npx serve .` (type `y` if it asks to install `serve`).
4. Open http://localhost:3000 in Chrome. The Lab is at http://localhost:3000/lab.

## 4. Put it online (needed for phones)

Phones only allow the camera on `https://` links, so the site has to be online.

**Easiest: Vercel Drop (no terminal).**

1. Go to https://vercel.com/drop and sign in with your Vercel account.
2. Drag the whole `addesh` folder (or the `addesh.zip` file) onto the page.
3. Pick your team, type `addesh` as the project name and click **Deploy**.
4. Copy the link it gives you, like `https://addesh.vercel.app`, and open it on your phone in Chrome (Android) or Safari (iPhone).
5. To install it: Chrome menu ⋮ → Add to Home screen, or Safari Share → Add to Home Screen.

After retraining, copy the new model files into `model`, open the project in your Vercel dashboard and drop the folder onto it again to publish the update.

**With the terminal instead:** run `npx vercel`, log in, accept the defaults, then `npx vercel --prod`.

## Using the Model Lab for the slides

| Step in the Lab | What you get | Slide |
|---|---|---|
| 2. Check the training photos | Photos per class table; checks the 100-per-class and 1.5× balance rules | 3 |
| 3. Test on unseen photos | Overall accuracy with the formula, per-class table, confusion matrix, correct and wrong examples | 5 |
| 4. Compare before and after | Accuracy before → after your one change, with epochs, batch size and learning rate | 4 |

Test photos go in one subfolder per class, named like the classes: `test/USD 20/…jpg`, `test/Nothing/…jpg`. Every table has a **Copy table for PowerPoint** button; paste with Ctrl+V and PowerPoint creates a real table. Click any prediction to open a card you can screenshot (Win + Shift + S).

## How it works (for Q&A)

1. The camera frame's centre square is resized to 224 × 224 pixels and scaled to −1…1 with the same code path as Teachable Machine's own library, so the app and the Lab give the same probabilities as Teachable Machine's preview.
2. TensorFlow.js runs the model on the phone (WebGL), up to 8 times a second. Images never leave the device.
3. The frame and its mirror image are both classified and averaged, because Teachable Machine webcam samples are mirrored and phone photos are not.
4. A note is spoken only when the same class stays above 85% confidence for 0.8 seconds, so a flickering prediction is never read out. It is not repeated while the note stays in view.
5. The voice is the phone's own text-to-speech, in English or Arabic. Each currency also has its own chime pitch and vibration pattern (lira one pulse, dollar two, euro three).

The thresholds are in `js/config.js` and in the app's Settings.

## Files

```
index.html, lab.html     the two pages
css/                     styles (base.css shared, scanner.css, lab.css)
js/config.js             settings to edit before deploying
js/model.js              loads the Teachable Machine model and classifies images
js/labels.js             turns class names into displayed and spoken text
js/stabilizer.js         decides when a prediction is stable enough to speak
js/speech.js             voice, chime and vibration
js/scanner.js            the camera screen
js/lab.js, evaluate.js, folders.js, dom.js   the Model Lab
model/                   your model.json, metadata.json, weights.bin
vendor/                  TensorFlow.js 4.22.0 (Apache 2.0)
fonts/                   Readex Pro (SIL Open Font License, see fonts/OFL.txt)
sw.js, manifest.webmanifest, icons/   offline support and home-screen install
vercel.json              hosting headers for Vercel
```
