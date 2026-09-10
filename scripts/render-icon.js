'use strict';

/* ══════════════════════════════════════════════════════════════════════
   VORLAGE AUS DER QUELLE ZEICHNEN

   Liest scripts/icon.svg und schreibt scripts/icon-source.png in 1024×1024.
   Aus dieser Vorlage rechnet scripts/make-icons.js alle übrigen Größen.

   Aufruf:  npm run render-icon

   >>> Warum zwei Schritte und nicht einer? <<<
   Eine SVG zeichnen kann nur ein Browser. make-icons.js soll aber mit
   schlichtem node laufen — es gehört zum Bau und läuft auf Rechnern, auf
   denen electron nicht bereitsteht. Deshalb wird hier einmal gezeichnet
   und die Vorlage mit eingecheckt; make-icons.js rechnet danach ohne
   electron weiter.

   Der Aufruf muss über electron laufen, nicht über node:
       electron scripts/render-icon.js
   ══════════════════════════════════════════════════════════════════════ */

const path = require('path');
const fs = require('fs');
const os = require('os');
const png = require('./png.js');

const ROOT = path.join(__dirname, '..');
const QUELLE = path.join(__dirname, 'icon.svg');
const ZIEL = path.join(__dirname, 'icon-source.png');
const KANTE = 1024;

/* Ein Fenster wird auf die Bildschirmgröße gestutzt — ein 1024er Fenster
   kam auf einem 852 Punkte hohen Schirm als 1024×852 zurück, und niemand
   sah es der Datei an. Deshalb ein halb so großes Fenster bei doppeltem
   Maßstab: 512 Punkte passen überall, aufgenommen wird trotzdem 1024. */
const FENSTER = KANTE / 2;

if (!process.versions.electron) {
  console.error('Dieses Script braucht electron, nicht node:');
  console.error('    npm run render-icon');
  process.exit(1);
}

/* Steht ELECTRON_RUN_AS_NODE in der Umgebung, startet electron als
   blosses node und "app" bleibt undefiniert — mit einer Fehlermeldung,
   die nach etwas ganz anderem aussieht. Lieber hier klar sagen, was los
   ist. */
const { app, BrowserWindow } = require('electron');
if (!app) {
  console.error('ELECTRON_RUN_AS_NODE ist gesetzt. Erst leeren, dann erneut aufrufen.');
  process.exit(1);
}

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.disableHardwareAcceleration();
/* Nicht in den Datenordner der echten App schreiben. */
app.setPath('userData', path.join(os.tmpdir(), 'inkwells-icon-render'));

/** Schneidet das Quadrat links oben heraus — dort sitzt das Zeichen. */
function obereEcke(bild, kante) {
  const data = Buffer.alloc(kante * kante * 4);
  for (let y = 0; y < kante; y++) {
    const from = y * bild.width * 4;
    bild.data.copy(data, y * kante * 4, from, from + kante * 4);
  }
  return { width: kante, height: kante, data };
}

app.whenReady().then(async () => {
  if (!fs.existsSync(QUELLE)) {
    console.error('Quelle fehlt: ' + path.relative(ROOT, QUELLE));
    app.exit(1);
    return;
  }

  /* Die Seite wird als Datei geladen, nicht als data:-Adresse — bei
     langen data:-Adressen bricht das Laden ohne Meldung ab. */
  const seite = path.join(__dirname, '.icon-render.html');
  fs.writeFileSync(seite,
    '<style>html,body{margin:0;padding:0;width:' + FENSTER + 'px;height:' + FENSTER + 'px;'
    + 'overflow:hidden;background:transparent}'
    + 'svg{display:block;width:' + FENSTER + 'px;height:' + FENSTER + 'px}</style>'
    + fs.readFileSync(QUELLE, 'utf8'));

  const fenster = new BrowserWindow({
    width: FENSTER, height: FENSTER, show: false, useContentSize: true,
    /* Ohne durchsichtigen Grund stuende hinter den runden Ecken Weiss. */
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  });

  await fenster.loadFile(seite);
  await new Promise(r => setTimeout(r, 500));

  let bild = png.decode((await fenster.capturePage()).toPNG());
  fs.unlinkSync(seite);

  /* Steht der Maßstab auf einem anderen Rechner anders, kommt die Aufnahme
     in einer anderen Größe zurück. Die Vorlage wird eingecheckt und muss
     deshalb überall gleich aussehen. */
  if (bild.width !== KANTE || bild.height !== KANTE) {
    console.log('Aufnahme kam als ' + bild.width + '×' + bild.height
      + ', wird auf ' + KANTE + '×' + KANTE + ' gebracht.');
    if (bild.width !== bild.height) bild = obereEcke(bild, Math.min(bild.width, bild.height));
    bild = png.resize(bild, KANTE, KANTE);
  }

  fs.writeFileSync(ZIEL, png.encode(bild));

  console.log('geschrieben: ' + path.relative(ROOT, ZIEL) + ' (' + KANTE + '×' + KANTE + ')');
  console.log('weiter mit:  npm run make-icons');
  app.exit(0);
}).catch(fehler => {
  console.error('Fehlgeschlagen:', fehler);
  app.exit(1);
});
