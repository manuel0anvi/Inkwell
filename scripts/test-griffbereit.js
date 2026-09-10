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
     5. DIE BEREICHE. Seit ein PDF nicht mehr am Stück durch die Brücke
        geht, sondern stückweise über den Oberflächen-Server, hängt
        alles an dieser Rechnung: verrechnet sie sich um ein Byte, zeigt
        pdf.js entweder Unsinn oder gar nichts.

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

  /* Der Zoom. Die Grenzen stehen in main.js UND in ui/griffbereit.js –
     hier wird die Fassung im Hauptprozess geprüft, denn nur sie steht
     zwischen einer von Hand geänderten Datei und einer Leinwand, die
     die Anzeige lahmlegt. */
  check('Zweifach ist erlaubt', mass(2, 0.5, 4, 1), 2);
  check('Vierzigfach wird auf vier gekappt', mass(40, 0.5, 4, 1), 4);
  check('Und ein Zehntel auf ein halbes', mass(0.1, 0.5, 4, 1), 0.5);
  check('Null ist kein Zoom', mass(0, 0.5, 4, 1), 0.5);

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
      { id: 'a', name: 'Skript', pfad: 'C:\\Uni\\Skript.pdf', art: 'pdf',
        breite: 380, stelle: .5, zoom: 2, quer: .25 },
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

  /* Vergrößerung und Querstelle gehören dazu: ohne sie stünde eine Datei
     nach dem Neustart wieder in einfacher Größe am linken Rand, und das
     Merken wäre nur zur Hälfte eines. */
  check('Zoom und Querstelle auch', [antwort.dateien[0].zoom, antwort.dateien[0].quer],
    [2, .25]);

  daSind.delete('C:\\Uni\\Skript.pdf');
  const nochmal = ctx.griffAntwort({
    versteckt: true,
    dateien: [{ id: 'a', name: 'Skript', pfad: 'C:\\Uni\\Skript.pdf', art: 'pdf' }]
  });
  check('Weg heisst beim naechsten Blick weg', nochmal.dateien[0].da, false);
  check('Ausgeblendet reist mit', nochmal.versteckt, true);
}

console.log('\n6. Die Bereiche der Auslieferung\n');
{
  /* >>> Warum das hier steht <<<
     Ein PDF geht nicht mehr durch die Brücke, sondern über
     griffAusliefern – und ein abfotografiertes Buch kommt damit
     überhaupt erst auf, statt „zu groß" zu melden. Die ganze Ersparnis
     hängt daran, dass die Bereiche stimmen: pdf.js fragt zuerst nach
     den letzten Bytes (dort steht der Katalog) und holt sich danach
     einzelne Stücke. Ein Fehler um eins ist hier kein Schönheitsfehler,
     sondern eine Seite, die leer bleibt. */
  const ctx = umgebung();
  vm.runInContext(funktion(mainQuelle, 'griffBereich'), ctx);
  const b = ctx.griffBereich;

  check('Ohne Kopfzeile: alles', b(null, 1000), null);
  check('Die ersten hundert', b('bytes=0-99', 1000), { von: 0, bis: 99 });
  check('Offenes Ende', b('bytes=500-', 1000), { von: 500, bis: 999 });
  check('Das ganze Stueck', b('bytes=0-999', 1000), { von: 0, bis: 999 });

  // So sucht pdf.js den Katalog: die letzten Bytes, ohne die Länge zu kennen
  check('Die letzten fuenfhundert', b('bytes=-500', 1000), { von: 500, bis: 999 });
  check('Mehr Schwanz als Datei', b('bytes=-5000', 1000), { von: 0, bis: 999 });
  check('Ende hinter der Datei', b('bytes=900-5000', 1000), { von: 900, bis: 999 });

  /* 416 statt einer Antwort mit falschem Inhalt: einen Fehler merkt
     pdf.js sofort, einen stillschweigend verschobenen Bereich nicht. */
  check('Anfang hinter dem Ende', b('bytes=1000-', 1000), 'kaputt');
  check('Gar keine Zahl', b('bytes=-', 1000), 'kaputt');
  check('Verdreht', b('bytes=500-100', 1000), 'kaputt');

  // Mehrere Bereiche darf ein Server mit der ganzen Datei beantworten
  check('Mehrere Bereiche: alles', b('bytes=0-10,20-30', 1000), null);
  check('Unsinn: alles', b('Zeug', 1000), null);
}

