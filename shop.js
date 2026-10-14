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
  const vanaf = (p.varianten || []).length > 1 ? 'vanaf ' : '';
  return `
  <article class="prod">
    <a class="prod-foto ph" href="${url}">${foto}</a>
    <div class="winkel">${esc(p.winkel)}</div>
    <div class="naam"><a href="${url}">${esc(p.naam)}</a></div>
    <div class="onder"><span class="prijs">${vanaf ? '<small style="font-weight:600;font-size:14px">vanaf </small>' : ''}${euro(p.prijs)}</span>
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
const ICOON = {
  huis: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#F2B630" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10l9-6 9 6"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></svg>',
  zoek: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  mandje: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.4 11h11l2-8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>'
};

function bouwHeader() {
  const plek = document.getElementById('kop');
  if (!plek) return;
  plek.outerHTML = `
  <div class="topbalk"><div class="wrap">
    <span>Bezorging in Rijssen en omgeving · [BEZORGDAG / TIJD]</span>
    <span>Of haal gratis af bij de winkel</span>
  </div></div>
  <header>
    <div class="wrap header-rij">
      <a href="./" class="logo" aria-label="Kopen in Rijssen, naar de homepage">
        <span class="logo-icoon">${ICOON.huis}</span>
        <span class="logo-tekst display">kopen<span>in</span>rijssen</span>
      </a>
      <form class="zoek" role="search" action="./" method="get">
        <label for="zoek" class="sr-only">Zoeken</label>
        <input id="zoek" name="zoek" type="search" placeholder="Zoek producten of winkels in Rijssen">
        <button type="submit" aria-label="Zoeken">${ICOON.zoek}</button>
      </form>
      <nav class="account" aria-label="Winkelmandje">
        <a href="winkelmandje.html" class="mandje">${ICOON.mandje}<span>Mandje (<span data-mandje-aantal>0</span>)</span></a>
      </nav>
    </div>
    <nav class="wrap cat-nav" aria-label="Categorieën">
      ${['Eten & drinken','Mode','Wonen & cadeaus','Bloemen & planten','Boeken & hobby','Sport & vrije tijd','Klussen & tuin']
        .map(c => `<a href="./?categorie=${encodeURIComponent(c)}#producten">${esc(c)}</a>`).join('')}
    </nav>
  </header>`;
}

function bouwFooter() {
  const plek = document.getElementById('voet');
  if (!plek) return;
  plek.outerHTML = `
  <footer>
    <div class="wrap">
      <div class="grid-footer" style="border-top:none;padding-top:0">
        <div><span class="footer-logo display">kopen<span>in</span>rijssen</span><span>Het online winkelcentrum van Rijssen.</span></div>
        <div><b>Shoppen</b><a href="./#producten">Alle producten</a><a href="./#winkels">Winkels</a><a href="winkelmandje.html">Winkelmandje</a></div>
        <div><b>Klantenservice</b><a href="#">Bezorgen &amp; afhalen</a><a href="#">Retourneren</a><a href="#">Contact</a></div>
        <div><b>Ondernemers</b><a href="#">Winkel aanmelden</a><a href="#">Hoe het werkt</a></div>
      </div>
      <div class="onderregel"><span>© 2026 kopeninrijssen.nl</span><span>Privacy · Voorwaarden · Cookies</span></div>
    </div>
  </footer>`;
}

bouwHeader();
bouwFooter();
toonMandjeAantal();
window.addEventListener('storage', toonMandjeAantal);
