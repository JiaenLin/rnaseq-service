// Recognising a single-cell delivery and grouping it into libraries. Like the FASTQ scan, this runs
// on file NAMES and sizes only; no file is ever opened.
//
// A single-cell delivery is not reads but the aligner's output: a count matrix per library, in two
// forms that matter downstream and must never be confused.
//   raw       every droplet, including the empty ones. Quality control starts here: the background
//             is learned from the empties, which the filtered matrix no longer has.
//   filtered  the aligner's own cell call. For single cells it IS the cell call.
// Each comes as a MatrixMarket folder (three files) and, from Cell Ranger, also as one `.h5`.
//
// The layouts that actually arrive:
//   <library>/outs/raw_feature_bc_matrix/...   Cell Ranger, as it writes them
//   <library>/raw_feature_bc_matrix/...        Cell Ranger, `outs/` flattened by the provider
//   <s>/<s>/outs/raw/...  <s>/<s>/outs/filtered/...
//                                              CeleScope, often nested one folder deeper
// The library is the folder holding the matrices (or holding their `outs/`), never the matrix
// folder itself: CeleScope names every library's matrix folder `raw`.

import type { FastqFile } from '../types'
import { isJunk } from './scan.ts'

/** What a dropped folder is. Anything that is not a single-cell output is `fastq`: the bulk path, as before. */
export type DeliveryKind = 'fastq' | 'cellranger' | 'celescope'

export interface ScMatrix {
  /** The MatrixMarket folder, when all three of its files are present. */
  matrix_dir: string | null
  h5: string | null
}

export interface ScLibrary {
  /** The library folder: the stable key. `.` when the matrices sit at the top of the drop. */
  id: string
  /** The folder's own name, or its path when two libraries share a name. */
  label: string
  folder: string
  /** Cell Ranger's `outs/` kept, or flattened away by the provider. CeleScope is always `outs`. */
  layout: 'flat' | 'outs'
  raw: ScMatrix
  filtered: ScMatrix
  /** metrics_summary.csv and web_summary.html (Cell Ranger), `<s>_report.html` (CeleScope). */
  summary: string[]
  /** Everything else in the library folder (BAM, molecule_info.h5, ...): listed, not lost. */
  other: string[]
  bytes: number
  /** What is missing, in words. A library with no raw matrix cannot go through quality control. */
  problems: string[]
}

export interface ScScan {
  kind: DeliveryKind
  libraries: ScLibrary[]
  /** Paths outside every library: the provider's README, FASTQ beside the outs, and so on. */
  other: string[]
  /** Operating-system bookkeeping that was dropped (AppleDouble sidecars, .DS_Store, ...). */
  skipped: number
  n_files: number
  bytes: number
  /** Why this delivery cannot become a request yet: a layout recognised, but not handled. */
  unsupported: string | null
}

export const hasMatrix = (m: ScMatrix) => !!(m.matrix_dir || m.h5)

/* ---------- the names the aligners write ---------- */

// The same three lists scQC's ingest accepts (adapters/celescope.py MATRIX/BARCODE/FEATURE_NAMES).
type Part = 'matrix' | 'barcodes' | 'features'
const PART_NAMES: [Part, string[]][] = [
  ['matrix', ['matrix.mtx.gz', 'matrix.mtx']],
  ['barcodes', ['barcodes.tsv.gz', 'barcodes.tsv']],
  ['features', ['features.tsv.gz', 'features.tsv', 'genes.tsv.gz', 'genes.tsv']],
]
const PART_OF = new Map(PART_NAMES.flatMap(([part, names]) => names.map(n => [n, part] as const)))

type Which = 'raw' | 'filtered'
const CR_DIR: Record<string, Which> = { raw_feature_bc_matrix: 'raw', filtered_feature_bc_matrix: 'filtered' }
const CR_H5: Record<string, Which> = { 'raw_feature_bc_matrix.h5': 'raw', 'filtered_feature_bc_matrix.h5': 'filtered' }
const CR_SUMMARY = new Set(['metrics_summary.csv', 'web_summary.html'])
const CS_SUMMARY = /_report\.html$/

