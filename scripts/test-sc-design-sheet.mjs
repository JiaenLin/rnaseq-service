// The single-cell design table, scQC's samplesheet and registry row, and the species held against the
// reference build. Runs the real src/lib modules via Node's TypeScript type-stripping.
//
// Golden files, written by hand from the specification before the writers existed, for one request:
// eight Cell Ranger libraries, a 2×2 design (factor_a: a1, a2; factor_b: b1, b2; two libraries per arm)
// and one covariate (batch).
//   scripts/fixtures/sc-design.csv       the design table, as scProfile's `--design` reads it
//   scripts/fixtures/sc-samplesheet.tsv  scQC's samplesheet
//   scripts/fixtures/sc-registry.tsv     scQC's reference registry, with this request's one row
// scripts/fixtures/scqc-contract.json is scQC's own contract: REQUIRED, NOT_FACTORS and the registry
// format, written from a scQC checkout by scripts/scqc-contract.mjs, which names the commit and the
// lines. The writers' own lists are held to it here, so a writer that drifts from scQC fails.
// scripts/fixtures/sc-request-design.json is the whole request with its design. When it changes ON
// PURPOSE, rewrite it with `node scripts/test-sc-design-sheet.mjs --update-fixture` and say so in the commit.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const load = async path => {
  try { return await import(path) } catch (e) {
    console.log(`\n  (${path} did not load: ${e.code ?? e.message})`)
    return {}
  }
}
const { scanSingleCell } = await load('../src/lib/scDelivery.ts')
const { EMPTY_SC_ANSWERS, ASSAYS, PLATFORMS, inferScAnswers, scQuestionBlocker, buildScRequest } =
  await load('../src/lib/scRequest.ts')
const { EMPTY_SC_DESIGN, designBlocker, buildScRequestWithDesign } = await load('../src/lib/scDesign.ts')
const {
  SCQC_COMMIT, SAMPLESHEET_COLUMNS, RESERVED_COLUMNS, REQUEST_ONLY, REGISTRY_COLUMNS,
  buildScSamplesheet, buildRegistryRow, buildRegistryTsv, buildDesignCsv,
} = await load('../src/lib/scSheets.ts')
const { buildSpecies } = await load('../src/lib/scReference.ts')

let failed = 0
// `got` is a thunk, so that a missing function or a throw is one failed check, not a crash.
const check = (name, got, want) => {
  let value
  try { value = got() } catch (e) { value = `threw: ${e.message}` }
  const ok = JSON.stringify(value) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(value)}\n        want ${JSON.stringify(want)}`}`)
}
const refusal = fn => { try { fn(); return 'built' } catch (e) { return e.message } }
const fixturePath = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const fixture = name => readFileSync(fixturePath(name), 'utf8')
const contract = JSON.parse(fixture('scqc-contract.json'))
const REQUIRED = contract.samplesheet.required.columns
const NOT_FACTORS = contract.samplesheet.not_factors.columns

/* ---------- the readers: each consumer's own rules, replayed for unquoted fields ---------- */

// scQC's read_csv (scqc_cli.py): `#` lines dropped; the delimiter is the header's most frequent of tab,
// comma and semicolon, and a rival as frequent is refused; csv.DictReader skips empty rows.
function scqcRows(text) {
  const lines = text.split('\n').filter(l => l !== '' && !l.trimStart().startsWith('#'))
  const count = d => lines[0].split(d).length - 1
  const counts = [['\t', count('\t')], [',', count(',')], [';', count(';')]]
  const [best, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a))
  if (!n) throw new Error('a single-column header')
  if (counts.some(([d, m]) => d !== best && m >= n)) throw new Error('an ambiguous delimiter')
  const cols = lines[0].split(best)
  return lines.slice(1).map(l => {
    const cells = l.split(best)
    if (cells.length !== cols.length) throw new Error(`a row of ${cells.length} fields under ${cols.length} columns`)
    return Object.fromEntries(cols.map((c, i) => [c, cells[i]]))
  })
}
const headerOf = text => text.split('\n')[0].split(text.split('\n')[0].includes('\t') ? '\t' : ',')

