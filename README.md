# AI4Chem Course Project Archive

## Chemistry Benchmark Explorer

An interactive, frozen course-project archive for exploring three separate evaluations of chemistry-focused language models:

1. chemistry question answering;
2. molecular atom-index controls;
3. crystal-structure generation.

The explorer is designed for inspecting results and their supporting item-level evidence. It is **not an official benchmark, a comprehensive model ranking, or a single combined leaderboard**. The three experiments use different tasks, units and metrics and must be interpreted separately.

> Frozen data snapshot: **18 November 2026**  
> Course use: AI for Chemistry / journal-club project  
> Runtime: static HTML, CSS and JavaScript; no API key or model installation required

Feel free to contact me if you need more details!
---

## Quick start

### Option 0: the most direct way to open the static page
For a single-file offline copy, download `explorer_v1.0.html`; its scripts, styles, data and illustration are embedded in the file.

If it doesn't work, try options below or just contact me.

### Option 1: open the static page directly

Download or clone the complete repository, then open `index.html` in a modern desktop browser.

Do not download `index.html` alone: the page also uses `app.js`, `style.css`, the `data/` directory and the bundled image in `assets/`.

### Option 2: run the local server

From this directory, run:

```bash
python3 start.py
```

On Windows:

```powershell
py -3 start.py
```

The script selects an available local port and normally opens the page automatically. If it does not, copy the printed address into a browser. Stop the server with `Ctrl+C`.

Optional arguments:

```bash
python3 start.py --no-browser
python3 start.py --port 8765
```

The server listens locally and does not create a public link.

### Option 3: use the GitHub Pages version

If GitHub Pages is enabled for this repository, open the URL shown under:

`Repository → Settings → Pages`

No login, analytics or remote model request is required by the explorer itself.

---

## How to use the explorer

### 1. Choose an experiment

Use the three tabs at the top of the page:

- **QA main** — chemistry question answering across 230 questions, nine models and eight source benchmarks;
- **Atom-index control** — ten molecular indexing problems under three prompt conditions;
- **Crystal generation** — 12 reference structures, three models, two input conditions and two candidates per structure.

Changing tabs changes the available controls, metrics and denominator. Results from different tabs should not be compared as though they were measurements of the same capability.

### 2. Set filters in the left panel

The current selections are displayed as filter chips above the chart. Use **Reset** to return the active experiment to its default view.

### 3. Read the chart and numerical table together

The chart provides the visual comparison. The **Selected cells** table reports the corresponding numerators, denominators and scores.

Always check the denominator before comparing percentages. A result based on candidates, structures, planned questions or protocol-valid answers represents a different quantity.

### 4. Inspect item-level evidence

Click a chart element or a row in the numerical table to open the evidence panel. Depending on the experiment, it shows:

- the prompt or material identifier;
- the reference answer or structure;
- the model prediction or raw generated text;
- protocol and scoring status;
- experiment and scorer identifiers;
- model-to-model agreement patterns.

The evidence panel can be filtered by question ID or prompt text, correctness/status and model-agreement pattern.

### 5. Export the selected view

The explorer can export:

- **filter JSON** — the complete active selection state;
- **chart SVG** — the current vector figure;
- **summary CSV** — the current aggregate cells and denominators;
- **filtered item CSV** — the item-level evidence in the selected cell.

Keep the filter JSON or exported CSV with any figure used in slides. A chart without its model selection, denominator and metric can be misleading.

---

## Experiment guide

### A. QA main

The QA section supports three exploration routes:

- **Benchmark → models** — compare selected models within one benchmark;
- **Model → chemistry** — inspect one model by chemistry field, task or benchmark;
- **Models × benchmarks** — compare several models and benchmark slices together.

Available chemistry fields are Organic, Inorganic, Physical, Analytical, Biochemistry and Materials chemistry. These are mutually exclusive display categories. `computational_chemistry` is retained as a cross-cutting tag rather than treated as a seventh mutually exclusive field.

#### Main QA metrics

| Metric | Meaning |
| --- | --- |
| `protocol_correct / planned` | Default score. Every planned question remains in the denominator, including incorrect, format-invalid and length-stopped responses. |
| `content_match / planned` | Existing extractor-level content match. It is not a new human semantic judgement. |
| `protocol_valid / planned` | Fraction of planned responses satisfying the required answer format. |
| `conditional_accuracy` | Correct responses divided only by protocol-valid responses. Use with care because it changes the denominator. |
| `S_total`, `S_partial` | oMeBench mechanism-alignment scores. Partial alignment does not establish chemical feasibility. |

The default planned-denominator score is the safest starting point. Conditional accuracy should not replace it without explaining that invalid responses have been removed from the denominator.

### B. Atom-index control

This section tests whether a model can identify atom indices consistently under three prompt conditions:

