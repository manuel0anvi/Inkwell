'use strict';

/* ══════════════════════════════════════════════════════════════════════
   ANWENDUNGSZEICHEN IN ALLE GRÖSSEN RECHNEN

   Die Vorlage (scripts/icon-source.png) ist das fertige Zeichen in
   1024×1024: die goldene Fläche mit gerundeten Ecken, darauf die Feder in
   Navy. Aussen um die Ecken herum ist sie durchsichtig.

   Erzeugt wird sie aus scripts/icon.svg mit `npm run render-icon`. Dort
   wird das Zeichen geändert, nicht hier und nicht in den Ergebnissen.

   Dieses Script schreibt:
       website/icon.png    das Zeichen für Kopfzeile, Startseite, Reiter
       website/icon.ico    dasselbe als Symboldatei für den Browser
       icon.ico            dasselbe für den Anwendungsbau (electron-builder)
       build/appx/         die Kacheln für das Store-Paket

   Aufruf:  npm run make-icons

   >>> Warum hier nicht mehr freigestellt wird <<<
   Früher war die Vorlage ein goldenes Zeichen auf dunklem Grund, und
   dieses Script rechnete den Grund heraus. Seit das Zeichen selbst eine
   Fläche hat, wäre das falsch: die goldene Fläche IST das Zeichen. Die
   Vorlage kommt fertig aus der SVG und wird nur noch verkleinert.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const png = require('./png.js');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(__dirname, 'icon-source.png');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/* ── Symboldatei (.ico) ──────────────────────────────────────────────
   Bis 128 Bildpunkte als BMP, die 256er als eingebettetes PNG. Genau so
   machen es die üblichen Werkzeuge: alte Windows-Fassungen verstehen im
   Symbolverzeichnis kein PNG, für 256 wäre BMP dagegen unnötig groß.
   ─────────────────────────────────────────────────────────────────── */

/** 32-Bit-BMP ohne Dateikopf, von unten nach oben, wie im ICO verlangt. */
function bmpFor(image) {
  const { width, height, data } = image;

  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);   // Farb- und Maskenteil zusammen
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);          // unkomprimiert

  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const from = (source * width + x) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = data[from + 2];        // Blau
      pixels[to + 1] = data[from + 1];    // Grün
      pixels[to + 2] = data[from];        // Rot
      pixels[to + 3] = data[from + 3];
    }
  }

  // Die Maske wird bei 32 Bit nicht ausgewertet, muss aber dastehen.
  const maskStride = Math.ceil(width / 8 / 4) * 4;
  const mask = Buffer.alloc(maskStride * height);

  return Buffer.concat([header, pixels, mask]);
}

function buildIco(entries) {
  const directory = Buffer.alloc(6 + entries.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(entries.length, 4);

  let offset = directory.length;
  entries.forEach((entry, index) => {
    const at = 6 + index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0;
    directory[at + 3] = 0;
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.body.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.body.length;
  });

  return Buffer.concat([directory, ...entries.map(e => e.body)]);
}

/* ── Kacheln für das Store-Paket (MSIX/appx) ─────────────────────────
   Der Store zeigt das Zeichen in mehreren Größen: im Startmenü, in der
   Taskleiste, in der Store-Liste und beim Starten. Fehlt eine davon,
   legt electron-builder sein eigenes Beispielbild unter – dann stünde
   im Startmenü das Electron-Zeichen statt unserem.

   Die Kacheln sind NICHT alle quadratisch. Das Zeichen wird deshalb
   mittig auf die jeweilige Fläche gelegt, statt es zu verzerren.

   Der Rand ringsum ist durchsichtig und bleibt es. Dahinter steht die
   backgroundColor aus electron-builder.config.js – das Navy der Marke.
   Ohne diesen Abstand klebte die goldene Fläche an der Kachelkante.
   ─────────────────────────────────────────────────────────────────── */

const APPX_DIR = path.join(ROOT, 'build', 'appx');

/* Anteil der kürzeren Kante, den das Zeichen einnimmt. Die kleinen
   Größen bekommen mehr, sonst bleibt bei 44 Bildpunkten zu wenig übrig,
   um noch etwas zu erkennen. */
const APPX_TILES = [
  { name: 'Square44x44Logo.png',   w:  44, h:  44, anteil: 0.90 },
  { name: 'StoreLogo.png',         w:  50, h:  50, anteil: 0.90 },
  { name: 'Square71x71Logo.png',   w:  71, h:  71, anteil: 0.75 },
  { name: 'Square150x150Logo.png', w: 150, h: 150, anteil: 0.66 },
  { name: 'Square310x310Logo.png', w: 310, h: 310, anteil: 0.66 },
  { name: 'Wide310x150Logo.png',   w: 310, h: 150, anteil: 0.66 },
  { name: 'SplashScreen.png',      w: 620, h: 300, anteil: 0.55 }
];

/** Legt das quadratische Zeichen mittig auf eine durchsichtige Fläche. */
function aufFlaeche(square, breite, hoehe, anteil) {
  const kante = Math.max(1, Math.round(Math.min(breite, hoehe) * anteil));
  const scaled = png.resize(square, kante, kante);

  const data = Buffer.alloc(breite * hoehe * 4);   // alloc: rundum durchsichtig
  const offsetX = Math.round((breite - kante) / 2);
  const offsetY = Math.round((hoehe - kante) / 2);

  for (let y = 0; y < kante; y++) {
    const from = y * kante * 4;
    const to = ((offsetY + y) * breite + offsetX) * 4;
    scaled.data.copy(data, to, from, from + kante * 4);
  }

  return { width: breite, height: hoehe, data };
}

function writeAppxAssets(square) {
  fs.mkdirSync(APPX_DIR, { recursive: true });

  for (const tile of APPX_TILES) {
    const bild = aufFlaeche(square, tile.w, tile.h, tile.anteil);
    fs.writeFileSync(path.join(APPX_DIR, tile.name), png.encode(bild));
  }

  console.log('geschrieben: build/appx/ (' + APPX_TILES.length + ' Kacheln)');
}

/* ── Ablauf ─────────────────────────────────────────────────────────── */

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Vorlage fehlt: ' + path.relative(ROOT, SOURCE));
    console.error('Erst zeichnen lassen:  npm run render-icon');
    process.exit(1);
  }

  const square = png.decode(fs.readFileSync(SOURCE));
  console.log(`Vorlage: ${square.width}×${square.height}`);

  /* Nicht quadratisch heisst: die Vorlage stammt nicht aus icon.svg. Dann
     würden alle Ergebnisse verzerrt, und zwar unauffällig. */
  if (square.width !== square.height) {
    console.error('Die Vorlage muss quadratisch sein, ist aber '
      + square.width + '×' + square.height + '.');
    console.error('Neu zeichnen lassen:  npm run render-icon');
    process.exit(1);
  }

  const webPng = png.resize(square, 512, 512);
  fs.writeFileSync(path.join(ROOT, 'website', 'icon.png'), png.encode(webPng));
  console.log('geschrieben: website/icon.png');

  const entries = ICO_SIZES.map(size => {
    const scaled = png.resize(square, size, size);
    return { size, body: size >= 256 ? png.encode(scaled) : bmpFor(scaled) };
  });

  const ico = buildIco(entries);
  fs.writeFileSync(path.join(ROOT, 'website', 'icon.ico'), ico);
  fs.writeFileSync(path.join(ROOT, 'icon.ico'), ico);
  console.log('geschrieben: website/icon.ico und icon.ico (' + ICO_SIZES.join(', ') + ')');

  writeAppxAssets(square);
}

main();