// scQC's design discovery (scqc_cli.py design_from over engine/steps.py NOT_FACTORS): every column it
// does not reserve, with 2 to min(6, n - 1) distinct non-empty values.
const discovered = rows => Object.keys(rows[0]).filter(c => {
  if (NOT_FACTORS.includes(c)) return false
  const levels = new Set(rows.map(r => r[c]).filter(v => v.trim()))
  return levels.size >= 2 && levels.size <= Math.min(6, Math.max(rows.length - 1, 1))
})

// scQC's read_registry (modules/00_ingest/ingest.py), with its constants taken from the contract.
function scqcRegistry(text) {
  const r = contract.registry
  const out = {}
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || i < r.header_lines.value) return
    const f = line.split(r.delimiter.value)
    if (f.length >= r.min_fields.value) out[r.key.fields.map(k => f[k]).join(r.key.joiner)] = f[2]
  })
  return out
}

// scProfile's read_design (scprofile/inputs.py): the run's --sample-key, else the first column named
// sample, sample_id, library, batch or donor; the --factor columns, else every other column.
function readDesign(text, sampleKey = 'sample', factors = null) {
  const lines = text.split('\n').filter(Boolean)
  const delim = [',', '\t', ';'].find(d => lines[0].includes(d)) ?? ','
  const cols = lines[0].split(delim)
  const key = cols.includes(sampleKey) ? sampleKey
    : cols.find(c => ['sample', 'sample_id', 'library', 'batch', 'donor'].includes(c.toLowerCase()))
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(delim).map((v, i) => [cols[i], v])))
  const fs = factors ?? cols.filter(c => c !== key)
  return { key, factors: fs, table: Object.fromEntries(rows.map(r => [r[key], Object.fromEntries(fs.map(f => [f, r[f]]))])) }
}

// The contract a samplesheet header must keep: every REQUIRED column present; every column that is not
// a design column reserved by scQC (else scQC reads it as a factor); no design column reserved (else
// scQC silently drops it); the request-only fields absent. Returns what is wrong, empty when nothing.
function contractProblems(header, designColumns) {
  const own = header.filter(c => !designColumns.includes(c))
  return [
    ...REQUIRED.filter(c => !header.includes(c)).map(c => `missing ${c}`),
    ...own.filter(c => !NOT_FACTORS.includes(c)).map(c => `${c} would be read as a design factor`),
    ...designColumns.filter(c => NOT_FACTORS.includes(c)).map(c => `design column ${c} is reserved`),
    ...['chemistry', 'dbr_method'].filter(c => header.includes(c)).map(c => `${c} is request-only`),
  ]
}

/* ---------- the request ---------- */

const MB = 1e6
const at = (dir, rels, size = MB) => rels.map(r => ({ name: r.split('/').pop(), path: `${dir}/${r}`, size }))
const TRIPLET = ['barcodes.tsv.gz', 'features.tsv.gz', 'matrix.mtx.gz']
const CR = [
  ...TRIPLET.map(f => `raw_feature_bc_matrix/${f}`), ...TRIPLET.map(f => `filtered_feature_bc_matrix/${f}`),
  'raw_feature_bc_matrix.h5', 'filtered_feature_bc_matrix.h5', 'metrics_summary.csv', 'web_summary.html',
]
// The folder names carry the organism and the build, as providers' often do: C34 needs both detected.
const ROOT = 'Human_PBMC_GRCh38-2024-A'
const NAMES = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const crFiles = NAMES.flatMap(s => at(`${ROOT}/${s}/outs`, CR))
const scan = (files = crFiles) => scanSingleCell(files)
const named = (sc, names = {}) => sc.libraries.map(l => ({ ...l, name: names[l.id] ?? l.label }))
const libs = (files = crFiles) => named(scan(files))
const id = s => `${ROOT}/${s}`

const FULL = () => ({
  ...EMPTY_SC_ANSWERS, assay: 'scrna', platform: '10x', chemistry: 'unsure', species: 'human',
  reference: 'named', referenceName: 'GRCh38-2024-A', mtPrefix: 'MT-', riboPattern: '^RP[SL]',
  dbr: 'stated', dbrPercent: '8',
})
const CONTACT = { name: 'Jane Doe', email: 'jane@example.test', org: '', project: '', turnaround: 'standard', notes: '', agree: true }

