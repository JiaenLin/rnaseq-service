import type { FastqFile } from '../types'

// A realistic core-facility delivery: the folder name carries the species and the
// kit, which is exactly what the inference step reads.
const ROOT = '250312_NovaSeq_Mouse_Brain_mRNAseq'
const NAMES = ['WT_1', 'WT_2', 'WT_3', 'KO_1', 'KO_2', 'KO_3']

export function demoFiles(): FastqFile[] {
  const out: FastqFile[] = []
  NAMES.forEach((n, i) =>
    [1, 2].forEach(r =>
      out.push({
        name: `${n}_S${i + 1}_L001_R${r}_001.fastq.gz`,
        path: `${ROOT}/${n}/${n}_S${i + 1}_L001_R${r}_001.fastq.gz`,
        size: 2.1e9 + i * 7e7 + r * 3e6,
      }),
    ),
  )
  // Non-FASTQ files that always ride along in a delivery — these get filtered out.
  out.push({ name: 'md5sum.txt', path: `${ROOT}/md5sum.txt`, size: 2048 })
  out.push({ name: 'RunInfo.xml', path: `${ROOT}/RunInfo.xml`, size: 8192 })
  return out
}

export const demoCondition = (sampleName: string) => (sampleName.startsWith('WT') ? 'Control' : 'Treated')
