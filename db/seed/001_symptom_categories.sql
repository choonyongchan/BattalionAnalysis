-- The nine symptom options offered by the report-sick form.
--
-- Labels are copied verbatim from a real FormSG export, not retyped: api/formsg.ts matches
-- an incoming answer against `label`, so a single character of drift silently sends every
-- submission of that type to the Others bucket. If the form's wording is ever edited, this
-- table must be updated in the same change.
--
-- `display_order` follows observed frequency rather than the form's running order, because
-- its only consumer is chart and legend ordering, where most-common-first is what reads
-- well. The counts in the comments are from 2,376 submissions, May-September 2026.
--
-- Re-runnable: `on conflict` makes this safe to apply more than once.

INSERT INTO symptom_categories (id, label, display_order) VALUES
  (1, 'Upper Respiratory Tract Infection (Fever/Flu etc.)',                   1), -- 888
  (2, 'Fever / Headache (High Temp, Severe Migraine etc.)',                   2), -- 420
  (3, 'Musculoskeletal (Pain/Sprain/Strain/Numbness of Arm, Leg, Ankle etc)', 3), -- 307
  (4, 'Gastrointestinal (Diarrhoea, Vomiting, Nausea)',                       4), -- 197
  (5, 'Dermatology Related (Skin Rashes/Abrasion/Eczema/Burns and Cuts)',     5), -- 141
  (6, 'Chest Pain & Shortness of Breath',                                     6), --  77
  (7, 'Eye & Sight Related (Conjunctivitis/Soreness in Eye etc.)',            7), --  68
  (8, 'Psychiatric / Mental Wellness (Stress/Anxiety/Insomnia etc.)',         8), --  58
  (9, 'Ear & Hearing Related (Loss of Hearing etc.)',                         9)  --   7
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label,
      display_order = EXCLUDED.display_order;

-- Note: a tenth bucket is deliberately absent. "Others" is not an option row -- it is a
-- null symptom_category_id with symptom_other_text set, which is what 213 of the 2,376
-- submissions (9.0%) used.
