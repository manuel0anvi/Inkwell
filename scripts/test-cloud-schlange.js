#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   DIE WARTESCHLANGE UND DIE GEGENSEITE

   Fünf Fälle, in denen der Abgleich fremde oder eigene Arbeit verlor.
   Geprüft wird der echte core/cloudSync.js; nachgebaut ist nur, was
   hinter der Leitung liegt.

   S03  Beim Start lief erst die ganze Warteschlange und DANN der
        Abgleich. Wer offline weitergearbeitet hatte, überschrieb damit
        die Arbeit des anderen Geräts, bevor sie überhaupt gelesen war –
        und sah hinterher seine eigene Fassung oben stehen, also auch
        keinen Konflikt.

   S04  Dauert ein Upload länger als die zwei Sekunden bis zum nächsten
        Speichern, schreibt der Nutzer inzwischen weiter. Der Eintrag
        wurde am Ende allein anhand der Kennung entfernt: örtlich neu,
        Cloud alt, Schlange leer.

   S06  Von Konto A abmelden, ein A-Heft bearbeiten, bei B anmelden – das
        Heft ging in die Cloud von B und wurde örtlich auch noch B
        zugeschrieben.

   S07  Ein vollständiger Abgleich schob von Hand in die Schlange, an
        queueNotebook und dessen Bremsen vorbei. Von einem geöffneten
        FREMDEN Dokument entstand dadurch eine private Kopie im eigenen
        Drive.

   S10  „Die reichhaltigere Fassung gewinnt" galt ohne Bedingung. Eine
        auf dem anderen Gerät gelöschte Seite kam deshalb nie an – und
        später von hier aus wieder zurück.

   Aufruf:  node scripts/test-cloud-schlange.js
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

const T = (iso) => new Date(iso).toISOString();

/* ── Die Welt hinter der Leitung ───────────────────────────────────── */

function baueWelt({ hefte = [], fern = [], konto = 'google:A' } = {}) {
  const spur = { reihenfolge: [], hochgeladen: [], gespeichert: [], konflikte: [] };
  const S = { notebooks: hefte.map(h => JSON.parse(JSON.stringify(h))) };
  const dirty = new Set();

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    JSON, Date, Math, Number, String, Array, Object, Set, Map, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Blob: function () { return { size: 0 }; },
    S,
    Settings: { get: () => '', update: async () => {} },
    getNb: (id) => S.notebooks.find(n => n.id === id) || null,
    /* Genau die Funktion aus core/data.js, nur ohne den Rest der Datei:
       ohne Anmeldung gilt kein Heft als fremd. */
    fremdesKonto: (nb) => !!(nb && nb.cloudKonto && konto && nb.cloudKonto !== konto),
    isSharedNotebook: (x) => {
      const nb = typeof x === 'string' ? (S.notebooks.find(n => n.id === x) || {}) : (x || {});
      return nb.origin === 'shared';
    },
    uid: () => 'x',
    t: (k) => k,
    toast: () => {},
    AutoSave: { isDirty: (id) => dirty.has(id) },
    FileManager_: {
      async saveNotebook(nb) { spur.gespeichert.push(nb.id); return { success: true }; }
    },
    Versions: { _abdruck: (nb) => JSON.stringify(nb.pages || []) },
    Conflicts: {
      async melde(eigen, fremdNb) {
        spur.reihenfolge.push('konflikt');
        spur.konflikte.push(eigen.id);
      }
    },
    CLOUD_PROVIDERS: ['google', 'microsoft'],
    defaultCloudProvider: () => 'google',
    GoogleDriveProvider: { id: 'google', label: 'Google Drive', isConfigured: () => true },
    OneDriveProvider: { id: 'microsoft', label: 'OneDrive', isConfigured: () => true },
    navigator: { onLine: true },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: { addEventListener() {} }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/core/cloudSync.js'), 'utf8'), ctx);

  const cs = ctx.CloudSync_;
  cs.isOnline = true;
  cs._canSync = () => true;
  cs.isAuthenticated = () => true;
  cs.isConfigured = () => true;
  cs.kontoSchluessel = () => konto;
  cs._getFolder = async () => 'ordner';
  cs._markSyncTime = async () => {};
  cs._persistQueue = () => {};
  cs._notify = () => {};
  cs._addSyncHistoryEntry = () => {};
  cs._updateStorageUsage = () => {};
  cs.refreshDriveQuota = async () => {};

  // Die Gegenseite: eine Liste von Dateien mit Heft darin
  cs._listNotebookFiles = async () =>
    fern.map(f => ({ id: 'f-' + f.nb.id, name: f.nb.id + '.jrnl',
                     inkwellsId: f.nb.id, modifiedTime: f.modifiedTime }));
  cs._findRemoteFile = async (nb) => {
    const f = fern.find(x => x.nb.id === nb.id);
    return f ? { id: 'f-' + f.nb.id, name: f.nb.id + '.jrnl',
                 inkwellsId: f.nb.id, modifiedTime: f.modifiedTime } : null;
  };
  /* provider ist auf der Klasse ein Getter – ueberschrieben wird er
     deshalb am Exemplar, nicht durch Zuweisung. */
  Object.defineProperty(cs, 'provider', {
    configurable: true,
    value: {
      id: 'google',
      downloadFile: async (http, id) => {
        const f = fern.find(x => 'f-' + x.nb.id === id);
        return f ? JSON.parse(JSON.stringify(f.nb)) : null;
      }
    }
  });
  cs._upsertRemoteNotebook = async (nb) => {
    spur.reihenfolge.push('upload');
    spur.hochgeladen.push({ id: nb.id, updatedAt: nb.updatedAt, konto });
    if (spur.waehrendUpload) await spur.waehrendUpload();
  };
  cs._loadRemoteNotebooks = async () => fern.map(f => JSON.parse(JSON.stringify(f.nb)));
  cs._mergeRemoteNotebook = async () => {};

  return { ctx, cs, S, spur, dirty };
}