console.log('\n7. Die Form der Kaesten\n');
{
  /* Vor dem ersten Blick steht für jede Seite ein leerer Kasten. Seine
     Höhe kommt aus der Form der gemessenen Seiten – und gemessen werden
     nur die ersten acht, weil jede eine eigene Anfrage ist.

     Genommen wird deshalb die HÄUFIGSTE Form, nicht die erste: ein
     Deckblatt ist oft anders geschnitten als der Rest, und als Vorlage
     verzöge es die Höhe aller hundert Kästen dahinter. */
  const ctx = umgebung();
  vm.runInContext(funktion(uiQuelle, 'ueblicheForm'), ctx);
  const f = ctx.ueblicheForm;

  const A4 = 0.7071, QUER = 1.414;
  check('Gar nichts gemessen: A4 hochkant', f([]), 0.7071);
  check('Alle gleich', f([A4, A4, A4]), A4);
  check('Ein anderes Deckblatt zaehlt nicht mehr als der Rest',
    f([QUER, A4, A4, A4]), A4);
  check('Winzige Abweichungen sind dieselbe Form',
    Math.abs(f([0.707, 0.7071, 0.7072, QUER]) - 0.707) < 0.001, true);
  check('Ist wirklich alles quer, gilt quer', f([QUER, QUER, A4]), QUER);
  // Bei Gleichstand gewinnt die zuerst gesehene – irgendeine muss es sein
  check('Gleichstand: die erste', f([A4, QUER]), A4);
}

