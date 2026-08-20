// Finding FASTQ files in a delivered sequencing folder and grouping them into
// samples. Everything here runs on file *names* — file contents are never read.

import type { FastqFile, Layout, Pairing, Sample, SampleFile } from '../types'

export const FASTQ_RX = /\.(fastq|fq)(\.gz|\.bz2)?$/i

export const isFastq = (name: string) => FASTQ_RX.test(name)

export function fmtSize(b: number): string {
  if (b >= 1e12) return (b / 1e12).toFixed(1) + ' TB'
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB'
  return (b / 1e3).toFixed(0) + ' KB'
}

/* ---------- what the operating system leaves behind ---------- */

/**
 * Bookkeeping files that are not sequencing data. The one that actually breaks
 * scans is the macOS AppleDouble sidecar: copying a delivery onto an exFAT
 * drive or an SMB share writes a 4 KB `._Sample.R1.raw.fastq.gz` beside every
 * real file. Those sidecars end in `.fastq.gz`, so a 38-file paired delivery
 * scans as 76 files and 76 single-end "samples" — the numbers look plausible
 * and the mistake is silent. Drop them before anything else looks at the list.
 */
const JUNK_NAMES = new Set([
  '.ds_store', '.spotlight-v100', '.trashes', '.fseventsd', '.temporaryitems',
  '.documentrevisions-v100', '.apdisk', '.appledouble', '.appledb', '.appledesktop',
  '__macosx', 'thumbs.db', 'desktop.ini', '$recycle.bin', 'system volume information',
])

export const isJunkName = (name: string) =>
  name.startsWith('._') || JUNK_NAMES.has(name.toLowerCase())

/** True when any component of the path is OS bookkeeping rather than data. */
export const isJunk = (path: string) => path.split('/').some(seg => seg && isJunkName(seg))

/* ---------- filename conventions ---------- */

const SEP = '[._-]'

/**
 * Suffixes providers append *after* the read tag, and the bcl2fastq `_001`
 * chunk index. Only stripped when a read tag was found, so a delivery that
 * ships `01.RawData/` and `02.CleanData/` side by side keeps them apart when
 * the names carry no read tag at all.
 */
const TAIL = `(?:${SEP}(?:raw|clean|filter(?:ed)?|trim(?:med)?|good|val${SEP}?[12]|\\d{3}))*`

/**
 * Lane, in its two unambiguous zero-padded forms: `L001` (Illumina/bcl2fastq)
 * and `L01` (MGI / DNBSEQ-T7). A single digit is deliberately not accepted —
 * `Sample_L2_R1.fq.gz` is far more likely to be cell line 2 than lane 2, and
 * merging two cell lines into one sample is a silent error, whereas listing
 * two lanes as two samples is one the customer can see and fix.
 */
const LANE = `(?:${SEP}L(\\d{2,3}))?`

/**
 * Split a FASTQ filename into the sample stem, read number and lane.
 * Covers the conventions that actually turn up in deliveries:
 *   Sample_S1_L001_R1_001.fastq.gz   bcl2fastq / BCL Convert
 *   Sample_L001_R1.fastq.gz          simplified Illumina
 *   Sample_R1.fq.gz                  most core facilities
 *   Sample.R1.raw.fastq.gz           MGI / DNBSEQ-T7 deliveries
 *   V350012345_L01_read_1.fq.gz      MGI raw lane split
 *   Sample_1.clean.fq.gz             SRA / BGI / Novogene
 */
const RX_BCL = new RegExp(`^(.*?)_S\\d+${LANE}${SEP}R([12])${TAIL}$`, 'i')
const RX_READ = new RegExp(`^(.*?)${LANE}${SEP}(?:R|read${SEP}?)([12])${TAIL}$`, 'i')
// The bare-number form keeps to `_1` / `.1`: `-1` is a construct number far
// more often than a read number ("shArf1-1" is not replicate 1 of "shArf1").
const RX_NUM = new RegExp(`^(.*?)${LANE}[._]([12])${TAIL}$`, 'i')

export function parseFastq(name: string): { stem: string; lane: string | null; read: 1 | 2 | null } {
  const base = name.replace(FASTQ_RX, '')

  for (const rx of [RX_BCL, RX_READ, RX_NUM]) {
    const m = base.match(rx)
    if (m) return { stem: m[1], lane: m[2] ?? null, read: Number(m[3]) as 1 | 2 }
  }
  return { stem: base, lane: null, read: null }
}

/* ---------- grouping files into samples ---------- */

const dirOf = (path: string) => {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}
const leafOf = (dir: string) => dir.slice(dir.lastIndexOf('/') + 1)

/**
 * Sample identity, per file.
 *
 * Normally the filename stem is the identity. But some deliveries — MGI/T7 raw
 * data especially — give every sample a folder and reuse one flowcell-derived
 * filename inside it:
 *   Sample_E1/V350012345_L01_read_1.fq.gz
 *   Sample_E2/V350012345_L01_read_1.fq.gz
 * Keying on the stem there collapses the whole run into a single sample. When
 * a stem is claimed by two files of the *same* name, the name cannot be the
 * identity and the folder is used instead. Multi-lane files inside one folder
 * still differ by name, so they keep merging as they should.
 */
