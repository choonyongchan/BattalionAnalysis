/**
 * Deposit: the one page that writes.
 *
 * A toggle picks what is being worked on: parade states (deposit one WhatsApp missed, or
 * correct or delete one already stored, through `/api/parade`) or SFT records (correct or
 * delete one FormSG sent, through `/api/sft`). Each lives in its own panel under
 * `pages/deposit/`.
 */

import { useState } from 'preact/hooks';
import { Segmented } from '../components/Segmented.tsx';
import { ParadePanel } from './deposit/ParadePanel.tsx';
import { SftPanel } from './deposit/SftPanel.tsx';

/** What the toggle switches between, with the line under the title for each. */
const KINDS = [
  { name: 'parade', label: 'Parade State', sub: 'Deposit a parade state WhatsApp missed, or correct one already stored.' },
  { name: 'sft', label: 'SFT', sub: 'Correct or delete an SFT record the FormSG form sent.' },
] as const;

/** The Deposit page. */
export function Deposit() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['name']>('parade');
  const current = KINDS.find((option) => option.name === kind)!;

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Deposit</h1>
          <p class="pagehead__sub">{current.sub}</p>
        </div>
        <Segmented options={KINDS} value={kind} onChange={setKind} label="What to deposit or correct" radio />
      </header>

      {kind === 'sft' ? <SftPanel /> : <ParadePanel />}
    </div>
  );
}
