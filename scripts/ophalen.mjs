// Haalt productgegevens op voor elk product in producten.json met status "ophalen".
// Draait automatisch via GitHub Actions (.github/workflows/ophalen.yml).
// Velden: naam, omschrijving (volledig), prijs, afbeelding, afbeeldingen[], winkel,
// categorie, specificaties[{naam,waarde}], varianten[{naam,prijs}].
import { readFile, writeFile } from 'node:fs/promises';

const BESTAND = 'producten.json';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.6'
};

const lijst = JSON.parse(await readFile(BESTAND, 'utf8'));
let gewijzigd = false;

const leeg = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

for (const p of lijst) {
  if (p.status !== 'ophalen') continue;
  gewijzigd = true;
  try {
    const info = await haal(p.link);
    for (const [k, v] of Object.entries(info)) {
      if (p.overschrijf) { if (leeg(v)) delete p[k]; else p[k] = v; }
      else if (!leeg(v) && leeg(p[k])) p[k] = v;
    }
    if (!p.naam) throw new Error('Geen productnaam gevonden op de pagina');
    p.status = 'klaar';
    delete p.fout;
    delete p.overschrijf;
    console.log('Klaar:', p.naam);
  } catch (e) {
    p.status = 'fout';
    p.fout = String(e.message || e).slice(0, 200);
    delete p.overschrijf;
    console.log('Fout bij', p.link, '-', p.fout);
  }
}

if (gewijzigd) await writeFile(BESTAND, JSON.stringify(lijst, null, 2) + '\n');

// ---------- ophalen ----------

