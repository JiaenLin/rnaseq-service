// The built-in demo's bulk request JSON, built the way the app builds it, from the modules under <root>.
//
// The bulk request is a contract: the bulk pipeline's intake reads it. So `npm test`
// (scripts/test-sc-request.mjs) checks the demo's request against scripts/fixtures/bulk-demo-request.json,
// which this script wrote from a42b747's own modules, before single-cell deliveries were recognised.
// A change that alters the bulk request then fails a test instead of shipping silently. If the bulk
// request is changed ON PURPOSE, regenerate the fixture and say so in the commit:
//
//   node scripts/bulk-demo-request.mjs . > scripts/fixtures/bulk-demo-request.json
//
// What it replays, from App.tsx: `loadDemo`, the questionnaire as inference fills it, plus the one
// answer the demo leaves to the customer (strandedness), and StepRequest's `json()`. The request id,
// the clock and the contact are fixed so that the bytes can be compared.

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// App.tsx's EMPTY_ANSWERS.
const EMPTY_ANSWERS = {
  organism: '', organismOther: '', library: '', strand: '', layout: '',
  genome: '', genomeOther: '', control: '', paired: '',
  deliver: ['deg', 'enrich', 'bundle', 'qc'], question: '',
}

const CONTACT = {
  name: 'Jane Doe', email: 'jane@example.org', org: 'Example University', project: 'Demo request',
  turnaround: 'standard', notes: '', agree: true,
}

const CLOCK = Date.UTC(2026, 0, 1)

export async function bulkDemoRequestJson(root) {
  const lib = name => import(pathToFileURL(resolve(root, 'src/lib', name)).href)
  const [{ demoFiles, demoCondition }, scan, { inferFromScan }, { buildRequest, makeRequestId }] =
    await Promise.all([lib('demo.ts'), lib('scan.ts'), lib('infer.ts'), lib('request.ts')])
  const { buildSamples, detectLayout, isFastq, usedGroups } = scan

  // loadDemo
  const files = demoFiles().filter(f => isFastq(f.name))
  const samples = buildSamples(files, 'auto').map(s => ({ ...s, condition: demoCondition(s.name) }))

  // the answers in force: the customer's where touched, inferred otherwise
  const answers = { ...EMPTY_ANSWERS, strand: 'reverse' }
  const inferred = inferFromScan(files, samples, detectLayout(samples), usedGroups(samples))
  for (const [k, v] of Object.entries(inferred)) if (v && !answers[k]) answers[k] = v.value
  if (answers.control && !usedGroups(samples).includes(answers.control)) answers.control = ''

  // StepRequest
  const a = { ...answers, layout: answers.layout || detectLayout(samples) }
  return JSON.stringify(
    buildRequest(makeRequestId(CLOCK), files, samples, a, CONTACT, new Date(CLOCK).toISOString()), null, 2)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.stdout.write(await bulkDemoRequestJson(process.argv[2] ?? '.'))
