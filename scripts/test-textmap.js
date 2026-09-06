#!/usr/bin/env node
'use strict';

/* ══════════════════════════════════════════════════════════════════════
   FLACHER TEXT UND HTML-QUELLTEXT, INEINANDER UMGERECHNET

   Prueft flatHtmlMap aus src/canvas/text.js. Daran haengt seit dem Umbau
   die gesamte Live-Bearbeitung: die Schreibmarken und die Zeilensperre
   rechnen im flachen Text, der gemeinsame Yjs-Text ist der
   HTML-Quelltext. Ohne eine EXAKTE Umrechnung dazwischen liess sich eine
   Stelle nicht mitfuehren, wenn ein anderer weiter oben etwas einfuegte
   oder loeschte – sie musste per Textsuche geraten werden, und genau
   daraus wurde „einer loescht eine Zeile, danach schreiben beide auf
   derselben".

   Nachgestellt wird ein sehr kleines DOM, das aus dem Quelltext selbst
   gebaut wird. Damit prueft der Vergleich wirklich beide Seiten
   gegeneinander und nicht zwei Fassungen derselben Annahme.

   Aufruf:  node scripts/test-textmap.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Ein sehr kleines DOM ───────────────────────────────────────────── */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

class TextNode {
  constructor(value) {
    this.nodeType = TEXT_NODE;
    this.nodeValue = value;
    this.childNodes = [];
    this.parentNode = null;
  }
}

class ElementNode {
  constructor(tag) {
    this.nodeType = ELEMENT_NODE;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
  }
  appendChild(node) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
}

/* Diese Tags schliessen sich selbst – sie bekommen nie Kinder. */
const LEER = new Set(['BR', 'IMG', 'HR', 'COL', 'INPUT']);

const ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function entschluessle(roh) {
  return roh.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (ganz, inhalt) => {
    if (inhalt[0] === '#') {
      const zahl = (inhalt[1] === 'x' || inhalt[1] === 'X')
        ? parseInt(inhalt.slice(2), 16) : parseInt(inhalt.slice(1), 10);
      return Number.isFinite(zahl) ? String.fromCodePoint(zahl) : ganz;
    }
    return Object.prototype.hasOwnProperty.call(ENTITAETEN, inhalt) ? ENTITAETEN[inhalt] : ganz;
  });
}

/**
 * Baut aus einem Quelltext das kleine DOM – so, wie der Browser es auch
 * taete. Bewusst schlicht: geprueft wird die Umrechnung, nicht die
 * Fehlertoleranz eines Parsers.
 */
function ausHtml(html) {
  const wurzel = new ElementNode('div');
  const stapel = [wurzel];
  let i = 0;

  while (i < html.length) {
    const auf = html.indexOf('<', i);
    if (auf === -1) {
      stapel[stapel.length - 1].appendChild(new TextNode(entschluessle(html.slice(i))));
      break;
    }
    if (auf > i) {
      stapel[stapel.length - 1].appendChild(new TextNode(entschluessle(html.slice(i, auf))));
    }

    /* Das Tag endet am ersten > AUSSERHALB der Anfuehrungszeichen –
       title="a>b" beendet es nicht. Genauso liest es der Browser. */
    let zu = -1;
    let anfuehrung = '';
    for (let j = auf + 1; j < html.length; j++) {
      const d = html[j];
      if (anfuehrung) { if (d === anfuehrung) anfuehrung = ''; continue; }
      if (d === '"' || d === "'") { anfuehrung = d; continue; }
      if (d === '>') { zu = j; break; }
    }
    if (zu === -1) break;
    const inhalt = html.slice(auf + 1, zu).trim();
    i = zu + 1;

    // Ein Kommentar ist kein Element
    if (inhalt.startsWith('!')) continue;

    if (inhalt.startsWith('/')) {
      if (stapel.length > 1) stapel.pop();
      continue;
    }

    const name = inhalt.split(/[\s/]/)[0].toUpperCase();
    const el = new ElementNode(name);
    /* Ein style="display:…" wird ausgewertet – daran haengt, ob etwas
       eine eigene Zeile ist (istFlatBlockEl). */
    const stil = /style\s*=\s*"([^"]*)"/i.exec(inhalt);
    if (stil) {
      const anzeige = /display\s*:\s*([a-z-]+)/i.exec(stil[1]);
      if (anzeige) el.style.display = anzeige[1];
    }
    stapel[stapel.length - 1].appendChild(el);
    if (!LEER.has(name) && !inhalt.endsWith('/')) stapel.push(el);
  }
  return wurzel;
}

