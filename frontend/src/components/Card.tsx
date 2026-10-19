/** The card frame every panel sits in, and the pieces that go inside one. */

import type { ComponentChildren } from 'preact';

/** A titled surface; elevation is the surface change alone (DESIGN.md keeps shadows for photography). */
export function Card({ title, note, children }: { title?: string; note?: string; children: ComponentChildren }) {
  return (
    <section class="card">
      {title ? (
        <header class="card__head">
          <h3 class="card__title">{title}</h3>
          {note ? <p class="card__note">{note}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** How much of the battalion a panel's figures cover; every figure is owed one. */
export function Coverage({ children }: { children: ComponentChildren }) {
  return <p class="coverage">{children}</p>;
}

/** What a panel shows instead of an empty axis: what is missing and what would fill it. */
export function EmptyState({ children }: { children: ComponentChildren }) {
  return <p class="empty">{children}</p>;
}

/** An inline warning or error, never a category. */
export function Banner({ tone = 'warning', children }: { tone?: 'warning' | 'error'; children: ComponentChildren }) {
  return <p class={'banner banner--' + tone}>{children}</p>;
}
