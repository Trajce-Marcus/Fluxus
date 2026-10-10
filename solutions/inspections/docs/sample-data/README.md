# Sample data — Pre-Purchase walk-through

Enough to proceed with, not comprehensive. Gathered 2026-10-04. Column headings
are placeholders, not field names.

| File | What it holds |
| --- | --- |
| `inspection_areas.csv` | The ten walk-through areas, in report order |
| `defects.csv` | Defects observable on a walk-through, each with a default category |
| `defect_categories.csv` | Major defect, minor defect, safety hazard — the AS 4349.1 categories, paraphrased |
| `code_references.csv` | Code clauses with an extract of their text |
| `area_defects.csv` | Which defects can be recorded in which area |
| `defect_code_references.csv` | Which code clauses relate to which defect |
| `access_restrictions.csv` | Why an area was not fully inspected (added 2026-10-11) |

## About the code references

- **R01–R17** are verbatim from the NCC 2025 Housing Provisions (in force in
  Victoria from 1 May 2026), checked against the published text. The NCC is
  CC BY 4.0: any use must carry the attribution in the `attribution` column.
  The extracts lost the original (a), (b) list lettering.
- **R18–R19** (AS 2870, AS 4349.1) are paraphrases. Standards Australia text is
  copyright and cannot be stored verbatim; not checked against the standards.
- **R20** (BPC Guide to Standards and Tolerances 2026) is a paraphrase from
  secondary sources; the official PDF could not be read. Clause not confirmed.
- The NCC and the BPC guide govern **new** building work. A pre-purchase
  inspection assesses an existing home against buildings of similar age
  (AS 4349.1), so a clause shows today's benchmark, not necessarily what applied
  when the house was built.

## About the categories

**Safety hazard is no longer a category** (2026-10-11): safety is its own flag
on a finding, so "Safety hazard" is expired in the app and kept only as
history. It stays in `defect_categories.csv`, and as the default category of the
defects that had it, until the master data is refined.

Each defect's category is a suggested default. Whether a particular finding is
major or minor is judged on site — a hairline crack and a 10 mm crack are the
same defect.

**Timber pest items are ordinary defects** (2026-10-11): D37–D41 (termite
damage, borers, timber touching soil, covered slab edge, garden beds against
walls), mapped to the areas where they are seen. The firm does no timber pest
inspections, so there is no separate checklist. Written for this sample, not
checked against AS 4349.3.