async function haal(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('Ongeldige link');
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml' } });
  if (!r.ok) throw new Error(`De winkelpagina gaf fout ${r.status}`);
  const html = (await r.text()).slice(0, 4_000_000);
  const basis = r.url || url;

  const product = zoekProduct(html);
  const m = metaTags(html);
  const titel = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const absoluut = u => { try { return new URL(u, basis).href; } catch { return ''; } };

  const siteNaam = m['og:site_name']?.[0] || verkoper(product) || winkelUitTitel(titel, basis) || hostNaam(basis);

  // Shopify-winkels geven via /products/<naam>.json alle details (volledige tekst, alle foto's, maten)
  const shopify = await haalShopify(basis);

  let naam = schoon(shopify?.title || product?.name || m['og:title']?.[0] || m['twitter:title']?.[0] || titel);
  naam = netteNaam(zonderWinkelnaam(naam, siteNaam), siteNaam);

  // Omschrijving: liefst de echte producttekst, niet de korte SEO-zin uit de meta-tags
  const blokHtml = omschrijvingBlok(html);
  const kandidaten = [shopify?.body_html, product?.description, blokHtml, m['og:description']?.[0], m['description']?.[0]]
    .filter(Boolean).map(h => ({ html: h, tekst: naarTekst(h) })).filter(k => k.tekst.length > 0);
  const goed = kandidaten.filter(k => !isSeoZin(k.tekst, naam));
  const gekozen = goed.find(k => k.tekst.length >= 150) || goed.sort((a, b) => b.tekst.length - a.tekst.length)[0] || null;
  const omschrijvingHtml = gekozen?.html || '';
  let omschrijving = gekozen?.tekst || '';
  if (omschrijving.length > 5000) { const knip = omschrijving.slice(0, 5000); omschrijving = knip.slice(0, Math.max(knip.lastIndexOf('\n'), 3000)).trim(); }

  // Foto's
  const fotos = [];
  const voegToe = u => { const a = absoluut(u); if (a && !fotos.includes(a)) fotos.push(a); };
  (shopify?.images || []).forEach(i => voegToe(i.src));
  afbeeldingenUitProduct(product).forEach(voegToe);
  (m['og:image'] || []).forEach(voegToe);
  (m['og:image:url'] || []).forEach(voegToe);
  (m['twitter:image'] || []).forEach(voegToe);
  galerijFotos(html, fotos[0], absoluut).forEach(voegToe);

  // Varianten (bijv. maten of kleuren met eigen prijs)
  let varianten = [];
  if (shopify?.variants?.length > 1) {
    varianten = shopify.variants
      .filter(v => v.available !== false)
      .map(v => ({ naam: schoon(v.title), prijs: getal(v.price) }))
      .filter(v => v.naam && v.naam.toLowerCase() !== 'default title');
  } else {
    varianten = variantenUitProduct(product);
  }
  varianten = netteVarianten(varianten);

  const prijzen = varianten.map(v => v.prijs).filter(x => x != null);
  const prijs = getal(shopify?.variants?.[0]?.price)
    ?? (prijzen.length ? Math.min(...prijzen) : null)
    ?? getal(prijsUitProduct(product) ?? m['product:price:amount']?.[0] ?? m['og:price:amount']?.[0] ?? m['price']?.[0]);

  // Specificaties
  const specs = new Map();
  const zet = (k, v) => {
    k = schoon(k).replace(/:$/, ''); v = schoon(v).replace(/\s+\|\s+/g, ', ');
    if (!k || !v || k.length > 40 || v.length > 200) return;
    if (/bestelcode|leverancier|artikelnummer|artikelcode|\bsku\b|productcode|^model$|hoofdcategorie|^ean$|gtin/i.test(k)) return;
    const sleutel = k.toLowerCase();
    if (![...specs.keys()].some(x => x.toLowerCase() === sleutel)) specs.set(k, v);
  };
  if (product) {
    for (const ap of [].concat(product.additionalProperty || [])) zet(ap?.name, ap?.value);
    const merk = typeof product.brand === 'string' ? product.brand : product.brand?.name;
    if (merk && merk.toLowerCase() !== siteNaam.toLowerCase()) zet('Merk', merk);
    zet('Kleur', product.color);
    zet('Materiaal', typeof product.material === 'string' ? product.material : '');
    zet('Maat', product.size);
    if (product.weight) zet('Gewicht', typeof product.weight === 'object' ? `${product.weight.value ?? ''} ${product.weight.unitText || product.weight.unitCode || ''}` : product.weight);
    for (const [k, label] of [['width', 'Breedte'], ['height', 'Hoogte'], ['depth', 'Diepte']]) {
      const w = product[k]; if (w) zet(label, typeof w === 'object' ? `${w.value ?? ''} ${w.unitText || w.unitCode || ''}` : w);
    }
    zet('EAN', product.gtin13 || product.gtin || '');
  }
  for (const opt of shopify?.options || []) {
    if (opt.values?.length > 1 && opt.name?.toLowerCase() !== 'title') zet(opt.name, opt.values.join(', '));
  }
  specsUitHtml(omschrijvingHtml).forEach(([k, v]) => zet(k, v));
  specsUitPagina(html).forEach(([k, v]) => zet(k, v));
  // De "maat" van de getoonde pagina is geen vaste eigenschap als er meerdere maten zijn
  if (varianten.length) for (const k of [...specs.keys()]) if (/^(maat|size)$/i.test(k)) specs.delete(k);
  const specificaties = [...specs].slice(0, 30).map(([naam, waarde]) => ({ naam, waarde }));

  return {
    naam,
    omschrijving,
    prijs,
    afbeelding: fotos[0] || '',
    afbeeldingen: fotos.slice(0, 12),
    winkel: schoon(siteNaam),
    categorie: raadCategorie(`${naam} ${shopify?.product_type || ''} ${specificaties.map(x => x.waarde).join(' ')} ${omschrijving.slice(0, 600)}`, basis),
    specificaties,
    varianten
  };
}

async function haalShopify(url) {
  try {
    const u = new URL(url);
    if (!/\/products\/[^/]+/.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\/$/, '') + '.json';
    u.search = '';
    const r = await fetch(u.href, { signal: AbortSignal.timeout(15000), headers: { ...HEADERS, Accept: 'application/json' } });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.product?.title ? data.product : null;
  } catch { return null; }
}

