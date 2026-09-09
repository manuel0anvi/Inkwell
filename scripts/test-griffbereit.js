#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GRIFFBEREIT — UNTERLAGEN NEBEN DEM HEFT

   Geprüft wird das, woran die Sache still kaputtgeht:

     1. WAS ÜBERHAUPT HEREINDARF. griffArt ist die einzige Schranke am
        Weg über das Ablegen — dort nennt das Fenster den Pfad, und ohne
        diese Prüfung liesse sich damit jede Datei des Nutzers lesen.
     2. WAS DAS FENSTER SCHICKEN DARF. Breite und Rollstelle kommen aus
        dem Fenster und werden gespeichert; Unsinn darin darf die Zeile
        nicht verderben.
     3. DIE REIHENFOLGE. Auf beiden Seiten: die Rechnung im Fenster
        (welche Stelle meint der Zeiger?) und die im Hauptprozess
        (nichts darf dabei verschwinden).
     4. DASS DER ORT NIE HINAUSGEHT. griffAntwort ist das Einzige, was
        das Fenster je zu sehen bekommt — der Pfad gehört nicht dazu.

   Was hier NICHT geprüft wird, weil es ohne echtes Chromium nicht geht:
   das Zeichnen der PDF-Seiten, das Wischen und das Ziehen an der Kante.

   Aufruf:  node scripts/test-griffbereit.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wurzel = path.join(__dirname, '..');
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), 'utf8');

const mainQuelle = lies('main.js');
const uiQuelle = lies('src', 'ui', 'griffbereit.js');

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`  ✗ ${label}`);
    console.error(`      erwartet: ${JSON.stringify(expected)}`);
    console.error(`      bekommen: ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

/** Schneidet eine Funktion samt Rumpf aus einer Quelldatei heraus. */
function funktion(quelle, name) {
  const start = quelle.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} nicht gefunden`);
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

/* Eine Umgebung, in der die Stücke aus main.js laufen: path ist echt,
   fs wird gestellt — der Test soll keine Dateien anfassen. */
function umgebung(daSind) {
  const ctx = {
    console, path, JSON, Number, Math, String, Array, Object, Boolean,
    fs: { existsSync: (p) => !!(daSind && daSind.has(p)) }
  };
  vm.createContext(ctx);
  return ctx;
}

console.log('1. Was hereindarf\n');
{
  const ctx = umgebung();
  vm.runInContext(mainQuelle.match(/const GRIFF_ARTEN = \{[\s\S]*?\};/)[0], ctx);
  vm.runInContext(funktion(mainQuelle, 'griffArt'), ctx);
  const art = ctx.griffArt;

  check('Ein PDF', art('C:\\Uni\\Skript.pdf'), { mime: 'application/pdf', art: 'pdf' });
  check('Ein Foto', art('/home/x/tafel.JPG'), { mime: 'image/jpeg', art: 'bild' });
  check('Grosse Endung zaehlt auch', art('bild.PNG'), { mime: 'image/png', art: 'bild' });

  /* >>> Der Kern der Sache <<<
     Über das Ablegen nennt das FENSTER den Pfad. Fiele diese Prüfung
     weg, liesse sich damit jede Datei des Nutzers auslesen. */
  check('Kein Schluessel', art('C:\\Users\\x\\.ssh\\id_rsa'), null);
  check('Kein Heft', art('mein-heft.jrnl'), null);
  check('Keine Endung', art('README'), null);
  check('Nichts', art(''), null);
  check('Auch nicht undefined', art(undefined), null);
  // Eine Endung im Ordnernamen taeuscht nicht darueber hinweg
  check('Nur die letzte Endung zaehlt', art('C:\\bilder.png\\geheim.txt'), null);
}

console.log('\n2. Was das Fenster schicken darf\n');
{
  const ctx = umgebung();
  vm.runInContext(funktion(mainQuelle, 'griffMass'), ctx);
  const mass = ctx.griffMass;

  check('Ein gewoehnlicher Wert', mass(380, 0, 4000, 42), 380);
  check('Zu gross wird gekappt', mass(99999, 0, 4000, 42), 4000);
  check('Zu klein auch', mass(-5, 0, 4000, 42), 0);
  check('Ein Anteil bleibt im Rahmen', mass(1.7, 0, 1, 0), 1);

  /* Kein Wert heisst: alles bleibt, wie es war. Ohne diesen Zweig würde
     aus einem NaN eine Breite von NaN, und die Leiste verschwände. */
  check('Text aendert nichts', mass('breit', 0, 4000, 42), 42);
  check('NaN aendert nichts', mass(NaN, 0, 4000, 42), 42);
  check('Nichts aendert nichts', mass(undefined, 0, 4000, 42), 42);
  check('Unendlich aendert nichts', mass(Infinity, 0, 4000, 42), 42);
}

