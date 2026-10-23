// Apply the cached theme before first paint to avoid a flash. External file
// (not inline) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem('tp-theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {
    /* storage unavailable: keep the default theme */
  }
})();
