// Regression tests for the questionnaire inference (npm test, and in CI before deploy).
// Runs the real src/lib/infer.ts via Node's built-in TypeScript type-stripping,
// so these cases guard the shipped code rather than a copy of it.
import { CTRL_EXACT, CTRL_PART, inferFromScan, sharedSubjects } from '../src/lib/infer.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`)
}

/** Build the scan inputs from a folder path + sample/condition pairs. */
function scan(root, pairs, { paired = true } = {}) {
  const files = []
  const samples = pairs.map(([name, condition]) => {
    const reads = paired ? [1, 2] : [1]
    const sf = reads.map(r => ({
      name: `${name}_R${r}.fastq.gz`, path: `${root}/${name}_R${r}.fastq.gz`,
      size: 1e9, read: r, lane: null,
    }))
    files.push(...sf)
    return { id: name, name, condition, files: sf }
  })
  const groups = [...new Set(samples.map(s => s.condition).filter(Boolean))]
  return { files, samples, layout: paired ? 'paired' : 'single', groups }
}

const infer = (root, pairs, opts) => {
  const s = scan(root, pairs, opts)
  return inferFromScan(s.files, s.samples, s.layout, s.groups)
}

const WT_KO = [['WT_1', 'Control'], ['WT_2', 'Control'], ['KO_1', 'Treated'], ['KO_2', 'Treated']]

console.log('\nORGANISM / LIBRARY / GENOME — detected from folder names')
{
  const i = infer('250312_NovaSeq_Mouse_Brain_mRNAseq', WT_KO)
  check('demo delivery -> mouse', i.organism?.value, 'mouse')
  check('demo delivery -> poly-A', i.library?.value, 'polya')
  check('mouse folder, no build -> latest (assumed)', [i.genome?.value, i.genome?.kind], ['latest', 'assumed'])
}
check('GRCh38 + totalRNA -> human', infer('Proj_GRCh38_totalRNA', WT_KO).organism?.value, 'human')
check('GRCh38 + totalRNA -> total', infer('Proj_GRCh38_totalRNA', WT_KO).library?.value, 'total')
check('GRCh38 -> latest (detected)', infer('Proj_GRCh38_totalRNA', WT_KO).genome?.kind, 'detected')
check('hg19 -> specific build', infer('run_hg19_batch', WT_KO).genome?.value, 'specific')
check('hg19 -> build name filled', infer('run_hg19_batch', WT_KO).genomeOther?.value, 'GRCh37 / hg19')
check('QuantSeq -> 3-prime', infer('QuantSeq_hg19_batch', WT_KO).library?.value, 'threeprime')
check('Rat_Liver -> rat', infer('Rat_Liver_Study', WT_KO).organism?.value, 'rat')
check('no hints -> organism blank', infer('2026_delivery', WT_KO).organism, undefined)
check('no hints -> library blank', infer('2026_delivery', WT_KO).library, undefined)

console.log('\nSTRANDEDNESS — only ever when spelled out')
check('unnamed -> blank (never guessed)', infer('2026_delivery', WT_KO).strand, undefined)
check('"unstranded" in path -> unstranded', infer('lib_unstranded_run', WT_KO).strand?.value, 'unstranded')
check('"dUTP" in path -> reverse', infer('lib_dUTP_run', WT_KO).strand?.value, 'reverse')

console.log('\nFALSE POSITIVES — substrings must not trigger a species')
for (const bad of ['concentration_data', 'generated_reads', 'strategy_run', 'MouseBrainAtlas'])
  check(`"${bad}" -> no organism`, infer(bad, WT_KO).organism, undefined)

console.log('\nREAD LAYOUT')
check('R1+R2 -> paired', infer('run', WT_KO).layout?.value, 'paired')
check('R1 only -> single', infer('run', WT_KO, { paired: false }).layout?.value, 'single')

console.log('\nCONTROL GROUP')
const ctrlOf = groups => groups.find(g => CTRL_EXACT.test(g.trim())) ?? groups.find(g => CTRL_PART.test(g))
check('Control / Treated', ctrlOf(['Control', 'Treated']), 'Control')
check('KO / WT', ctrlOf(['KO', 'WT']), 'WT')
check('Tumor / Adjacent_Normal', ctrlOf(['Tumor', 'Adjacent_Normal']), 'Adjacent_Normal')
check('siNR4A2 / siScramble', ctrlOf(['siNR4A2', 'siScramble']), 'siScramble')
check('Day7 / Day0', ctrlOf(['Day7', 'Day0']), 'Day0')
check('GroupA / GroupB -> none', ctrlOf(['GroupA', 'GroupB']), undefined)
check('"Normalized" is not a control', ctrlOf(['Normalized', 'Raw']), undefined)
check('"Growth" does not match wt', ctrlOf(['Growth', 'Starved']), undefined)

console.log('\nPAIRED DESIGN — replicate numbers must not read as subjects')
const subj = pairs => sharedSubjects(
  pairs.map(([name, condition]) => ({ id: name, name, condition, files: [] })),
  [...new Set(pairs.map(p => p[1]))],
)
check('WT_1/KO_1 -> independent', subj(WT_KO), [])
check('groups WT/KO, samples WT_1/KO_1 -> independent',
  subj([['WT_1', 'WT'], ['WT_2', 'WT'], ['KO_1', 'KO'], ['KO_2', 'KO']]), [])
check('Patient1/2 pre+post -> paired',
  subj([['Patient1_Pre', 'Pre'], ['Patient2_Pre', 'Pre'], ['Patient1_Post', 'Post'], ['Patient2_Post', 'Post']]),
  ['patient1', 'patient2'])
check('DonorA/B in both arms -> paired',
  subj([['DonorA_Ctrl', 'Ctrl'], ['DonorB_Ctrl', 'Ctrl'], ['DonorA_Drug', 'Drug'], ['DonorB_Drug', 'Drug']]),
  ['donora', 'donorb'])
check('paired answer is "yes" when subjects repeat',
  infer('run', [['P1_Pre', 'Pre'], ['P2_Pre', 'Pre'], ['P1_Post', 'Post'], ['P2_Post', 'Post']]).paired?.value, 'yes')
check('paired answer is assumed "no" otherwise',
  [infer('run', WT_KO).paired?.value, infer('run', WT_KO).paired?.kind], ['no', 'assumed'])

console.log('\nEMPTY INPUT')
check('no files -> no inferences', inferFromScan([], [], 'single', []), {})

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll inference tests passed\n')
process.exit(failed ? 1 : 0)
