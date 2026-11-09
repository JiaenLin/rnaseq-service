// scQC's samplesheet and registry columns, as the single-cell writers use them (scSheets.ts).
//
// These are this app's own copies, and they are held to scQC's: scripts/fixtures/scqc-contract.json
// is scQC's REQUIRED and NOT_FACTORS lists and its registry format, read from scQC's source at the
// commit below by scripts/scqc-contract.mjs, and scripts/test-sc-design-sheet.mjs fails when these
// drift from it. When scQC's lists change: regenerate the fixture from the new checkout, follow what
// the tests then name, and move SCQC_COMMIT.

/** The scQC commit these lists were checked against. */
export const SCQC_COMMIT = '0a9d2ced6ed1732706ea2154b4ad9001e7729707'

/**
 * The samplesheet columns the writer owns, in the order it writes them; the design's factors and
 * covariates follow. The first five are scQC's REQUIRED. Every one is in scQC's NOT_FACTORS, so none
 * is ever taken for a design factor.
 */
export const SAMPLESHEET_COLUMNS: readonly string[] = [
  'sample', 'platform', 'species', 'reference', 'assay',
  'matrix', 'aligner_cells', 'mt_prefix', 'ribo_pattern', 'dbr',
]

// scQC's NOT_FACTORS (engine/steps.py): the columns that describe the run itself, never a design.
const NOT_FACTORS = [
  'sample', 'platform', 'species', 'reference', 'assay', 'fastq_r1', 'fastq_r2', 'matrix',
  'dbr', 'dbr_sd', 'mt_prefix', 'ribo_pattern', 'expected_genes', 'aligner_cells',
  'cellbender_barcodes', 'cellreads_stats', 'nf_antisense',
  'ambient_h5', 'ambient_tool', 'ambient_version', 'ambient_params', 'ambient_produced_by',
]

/** The request's own fields. Never samplesheet columns: scQC would read either as a design factor. */
export const REQUEST_ONLY: readonly string[] = ['chemistry', 'dbr_method']

/**
 * Names a factor or a covariate cannot take, compared without case. A factor named after one of
 * scQC's own columns would collide with it and be dropped from scQC's design without a word.
 */
export const RESERVED_COLUMNS: readonly string[] = [...NOT_FACTORS, ...REQUEST_ONLY]

/**
 * The assays for which every library needs `aligner_cells`, the aligner's own cell call: all of them
 * (scQC engine/graph.py and engine/steps.py). A single cell is not denoised, so the aligner's call IS
 * its cell call, and a library without one is refused before anything is submitted. A nucleus is
 * denoised, and step 2 compares the aligner's call with the denoiser's, refusing without it after the
 * denoiser has run. scQC reads the call from nowhere else than the aligner's filtered matrix.
 */
export const ALIGNER_CELLS_REQUIRED_FOR: readonly string[] = ['snrna', 'scrna']

/** The project registry's columns (scQC's setup/init_project.sh): tab-separated, keyed `<species>/<build>`. */
export const REGISTRY_COLUMNS: readonly string[] = ['species', 'build', 'path', 'built_by', 'star_version', 'notes']
