#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DREI STELLEN, AN DENEN STILL ARBEIT VERSCHWAND

   1. DER ABDRUCK (core/versions.js)
      Er sah nur LÄNGEN an: Name, Zahl der Abschnitte, je Seite die Länge
      des Textes und die Zahl der Striche und Objekte. Aus AAAA wird BBBB
      – derselbe Abdruck. CloudSync nahm ihn aber als Beweis dafür, dass
      zwei Fassungen denselben Inhalt haben: keine Konfliktwarnung, keine
      Sicherung der unterliegenden Fassung, und der Versionsverlauf
      übersprang dieselbe Änderung gleich mit.

   2. DER DATEIPFAD (core/fileManager.js)
      Ein Heft ohne Eintrag in der Übersicht bekam <Ort>\<Name>.jrnl, ohne
      zu fragen, ob dort schon etwas liegt. Papierkorb-Wiederherstellung
      und Cloud-Download gleichnamiger Hefte schrieben damit über fremde
      Dateien.

   3. DIE GEMEINSAME MERKDATEI (core/registry.js, core/versions.js)
      Übersicht, Papierkorb und Versionsverlauf stehen in EINER Datei, und
      jeder schreibt sie ganz: lesen, eigenes Feld ersetzen, schreiben.
      Laufen zwei gleichzeitig, gewinnt der Letzte – und nimmt die
      Änderung des Ersten mit.

   Aufruf:  node scripts/test-speicherwege.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

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
function ok(label, cond) { check(label, !!cond, true); }
function ungleich(label, a, b) {
  if (a !== b) { console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label} — beide: ${a}`); }
}

/* ── Eine Welt, in der die echten Module laufen ─────────────────────── */

function baueWelt({ dateien = [], registryEintraege = [] } = {}) {
  const platte = new Set(dateien.map(d => d.toLowerCase()));
  let registry = { notebooks: registryEintraege.slice(), trash: [], versions: [] };

  const spur = { geschrieben: [], leseVerzoegerung: 0 };

  const api = {
    async fileExists(pfad) { return platte.has(String(pfad).toLowerCase()); },
    async saveToPath(pfad, daten) {
      platte.add(String(pfad).toLowerCase());
      spur.geschrieben.push(pfad);
      return { success: true, path: pfad };
    },
    async moveFile() { return { success: true }; },
    async loadRegistry() {
      /* Die Verzögerung ist der Kern der dritten Prüfung: zwischen Lesen
         und Schreiben liegt ein IPC-Aufruf, und genau dort passt der
         andere Schreiber hinein. */
      if (spur.leseVerzoegerung) {
        await new Promise(r => setTimeout(r, spur.leseVerzoegerung));
      }
      return JSON.parse(JSON.stringify(registry));
    },
    async saveRegistry(daten) {
      registry = JSON.parse(JSON.stringify(daten));
      return true;
    }
  };

  let zaehler = 0;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, isNaN, parseInt, parseFloat,
    uid: () => 'id' + (++zaehler),
    S: { notebooks: [], strokeHistory: {} },
    Settings: { get: (k) => (k === 'saveLocation' ? 'C:\\Hefte' : null) },
    isSharedNotebook: () => false,
    t: (k) => k,
    toast() {}
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  ctx.window.api = api;

  vm.createContext(ctx);
  for (const datei of ['src/core/registry.js', 'src/core/versions.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, datei), 'utf8'), ctx);
  }
  /* fileManager.js legt Klasse und Instanz beide mit const/class an – die
     landen im Lexikon des Skripts, nicht am Weltobjekt. Ein Nachsatz holt
     sie heraus; an der Datei selbst wird nichts geaendert. */
  vm.runInContext(
    fs.readFileSync(path.join(root, 'src/core/fileManager.js'), 'utf8')
    + String.fromCharCode(10) + 'globalThis.FileManager_ = FileManager_;', ctx);
  return { ctx, api, spur, holeRegistry: () => registry };
}

/** Ein kleines Heft, an dem sich einzelne Dinge verstellen lassen. */
function heft(aenderung = {}) {
  const nb = {
    id: 'nb1', name: 'Mathematik',
    sections: [{ id: 's1', name: 'Woche 1', color: '#c8a96e',
                 defaultBg: 'ruled', pgIds: ['p1'] }],
    pages: [{
      id: 'p1', bg: 'ruled', textContent: '<p>AAAA</p>',
      objects: [{ id: 'o1', kind: 'shape', shapeType: 'rect',
                  x: 10, y: 20, w: 100, h: 50, rot: 0,
                  fill: '#ff0000', stroke: '#000000', strokeWidth: 2 }],
      inkStrokes: [{ id: 'i1', color: '#1a1510', width: 3,
                     path: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }]
    }],
    comments: []
  };
  const kopie = JSON.parse(JSON.stringify(nb));
  if (aenderung.stelle) aenderung.stelle(kopie);
  return kopie;
}

(async () => {
  /* ── 1. Der Abdruck ───────────────────────────────────────────────── */

  console.log('Der Abdruck sieht nicht nur Laengen an');

  {
    const { ctx } = baueWelt();
    const A = ctx.Versions._abdruck(heft());

    ungleich('Gleich langer, anderer Text',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].textContent = '<p>BBBB</p>';
      } })));

    ungleich('Ein verschobenes Objekt',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].objects[0].x = 300;
      } })));

    ungleich('Eine andere Fuellfarbe',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].objects[0].fill = '#0000ff';
      } })));

    ungleich('Ein umbenannter Abschnitt',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.sections[0].name = 'Woche 2';
      } })));

    ungleich('Ein anders gezogener Strich bei gleicher Punktzahl',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].inkStrokes[0].path[1] = { x: 80, y: 90 };
      } })));

    ungleich('Ein Strich, der zum Radierer wird',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].inkStrokes[0].isEraser = true;
      } })));

    ungleich('Ein anderer Seitenhintergrund',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].bg = 'grid';
      } })));

    ungleich('Ein ausgetauschtes PDF',
      ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pdfs = { d1: { name: 'a.pdf', daten: 'AAAA' } };
        nb.pages[0].pdfRef = { datei: 'd1', seite: 1 };
      } })),
      ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pdfs = { d1: { name: 'a.pdf', daten: 'AAAAAA' } };
        nb.pages[0].pdfRef = { datei: 'd1', seite: 1 };
      } })));

    ungleich('Eine andere Seite desselben PDFs',
      ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].pdfRef = { datei: 'd1', seite: 1 };
      } })),
      ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.pages[0].pdfRef = { datei: 'd1', seite: 2 };
      } })));

    ungleich('Ein neuer Kommentar',
      A, ctx.Versions._abdruck(heft({ stelle: nb => {
        nb.comments = [{ id: 'k1', pageId: 'p1', text: 'Hier stimmt was nicht' }];
      } })));

    // Und die Gegenprobe: gleicher Inhalt bleibt gleicher Abdruck
    check('Zweimal derselbe Inhalt ergibt denselben Abdruck',
      ctx.Versions._abdruck(heft()), A);
    check('Auch nach einem Weg durch JSON',
      ctx.Versions._abdruck(JSON.parse(JSON.stringify(heft()))), A);
  }

  /* ── 2. Der Dateipfad ─────────────────────────────────────────────── */

  console.log('\nKein Heft schreibt ueber die Datei eines anderen');

  {
    // Der Fall aus dem Papierkorb: "Heft.jrnl" gehoert schon jemandem
    const { ctx } = baueWelt({
      dateien: ['C:\\Hefte\\Heft.jrnl'],
      registryEintraege: [{ id: 'lebt', name: 'Heft', path: 'C:\\Hefte\\Heft.jrnl' }]
    });
    await ctx.Registry.load();

    const pfad = await ctx.FileManager_._resolvePathForSave({ id: 'alt', name: 'Heft' });
    ungleich('Das zurueckgeholte Heft bekommt einen anderen Pfad',
      String(pfad).toLowerCase(), 'c:\\hefte\\heft.jrnl');
    check('Naemlich den naechsten freien', pfad, 'C:\\Hefte\\Heft (2).jrnl');
  }

  {
    // Zwei gleichnamige Hefte aus der Cloud hintereinander
    const { ctx } = baueWelt();
    await ctx.Registry.load();

    const a = { id: 'remote-A', name: 'Heft', pages: [], sections: [] };
    const b = { id: 'remote-B', name: 'Heft', pages: [], sections: [] };

    const pfadA = await ctx.FileManager_._resolvePathForSave(a);
    await ctx.window.api.saveToPath(pfadA, {});
    await ctx.Registry.add(a, pfadA);

    const pfadB = await ctx.FileManager_._resolvePathForSave(b);
    ungleich('Das zweite landet nicht in derselben Datei', pfadA, pfadB);
    check('Beide Eintraege zeigen auf verschiedene Dateien',
      ctx.Registry.getAll().length, 1);
  }

  {
    // Der Alltag darf davon nichts merken
    const { ctx } = baueWelt();
    await ctx.Registry.load();
    const pfad = await ctx.FileManager_._resolvePathForSave({ id: 'neu', name: 'Physik' });
    check('Ein freier Name bleibt der Name', pfad, 'C:\\Hefte\\Physik.jrnl');
  }

  {
    // Und das eigene Heft behaelt seinen Pfad, auch wenn die Datei da ist
    const { ctx } = baueWelt({
      dateien: ['C:\\Hefte\\Heft.jrnl'],
      registryEintraege: [{ id: 'nb1', name: 'Heft', path: 'C:\\Hefte\\Heft.jrnl' }]
    });
    await ctx.Registry.load();
    const pfad = await ctx.FileManager_._resolvePathForSave({ id: 'nb1', name: 'Heft' });
    check('Die eigene Datei wird weiter benutzt', pfad, 'C:\\Hefte\\Heft.jrnl');
  }

  /* ── 3. Die gemeinsame Merkdatei ──────────────────────────────────── */

  console.log('\nZwei Schreiber an einer Datei loeschen sich nicht aus');

  {
    const { ctx, spur, holeRegistry } = baueWelt();
    await ctx.Registry.load();
    await ctx.Versions.load();

    ctx.Registry._entries.push({ id: 'alt', name: 'Alt', path: 'C:\\Hefte\\Alt.jrnl' });
    await ctx.Registry.save();

    // Jetzt beide gleichzeitig losschicken, mit einer Luecke zwischen
    // Lesen und Schreiben – genau dort lag der Fehler.
    spur.leseVerzoegerung = 5;

    ctx.Registry._entries.push({ id: 'neu', name: 'Neu', path: 'C:\\Hefte\\Neu.jrnl' });
    ctx.Versions._entries.push({ id: 'version1', nbId: 'alt', wann: '2026-01-01' });

    await Promise.all([ctx.Registry.save(), ctx.Versions._speichern()]);

    const datei = holeRegistry();
    check('Die neue Heft-Kennung ist noch da',
      (datei.notebooks || []).map(e => e.id), ['alt', 'neu']);
    check('Und der Versionsstand auch',
      (datei.versions || []).map(e => e.id), ['version1']);
  }

  {
    // Andersherum gestartet, dasselbe Ergebnis
    const { ctx, spur, holeRegistry } = baueWelt();
    await ctx.Registry.load();
    await ctx.Versions.load();
    spur.leseVerzoegerung = 5;

    ctx.Versions._entries.push({ id: 'v1', nbId: 'x', wann: '2026-01-01' });
    ctx.Registry._entries.push({ id: 'nb9', name: 'Neun', path: 'C:\\Hefte\\Neun.jrnl' });

    await Promise.all([ctx.Versions._speichern(), ctx.Registry.save()]);

    const datei = holeRegistry();
    check('Auch in dieser Reihenfolge bleibt beides stehen',
      [(datei.notebooks || []).length, (datei.versions || []).length], [1, 1]);
  }

  if (failed > 0) {
    console.error(`\n${failed} Prüfung(en) fehlgeschlagen.`);
    process.exit(1);
  }
  console.log('\nAlle Prüfungen bestanden.');
  process.exit(0);
})().catch(err => {
  console.error('\nPrüfung abgebrochen:', err);
  process.exit(1);
});
