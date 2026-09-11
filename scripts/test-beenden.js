#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   Prüft, dass die App beim Schließen NICHT über ungesicherte Arbeit
   hinweggeht.

   >>> Worum es geht <<<
   AutoSave._saveNotebook() wirft nicht, es LIEFERT den Fehler zurück
   ({ success: false, error }). _saveAllDirty sammelt diese Rückgaben nur
   ein. Der Beenden-Handler wartete darauf und warf das Ergebnis weg –
   am Ende stand bedingungslos confirmQuit(). Ist die Platte voll, der
   Speicherordner nicht mehr erreichbar oder das Schreibrecht weg, schloss
   sich die App also mit genau der Arbeit im Arm, die sie in diesem
   Augenblick hätte retten sollen. Ohne Rückfrage, ohne zweiten Anlauf.

   Geprüft wird die ECHTE Funktion aus src/core/init.js – herausgeschnitten
   und in einer Attrappenumgebung ausgeführt, wie es scripts/test-umzug.js
   mit dem Hauptprozess tut. Ein Browser ist dafür nicht nötig: der
   Handler kennt nur window.api, AutoSave und die Rückfrage.

   Aufruf:  node scripts/test-beenden.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const quelle = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'core', 'init.js'), 'utf8');

/** Schneidet eine Funktion samt Körper aus dem Quelltext. */
function extract(name) {
  const start = quelle.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Funktion ${name} nicht gefunden`);

  let depth = 0, seen = false;
  for (let i = start; i < quelle.length; i++) {
    const ch = quelle[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return quelle.slice(start, i + 1);
    }
  }
  throw new Error(`Ende von ${name} nicht gefunden`);
}

let failed = 0;
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${JSON.stringify(expected)}`);
    console.error(`      bekommen: ${JSON.stringify(actual)}`);
  }
}

/**
 * Führt den echten Beenden-Handler einmal aus.
 *
 * @param {object} o
 * @param {boolean} o.speichernGeht  ob FileManager es schafft
 * @param {boolean} o.antwort        was der Nutzer auf die Rückfrage sagt
 * @returns {object} was dabei geschehen ist
 */
async function beendenMit({ speichernGeht, antwort }) {
  const spur = {
    confirmQuit: 0, cancelQuit: 0, holdQuit: 0,
    gefragt: [], anlaeufe: 0
  };

  const schmutzig = new Set(['nb1']);

  const AutoSave = {
    dirtyNotebooks: schmutzig,
    async saveNow() {
      spur.anlaeufe++;
      if (speichernGeht) {
        schmutzig.clear();
        return [{ nbId: 'nb1', success: true, path: 'C:\\Hefte\\Heft.jrnl' }];
      }
      // Genau die Form, die _saveAllDirty bei einem Schreibfehler liefert
      return [{ nbId: 'nb1', success: false, error: 'ENOSPC: no space left on device' }];
    }
  };

  let beiQuit = null;

  const fenster = {
    api: {
      onBeforeQuit: (cb) => { beiQuit = cb; },
      confirmQuit: () => { spur.confirmQuit++; },
      cancelQuit: () => { spur.cancelQuit++; },
      holdQuit: () => { spur.holdQuit++; }
    },
    sharedDocHatOffenes: () => false
  };

  const sandbox = {
    window: fenster,
    document: { getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Promise, Array, JSON, String,
    AutoSave,
    getNb: (id) => ({ id, name: 'Mathematik' }),
    t: (schluessel) => (schluessel === 'quitSaveFailed'
      ? 'Nicht gespeichert: {hefte}\n\n{grund}\n\nTrotzdem schließen?'
      : schluessel),
    showConfirm: async (text) => { spur.gefragt.push(text); return antwort; }
  };
  sandbox.window.window = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(extract('registriereBeendenHandler') + '\nregistriereBeendenHandler();', sandbox);

  if (!beiQuit) throw new Error('Der Handler hat sich nicht angemeldet');
  await beiQuit();

  spur.nochSchmutzig = schmutzig.size;
  return spur;
}

(async () => {
  console.log('\nBeenden mit fehlgeschlagenem Speichern');

  const abgelehnt = await beendenMit({ speichernGeht: false, antwort: false });
  check('Es wird nicht bedingungslos geschlossen', abgelehnt.confirmQuit, 0);
  check('Der Hauptprozess wird aufgehalten', abgelehnt.cancelQuit, 1);
  check('Und seine Uhr angehalten, solange gefragt wird', abgelehnt.holdQuit, 1);
  check('Ein zweiter Anlauf wurde unternommen', abgelehnt.anlaeufe, 2);
  check('Der Nutzer wurde genau einmal gefragt', abgelehnt.gefragt.length, 1);
  check('Die Frage nennt das Heft',
    abgelehnt.gefragt[0].includes('Mathematik'), true);
  check('Und den Grund',
    abgelehnt.gefragt[0].includes('ENOSPC'), true);

  console.log('\nWer trotzdem schliessen will, darf das');

  const trotzdem = await beendenMit({ speichernGeht: false, antwort: true });
  check('Dann wird geschlossen', trotzdem.confirmQuit, 1);
  check('Und nichts aufgehalten', trotzdem.cancelQuit, 0);

  console.log('\nGeht das Speichern, faellt die Rueckfrage weg');

  const gut = await beendenMit({ speichernGeht: true, antwort: false });
  check('Es wird geschlossen', gut.confirmQuit, 1);
  check('Ohne Rueckfrage', gut.gefragt.length, 0);
  check('Und ohne zweiten Anlauf', gut.anlaeufe, 1);
  check('Nichts bleibt schmutzig', gut.nochSchmutzig, 0);

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
})().catch(err => {
  console.error('\nPrüfung abgebrochen:', err);
  process.exit(1);
});