console.log('\n8. Ein Fach je Heft\n');
{
  /* >>> Warum die Unterlagen nicht mehr fuer alle gelten <<<
     Die Liste stand einmal fuer die ganze App: wer in einem Heft ein
     Skript danebenlegte, hatte es in JEDEM Heft am Rand stehen. Jetzt
     traegt die Datei ein Fach je Heft.

     >>> Und der gemerkte Stand <<<
     Seit ein PDF stueckweise geholt wird, geht JEDE Bereichsanfrage
     durch griffLies. Unter Windows schlaegt so ein Zugriff hin und
     wieder fehl (Virenscanner, Ordnersynchronisierung). Zurueck kam
     dann eine LEERE LISTE - fuer das Fenster heisst das: die Unterlage
     gibt es nicht mehr. Reiter weg, Datei zu, Inhalt weggeraeumt. */

  const bauStand = (inhalt) => {
    let zeit = 100, gelesen = 0, fehler = null;
    const ctx = umgebung();
    ctx.console = { error: () => {}, log: () => {} };
    ctx.fs = {
      statSync: () => { if (fehler) throw fehler; return { mtimeMs: zeit }; },
      readFileSync: () => { gelesen++; if (fehler) throw fehler; return ctx.__inhalt; },
      writeFileSync: (ziel, text) => { ctx.__inhalt = text; zeit++; },
      existsSync: () => true
    };
    ctx.__inhalt = inhalt;
    vm.runInContext("const griffPath = 'stand.json'; const GRIFF_MAX = 3;", ctx);
    vm.runInContext('let griffStand = null; let griffStandZeit = -1;', ctx);
    for (const name of ['griffLeer', 'griffFach', 'griffForm', 'griffLies',
                        'griffHeft', 'griffSichere', 'griffSchreib', 'griffAntwort']) {
      vm.runInContext(funktion(mainQuelle, name), ctx);
    }
    ctx.__zaehler = () => gelesen;
    ctx.__fehler = (e) => { fehler = e; };
    return ctx;
  };

  const datei = (id, name) => ({ id, name, pfad: 'C:/x/' + id + '.pdf', art: 'pdf' });
  const zweiHefte = JSON.stringify({ hefte: {
    heftA: { versteckt: false, dateien: [datei('a', 'Skript')] },
    heftB: { versteckt: true, dateien: [datei('b', 'Tafelbild'), datei('c', 'Buch')] }
  } });

  {
    const ctx = bauStand(zweiHefte);
    check('Heft A sieht seine eine Datei', ctx.griffHeft('heftA').dateien.length, 1);
    check('Und zwar die richtige', ctx.griffHeft('heftA').dateien[0].id, 'a');
    check('Heft B sieht seine zwei', ctx.griffHeft('heftB').dateien.length, 2);
    check('Ausblenden gilt auch nur je Heft', ctx.griffHeft('heftA').versteckt, false);
    check('... und im anderen Heft getrennt davon', ctx.griffHeft('heftB').versteckt, true);
    check('Ein neues Heft faengt leer an', ctx.griffHeft('heftC').dateien.length, 0);
    // Ohne offenes Heft gibt es nichts - auf der Uebersicht liegt keine Unterlage
    check('Ohne Heft bleibt es leer', ctx.griffHeft('').dateien.length, 0);
  }

  {
    /* Ein Stand aus der Zeit vor den Faechern. Weggeworfen wird er
       nicht: er geht an das erste Heft, das danach fragt - welches das
       sein soll, kann der Hauptprozess nicht wissen, und das offene
       Heft ist die einzige sinnvolle Antwort. */
    const ctx = bauStand(JSON.stringify({ versteckt: false, dateien: [datei('alt', 'Von frueher')] }));
    check('Das Erbe geht an das erste Heft', ctx.griffHeft('heftA').dateien[0].id, 'alt');
    check('Und nur an dieses', ctx.griffHeft('heftB').dateien.length, 0);
    check('Auch nach dem Neulesen bleibt es dort',
      ctx.griffForm(JSON.parse(ctx.__inhalt)).hefte.heftA.dateien[0].id, 'alt');
  }

  {
    const ctx = bauStand(zweiHefte);
    check('Beim ersten Mal wird gelesen', ctx.griffHeft('heftA').dateien.length, 1);
    check('Dafuer genau einmal', ctx.__zaehler(), 1);
    ctx.griffHeft('heftA'); ctx.griffHeft('heftB'); ctx.griffHeft('heftA');
    check('Unveraendert wird nicht noch einmal gelesen', ctx.__zaehler(), 1);

    /* >>> Der Kern der Sache <<< */
    ctx.__fehler(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
    check('Ein Zugriffsfehler wirft die Liste nicht weg',
      ctx.griffHeft('heftA').dateien.length, 1);

    /* Auch eine FEHLENDE Datei wirft nichts weg. Hier stand einmal die
       leere Liste als „Wahrheit" – und genau daran ging die erste
       Unterlage auf einem frischen Rechner verloren: die Datei gibt es
       noch nicht, weil sie noch nie geschrieben wurde, und was im
       Speicher steht, wartet gerade darauf. Siehe den Abschnitt weiter
       unten, der genau diesen Ablauf durchgeht. */
    ctx.__fehler(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    check('Eine fehlende Datei wirft nichts weg', ctx.griffHeft('heftA').dateien.length, 1);
  }

  {
    /* >>> Die erste Unterlage auf einem frischen Rechner <<<
       Gibt es die Ablagedatei noch gar nicht, legt griffHeft das Fach
       im Speicher an. griffSchreib ruft dann griffLies – und das gab
       bei ENOENT einen FRISCHEN leeren Stand zurueck, der prompt
       gespeichert wurde. Die Antwort ans Fenster trug die Unterlage
       noch, die Platte nicht; beim naechsten Blick war sie weg.

       Gemeldet als „ich kann nichts mehr hinzufuegen, es taucht in der
       Liste nicht auf". */
    let daten = null;   // null heisst: die Datei gibt es nicht
    let zeit = 100;
    const ctx = umgebung();
    ctx.console = { error: () => {}, log: () => {} };
    ctx.fs = {
      statSync: () => {
        if (daten === null) throw Object.assign(new Error('weg'), { code: 'ENOENT' });
        return { mtimeMs: zeit };
      },
      readFileSync: () => daten,
      writeFileSync: (ziel, text) => { daten = text; zeit++; },
      existsSync: () => daten !== null
    };
    vm.runInContext("const griffPath = 'stand.json'; const GRIFF_MAX = 3;", ctx);
    vm.runInContext('let griffStand = null; let griffStandZeit = -1;', ctx);
    for (const name of ['griffLeer', 'griffFach', 'griffForm', 'griffLies',
                        'griffHeft', 'griffSichere', 'griffSchreib', 'griffAntwort']) {
      vm.runInContext(funktion(mainQuelle, name), ctx);
    }

    // Genau der Ablauf von ipcMain.handle('griff-uebernehmen')
    const fach = ctx.griffHeft('heftA');
    check('Ohne Datei faengt das Fach leer an', fach.dateien.length, 0);
    fach.dateien.push({ id: 'g1', name: 'Das Erste', pfad: 'C:/x/eins.pdf', art: 'pdf' });
    const antwort = ctx.griffSchreib(fach);
    check('Die Antwort traegt die neue Unterlage', antwort.dateien.length, 1);

    /* >>> Der Kern der Sache <<<
       Nicht nur die Antwort muss stimmen, sondern das, was auf der
       Platte landet – daraus liest das Fenster beim naechsten Mal. */
    check('Und sie steht wirklich in der Datei',
      JSON.parse(daten).hefte.heftA.dateien.length, 1);

    // Wie nach einem Neustart
    vm.runInContext('griffStand = null; griffStandZeit = -1;', ctx);
    check('Nach dem Neulesen ist sie noch da',
      ctx.griffHeft('heftA').dateien[0].name, 'Das Erste');

    // Und die zweite kommt dazu, statt die erste zu ersetzen
    const fach2 = ctx.griffHeft('heftA');
    fach2.dateien.push({ id: 'g2', name: 'Das Zweite', pfad: 'C:/x/zwei.pdf', art: 'pdf' });
    ctx.griffSchreib(fach2);
    vm.runInContext('griffStand = null; griffStandZeit = -1;', ctx);
    check('Die zweite kommt dazu',
      ctx.griffHeft('heftA').dateien.map(d => d.name), ['Das Erste', 'Das Zweite']);
  }

  {
    // Geschrieben wird der GANZE Stand, zurueck kommt nur das eine Fach
    const ctx = bauStand(zweiHefte);
    const fach = ctx.griffHeft('heftA');
    fach.dateien.push(datei('neu', 'Dazu'));
    const antwort = ctx.griffSchreib(fach);
    check('Die Antwort traegt nur das eigene Fach', antwort.dateien.length, 2);
    const gespeichert = JSON.parse(ctx.__inhalt);
    check('Gespeichert wird unter dem Heft', gespeichert.hefte.heftA.dateien.length, 2);
    check('Das andere Heft bleibt unberuehrt', gespeichert.hefte.heftB.dateien.length, 2);
  }
}

console.log('\n9. Die Kanaele, wirklich durchlaufen\n');
{
  /* >>> Warum das hier steht <<<
     Im Rumpf von griff-uebernehmen stand einmal `griffSchreib(stand)`,
     wo `fach` gemeint war. Ein ReferenceError - kein `node --check`
     sieht so etwas, und keine Pruefung, die nur die Hilfsfunktionen
     einzeln aufruft. Der Kanal warf, das Fenster bekam nie eine
     Antwort, und eine hinzugefuegte Unterlage tauchte nie auf.

     Deshalb laufen die Kanaele hier von Anfang bis Ende durch, gegen
     eine gestellte Datei. Ein Wurf faellt dabei sofort auf. */
  let daten = null;
  let zeit = 100;
  const ctx = umgebung();
  ctx.console = { error: () => {}, log: () => {} };
  ctx.Date = Date;
  ctx.Map = Map;
  ctx.fs = {
    statSync: () => {
      if (daten === null) throw Object.assign(new Error('weg'), { code: 'ENOENT' });
      return { mtimeMs: zeit };
    },
    readFileSync: () => daten,
    writeFileSync: (ziel, text) => { daten = text; zeit++; },
    existsSync: () => true
  };
  vm.runInContext("const griffPath = 'stand.json'; const GRIFF_MAX = 3;", ctx);
  vm.runInContext('let griffStand = null; let griffStandZeit = -1;', ctx);
  /* var, nicht const: nur var landet als Eigenschaft am Kontext und
     ist damit von hier aus zu fuellen. Dieselbe Falle wie bei window.S. */
  vm.runInContext('var griffAngebote = new Map();', ctx);
  for (const name of ['griffLeer', 'griffFach', 'griffForm', 'griffLies', 'griffHeft',
                      'griffSichere', 'griffSchreib', 'griffAntwort', 'griffMass',
                      'griffOrdne', 'griffUebernimm', 'griffAendere', 'griffEntferne',
                      'griffOrdneHeft', 'griffVerstecke']) {
    vm.runInContext(funktion(mainQuelle, name), ctx);
  }

  const biete = (id, pfad) => ctx.griffAngebote.set(id, { pfad, art: 'pdf' });
  const namen = (a) => (a.dateien || []).map(d => d.name);

  // Ohne Heft geht gar nichts - eine Unterlage liegt neben einem Heft
  biete('x', 'C:/x/x.pdf');
  check('Ohne Heft wird nichts uebernommen', ctx.griffUebernimm('', 'x', 'X').fehler, 'kein Heft');

  biete('g1', 'C:/x/eins.pdf');
  check('Die erste kommt an', namen(ctx.griffUebernimm('heftA', 'g1', 'Das Erste')), ['Das Erste']);
  biete('g2', 'C:/x/zwei.pdf');
  check('Die zweite stellt sich daneben',
    namen(ctx.griffUebernimm('heftA', 'g2', 'Das Zweite')), ['Das Erste', 'Das Zweite']);

  // Und sie stehen wirklich in der Datei, nicht nur in der Antwort
  check('Beide stehen in der Datei',
    JSON.parse(daten).hefte.heftA.dateien.map(d => d.name), ['Das Erste', 'Das Zweite']);

  // Ein Angebot gilt genau einmal - sonst liesse sich ein Pfad wiederverwenden
  check('Dasselbe Angebot ein zweites Mal', ctx.griffUebernimm('heftA', 'g1', 'Nochmal').fehler, 'unbekannt');

  biete('g3', 'C:/x/drei.pdf');
  ctx.griffUebernimm('heftA', 'g3', 'Das Dritte');
  biete('g4', 'C:/x/vier.pdf');
  check('Ueber drei geht es nicht', ctx.griffUebernimm('heftA', 'g4', 'Zu viel').fehler, 'voll');

  check('Umbenennen', namen(ctx.griffAendere('heftA', 'g2', { name: 'Neuer Name' })),
    ['Das Erste', 'Neuer Name', 'Das Dritte']);
  check('Umsortieren', namen(ctx.griffOrdneHeft('heftA', ['g3', 'g1', 'g2'])),
    ['Das Dritte', 'Das Erste', 'Neuer Name']);
  check('Ausblenden', ctx.griffVerstecke('heftA', true).versteckt, true);
  check('Wegnehmen', namen(ctx.griffEntferne('heftA', 'g1')), ['Das Dritte', 'Neuer Name']);

  // Das andere Heft hat von alldem nichts mitbekommen
  check('Das andere Heft bleibt leer', ctx.griffAntwort(ctx.griffHeft('heftB')).dateien.length, 0);

  // Und nach einem Neustart steht alles noch so da
  vm.runInContext('griffStand = null; griffStandZeit = -1;', ctx);
  check('Alles ueberlebt den Neustart',
    namen(ctx.griffAntwort(ctx.griffHeft('heftA'))), ['Das Dritte', 'Neuer Name']);
  check('Das Ausblenden auch', ctx.griffAntwort(ctx.griffHeft('heftA')).versteckt, true);
}

console.log('\n10. Die Vereinbarung zwischen den Prozessen\n');
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
     die Erlaubnisliste aus. Das Heft steht davor: gesucht wird in dessen
     Fach, nicht in einer Liste fuer alle (main.js, griffHeft). */
  check('Gelesen wird ueber Heft und Kennung',
    /invoke\('griff-lesen', nb, id\)/.test(preload), true);

  /* Und JEDE Auskunft nennt das Heft. Ein Kanal, der es vergisst, sieht
     wieder alle Unterlagen auf einmal – der Fehler, der behoben werden
     sollte. Ausgenommen sind die drei, die noch gar kein Heft betreffen:
     das Auswahlfenster, eine abgelegte Datei und der Pfad daraus. */
  const ohneHeft = [...preload.matchAll(/(\w+):\s+\(([^)]*)\)\s*=>\s*ipcRenderer\.invoke\('(griff-[a-z]+)'/g)]
    .filter(m => !/^nb\b/.test(m[2].trim()))
    .map(m => m[3]);
  check('Jede heftbezogene Auskunft nennt das Heft',
    ohneHeft, ['griff-waehlen', 'griff-abgelegt']);

  /* Die Adresse einer Unterlage trägt eine Zufallsfolge. Ohne sie käme
     jedes Programm auf demselben Rechner an eine Datei, die irgendwo
     auf der Platte liegt – der Oberflächen-Server hört auf localhost. */
  check('Die Adresse traegt die Zufallsfolge',
    /GRIFF_TOKEN = crypto\.randomBytes\(/.test(mainQuelle), true);
  check('Und der Auslieferer prueft sie',
    /teile\[2\] !== GRIFF_TOKEN/.test(mainQuelle), true);

  /* Holt pdf.js im Hintergrund doch das ganze Buch, ist die ganze
     Umstellung umsonst – die beiden Schalter gehören zusammen. */
  check('Ein PDF wird stueckweise geholt',
    /disableAutoFetch: true/.test(uiQuelle) && /disableStream: true/.test(uiQuelle), true);
}

console.log('');
if (failed) {
  console.error(`${failed} Pruefung(en) fehlgeschlagen.`);
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