// The 2×2: two libraries in each of the four arms, and a covariate crossed with the arms.
const ARMS = {
  S1: ['a1', 'b1', 'p1'], S2: ['a1', 'b1', 'p2'], S3: ['a1', 'b2', 'p1'], S4: ['a1', 'b2', 'p2'],
  S5: ['a2', 'b1', 'p1'], S6: ['a2', 'b1', 'p2'], S7: ['a2', 'b2', 'p1'], S8: ['a2', 'b2', 'p2'],
}
const DESIGN = () => ({
  compare: 'yes',
  factors: [
    { key: 'f1', name: 'factor_a', levels: 'a1, a2', reference: 'a1' },
    { key: 'f2', name: 'factor_b', levels: 'b1, b2', reference: 'b1' },
  ],
  covariates: [{ key: 'c1', name: 'batch' }],
  values: Object.fromEntries(NAMES.map(s => [id(s), { f1: ARMS[s][0], f2: ARMS[s][1], c1: ARMS[s][2] }])),
})
const ISO = '2026-01-01T00:00:00.000Z'
const request = (a = FULL(), d = DESIGN(), ls = libs(), files = crFiles, inferred = inferScAnswers(scan(files), files)) =>
  buildScRequestWithDesign('RTEST01', scan(files), ls, a, inferred, CONTACT, ISO, d)
// What a consumer reads is the downloaded file, so the writers are fed the request after a JSON round trip.
const viaJson = r => JSON.parse(JSON.stringify(r))
const req = () => viaJson(request())
const block = d => designBlocker(d, libs())
const withFactor = (i, patch) => { const d = DESIGN(); d.factors[i] = { ...d.factors[i], ...patch }; return d }
const designCols = ['factor_a', 'factor_b', 'batch']

console.log('\nscQC\'S CONTRACT (scripts/fixtures/scqc-contract.json, copied from scQC)')
check(`the writer was checked against the commit the fixture was copied from (${contract.source.commit.slice(0, 7)})`,
  () => SCQC_COMMIT, contract.source.commit)
check('every column scQC requires is one the writer writes', () => REQUIRED.filter(c => !SAMPLESHEET_COLUMNS.includes(c)), [])
check('every column the writer owns is one scQC reserves, so none is read as a design factor',
  () => SAMPLESHEET_COLUMNS.filter(c => !NOT_FACTORS.includes(c)), [])
check('every name scQC reserves is refused as a factor or covariate name',
  () => NOT_FACTORS.filter(c => !RESERVED_COLUMNS.includes(c)), [])
check('and so are the request-only fields, chemistry and dbr_method',
  () => [REQUEST_ONLY, REQUEST_ONLY.every(c => RESERVED_COLUMNS.includes(c))], [['chemistry', 'dbr_method'], true])
check('the registry columns are scQC\'s, in its order', () => REGISTRY_COLUMNS, contract.registry.columns.names)
check('every assay and platform a request can carry is one scQC knows, and reaches the sheet as such', () => {
  const sheet = r => scqcRows(buildScSamplesheet(r))[0]
  const got = ASSAYS.map(assay => sheet(viaJson(request({ ...FULL(), assay }))).assay)
  return [got, ASSAYS.every(a => contract.samplesheet.assays.values.includes(a)),
    PLATFORMS.every(p => contract.samplesheet.platforms.values.includes(p))]
}, [['scrna', 'snrna'], true, true])
check('the contract check catches a drifted writer: chemistry added, or assay dropped', () => {
  const header = headerOf(buildScSamplesheet(req()))
  return [contractProblems([...header, 'chemistry'], designCols), contractProblems(header.filter(c => c !== 'assay'), designCols)]
}, [['chemistry would be read as a design factor', 'chemistry is request-only'], ['missing assay']])

