'use strict';

/* ══════════════════════════════════════════════════════════════════════
   GRIFFBEREIT — UNTERLAGEN NEBEN DEM HEFT

   Ein Skript als PDF, ein abfotografiertes Tafelbild: Sachen, die beim
   Schreiben danebenliegen sollen, ohne dass sie Teil des Hefts werden.

   >>> Sie werden NICHT kopiert <<<
   Gemerkt wird allein der Ort (main.js, Abschnitt „Griffbereit"). Damit
   gibt es keinen zweiten Stand, der still veraltet, und ein Heft wird
   nicht um ein 40-MB-Skript schwerer, das ohnehin schon auf der Platte
   liegt. Der Preis steht in der Anzeige: ist die Datei verschoben oder
   weg, sagt die Leiste das, statt etwas Altes zu zeigen.

   ── Die drei Stücke ────────────────────────────────────────────────
     Die LEISTE (griff-panel) geht über den Knopf in der Werkzeugzeile
     auf. Darin wird hinzugefügt, umbenannt, umsortiert, weggenommen.

     Die REITER (griff-reiter) stehen an der Kante, sobald die Leiste zu
     ist – hochkant, mit dem vergebenen Namen, zusammen über die ganze
     Höhe. Sie sind ein Flex-Kind und liegen nicht über dem Blatt: eine
     Marke von 20 px darf das (der Kommentar-Griff tut es), ein Streifen
     über die volle Höhe nicht.

     Die ANSICHT (griff-view) fährt aus einem Reiter heraus – nach links
     wischen oder antippen. Sie schiebt das Blatt zur Seite wie Chat und
     Kommentare und deckt es nie zu; breiter als das halbe Fenster wird
     sie nicht, sonst bliebe vom Heft zu wenig übrig.

   ── Was sich je Datei merkt ────────────────────────────────────────
   Breite und Rollstelle. Wer ein Skript auf Seite 40 zuklappt, will
   beim nächsten Aufschlagen wieder dort stehen. Die Stelle wird als
   ANTEIL gespeichert (0 … 1) und nicht in Pixeln: bei einem PDF hängt
   die Gesamthöhe an der Breite, und eine gemerkte Pixelzahl zeigte nach
   dem Ziehen der Kante irgendwohin.

   ── Warum die Seiten erst beim Hinsehen entstehen ──────────────────
   Ein Skript hat schnell 300 Seiten. Alle vorab zu zeichnen dauert
   Minuten und legt den Speicher lahm. Stattdessen steht für jede Seite
   ein leerer Kasten in der richtigen Höhe, und gezeichnet wird, was in
   die Nähe des Ausschnitts kommt (IntersectionObserver).
   ══════════════════════════════════════════════════════════════════════ */