/* ── Umgebung ───────────────────────────────────────────────────────── */

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'canvas', 'text.js'), 'utf8');

const ctx = {
  console,
  Node: { ELEMENT_NODE, TEXT_NODE },
  Range: { START_TO_START: 0 },
  document: {
    createRange: () => ({
      setStart() {}, collapse() {}, selectNodeContents() {},
      compareBoundaryPoints: () => 0
    }),
    createElement: (tag) => new ElementNode(tag),
    createTextNode: (v) => new TextNode(v),
    createTreeWalker: () => ({ nextNode: () => null })
  },
  NodeFilter: { SHOW_TEXT: 4 },
  getComputedStyle: (node) => ({ display: (node && node.style && node.style.display) || '' }),
  DOMRect: class {},
  getZoom: () => 1,
  window: {}
};
ctx.window.getSelection = () => null;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(source, ctx);

const { flatHtmlMap, flatTextOf, htmlZeichen } = ctx;

/* ── Pruefwerkzeug ──────────────────────────────────────────────────── */

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  if (!ok) {
    console.log('      erwartet: ' + JSON.stringify(expected));
    console.log('      bekommen: ' + JSON.stringify(actual));
  }
}

/**
 * Der Rundgang: JEDE Stelle des flachen Textes ins HTML und zurueck.
 * Was dabei herauskommt, muss wieder dieselbe Stelle sein.
 *
 * >>> Warum die Zeilengrenzen ausdruecklich dazugehoeren <<<
 * Hier wurden sie uebersprungen, mit der Begruendung, im Quelltext
 * stehe an ihrer Stelle ein Tag und kein Zeichen. Das war bequem und
 * hat den schwersten Fehler zugedeckt: Ende der einen Zeile und Anfang
 * der naechsten fielen auf dieselbe Stelle zusammen. Wer am Zeilenende
 * schrieb – also praktisch jeder, immer –, dessen Marke wurde beim
 * anderen eine Zeile tiefer gezeichnet.
 */
function rundgang(label, html) {
  const dom = ausHtml(html);
  const karte = flatHtmlMap(dom, html);
  const flach = flatTextOf(dom);

  if (!karte.ok) {
    failed++;
    console.log('  ✗ ' + label + ' – die Zuordnung passt gar nicht');
    return;
  }

  const daneben = [];
  for (let f = 0; f <= flach.length; f++) {
    const zurueck = karte.flatVonHtml(karte.htmlVonFlat(f));
    if (zurueck !== f) daneben.push([f, zurueck]);
  }
  check(label, daneben, []);
}

/* ══ 1. Reiner Text – der Alltagsfall ══════════════════════════════ */

console.log('Reiner Text, wie ihn eine getippte Seite hat');

{
  const html = 'eins\nzwei\ndrei';
  const dom = ausHtml(html);
  const karte = flatHtmlMap(dom, html);
  check('Die Zuordnung passt', karte.ok, true);
  check('Ohne Tags ist sie die Gleichheit', [0, 5, 10].map(f => karte.htmlVonFlat(f)), [0, 5, 10]);
  check('Und zurueck ebenso', [0, 5, 10].map(h => karte.flatVonHtml(h)), [0, 5, 10]);
}
rundgang('Jede Stelle findet sich wieder', 'eins\nzwei\ndrei');

/* ══ 2. Absaetze: die Zeilengrenze ist ein Tag ═════════════════════ */

