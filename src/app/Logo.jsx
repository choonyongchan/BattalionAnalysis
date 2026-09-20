/**
 * The dashboard's mark: the 40 SAR unit crest.
 *
 * A raster asset, not `currentColor` — a crest carries its own heraldic colours (gold,
 * red, the fist-and-rifles device) that would be lost if flattened to one theme-ink
 * colour, unlike the previous inline-SVG placeholder. The source file
 * (`40SARlogo.webp`, repo root) shipped on a solid black square; it was flood-filled
 * to transparency and cropped to the crest's bounding box, so the same
 * asset sits cleanly on both the light and dark sidebar background.
 */

import logoUrl from '../assets/40SARlogo.png';

/**
 * Renders the brand mark.
 * @param {{size?: number, title?: string}} props Pixel height (the crest is portrait,
 *     ~0.83:1, so width follows automatically), and an accessible name.
 * @returns {!preact.VNode} The mark.
 */
export function Logo({ size = 28, title = '40 SAR' }) {
  return <img class="logo-mark" src={logoUrl} height={size} alt={title} />;
}
