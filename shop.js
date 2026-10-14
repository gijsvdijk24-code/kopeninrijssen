// ===== Instellingen =====
const WINKEL_CONFIG = {
  // Formspree-adres voor bestellingen, bijv. 'https://formspree.io/f/abcdwxyz' (gratis aan te maken op formspree.io)
  bestelFormulier: '',
  // Reserve: e-mailadres waar bestellingen naartoe gaan als er (nog) geen Formspree-adres is
  bestelEmail: '',
  // Bezorgkosten in euro's. null = "volgt in de bevestiging"
  bezorgkosten: null
};

// ===== Hulpfuncties =====
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const euro = n => (n === '' || n == null || isNaN(n)) ? '' : '€ ' + Number(n).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isUrl = u => /^https?:\/\//i.test(u || '');

let _producten = null;
async function laadProducten() {
  if (_producten) return _producten;
  try {
    const r = await fetch('producten.json?v=' + Date.now(), { cache: 'no-store' });
    const data = r.ok ? await r.json() : [];
    _producten = (Array.isArray(data) ? data : []).filter(p => p.zichtbaar !== false && p.naam && p.status !== 'ophalen' && p.status !== 'fout');
  } catch (e) { _producten = []; }
  return _producten;
}

// ===== Winkelmandje (bewaard in de browser) =====
const Mandje = {
  sleutel: 'kir_mandje',
  lees() { try { const m = JSON.parse(localStorage.getItem(this.sleutel) || '[]'); return Array.isArray(m) ? m : []; } catch (e) { return this._geheugen || []; } },
  bewaar(m) { this._geheugen = m; try { localStorage.setItem(this.sleutel, JSON.stringify(m)); } catch (e) {} toonMandjeAantal(); },
  voegToe(id, variant, aantal = 1) {
    const m = this.lees();
    const r = m.find(x => x.id === id && (x.variant || '') === (variant || ''));
    if (r) r.aantal = Math.min(99, r.aantal + aantal); else m.push({ id, variant: variant || '', aantal });
    this.bewaar(m);
  },
  zet(index, aantal) { const m = this.lees(); if (!m[index]) return; if (aantal <= 0) m.splice(index, 1); else m[index].aantal = Math.min(99, aantal); this.bewaar(m); },
  leeg() { this.bewaar([]); },
  aantal() { return this.lees().reduce((s, r) => s + r.aantal, 0); }
};

// Producten die per verpakking verkocht worden (bijv. tegels per doos van 1,44 m²)
const getalNL = n => Number(n).toLocaleString('nl-NL', { maximumFractionDigits: 2 });
function meervoud(w, n) {
  if (n === 1 || !w) return w;
  const vast = { doos: 'dozen', pak: 'pakken', rol: 'rollen', zak: 'zakken', set: 'sets', emmer: 'emmers', pallet: 'pallets', verpakking: 'verpakkingen', bus: 'bussen', fles: 'flessen', blik: 'blikken' };
  return vast[w.toLowerCase()] || w + 's';
}
function heeftEenheid(p) { return p && p.eenheidsprijs != null && p.eenheid; }
function verpakkingTekst(p) {
  if (!heeftEenheid(p)) return 'stuk';
  return `${p.verpakking || 'verpakking'}${p.inhoud ? ` (${getalNL(p.inhoud)} ${p.eenheid})` : ''}`;
}

function prijsVan(p, variant) {
  const v = (p.varianten || []).find(x => x.naam === variant);
  return v && v.prijs != null ? v.prijs : p.prijs;
}

function toonMandjeAantal() {
  document.querySelectorAll('[data-mandje-aantal]').forEach(el => { el.textContent = Mandje.aantal(); });
}

let _toastTimer;
function toast(html) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = html; t.classList.add('zichtbaar');
  clearTimeout(_toastTimer); _toastTimer = setTimeout(() => t.classList.remove('zichtbaar'), 3500);
}

function inMandje(id, variant, aantal = 1, naam = '') {
  Mandje.voegToe(id, variant, aantal);
  toast(`<span>${esc(naam || 'Product')} zit in je mandje</span><a href="winkelmandje.html">Bekijk mandje</a>`);
}

