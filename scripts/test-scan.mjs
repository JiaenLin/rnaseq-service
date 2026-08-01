// Regression tests for FASTQ detection, read-pair grouping and the sample sheet.
// Runs the real modules via Node's built-in TypeScript type-stripping.
import { buildSamples, detectLayout, isFastq, parseFastq } from '../src/lib/scan.ts'
import { buildSampleSheet } from '../src/lib/request.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

console.log('\nWHICH FILES COUNT AS FASTQ')
for (const n of ['a.fastq', 'a.fq', 'a.fastq.gz', 'a.fq.gz', 'a.FASTQ.GZ'])
  check(`${n} -> yes`, isFastq(n), true)
for (const n of ['md5sum.txt', 'RunInfo.xml', 'a.bam', 'a.fastq.gz.md5', 'notes.fq.txt'])
  check(`${n} -> no`, isFastq(n), false)

console.log('\nFILENAME CONVENTIONS')
const stem = n => { const p = parseFastq(n); return [p.stem, p.read, p.lane] }
check('bcl2fastq', stem('Sample_S1_L001_R1_001.fastq.gz'), ['Sample', 1, '001'])
check('bcl2fastq R2', stem('Sample_S12_L002_R2_001.fastq.gz'), ['Sample', 2, '002'])
check('no lane', stem('Sample_S1_R1_001.fastq.gz'), ['Sample', 1, null])
check('simple Illumina', stem('Sample_L001_R1.fastq.gz'), ['Sample', 1, '001'])
check('core facility', stem('Sample_R1.fq.gz'), ['Sample', 1, null])
check('SRA / BGI', stem('Sample_1.fq.gz'), ['Sample', 1, null])
check('dot separator', stem('Sample.2.fq.gz'), ['Sample', 2, null])
check('underscores in name', stem('NR4A2_KO_rep3_R2.fastq.gz'), ['NR4A2_KO_rep3', 2, null])
check('single-end, no read tag', stem('SampleX.fastq.gz'), ['SampleX', null, null])

console.log('\nGROUPING FILES INTO SAMPLES')
const mk = (...names) => names.map(n => ({ name: n, path: `run/${n}`, size: 1e9 }))
{
  const s = buildSamples(mk(
    'A_S1_L001_R1_001.fastq.gz', 'A_S1_L001_R2_001.fastq.gz',
    'B_S2_L001_R1_001.fastq.gz', 'B_S2_L001_R2_001.fastq.gz',
  ), 'auto')
  check('2 samples from 4 files', s.map(x => x.id), ['A', 'B'])
  check('R1 sorts before R2', s[0].files.map(f => f.read), [1, 2])
  check('layout = paired', detectLayout(s), 'paired')
}
{
  // Multi-lane deliveries: both lanes belong to the same sample.
  const s = buildSamples(mk(
    'A_S1_L001_R1_001.fastq.gz', 'A_S1_L002_R1_001.fastq.gz',
  ), 'auto')
  check('lanes merge into one sample', s.length, 1)
  check('both lane files kept', s[0].files.length, 2)
  check('layout = single', detectLayout(s), 'single')
}
{
  const s = buildSamples(mk('A_R1.fq.gz', 'A_R2.fq.gz', 'B_R1.fq.gz'), 'auto')
  check('mixed layout detected', detectLayout(s), 'mixed')
}
{
  const files = mk('A_R1.fq.gz', 'A_R2.fq.gz')
  check('pairing="one" splits every file', buildSamples(files, 'one').length, 2)
}
{
  // Renames and group assignments must survive a re-scan.
  const files = mk('A_R1.fq.gz', 'A_R2.fq.gz')
  const first = buildSamples(files, 'auto').map(s => ({ ...s, name: 'Renamed', condition: 'Control' }))
  const again = buildSamples([...files, ...mk('B_R1.fq.gz')], 'auto', first)
  check('rename preserved on re-scan', again.find(s => s.id === 'A').name, 'Renamed')
  check('group preserved on re-scan', again.find(s => s.id === 'A').condition, 'Control')
  check('new sample starts unassigned', again.find(s => s.id === 'B').condition, '')
}

console.log('\nSAMPLE SHEET (nf-core shape)')
{
  const samples = buildSamples(mk('A_R1.fq.gz', 'A_R2.fq.gz'), 'auto')
    .map(s => ({ ...s, name: 'WT_1', condition: 'Control' }))
  check('paired header + row',
    buildSampleSheet(samples, 'paired'),
    'sample,condition,fastq_1,fastq_2\nWT_1,Control,run/A_R1.fq.gz,run/A_R2.fq.gz\n')
  check('single-end drops fastq_2',
    buildSampleSheet(samples, 'single'),
    'sample,condition,fastq_1\nWT_1,Control,run/A_R1.fq.gz\n')
}
{
  // A comma in a sample name must not break the CSV.
  const samples = buildSamples(mk('A_R1.fq.gz'), 'auto')
    .map(s => ({ ...s, name: 'WT,odd', condition: 'Control' }))
  check('comma in name is quoted',
    buildSampleSheet(samples, 'single'),
    'sample,condition,fastq_1\n"WT,odd",Control,run/A_R1.fq.gz\n')
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll scan tests passed\n')
process.exit(failed ? 1 : 0)
