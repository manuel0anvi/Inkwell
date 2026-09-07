const os = require('os');
const path = require('path');

const outputDir = path.join(os.homedir(), 'AppData', 'Local', 'Inkwells', 'dist');

/* ── Store-Bau (MSIX/appx) ────────────────────────────────────────────
   Der gewoehnliche "npm run build" baut wie bisher NUR den
   NSIS-Installierer. Das Store-Paket entsteht mit "npm run build-store"
   und setzt dafuer INKWELLS_STORE.

   Warum getrennt: das MSIX ist ohne die drei Kennungen unten wertlos,
   und wer nur schnell eine Fassung zum Weitergeben braucht, soll nicht
   jedes Mal auf ein Paket warten, das er gar nicht hochlaedt.

   >>> DIE DREI KENNUNGEN STAMMEN AUS PARTNER CENTER <<<
   Sie stehen dort unter "Produktidentitaet", nachdem der Name reserviert
   ist. Ohne sie lehnt der Store das Paket ab - es sind keine Geheimnisse,
   sie stehen spaeter oeffentlich in der Store-Eintragung.

       identityName          -> Package/Identity/Name
       publisher             -> Package/Identity/Publisher
       publisherDisplayName  -> Package/Properties/PublisherDisplayName

   scripts/build-release.js bricht ab, solange hier noch PLATZHALTER
   steht - sonst entstuende ein Paket, das der Store stumm zurueckweist. */
const STORE = process.env.INKWELLS_STORE === '1';

const APPX_IDENTITY = {
  identityName: 'Inkwells.Inkwells',
  publisher: 'CN=641C6486-C859-4269-92DA-078D86AB80F1',
  publisherDisplayName: 'Inkwells'
};

module.exports = {
  appId: 'com.inkwells.app',
  productName: 'Inkwells',
  icon: 'icon.ico',
  win: {
    target: STORE
      ? [{ target: 'appx', arch: ['x64'] }]
      : [{ target: 'nsis', arch: ['x64'] }],
    icon: 'icon.ico',
    fileAssociations: [
      {
        ext: 'jrnl',
        name: 'Inkwells Notebook',
        description: 'Inkwells Notebook File',
        icon: 'icon.ico',
        role: 'Editor'
      }
    ]
  },
  /* ── Der Installierer muss die ALTE Installation finden ─────────────
     >>> Warum hier eine feste Kennung steht <<<
     electron-builder leitet die Kennung, unter der Windows eine
     Installation fuehrt, aus der appId ab (UUID v5). Die appId hiess bis
     einschliesslich 1.1.1 "com.inkwell.app" und heisst seit der
     Umbenennung "com.inkwells.app" - zwei verschiedene Kennungen:

         com.inkwell.app   A07D0FC5-B61A-55E8-BC91-8AB2C00FDFA9
         com.inkwells.app  B59081C2-AA4F-5227-900F-CFC147B9D9BA

     Ohne diese Zeile faende der Installierer die vorhandene Fassung
     nicht und legte eine ZWEITE daneben: "Inkwell" bliebe stehen,
     "Inkwells" kaeme dazu, zwei Eintraege in der App-Liste, zwei
     Verknuepfungen. Und weil die neue Fassung beim Start den Datenordner
     umbenennt (migriereAltenDatenordner in main.js), startete die alte
     danach mit leeren Einstellungen.

     Eingetragen ist deshalb die Kennung der ALTEN appId. Sie bleibt in
     alle Zukunft stehen - sie ist jetzt die Kennung dieser App, und ein
     Wechsel wuerde denselben Bruch ein zweites Mal ausloesen. */
  nsis: {
    guid: 'A07D0FC5-B61A-55E8-BC91-8AB2C00FDFA9',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    perMachine: false
  },

  /* ── Das Store-Paket ────────────────────────────────────────────────
     backgroundColor faerbt die Kachel HINTER dem Zeichen. Die Bilder in
     build/appx/ sind durchsichtig freigestellt (scripts/make-icons.js),
     ohne diese Farbe stuende das Gold auf Weiss und verschwaende fast.

     languages: die App spricht diese drei, siehe website/js/i18n.js.
     Der Store zeigt die Eintragung danach in den passenden Maerkten.

     >>> Warum die App "Inkwells" heisst und nicht "Inkwell" <<<
     "Inkwell" war im Store schon vergeben. Partner Center prueft beim
     Hochladen, ob der Anzeigename im Paket zu einem reservierten Namen
     passt - deshalb hiess zuerst nur der Store-Eintrag so.

     Inzwischen traegt die ganze App den Namen: Programmdatei, Datenordner,
     Protokoll, appId. Wer von einer aelteren Fassung kommt, wird beim
     Start umgezogen (migriereAltenDatenordner in main.js). */
  appx: {
    ...APPX_IDENTITY,
    applicationId: 'Inkwells',
    displayName: 'Inkwells',
    backgroundColor: '#0c0e18',
    languages: ['de-DE', 'en-US', 'it-IT'],
    artifactName: 'Inkwells ${version}.${ext}'
  },
  // node_modules steht hier bewusst NICHT.
  //
  // electron-builder nimmt die Laufzeit-Abhaengigkeiten von sich aus mit
  // und laesst die devDependencies weg. Ein ausdrueckliches Muster ueber
  // node_modules hebt genau diese Filterung auf - firebase, esbuild, yjs
  // und electron-builder selbst wanderten dadurch mit in den Installer,
  // obwohl die App keine davon zur Laufzeit braucht.
  files: [
    'main.js',
    'preload.js',
    'src/**/*',
    'icon.ico'
  ],
  directories: {
    output: outputDir
  }
};