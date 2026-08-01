// Building the two files a customer sends us: the request JSON (full spec) and
// an nf-core-shaped sample sheet that can drive a pipeline directly.

import type { Answers, Contact, FastqFile, Sample, ServiceRequest } from '../types'
import { detectLayout, totalBytes, usedGroups } from './scan.ts'

export const DELIVERABLES: [string, string, string][] = [
  ['deg', 'Differential expression table', 'Log2 fold-change, p-value, adjusted p-value per gene'],
  ['enrich', 'Pathway enrichment', 'GO, KEGG, Hallmark over-representation'],
  ['bundle', 'Interactive Studio bundle', 'Explore results yourself in RNA-seq Studio'],
  ['qc', 'QC report', 'Per-sample read quality, alignment rate, PCA'],
  ['counts', 'Raw + normalised counts', 'Gene-level count matrices (CSV)'],
  ['bam', 'Alignment files (BAM)', 'Large — only if you need them'],
]

export const LABELS: Record<string, Record<string, string>> = {
  organism: {
    human: 'Human (Homo sapiens)', mouse: 'Mouse (Mus musculus)',
    rat: 'Rat (Rattus norvegicus)', other: 'Other',
  },
  library: {
    polya: 'Poly-A selected mRNA', total: 'Total RNA / rRNA-depleted',
    threeprime: "3′-end counting", unsure: 'Not sure — infer from data',
  },
  strand: {
    reverse: 'Stranded, reverse', forward: 'Stranded, forward',
    unstranded: 'Unstranded', unsure: 'Not sure — detect automatically',
  },
  genome: {
    latest: 'Latest standard build', specific: 'Specific build', unsure: 'Not sure — use latest',
  },
  turnaround: {
    standard: 'Standard (10 working days)', priority: 'Priority (4 working days)',
    flexible: 'Flexible',
  },
}

export const label = (k: string, v: string) => LABELS[k]?.[v] ?? ''

export const deliverableName = (k: string) => DELIVERABLES.find(d => d[0] === k)?.[1] ?? k

export function makeRequestId(now = Date.now()) {
  return 'R' + now.toString(36).toUpperCase().slice(-6)
}

export function buildRequest(
  id: string, files: FastqFile[], samples: Sample[], a: Answers, c: Contact, createdISO: string,
): ServiceRequest {
  const groups = usedGroups(samples)
  return {
    request_id: id,
    created: createdISO,
    contact: {
      name: c.name, email: c.email, org: c.org,
      project: c.project, turnaround: c.turnaround, notes: c.notes,
    },
    data: {
      n_fastq: files.length,
      total_bytes: totalBytes(files),
      layout: a.layout || detectLayout(samples),
      samples: samples.map(s => ({
        sample: s.name,
        condition: s.condition,
        files: s.files.map(f => ({ file: f.name, path: f.path, read: f.read, bytes: f.size })),
      })),
    },
    design: {
      groups,
      control: a.control,
      contrasts: groups.filter(g => g !== a.control).map(g => ({ numerator: g, denominator: a.control })),
      paired_design: a.paired === 'yes',
    },
    protocol: {
      organism: a.organism === 'other' ? a.organismOther : a.organism,
      library: a.library,
      strandedness: a.strand,
      genome: a.genome === 'specific' ? a.genomeOther : a.genome,
    },
    deliverables: a.deliver,
    question: a.question,
  }
}

/** nf-core/rnaseq-shaped sample sheet: sample,condition,fastq_1[,fastq_2]. */
export function buildSampleSheet(samples: Sample[], layout: string): string {
  const pe = layout === 'paired'
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = pe ? 'sample,condition,fastq_1,fastq_2' : 'sample,condition,fastq_1'
  const rows = samples.map(s => {
    const r1 = s.files.find(f => f.read === 1) ?? s.files[0]
    const r2 = s.files.find(f => f.read === 2)
    const cells = pe
      ? [s.name, s.condition, r1?.path ?? '', r2?.path ?? '']
      : [s.name, s.condition, r1?.path ?? '']
    return cells.map(q).join(',')
  })
  return [header, ...rows].join('\n') + '\n'
}

export function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 800)
}
