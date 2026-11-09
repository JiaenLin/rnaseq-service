// Recognising a single-cell delivery from file names, and grouping it into libraries.
// Runs the real src/lib/scDelivery.ts via Node's built-in TypeScript type-stripping.
//
// The file lists are synthetic, in the three layouts single-cell deliveries actually arrive in:
// Cell Ranger outs flattened by the provider into one folder per library, Cell Ranger's own
// `<library>/outs/`, and CeleScope nested one folder deeper, `<s>/<s>/outs/{raw,filtered}`.
// The sample names are neutral. Only names and sizes exist here, which is all the app ever reads.
import { demoFiles } from '../src/lib/demo.ts'

let mod = {}
try {
  mod = await import('../src/lib/scDelivery.ts')
} catch (e) {
  console.log(`\n  (src/lib/scDelivery.ts did not load: ${e.code ?? e.message})`)
}
const { detectDelivery, scanSingleCell, deliveryBlocker } = mod

let failed = 0
// `got` is a thunk, so that a missing function or a throw is one failed check, not a crash.
const check = (name, got, want) => {
  let value
  try { value = got() } catch (e) { value = `threw: ${e.message}` }
  const ok = JSON.stringify(value) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(value)}\n        want ${JSON.stringify(want)}`}`)
}

const MB = 1e6
const at = (dir, rels, size = MB) => rels.map(r => ({ name: r.split('/').pop(), path: `${dir}/${r}`, size }))

const TRIPLET = ['barcodes.tsv.gz', 'features.tsv.gz', 'matrix.mtx.gz']
const CR_DIRS = [
  ...TRIPLET.map(f => `raw_feature_bc_matrix/${f}`),
  ...TRIPLET.map(f => `filtered_feature_bc_matrix/${f}`),
]
const CR_H5 = ['raw_feature_bc_matrix.h5', 'filtered_feature_bc_matrix.h5']

// Cell Ranger outs, flattened by the provider: one folder per library, no outs/ level.
const crFlat = [
  ...['LibA', 'LibB', 'LibC', 'LibD'].flatMap(l =>
    at(`delivery/${l}`, [...CR_DIRS, ...CR_H5, 'molecule_info.h5', 'web_summary.html'])),
  ...at('delivery', ['README.pdf', 'summary.xls']),
]

// Cell Ranger's own layout: <library>/outs/...
const crOuts = ['S1', 'S2'].flatMap(s =>
  at(`run/${s}/outs`, [...CR_DIRS, ...CR_H5, 'metrics_summary.csv', 'web_summary.html',
    'possorted_genome_bam.bam', 'cloupe.cloupe']))

// CeleScope, nested one folder deeper by the provider: <s>/<s>/outs/{raw,filtered}
const celeNested = ['S1', 'S2', 'S3'].flatMap(s => [
  ...at(`matrices/${s}/${s}`, [
    ...TRIPLET.map(f => `outs/raw/${f}`), ...TRIPLET.map(f => `outs/filtered/${f}`),
    `${s}_report.html`, `outs/${s}_Aligned.sortedByCoord.out.bam`,
  ]),
])

console.log('\nWHICH KIND OF DELIVERY')
check('the bulk demo (FASTQ) -> fastq', () => detectDelivery(demoFiles()), 'fastq')
check('MGI folders of FASTQ -> fastq', () => detectDelivery(['E1', 'E2'].flatMap(d =>
  at(`Rawdata/${d}`, ['V350012345_L01_read_1.fq.gz', 'V350012345_L01_read_2.fq.gz']))), 'fastq')
check('FASTQ inside a folder named outs/raw -> fastq (no matrix, no single cells)',
  () => detectDelivery(at('x/outs/raw', ['A_R1.fastq.gz', 'A_R2.fastq.gz', 'barcodes.txt'])), 'fastq')
check('nothing recognisable -> fastq (the bulk path, exactly as before)',
  () => detectDelivery(at('docs', ['notes.pdf', 'plan.xlsx'])), 'fastq')
check('an empty drop -> fastq', () => detectDelivery([]), 'fastq')
check('Cell Ranger, flat -> cellranger', () => detectDelivery(crFlat), 'cellranger')
check('Cell Ranger, under outs/ -> cellranger', () => detectDelivery(crOuts), 'cellranger')
check('Cell Ranger, h5 files only -> cellranger', () => detectDelivery(at('d/S1/outs', CR_H5)), 'cellranger')
check('Cell Ranger outs with the FASTQ alongside -> cellranger (single-cell reads are not a bulk library)',
  () => detectDelivery([...crOuts, ...at('fastq', ['S1_S1_L001_R1_001.fastq.gz', 'S1_S1_L001_R2_001.fastq.gz'])]),
  'cellranger')