console.log('\nAbsaetze');

{
  const html = '<p>abc</p><p>def</p>';
  const dom = ausHtml(html);
  const karte = flatHtmlMap(dom, html);

  check('Flacher Text', flatTextOf(dom), 'abc\ndef');
  check('Die Zuordnung passt', karte.ok, true);
  // <p>=0..2, a=3 b=4 c=5, </p>=6..9, <p>=10..12, d=13 e=14 f=15
  check('Erstes Zeichen', karte.htmlVonFlat(0), 3);
  check('Letztes der ersten Zeile', karte.htmlVonFlat(2), 5);
  check('Erstes Zeichen der zweiten Zeile', karte.htmlVonFlat(4), 13);
  check('Und zurueck', karte.flatVonHtml(13), 4);

  /* ══ Das Ende der einen Zeile ist NICHT der Anfang der naechsten ══
     Der Fehler, der hier festgehalten wird: die Zeilengrenze fiel auf
     den Anfang des naechsten Zeichens. Damit meldete, wer am Zeilenende
     schrieb, eine Stelle, die beim anderen eine Zeile tiefer landete –
     „sein Cursor kommt dorthin, wo ich hinklicke".

     Die Grenze liegt jetzt am ENDE des Zeichens davor, also noch vor
     dem </p> und damit eindeutig in der ersten Zeile. */
  check('Die Zeilengrenze liegt hinter dem c, nicht vor dem d',
    karte.htmlVonFlat(3), 6);
  check('Und findet sich wieder', karte.flatVonHtml(6), 3);
  check('Ende der Zeile und Anfang der naechsten sind VERSCHIEDEN',
    karte.htmlVonFlat(3) !== karte.htmlVonFlat(4), true);

  /* Eine Stelle MITTEN im Tag gehoert zur naechsten Zeile – dort landet
     auch das Naechste, was jemand tippt. */
  check('Mitten im Tag', karte.flatVonHtml(8), 4);
}
rundgang('Jede Stelle findet sich wieder', '<p>abc</p><p>def</p>');

/* ══ 3. Verschluesselte Zeichen ════════════════════════════════════ */

console.log('\nVerschluesselte Zeichen');

{
  const html = '<p>a&amp;b</p>';
  const dom = ausHtml(html);
  const karte = flatHtmlMap(dom, html);
  check('Flacher Text', flatTextOf(dom), 'a&b');
  check('Die Zuordnung passt', karte.ok, true);
  check('Das & steht beim Anfang der Entitaet', karte.htmlVonFlat(1), 4);
  check('Das Zeichen danach steht dahinter', karte.htmlVonFlat(2), 9);
  check('Und zurueck', [karte.flatVonHtml(4), karte.flatVonHtml(9)], [1, 2]);
}
rundgang('Rundgang mit Entitaeten', '<p>a&amp;b &lt;c&gt; d&nbsp;e</p>');

/* ══ 4. Text, der auch in einem Attribut steht ═════════════════════
   >>> Der Fehler, den das festhaelt <<<
   Ein Verweis traegt seine Adresse im Tag: <a href="abc">abc</a>. Wer
   die Zeichen nur suchen wuerde, statt die Tags zu ueberspringen, faende
   „abc" zuerst IM Attribut – und jede Stelle dahinter saesse um die
   Laenge der Adresse daneben.
   ══════════════════════════════════════════════════════════════════ */

console.log('\nText, der auch im Tag steht');

{
  const html = '<p><a href="abc">abc</a></p>';
  const dom = ausHtml(html);
  const karte = flatHtmlMap(dom, html);
  check('Flacher Text', flatTextOf(dom), 'abc');
  check('Die Zuordnung passt', karte.ok, true);
  // <p>=0..2, <a href="abc">=3..16, a=17
  check('Das a des TEXTES, nicht das der Adresse', karte.htmlVonFlat(0), 17);
}
rundgang('Rundgang mit Adresse', '<p><a href="abc">abc</a> und mehr</p>');

