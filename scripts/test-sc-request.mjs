// The single-cell request: its questions, what blocks Continue, and the JSON it writes.
// Runs the real src/lib/scRequest.ts and src/lib/scDelivery.ts via Node's TypeScript type-stripping.
//
// scripts/fixtures/sc-request.json is the request this file builds, kept whole as the contract a
// consumer of single-cell requests is written against. When the request changes ON PURPOSE, rewrite it
// with `node scripts/test-sc-request.mjs --update-fixture` and say so in the commit.
//
// It also guards the bulk path: the built-in demo, dropped as a folder, must still route to the bulk
// questionnaire and produce the bulk request a42b747 produced, byte for byte
// (scripts/bulk-demo-request.mjs says how that fixture was written).
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { demoFiles } from '../src/lib/demo.ts'
import { bulkDemoRequestJson } from './bulk-demo-request.mjs'

const load = async path => {
  try { return await import(path) } catch (e) {
    console.log(`\n  (${path} did not load: ${e.code ?? e.message})`)
    return {}
  }
}
const { detectDelivery, scanSingleCell, deliveryBlocker } = await load('../src/lib/scDelivery.ts')
const {
  EMPTY_SC_ANSWERS, inferScAnswers, mtRiboSuggestion, scQuestionBlocker, libraryNameBlocker, buildScRequest,
} = await load('../src/lib/scRequest.ts')

let failed = 0
// `got` is a thunk, so that a missing function or a throw is one failed check, not a crash.
const check = (name, got, want) => {
  let value
  try { value = got() } catch (e) { value = `threw: ${e.message}` }
  const ok = JSON.stringify(value) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(value)}\n        want ${JSON.stringify(want)}`}`)
}
const fixturePath = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const fixture = name => readFileSync(fixturePath(name), 'utf8')

const MB = 1e6
const at = (dir, rels, size = MB) => rels.map(r => ({ name: r.split('/').pop(), path: `${dir}/${r}`, size }))
const TRIPLET = ['barcodes.tsv.gz', 'features.tsv.gz', 'matrix.mtx.gz']
const CR = [
  ...TRIPLET.map(f => `raw_feature_bc_matrix/${f}`), ...TRIPLET.map(f => `filtered_feature_bc_matrix/${f}`),
  'raw_feature_bc_matrix.h5', 'filtered_feature_bc_matrix.h5', 'metrics_summary.csv', 'web_summary.html',
]

// A Cell Ranger delivery whose folder names carry the organism and the reference, as providers' often do.
const ROOT = 'Human_PBMC_GRCh38-2024-A'
const crFiles = ['S1', 'S2'].flatMap(s => at(`${ROOT}/${s}/outs`, CR))
const crScan = () => scanSingleCell(crFiles)
const named = (scan, names = {}) => scan.libraries.map(l => ({ ...l, name: names[l.id] ?? l.label }))
const libs = () => named(crScan())

// Every question answered: the baseline each gate below takes one answer away from.
const FULL = () => ({
  ...EMPTY_SC_ANSWERS, assay: 'scrna', platform: '10x', chemistry: 'unsure', species: 'human',
  reference: 'named', referenceName: 'GRCh38-2024-A', mtPrefix: 'MT-', riboPattern: '^RP[SL]',
  dbr: 'stated', dbrPercent: '8',
})
const CONTACT = { name: 'Jane Doe', email: 'jane@example.test', org: '', project: '', turnaround: 'standard', notes: '', agree: true }
const build = (a, inferred = {}, ls = libs(), scan = crScan()) =>
  buildScRequest('RTEST01', scan, ls, a, inferred, CONTACT, '2026-01-01T00:00:00.000Z')
const block = a => scQuestionBlocker(a, libs())
const asks = (a, n) => new RegExp(`question ${n}\\b`).test(block(a) ?? '')

console.log('\nTHE ASSAY HAS NO DEFAULT (cells and nuclei are different experiments)')
check('the empty answer sheet leaves the assay blank', () => EMPTY_SC_ANSWERS.assay, '')
check('so question 1 blocks Continue', () => asks(EMPTY_SC_ANSWERS, 1), true)
check('every other answer given, assay still blank -> blocked on the assay', () => asks({ ...FULL(), assay: '' }, 1), true)
check('the message says what is being asked', () => /cells or (single )?nuclei/i.test(block({ ...FULL(), assay: '' })), true)
check('a request without an assay is refused, saying why', () => {
  try { build({ ...FULL(), assay: '' }); return 'built' } catch (e) { return e.message === block({ ...FULL(), assay: '' }) }
}, true)
check('so is an assay that is neither', () => /question 1/.test(String((() => {
  try { return build({ ...FULL(), assay: 'bulk' }) } catch (e) { return e.message }
})())), true)
check('nothing infers it, even when the paths name it', () => {
  const said = [...at('run_snRNA_nuclei/S1/outs', CR), ...at('scRNA_single_cell/S2/outs', CR)]
  return 'assay' in inferScAnswers(scanSingleCell(said), said)
}, false)
check('scrna is accepted', () => block(FULL()), null)
check('snrna is accepted', () => block({ ...FULL(), assay: 'snrna' }), null)
{
  // scQC refuses single cells without the aligner's cell call, so the request does too.
  const noFiltered = [...crFiles, ...at(`${ROOT}/S3/outs`, ['raw_feature_bc_matrix.h5'])]
  const ls = () => named(scanSingleCell(noFiltered), { [`${ROOT}/S3`]: 'Third' })
  check('scrna without a filtered matrix is blocked, naming the library',
    () => /Third/.test(scQuestionBlocker(FULL(), ls()) ?? ''), true)
  check('snrna with the same library is not', () => scQuestionBlocker({ ...FULL(), assay: 'snrna' }, ls()), null)
}

