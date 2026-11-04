// One icon set: lucide paths, 16px, 1.5 stroke, colored by the surrounding text.
const svg = (inner, size = 16) => `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICON = {
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
};

// status color name -> icon
export const STATUS_ICON = { green: ICON.check, none: ICON.check, yellow: ICON.alert, red: ICON.x };

// Flat product mark: an orbit with one body on it.
export const MARK = svg('<circle cx="12" cy="12" r="8.5"/><circle cx="18" cy="6" r="2" fill="currentColor" stroke="none"/>', 18);