// ---------- uitlezen ----------

function zoekProduct(html) {
  const blokken = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const knopen = [];
  const verzamel = x => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(verzamel);
    knopen.push(x);
    if (x['@graph']) verzamel(x['@graph']);
    if (x.mainEntity) verzamel(x.mainEntity);
  };
  for (const b of blokken) { try { verzamel(JSON.parse(b[1].trim())); } catch { /* overslaan */ } }
  const isType = (k, t) => [].concat(k['@type'] || []).some(x => String(x).toLowerCase() === t);
  return knopen.find(k => isType(k, 'product')) || knopen.find(k => isType(k, 'productgroup')) || null;
}

function prijsUitProduct(p) {
  if (!p) return undefined;
  for (const o of [].concat(p.offers || [])) {
    const v = o?.price ?? o?.lowPrice ?? [].concat(o?.priceSpecification || [])[0]?.price;
    if (v !== undefined && v !== null && v !== '') return v;
    if (o?.offers) { const sub = prijsUitProduct({ offers: o.offers }); if (sub !== undefined) return sub; }
  }
  for (const v of [].concat(p.hasVariant || [])) { const x = prijsUitProduct(v); if (x !== undefined) return x; }
  return undefined;
}

function variantenUitProduct(p) {
  if (!p) return [];
  const uit = [];
  for (const v of [].concat(p.hasVariant || [])) {
    const naam = schoon(v?.name || '').replace(schoon(p.name || ''), '').replace(/^[\s\-–|,]+/, '');
    if (naam) uit.push({ naam, prijs: getal(prijsUitProduct(v)) });
  }
  if (!uit.length) {
    const offers = [].concat(p.offers || []);
    if (offers.length > 1) for (const o of offers) if (o?.name) uit.push({ naam: schoon(o.name), prijs: getal(o.price) });
  }
  return uit.slice(0, 40);
}

function afbeeldingenUitProduct(p) {
  if (!p?.image) return [];
  return [].concat(p.image).map(i => typeof i === 'string' ? i : (i?.url || i?.contentUrl || '')).filter(Boolean);
}

function verkoper(p) {
  return [].concat(p?.offers || [])[0]?.seller?.name || '';
}

function metaTags(html) {
  const uit = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = {};
    for (const a of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attr[a[1].toLowerCase()] = a[3] ?? a[4];
    const sleutel = (attr.property || attr.name || attr.itemprop || '').toLowerCase();
    if (sleutel && attr.content) (uit[sleutel] ||= []).push(decode(attr.content));
  }
  return uit;
}

// Specificaties uit tabellen, definitielijsten en regels als "Afmeting: 60 x 60 cm"
function specsUitHtml(fragment) {
  const uit = [];
  if (!fragment) return uit;
  for (const rij of fragment.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cellen = [...rij.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => schoon(c[1]));
    if (cellen.length === 2) uit.push(cellen);
  }
  const dts = [...fragment.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)];
  for (const d of dts) uit.push([d[1], d[2]]);
  for (const regel of naarTekst(fragment).split('\n')) {
    const m = regel.replace(/^[•\-*]\s*/, '').match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ()/.-]{1,30}):\s+(.{1,150})$/);
    if (m && m[1].trim().split(/\s+/).length <= 4) uit.push([m[1], m[2]]);
  }
  return uit;
}

function specsUitPagina(html) {
  const uit = [];
  const re = /(specificat|kenmerken|eigenschappen|productinformatie|details)[\s\S]{0,600}?(<table[\s\S]*?<\/table>|<dl[\s\S]*?<\/dl>)/gi;
  let m, n = 0;
  while ((m = re.exec(html)) && n++ < 3) uit.push(...specsUitHtml(m[2]));
  return uit.slice(0, 40);
}

// ---------- tekst ----------

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&euro;/g, '€').replace(/&amp;/g, '&');
}