console.log('\nDETECTED FROM THE FILES, NEVER ASSUMED')
{
  const inf = () => inferScAnswers(crScan(), crFiles)
  check('Cell Ranger output -> platform 10x (detected)', () => [inf().platform.value, inf().platform.kind], ['10x', 'detected'])
  const cs = at('cs/S1/S1/outs', [...TRIPLET.map(f => `raw/${f}`), ...TRIPLET.map(f => `filtered/${f}`)])
  check('CeleScope output -> platform singleron (detected)',
    () => inferScAnswers(scanSingleCell(cs), cs).platform.value, 'singleron')
  check('"Human" in the paths -> organism human (detected)', () => [inf().species.value, inf().species.kind], ['human', 'detected'])
  check('a reference named in the paths is read whole',
    () => [inf().reference.value, inf().referenceName.value], ['named', 'GRCh38-2024-A'])
  const mm = at('lung_mm10-2020-A/S1/outs', CR)
  check('mm10-2020-A -> mouse and mm10-2020-A', () => {
    const i = inferScAnswers(scanSingleCell(mm), mm)
    return [i.species.value, i.referenceName.value]
  }, ['mouse', 'mm10-2020-A'])
  const bare = at('delivery/S1/outs', CR)
  check('no organism or build in the paths -> neither is filled', () => {
    const i = inferScAnswers(scanSingleCell(bare), bare)
    return ['species', 'reference', 'referenceName'].filter(k => k in i)
  }, [])
  check('mt prefix, ribo pattern, chemistry and doublet rate are never filled',
    () => ['mtPrefix', 'riboPattern', 'chemistry', 'chemistryName', 'dbr', 'dbrPercent'].filter(k => k in inf()), [])
  check('human suggestion (click to apply)', () => mtRiboSuggestion('human'), { mt: 'MT-', ribo: '^RP[SL]' })
  check('mouse suggestion', () => mtRiboSuggestion('mouse'), { mt: 'mt-', ribo: '^Rp[sl]' })
  check('no suggestion where none is documented', () => [mtRiboSuggestion('rat'), mtRiboSuggestion('other')], [null, null])
}

console.log('\nEACH QUESTION GATES CONTINUE, IN ORDER')
check('platform', () => asks({ ...FULL(), platform: '' }, 2), true)
check('chemistry: unanswered', () => asks({ ...FULL(), chemistry: '' }, 3), true)
check('chemistry: "I know it" but not named', () => asks({ ...FULL(), chemistry: 'named', chemistryName: ' ' }, 3), true)
check('organism', () => asks({ ...FULL(), species: '' }, 4), true)
check('organism: other, not named', () => asks({ ...FULL(), species: 'other', speciesOther: '' }, 4), true)
check('reference: unanswered', () => asks({ ...FULL(), reference: '' }, 5), true)
check('reference: named but empty', () => asks({ ...FULL(), referenceName: '' }, 5), true)
check('reference: a slash would split the registry key', () => asks({ ...FULL(), referenceName: 'GRCh38/2024' }, 5), true)
check('reference: not sure is an answer', () => block({ ...FULL(), reference: 'unsure', referenceName: '' }), null)
check('mitochondrial prefix', () => asks({ ...FULL(), mtPrefix: '' }, 6), true)
check('ribosomal pattern', () => asks({ ...FULL(), riboPattern: '' }, 6), true)
check('ribosomal pattern that is not a regular expression', () => asks({ ...FULL(), riboPattern: '^RP[SL' }, 6), true)
check('doublet rate: unanswered', () => asks({ ...FULL(), dbr: '' }, 7), true)
for (const bad of ['', '0', '100', '-3', 'abc'])
  check(`doublet rate "${bad}" % is refused`, () => asks({ ...FULL(), dbrPercent: bad }, 7), true)
check('doublet rate: derive per library is an answer', () => block({ ...FULL(), dbr: 'derive', dbrPercent: '' }), null)
check('the first unmet question is the one named', () => asks({ ...FULL(), chemistry: '', mtPrefix: '' }, 3), true)