console.log('\n3. Die Reihenfolge — im Fenster gerechnet\n');
{
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(funktion(uiQuelle, 'neueFolge'), ctx);
  const folge = ctx.neueFolge;

  // „ziel" ist eine Stelle in der Liste, wie sie DASTEHT — die gezogene
  // Zeile steht darin noch mit.
  check('Die letzte nach ganz oben', folge(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
  check('Die erste nach ganz unten', folge(['a', 'b', 'c'], 'a', 3), ['b', 'c', 'a']);
  check('Eine Stelle nach unten', folge(['a', 'b', 'c'], 'a', 2), ['b', 'a', 'c']);
  check('Eine Stelle nach oben', folge(['a', 'b', 'c'], 'c', 1), ['a', 'c', 'b']);

  /* Auf sich selbst abgelegt: nichts passiert. Beides — die Stelle davor
     und die dahinter — meint dieselbe Lage. */
  check('Auf sich selbst (davor)', folge(['a', 'b', 'c'], 'b', 1), ['a', 'b', 'c']);
  check('Auf sich selbst (dahinter)', folge(['a', 'b', 'c'], 'b', 2), ['a', 'b', 'c']);

  check('Eine unbekannte Zeile aendert nichts', folge(['a', 'b'], 'z', 0), ['a', 'b']);
  check('Kennungen sind Zeichenketten', folge([1, 2, 3], 3, 0), ['3', '1', '2']);
}

console.log('\n4. Die Reihenfolge — im Hauptprozess angewandt\n');
{
  const ctx = umgebung();
  vm.runInContext(funktion(mainQuelle, 'griffOrdne'), ctx);
  const ordne = ctx.griffOrdne;
  const namen = (liste) => liste.map(d => d.id);
  const dateien = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  check('Die gewuenschte Folge', namen(ordne(dateien, ['c', 'a', 'b'])), ['c', 'a', 'b']);

  /* >>> Nichts darf verschwinden <<<
     Die Liste im Fenster kann veraltet sein — etwa wenn nebenher etwas
     dazugekommen ist. Ein Eintrag, den sie nicht kennt, haengt sich
     hinten an, statt aus der Datei zu fallen. */
  check('Unbekanntes haengt hinten an', namen(ordne(dateien, ['c'])), ['c', 'a', 'b']);
  check('Leere Folge laesst alles stehen', namen(ordne(dateien, [])), ['a', 'b', 'c']);
  check('Gar keine Folge auch', namen(ordne(dateien, null)), ['a', 'b', 'c']);
  check('Erfundene Kennungen stoeren nicht', namen(ordne(dateien, ['x', 'b'])), ['b', 'a', 'c']);
  check('Die Vorlage bleibt unberuehrt', namen(dateien), ['a', 'b', 'c']);
}

console.log('\n5. Der Ort geht nie ans Fenster\n');
{
  const daSind = new Set(['C:\\Uni\\Skript.pdf']);
  const ctx = umgebung(daSind);
  vm.runInContext(funktion(mainQuelle, 'griffAntwort'), ctx);

  const antwort = ctx.griffAntwort({
    versteckt: false,
    dateien: [
      { id: 'a', name: 'Skript', pfad: 'C:\\Uni\\Skript.pdf', art: 'pdf', breite: 380, stelle: .5 },
      { id: 'b', name: 'Tafel', pfad: 'D:\\weg.png', art: 'bild', breite: 0, stelle: 0 }
    ]
  });

  /* Das Fenster braucht den Pfad für nichts: gelesen wird über die
     Kennung. Steht er in der Antwort, steht er früher oder später auch
     in einem Protokoll oder einem Screenshot. */
  check('Kein Pfad in der Antwort', antwort.dateien.every(d => !('pfad' in d)), true);
  check('Der Name bleibt', antwort.dateien.map(d => d.name), ['Skript', 'Tafel']);

  /* „da" wird bei JEDER Antwort frisch nachgesehen und nie gespeichert:
     die Datei kann zwischen zwei Blicken verschwinden. */
  check('Die vorhandene gilt als da', antwort.dateien[0].da, true);
  check('Die verschobene nicht', antwort.dateien[1].da, false);
  check('Breite und Stelle reisen mit', [antwort.dateien[0].breite, antwort.dateien[0].stelle],
    [380, .5]);

  daSind.delete('C:\\Uni\\Skript.pdf');
  const nochmal = ctx.griffAntwort({
    versteckt: true,
    dateien: [{ id: 'a', name: 'Skript', pfad: 'C:\\Uni\\Skript.pdf', art: 'pdf' }]
  });
  check('Weg heisst beim naechsten Blick weg', nochmal.dateien[0].da, false);
  check('Ausgeblendet reist mit', nochmal.versteckt, true);
}

console.log('\n6. Die Vereinbarung zwischen den Prozessen\n');
{
  /* Ein Kanal, den preload.js anbietet und main.js nicht bedient, faellt
     erst im Betrieb auf — und dann als Fenster, in dem nichts geschieht. */
  const preload = lies('preload.js');
  const angeboten = [...preload.matchAll(/invoke\('(griff-[a-z]+)'/g)].map(m => m[1]).sort();
  const bedient = [...mainQuelle.matchAll(/ipcMain\.handle\('(griff-[a-z]+)'/g)].map(m => m[1]).sort();
  check('Jeder angebotene Kanal wird bedient', angeboten, bedient);
  check('Es gibt ueberhaupt welche', angeboten.length > 0, true);

  /* Die Oberflaeche darf keinen Pfad ins Lesen geben – sie kennt gar
     keinen. Wer hier eine zweite Fassung baut, die einen annimmt, hebelt
     die Erlaubnisliste aus. */
  check('Gelesen wird ueber die Kennung', /invoke\('griff-lesen', id\)/.test(preload), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
