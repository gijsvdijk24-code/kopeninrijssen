// Thuiskompas – gedeelde kop en voet
(function () {
  const LOGO = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#14213A"/><path d="M16 6l4 10h-8z" fill="#E5603A"/><path d="M12 16h8l-4 10z" fill="#FFFFFF"/><circle cx="16" cy="16" r="2" fill="#14213A"/></svg>';
  const kop = document.getElementById('kop');
  if (kop) {
    const actief = kop.dataset.actief || '';
    const link = (href, tekst, sleutel) => `<a href="${href}"${actief === sleutel ? ' class="actief" aria-current="page"' : ''}>${tekst}</a>`;
    kop.outerHTML = `
    <header>
      <div class="wrap header-rij">
        <a href="./" class="logo" aria-label="Thuiskompas, naar de homepage">${LOGO}Thuiskompas</a>
        <nav aria-label="Hoofdmenu">
          ${link('advies.html', 'Productadvies', 'advies')}
          ${link('aanmelden.html', 'Voor installateurs', 'aanmelden')}
          <a href="installateur-vinden.html" class="btn btn-accent kop-knop" style="height:44px;padding:0 18px;font-size:15px;color:#fff;white-space:nowrap;gap:0">Vind&nbsp;<span class="kort-weg">een </span>installateur</a>
        </nav>
      </div>
    </header>`;
  }
  const voet = document.getElementById('voet');
  if (voet) {
    voet.outerHTML = `<footer><div class="wrap"><span>© 2026 Thuiskompas · Slimme keuzes voor je huis</span><span><a href="advies.html" style="color:inherit">Productadvies</a> · <a href="aanmelden.html" style="color:inherit">Installateur aanmelden</a> · Privacy</span></div></footer>`;
  }
})();