(function () {
  const api = () => (window.api && window.api.griffbereit) || null;

  /* Schmaler als das hier wird die Ansicht nicht – darunter passt keine
     PDF-Seite mehr, auf der man etwas lesen könnte. */
  const MIN_BREITE = 220;
  const VORGABE_BREITE = 420;

  /* Wie viele Seiten vorab vermessen werden. Darüber hinaus gilt das
     Seitenverhältnis der ersten Seite für alle – bei einem Skript mit
     durchweg gleichem Papier stimmt das, und bei 400 Seiten wäre das
     Messen ein spürbares Warten vor dem ersten Blick. */
  const HOECHSTENS_GEMESSEN = 120;

  /** Der Spiegel dessen, was der Hauptprozess hält. */
  let _stand = { versteckt: false, dateien: [] };

  let _offen = null;      // Kennung der aufgeschlagenen Datei
  let _pdf = null;        // das offene PDF-Dokument (pdf.js)
  let _bildUrl = '';      // objectURL des offenen Bildes
  let _beobachter = null; // welche Seiten gerade im Ausschnitt liegen
  let _sichtbar = new Set();
  let _rollTimer = null;
  let _breiteTimer = null;
  /* Jedes Aufschlagen bekommt eine Nummer. Eine Datei, die während des
     Ladens wieder zugemacht wurde, darf ihren Inhalt nicht mehr
     einhängen – sonst steht im Fenster das PDF von vorhin. */
  let _lauf = 0;

  const txt = (schluessel, ersatz) =>
    (typeof t === 'function' ? t(schluessel) : ersatz) || ersatz;

  /** Leert einen Kasten, ohne innerHTML anzufassen. */
  function leere(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function datei(id) {
    return _stand.dateien.find(d => d.id === String(id)) || null;
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LEISTE

     Gebaut wie Chat und Kommentare und an derselben Kante. Sie schließt
     die beiden anderen und wird von ihnen geschlossen: drei Leisten
     nebeneinander liessen vom Blatt nichts übrig.
     ══════════════════════════════════════════════════════════════════ */
  const leiste = () => E('griff-panel');
  const leisteOffen = () => !!leiste() && leiste().classList.contains('open');

  function setzeLeiste(auf) {
    const p = leiste();
    if (!p || p.classList.contains('open') === auf) return;

    if (auf) {
      if (typeof window.closeCommentPanel === 'function') window.closeCommentPanel();
      if (typeof window.closeChatPanel === 'function') window.closeChatPanel();
    }

    p.classList.toggle('open', auf);
    E('btn-griff')?.classList.toggle('active', auf);
    // Solange die Leiste offen ist, sind die Namen dort zu lesen
    zeichneReiter();
    nachLayout();
  }

  /* ui/comments.js und ui/chat.js fragen das, bevor sie aufmachen. */
  window.griffBlocksPanels = leisteOffen;
  window.closeGriffPanel = () => setzeLeiste(false);

  /** Die Blattspalte hat sich geändert: Zoom und Kommentarkarten nachziehen. */
  function nachLayout() {
    setTimeout(() => {
      if (typeof _applyZoom === 'function') _applyZoom();
      if (typeof window.refreshComments === 'function') window.refreshComments();
    }, 220);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE LISTE IN DER LEISTE
     ══════════════════════════════════════════════════════════════════ */

  function knopf(klasse, beschriftung, titel, tun) {
    const b = document.createElement('button');
    b.className = klasse;
    b.textContent = beschriftung;
    if (titel) b.title = titel;
    b.addEventListener('click', (e) => { e.stopPropagation(); tun(); });
    return b;
  }

  function zeichneListe() {
    const liste = E('griff-liste');
    if (!liste) return;
    leere(liste);

    if (!_stand.dateien.length) {
      const leer = document.createElement('div');
      leer.className = 'griff-leer';
      leer.textContent = txt('griffLeer',
        'Noch nichts hinterlegt. Zieh ein PDF oder ein Bild hierher – es wird nicht kopiert.');
      liste.appendChild(leer);
      return;
    }

    for (const d of _stand.dateien) {
      const zeile = document.createElement('div');
      zeile.className = 'griff-zeile' + (d.da ? '' : ' fehlt');
      zeile.dataset.id = d.id;

      /* Gezogen wird am Griff, nicht an der Zeile: sonst liesse sich die
         Liste mit dem Finger nicht mehr rollen (dieselbe Überlegung wie
         im Abschnitts-Manager, ui/sidebar.js). */
      const griff = document.createElement('span');
      griff.className = 'griff-zeile-griff';
      griff.title = txt('griffOrdnen', 'Ziehen zum Umsortieren');
      griff.textContent = '⠿';
      griff.addEventListener('pointerdown', (e) => beginneZug(e, d.id));

      const art = document.createElement('span');
      art.className = 'griff-zeile-art';
      art.textContent = d.art === 'pdf' ? 'PDF' : 'BILD';

      const name = document.createElement('span');
      name.className = 'griff-zeile-name';
      name.textContent = d.name;
      name.title = d.da ? d.name : txt('griffFehlt', 'Datei konnte nicht gefunden werden');

      const werkzeug = document.createElement('span');
      werkzeug.className = 'griff-zeile-tools';
      werkzeug.appendChild(knopf('griff-mini', '✎', txt('griffUmbenennen', 'Umbenennen'),
        () => benenneUm(d.id)));
      werkzeug.appendChild(knopf('griff-mini gefahr', '✕', txt('griffEntfernen', 'Entfernen'),
        () => nimmWeg(d.id)));

      zeile.append(griff, art, name, werkzeug);

      /* Anklicken schlägt auf – dasselbe wie ein Wischen am Reiter. Nach
         einem Zug am Griff aber nicht: dort endet der Zeiger über einer
         Zeile, und Chromium macht daraus noch einen Klick. */
      zeile.addEventListener('click', () => {
        if (Date.now() - _zugEnde < 300) return;
        oeffne(d.id);
      });

      liste.appendChild(zeile);
    }
  }

  function zeichneFuss() {
    const voll = _stand.dateien.length >= 3;
    const feld = E('griff-ablage');
    if (feld) feld.classList.toggle('voll', voll);
    const waehl = E('griff-waehlen');
    if (waehl) waehl.disabled = voll;
    const text = feld?.querySelector('.griff-ablage-text');
    if (text) {
      text.textContent = voll
        ? txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.')
        : txt('griffZiehen', 'Datei hierher ziehen');
    }

    const schalter = E('griff-verstecken');
    const schalterText = E('griff-verstecken-text');
    if (schalterText) {
      schalterText.textContent = _stand.versteckt
        ? txt('griffEinblenden', 'Alle einblenden')
        : txt('griffAusblenden', 'Alle ausblenden');
    }
    if (schalter) {
      schalter.classList.toggle('an', _stand.versteckt);
      schalter.disabled = !_stand.dateien.length;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE REITER AN DER KANTE

     Sie teilen sich die Höhe zu gleichen Teilen (flex: 1) – bei drei
     Dateien also je ein Drittel. Zu sehen sind sie nur, solange die
     Leiste zu ist: dort stehen die Namen ohnehin, und beides zugleich
     wäre zweimal dasselbe an derselben Kante.
     ══════════════════════════════════════════════════════════════════ */
  function zeichneReiter() {
    const streifen = E('griff-reiter');
    if (!streifen) return;
    leere(streifen);

    const zeigen = !_stand.versteckt && _stand.dateien.length && !leisteOffen();
    streifen.style.display = zeigen ? 'flex' : 'none';
    if (!zeigen) return;

    for (const d of _stand.dateien) {
      const b = document.createElement('button');
      b.className = 'griff-reiter-btn'
        + (String(_offen) === d.id ? ' aktiv' : '')
        + (d.da ? '' : ' fehlt');
      b.dataset.id = d.id;
      b.title = d.da
        ? txt('griffAufschlagen', 'Nach links wischen zum Aufschlagen')
        : txt('griffFehlt', 'Datei konnte nicht gefunden werden');

      const name = document.createElement('span');
      name.className = 'griff-reiter-name';
      name.textContent = d.name;
      b.appendChild(name);

      haengeWischAn(b, d.id);
      streifen.appendChild(b);
    }
  }

  function zeichne() {
    zeichneListe();
    zeichneFuss();
    zeichneReiter();
    // Eine ausgeblendete oder weggenommene Datei bleibt nicht offen stehen
    if (_offen && (_stand.versteckt || !datei(_offen))) schliesse();
  }

  /* ══════════════════════════════════════════════════════════════════
     HINZUFÜGEN

     Zwei Wege, ein Ziel: der Hauptprozess bietet die Datei an, hier wird
     nach dem Namen gefragt, dann wird sie übernommen. Der Pfad geht
     dabei nie durch dieses Fenster (siehe main.js).
     ══════════════════════════════════════════════════════════════════ */
  async function frageUndUebernimm(angebot) {
    if (!angebot || !angebot.id) return;
    if (_stand.dateien.length >= 3) {
      toast(txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.'), true);
      return;
    }
    const name = await txtModal(txt('griffNameFrage', 'Wie soll die Unterlage heißen?'),
      angebot.vorschlag || '');
    if (!name) return;

    const antwort = await api().uebernehmen(angebot.id, name);
    if (antwort && antwort.fehler) {
      toast(txt('griffVoll', 'Drei Unterlagen sind das Höchste. Nimm zuerst eine weg.'), true);
      return;
    }
    _stand = antwort;
    /* Frisch Hinzugefügtes soll man sehen – auch wenn gerade alles
       ausgeblendet ist. Sonst legt jemand eine Datei ab und nichts
       geschieht. */
    if (_stand.versteckt) _stand = await api().verstecken(false);
    zeichne();
  }

  async function waehleAus() {
    if (!api()) return;
    const angebot = await api().waehlen();
    if (angebot) await frageUndUebernimm(angebot);
  }

  async function benenneUm(id) {
    const d = datei(id);
    if (!d) return;
    const name = await txtModal(txt('griffNameFrage', 'Wie soll die Unterlage heißen?'), d.name);
    if (!name || name === d.name) return;
    _stand = await api().aendern(id, { name });
    zeichne();
    if (String(_offen) === String(id)) {
      const anzeige = E('griff-view-name');
      if (anzeige) anzeige.textContent = datei(id)?.name || '';
    }
  }

  async function nimmWeg(id) {
    const d = datei(id);
    if (!d) return;
    const ok = await showConfirm(
      txt('griffWegFrage', 'Nur der Verweis wird entfernt – die Datei selbst bleibt liegen, wo sie ist.'));
    if (!ok) return;
    if (String(_offen) === String(id)) schliesse();
    _stand = await api().entfernen(id);
    zeichne();
  }

  /* ══════════════════════════════════════════════════════════════════
     UMSORTIEREN

     Zeiger-Ereignisse und nicht HTML5-Drag: dragstart gibt es mit dem
     Finger nicht. Bei höchstens drei Zeilen genügt es, bei jeder
     Bewegung die Mitten abzufragen – die Rechnerei, die der
     Abschnitts-Manager für hundert Seiten treibt, wäre hier Aufwand
     ohne Gegenwert.
     ══════════════════════════════════════════════════════════════════ */
  let _zugId = null, _zugZeiger = null, _zugZiel = null, _zugEnde = 0;

  /**
   * Die neue Reihenfolge nach einem Zug.
   *
   * `ziel` ist eine Stelle in der Liste, WIE SIE DASTEHT – die gezogene
   * Zeile steht darin noch mit. Wird sie nach hinten getragen, rutscht
   * durch ihr Herausnehmen alles dahinter um eins vor; deshalb das
   * `ziel - 1`. Ohne diese Zeile landet man beim Ziehen nach unten immer
   * eine Stelle zu weit.
   */
  function neueFolge(ids, gezogen, ziel) {
    const folge = ids.map(String);
    const von = folge.indexOf(String(gezogen));
    if (von === -1) return folge;
    folge.splice(von, 1);
    folge.splice(ziel > von ? ziel - 1 : ziel, 0, String(gezogen));
    return folge;
  }

  function beginneZug(e, id) {
    const liste = E('griff-liste');
    if (!liste) return;
    e.preventDefault();
    _zugId = id;
    _zugZeiger = e.pointerId;
    _zugZiel = null;
    liste.classList.add('ordnet');
    liste.querySelector('.griff-zeile[data-id="' + CSS.escape(String(id)) + '"]')
      ?.classList.add('wandert');
    try { liste.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    ruesteZug(liste);
  }

  function stelleAn(liste, y) {
    const zeilen = [...liste.querySelectorAll('.griff-zeile')];
    for (let i = 0; i < zeilen.length; i++) {
      const r = zeilen[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return zeilen.length;
  }

  function ruesteZug(liste) {
    if (liste._zugBereit) return;
    liste._zugBereit = true;

    liste.addEventListener('pointermove', (e) => {
      if (!_zugId || e.pointerId !== _zugZeiger) return;
      e.preventDefault();
      _zugZiel = stelleAn(liste, e.clientY);
      const zeilen = [...liste.querySelectorAll('.griff-zeile')];
      zeilen.forEach((z, i) => {
        z.classList.toggle('davor', i === _zugZiel);
        z.classList.toggle('dahinter', _zugZiel === zeilen.length && i === zeilen.length - 1);
      });
    });

    const beenden = async (e) => {
      if (!_zugId || e.pointerId !== _zugZeiger) return;
      const gezogen = _zugId;
      const ziel = _zugZiel;
      _zugId = null; _zugZeiger = null; _zugZiel = null; _zugEnde = Date.now();
      liste.classList.remove('ordnet');
      liste.querySelectorAll('.griff-zeile')
        .forEach(z => z.classList.remove('wandert', 'davor', 'dahinter'));
      try { liste.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      if (ziel === null) return;

      _stand = await api().ordnen(neueFolge(_stand.dateien.map(d => d.id), gezogen, ziel));
      zeichne();
    };

    liste.addEventListener('pointerup', beenden);
    liste.addEventListener('pointercancel', beenden);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE ANSICHT AUF- UND ZUMACHEN
     ══════════════════════════════════════════════════════════════════ */

  function ansicht() { return E('griff-view'); }
  function ansichtOffen() { return !!ansicht() && ansicht().classList.contains('open'); }

  /** Breiter als das halbe Fenster geht es nicht – sonst bleibt vom Heft nichts. */
  function grenze() {
    return Math.max(MIN_BREITE, Math.round(window.innerWidth / 2));
  }

  function setzeBreite(px, sofort) {
    const v = ansicht();
    if (!v) return 0;
    const b = Math.min(grenze(), Math.max(MIN_BREITE, Math.round(px || VORGABE_BREITE)));
    if (sofort) v.classList.add('zieht');
    v.style.setProperty('--griff-breite', b + 'px');
    return b;
  }

  async function oeffne(id) {
    const d = datei(id);
    if (!d) return;
    if (String(_offen) === String(id) && ansichtOffen()) { schliesse(); return; }

    /* Eine Datei, die beim letzten Blick fehlte, wird trotzdem
       aufgeschlagen. `d.da` ist ein Stand von vorhin – der Stick kann
       wieder stecken, das Netzlaufwerk wieder da sein. Wer sie antippt,
       will genau das wissen, und das Lesen beantwortet es verbindlich. */

    // Erst die Stelle der bisher offenen Datei sichern, dann wechseln
    merkeStelle();
    raeumeInhaltWeg();
    _offen = String(id);
    const lauf = ++_lauf;

    const v = ansicht();
    v?.classList.remove('zieht');
    setzeBreite(d.breite || VORGABE_BREITE);
    v?.classList.add('open');
    const anzeige = E('griff-view-name');
    if (anzeige) anzeige.textContent = d.name;
    zeichneReiter();
    nachLayout();

    const koerper = E('griff-view-body');
    leere(koerper);
    const laedt = document.createElement('div');
    laedt.className = 'griff-hinweis';
    laedt.textContent = txt('griffLaedt', 'wird geöffnet …');
    koerper.appendChild(laedt);

    let antwort;
    try {
      antwort = await api().lesen(id);
    } catch (err) {
      antwort = { ok: false, grund: 'fehlt' };
    }
    if (lauf !== _lauf) return;   // inzwischen wieder zugemacht

    if (!antwort || !antwort.ok) {
      const grund = antwort && antwort.grund;
      zeigeMeldung(d.name,
        grund === 'gross' ? txt('griffZuGross', 'Die Datei ist zu groß zum Anzeigen.')
        : grund === 'art' ? txt('griffKeineAnzeige', 'Diese Datei lässt sich hier nicht anzeigen.')
        : txt('griffFehlt', 'Datei konnte nicht gefunden werden'));
      // Der Reiter soll das ebenfalls zeigen
      _stand = await api().liste();
      zeichne();
      return;
    }

    /* Der Hinweis bleibt stehen, bis der Inhalt da ist. Ein PDF misst
       vorher seine Seiten aus – wer ihn hier schon wegnähme, sähe bei
       einem Skript zwei Sekunden lang eine leere Fläche. */
    try {
      if (antwort.art === 'pdf') await zeigePdf(antwort.bytes, lauf);
      else zeigeBild(antwort.bytes, antwort.mime);
    } catch (err) {
      console.warn('[Griffbereit] Anzeigen fehlgeschlagen:', err?.message || err);
      if (lauf === _lauf) {
        zeigeMeldung(d.name, txt('griffKaputt', 'Die Datei lässt sich nicht anzeigen.'));
      }
      return;
    }
    if (lauf !== _lauf) return;

    // Dort weitermachen, wo zuletzt aufgehört wurde
    requestAnimationFrame(() => rolleZuAnteil(d.stelle || 0));

    /* Und noch einmal, wenn die Leiste ausgefahren ist. Während der
       Bewegung stimmt die Breite noch nicht ganz, und eine Seite, die in
       halber Breite gezeichnet wurde, bliebe unscharf stehen. */
    setTimeout(zeichneSichtbareNeu, 300);
  }

  function zeigeMeldung(name, text) {
    const v = ansicht();
    if (!v) return;
    v.classList.add('open');
    const anzeige = E('griff-view-name');
    if (anzeige) anzeige.textContent = name || '';
    const koerper = E('griff-view-body');
    leere(koerper);
    const p = document.createElement('div');
    p.className = 'griff-fehlt-text';
    p.textContent = text;
    koerper.appendChild(p);
    nachLayout();
  }

  function schliesse() {
    merkeStelle();
    _offen = null;
    _lauf++;
    raeumeInhaltWeg();
    const v = ansicht();
    if (v) v.classList.remove('open');
    const anzeige = E('griff-view-name');
    if (anzeige) anzeige.textContent = '';
    leere(E('griff-view-body'));
    zeichneReiter();
    nachLayout();
  }

  /* Ein PDF hängt an Arbeitern und Puffern, ein Bild an einer URL. Beides
     muss beim Wechsel weg – sonst sammelt sich mit jedem Aufschlagen ein
     weiterer Satz an, und nach dem zehnten Mal steht die App. */
  function raeumeInhaltWeg() {
    if (_beobachter) { _beobachter.disconnect(); _beobachter = null; }
    _sichtbar = new Set();
    if (_pdf) { try { _pdf.destroy(); } catch (err) { /* egal */ } _pdf = null; }
    if (_bildUrl) { try { URL.revokeObjectURL(_bildUrl); } catch (err) { /* egal */ } _bildUrl = ''; }
  }

  /* ══════════════════════════════════════════════════════════════════
     DER INHALT
     ══════════════════════════════════════════════════════════════════ */

  function zeigeBild(bytes, mime) {
    const koerper = E('griff-view-body');
    leere(koerper);
    _bildUrl = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/png' }));
    const img = document.createElement('img');
    img.className = 'griff-blatt';
    img.alt = '';
    img.src = _bildUrl;
    koerper.appendChild(img);
  }

  async function zeigePdf(bytes, lauf) {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js fehlt');
    const koerper = E('griff-view-body');

    /* Eine eigene Kopie: pdf.js darf den Puffer übernehmen und leeren,
       und der aus der Brücke gehört uns nicht allein. */
    const daten = new Uint8Array(bytes);

    const doc = await pdfjsLib.getDocument({ data: daten }).promise;
    if (lauf !== _lauf) { try { doc.destroy(); } catch (err) { /* egal */ } return; }
    _pdf = doc;

    // Die Verhältnisse vorab – daran hängt die Höhe der leeren Kästen
    const verhaeltnisse = [];
    const messen = Math.min(doc.numPages, HOECHSTENS_GEMESSEN);
    for (let n = 1; n <= messen; n++) {
      const seite = await doc.getPage(n);
      const v = seite.getViewport({ scale: 1 });
      verhaeltnisse.push(v.width / v.height);
      if (lauf !== _lauf) return;
    }
    const ersatz = verhaeltnisse[0] || 0.7071;   // A4 hochkant

    leere(koerper);
    for (let n = 1; n <= doc.numPages; n++) {
      const kasten = document.createElement('div');
      kasten.className = 'griff-seite';
      kasten.dataset.nr = String(n);
      kasten.style.aspectRatio = String(verhaeltnisse[n - 1] || ersatz);
      koerper.appendChild(kasten);
    }

    /* Was in die Nähe kommt, wird gezeichnet. 600 px Vorlauf: beim
       Rollen soll die Seite schon dastehen, nicht erst entstehen. */
    _beobachter = new IntersectionObserver((eintraege) => {
      for (const e of eintraege) {
        if (e.isIntersecting) { _sichtbar.add(e.target); zeichneSeite(e.target); }
        else _sichtbar.delete(e.target);
      }
    }, { root: koerper, rootMargin: '600px 0px' });

    for (const k of koerper.querySelectorAll('.griff-seite')) _beobachter.observe(k);
  }

  async function zeichneSeite(kasten) {
    if (!_pdf || kasten._zeichnet) return;
    const breite = kasten.clientWidth;
    if (breite < 10) return;
    // Schon in dieser Breite gezeichnet: dann gibt es nichts zu tun
    if (kasten._beiBreite && Math.abs(kasten._beiBreite - breite) < 8) return;

    kasten._zeichnet = true;
    const lauf = _lauf;
    try {
      const seite = await _pdf.getPage(Number(kasten.dataset.nr));
      if (lauf !== _lauf) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const roh = seite.getViewport({ scale: 1 });
      const viewport = seite.getViewport({ scale: (breite * dpr) / roh.width });

      const leinwand = document.createElement('canvas');
      leinwand.width = Math.round(viewport.width);
      leinwand.height = Math.round(viewport.height);
      leinwand.className = 'griff-seite-bild';
      await seite.render({ canvasContext: leinwand.getContext('2d'), viewport }).promise;
      if (lauf !== _lauf) return;

      // Das gemessene Verhältnis ist genauer als die Schätzung von vorhin
      kasten.style.aspectRatio = String(roh.width / roh.height);
      leere(kasten);
      kasten.appendChild(leinwand);
      kasten._beiBreite = breite;
    } catch (err) {
      console.warn('[Griffbereit] Seite', kasten.dataset.nr, err?.message || err);
    } finally {
      kasten._zeichnet = false;
    }
  }

  /** Nach dem Ziehen an der Kante: was im Ausschnitt liegt, neu und scharf. */
  function zeichneSichtbareNeu() {
    for (const k of _sichtbar) zeichneSeite(k);
  }

  /* ══════════════════════════════════════════════════════════════════
     DIE STELLE MERKEN

     Als Anteil, nicht in Pixeln: die Gesamthöhe hängt an der Breite.
     Geschrieben wird verzögert – beim Rollen liefe sonst je Bildzeile
     ein Schreibvorgang auf die Platte.
     ══════════════════════════════════════════════════════════════════ */
  function anteilJetzt() {
    const k = E('griff-view-body');
    if (!k) return 0;
    const weg = k.scrollHeight - k.clientHeight;
    return weg > 0 ? Math.min(1, Math.max(0, k.scrollTop / weg)) : 0;
  }

  function rolleZuAnteil(anteil) {
    const k = E('griff-view-body');
    if (!k) return;
    const weg = k.scrollHeight - k.clientHeight;
    if (weg > 0) k.scrollTop = Math.round(weg * anteil);
  }

  function merkeStelle() {
    if (!_offen || !api()) return;
    const d = datei(_offen);
    if (!d) return;
    const anteil = anteilJetzt();
    d.stelle = anteil;                       // im Spiegel gleich mitziehen
    api().aendern(_offen, { stelle: anteil }).catch(() => { /* egal */ });
  }

  /* ══════════════════════════════════════════════════════════════════
     WISCHEN

     Ein Zeiger-Ereignis spricht Maus, Finger und Stift gleich an – damit
     ist dieselbe Geste am Reiter zugleich das Antippen für die Maus:
     kaum bewegt heisst Klick, nach links gezogen heisst aufschlagen.
     ══════════════════════════════════════════════════════════════════ */
  const WISCH_MIN = 30;

  function haengeWischAn(el, id) {
    let x0 = 0, y0 = 0, zeiger = null;

    el.addEventListener('pointerdown', (e) => {
      zeiger = e.pointerId; x0 = e.clientX; y0 = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });

    const los = (e) => {
      if (e.pointerId !== zeiger) return;
      zeiger = null;
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) { oeffne(id); return; }        // angetippt
      if (dx < -WISCH_MIN && Math.abs(dx) > Math.abs(dy)) { oeffne(id); return; } // nach links
      if (dx > WISCH_MIN && String(_offen) === String(id)) schliesse();           // nach rechts
    };

    el.addEventListener('pointerup', los);
    el.addEventListener('pointercancel', () => { zeiger = null; });
  }

  /* Nach rechts auf der offenen Datei fährt sie wieder ein. Mit dem
     Finger über den Berührungs-Ereignissen, weil senkrecht darin
     gerollt wird und das dem Browser überlassen bleiben muss. */
  (function wischeZu() {
    const v = ansicht();
    if (!v) return;
    let x0 = 0, y0 = 0, aktiv = false;

    v.addEventListener('touchstart', (e) => {
      aktiv = e.touches.length === 1 && ansichtOffen();
      if (!aktiv) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, { passive: true });

    v.addEventListener('touchend', (e) => {
      if (!aktiv) return;
      aktiv = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (dx > WISCH_MIN && Math.abs(dx) > Math.abs(dy)) schliesse();
    }, { passive: true });

    /* Mit der Maus dasselbe an der Kopfzeile. Auf dem Inhalt wäre es im
       Weg: dort markiert man Text und schiebt die Seite. */
    const kopf = v.querySelector('.griff-view-head');
    if (kopf) {
      let mx = 0, zeiger = null;
      kopf.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.target.closest('button')) return;
        zeiger = e.pointerId; mx = e.clientX;
      });
      kopf.addEventListener('pointerup', (e) => {
        if (e.pointerId !== zeiger) return;
        zeiger = null;
        if (e.clientX - mx > WISCH_MIN) schliesse();
      });
    }
  })();

  /* ══════════════════════════════════════════════════════════════════
     DIE BREITE ZIEHEN

     Der Knopf sitzt in der Mitte der Grenzleiste. Gezogen wird nach
     links = breiter, weil die Ansicht rechts hängt.
     ══════════════════════════════════════════════════════════════════ */
  (function ziehen() {
    const knopfEl = E('griff-zieher');
    const v = ansicht();
    if (!knopfEl || !v) return;

    let x0 = 0, b0 = 0, zeiger = null;

    knopfEl.addEventListener('pointerdown', (e) => {
      if (!ansichtOffen()) return;
      e.preventDefault();
      zeiger = e.pointerId;
      x0 = e.clientX;
      b0 = v.querySelector('.griff-view-inner').getBoundingClientRect().width;
      v.classList.add('zieht');
      try { knopfEl.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    });

    knopfEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== zeiger) return;
      e.preventDefault();
      setzeBreite(b0 + (x0 - e.clientX), true);
    });

    const fertig = async (e) => {
      if (e.pointerId !== zeiger) return;
      zeiger = null;
      try { knopfEl.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      v.classList.remove('zieht');
      const breite = Math.round(v.querySelector('.griff-view-inner').getBoundingClientRect().width);
      nachLayout();
      zeichneSichtbareNeu();
      if (_offen && api()) {
        const d = datei(_offen);
        if (d) d.breite = breite;
        try { await api().aendern(_offen, { breite }); } catch (err) { /* egal */ }
      }
    };

    knopfEl.addEventListener('pointerup', fertig);
    knopfEl.addEventListener('pointercancel', fertig);
  })();

  /* ══════════════════════════════════════════════════════════════════
     HINEINZIEHEN

     Der Ableger fängt das Ereignis ab (stopPropagation): sonst nähme
     ui/titlebar.js dieselbe Datei zusätzlich und legte sie als Bild auf
     die Seite – genau das Kopieren, das hier nicht sein soll.
     ══════════════════════════════════════════════════════════════════ */
  (function ablegen() {
    const p = E('griff-panel');
    const feld = E('griff-ablage');
    if (!p || !feld) return;

    const hat = (e) => {
      const arten = e.dataTransfer && e.dataTransfer.types;
      return !!arten && Array.prototype.includes.call(arten, 'Files');
    };

    p.addEventListener('dragover', (e) => {
      if (!hat(e) || !leisteOffen()) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      feld.classList.add('drueber');
    });

    p.addEventListener('dragleave', (e) => {
      if (e.target === p || !p.contains(e.relatedTarget)) feld.classList.remove('drueber');
    });

    p.addEventListener('drop', async (e) => {
      if (!hat(e) || !leisteOffen()) return;
      e.preventDefault();
      e.stopPropagation();
      feld.classList.remove('drueber');
      if (!api()) return;

      const pfade = [];
      for (const f of Array.from(e.dataTransfer.files || [])) {
        const p2 = api().pfadVon(f);
        if (p2) pfade.push(p2);
      }
      if (!pfade.length) return;

      /* Nur die erste: nach jeder wird nach dem Namen gefragt, und drei
         Fenster hintereinander für einen Zug wären eine Zumutung. */
      const angebote = await api().abgelegt(pfade.slice(0, 1));
      if (angebote && angebote.length) await frageUndUebernimm(angebote[0]);
      else toast(txt('griffKeineAnzeige', 'Diese Datei lässt sich hier nicht anzeigen.'), true);
    });
  })();

  /* ══════════════════════════════════════════════════════════════════
     ANSCHLÜSSE
     ══════════════════════════════════════════════════════════════════ */
  E('btn-griff')?.addEventListener('click', () => setzeLeiste(!leisteOffen()));
  E('griff-panel-close')?.addEventListener('click', () => setzeLeiste(false));
  E('griff-view-close')?.addEventListener('click', () => schliesse());
  E('griff-waehlen')?.addEventListener('click', () => waehleAus());

  E('griff-verstecken')?.addEventListener('click', async () => {
    if (!api()) return;
    _stand = await api().verstecken(!_stand.versteckt);
    if (_stand.versteckt) schliesse();
    zeichne();
    nachLayout();
  });

  E('griff-view-body')?.addEventListener('scroll', () => {
    clearTimeout(_rollTimer);
    _rollTimer = setTimeout(merkeStelle, 400);
  }, { passive: true });

  /* Escape macht zu – aber nur, wenn nicht ohnehin ein Fenster darüber
     steht. Sonst hätte ein Abbrechen im Namensfeld zwei Wirkungen. */
  const fensterOffen = () => [...document.querySelectorAll('.overlay')]
    .some(o => o.style.display && o.style.display !== 'none');

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || fensterOffen()) return;
    if (leisteOffen()) { setzeLeiste(false); return; }
    if (ansichtOffen()) schliesse();
  });

  /* Das Fenster wird schmaler: die halbe Breite ist eine andere geworden,
     und die Seiten müssen in der neuen Breite noch einmal entstehen. */
  window.addEventListener('resize', () => {
    if (!ansichtOffen()) return;
    const inner = ansicht().querySelector('.griff-view-inner');
    setzeBreite(inner.getBoundingClientRect().width);
    clearTimeout(_breiteTimer);
    _breiteTimer = setTimeout(zeichneSichtbareNeu, 250);
  }, { passive: true });

  /* Vor dem Beenden nachholen, was der Verzögerer noch nicht geschrieben
     hat – sonst steht man beim nächsten Start wieder auf Seite 1. */
  window.addEventListener('beforeunload', () => { clearTimeout(_rollTimer); merkeStelle(); });

  /** Beim Start: die gemerkten Unterlagen wieder an die Kante holen. */
  async function starte() {
    if (!api()) return;
    try {
      _stand = await api().liste();
    } catch (err) {
      console.warn('[Griffbereit] Liste nicht lesbar:', err?.message || err);
      return;
    }
    zeichne();
  }

  window.addEventListener('language-changed', zeichne);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', starte);
  } else {
    starte();
  }

  window.Griffbereit = { neuLaden: starte, schliessen: schliesse };
})();
