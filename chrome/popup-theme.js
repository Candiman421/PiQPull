// PiQPull — Theme Sync
// Single job: sync dark/light theme between popup and browse page.
// Runs immediately (IIFE) to avoid flash of wrong theme.

(function () {
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  // Saved preference wins; fall back to system
  const saved = localStorage.getItem('piqpull-theme');
  if (saved) {
    applyTheme(saved);
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    applyTheme('light');
  }

  // Sync when browse page changes theme
  window.addEventListener('storage', e => {
    if (e.key === 'piqpull-theme') applyTheme(e.newValue || 'dark');
  });

  // Expose toggle for popup button if ever needed
  window.piqPullToggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('piqpull-theme', next);
    applyTheme(next);
    return next;
  };
})();