// ===== Productkaart (homepage) =====
function productKaart(p) {
  const url = 'product.html?id=' + encodeURIComponent(p.id);
  const foto = isUrl(p.afbeelding)
    ? `<img src="${esc(p.afbeelding)}" alt="${esc(p.naam)}" loading="lazy">`
    : '<span class="ph" style="width:100%;height:100%">[FOTO PRODUCT]</span>';
  const vanaf = new Set((p.varianten || []).map(v => v.prijs).filter(x => x != null)).size > 1 ? 'vanaf ' : '';
  const eenheid = heeftEenheid(p);
  return `
  <article class="prod">
    <a class="prod-foto ph" href="${url}">${foto}</a>
    <div class="winkel">${esc(merkVan(p))}</div>
    <div class="naam"><a href="${url}">${esc(p.naam)}</a></div>
    <div class="onder"><span class="prijs">${eenheid
        ? `${euro(p.eenheidsprijs)}<small class="per"> per ${esc(p.eenheid)}</small><small class="verpakking">${euro(p.prijs)} per ${esc(verpakkingTekst(p))}</small>`
        : `${vanaf ? '<small style="font-weight:600;font-size:14px">vanaf </small>' : ''}${euro(p.prijs)}`}</span>
      ${(p.varianten || []).length > 1
        ? `<a class="bekijk" href="${url}">Kies</a>`
        : `<button type="button" data-in-mandje="${esc(p.id)}">In mandje</button>`}
    </div>
  </article>`;
}

document.addEventListener('click', async e => {
  const knop = e.target.closest('[data-in-mandje]');
  if (!knop) return;
  const producten = await laadProducten();
  const p = producten.find(x => x.id === knop.dataset.inMandje);
  if (p) inMandje(p.id, '', 1, p.naam);
});

// ===== Header en footer (op elke pagina hetzelfde) =====
const MERK = 'XIANG';
const CATEGORIEEN = [
  { naam: 'Wierook', sub: 'Stokjes, kegels en spiralen' },
  { naam: 'Branders', sub: 'Keramiek, brons en steen' },
  { naam: 'Geurzakjes', sub: 'Voor kast, auto en kussen' },
  { naam: 'Thee', sub: 'Losse thee en gongfu-sets' },
  { naam: 'Rituelen', sub: 'Complete sets en cadeaus' }
];
const ICOON = {
  zoek: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  mandje: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>'
};
const merkVan = p => ((p.specificaties || []).find(s => /^(merk|geur|geurfamilie)$/i.test(s.naam)) || {}).waarde || p.categorie || '';
const ZEGEL = (klasse = '') => `<span class="zegel ${klasse}" aria-hidden="true">香</span>`;

function bouwHeader() {
  const plek = document.getElementById('kop');
  if (!plek) return;
  plek.outerHTML = `
  <div class="topbalk"><div class="wrap">
    <span>Gratis verzending vanaf [BEDRAG]</span>
    <span>Met de hand gemaakt</span>
    <span>Cadeauverpakking op aanvraag</span>
  </div></div>
  <header>
    <div class="wrap header-rij">
      <nav class="cat-nav" aria-label="Collectie">
        ${CATEGORIEEN.map(c => `<a href="./?categorie=${encodeURIComponent(c.naam)}#producten">${esc(c.naam)}</a>`).join('')}
      </nav>
      <a href="./" class="logo" aria-label="${MERK}, naar de homepage">${ZEGEL()}<span class="logo-tekst">${MERK}</span></a>
      <div class="header-acties">
        <form class="zoek" role="search" action="./" method="get">
          <label for="zoek" class="sr-only">Zoeken</label>
          <input id="zoek" name="zoek" type="search" placeholder="Zoeken">
          <button type="submit" aria-label="Zoeken">${ICOON.zoek}</button>
        </form>
        <a href="winkelmandje.html" class="mandje" aria-label="Winkelmandje">${ICOON.mandje}<span>Mandje</span><b data-mandje-aantal>0</b></a>
      </div>
    </div>
  </header>`;
}

function bouwFooter() {
  const plek = document.getElementById('voet');
  if (!plek) return;
  plek.outerHTML = `
  <footer>
    <div class="wrap">
      <div class="grid-footer">
        <div><div class="footer-merk">${ZEGEL()}<span class="footer-logo">${MERK}</span></div><span>Geur als ritueel. Handgemaakte wierook, branders en thee uit China.</span></div>
        <div><b>Collectie</b>${CATEGORIEEN.map(c => `<a href="./?categorie=${encodeURIComponent(c.naam)}#producten">${esc(c.naam)}</a>`).join('')}</div>
        <div><b>Service</b><a href="#">Verzending</a><a href="#">Retourneren</a><a href="#">Veilig branden</a><a href="#">Contact</a></div>
        <div><b>${MERK}</b><a href="#">Ons verhaal</a><a href="#">Voorwaarden</a><a href="#">Privacy</a></div>
      </div>
      <div class="onderregel"><span>© 2026 ${MERK}</span><span>Betalen met iDEAL</span></div>
    </div>
  </footer>`;
}

bouwHeader();
bouwFooter();
toonMandjeAantal();
window.addEventListener('storage', toonMandjeAantal);
