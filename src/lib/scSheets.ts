// The files the single-cell QC stage takes, written from a single-cell request: its samplesheet, the
// row of the project's reference registry, and design.csv. All three are pure functions of the
// request JSON, so whatever reads that file (the customer's download, or an intake on the server)
// gets the same bytes. Nothing is read but the request.
//
// The samplesheet (tab-separated). The columns the writer owns come first, each one scQC reserves
// (scColumns.ts): sample, platform, species, reference, assay, then
//   matrix         the raw matrix: every droplet. Its MatrixMarket folder, else its .h5;
//   aligner_cells  the aligner's filtered matrix, its cell call: the folder, which scQC reads without
//                  h5py, else the .h5, else blank (nuclei may come without one; it is never invented);
//   mt_prefix, ribo_pattern;
//   dbr            the stated doublet rate as a fraction, else blank: scQC then takes `--dbr`, and
//                  refuses rather than default when none is given.
// Then the design's factors and covariates, the columns QC's differential checks run across.
// Never written: `chemistry` and `dbr_method`, which belong to the request (scQC would read either as a
// design factor), and `dbr_sd`, a run parameter (`scqc run --dbr-sd`, or scDblFinder's own default).
// Paths are the request's: relative to the folder the customer dropped. `root` rebases them onto where
// the delivery sits on the machine that runs the analysis.
//
// The registry row: species, build, path, built_by, star_version, notes. The path is `-`: the counts
// were delivered as matrices, so nothing aligns, and scQC reads the path only to align.
//
// Each writer refuses (throws, with the reason) a request it cannot write truly: no named reference,
// no design, a species its build contradicts, or a value that would break a line.

import type { ScRequest } from './scRequest.ts'
import { ASSAYS, PLATFORMS, libraryNameBlocker } from './scRequest.ts'
import type { ScDesign } from './scDesign.ts'
import { cell, checkDesign } from './scDesign.ts'
import { REGISTRY_COLUMNS, SAMPLESHEET_COLUMNS } from './scColumns.ts'
import { referenceSpeciesBlocker } from './scReference.ts'

export { REGISTRY_COLUMNS, REQUEST_ONLY, RESERVED_COLUMNS, SAMPLESHEET_COLUMNS, SCQC_COMMIT } from './scColumns.ts'

/** A request as read back from its file: written before the design step, it has no design. */
type Req = ScRequest & { design?: ScDesign }
type Matrix = { matrix_dir: string | null; h5: string | null }

const matrixOf = (m: Matrix) => m.matrix_dir ?? m.h5
const at = (path: string | null, root: string) => (!path ? '' : root ? `${root.replace(/\/+$/, '')}/${path}` : path)

/* ---------- what a writer refuses ---------- */

function requestProblem(r: Req): string | null {
  if (r?.kind !== 'single-cell') return 'This is not a single-cell request.'
  const named = libraryNameBlocker(r.data.libraries.map(l => l.sample))
  if (named) return named
  const p = r.protocol
  if (!ASSAYS.includes(p.assay)) return `“${p.assay}” is not an assay scQC has rules for (question 1).`
  if (!PLATFORMS.includes(p.platform)) return `“${p.platform}” is not a platform scQC reads (question 2).`
  if (!p.mt_prefix || !p.ribo_pattern) return 'The mitochondrial prefix and the ribosomal pattern are both needed (question 6).'
  const noRaw = r.data.libraries.filter(l => !matrixOf(l.raw)).map(l => l.sample)
  if (noRaw.length) return `${noRaw.join(', ')}: no raw matrix, and quality control starts from every droplet.`
  return null
}

function referenceProblem(r: Req): string | null {
  const ref = r.protocol.reference
  if (!ref)
    return 'The reference is not named (question 5). scQC resolves every library through a <species>/<build> ' +
      'key of the project’s registry, so the samplesheet and the registry row wait until the build is named.'
  const slash = ref.indexOf('/')
  const species = ref.slice(0, slash)
  const build = ref.slice(slash + 1)
  if (slash < 1 || !build || build.includes('/') || species !== r.protocol.species)
    return `The reference “${ref}” is not <species>/<build> for the species ${r.protocol.species} (questions 4 and 5).`
  return referenceSpeciesBlocker(species, build)
}

