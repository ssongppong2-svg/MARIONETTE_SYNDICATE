/*
 * Force Chamber — line icons (24px grid, stroke = currentColor).
 */
(function (root) {
  'use strict';
  const Lab = (root.Lab = root.Lab || {});
  const P = {
    brief: '<path d="M6 3h9l3 3v15H6z"/><path d="M15 3v3h3"/><path d="M9 11h6M9 15h6"/>',
    notebook: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v18"/><path d="M12 8h4M12 12h4"/>',
    map: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.6 0-4-1.3-5.4-3.4L3.5 14a1.6 1.6 0 0 1 2.6-1.8L8 14.5"/>',
    ruler: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
    force: '<path d="M4 20L18 6"/><path d="M11 6h7v7"/><circle cx="4" cy="20" r="1.4"/>',
    strobe: '<circle cx="5" cy="17" r="2"/><circle cx="11" cy="9" r="2" opacity=".7"/><circle cx="17" cy="7" r="2" opacity=".45"/><path d="M5 15c1-4 3-6 6-6s5 1 6-2" stroke-dasharray="2 2"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    step: '<path d="M6 4l9 8-9 8z"/><path d="M18 4v16"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>',
    hint: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.2h5.2c0-.9.4-1.7 1-2.2A6 6 0 0 0 12 3z"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    door: '<path d="M5 21V4h11v17"/><path d="M3 21h18"/><circle cx="13" cy="13" r="1"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  function icon(name, size = 18) {
    const body = P[name] || '';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  Lab.icon = icon;
})(typeof window !== 'undefined' ? window : globalThis);