function schoon(s) {
  return decode(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// HTML naar leesbare tekst met alinea's en opsommingstekens
function naarTekst(html) {
  const t = String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(t)
    .split('\n').map(r => r.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/\n+•/g, '\n•').trim();
}

function zonderWinkelnaam(naam, site) {
  if (!site) return naam;
  const delen = naam.split(/\s+[|–—]\s+/);
  if (delen.length > 1 && delen[delen.length - 1].toLowerCase().includes(site.toLowerCase().split(' ')[0])) delen.pop();
  return delen.join(' – ').trim();
}

function getal(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (s.includes('.') && s.includes(',')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function hostNaam(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch { return ''; }
}

function raadCategorie(tekst, url = '') {
  const t = ' ' + tekst.toLowerCase() + ' ';
  const regels = [
    ['Terras & buiten', /\b(vuurschaal|vuurkorf|vuurtafel|terrasverwarm|terrasheater|heater|bbq|barbecue|kamado|grill|pizza-?oven|parasol|tuinhaard|loungeset|buitenkeuken)/],
    ['Klussen', /\b(boormachine|accuboor|schroefmachine|zaag|cirkelzaag|decoupeer|schuurmachine|slijper|gereedschap|bit-?set|ladder|werkbank|verf|kit\b|tegel|tegels|vloertegel|laminaat)/],
    ['Tuin', /\b(grasmaaier|maaier|robotmaaier|trimmer|heggenschaar|bladblazer|snoei|kettingzaag|hogedrukreiniger|tuinslang|tuinset|tuinstoel|tuintafel|tuinbank|plantenbak|kas\b|compost|zaad|bestrating)/],
    ['Verlichting', /\b(lamp|lampen|verlichting|led|lichtsnoer|lantaarn|wandlamp|hanglamp|vloerlamp|spot|grondspot|solar)/],
    ['Keuken', /\b(pan|pannen|mes|messen|airfryer|blender|koffie|espresso|servies|bord|glazen|bestek|snijplank|keuken|oven)/],
    ['Wonen', /\b(plaid|kussen|vloerkleed|gordijn|vaas|kaars|decoratie|opberg|mand\b|spiegel|bijzettafel|stoel|bank\b|bed|dekbed|handdoek|interieur)/]
  ];
  for (const [cat, re] of regels) if (re.test(t)) return cat;
  let host = ''; try { host = new URL(url).hostname; } catch {}
  if (/tuin|garden/.test(host)) return 'Tuin';
  if (/klus|bouw|gereedschap|tool/.test(host)) return 'Klussen';
  if (/lamp|licht|light/.test(host)) return 'Verlichting';
  return '';
}

// ---------- opschonen ----------

// Winkelnaam uit de paginatitel, bijv. "... | Hans voortman" -> "Hans Voortman"
function winkelUitTitel(titel, url) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch { return ''; } })();
  const delen = String(titel).split(/\s+[|–—-]\s+/);
  for (const d of delen.slice(1).reverse()) {
    const kaal = d.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (kaal && host && (host.includes(kaal) || kaal.includes(host))) return hoofdletters(d.trim());
  }
  return '';
}

function hoofdletters(s) {
  return s.split(' ').map(w => w.length > 2 || /^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ');
}

// Haalt "kopen", winkelnaam en schreeuwende hoofdletters uit een productnaam
function netteNaam(naam, site) {
  const kaal = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  let n = naam.split(/\s+[|–—]\s+/).filter(d => !site || kaal(d) !== kaal(site)).join(' – ');
  n = n.replace(/\s+(online\s+)?(kopen|bestellen)(\s+bij\s+.+)?$/i, '').replace(/^(koop|bestel)\s+/i, '').trim();
  if (n.length > 3 && n === n.toUpperCase() && /[A-Z]/.test(n)) {
    n = n.toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, (_, a, b) => a + b.toUpperCase());
  }
  return n;
}

// Herkent SEO-zinnetjes als "... gemakkelijk en veilig online kopen bij X"
function isSeoZin(tekst, naam) {
  const t = tekst.toLowerCase();
  if (tekst.length < 200 && /(online|veilig|snel|voordelig)?\s*(kopen|bestellen|bestel)\s+(bij|op|via)\b/.test(t)) return true;
  if (tekst.length < 60) {
    const kaal = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (kaal(naam) && kaal(tekst).startsWith(kaal(naam).slice(0, 12))) return true; // alleen de productcode/naam herhaald
  }
  return false;
}

// Zoekt een blok als <div class="product-description"> en geeft de inhoud
function omschrijvingBlok(html) {
  const re = /<(div|section|article)\b[^>]*(?:class|id)=["'][^"']*(product[-_]?description|productdescription|product[-_]?omschrijving|omschrijving|beschrijving|description[-_]?content|tab[-_]?description)[^"']*["'][^>]*>/gi;
  let m, beste = '';
  while ((m = re.exec(html))) {
    const inhoud = binnenTag(html, m.index, m[1]);
    if (inhoud && naarTekst(inhoud).length > naarTekst(beste).length) beste = inhoud;
  }
  return naarTekst(beste).length >= 40 ? beste : '';
}

// Geeft de inhoud van een element vanaf positie start, rekening houdend met geneste tags
function binnenTag(html, start, tag) {
  const open = new RegExp(`<${tag}\\b`, 'gi'), dicht = new RegExp(`</${tag}>`, 'gi');
  const begin = html.indexOf('>', start) + 1;
  let diepte = 1, pos = begin;
  while (diepte > 0 && pos < html.length && pos - begin < 60000) {
    open.lastIndex = pos; dicht.lastIndex = pos;
    const o = open.exec(html), d = dicht.exec(html);
    if (!d) return '';
    if (o && o.index < d.index) { diepte++; pos = o.index + 1; }
    else { diepte--; pos = d.index + d[0].length; if (diepte === 0) return html.slice(begin, d.index); }
  }
  return '';
}

// Zoekt andere foto's van hetzelfde product, bijv. 140004221_1.jpg -> 140004221_2.jpg
function galerijFotos(html, hoofd, absoluut) {
  if (!hoofd) return [];
  let pad;
  try { pad = new URL(hoofd).pathname; } catch { return []; }
  const bestand = pad.split('/').pop().replace(/\.[a-z]+$/i, '');
  const stam = bestand.replace(/[-_](\d{1,2}|front|back|detail|main|large|zoom)$/i, '');
  if (stam.length < 5) return [];
  const uit = [];
  const re = /(?:src|data-src|data-zoom-image|data-large|href|srcset)=["']([^"'\s]+\.(?:jpe?g|png|webp)[^"'\s]*)/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = absoluut(m[1]);
    if (!u) continue;
    const naam = (() => { try { return new URL(u).pathname.split('/').pop(); } catch { return ''; } })();
    if (naam.startsWith(stam) && !/thumb|small|mini|_xs|icon/i.test(u)) uit.push(u);
  }
  return [...new Set(uit)].slice(0, 12);
}

// Houdt alleen echte maten/uitvoeringen over en zet ze in een logische volgorde
function netteVarianten(lijst) {
  const gezien = new Set();
  const uit = [];
  for (const v of lijst || []) {
    let naam = schoon(v.naam).replace(/^maat\s+/i, '');
    if (!naam || naam.length > 25 || /kopen|bestellen|\|/i.test(naam)) continue;
    const sleutel = naam.toLowerCase();
    if (gezien.has(sleutel)) continue;
    gezien.add(sleutel);
    uit.push({ naam, prijs: v.prijs });
  }
  const volgorde = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '3xl', 'xxxl', '4xl', '5xl'];
  const rang = n => {
    const k = n.toLowerCase();
    const i = volgorde.indexOf(k);
    if (i >= 0) return i;
    const getal = parseFloat(k);
    return isNaN(getal) ? 1000 : 100 + getal;
  };
  if (uit.every(v => rang(v.naam) < 1000)) uit.sort((a, b) => rang(a.naam) - rang(b.naam));
  return uit.length > 1 ? uit : [];
}
