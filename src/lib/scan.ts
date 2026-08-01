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

/**
 * Split a FASTQ filename into the sample stem, read number and lane.
 * Covers the conventions that actually turn up in deliveries:
 *   Sample_S1_L001_R1_001.fastq.gz   bcl2fastq / BCL Convert
 *   Sample_L001_R1.fastq.gz          simplified Illumina
 *   Sample_R1.fq.gz                  most core facilities
 *   Sample_1.fq.gz                   SRA / BGI
 */
export function parseFastq(name: string): { stem: string; lane: string | null; read: 1 | 2 | null } {
  const base = name.replace(FASTQ_RX, '')
  let m: RegExpMatchArray | null

  if ((m = base.match(/^(.*?)_S\d+(?:_L(\d{3}))?_R([12])(?:_\d{3})?$/i)))
    return { stem: m[1], lane: m[2] ?? null, read: Number(m[3]) as 1 | 2 }
  if ((m = base.match(/^(.*?)(?:_L(\d{3}))?_R([12])(?:_\d{3})?$/i)))
    return { stem: m[1], lane: m[2] ?? null, read: Number(m[3]) as 1 | 2 }
  if ((m = base.match(/^(.*?)(?:_L(\d{3}))?[._]([12])$/)))
    return { stem: m[1], lane: m[2] ?? null, read: Number(m[3]) as 1 | 2 }

  return { stem: base, lane: null, read: null }
}

/** Group files into samples, preserving any names/conditions already set. */
export function buildSamples(files: FastqFile[], pairing: Pairing, prev: Sample[] = []): Sample[] {
  const before = new Map(prev.map(s => [s.id, s]))
  const by = new Map<string, SampleFile[]>()

  for (const f of files) {
    const p = parseFastq(f.name)
    const id = pairing === 'one' ? f.name : (p.stem || f.name)
    const entry: SampleFile = { ...f, read: pairing === 'one' ? null : p.read, lane: p.lane }
    const list = by.get(id)
    if (list) list.push(entry)
    else by.set(id, [entry])
  }

  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([id, group]) => {
      group.sort((a, b) => (a.read ?? 0) - (b.read ?? 0) || a.name.localeCompare(b.name))
      const old = before.get(id)
      return { id, name: old?.name ?? id, condition: old?.condition ?? '', files: group }
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
  if (entry.isFile) {
    const fe = entry as FileSystemFileEntry
    const f = await new Promise<File>((res, rej) => fe.file(res, rej))
    sink.push({ name: entry.name, path: prefix + entry.name, size: f.size })
  } else if (entry.isDirectory) {
    const de = entry as FileSystemDirectoryEntry
    for (const kid of await readAllEntries(de.createReader()))
      await walk(kid, prefix + entry.name + '/', sink)
  }
}

/** Walk a drop, recursing into folders when the browser exposes them. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<FastqFile[]> {
  const sink: FastqFile[] = []
  const entries = [...dt.items]
    .map(i => i.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => !!e)

  if (entries.length) for (const e of entries) await walk(e, '', sink)
  else for (const f of dt.files) sink.push({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size })

  return sink
}

export const filesFromInput = (list: FileList): FastqFile[] =>
  [...list].map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, size: f.size }))