function designProblem(r: Req): string | null {
  if (!r.design)
    return 'This request has no design: it was written before the design step, so neither the design table ' +
      'nor the samplesheet’s factor columns can be written from it.'
  return checkDesign(r.design, r.data.libraries.map(l => l.sample))
}

/** A cell that would break its line: a tab or a line break inside, or a quote that opens it. */
function cellProblem(cells: Record<string, string>, file: string): string | null {
  for (const [column, v] of Object.entries(cells))
    if (/[\t\r\n]/.test(v) || v.startsWith('"'))
      return `${column}: ${JSON.stringify(v)} would break a line of the ${file}: it holds a tab or a line ` +
        'break, or opens with a quote.'
  return null
}

const refuse = (why: string | null) => { if (why) throw new Error(why) }

/* ---------- the three files ---------- */

/** scQC's samplesheet: one row per library, tab-separated, header first. */
export function buildScSamplesheet(r: Req, root = ''): string {
  refuse(requestProblem(r) ?? referenceProblem(r) ?? designProblem(r))
  const design = r.design as ScDesign
  const designColumns = [...design.factors.map(f => f.name), ...design.covariates]
  const header = [...SAMPLESHEET_COLUMNS, ...designColumns]
  const p = r.protocol
  const rows = r.data.libraries.map(l => {
    const d = design.table.find(t => cell(t, 'sample') === l.sample) ?? {}
    const cells: Record<string, string> = {
      sample: l.sample, platform: p.platform, species: p.species, reference: p.reference as string, assay: p.assay,
      matrix: at(matrixOf(l.raw), root), aligner_cells: at(matrixOf(l.filtered), root),
      mt_prefix: p.mt_prefix, ribo_pattern: p.ribo_pattern, dbr: p.dbr === null ? '' : String(p.dbr),
    }
    for (const c of designColumns) cells[c] = cell(d, c)
    refuse(cellProblem(cells, 'samplesheet'))
    return header.map(h => cells[h])
  })
  return [header, ...rows].map(x => x.join('\t')).join('\n') + '\n'
}

/** This request's row of the project's reference registry: the `<species>/<build>` key the sheet names. */
export function buildRegistryRow(r: Req): string {
  refuse(requestProblem(r) ?? referenceProblem(r))
  const ref = r.protocol.reference as string
  const slash = ref.indexOf('/')
  const cells: Record<string, string> = {
    species: ref.slice(0, slash),
    build: ref.slice(slash + 1),
    path: '-',
    built_by: `the provider (${r.data.delivery === 'celescope' ? 'CeleScope' : 'Cell Ranger'} output)`,
    star_version: '-',
    notes: `request ${r.request_id}: count matrices delivered, so nothing aligns and no index path is needed`,
  }
  refuse(cellProblem(cells, 'registry'))
  return REGISTRY_COLUMNS.map(c => cells[c]).join('\t')
}

/** A registry file holding this request's row: scQC skips the header line it begins with. */
export const buildRegistryTsv = (r: Req) => `${REGISTRY_COLUMNS.join('\t')}\n${buildRegistryRow(r)}\n`

/** design.csv: comma-separated, keyed on `sample`, the factors then the covariates. No contrast. */
export function buildDesignCsv(r: Req): string {
  refuse(r?.kind !== 'single-cell' ? 'This is not a single-cell request.'
    : libraryNameBlocker(r.data.libraries.map(l => l.sample)) ?? designProblem(r))
  const design = r.design as ScDesign
  const header = ['sample', ...design.factors.map(f => f.name), ...design.covariates]
  return [header, ...design.table.map(t => header.map(h => cell(t, h)))].map(x => x.join(',')).join('\n') + '\n'
}

/** Why each file cannot be written from this request, or null where it can. */
export function stage1Refusals(r: Req): Record<'samplesheet' | 'registry' | 'design', string | null> {
  const why = (write: () => string) => { try { write(); return null } catch (e) { return (e as Error).message } }
  return {
    samplesheet: why(() => buildScSamplesheet(r)),
    registry: why(() => buildRegistryRow(r)),
    design: why(() => buildDesignCsv(r)),
  }
}
