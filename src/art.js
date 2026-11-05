// Pixel sprites built from art/art.px.js with pxl. art('planet_mars') -> image url.
const files = import.meta.glob('./art/*.png', { eager: true, query: '?url', import: 'default' });
export const art = (name) => files[`./art/${name}.png`];