// Ein > innerhalb der Anfuehrungszeichen beendet das Tag nicht
rundgang('Spitze Klammer im Attribut', '<p><span title="a>b">Text</span> dahinter</p>');

/* ══ 5. Das, was der Editor wirklich erzeugt ═══════════════════════ */

console.log('\nWie es im Heft aussieht');

rundgang('Auszeichnungen', '<p>ganz <b>dick</b> gedruckt</p>');
rundgang('Liste', '<ul><li>Eins</li><li>Zwei</li><li>Drei</li></ul>');
rundgang('Leere Zeile dazwischen', '<p>abc</p><p><br></p><p>def</p>');
/* Mehrere Grenzen hintereinander muessen auseinanderzuhalten sein –
   sonst faellt der Rueckweg immer auf die erste. Zwei leere Zeilen
   entstehen durch zweimal Enter, das ist nichts Ausgefallenes. */
rundgang('Zwei leere Zeilen', '<p>abc</p><p><br></p><p><br></p><p>def</p>');
rundgang('Leere Zeile am Anfang', '<p><br></p><p>abc</p>');
rundgang('Leere Zeile am Ende', '<p>abc</p><p><br></p>');
rundgang('Nur leere Zeilen', '<p><br></p><p><br></p>');
rundgang('Ueberschrift und Absatz', '<h1 class="j-title-1">Titel</h1><p>Darunter</p>');
rundgang('Tabelle', '<table class="j-table"><tbody><tr><td>A</td><td>B</td></tr></tbody></table>');
rundgang('Kommentar im Quelltext', '<p>davor</p><!-- Notiz --><p>danach</p>');
rundgang('display per Stil', '<p>Oben</p><span style="display:block">Zeile</span>');

/* ══ 6. Was nicht zusammenpasst, sagt es ═══════════════════════════
   Der Quelltext gehoert zu einem aelteren Stand als das Feld. Dann darf
   die Zuordnung KEINE Zahl liefern, sondern muss sich melden – der
   Aufrufer nimmt dann den Weg ueber den Anker.
   ══════════════════════════════════════════════════════════════════ */

console.log('\nWenn Quelltext und Feld nicht zusammenpassen');

{
  const dom = ausHtml('<p>abc</p>');
  const karte = flatHtmlMap(dom, '<p>ganz etwas anderes</p>');
  check('Die Zuordnung meldet sich ab', karte.ok, false);
  check('Und liefert keine Stelle', [karte.htmlVonFlat(1), karte.flatVonHtml(4)], [-1, -1]);
}

/* ══ 7. Die Zerlegung des Quelltextes fuer sich ════════════════════ */

console.log('\nDie Zeichen ausserhalb der Tags');

check('Tags fallen weg', htmlZeichen('<p>ab</p>').text, 'ab');
check('Mit ihren Stellen', htmlZeichen('<p>ab</p>').stelle, [3, 4]);
check('Entitaet zaehlt ein Zeichen', htmlZeichen('&amp;x').text, '&x');
check('Und liegt am Anfang der Entitaet', htmlZeichen('&amp;x').stelle, [0, 5]);
check('Ein & ohne Semikolon bleibt Text', htmlZeichen('a & b').text, 'a & b');
check('Kommentare fallen weg', htmlZeichen('a<!-- weg -->b').text, 'ab');

/* Ein Zeichen jenseits der Grundebene belegt zwei Stellen – im flachen
   Text genauso. Sonst saesse alles dahinter um eins daneben. */
check('Zeichen jenseits der Grundebene zaehlen zwei',
  htmlZeichen('&#128512;').text.length, 2);
check('Beide zeigen auf dieselbe Entitaet',
  htmlZeichen('&#128512;').stelle, [0, 0]);

/* ══ Ergebnis ══════════════════════════════════════════════════════ */

console.log('');
if (failed) {
  console.log(failed + ' Pruefung(en) fehlgeschlagen.');
  process.exit(1);
}
console.log('Alle Pruefungen bestanden.');
