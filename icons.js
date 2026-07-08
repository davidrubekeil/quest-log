/* Quest-Log — eigenes Icon-Set
   Line-Art, single-stroke, eckige Abschlüsse (Planzeichen-Ästhetik).
   Farbe kommt über currentColor vom umgebenden Element. */

const ICONS = (() => {
  const svg = inner =>
    `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

  return {
    /* UI-Symbole im gleichen Strich */
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    chevron: svg('<path d="M6 9.5l6 6 6-6"/>'),
    star: svg('<path d="M12 4l2.3 5.7 6.1.5-4.6 4 1.4 6-5.2-3.3-5.2 3.3 1.4-6-4.6-4 6.1-.5z"/>'),
    arrowRight: svg('<path d="M5 12h13M12.5 6l6 6-6 6"/>'),
    calendar: svg('<path d="M4 5.5h16v15H4zM4 9.5h16M8.5 3v4M15.5 3v4"/>'),
    flame: svg('<path d="M12 3c2.5 3 4 4.8 4 8a4 4 0 0 1-8 0c0-1.4.6-2.4 1.4-3.2-.2 1.6.8 2.7 1.6 2.7-1-1.8-.4-5.2 1-7.5z"/>'),

    /* Haken für die Checkbox — bewusst kräftigerer Strich */
    check:
      '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  };
})();
