# RNA-seq Service

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Live app](https://img.shields.io/badge/demo-live-brightgreen)](https://jiaenlin.github.io/rnaseq-service/)

**Only have raw FASTQ files? Turn a sequencing delivery into a complete analysis request — in your browser.**

👉 **[Open the live app](https://jiaenlin.github.io/rnaseq-service/)**

Drop the folder your sequencing provider sent. RNA-seq Service scans it for FASTQ files, groups
read pairs into samples, lets you name them, and asks a short questionnaire about the experiment —
then produces a request file and a pipeline-ready sample sheet. **Your files never leave your
computer**: only names and sizes are read, and nothing is uploaded.

---

## The four steps — A · C · G · T

| | Step | What happens |
|---|---|---|
| **A** | Sequencing files | Recursively scans a dropped folder for `.fastq` / `.fq` / `.fastq.gz` / `.fq.gz`, groups R1+R2 into samples, and reports layout and total size |
| **C** | Name samples | Rename every sample and assign it to a group, with bulk helpers (name from folder, find/replace) |
| **G** | Design & analysis | Multiple-choice questions about organism, library prep, strandedness, genome, control group, and deliverables — **pre-filled from what the scan detected** |
| **T** | Review & send | Contact details, a spec-sheet summary, then download `request.json` + `samplesheet.csv` |

## Filename conventions understood

Read pairs are grouped from the naming schemes that actually turn up in deliveries:

```
Sample_S1_L001_R1_001.fastq.gz    bcl2fastq / BCL Convert
Sample_L001_R1.fastq.gz           simplified Illumina
Sample_R1.fq.gz                   most core facilities
Sample-R1.fq.gz                   hyphenated variant
Sample.R1.raw.fastq.gz            MGI / DNBSEQ-T7
V350012345_L01_read_1.fq.gz       MGI raw lane split
Sample_1.clean.fq.gz              SRA / BGI / Novogene
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

## Output

**`rnaseq-request-<id>.json`** — the full spec: samples, files, groups, derived contrasts
(`Treated vs Control`), protocol, deliverables, and the biological question.

**`samplesheet-<id>.csv`** — nf-core-shaped, so it can drive a pipeline directly:

```csv
sample,condition,fastq_1,fastq_2
WT_1,Control,run/WT_1/WT_1_S1_L001_R1_001.fastq.gz,run/WT_1/WT_1_S1_L001_R2_001.fastq.gz
```

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
npm test          # inference regression tests
npm run build && npm run preview
```

Stack: React + TypeScript + Vite + Tailwind. No backend, and no runtime dependencies beyond React.

The original single-file prototype is kept at [`docs/prototype.html`](docs/prototype.html) as a
design reference — the app in `src/` supersedes it.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the tests, builds, and
publishes to GitHub Pages. The app uses a relative base path, so it works under
`https://<user>.github.io/<repo>/` with no extra config.