console.log('\nLIBRARY NAMES (every output file is named after one)')
check('unique names pass', () => libraryNameBlocker(['S1', 'S2']), null)
check('an empty name is refused', () => /name/i.test(libraryNameBlocker(['S1', ' ']) ?? ''), true)
check('a repeated name is refused', () => /unique/i.test(libraryNameBlocker(['S1', 'S1']) ?? ''), true)
check('a space or a slash is refused', () =>
  [libraryNameBlocker(['S 1']), libraryNameBlocker(['a/b'])].every(m => /letters/i.test(m ?? '')), true)

console.log('\nWHAT BLOCKS STEP A')
check('a complete delivery passes', () => deliveryBlocker(crScan().kind, libs()), null)
check('a library without a raw matrix is named', () => {
  const f = [...crFiles, ...at(`${ROOT}/S3/outs`, ['filtered_feature_bc_matrix.h5'])]
  const m = deliveryBlocker('cellranger', named(scanSingleCell(f)))
  return /S3/.test(m) && /raw/.test(m)
}, true)
check('no library at all', () => /no .*librar/i.test(deliveryBlocker('fastq', []) ?? ''), true)

console.log('\nTHE REQUEST')
{
  const req = () => build(FULL(), { platform: inferScAnswers(crScan(), crFiles).platform })
  check('it says what it is, first', () => Object.keys(req())[0] + '=' + req().kind, 'kind=single-cell')
  check('the delivery', () => [req().data.delivery, req().data.n_files, req().data.total_bytes], ['cellranger', 20, 20 * MB])
  check('species as the registry spells it', () => req().protocol.species, 'homo_sapiens')
  check('reference = <species>/<build>', () => req().protocol.reference, 'homo_sapiens/GRCh38-2024-A')
  check('8 % -> dbr 0.08, stated', () => [req().protocol.dbr, req().protocol.dbr_method], [0.08, 'stated'])
  check('0.7 % -> 0.007, with no float noise', () => build({ ...FULL(), dbrPercent: '0.7' }).protocol.dbr, 0.007)
  check('derive -> no number, and the method says so', () => {
    const p = build({ ...FULL(), dbr: 'derive', dbrPercent: '' }).protocol
    return [p.dbr, p.dbr_method]
  }, [null, 'derive'])
  check('chemistry not sure -> null; named -> the name', () => [
    req().protocol.chemistry, build({ ...FULL(), chemistry: 'named', chemistryName: ' 3p v4 ' }).protocol.chemistry,
  ], [null, '3p v4'])
  check('reference not sure -> null', () => build({ ...FULL(), reference: 'unsure' }).protocol.reference, null)
  check('another organism keeps its name, as a key',
    () => build({ ...FULL(), species: 'other', speciesOther: 'Danio rerio' }).protocol.species, 'danio_rerio')
  check('who answered what', () => req().answered_by, {
    assay: 'user', platform: 'detected', chemistry: 'user', species: 'user', reference: 'user',
    mt_prefix: 'user', ribo_pattern: 'user', dbr: 'user',
  })
  check('each library under the name the customer gave it', () =>
    build(FULL(), {}, named(crScan(), { [`${ROOT}/S1`]: 'Ctrl_1' })).data.libraries.map(l => l.sample), ['Ctrl_1', 'S2'])
  check('with its matrices and summary', () => {
    const l = req().data.libraries[0]
    return [l.folder, l.raw.matrix_dir, l.filtered.h5, l.summary.length]
  }, [`${ROOT}/S1`, `${ROOT}/S1/outs/raw_feature_bc_matrix`, `${ROOT}/S1/outs/filtered_feature_bc_matrix.h5`, 2])
  check('a repeated library name is refused', () => /unique/i.test((() => {
    try { return JSON.stringify(build(FULL(), {}, named(crScan(), { [`${ROOT}/S2`]: 'S1' }))) } catch (e) { return e.message }
  })()), true)
  if (process.argv.includes('--update-fixture')) writeFileSync(fixturePath('sc-request.json'), JSON.stringify(req(), null, 2))
  check('the whole request, byte for byte (scripts/fixtures/sc-request.json)',
    () => JSON.stringify(req(), null, 2) === fixture('sc-request.json'), true)
}

console.log('\nTHE BULK REQUEST IS UNCHANGED')
{
  const golden = fixture('bulk-demo-request.json')
  const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12)
  const routed = detectDelivery?.(demoFiles())
  const json = routed === 'fastq' ? await bulkDemoRequestJson(fileURLToPath(new URL('..', import.meta.url))) : null
  check(`the demo, dropped, routes to bulk and writes a42b747's request byte for byte (sha256 ${sha(golden)}…)`,
    () => [routed, json === golden ? sha(json) : json && sha(json)], ['fastq', sha(golden)])
  check('and a bulk request still carries no kind field (the bulk intake reads it unchanged)',
    () => routed === 'fastq' && !('kind' in JSON.parse(json)), true)
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll single-cell request tests passed\n')
process.exit(failed ? 1 : 0)