/** Where a file sits in a single-cell layout, or null when it is not part of a matrix. */
interface Hit {
  kind: 'cellranger' | 'celescope'
  which: Which
  /** The folder holding the matrix folder or the h5: a library folder, or its `outs/`. */
  container: string
  /** Set for a MatrixMarket file: its folder, and which of the three it is. */
  dir?: string
  part?: Part
  h5?: string
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

function classify(path: string): Hit | null {
  const seg = path.split('/')
  const name = seg[seg.length - 1]
  const parent = seg.length > 1 ? seg[seg.length - 2] : ''
  const above = seg.slice(0, -2).join('/')
  if (own(CR_H5, name)) return { kind: 'cellranger', which: CR_H5[name], container: seg.slice(0, -1).join('/'), h5: path }
  const part = PART_OF.get(name)
  if (!part) return null
  if (own(CR_DIR, parent))
    return { kind: 'cellranger', which: CR_DIR[parent], container: above, dir: seg.slice(0, -1).join('/'), part }
  if ((parent === 'raw' || parent === 'filtered') && seg.length > 2 && seg[seg.length - 3] === 'outs')
    return { kind: 'celescope', which: parent, container: above, dir: seg.slice(0, -1).join('/'), part }
  return null
}

const real = (files: FastqFile[]) => files.filter(f => !isJunk(f.path))

/**
 * `cellranger` or `celescope` when the drop holds a matrix in that aligner's layout, else `fastq`.
 *
 * A matrix decides it, never a folder name: FASTQ files delivered in a folder called `outs/raw`
 * are still FASTQ. When matrices and FASTQ arrive together the delivery is single-cell, because
 * single-cell reads are barcodes and transcripts, not a bulk library. Should both aligners' layouts
 * be present, the one with more matrix files wins.
 */
export function detectDelivery(files: FastqFile[]): DeliveryKind {
  let cr = 0
  let cs = 0
  for (const f of real(files)) {
    const hit = classify(f.path)
    if (hit?.kind === 'cellranger') cr++
    else if (hit?.kind === 'celescope') cs++
  }
  if (!cr && !cs) return 'fastq'
  return cr >= cs ? 'cellranger' : 'celescope'
}

/* ---------- grouping a delivery into libraries ---------- */

const dirOf = (path: string) => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}
const leafOf = (dir: string) => dir.slice(dir.lastIndexOf('/') + 1)
const under = (path: string, folder: string) => !folder || path.startsWith(folder + '/')
const byPath = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** `outs/` is the aligner's folder inside the library, not the library. */
function libraryFolder(container: string): { folder: string; layout: 'flat' | 'outs' } {
  if (container === 'outs') return { folder: '', layout: 'outs' }
  if (container.endsWith('/outs')) return { folder: container.slice(0, -'/outs'.length), layout: 'outs' }
  return { folder: container, layout: 'flat' }
}

interface Building {
  folder: string
  layout: 'flat' | 'outs'
  dirs: Map<string, { which: Which; parts: Set<Part> }>
  h5: Partial<Record<Which, string>>
}

