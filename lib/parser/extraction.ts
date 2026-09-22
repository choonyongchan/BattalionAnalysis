/**
 * The shape a parsed parade state takes between the parsers that produce it (`deterministic.ts`,
 * or `llm.ts` when the rules are unsure) and `rows.ts`, which validates it and turns it into rows.
 */

/** A unit strength block as parsed. */
export interface ExtractedUnit {
  unit_label: string;
  total_strength: number | null;
  total_present: number | null;
  officer_strength: number | null;
  officer_present: number | null;
  wospec_strength: number | null;
  wospec_present: number | null;
  enlistee_strength: number | null;
  enlistee_present: number | null;
  section_counts: Array<{ reason_category: string; stated_count: number | null }>;
}

/** A command appointment as parsed. */
export interface ExtractedCommandMember {
  role_kind: string;
  unit_label: string | null;
  rank: string | null;
  name: string | null;
  is_vacant: boolean;
}

/** One entry line as parsed. */
export interface ExtractedPerson {
  unit_label: string;
  entry_index: number | null;
  reason_category: string;
  four_d: string | null;
  rank: string | null;
  name: string;
  duty_type: string | null;
  sub_reason: string | null;
  report_sick_type: string | null;
  num_days: number | null;
  is_permanent: boolean;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  in_camp: boolean | null;
  location: string | null;
  source_line: string | null;
}

/** A whole extracted message. */
export interface Extraction {
  rejected: boolean;
  rejection_reason: string | null;
  company: string | null;
  date: string | null;
  session: string | null;
  parade_time: string | null;
  units: ExtractedUnit[];
  command_team: ExtractedCommandMember[];
  personnel: ExtractedPerson[];
}
