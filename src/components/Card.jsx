/**
 * The card frame every panel sits in, and the pieces that go inside one.
 */

/**
 * A titled surface. Cards carry no shadow — DESIGN.md reserves the one shadow for
 * product photography, and a card's elevation here is the surface change alone.
 * @param {{title?: string, note?: string, children: *}} props The card's contents.
 * @returns {!preact.VNode} The card.
 */
export function Card({ title, note, children }) {
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

/**
 * A coverage line: what fraction of the battalion this panel's figures actually cover.
 *
 * Every chart in this dashboard prints one, because only 5 of 45 real parade days carry
 * all six companies — a figure with no coverage line beside it overstates itself.
 * @param {{children: *}} props The coverage sentence.
 * @returns {!preact.VNode} The line.
 */
export function Coverage({ children }) {
  return <p class="coverage">{children}</p>;
}

/**
 * The empty state a panel shows instead of an axis with nothing on it.
 * @param {{children: *}} props A sentence saying what is missing and what would fill it.
 * @returns {!preact.VNode} The empty state.
 */
export function EmptyState({ children }) {
  return <p class="empty">{children}</p>;
}

/**
 * A dismissable-free inline message: a warning or an error, never a category.
 * @param {{tone?: string, children: *}} props `tone` is 'warning' or 'error'; children is
 *     the message.
 * @returns {!preact.VNode} The banner.
 */
export function Banner({ tone, children }) {
  return <p class={'banner banner--' + (tone || 'warning')}>{children}</p>;
}
