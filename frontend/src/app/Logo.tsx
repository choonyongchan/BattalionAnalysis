/**
 * The unit crest (a raster with its own heraldic colours, made transparent for both themes), or the logo
 * the Unit settings set. Before login no settings are loaded, so the login screen shows the crest.
 */

import logoUrl from '../assets/40SARlogo.png';
import { dataset } from './state.ts';
import { unitSettings } from '../data/settings.ts';

/** The brand mark at a pixel height (width follows), named by `title` or the unit name. */
export function Logo({ size = 28, title }: { size?: number; title?: string }) {
  // Read so the mark re-renders when a refresh brings new settings.
  void dataset.value;
  const unit = unitSettings();
  return <img class="logo-mark" src={unit.logo || logoUrl} height={size} alt={title || unit.name} />;
}
