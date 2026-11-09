# RNA-seq Service

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live app](https://img.shields.io/badge/demo-live-brightgreen)](https://jiaenlin.github.io/rnaseq-service/)

**Only have raw FASTQ files? Turn a sequencing delivery into a complete analysis request — in your browser.**

👉 **[Open the live app](https://jiaenlin.github.io/rnaseq-service/)**

Drop the folder your sequencing provider sent. RNA-seq Service scans it for FASTQ files, groups
read pairs into samples, lets you name them, and asks a short questionnaire about the experiment —
then produces a request file and a pipeline-ready sample sheet. **Your files never leave your
computer**: only names and sizes are read, and nothing is uploaded.

A **single-cell delivery** (Cell Ranger or CeleScope output, the aligner's count matrices) is
recognised too. It becomes a single-cell request with its own questions: see
[Single-cell deliveries](#single-cell-deliveries).

---

## The four steps — A · C · G · T

| | Step | What happens |
|---|---|---|
| **A** | Sequencing files | Recursively scans a dropped folder for `.fastq` / `.fq` / `.fastq.gz` / `.fq.gz`, groups R1+R2 into samples, and reports layout and total size |
| **C** | Name samples | Rename every sample and assign it to a group, with bulk helpers (name from folder, find/replace) |
| **G** | Design & analysis | Multiple-choice questions about organism, library prep, strandedness, genome, control group, and deliverables — **pre-filled from what the scan detected** |
| **T** | Review & send | Contact details, a spec-sheet summary, then download `request.json` + `samplesheet.csv` |

A single-cell delivery goes through the same four steps: its libraries, their names, the single-cell
questions, and the request.

## Filename conventions understood

Read pairs are grouped from the naming schemes that actually turn up in deliveries:

```
Sample_S1_L001_R1_001.fastq.gz    bcl2fastq / BCL Convert
Sample_L001_R1.fastq.gz           simplified Illumina
Sample_R1.fq.gz                   most core facilities
Sample-R1.fq.gz                   hyphenated variant
Sample.R1.raw.fastq.gz            MGI / DNBSEQ-T7
V350012345_L01_read_1.fq.gz       MGI raw lane split
Sample_1.clean.fq.gz              SRA / BGI
```

`.raw`, `.clean`, `.filtered`, `.trimmed` and the bcl2fastq `_001` chunk index are
stripped when they follow a read tag. When a delivery gives every sample its own
folder and reuses one filename inside each — the usual MGI/T7 raw layout — the
folder name becomes the sample identity instead of the filename.

Operating-system bookkeeping is skipped before anything is counted: macOS
AppleDouble sidecars (`._Sample.R1.fastq.gz`, written whenever a delivery passes
through an exFAT drive or an SMB share), `.DS_Store`, `__MACOSX/`, `Thumbs.db`
and friends. A sidecar ends in `.fastq.gz` too, so left in it would double the
file count and make every paired sample look single-end.

If the guess is wrong, switch grouping to **one sample per file** on step A.

## Answers inferred from the scan

Step G arrives partly answered. Each pre-filled answer is labelled with the evidence behind it,
because a silently wrong default is worse than a blank one — it would propagate into the analysis
unchallenged.

| Answer | Inferred from | Label |
|---|---|---|
| Read layout | R1 + R2 files per sample | `from your files` |
| Control group | a group named `Control`, `WT`, `Vehicle`, `Day0`, `Adjacent_Normal`… | `from your files` |
| Organism | `Mouse`, `Homo_sapiens`, `hg38`, `mm10`… in the paths | `from your files` |
| Library prep | `mRNA`, `totalRNA`, `RiboZero`, `QuantSeq`… | `from your files` |
| Reference genome | a named build, else the current standard | `from your files` / `assumed` |
| Paired design | a subject ID shared across groups (`Patient1_Pre` / `Patient1_Post`) | `from your files` / `assumed` |
| Strandedness | *never guessed* — unknowable from filenames | — |

Touching an answer marks it yours; re-scanning never overwrites it. **Clear pre-filled** drops
them all. The heuristics are covered by [`scripts/test-infer.mjs`](scripts/test-infer.mjs)
(`npm test`), which runs in CI before every deploy — including the cases that must *not* fire:
`concentRATion` is not a rat, and `WT_1`/`KO_1` are replicate numbers, not one subject measured twice.

## Single-cell deliveries

A delivery is single-cell when it holds an aligner's count matrices. The matrices decide it, not a
folder name: FASTQ files in a folder called `outs/raw` are still FASTQ, and anything not recognised
goes down the FASTQ path exactly as before. When matrices and FASTQ files arrive together, the
delivery is single-cell, and the FASTQ files are set aside.

| Layout | What is recognised |
|---|---|
| Cell Ranger, as it writes them | `<library>/outs/raw_feature_bc_matrix/` and `filtered_feature_bc_matrix/` (the folder, the `.h5`, or both), with `metrics_summary.csv` and `web_summary.html` |
| Cell Ranger, `outs/` flattened by the provider | the same files directly in `<library>/` |
| CeleScope | `<sample>/outs/raw/` and `outs/filtered/`, also nested one folder deeper (`<sample>/<sample>/outs/…`), with `<sample>_report.html` |

A library is the folder holding the matrices, or holding their `outs/`. For each library, step A shows:
- the **raw** matrix: every droplet, including the empty ones, which is where quality control starts;
- the **filtered** matrix: the aligner's own cell call;
- the summary files.

A matrix folder counts only when all three of its files are present: `matrix.mtx`, `barcodes.tsv`,
and `features.tsv` or `genes.tsv`, each gzipped or not. A missing file is named. A library without
a raw matrix blocks step A. Cell Ranger `multi` output is recognised and refused by name, whether it
arrives as `per_sample_outs/` or as matrices named `sample_raw_feature_bc_matrix` and
`sample_filtered_feature_bc_matrix`: there, a raw matrix belongs to a GEM well that several samples
share, which this request cannot express yet.

**The questions, and what is pre-filled:**

| Question | Pre-filled from the file names? |
|---|---|
| 1 · Single cells or single nuclei | **Never.** There is no default, and Continue stays blocked until you answer. For single cells, every library also needs its filtered matrix |
| 2 · Platform | From the layout: Cell Ranger is 10x, CeleScope is Singleron |
| 3 · Chemistry | Never. *Not sure* is an answer: the aligner records it for every library |
| 4 · Organism | From a species or build token in the paths, as for bulk |
| 5 · Reference the counts were made against | From a build token such as `GRCh38-2024-A`. *Not sure* is an answer |
| 6 · Mitochondrial prefix and ribosomal pattern | Never. One click applies the human convention (`MT-`, `^RP[SL]`) or the mouse one (`mt-`, `^Rp[sl]`) |
| 7 · Doublet rate | Never. Either it is worked out per library, or you state one percentage |

Not asked yet: the experimental design (groups, factors, and the reference level of each). Question 8
asks for the comparison in words instead. Values that need a file's contents are not read either: cell
counts, and the chemistry or build recorded inside the files. As for bulk, only names and sizes are read.

## Output

**`rnaseq-request-<id>.json`** — the full spec: samples, files, groups, derived contrasts
(`Treated vs Control`), protocol, deliverables, and the biological question.

**`samplesheet-<id>.csv`** — nf-core-shaped, so it can drive a pipeline directly:

```csv
sample,condition,fastq_1,fastq_2
WT_1,Control,run/WT_1/WT_1_S1_L001_R1_001.fastq.gz,run/WT_1/WT_1_S1_L001_R2_001.fastq.gz
```

**`scrnaseq-request-<id>.json`** is the single-cell request. It begins `"kind": "single-cell"` and lists
each library's raw and filtered matrices and summary files. Seven protocol fields carry the names of
the single-cell QC samplesheet's columns: `assay`, `platform`, `species`, `reference` (written
`<species>/<build>`), `mt_prefix`, `ribo_pattern` and `dbr`. **`chemistry` and `dbr_method` belong to
the request only. They are not samplesheet columns and must never be copied into one:** the QC tool
treats every column it does not reserve as a candidate design factor. `answered_by` records, for each
field, whether you gave it or it was read from your file names.
[`scripts/fixtures/sc-request.json`](scripts/fixtures/sc-request.json) is a complete example. A bulk
request carries no `kind` field and is unchanged.

---

## Where this fits

Three tools, one workflow — each usable on its own:

| Tool | For | Input → output |
|---|---|---|
| **RNA-seq Service** (this repo) | You have raw FASTQ and want someone to run it | sequencing folder → analysis request |
| [**RNA-seq Lab**](https://jiaenlin.github.io/rnaseq-lab/) ([source](https://github.com/JiaenLin/rnaseq-lab)) | You have a count matrix | counts → DESeq2 / limma-voom in-browser → result bundle |
| [**RNA-seq Studio**](https://jiaenlin.github.io/rnaseq-studio/) ([source](https://github.com/JiaenLin/rnaseq-studio)) | You have results to explore | result bundle → interactive explorer |

## Develop

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # regression tests: FASTQ scan, inference, groups, single-cell delivery and request
npm run build && npm run preview
```

`npm test` also checks that the built-in demo's bulk request is byte-identical to the one written
before single-cell deliveries were recognised
([`scripts/fixtures/bulk-demo-request.json`](scripts/fixtures/bulk-demo-request.json)). If you change
the bulk request on purpose, [`scripts/bulk-demo-request.mjs`](scripts/bulk-demo-request.mjs) says
how to regenerate the fixture.

Stack: React + TypeScript + Vite + Tailwind. No backend, and no runtime dependencies beyond React.

The original single-file prototype is kept at [`docs/prototype.html`](docs/prototype.html) as a
design reference — the app in `src/` supersedes it.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the tests, builds, and
publishes to GitHub Pages. The app uses a relative base path, so it works under
`https://<user>.github.io/<repo>/` with no extra config.
