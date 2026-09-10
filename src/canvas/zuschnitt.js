'use strict';

/* ══════════════════════════════════════════════════════════════════════
   EIN BILD ZUSCHNEIDEN

   Wie in Word: der Knopf in der Leiste über dem Bild macht das ganze
   Bild sichtbar – abgedunkelt –, und darauf liegt ein helles Fenster mit
   acht Griffen. Was im Fenster steht, bleibt; der Rest fällt weg.

   >>> Der Rahmen wandert mit, das Bild bleibt gleich gross <<<
   Zieht man die rechte Kante nach innen, wird der RAHMEN schmaler. Der
   sichtbare Teil behält dabei seinen Massstab – er wird nicht auf die
   alte Breite gezogen. Genau das unterscheidet Zuschneiden vom
   Verkleinern, und genau das erwartet, wer es aus Word kennt.

   >>> Warum die Bildpunkte wirklich geschnitten werden <<<
   Ein Zuschnitt liesse sich auch nur vermerken und beim Anzeigen
   anwenden. Dann müsste ihn aber JEDER kennen, der das Bild sonst noch
   anfasst: der Word-Export, der PDF-Druck, die Freigabe, die Web-Ansicht
   und ein älterer Stand der App beim Kollegen. Einer davon wird
   vergessen, und dort steht das Bild ungeschnitten.

   Deshalb trägt obj.src das fertig geschnittene Bild – für alle
   unverändert ein Bild wie jedes andere. Das Original wandert nach
   obj.quelle, und obj.crop merkt sich die vier Anteile. Beides zusammen
   heisst: nachträglich anders schneiden geht, und weiter aufziehen bis
   zum ganzen Bild auch.

   >>> Was das kostet <<<
   Ein zugeschnittenes Bild liegt zweimal im Heft. Das ist der Preis
   dafür, dass sich der Schnitt zurücknehmen lässt – und er fällt nur bei
   Bildern an, die wirklich zugeschnitten wurden.
   ══════════════════════════════════════════════════════════════════════ */

