// Regression tests for FASTQ detection, read-pair grouping and the sample sheet.
// Runs the real modules via Node's built-in TypeScript type-stripping.
import { buildSamples, detectLayout, isFastq, isJunk, parseFastq } from '../src/lib/scan.ts'
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

console.log('\nMGI / DNBSEQ-T7 CONVENTIONS')
check('dot-separated R tag + .raw', stem('L1MLG2101985-E1.R1.raw.fastq.gz'), ['L1MLG2101985-E1', 1, null])
check('dot-separated R2', stem('L1MLG2101985-E1.R2.raw.fastq.gz'), ['L1MLG2101985-E1', 2, null])
check('.clean suffix', stem('E1.R1.clean.fq.gz'), ['E1', 1, null])
check('MGI lane + read_N', stem('V350012345_L01_read_1.fq.gz'), ['V350012345', 1, '01'])
check('MGI lane + bare number', stem('V350012345_L01_2.fq.gz'), ['V350012345', 2, '01'])
check('Novogene clean data', stem('E1_CKDL220_HH5V7_1.clean.fq.gz'), ['E1_CKDL220_HH5V7', 1, null])
check('hyphen before R tag', stem('Sample-R1.fq.gz'), ['Sample', 1, null])
// A single-digit L is a cell line far more often than a lane — leave it in the
// stem rather than silently merging two lines into one sample.
check('single-digit L stays in the stem', stem('Sample_L2_R1.fq.gz'), ['Sample_L2', 1, null])
check('trim_galore output', stem('Sample_R1_val_1.fq.gz'), ['Sample', 1, null])

console.log('\nOPERATING-SYSTEM JUNK')
for (const p of [
  'run/._E1.R1.raw.fastq.gz', 'run/.DS_Store', '__MACOSX/run/._E1.R1.raw.fastq.gz',
  'run/Thumbs.db', 'run/.Spotlight-V100/store', 'run/desktop.ini',
]) check(`${p} -> junk`, isJunk(p), true)
for (const p of ['run/E1.R1.raw.fastq.gz', 'run/md5.txt', 'a.b_.c/E1_R1.fq.gz'])
  check(`${p} -> keep`, isJunk(p), false)

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

{
  // The T7 delivery that broke: 19 paired samples, plus a macOS AppleDouble
  // sidecar per file from a round trip through an exFAT drive. Junk filtering
  // is the caller's job, so this asserts the two halves separately.
  const real = []
  for (let i = 1; i <= 19; i++)
    for (const r of [1, 2])
      real.push(`L1MLG21019${84 + i}-E${i}.R${r}.raw.fastq.gz`)
  const withJunk = [...real, ...real.map(n => '._' + n)]
  check('sidecars are recognised', withJunk.filter(n => isJunk(`run/${n}`)).length, 19 * 2)

  const s = buildSamples(mk(...real), 'auto')
  check('19 samples from 38 files', s.length, 19)
  check('layout = paired', detectLayout(s), 'paired')
  check('first sample id', s[0].id, 'L1MLG2101985-E1')
  check('R1 + R2 under one sample', s[0].files.map(f => f.read), [1, 2])
}
{
  // MGI raw data: one folder per sample, the same flowcell filename inside
  // each. The folder is the only thing that tells them apart.
  const files = ['E1', 'E2', 'E3'].flatMap(d => [1, 2].map(r => ({
    name: `V350012345_L01_read_${r}.fq.gz`,
    path: `Rawdata/${d}/V350012345_L01_read_${r}.fq.gz`,
    size: 1e9,
  })))
  const s = buildSamples(files, 'auto')
  check('per-sample folders do not collapse', s.map(x => x.id), ['E1', 'E2', 'E3'])
  check('each folder keeps its pair', s[0].files.map(f => f.read), [1, 2])
  check('layout = paired', detectLayout(s), 'paired')

  const one = buildSamples(files, 'one')
  check('one-per-file keeps repeated names apart', one.length, 6)
  check('and disambiguates the label', one[0].name, 'E1/V350012345_L01_read_1.fq.gz')
}
{
  // Lanes inside a single folder still merge — names differ, so nothing is
  // ambiguous and the stem stays the identity.
  const s = buildSamples(mk(
    'A_S1_L001_R1_001.fastq.gz', 'A_S1_L001_R2_001.fastq.gz',
    'A_S1_L002_R1_001.fastq.gz', 'A_S1_L002_R2_001.fastq.gz',
  ), 'auto')
  check('4 lane files, 1 sample', s.map(x => x.id), ['A'])
  check('lanes recorded', s[0].files.map(f => f.lane), ['001', '002', '001', '002'])
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