function identify(files: FastqFile[]): Map<string, { id: string; label: string }> {
  const stems = new Map<string, string>()
  const nameCount = new Map<string, Map<string, number>>()

  for (const f of files) {
    const stem = parseFastq(f.name).stem || f.name
    stems.set(f.path, stem)
    const seen = nameCount.get(stem) ?? new Map<string, number>()
    seen.set(f.name, (seen.get(f.name) ?? 0) + 1)
    nameCount.set(stem, seen)
  }

  const ambiguous = new Set(
    [...nameCount].filter(([, seen]) => [...seen.values()].some(n => n > 1)).map(([stem]) => stem),
  )

  // The folder's own name reads better than its whole path — use it when no
  // two folders in the delivery share it.
  const pathsByLeaf = new Map<string, Set<string>>()
  for (const f of files) {
    if (!ambiguous.has(stems.get(f.path)!)) continue
    const dir = dirOf(f.path)
    const set = pathsByLeaf.get(leafOf(dir)) ?? new Set<string>()
    set.add(dir)
    pathsByLeaf.set(leafOf(dir), set)
  }

  const out = new Map<string, { id: string; label: string }>()
  for (const f of files) {
    const stem = stems.get(f.path)!
    if (!ambiguous.has(stem)) { out.set(f.path, { id: stem, label: stem }); continue }
    const dir = dirOf(f.path)
    const leaf = leafOf(dir)
    const id = leaf && pathsByLeaf.get(leaf)!.size === 1 ? leaf : (dir || stem)
    out.set(f.path, { id, label: id })
  }
  return out
}

/** Group files into samples, preserving any names/conditions already set. */
export function buildSamples(files: FastqFile[], pairing: Pairing, prev: Sample[] = []): Sample[] {
  const before = new Map(prev.map(s => [s.id, s]))
  const ident = identify(files)
  // With one sample per file the path is the only safe key: the same filename
  // can appear in every per-sample folder of a delivery.
  const dupName = new Set(
    files.map(f => f.name).filter((n, i, all) => all.indexOf(n) !== i),
  )

  const by = new Map<string, { label: string; files: SampleFile[] }>()

  for (const f of files) {
    const p = parseFastq(f.name)
    const one = pairing === 'one'
    const id = one ? f.path : ident.get(f.path)!.id
    const label = one
      ? (dupName.has(f.name) ? `${leafOf(dirOf(f.path))}/${f.name}` : f.name)
      : ident.get(f.path)!.label
    const entry: SampleFile = { ...f, read: one ? null : p.read, lane: p.lane }
    const group = by.get(id)
    if (group) group.files.push(entry)
    else by.set(id, { label, files: [entry] })
  }

  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([id, group]) => {
      group.files.sort((a, b) => (a.read ?? 0) - (b.read ?? 0) || a.name.localeCompare(b.name))
      const old = before.get(id)
      return {
        id,
        name: old?.name ?? group.label,
        condition: old?.condition ?? '',
        files: group.files,
      }
    })
}

export const sampleLayout = (s: Sample): 'paired' | 'single' =>
  s.files.some(f => f.read === 2) ? 'paired' : 'single'

export function detectLayout(samples: Sample[]): Layout {
  if (!samples.length) return 'single'
  if (samples.every(s => sampleLayout(s) === 'paired')) return 'paired'
  if (samples.some(s => sampleLayout(s) === 'paired')) return 'mixed'
  return 'single'
}

export const totalBytes = (files: FastqFile[]) => files.reduce((a, f) => a + f.size, 0)

export const usedGroups = (samples: Sample[]) =>
  [...new Set(samples.map(s => s.condition).filter(Boolean))]

/* ---------- reading a dropped or picked folder ---------- */

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const out: FileSystemEntry[] = []
  for (;;) {
    // readEntries yields at most 100 per call — keep going until it returns none.
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
    if (!batch.length) return out
    out.push(...batch)
  }
}

async function walk(entry: FileSystemEntry, prefix: string, sink: FastqFile[]): Promise<void> {
  // Skipping junk during the walk matters as much as filtering it later: a
  // `__MACOSX` tree mirrors the whole delivery, and every sidecar in it costs
  // a round trip through the FileSystem API.
  if (isJunkName(entry.name)) return

  if (entry.isFile) {
    const fe = entry as FileSystemFileEntry
    const f = await new Promise<File>((res, rej) => fe.file(res, rej))
    sink.push({ name: entry.name, path: prefix + entry.name, size: f.size })
  } else if (entry.isDirectory) {
    const de = entry as FileSystemDirectoryEntry
    const kids = await readAllEntries(de.createReader())
    // A delivery is thousands of files deep; walking them serially is what
    // makes the drop feel stuck.
    await Promise.all(kids.map(kid => walk(kid, prefix + entry.name + '/', sink)))
  }
}

/** Walk a drop, recursing into folders when the browser exposes them. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<FastqFile[]> {
  const sink: FastqFile[] = []
  const entries = [...dt.items]
    .map(i => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e)

  if (entries.length) await Promise.all(entries.map(e => walk(e, '', sink)))
  else for (const f of dt.files) sink.push({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size })

  return sink
}

export const filesFromInput = (list: FileList): FastqFile[] =>
  [...list].map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size }))