| Condition | Input change |
| --- | --- |
| **A0** | Original prompt. |
| **A1** | Explicitly states that indexing is zero-based. |
| **A2** | Adds atom-mapped SMILES while the requested answers remain zero-based. |

The statistical unit is the molecule: ten molecules per model-condition cell. The primary metric is exact-set correctness.

DeepSeek's 30 planned cells were not executed in this frozen snapshot. They are shown as **N/A**, not as zero. Missing experiments must not be interpreted as model failures.

### C. Crystal generation

The crystal section contains two input conditions:

| Condition | Information supplied to the model |
| --- | --- |
| **S0** | Composition and derived atom properties. |
| **S1** | S0 information plus the target space group. |

Each of the 12 reference structures has two fixed generated candidates per model and condition.

#### Scoring paths

The two scoring paths must be reported separately:

- **Direct parse — no upstream postprocessing:** evaluates the generated CIF directly with the frozen parser settings.
- **Author postprocessing:** first applies the public CrystaLLM-π postprocessing pipeline, including numerical-format repair, symmetry-operation restoration and CIF rewriting, and then evaluates the resulting structure.

Author postprocessing is more than whitespace cleanup and can change the parsed composition and symmetry-expanded structure. A success on this path therefore describes the **model plus the published postprocessing pipeline**, not the raw model text alone.

#### Crystal metrics

| Metric | Meaning |
| --- | --- |
| **Parse** | A single structure can be read from the CIF. |
| **Composition** | Parsed composition matches the reference composition exactly. |
| **Periodic geometry** | The frozen volume and minimum-distance screen is passed. |
| **Reference match** | `pymatgen` StructureMatcher matches the generated and reference structures. |
| **Space-group agreement** | Predicted and reference space-group numbers agree. |
| **TaskSuccess** | Required parse, composition, geometry and reference-match checks pass; S1 additionally requires space-group agreement. |

#### Crystal counting units

| Unit | Denominator per model-condition cell |
| --- | ---: |
| **Candidate** | 24 generated candidates |
| **Structure @1** | 12 structures, using the first candidate only |
| **Structure @2** | 12 structures, counted as success if either fixed candidate succeeds |

S0 and S1 reuse the same 12 reference structures and are not 24 independent structures.

No crystal metric in this archive demonstrates:

- DFT or force-field energy stability;
- dynamic or phonon stability;
- synthetic accessibility;
- experimental synthesizability.

Structural matching should not be described as proof of a stable or synthesizable material.

---

## Frozen data scope

- **QA:** 230 questions × nine models = 2,070 planned result rows.
- **Atom-index controls:** 90 planned cells; 60 executed; 30 DeepSeek cells remain N/A.
- **Crystal generation:** 144 candidates from 12 structures, three models, two conditions and two candidates per condition.
- **OmniChem independent human review:** pending in this snapshot.

The explorer preserves the three experiments as separate objects and does not define a combined score.

---

## Repository structure

```text
.
├── index.html                    # Main interface
├── app.js                        # Filtering, charts, evidence views and exports
├── style.css                     # Page styling
├── start.py                      # Optional local static server
├── assets/                       # Bundled illustration
├── data/
│   ├── explorer-data.js          # Browser-ready frozen dataset
│   ├── explorer.json             # Machine-readable frozen dataset
│   ├── chemistry_field_mapping.csv
│   └── source_manifest.json      # Input provenance and hashes
├── DATA_DICTIONARY.md            # Field and metric definitions
└── PACKAGING_MANIFEST.json       # Packaged-file SHA256 manifest
```

`raw_path` values shown in the interface are provenance metadata. They do not provide access to the original author's computer, and the full external experiment directories are not required to use the archive.

---

## Reproducibility and interpretation

The site is a frozen display layer: it does not rerun models or rescore answers when filters change. Filtering only selects and aggregates records already present in the snapshot.

For an auditable use of a result:

1. record the experiment tab;
2. record all active filters;
3. report the metric and denominator;
4. distinguish planned, executed and missing records;
5. distinguish direct CIF evaluation from author-postprocessed evaluation;
6. inspect representative item-level evidence;
7. retain the exported filter JSON or summary CSV.

See [`DATA_DICTIONARY.md`](./DATA_DICTIONARY.md) for the complete schema, field definitions and interpretation limits. See [`data/source_manifest.json`](./data/source_manifest.json) for source-file provenance and hashes.

---

## Public-use note

This repository is a **course-project archive**. Its results are exploratory and tied to the frozen model versions, prompts, datasets, generation settings and scorers documented here. They should not be presented as current model performance or generalized beyond the evaluated sample.

Before redistributing derived data, model responses or third-party materials, check the licences and terms of the original benchmark, model and software sources. This archive does not automatically relicense third-party content.

---
