/**
 * The dashboard's mark: the unit crest, or whatever the Unit settings replace it with.
 *
 * The bundled crest is the default — a raster asset, not `currentColor`, since it carries
 * its own heraldic colours (gold, red, the fist-and-rifles device) that would be lost if
 * flattened to one theme-ink colour. The source file (`40SARlogo.webp`, repo root) shipped
 * on a solid black square; it was flood-filled to transparency and cropped to the crest's
 * bounding box, so the same asset sits cleanly on both the light and dark sidebar
 * background. The Unit settings may replace it with a different logo; `title` defaults to
 * the unit name. Before login no settings are loaded, so the login screen shows the
 * bundled crest.
 */

import logoUrl from '../assets/40SARlogo.png';
import { dataset } from './state.js';
import { unitSettings } from '../data/settings.js';

/**
 * Renders the brand mark.
 * @param {{size?: number, title?: string}} props Pixel height (the crest is portrait,
 *     ~0.83:1, so width follows automatically), and an accessible name.
 * @returns {!preact.VNode} The mark.
 */
export function Logo({ size = 28, title }) {
  // Read so the mark re-renders when a refresh brings new settings.
  void dataset.value;
  const unit = unitSettings();
  return <img class="logo-mark" src={unit.logo || logoUrl} height={size} alt={title || unit.name} />;
}
