// Stamps the saved theme before the first paint: without it the page renders light, then
// flips, and a dark-mode viewer sees a white flash on every load. A file rather than an
// inline script, so the Content-Security-Policy can stay `script-src 'self'`.
(function () {
  try {
    var choice = window.localStorage.getItem('dashboard-theme');
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch (error) {
    /* Storage is blocked; the media query still resolves the theme. */
  }
})();