check('CeleScope, <s>/<s>/outs/{raw,filtered} -> celescope', () => detectDelivery(celeNested), 'celescope')
check('CeleScope, <s>/outs/{raw,filtered} -> celescope',
  () => detectDelivery(at('cs/S1', TRIPLET.map(f => `outs/raw/${f}`))), 'celescope')
check('macOS sidecars of matrix files alone -> fastq',
  () => detectDelivery(at('d/S1', ['._raw_feature_bc_matrix.h5', 'raw_feature_bc_matrix/._matrix.mtx.gz'])), 'fastq')

console.log('\nCELL RANGER, FLAT: ONE FOLDER PER LIBRARY')
{
  const lib = name => () => scanSingleCell(crFlat).libraries.find(l => l.label === name)
  const A = lib('LibA')
  check('4 libraries, keyed by folder', () => scanSingleCell(crFlat).libraries.map(l => l.id),
    ['delivery/LibA', 'delivery/LibB', 'delivery/LibC', 'delivery/LibD'])
  check('named after the folder', () => scanSingleCell(crFlat).libraries.map(l => l.label),
    ['LibA', 'LibB', 'LibC', 'LibD'])
  check('layout = flat', () => A().layout, 'flat')
  check('raw matrix folder', () => A().raw.matrix_dir, 'delivery/LibA/raw_feature_bc_matrix')
  check('raw h5', () => A().raw.h5, 'delivery/LibA/raw_feature_bc_matrix.h5')
  check('filtered matrix folder', () => A().filtered.matrix_dir, 'delivery/LibA/filtered_feature_bc_matrix')
  check('filtered h5', () => A().filtered.h5, 'delivery/LibA/filtered_feature_bc_matrix.h5')
  check('summary', () => A().summary, ['delivery/LibA/web_summary.html'])
  check('the rest of the library is listed, not lost', () => A().other, ['delivery/LibA/molecule_info.h5'])
  check('a complete library has no problems', () => A().problems, [])
  check('bytes = every file in the library', () => A().bytes, 10 * MB)
  check("the provider's own files sit outside every library",
    () => scanSingleCell(crFlat).other, ['delivery/README.pdf', 'delivery/summary.xls'])
  check('kind', () => scanSingleCell(crFlat).kind, 'cellranger')
  check('files and bytes read', () => [scanSingleCell(crFlat).n_files, scanSingleCell(crFlat).bytes], [42, 42 * MB])
}

console.log('\nCELL RANGER, UNDER outs/')
{
  const S1 = () => scanSingleCell(crOuts).libraries[0]
  check('outs/ is not the library: the folder above it is', () => scanSingleCell(crOuts).libraries.map(l => l.id),
    ['run/S1', 'run/S2'])
  check('named S1, S2', () => scanSingleCell(crOuts).libraries.map(l => l.label), ['S1', 'S2'])
  check('layout = outs', () => S1().layout, 'outs')
  check('raw matrix folder', () => S1().raw.matrix_dir, 'run/S1/outs/raw_feature_bc_matrix')
  check('filtered h5', () => S1().filtered.h5, 'run/S1/outs/filtered_feature_bc_matrix.h5')
  check('both summaries, in name order', () => S1().summary,
    ['run/S1/outs/metrics_summary.csv', 'run/S1/outs/web_summary.html'])
  check('BAM and Loupe file kept as other', () => S1().other,
    ['run/S1/outs/cloupe.cloupe', 'run/S1/outs/possorted_genome_bam.bam'])
}

console.log('\nCELESCOPE, NESTED <s>/<s>/outs/{raw,filtered}')
{
  const S1 = () => scanSingleCell(celeNested).libraries[0]
  check('3 libraries, keyed by the inner folder', () => scanSingleCell(celeNested).libraries.map(l => l.id),
    ['matrices/S1/S1', 'matrices/S2/S2', 'matrices/S3/S3'])
  check('named S1, S2, S3', () => scanSingleCell(celeNested).libraries.map(l => l.label), ['S1', 'S2', 'S3'])
  check('raw = outs/raw', () => S1().raw, { matrix_dir: 'matrices/S1/S1/outs/raw', h5: null })
  check('filtered = outs/filtered', () => S1().filtered, { matrix_dir: 'matrices/S1/S1/outs/filtered', h5: null })
  check('summary = the CeleScope report', () => S1().summary, ['matrices/S1/S1/S1_report.html'])
  check('BAM kept as other', () => S1().other, ['matrices/S1/S1/outs/S1_Aligned.sortedByCoord.out.bam'])
  check('kind', () => scanSingleCell(celeNested).kind, 'celescope')
}

