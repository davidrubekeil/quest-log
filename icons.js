/* Quest-Log — eigenes Icon-Set
   Line-Art, single-stroke, eckige Abschlüsse (Planzeichen-Ästhetik).
   Farbe kommt über currentColor vom umgebenden Element. */

const ICONS = (() => {
  const svg = inner =>
    `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${inner}</svg>`;

  return {
    /* Quest/Projekt — Wegmarke/Fähnchen mit Standlinie */
    quest: svg(
      '<path d="M7 21V3"/>' +
      '<path d="M7 4h11l-3 3.5 3 3.5H7"/>' +
      '<path d="M4 21h6"/>'
    ),

    /* Streak-Marker — aufsteigende Balken auf Grundlinie */
    streak: svg(
      '<path d="M6.5 20v-5"/>' +
      '<path d="M12 20v-9"/>' +
      '<path d="M17.5 20v-13"/>' +
      '<path d="M3.5 20h17"/>'
    ),

    /* UI-Symbole im gleichen Strich */
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    chevron: svg('<path d="M6 9.5l6 6 6-6"/>'),

    /* Haken für die Checkbox — bewusst kräftigerer Strich */
    check:
      '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
  };
})();