/** Group a delivery's files into libraries, each with its raw and filtered matrices and summary. */
export function scanSingleCell(files: FastqFile[]): ScScan {
  const kept = real(files)
  const kind = detectDelivery(kept)
  const scan: ScScan = {
    kind, libraries: [], other: [], skipped: files.length - kept.length,
    n_files: kept.length, bytes: kept.reduce((a, f) => a + f.size, 0), unsupported: null,
  }
  // Cell Ranger multi writes one raw matrix per GEM well, shared by every sample in it, and each
  // sample's own matrix under per_sample_outs/. Grouped by folder it would read as one library
  // called "count"; refusing by name is better than a request that is quietly wrong.
  if (kind === 'cellranger' && kept.some(f => f.path.split('/').includes('per_sample_outs')))
    scan.unsupported = 'This is Cell Ranger multi output (per_sample_outs/), which this request does not ' +
      'handle yet: its raw matrix is shared by every sample of a GEM well.'
  if (kind === 'fastq') {
    scan.other = kept.map(f => f.path).sort(byPath)
    return scan
  }

  // 1 · the matrices, which are what make a folder a library
  const libs = new Map<string, Building>()
  const matrixFiles = new Set<string>()
  for (const f of kept) {
    const hit = classify(f.path)
    if (!hit || hit.kind !== kind) continue
    matrixFiles.add(f.path)
    const { folder, layout } = libraryFolder(hit.container)
    const lib: Building = libs.get(folder) ?? { folder, layout, dirs: new Map(), h5: {} }
    libs.set(folder, lib)
    if (hit.h5) lib.h5[hit.which] = hit.h5
    if (hit.dir && hit.part) {
      const d = lib.dirs.get(hit.dir) ?? { which: hit.which, parts: new Set<Part>() }
      d.parts.add(hit.part)
      lib.dirs.set(hit.dir, d)
    }
  }

  // 2 · every other file belongs to the deepest library folder holding it, or to none
  const folders = [...libs.keys()].sort((a, b) => b.length - a.length)
  const summary = new Map<string, string[]>(folders.map(f => [f, []]))
  const other = new Map<string, string[]>(folders.map(f => [f, []]))
  const bytes = new Map<string, number>(folders.map(f => [f, 0]))
  for (const f of kept) {
    const folder = folders.find(d => under(f.path, d))
    if (folder === undefined) { scan.other.push(f.path); continue }
    bytes.set(folder, bytes.get(folder)! + f.size)
    if (matrixFiles.has(f.path)) continue
    const at = dirOf(f.path)
    const besideMatrices = at === folder || at === (folder ? folder + '/outs' : 'outs')
    const isSummary = kind === 'cellranger' ? CR_SUMMARY.has(f.name) : CS_SUMMARY.test(f.name)
    const bucket = besideMatrices && isSummary ? summary : other
    bucket.get(folder)!.push(f.path)
  }
  scan.other.sort(byPath)

  // 3 · a library's name is its folder's, unless another library's folder has the same name
  const leafCount = new Map<string, number>()
  for (const folder of folders) leafCount.set(leafOf(folder), (leafCount.get(leafOf(folder)) ?? 0) + 1)

  scan.libraries = [...libs.values()]
    .sort((a, b) => byPath(a.folder, b.folder))
    .map(lib => {
      const problems: string[] = []
      const matrix = (which: Which): ScMatrix => {
        let dir: string | null = null
        for (const [path, d] of lib.dirs) {
          if (d.which !== which) continue
          const missing = PART_NAMES.filter(([part]) => !d.parts.has(part)).map(([, names]) => names[0])
          if (!missing.length) dir = path
          else problems.push(`${lib.folder ? path.slice(lib.folder.length + 1) : path}/ is missing ${missing.join(' and ')}`)
        }
        const m = { matrix_dir: dir, h5: lib.h5[which] ?? null }
        if (!hasMatrix(m)) problems.push(`no ${which} matrix`)
        return m
      }
      const raw = matrix('raw')
      const filtered = matrix('filtered')
      const leaf = leafOf(lib.folder)
      return {
        id: lib.folder || '.',
        label: !leaf ? 'library' : leafCount.get(leaf)! > 1 ? lib.folder : leaf,
        folder: lib.folder,
        layout: lib.layout,
        raw,
        filtered,
        summary: summary.get(lib.folder)!.sort(byPath),
        other: other.get(lib.folder)!.sort(byPath),
        bytes: bytes.get(lib.folder)!,
        problems,
      }
    })
  return scan
}

/**
 * Why step A cannot continue, or null. Every library needs its raw matrix: quality control starts
 * from every droplet, and a delivery without them cannot be analysed from the matrices at all.
 */
export function deliveryBlocker(
  kind: DeliveryKind, libraries: { name: string; raw: ScMatrix }[], unsupported: string | null = null,
): string | null {
  if (unsupported) return unsupported
  if (kind === 'fastq' || !libraries.length) return 'No single-cell library found in that folder.'
  const missing = libraries.filter(l => !hasMatrix(l.raw)).map(l => `“${l.name}”`)
  if (!missing.length) return null
  const ask = kind === 'cellranger' ? 'raw_feature_bc_matrix' : 'outs/raw'
  return `${missing.join(', ')} ${missing.length > 1 ? 'have' : 'has'} no raw matrix. Quality control starts ` +
    `from every droplet, including the empty ones: ask your provider for ${ask}.`
}
