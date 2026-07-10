// ============================================================
// icons.js — inline SVG icon set (no external assets / emojis)
// Usage:
//   Static HTML:  <i class="ico" data-icon="strike"></i>
//                 then call Icons.hydrate(document) after load.
//   Dynamic JS:   element.innerHTML = Icons.svg('strike');
// All icons are 24×24, stroke = currentColor, so they inherit
// text colour and font-size (via width/height:1em on .ico svg).
// ============================================================

const Icons = (() => {
  // Each entry is the inner markup of a <svg viewBox="0 0 24 24">.
  const P = {
    star:      '<path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.7 1.2 6.6L12 18.6 6.1 21.8l1.2-6.6-4.8-4.7 6.6-.9z"/>',
    play:      '<path d="M6 4.5l13 7.5-13 7.5z"/>',
    stop:      '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
    strike:    '<path d="M6 6l12 12M18 6L6 18"/>',
    check:     '<path d="M4 12.5l5 5L20 6.5"/>',
    swap:      '<path d="M7 8h13M7 8l3.5-3.5M7 8l3.5 3.5M17 16H4M17 16l-3.5-3.5M17 16l-3.5 3.5"/>',
    grid:      '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>',
    arrowRight:'<path d="M4 12h15M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
    gear:      '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    gamepad:   '<path d="M7.5 8.5h9a4.5 4.5 0 014.4 5.5l-.6 2.6a2.3 2.3 0 01-4 1l-1.2-1.4a2 2 0 00-1.5-.7H9.9a2 2 0 00-1.5.7L7.2 17.6a2.3 2.3 0 01-4-1l-.6-2.6a4.5 4.5 0 014.4-5.5z"/><path d="M7.5 11.5v2.5M6.2 12.7h2.6M15.4 12h.1M17.4 13.7h.1"/>',
    phone:     '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
    copy:      '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
    search:    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
    trash:     '<path d="M4 6.5h16M9 6.5V4.5a1 1 0 011-1h4a1 1 0 011 1v2M6.5 6.5l1 13a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-13M10 10.5v6.5M14 10.5v6.5"/>',
    save:      '<path d="M5 3.5h11l3.5 3.5V19a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5z"/><path d="M8 3.5v5h6v-5M8 20.5v-6h8v6"/>',
    reload:    '<path d="M20 12a8 8 0 11-2.3-5.6M20 3.5V8h-4.5"/>',
    lock:      '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    chevUp:    '<path d="M6 15l6-6 6 6"/>',
    chevDown:  '<path d="M6 9l6 6 6-6"/>',
    warning:   '<path d="M12 3.5l9.5 16.5H2.5z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    pencil:    '<path d="M15.5 4.5l4 4M4 20l1-4.5L16 4.5a1.5 1.5 0 012 0l2 2a1.5 1.5 0 010 2L9 19.5 4 20z"/>',
    volumeOn:  '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12"/>',
    volumeOff: '<path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    trophy:    '<path d="M7 4.5h10v3a5 5 0 01-10 0z"/><path d="M7 5.5H4.5v1.5A2.5 2.5 0 007 9.5M17 5.5h2.5v1.5A2.5 2.5 0 0117 9.5M12 12.5V16M9 20.5h6M10 16h4l.5 4.5h-5z"/>',
    clock:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  };

  function svg(name, extraClass = '') {
    const inner = P[name];
    if (!inner) return '';
    return `<svg class="ico-svg ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  // Some icons read better filled (star, play, stop). Mark them so CSS/inline fill applies.
  const FILLED = new Set(['star', 'play', 'stop']);
  function svgAuto(name, extraClass = '') {
    const inner = P[name];
    if (!inner) return '';
    const fill = FILLED.has(name) ? 'currentColor' : 'none';
    return `<svg class="ico-svg ${extraClass}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      const name = el.getAttribute('data-icon');
      if (!name || el.dataset.iconDone) return;
      el.innerHTML = svgAuto(name);
      el.dataset.iconDone = '1';
    });
  }

  return { svg: svgAuto, raw: svg, hydrate, has: (n) => !!P[n] };
})();

if (typeof window !== 'undefined') window.Icons = Icons;
