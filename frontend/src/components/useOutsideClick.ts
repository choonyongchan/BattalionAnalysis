/** Closes a popover when the pointer goes down outside it. */

import type { RefObject } from 'preact';
import { useEffect } from 'preact/hooks';

/** Calls `onOutside` on any mousedown outside `ref`'s element while `active`. */
export function useOutsideClick(ref: RefObject<HTMLElement>, active: boolean, onOutside: () => void): void {
  useEffect(() => {
    if (!active) return undefined;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [active]);
}