console.log('\nTHE DESIGN TABLE: A 2×2 WITH TWO LIBRARIES PER ARM (P03)')
check('the request carries the design: factors, their levels, the reference of each, the covariate', () => req().design, {
  factors: [
    { name: 'factor_a', levels: ['a1', 'a2'], reference: 'a1' },
    { name: 'factor_b', levels: ['b1', 'b2'], reference: 'b1' },
  ],
  covariates: ['batch'],
  table: NAMES.map(s => ({ sample: s, factor_a: ARMS[s][0], factor_b: ARMS[s][1], batch: ARMS[s][2] })),
})
check('design.csv, byte for byte (scripts/fixtures/sc-design.csv)', () => buildDesignCsv(req()) === fixture('sc-design.csv'), true)
check('it round-trips: read back as scProfile reads it, keyed on sample, the table is the one answered', () => {
  const back = readDesign(buildDesignCsv(req()), 'sample', ['factor_a', 'factor_b'])
  return [back.key, back.factors, NAMES.every(s => back.table[s].factor_a === ARMS[s][0] && back.table[s].factor_b === ARMS[s][1])]
}, ['sample', ['factor_a', 'factor_b'], true])
check('and the covariate stays in the rows, beside the factors', () => readDesign(buildDesignCsv(req())).factors, designCols)
check('two libraries in each of the four arms', () => {
  const n = {}
  for (const r of Object.values(readDesign(buildDesignCsv(req())).table)) n[`${r.factor_a}×${r.factor_b}`] = (n[`${r.factor_a}×${r.factor_b}`] ?? 0) + 1
  return n
}, { 'a1×b1': 2, 'a1×b2': 2, 'a2×b1': 2, 'a2×b2': 2 })
check('no contrast is written: the profiling step enumerates them', () => {
  const r = req()
  return ['contrasts' in r.design, /contrast/i.test(buildDesignCsv(r).split('\n')[0])]
}, [false, false])
check('a reference level that is not the first level is kept as given',
  () => viaJson(request(FULL(), withFactor(1, { reference: 'b2' }))).design.factors[1], { name: 'factor_b', levels: ['b1', 'b2'], reference: 'b2' })