const Zuschnitt = (() => {
  // Kleiner darf das Fenster nicht werden – sonst fasst man es nicht mehr
  const MIN = 16;
  // Die acht Griffe, wie am Objektrahmen daneben
  const GRIFFE = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];

  let _lauf = null;   // { obj, wrap, page, huelle, rechteck, ... }

  const txt = (schluessel, ersatz) =>
    (typeof t === 'function' ? (t(schluessel) || ersatz) : ersatz);

  const klemme = (wert, min, max) => Math.min(max, Math.max(min, wert));

  /** Die vier Anteile eines Objekts – fehlen sie, ist nichts geschnitten. */
  function anteile(obj) {
    const c = obj && obj.crop;
    if (!c) return { l: 0, t: 0, r: 0, b: 0 };
    return {
      l: klemme(Number(c.l) || 0, 0, 0.9),
      t: klemme(Number(c.t) || 0, 0, 0.9),
      r: klemme(Number(c.r) || 0, 0, 0.9),
      b: klemme(Number(c.b) || 0, 0, 0.9)
    };
  }

  function bildLaden(adresse) {
    return new Promise((fertig, schief) => {
      const bild = new Image();
      bild.onload = () => fertig(bild);
      bild.onerror = () => schief(new Error('Bild nicht lesbar'));
      bild.src = adresse;
    });
  }

  /**
   * Die Bildpunkte wirklich schneiden.
   *
   * Das Format richtet sich nach dem Original: was als JPEG hereinkam,
   * geht als JPEG weiter – ein Foto als PNG wäre um ein Vielfaches
   * grösser, ohne besser auszusehen. Alles andere bleibt PNG, damit
   * Strichzeichnungen und Schrift scharf bleiben.
   */
  async function schneide(quelle, c) {
    const bild = await bildLaden(quelle);
    const bw = bild.naturalWidth || bild.width;
    const bh = bild.naturalHeight || bild.height;

    const sx = Math.round(c.l * bw);
    const sy = Math.round(c.t * bh);
    const sw = Math.max(1, Math.round((1 - c.l - c.r) * bw));
    const sh = Math.max(1, Math.round((1 - c.t - c.b) * bh));

    const lein = document.createElement('canvas');
    lein.width = sw;
    lein.height = sh;
    lein.getContext('2d').drawImage(bild, sx, sy, sw, sh, 0, 0, sw, sh);

    const jpeg = /^data:image\/jpe?g/i.test(String(quelle));
    return jpeg ? lein.toDataURL('image/jpeg', 0.9) : lein.toDataURL('image/png');
  }

  /* ── Die Oberfläche ─────────────────────────────────────────────── */

  function baueHuelle(_lauf) {
    const { chrome, W, H, X, Y } = _lauf;

    const huelle = document.createElement('div');
    huelle.className = 'zuschnitt';
    huelle.style.cssText = 'left:' + X + 'px;top:' + Y + 'px;'
      + 'width:' + W + 'px;height:' + H + 'px';

    // Das ganze Bild, abgedunkelt – so sieht man, was man wegschneidet
    const voll = document.createElement('img');
    voll.className = 'zuschnitt-voll';
    voll.src = _lauf.quelle;
    voll.draggable = false;
    huelle.appendChild(voll);

    // Und darauf das helle Fenster
    const fenster = document.createElement('div');
    fenster.className = 'zuschnitt-fenster';
    const hell = document.createElement('img');
    hell.className = 'zuschnitt-hell';
    hell.src = _lauf.quelle;
    hell.draggable = false;
    hell.style.width = W + 'px';
    hell.style.height = H + 'px';
    fenster.appendChild(hell);
    huelle.appendChild(fenster);

    for (const pos of GRIFFE) {
      const g = document.createElement('div');
      g.className = 'zuschnitt-griff ' + pos;
      g.dataset.pos = pos;
      fenster.appendChild(g);
    }

    const leiste = document.createElement('div');
    leiste.className = 'zuschnitt-leiste';
    const knopf = (zeichen, name, klasse) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zuschnitt-knopf' + (klasse ? ' ' + klasse : '');
      b.textContent = zeichen;
      b.title = name;
      b.setAttribute('aria-label', name);
      leiste.appendChild(b);
      return b;
    };
    _lauf.knopfJa = knopf('✓', txt('cropApply', 'Zuschnitt übernehmen'), 'ja');
    _lauf.knopfNein = knopf('✕', txt('cropCancel', 'Abbrechen'));
    huelle.appendChild(leiste);

    chrome.appendChild(huelle);
    _lauf.huelle = huelle;
    _lauf.fenster = fenster;
    _lauf.hell = hell;
  }

  /** Das helle Fenster an seine Stelle bringen. */
  function zeichne() {
    if (!_lauf) return;
    const { fenster, hell, r } = _lauf;
    fenster.style.left = r.x + 'px';
    fenster.style.top = r.y + 'px';
    fenster.style.width = r.w + 'px';
    fenster.style.height = r.h + 'px';
    // Das helle Bild liegt fest – es verschiebt sich gegen das Fenster
    hell.style.left = (-r.x) + 'px';
    hell.style.top = (-r.y) + 'px';
  }

  function haengeGriffeAn() {
    const { huelle, W, H } = _lauf;

    huelle.addEventListener('pointerdown', (e) => {
      const griff = e.target.closest && e.target.closest('.zuschnitt-griff');
      if (!griff) return;
      e.preventDefault();
      e.stopPropagation();

      const pos = griff.dataset.pos;
      const start = { x: e.clientX, y: e.clientY, r: { ..._lauf.r } };
      /* In Bildschirmpunkten gemessen, gerechnet wird in Seitenmassen:
         zwischen beiden steht der Zoom des Hefts. Ohne diese Umrechnung
         liefe der Griff bei 150 % anderthalbmal so schnell wie die Hand. */
      const massstab = () => {
        const gemessen = huelle.getBoundingClientRect().width;
        return gemessen > 1 ? W / gemessen : 1;
      };
      const m = massstab();

      try { griff.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }

      const zieht = (ev) => {
        const dx = (ev.clientX - start.x) * m;
        const dy = (ev.clientY - start.y) * m;
        const a = start.r;
        let x = a.x, y = a.y, w = a.w, h = a.h;

        if (pos.includes('l')) { const neu = klemme(a.x + dx, 0, a.x + a.w - MIN); w = a.x + a.w - neu; x = neu; }
        if (pos.includes('r')) { w = klemme(a.w + dx, MIN, W - a.x); }
        if (pos.includes('t')) { const neu = klemme(a.y + dy, 0, a.y + a.h - MIN); h = a.y + a.h - neu; y = neu; }
        if (pos.includes('b')) { h = klemme(a.h + dy, MIN, H - a.y); }

        _lauf.r = { x, y, w, h };
        zeichne();
      };
      const los = () => {
        griff.removeEventListener('pointermove', zieht);
        griff.removeEventListener('pointerup', los);
        griff.removeEventListener('pointercancel', los);
      };
      griff.addEventListener('pointermove', zieht);
      griff.addEventListener('pointerup', los);
      griff.addEventListener('pointercancel', los);
    });

    // Ein Klick in die Hülle darf das Bild weder verschieben noch abwählen
    huelle.addEventListener('pointerdown', e => e.stopPropagation());
  }

  /* ── Anfangen und aufhören ──────────────────────────────────────── */

  /**
   * @param {object} obj      das Bildobjekt
   * @param {Element} wrap    sein .obj-wrap
   * @param {object} page     die Heftseite (für den Verlauf)
   * @param {Function} zeige  wird nach dem Übernehmen gerufen und soll
   *                          Lage, Grösse und Bild neu anzeigen
   */
  async function starte(obj, wrap, page, zeige) {
    if (_lauf) beende(false);
    if (!obj || obj.kind !== 'image' || !wrap) return;
    const chrome = wrap.querySelector('.obj-chrome');
    if (!chrome) return;

    const quelle = obj.quelle || obj.src;
    const c = anteile(obj);

    /* Aus dem sichtbaren Ausschnitt zurück auf das ganze Bild rechnen.
       Der Nenner kann nicht null werden – anteile() lässt keine Kante
       über 0,9 zu. */
    const W = obj.w / Math.max(0.05, 1 - c.l - c.r);
    const H = obj.h / Math.max(0.05, 1 - c.t - c.b);

    _lauf = {
      obj, wrap, page, chrome, quelle, zeige,
      W, H, X: -c.l * W, Y: -c.t * H,
      r: { x: c.l * W, y: c.t * H, w: obj.w, h: obj.h }
    };

    baueHuelle(_lauf);
    zeichne();
    haengeGriffeAn();

    _lauf.knopfJa.addEventListener('click', (e) => { e.stopPropagation(); beende(true); });
    _lauf.knopfNein.addEventListener('click', (e) => { e.stopPropagation(); beende(false); });

    _lauf.aufTaste = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); beende(false); }
      else if (e.key === 'Enter') { e.preventDefault(); beende(true); }
    };
    document.addEventListener('keydown', _lauf.aufTaste, true);

    wrap.classList.add('schneidet');
  }

  async function beende(uebernehmen) {
    if (!_lauf) return;
    const lauf = _lauf;
    _lauf = null;

    document.removeEventListener('keydown', lauf.aufTaste, true);
    if (lauf.huelle) lauf.huelle.remove();
    lauf.wrap.classList.remove('schneidet');

    if (!uebernehmen) return;

    const { obj, page, W, H, r, quelle, zeige } = lauf;
    const neu = {
      l: klemme(r.x / W, 0, 0.9),
      t: klemme(r.y / H, 0, 0.9),
      r: klemme(1 - (r.x + r.w) / W, 0, 0.9),
      b: klemme(1 - (r.y + r.h) / H, 0, 0.9)
    };

    // Nichts bewegt: dann auch nichts anfassen
    const alt = anteile(obj);
    const gleich = ['l', 't', 'r', 'b'].every(k => Math.abs(neu[k] - alt[k]) < 0.001);
    if (gleich) return;

    if (typeof pushPageHistory === 'function') pushPageHistory(page);

    /* Der Rahmen wandert mit: der sichtbare Teil behält seinen Massstab,
       statt auf die alte Breite gezogen zu werden. */
    obj.x = Math.round(obj.x + (r.x - alt.l * W));
    obj.y = Math.round(obj.y + (r.y - alt.t * H));
    obj.w = Math.round(r.w);
    obj.h = Math.round(r.h);

    const ganz = neu.l < 0.001 && neu.t < 0.001 && neu.r < 0.001 && neu.b < 0.001;
    try {
      if (ganz) {
        // Wieder das ganze Bild – dann braucht es auch keine zweite Fassung
        obj.src = quelle;
        delete obj.quelle;
        delete obj.crop;
      } else {
        obj.src = await schneide(quelle, neu);
        obj.quelle = quelle;
        obj.crop = neu;
      }
    } catch (err) {
      console.warn('[Zuschnitt] Schneiden fehlgeschlagen:', err && err.message);
      if (typeof toast === 'function') toast(txt('cropFailed', 'Der Zuschnitt ließ sich nicht rechnen'), true);
      return;
    }

    if (typeof zeige === 'function') zeige();
    if (window.markCurrentNotebookDirty) window.markCurrentNotebookDirty();
    if (typeof noteObjectChanged === 'function') noteObjectChanged();
  }

  return {
    starte,
    beende,
    laeuft: () => !!_lauf,
    /** Für Tests und andere Werkzeuge: die reine Rechnung ohne Oberfläche. */
    _schneide: schneide,
    _anteile: anteile
  };
})();

window.Zuschnitt = Zuschnitt;