console.log('\nA MATRIX IS THREE FILES, OR ONE h5')
{
  const partial = [
    ...at('run/S1/outs', ['raw_feature_bc_matrix/barcodes.tsv.gz', 'raw_feature_bc_matrix/matrix.mtx.gz',
      ...TRIPLET.map(f => `filtered_feature_bc_matrix/${f}`)]),
  ]
  const S1 = () => scanSingleCell(partial).libraries[0]
  check('an incomplete folder is not a matrix', () => S1().raw, { matrix_dir: null, h5: null })
  check('and the missing file is named', () => S1().problems.some(p => /raw_feature_bc_matrix.*features\.tsv\.gz/.test(p)), true)
  check('no raw matrix is said in so many words', () => S1().problems.some(p => /no raw matrix/.test(p)), true)
  check('the complete filtered folder still counts', () => S1().filtered.matrix_dir, 'run/S1/outs/filtered_feature_bc_matrix')

  const h5only = () => scanSingleCell(at('d/S1/outs', CR_H5)).libraries[0]
  check('h5 files alone make a complete library', () => [h5only().raw.h5, h5only().filtered.h5, h5only().problems],
    ['d/S1/outs/raw_feature_bc_matrix.h5', 'd/S1/outs/filtered_feature_bc_matrix.h5', []])

  const older = () => scanSingleCell(at('cs/S1/outs/raw', ['barcodes.tsv', 'genes.tsv', 'matrix.mtx'])).libraries[0]
  check('uncompressed, with genes.tsv for features', () => older().raw.matrix_dir, 'cs/S1/outs/raw')
  check('a missing filtered matrix is noted', () => older().problems, ['no filtered matrix'])
}

console.log('\nIDENTITY AND BOOKKEEPING')
{
  // Two runs that each hold a library folder called S1: the folder name cannot be the name.
  const twice = [...at('run1/S1/outs', CR_H5), ...at('run2/S1/outs', CR_H5)]
  check('a shared folder name falls back to the path', () => scanSingleCell(twice).libraries.map(l => l.label),
    ['run1/S1', 'run2/S1'])

  const sidecars = [...crOuts, ...at('run/S1/outs', ['._web_summary.html', 'raw_feature_bc_matrix/._matrix.mtx.gz', '.DS_Store'])]
  check('sidecars are skipped and counted', () => scanSingleCell(sidecars).skipped, 3)
  check('and change nothing else', () => JSON.stringify(scanSingleCell(sidecars).libraries)
    === JSON.stringify(scanSingleCell(crOuts).libraries), true)

  const withFastq = [...crOuts, ...at('fastq', ['S1_S1_L001_R1_001.fastq.gz'])]
  check('FASTQ beside the outs are set aside, not made into a library',
    () => [scanSingleCell(withFastq).libraries.length, scanSingleCell(withFastq).other],
    [2, ['fastq/S1_S1_L001_R1_001.fastq.gz']])

  check('a FASTQ delivery gives no libraries', () => scanSingleCell(demoFiles()).libraries, [])
}

console.log('\nRECOGNISED, NOT YET HANDLED: CELL RANGER MULTI')
{
  // One raw matrix per GEM well, shared by its samples; each sample's own under per_sample_outs/.
  const multi = [
    ...at('run/G1/outs/multi/count', ['raw_feature_bc_matrix.h5', ...TRIPLET.map(f => `raw_feature_bc_matrix/${f}`)]),
    ...['S1', 'S2'].flatMap(s => at(`run/G1/outs/per_sample_outs/${s}`,
      ['count/sample_filtered_feature_bc_matrix.h5', 'web_summary.html'])),
  ]
  check('it is Cell Ranger output', () => detectDelivery(multi), 'cellranger')
  check('and is refused by name, not grouped into a library called "count"',
    () => /multi/.test(scanSingleCell(multi).unsupported ?? ''), true)
  check('the refusal is what blocks step A',
    () => deliveryBlocker('cellranger', [], scanSingleCell(multi).unsupported), scanSingleCell(multi).unsupported)
  check('the three handled layouts carry no such note',
    () => [crFlat, crOuts, celeNested].map(f => scanSingleCell(f).unsupported), [null, null, null])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll single-cell delivery tests passed\n')
process.exit(failed ? 1 : 0)
