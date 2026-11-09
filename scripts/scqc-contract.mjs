// scQC's samplesheet and registry contract, read from a scQC checkout's own source lines.
//
// The single-cell writers (src/lib/scSheets.ts) produce what scQC's first stage takes, so what scQC
// requires and reserves is copied into scripts/fixtures/scqc-contract.json, with the commit and the
// file:line each list came from. `npm test` (scripts/test-sc-design-sheet.mjs) holds the writers to
// that copy. When scQC changes, regenerate the copy from the new checkout and run the tests:
//
//   node scripts/scqc-contract.mjs <scQC checkout> > scripts/fixtures/scqc-contract.json
//
// Nothing here is guessed: a list that cannot be found where it was found before is an error, so a
// moved or renamed list fails loudly instead of yielding an empty contract.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const INGEST = 'modules/00_ingest/ingest.py'
const STEPS = 'engine/steps.py'
const GRAPH = 'engine/graph.py'
const AMBIENT = 'modules/01_ambient/ambient.py'
const INIT = 'setup/init_project.sh'

function find(root, file, rx, what) {
  const text = readFileSync(join(root, file), 'utf8')
  const m = rx.exec(text)
  if (!m) throw new Error(`${file}: ${what} not found (${rx})`)
  const first = text.slice(0, m.index).split('\n').length
  const last = first + m[0].split('\n').length - 1
  return { m, from: `${file}:${first === last ? first : `${first}-${last}`}` }
}

const strings = body => [...body.matchAll(/"([^"]*)"/g)].map(x => x[1])

export function scqcContract(root) {
  const commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

  const required = find(root, INGEST, /^REQUIRED = \(([^)]*)\)/m, 'REQUIRED')
  const assays = find(root, INGEST, /^ASSAYS = \(([^)]*)\)/m, 'ASSAYS')
  const platforms = find(root, INGEST, /^PROCESSOR = \{([^}]*)\}/m, 'PROCESSOR')
  const notFactors = find(root, STEPS, /^NOT_FACTORS = frozenset\(\{([^}]*)\}\)/m, 'NOT_FACTORS')

  // read_registry: one header line skipped, fields split on a tab, the key the first two joined by "/",
  // and a row shorter than the minimum ignored.
  const split = find(root, INGEST, /^ {8}f = line\.split\("(\\t)"\)$/m, 'the registry delimiter')
  const header = find(root, INGEST, /^ {8}if not line\.strip\(\) or i == (\d+):$/m, 'the registry header skip')
  const minimum = find(root, INGEST, /^ {8}if len\(f\) >= (\d+):$/m, 'the registry minimum')
  const key = find(root, INGEST, /^ {12}out\[f"\{f\[(\d)\]\}(.)\{f\[(\d)\]\}"\] = f\[\d\]$/m, 'the registry key')
  const columns = find(root, INIT, /^printf '([^']*)\\n' > "\$DIR\/registry\.tsv"$/m, 'the registry header')

  // Which libraries need `aligner_cells`, the aligner's own cell call. The assay's policy says whether
  // a library is denoised (DENOISE). One that is not takes the aligner's call AS its cell call, and is
  // refused before anything is submitted without it (graph.py); every other library is compared at
  // step 2 with the denoiser's call (call_by), and step 2 refuses without it (steps.py). Both rules
  // found means every assay needs it; should either move, this fails rather than narrow the list.
  const denoise = find(root, AMBIENT, /^DENOISE = \{([^}]*)\}/m, 'DENOISE')
  const undenoised = find(root, GRAPH,
    /^ *lacking = \[s for s in not_denoised\n *if not str\(by_sample\[s\]\.get\("aligner_cells"\) or ""\)\.strip\(\)\]$/m,
    'the undenoised libraries\' aligner_cells rule')
  const callBy = find(root, GRAPH,
    /^ *call_by = \{s: \("aligner" if s in not_denoised else "denoiser"\) for s in by_sample\}$/m, 'step 2\'s caller per library')
  const compared = find(root, STEPS,
    /^ *a_path = pth\.get\("aligner"\)\n *if not a_path:\n *missing\.append\(f"\{s\}: aligner_cells"\)$/m,
    'step 2\'s aligner_cells rule')
  const policy = Object.fromEntries([...denoise.m[1].matchAll(/"([^"]+)":\s*(True|False)/g)].map(x => [x[1], x[2] === 'True']))

  return {
    source: {
      repository: 'scQC',
      commit,
      written_by: 'node scripts/scqc-contract.mjs <scQC checkout>',
    },
    samplesheet: {
      required: { from: required.from, columns: strings(required.m[1]) },
      not_factors: { from: notFactors.from, columns: strings(notFactors.m[1]) },
      assays: { from: assays.from, values: strings(assays.m[1]) },
      platforms: { from: platforms.from, values: strings(platforms.m[1]).filter((_, i) => i % 2 === 0) },
      aligner_cells: {
        denoise: { from: denoise.from, values: policy },
        not_denoised: { from: undenoised.from, rule: 'the aligner\'s call is the cell call; refused before anything is submitted without it' },
        compared_at_step_2: { from: callBy.from, rule: 'every library not in not_denoised is called by the denoiser and compared' },
        denoised: { from: compared.from, rule: 'step 2 (02_cells) refuses a compared library without it' },
        required_for: Object.keys(policy),
      },
    },
    registry: {
      columns: { from: columns.from, names: columns.m[1].split('\\t') },
      delimiter: { from: split.from, value: split.m[1] === '\\t' ? '\t' : split.m[1] },
      header_lines: { from: header.from, value: Number(header.m[1]) + 1 },
      min_fields: { from: minimum.from, value: Number(minimum.m[1]) },
      key: { from: key.from, fields: [Number(key.m[1]), Number(key.m[3])], joiner: key.m[2] },
    },
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!process.argv[2]) {
    process.stderr.write('usage: node scripts/scqc-contract.mjs <scQC checkout>\n')
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(scqcContract(process.argv[2]), null, 2) + '\n')
}