check('a renamed library keeps its levels, under its new name', () => {
  const r = viaJson(request(FULL(), DESIGN(), named(scan(), { [id('S1')]: 'first_1' })))
  return [r.design.table[0], buildDesignCsv(r).split('\n')[1]]
}, [{ sample: 'first_1', factor_a: 'a1', factor_b: 'b1', batch: 'p1' }, 'first_1,a1,b1,p1'])
{
  const four = crFiles.filter(f => /\/S[1-4]\//.test(f.path))
  const one = {
    compare: 'yes', factors: [{ key: 'f1', name: 'factor_a', levels: 'a1, a2', reference: 'a1' }], covariates: [],
    values: { [id('S1')]: { f1: 'a1' }, [id('S2')]: { f1: 'a1' }, [id('S3')]: { f1: 'a2' }, [id('S4')]: { f1: 'a2' } },
  }
  check('one factor, two libraries per arm', () => buildDesignCsv(viaJson(request(FULL(), one, libs(four), four))),
    'sample,factor_a\nS1,a1\nS2,a1\nS3,a2\nS4,a2\n')
}
check('no comparison is an answer: no factor, and the covariates still recorded', () => {
  const d = { ...DESIGN(), compare: 'no' }
  const r = viaJson(request(FULL(), d))
  return [r.design.factors, r.design.covariates, buildDesignCsv(r).split('\n').slice(0, 2)]
}, [[], ['batch'], ['sample,batch', 'S1,p1']])

console.log('\nTHE DESIGN AND EACH REFERENCE LEVEL ARE ASKED, NEVER GUESSED')
check('nothing is pre-filled: no answer, no factor, no covariate, no value', () => EMPTY_SC_DESIGN,
  { compare: '', factors: [], covariates: [], values: {} })
check('so the empty design blocks Continue, asking whether the libraries are compared',
  () => /compared/i.test(block(EMPTY_SC_DESIGN) ?? ''), true)
check('the full 2×2 passes', () => block(DESIGN()), null)
check('compared, but no factor named: blocked', () => /factor/i.test(block({ ...DESIGN(), factors: [] }) ?? ''), true)
check('a factor without a reference level is blocked, by name', () => {
  const m = block(withFactor(1, { reference: '' })) ?? ''
  return [/factor_b/.test(m), /reference/i.test(m)]
}, [true, true])
check('a reference that is no longer one of the levels is blocked', () => /factor_a.*reference|reference.*factor_a/i.test(
  block(withFactor(0, { reference: 'a3' })) ?? ''), true)
check('a factor with one level is blocked', () => /two levels/i.test(block(withFactor(0, { levels: 'a1' })) ?? ''), true)
check('a level listed twice is blocked', () => /twice/i.test(block(withFactor(0, { levels: 'a1, a2, a1' })) ?? ''), true)
check('a level no library has is blocked, naming it', () => /a3/.test(block(withFactor(0, { levels: 'a1, a2, a3' })) ?? ''), true)
check('a library with no level of a factor is blocked, naming both', () => {
  const d = DESIGN()
  delete d.values[id('S3')].f2
  const m = block(d) ?? ''
  return [/S3/.test(m), /factor_b/.test(m)]
}, [true, true])
check('a covariate with no value for a library is blocked, naming both', () => {
  const d = DESIGN()
  d.values[id('S5')].c1 = ' '
  const m = block(d) ?? ''
  return [/S5/.test(m), /batch/.test(m)]
}, [true, true])
for (const name of ['sample', 'species', 'dbr', 'aligner_cells', 'chemistry', 'dbr_method', 'Sample'])
  check(`"${name}" cannot name a factor: the samplesheet uses it for the run itself`,
    () => new RegExp(`“${name}”`).test(block(withFactor(0, { name })) ?? ''), true)
check('nor a covariate', () => /“mt_prefix”/.test(block({ ...DESIGN(), covariates: [{ key: 'c1', name: 'mt_prefix' }] }) ?? ''), true)
for (const name of ['1st', 'factor a', 'factor-a'])
  check(`"${name}" is refused: a model formula cannot carry it`, () => /letter/i.test(block(withFactor(0, { name })) ?? ''), true)
check('one name for two columns is refused, whatever its case',
  () => /twice/i.test(block({ ...DESIGN(), covariates: [{ key: 'c1', name: 'Factor_A' }] }) ?? ''), true)
check('a level with a space is refused', () => /“a 1”/.test(block(withFactor(0, { levels: 'a 1, a2' })) ?? ''), true)
check('a covariate value with a comma is refused', () => {
  const d = DESIGN()
  d.values[id('S2')].c1 = 'p,2'
  return /“p,2”/.test(block(d) ?? '')
}, true)
check('the request builder refuses what the step blocks, with the same words',
  () => refusal(() => request(FULL(), withFactor(0, { reference: '' }))) === block(withFactor(0, { reference: '' })), true)
check('and the single-cell questions still come first: no assay, no request',
  () => refusal(() => request({ ...FULL(), assay: '' })) === scQuestionBlocker({ ...FULL(), assay: '' }, libs()), true)

console.log('\nscQC\'S SAMPLESHEET (P04)')
check('the golden header passes scQC\'s contract (REQUIRED present, NOT_FACTORS kept out of the design)', () => {
  const header = headerOf(buildScSamplesheet(req()))
  return [header.join(' ') === fixture('sc-samplesheet.tsv').split('\n')[0].split('\t').join(' '), contractProblems(header, designCols)]
}, [true, []])
check('the whole samplesheet, byte for byte (scripts/fixtures/sc-samplesheet.tsv)',
  () => buildScSamplesheet(req()) === fixture('sc-samplesheet.tsv'), true)
check('read as scQC reads it: eight rows, one per library, in delivery order',
  () => scqcRows(buildScSamplesheet(req())).map(r => r.sample), NAMES)
check('scQC\'s design discovery, replayed, finds the design\'s columns and nothing else',
  () => discovered(scqcRows(buildScSamplesheet(req()))), designCols)
check('matrix is the raw folder and aligner_cells the filtered one (a folder is read without h5py)', () => {
  const r = scqcRows(buildScSamplesheet(req()))[0]
  return [r.matrix, r.aligner_cells]
}, [`${ROOT}/S1/outs/raw_feature_bc_matrix`, `${ROOT}/S1/outs/filtered_feature_bc_matrix`])
{
  const h5 = ['H1', 'H2'].flatMap(s => at(`${ROOT}/${s}/outs`, ['raw_feature_bc_matrix.h5', 'filtered_feature_bc_matrix.h5']))
  check('a library delivered as .h5 only names its .h5 files', () => {
    const r = scqcRows(buildScSamplesheet(viaJson(request(FULL(), { ...EMPTY_SC_DESIGN, compare: 'no' }, libs(h5), h5))))[0]
    return [r.matrix, r.aligner_cells]
  }, [`${ROOT}/H1/outs/raw_feature_bc_matrix.h5`, `${ROOT}/H1/outs/filtered_feature_bc_matrix.h5`])
}
check('a root rebases every path onto where the delivery sits', () => {
  const r = scqcRows(buildScSamplesheet(req(), '/data/delivery/'))[7]
  return [r.matrix, r.aligner_cells]
}, [`/data/delivery/${ROOT}/S8/outs/raw_feature_bc_matrix`, `/data/delivery/${ROOT}/S8/outs/filtered_feature_bc_matrix`])
{
  const cs = ['C1', 'C2'].flatMap(s => at(`run/${s}/${s}/outs`, [...TRIPLET.map(f => `raw/${f}`), ...TRIPLET.map(f => `filtered/${f}`)]))
  check('a CeleScope delivery: singleron, outs/raw and outs/filtered', () => {
    const a = { ...FULL(), platform: 'singleron', referenceName: 'GRCh38-2020-A' }
    const r = scqcRows(buildScSamplesheet(viaJson(request(a, { ...EMPTY_SC_DESIGN, compare: 'no' }, libs(cs), cs))))[1]
    return [r.platform, r.reference, r.matrix, r.aligner_cells]
  }, ['singleron', 'homo_sapiens/GRCh38-2020-A', 'run/C2/C2/outs/raw', 'run/C2/C2/outs/filtered'])
}
{
  const noFiltered = [...crFiles.filter(f => /\/S[12]\//.test(f.path)), ...at(id('S3') + '/outs', ['raw_feature_bc_matrix.h5'])]
  check('nuclei without a filtered matrix: aligner_cells is left blank, never invented', () => {
    const r = viaJson(request({ ...FULL(), assay: 'snrna' }, { ...EMPTY_SC_DESIGN, compare: 'no' }, libs(noFiltered), noFiltered))
    return scqcRows(buildScSamplesheet(r)).map(x => x.aligner_cells === '')
  }, [false, false, true])
}
check('chemistry and dbr_method never reach the samplesheet, named or derived', () => {
  const r = viaJson(request({ ...FULL(), chemistry: 'named', chemistryName: '3p v4', dbr: 'derive', dbrPercent: '' }))
  const sheet = buildScSamplesheet(r)
  const rows = scqcRows(sheet)
  return [r.protocol.chemistry, r.protocol.dbr_method, headerOf(sheet).filter(c => REQUEST_ONLY.includes(c)),
    rows.some(x => Object.values(x).some(v => v === '3p v4' || v === 'derive')), rows.every(x => x.dbr === '')]
}, ['3p v4', 'derive', [], false, true])
check('a stated doublet rate is the fraction, in every row', () => scqcRows(buildScSamplesheet(req())).map(r => r.dbr),
  NAMES.map(() => '0.08'))
check('the reference not named: no samplesheet, and the refusal says why', () => /question 5/.test(
  refusal(() => buildScSamplesheet(viaJson(request({ ...FULL(), reference: 'unsure', referenceName: '' }))))), true)
check('a request with no design (written before the design step) gets no samplesheet and no design.csv', () => {
  const old = viaJson(buildScRequest('RTEST01', scan(), libs(), FULL(), {}, CONTACT, ISO))
  return [/design/i.test(refusal(() => buildScSamplesheet(old))), /design/i.test(refusal(() => buildDesignCsv(old)))]
}, [true, true])
check('a value that would break a line of the sheet is refused, not written', () => {
  const r = req()
  r.protocol.mt_prefix = 'M\tT-'
  return /mt_prefix/.test(refusal(() => buildScSamplesheet(r)))
}, true)

console.log('\nTHE REGISTRY ROW (P04)')
check('buildRegistryRow writes the <species>/<build> key, read back by scQC\'s rule',
  () => Object.keys(scqcRegistry(`${REGISTRY_COLUMNS.join('\t')}\n${buildRegistryRow(req())}\n`)), ['homo_sapiens/GRCh38-2024-A'])
check('it is the key every samplesheet row names, so scQC\'s validate finds the reference', () => {
  const keys = Object.keys(scqcRegistry(buildRegistryTsv(req())))
  return scqcRows(buildScSamplesheet(req())).every(r => keys.includes(r.reference))
}, true)
check('the registry file, byte for byte (scripts/fixtures/sc-registry.tsv)', () => buildRegistryTsv(req()) === fixture('sc-registry.tsv'), true)
check('no index path is claimed: matrices were delivered, so nothing aligns',
  () => buildRegistryRow(req()).split('\t').slice(2, 3), ['-'])
check('the reference not named: no registry row', () => /question 5/.test(
  refusal(() => buildRegistryRow(viaJson(request({ ...FULL(), reference: 'unsure', referenceName: '' }))))), true)

console.log('\nTHE SPECIES AND THE BUILD, TOGETHER (C34)')
{
  // The delivery's paths name both; the customer changes the organism and leaves the detected build.
  const inf = () => inferScAnswers(scan(), crFiles)
  const changed = () => { const { species, ...rest } = inf(); return [{ ...FULL(), species: 'mouse' }, rest, species.value] }
  check('species changed to mouse, detected GRCh38-2024-A kept: refused at question 5, naming both', () => {
    const [a, rest, was] = changed()
    const m = scQuestionBlocker(a, libs()) ?? ''
    return [was, rest.referenceName.value, /question 5/.test(m), /question 4/.test(m), /human/.test(m), /mouse/.test(m)]
  }, ['human', 'GRCh38-2024-A', true, true, true, true])
  check('so no request can be written by any route', () => {
    const [a, rest] = changed()
    return [/question 5/.test(refusal(() => buildScRequest('RTEST01', scan(), libs(), a, rest, CONTACT, ISO))),
      /question 5/.test(refusal(() => request(a, DESIGN(), libs(), crFiles, rest)))]
  }, [true, true])
}
check('a request edited to mus_musculus/GRCh38-2024-A gets no registry row and no samplesheet', () => {
  const r = req()
  r.protocol.species = 'mus_musculus'
  r.protocol.reference = 'mus_musculus/GRCh38-2024-A'
  return [/human/.test(refusal(() => buildRegistryRow(r))), /human/.test(refusal(() => buildScSamplesheet(r)))]
}, [true, true])
check('the organism a build names', () => ['GRCh38-2024-A', 'refdata-gex-mm10-2020-A', 'GRCm39', 'hg19', 'mRatBN7.2', 'Rnor_6.0']
  .map(b => buildSpecies(b)), ['homo_sapiens', 'mus_musculus', 'mus_musculus', 'homo_sapiens', 'rattus_norvegicus', 'rattus_norvegicus'])
check('rat over GRCh38 is refused; mouse over mm10-2020-A is not', () => [
  buildSpecies('mm10-2020-A'),
  /question 5/.test(scQuestionBlocker({ ...FULL(), species: 'rat' }, libs()) ?? ''),
  scQuestionBlocker({ ...FULL(), species: 'mouse', referenceName: 'mm10-2020-A', mtPrefix: 'mt-', riboPattern: '^Rp[sl]' }, libs()),
], ['mus_musculus', true, null])
check('a barnyard reference names two organisms and implies neither', () => {
  const b = 'GRCh38_and_GRCm39-2024-A'
  return [buildSpecies(b), scQuestionBlocker({ ...FULL(), referenceName: b }, libs()),
    scQuestionBlocker({ ...FULL(), species: 'mouse', referenceName: b }, libs())]
}, [null, null, null])
check('a build the check does not know implies nothing', () =>
  [buildSpecies('custom_build_v2'), scQuestionBlocker({ ...FULL(), species: 'rat', referenceName: 'custom_build_v2' }, libs())], [null, null])
check('a known species written out by hand is held to the build too', () => /question 5/.test(
  scQuestionBlocker({ ...FULL(), species: 'other', speciesOther: 'Mus musculus' }, libs()) ?? ''), true)
check('a species in the customer\'s own words is theirs (a xenograft may be aligned to one organism\'s build)', () =>
  buildRegistryRow(viaJson(request({ ...FULL(), species: 'other', speciesOther: 'Xenopus laevis' }))).split('\t').slice(0, 2),
['xenopus_laevis', 'GRCh38-2024-A'])

console.log('\nNOTHING IS UPLOADED')
check('the request and its three files are written with no network call (fetch throws if called)', () => {
  const real = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => { calls++; throw new Error('no network') }
  try {
    const r = req()
    return [buildScSamplesheet(r).length > 0, buildRegistryTsv(r).length > 0, buildDesignCsv(r).length > 0, calls]
  } finally { globalThis.fetch = real }
}, [true, true, true, 0])

console.log('\nTHE WHOLE REQUEST, WITH ITS DESIGN')
if (process.argv.includes('--update-fixture')) writeFileSync(fixturePath('sc-request-design.json'), JSON.stringify(request(), null, 2))
check('byte for byte (scripts/fixtures/sc-request-design.json)',
  () => JSON.stringify(request(), null, 2) === fixture('sc-request-design.json'), true)

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll single-cell design and samplesheet tests passed\n')
process.exit(failed ? 1 : 0)
