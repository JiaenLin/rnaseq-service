// Pre-filling the questionnaire from what the file scan can prove.
//
// A wrong default in a scientific form is worse than a blank one, because it
// propagates into the analysis unchallenged. So every guess is returned with the
// evidence behind it and a `kind`:
//   detected — a concrete token was found in the file paths
//   assumed  — a safe default we still want the customer to confirm
// Anything we cannot support with evidence is left blank on purpose
// (strandedness especially: it is unknowable from filenames, and getting it
// wrong can halve the counts).

// Imports are type-only on purpose: this module stays free of runtime
// dependencies so `npm test` can execute it directly under Node.
import type { FastqFile, Inference, Inferences, Layout, Sample } from '../types'

/** Match a whole token, treating `_ - . /` as separators so "rat" misses "generated". */
export function findToken(hay: string, words: string): string | null {
  const m = hay.match(new RegExp(`(?:^|[^a-z0-9])(${words})(?:[^a-z0-9]|$)`, 'i'))
  return m ? m[1] : null
}

const rxEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ORGANISMS: [string, string][] = [
  ['human', 'human|homo[^a-z0-9]?sapiens|hsapiens|grch3[78]|hg19|hg38'],
  ['mouse', 'mouse|mice|mus[^a-z0-9]?musculus|grcm3[89]|mm9|mm10|mm39'],
  ['rat', 'rat|rats|rattus|rnor[^a-z0-9]?\\d|rn[456]'],
]

const BUILDS: [RegExp, string, boolean][] = [
  [/grch38|hg38/i, 'GRCh38', true],
  [/grcm39|mm39/i, 'GRCm39', true],
  [/grch37|hg19/i, 'GRCh37 / hg19', false],
  [/grcm38|mm10/i, 'GRCm38 / mm10', false],
]

// Order matters: a total-RNA or 3'-end kit must win before the generic "mrna".
const LIBRARIES: [string, string][] = [
  ['threeprime', "quantseq|brb[^a-z0-9]?seq|3[^a-z0-9]?end|three[^a-z0-9]?prime"],
  ['total', 'total[^a-z0-9]?rna|ribo[^a-z0-9]?zero|ribozero|ribominus|rrna[^a-z0-9]?depleted'],
  ['polya', 'poly[^a-z0-9]?a|polya|mrna|mrnaseq'],
]

const STRANDS: [string, string][] = [
  ['unstranded', 'unstranded|non[^a-z0-9]?stranded'],
  ['reverse', 'dutp|reverse[^a-z0-9]?stranded|fr[^a-z0-9]?firststrand'],
  ['forward', 'forward[^a-z0-9]?stranded|fr[^a-z0-9]?secondstrand'],
]

/** Whole group names that mean "this is the reference". */
export const CTRL_EXACT =
  /^(control|ctrl|ctl|wt|wildtype|wild[\W_]?type|untreated|untr|vehicle|veh|dmso|pbs|saline|mock|sham|naive|baseline|normal|healthy|parental|nc|neg|negative|scramble|scr|shscr|shnc|sinc|ev|empty|day\W?0|d0|t0|pre|uninfected|uninduced)$/i

/**
 * Substring fallback, e.g. "Adjacent_Normal" or "siScramble". `wt` is deliberately
 * absent — it hides inside words like "growth" — and `normal(?!i)` avoids matching
 * "Normalized".
 */
export const CTRL_PART =
  /control|ctrl|wild[\W_]?type|untreated|vehicle|dmso|mock|sham|naive|baseline|healthy|parental|scramble|negative|normal(?!i)/i

/**
 * Subject IDs that appear in *every* group — evidence of a paired design.
 * A bare number is rejected: WT_1/KO_1 are replicate indices, not one subject
 * measured twice, and calling that "paired" would corrupt the model.
 */
export function sharedSubjects(samples: Sample[], groups: string[]): string[] {
  if (groups.length < 2) return []
  const byGroup = new Map(groups.map(g => [g, new Set<string>()]))

  for (const s of samples) {
    const bucket = byGroup.get(s.condition)
    if (!bucket) continue
    const key = s.name
      .toLowerCase()
      .replace(new RegExp(rxEsc(s.condition.toLowerCase()), 'g'), ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
    if (key.length >= 2 && /[a-z]/.test(key)) bucket.add(key)
  }

  const [first, ...rest] = [...byGroup.values()]
  if (!first) return []
  return [...first].filter(k => rest.every(r => r.has(k)))
}

export function inferFromScan(
  files: FastqFile[], samples: Sample[], layout: Layout, groups: string[],
): Inferences {
  const out: Inferences = {}
  if (!files.length) return out

  const hay = files.map(f => f.path).join(' ') + ' ' + samples.map(s => s.name).join(' ')
  const set = (key: keyof Inferences, value: string, why: string, kind: Inference['kind'] = 'detected') => {
    if (value) out[key] = { value, why, kind }
  }

  // 4 · Read layout — the strongest signal available: R1 + R2 files per sample.
  if (layout !== 'mixed')
    set('layout', layout, layout === 'paired'
      ? 'every sample has an R1 and an R2 file'
      : 'one file per sample, no R2 found')

  // 1 · Organism — only when a species or genome token appears in the paths.
  for (const [value, words] of ORGANISMS) {
    const hit = findToken(hay, words)
    if (hit) { set('organism', value, `“${hit}” in your file paths`); break }
  }

  // 5 · Reference genome — a named build wins, else assume the current standard.
  const build = BUILDS.map(([rx, name, isLatest]) => {
    const m = hay.match(rx)
    return m ? { hit: m[0], name, isLatest } : null
  }).find(Boolean)

  if (build?.isLatest) {
    set('genome', 'latest', `“${build.hit}” in your file paths`)
  } else if (build) {
    set('genome', 'specific', `“${build.hit}” in your file paths`)
    set('genomeOther', build.name, `“${build.hit}” in your file paths`)
  } else {
    set('genome', 'latest', 'no build named in your files — this is our default', 'assumed')
  }

  // 2 · Library prep and 3 · strandedness — only when the provider spelled it out.
  for (const [value, words] of LIBRARIES) {
    const hit = findToken(hay, words)
    if (hit) { set('library', value, `“${hit}” in your file paths`); break }
  }
  for (const [value, words] of STRANDS) {
    const hit = findToken(hay, words)
    if (hit) { set('strand', value, `“${hit}” in your file paths`); break }
  }

  // 6 · Control group — from how the groups were named on the previous step.
  const ctrl = groups.find(g => CTRL_EXACT.test(g.trim())) ?? groups.find(g => CTRL_PART.test(g))
  if (ctrl) set('control', ctrl, `“${ctrl}” reads like a reference group`)

  // 7 · Paired design — needs a real shared subject ID, else assume independent.
  const shared = sharedSubjects(samples, groups)
  if (shared.length >= 2) {
    const names = shared.slice(0, 3).map(s => `“${s}”`).join(', ')
    set('paired', 'yes', `${names} appear in every group`)
  } else if (groups.length >= 2) {
    set('paired', 'no', 'no subject ID is shared between groups', 'assumed')
  }

  return out
}
