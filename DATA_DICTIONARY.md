# Data dictionary

The dashboard snapshot has `schema_version: 4` and three independent experiment objects: `qa`, `index`, and `crystal`. It does not define a field that combines them into one score.

## Shared provenance

| Field | Meaning |
| --- | --- |
| `experiment_id` / `run_id` | Frozen experiment or execution identifier. |
| `model` | Internal model alias used to join records. |
| `model_id` | Configured model identity, when available. |
| `source_id` | Original benchmark or material identifier. |
| `raw_path` | Project-relative path to the preserved raw response. It is displayed as traceability text, not exposed as a hyperlink. |
| `scorer_version` | Frozen scorer identifier attached to the record. |
| `generated_at_utc` | Time at which the derived dashboard snapshot was written. It is not the experiment time. |

`data/source_manifest.json` lists every source file read by `build_data.py`, its SHA256 value, and the zero-call build declaration. `data/chemistry_field_mapping.csv` is the 230-row audit table for the derived chemistry lens. It includes the source benchmark, source ID, primary field, cross-tags, classification basis, legacy analysis tag, and original source labels for every question.

## QA experiment

### Question fields

| Field | Meaning |
| --- | --- |
| `id` | Dashboard question key. |
| `benchmark` / `benchmark_label` | One of the eight QA benchmarks and its display name. |
| `task_key` / `task_label` | Frozen task type and display label. |
| `chemistry_field` / `chemistry_field_label` | Mutually exclusive chemistry-oriented field used by the dashboard: Organic, Inorganic, Physical, Analytical, Biochemistry, or Materials. |
| `chemistry_field_basis` | Per-question explanation of the source label or frozen mapping used to derive `chemistry_field`. |
| `cross_cutting_tags` | Overlapping capability tags. The current snapshot uses `computational_chemistry` for the 15 frozen ChemBench computational questions. |
| `analysis_domain` | Legacy project selection tag retained for traceability. It includes cross-cutting labels such as computational and is not used as the primary chemical-field display. |
| `prompt` / `options` | Full question text and options joined from the frozen QA files. |
| `gold` | Frozen scoring target. |
| `pair_id` / `group_id` | Molecular or reaction grouping identifier when applicable. |
| `source_labels` | Original benchmark metadata. It is retained beside the derived chemistry field and is never overwritten. |
| `source_revision` / `source_url` | Frozen source version and source link. |

### Result fields

| Field | Meaning and denominator |
| --- | --- |
| `prediction` | Extracted answer used by the frozen scorer. It is not substituted for missing raw text. |
| `raw_text` | Verbatim formal response selected by question, model, run, and attempt identifiers. |
| `protocol_valid` | Whether the response satisfied the frozen output protocol. |
| `content_match` | Existing extractor-level content match. It is not a new human semantic judgement. |
| `protocol_correct` | Default binary QA correctness. The main denominator is every planned question in the selected scope. |
| `conditional_accuracy` | `protocol_correct / protocol_valid`. It is optional and does not replace the default planned denominator. |
| `status` | Frozen final status. Status flags such as length stop and protocol validity can overlap and are not treated as mutually exclusive categories. |
| `finish_reason` / `length_stop` | Provider or local stopping information and the frozen length-stop flag. |
| `official_score` / `metric` | Frozen task-specific score and its name. These fields are displayed for traceability, not mixed across incompatible tasks. |
| `attempt_id` / `run_id` | Identifiers used to locate the formal response rather than a development or retry record. |

For oMeBench, `exact_mechanism_match` is the binary correctness field. `S_total`, `S_partial`, `V`, and `L` remain separate. A partial score measures reference alignment and does not establish chemical feasibility. A mean with no scorable mechanisms is N/A, not zero.

Selecting a parent benchmark and its child task can create overlapping displayed memberships. Unique-question counts and item exports deduplicate by `question_id`.

### Chemistry-field derivation

ChemBench uses its upstream `topic`, except that the frozen biochemistry selection remains Biochemistry and records that its upstream topic is `organic_chemistry`. The 15 frozen computational questions retain `computational_chemistry` as a cross-cutting tag; their upstream topics assign 11 to Physical, 3 to Organic, and 1 to Materials.

QCBench retains its upstream class. Quantum and Physical questions are displayed under Physical chemistry, Analytical under Analytical chemistry, Biochemistry under Biochemistry, Inorganic under Inorganic chemistry, and Polymer under Materials chemistry. The selected Quantum and Physical questions are quantitative physical-chemistry problems; they are not automatically relabelled computational.

Other benchmarks use their existing frozen analysis mapping. SUPERChem's basis is explicitly labelled keyword-derived because the source does not provide an upstream subfield. Across all 230 QA questions, the mutually exclusive field counts are Organic 64, Inorganic 31, Physical 21, Analytical 33, Biochemistry 23, and Materials 58.

## Atom-index control

Each planned record is identified by model, question, and condition.

| Field | Meaning |
| --- | --- |
| `condition` | A0 is the original v5 prompt; A1 adds explicit zero-based indexing; A2 adds atom-mapped SMILES while answers remain zero-based. |
| `pair_id` | Molecular pair identifier. Ten molecules are the statistical units. |
| `original_smiles` / `mapped_smiles` | Original representation and the verified A2 mapping. |
| `prompt` | Exact model input for that condition. |
| `executed` | Whether the planned cell received a formal generation. |
| `exact_set_correct` | Exact set match for executed cells. Unexecuted cells are null. |
| `protocol_valid` | Frozen protocol-valid flag for executed cells. Unexecuted cells are null. |
| `raw_missing_reason` | Explicit reason when no raw response exists. |

The display reports correct and valid counts out of the ten molecules per model-condition cell. DeepSeek has 30 planned but unexecuted cells, so its result is N/A rather than 0/10.

## Crystal generation

Each record is one candidate. The key comprises model, sample, condition, and `sample_index`.

| Field | Meaning |
| --- | --- |
| `sample_id` / `material_id` | Diagnostic-slice identifier and source MP identifier. |
| `condition` | S0 provides composition and derived atom properties; S1 additionally provides space group. |
| `sample_index` | Fixed candidate order, 1 or 2. Structure @1 uses candidate 1. Structure @2 passes if either fixed candidate passes. |
| `prompt` | Public generation input. Gold CIF content is not part of this input. |
| `raw_text` | Verbatim generated CIF text. |
| `strict_parse`, `composition_exact`, `geometry_screen`, `reference_structure_match`, `spacegroup_agreement`, `task_success` | Direct-path checks under the frozen scorer. They are independent checks, not a cumulative funnel. |
| `repaired_*` | Corresponding author-postprocessed checks. This path is separate from direct parsing. |
| `parser_warnings` / `adapter_operations` | Frozen parser and adapter traceability. |
| `gold_cif` / `gold_cif_path` | Reference used only for scoring and item-level inspection. |

Candidate views use 24 candidates per model-condition. Structure @1 and @2 views use 12 structures per model-condition. S0 and S1 are two conditions on the same 12 structures and are not combined into 24 independent structures. No field measures energy stability or synthesizability.

## Export fields

Summary CSV files contain the selected scope, model, metric, numerator, denominator, planned and executed counts, selected auxiliary counts, version identifier, and serialized filter state. Item CSV files add question or material identifiers, task and domain fields, conditions, predictions, gold values, raw text, status, run and scorer fields, and project-relative raw paths.

The filter JSON records the active experiment and every selector value. It allows a chart or CSV to be interpreted after it leaves the dashboard.