function heft(id, o = {}) {
  return {
    id, name: id,
    pages: o.pages || [{ id: 'p1', textContent: 'A', objects: [], inkStrokes: [] }],
    sections: [],
    updatedAt: o.updatedAt || T('2026-01-01T10:00:00Z'),
    syncedAt: o.syncedAt,
    cloudKonto: o.cloudKonto,
    origin: o.origin
  };
}

(async () => {

  /* ── S03 ──────────────────────────────────────────────────────────── */

  console.log('S03: erst nachsehen, dann schreiben');

  {
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T12:00:00Z'),     // offline weitergeschrieben
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const fernStand = heft('nb1', { updatedAt: T('2026-01-01T11:00:00Z') });
    fernStand.pages = [{ id: 'p1', textContent: 'VOM ANDEREN GERAET',
                         objects: [], inkStrokes: [] }];

    const { cs, spur } = baueWelt({
      hefte: [lokal],
      fern: [{ nb: fernStand, modifiedTime: T('2026-01-01T11:00:00Z') }]
    });

    await cs._syncNotebook('nb1');

    check('Der Konflikt wird gemeldet, BEVOR hochgeladen wird',
      spur.reihenfolge, ['konflikt', 'upload']);
    check('Und zwar fuer dieses Heft', spur.konflikte, ['nb1']);
  }

  {
    // Dieselbe Lage, aber hier ist seit dem Abgleich nichts geschehen
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T10:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const fernStand = heft('nb1', { updatedAt: T('2026-01-01T11:00:00Z') });

    const { cs, spur } = baueWelt({
      hefte: [lokal],
      fern: [{ nb: fernStand, modifiedTime: T('2026-01-01T11:00:00Z') }]
    });
    cs.syncQueue = [{ nbId: 'nb1', nbName: 'nb1', action: 'upload', queuedAt: '' }];

    await cs._syncNotebook('nb1');

    check('Ein Ueberbleibsel laedt nichts hoch', spur.hochgeladen, []);
    check('Und verschwindet aus der Schlange', cs.syncQueue.length, 0);
  }

  {
    // Und der Alltag: nichts Fremdes da, also ganz normal hinauf
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T12:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const { cs, spur } = baueWelt({ hefte: [lokal], fern: [] });

    await cs._syncNotebook('nb1');
    check('Ohne fremden Stand wird einfach hochgeladen',
      spur.reihenfolge, ['upload']);
  }

  /* ── S04 ──────────────────────────────────────────────────────────── */

  console.log('\nS04: was waehrend des Uploads dazukam, bleibt offen');

  {
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T12:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const welt = baueWelt({ hefte: [lokal], fern: [] });
    const { cs, spur, S } = welt;

    /* Waehrend der Upload laeuft, tippt der Nutzer weiter. Jedes Mal ein
       Stueck spaeter – sonst waere der zweite Anlauf wieder gleichauf. */
    let minute = 5;
    spur.waehrendUpload = async () => {
      S.notebooks[0].updatedAt = T('2026-01-01T12:0' + (minute++) + ':00Z');
      S.notebooks[0].pages[0].textContent = 'NEUER';
    };

    cs.syncQueue = [{ nbId: 'nb1', nbName: 'nb1', action: 'upload', queuedAt: '' }];
    const stand = await cs._syncNotebook('nb1');

    ok('_syncNotebook meldet einen Nachtrag', stand && stand.nachtrag);
    check('Hochgeladen wurde die Fassung von vorhin',
      spur.hochgeladen.map(u => u.updatedAt), [T('2026-01-01T12:00:00Z')]);

    // Und die Schlange laesst den Eintrag deshalb stehen
    await cs._runQueue();
    check('Der Auftrag bleibt in der Schlange',
      cs.syncQueue.map(e => e.nbId), ['nb1']);
  }

  {
    // Gegenprobe: ohne Zwischenaenderung ist der Auftrag erledigt
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T12:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const { cs } = baueWelt({ hefte: [lokal], fern: [] });
    cs.syncQueue = [{ nbId: 'nb1', nbName: 'nb1', action: 'upload', queuedAt: '' }];

    await cs._runQueue();
    check('Sonst ist die Schlange hinterher leer', cs.syncQueue.length, 0);
  }

  /* ── S06 ──────────────────────────────────────────────────────────── */

  console.log('\nS06: eine Aufgabe gehoert zu ihrem Konto');

  {
    /* Abgemeldet: fremdesKonto liefert absichtlich false, damit offline
       ueberhaupt etwas in die Schlange kommt. */
    const aHeft = heft('nbA', { cloudKonto: 'google:A' });
    const { cs } = baueWelt({ hefte: [aHeft], konto: '' });
    cs.queueNotebook('nbA');

    check('Der Eintrag merkt sich, wohin er gehoert',
      cs.syncQueue.map(e => e.konto), ['google:A']);

    // Jetzt meldet sich B an – die Schlange bleibt erhalten
    cs.kontoSchluessel = () => 'google:B';
    check('Und gehoert nicht zum neuen Konto',
      cs._gehoertZumKonto(cs.syncQueue[0], 'google:B'), false);

    await cs._runQueue();
    check('Er wird unter B nicht ausgefuehrt',
      cs.syncQueue.map(e => e.nbId), ['nbA']);
  }

  {
    // Und ein frisch angelegtes Heft darf ueberall hinauf
    const neu = heft('nbNeu');
    delete neu.cloudKonto;
    const { cs } = baueWelt({ hefte: [neu], konto: '' });
    cs.queueNotebook('nbNeu');
    check('Ein Heft ohne Konto bindet sich an keines',
      cs.syncQueue.map(e => e.konto), ['']);
    ok('Und laeuft unter jedem Konto',
      cs._gehoertZumKonto(cs.syncQueue[0], 'google:B'));
  }

  {
    // Der ausfuehrende Weg prueft noch einmal selbst
    const aHeft = heft('nbA', {
      cloudKonto: 'google:A',
      updatedAt: T('2026-01-01T12:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z')
    });
    const { cs, spur } = baueWelt({ hefte: [aHeft], konto: 'google:B' });
    await cs._syncNotebook('nbA');
    check('Ein fremdes Konto wird auch am Upload abgewiesen',
      spur.hochgeladen, []);
  }

  /* ── S07 ──────────────────────────────────────────────────────────── */

  console.log('\nS07: kein fremdes Dokument ins eigene Drive');

  {
    const fremdesDok = heft('nbFremd', { origin: 'shared' });
    const eigenes = heft('nbEigen');
    const { cs } = baueWelt({ hefte: [fremdesDok, eigenes], fern: [] });

    await cs.refreshRemote();

    check('Nur das eigene Heft steht in der Schlange',
      cs.syncQueue.map(e => e.nbId), ['nbEigen']);
  }

  /* ── S10 ──────────────────────────────────────────────────────────── */

  console.log('\nS10: eine Loeschung darf ankommen');

  {
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T10:00:00Z'),
      syncedAt: T('2026-01-01T10:00:00Z'),     // seither nichts getan
      pages: [
        { id: 'p1', textContent: 'Eins', objects: [], inkStrokes: [] },
        { id: 'p2', textContent: 'Zwei', objects: [], inkStrokes: [] }
      ]
    });
    const welt = baueWelt({ hefte: [lokal] });
    const { cs } = welt;

    const fernStand = heft('nb1', {
      updatedAt: T('2026-01-01T11:00:00Z'),
      pages: [{ id: 'p1', textContent: 'Eins', objects: [], inkStrokes: [] }]
    });

    ok('Die reichhaltigere Faustregel wuerde blocken',
      cs._shouldKeepLocalNotebook(lokal, fernStand));

    // Der echte Weg – nur die Ablage nachgebaut
    cs._mergeRemoteNotebook = Object.getPrototypeOf(cs)._mergeRemoteNotebook;
    await cs._mergeRemoteNotebook(fernStand);

    check('Die geloeschte Seite kommt trotzdem an',
      welt.S.notebooks[0].pages.map(p => p.id), ['p1']);
  }

  {
    // Gegenprobe: ist hier etwas offen, bleibt die Vorsicht
    const lokal = heft('nb1', {
      updatedAt: T('2026-01-01T12:00:00Z'),    // seit dem Abgleich getippt
      syncedAt: T('2026-01-01T10:00:00Z'),
      pages: [
        { id: 'p1', textContent: 'Eins', objects: [], inkStrokes: [] },
        { id: 'p2', textContent: 'Zwei', objects: [], inkStrokes: [] }
      ]
    });
    const welt = baueWelt({ hefte: [lokal] });
    const { cs } = welt;
    welt.dirty.add('nb1');

    const fernStand = heft('nb1', {
      updatedAt: T('2026-01-01T13:00:00Z'),
      pages: [{ id: 'p1', textContent: 'Eins', objects: [], inkStrokes: [] }]
    });

    cs._mergeRemoteNotebook = Object.getPrototypeOf(cs)._mergeRemoteNotebook;
    await cs._mergeRemoteNotebook(fernStand);

    check('Mit offener eigener Arbeit bleibt beides stehen',
      welt.S.notebooks[0].pages.map(p => p.id), ['p1', 'p2']);
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
