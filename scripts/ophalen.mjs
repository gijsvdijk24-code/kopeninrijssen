// Haalt productgegevens op voor elk product in producten.json met status "ophalen".
// Draait automatisch via GitHub Actions (.github/workflows/ophalen.yml).
import { readFile, writeFile } from 'node:fs/promises';

const BESTAND = 'producten.json';
const lijst = JSON.parse(await readFile(BESTAND, 'utf8'));
let gewijzigd = false;

for (const p of lijst) {
  if (p.status !== 'ophalen') continue;
  gewijzigd = true;
  try {
    const info = await haal(p.link);
    for (const [k, v] of Object.entries(info)) {
      if (v !== undefined && v !== null && v !== '' && (p[k] === undefined || p[k] === null || p[k] === '')) p[k] = v;
    }
    if (!p.naam) throw new Error('Geen productnaam gevonden op de pagina');
    p.status = 'klaar';
    delete p.fout;
    console.log('Klaar:', p.naam);
  } catch (e) {
    p.status = 'fout';
    p.fout = String(e.message || e).slice(0, 200);
    console.log('Fout bij', p.link, '-', p.fout);
  }
}

if (gewijzigd) await writeFile(BESTAND, JSON.stringify(lijst, null, 2) + '\n');

// ---------- hulpfuncties ----------

async function haal(url) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('Ongeldige link');
  const r = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.6'
    }
  });
  if (!r.ok) throw new Error(`De winkelpagina gaf fout ${r.status}`);
  const html = (await r.text()).slice(0, 3_000_000);
  const basis = r.url || url;

  const product = zoekProduct(html);
  const m = metaTags(html);
  const titel = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');

  const siteNaam = m['og:site_name'] || verkoper(product) || hostNaam(basis);

  let naam = schoon(product?.name || m['og:title'] || m['twitter:title'] || titel);
  naam = zonderWinkelnaam(naam, siteNaam);

  const omschrijving = kort(schoon(product?.description || m['og:description'] || m['description'] || m['twitter:description']), 220);

  const prijs = getal(prijsUitProduct(product) ?? m['product:price:amount'] ?? m['og:price:amount'] ?? m['price']);

  let afbeelding = afbeeldingUitProduct(product) || m['og:image'] || m['og:image:url'] || m['twitter:image'] || m['image'];
  if (afbeelding) { try { afbeelding = new URL(afbeelding, basis).href; } catch { afbeelding = ''; } }

  return {
    naam,
    omschrijving,
    prijs,
    afbeelding,
    winkel: schoon(siteNaam),
    categorie: raadCategorie(`${naam} ${omschrijving}`)
  };
}

function zoekProduct(html) {
  const blokken = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const knopen = [];
  const verzamel = x => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) return x.forEach(verzamel);
    knopen.push(x);
    if (x['@graph']) verzamel(x['@graph']);
    if (x.mainEntity) verzamel(x.mainEntity);
    if (x.hasVariant) verzamel(x.hasVariant);
  };
  for (const b of blokken) {
    try { verzamel(JSON.parse(b[1].trim())); } catch { /* ongeldige JSON overslaan */ }
  }
  const isType = (k, t) => [].concat(k['@type'] || []).some(x => String(x).toLowerCase() === t);
  return knopen.find(k => isType(k, 'product')) || knopen.find(k => isType(k, 'productgroup')) || null;
}

function prijsUitProduct(p) {
  if (!p) return undefined;
  const aanbiedingen = [].concat(p.offers || []);
  for (const o of aanbiedingen) {
    const v = o?.price ?? o?.lowPrice ?? o?.priceSpecification?.price ?? [].concat(o?.priceSpecification || [])[0]?.price;
    if (v !== undefined && v !== null && v !== '') return v;
    if (o?.offers) { const sub = prijsUitProduct({ offers: o.offers }); if (sub !== undefined) return sub; }
  }
  if (p.hasVariant) for (const v of [].concat(p.hasVariant)) { const x = prijsUitProduct(v); if (x !== undefined) return x; }
  return undefined;
}

function afbeeldingUitProduct(p) {
  if (!p?.image) return '';
  const eerste = [].concat(p.image)[0];
  if (typeof eerste === 'string') return eerste;
  return eerste?.url || eerste?.contentUrl || '';
}

function verkoper(p) {
  if (!p) return '';
  const o = [].concat(p.offers || [])[0];
  return o?.seller?.name || '';
}

function metaTags(html) {
  const uit = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attr = {};
    for (const a of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attr[a[1].toLowerCase()] = a[3] ?? a[4];
    const sleutel = (attr.property || attr.name || attr.itemprop || '').toLowerCase();
    const waarde = attr.content;
    if (sleutel && waarde && !(sleutel in uit)) uit[sleutel] = decode(waarde);
  }
  return uit;
}

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&euro;/g, '€').replace(/&amp;/g, '&');
}

function schoon(s) {
  return decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function kort(s, max) {
  if (s.length <= max) return s;
  const knip = s.slice(0, max);
  return knip.slice(0, knip.lastIndexOf(' ') > 80 ? knip.lastIndexOf(' ') : max).replace(/[,.;:\s]+$/, '') + '…';
}

function zonderWinkelnaam(naam, site) {
  if (!site) return naam;
  const delen = naam.split(/\s+[|–—-]\s+/);
  if (delen.length > 1 && delen[delen.length - 1].toLowerCase().includes(site.toLowerCase().split(' ')[0])) delen.pop();
  return delen.join(' - ').trim();
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

function raadCategorie(tekst) {
  const t = tekst.toLowerCase();
  const regels = [
    ['Eten & drinken', /brood|wegge|krent|koek|taart|kaas|worst|vlees|wijn|bier|koffie|thee|chocola|snoep|gebak|banket|delicates|honing|jam|saus/],
    ['Bloemen & planten', /bloem|boeket|plant|tulp|roos|orchidee|tuin|pot\b/],
    ['Mode', /jas|jurk|broek|shirt|trui|blouse|schoen|sneaker|sok|tas\b|riem|sjaal|kleding|mode|horloge|sieraad|ketting|ring\b/],
    ['Boeken & hobby', /boek|roman|puzzel|spel\b|spellen|knutsel|wol|garen|hobby|tekenen|verf\b/],
    ['Sport & vrije tijd', /fiets|sport|voetbal|hardloop|fitness|kamperen|wandel|zwem|tennis|bal\b/],
    ['Wonen & cadeaus', /kaars|vaas|kussen|plaid|lamp|servies|mok|decoratie|cadeau|interieur|woon|geur/]
  ];
  for (const [cat, re] of regels) if (re.test(t)) return cat;
  return '';
}
