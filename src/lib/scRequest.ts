// The single-cell request: the questions, what may be pre-filled, what blocks Continue, and the JSON.
//
// The bulk request stays exactly as it was. It carries no `kind` field, so the bulk pipeline's intake
// reads it unchanged. This one says `kind: "single-cell"` first. Seven of its protocol fields carry the
// names of the single-cell QC samplesheet's columns (assay, platform, species,
// reference = <species>/<build>, mt_prefix, ribo_pattern, dbr), so that a later step can write that
// sheet without translating anything. `chemistry` and `dbr_method` are the request's own: they are
// not samplesheet columns and must never be copied into one, because the QC tool treats every column
// it does not reserve as a candidate design factor.
//
// What may be pre-filled, and why so little:
//   assay        NEVER. A cell and a nucleus get different mitochondrial bounds and a different
//                ambient-RNA policy. It is a fact about the experiment, and file names are not
//                evidence of it, so an unset assay blocks Continue.
//   platform     from the layout: Cell Ranger output is 10x, CeleScope output is Singleron.
//   organism     from a species or build token in the paths (the same tokens the bulk form reads).
//   reference    from a build token in the paths, e.g. a Cell Ranger refdata name.
//   mt / ribo    NEVER. A wrong prefix matches nothing, and every cell then looks like a clean
//                library. For human and mouse the documented convention is offered as a
//                suggestion the customer applies with a click.
//   chemistry, doublet rate   NEVER. They are asked. "Not sure" (chemistry) and "work it out per
//                library" (doublet rate) are answers, and the request records them as such.

import type { Contact, FastqFile, Inference } from '../types'
import { findToken, inferFromScan } from './infer.ts'
import type { DeliveryKind, ScLibrary, ScMatrix, ScScan } from './scDelivery.ts'
import { deliveryBlocker, hasMatrix } from './scDelivery.ts'
import { referenceSpeciesBlocker } from './scReference.ts'

export type Assay = 'scrna' | 'snrna'
export type Platform = '10x' | 'singleron'

export const ASSAYS: Assay[] = ['scrna', 'snrna']
export const PLATFORMS: Platform[] = ['10x', 'singleron']

/** The questionnaire's answers. An empty string is an unanswered question. */
export interface ScAnswers {
  assay: string // 'scrna' | 'snrna'
  platform: string // '10x' | 'singleron'
  chemistry: string // 'named' | 'unsure'
  chemistryName: string
  species: string // 'human' | 'mouse' | 'rat' | 'other'
  speciesOther: string
  reference: string // 'named' | 'unsure'
  referenceName: string
  mtPrefix: string
  riboPattern: string
  dbr: string // 'stated' | 'derive'
  dbrPercent: string
  question: string
}

export type ScAnswerKey = Exclude<keyof ScAnswers, 'question'>

/** Pre-filled answers with their evidence. The assay is excluded by type: nothing may infer it. */
export type ScInferences = Partial<Record<Exclude<ScAnswerKey, 'assay'>, Inference>>

export const EMPTY_SC_ANSWERS: ScAnswers = {
  assay: '', platform: '', chemistry: '', chemistryName: '', species: '', speciesOther: '',
  reference: '', referenceName: '', mtPrefix: '', riboPattern: '', dbr: '', dbrPercent: '', question: '',
}

export const SC_LABELS: Record<string, Record<string, string>> = {
  assay: { scrna: 'Single cells (scRNA-seq)', snrna: 'Single nuclei (snRNA-seq)' },
  platform: { '10x': '10x Genomics', singleron: 'Singleron' },
  species: { human: 'Human (Homo sapiens)', mouse: 'Mouse (Mus musculus)', rat: 'Rat (Rattus norvegicus)' },
}

/* ---------- what the delivery can tell us ---------- */

/** A reference build in the paths, whole: `refdata-gex-GRCh38-2024-A` gives `GRCh38-2024-A`. */
export function findBuild(hay: string): string | null {
  return findToken(hay, '(?:grch3[78]|grcm3[89]|hg19|hg38|mm10|mm39)(?:[-_.]\\d{4}[-_.][a-z])?')
}

export function inferScAnswers(scan: ScScan, files: FastqFile[]): ScInferences {
  const out: ScInferences = {}
  const set = (k: keyof ScInferences, value: string, why: string) => { out[k] = { value, why, kind: 'detected' } }

  if (scan.kind === 'cellranger') set('platform', '10x', 'Cell Ranger output (raw_feature_bc_matrix) in your files')
  if (scan.kind === 'celescope') set('platform', 'singleron', 'CeleScope output (outs/raw, outs/filtered) in your files')

  // The bulk form's organism tokens, false-positive guards included ("concentration" is not a rat).
  const organism = inferFromScan(files, [], 'single', []).organism
  if (organism) set('species', organism.value, organism.why)

  const build = findBuild(files.map(f => f.path).join(' '))
  if (build) {
    set('reference', 'named', `“${build}” in your file paths`)
    set('referenceName', build, `“${build}” in your file paths`)
  }
  return out
}

// The two conventions the single-cell QC tool itself documents when it refuses a run without them.
const MT_RIBO: Record<string, { mt: string; ribo: string }> = {
  human: { mt: 'MT-', ribo: '^RP[SL]' },
  mouse: { mt: 'mt-', ribo: '^Rp[sl]' },
}

/** A suggestion to apply with a click, never a default. Null where no convention is documented. */
export const mtRiboSuggestion = (species: string) =>
  Object.prototype.hasOwnProperty.call(MT_RIBO, species) ? MT_RIBO[species] : null

/* ---------- what blocks Continue ---------- */

const SPECIES_KEY: Record<string, string> = { human: 'homo_sapiens', mouse: 'mus_musculus', rat: 'rattus_norvegicus' }

/** The organism as the reference registry spells it: `homo_sapiens`, or the named species as a key. */
export function speciesKey(a: ScAnswers): string {
  if (a.species === 'other')
    return a.speciesOther.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return SPECIES_KEY[a.species] ?? ''
}

const isRegex = (s: string) => {
  try { new RegExp(s); return true } catch { return false }
}

const percent = (s: string) => {
  const t = s.trim()
  const x = Number(t)
  return t !== '' && Number.isFinite(x) && x > 0 && x < 100 ? x : null
}

const quoted = (names: string[]) => names.map(n => `“${n}”`).join(', ')

/** The first unanswered or invalid question, in the order they are asked, or null. */
export function scQuestionBlocker(a: ScAnswers, libraries: (ScLibrary & { name: string })[]): string | null {
  if (!a.assay)
    return 'Choose single cells or single nuclei (question 1). It is never guessed: the two get different quality-control rules.'
  if (!ASSAYS.includes(a.assay as Assay))
    return `“${a.assay}” is not an assay this request knows: choose single cells or single nuclei (question 1).`
  if (a.assay === 'scrna') {
    // For single cells the aligner's filtered matrix IS the cell call; QC refuses to run without it.
    const none = libraries.filter(l => !hasMatrix(l.filtered)).map(l => l.name)
    if (none.length)
      return `For single cells the aligner's filtered matrix is the cell call, and ${quoted(none)} ` +
        `${none.length > 1 ? 'have' : 'has'} none (question 1).`
  }
  if (!PLATFORMS.includes(a.platform as Platform)) return 'Confirm the platform (question 2).'
  if (!a.chemistry) return 'Name the chemistry, or choose Not sure (question 3).'
  if (a.chemistry === 'named' && !a.chemistryName.trim()) return 'Name the chemistry (question 3).'
  if (!a.species) return 'Pick an organism (question 4).'
  if (a.species === 'other' && !speciesKey(a)) return 'Name the species (question 4).'
  if (!a.reference) return 'Name the reference, or choose Not sure (question 5).'
  if (a.reference === 'named' && !a.referenceName.trim()) return 'Name the reference build (question 5).'
  if (a.reference === 'named' && a.referenceName.includes('/'))
    return 'Write the reference build without a slash (question 5): the registry key is <species>/<build>.'
  // The two halves of the key, held together (scReference.ts): a kept build under a changed organism.
  const clash = a.reference === 'named' ? referenceSpeciesBlocker(speciesKey(a), a.referenceName.trim()) : null
  if (clash) return clash
  if (!a.mtPrefix.trim()) return 'Give the mitochondrial gene prefix (question 6).'
  if (!a.riboPattern.trim()) return 'Give the ribosomal gene pattern (question 6).'
  if (!isRegex(a.riboPattern.trim())) return 'The ribosomal gene pattern is not a valid regular expression (question 6).'
  if (!a.dbr) return 'Choose how the doublet rate is set (question 7).'
  if (a.dbr === 'stated' && percent(a.dbrPercent) === null)
    return 'Give the doublet rate as a percentage above 0 and below 100 (question 7).'
  return null
}

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Library names become file names in every output, so they are kept to a safe alphabet. */
export function libraryNameBlocker(names: string[]): string | null {
  if (names.some(n => !n.trim())) return 'Every library needs a name.'
  const bad = names.find(n => !NAME_OK.test(n))
  if (bad !== undefined)
    return `“${bad}”: use letters, digits, “.”, “_” and “-” only. Every output file is named after its library.`
  if (new Set(names).size !== names.length) return 'Library names must be unique.'
  return null
}

/* ---------- the request ---------- */

export interface ScRequest {
  kind: 'single-cell'
  request_id: string
  created: string
  contact: Omit<Contact, 'agree'>
  data: {
    delivery: DeliveryKind
    n_files: number
    total_bytes: number
    libraries: {
      sample: string
      folder: string
      raw: ScMatrix
      filtered: ScMatrix
      summary: string[]
      bytes: number
    }[]
  }
  protocol: {
    assay: Assay
    platform: Platform
    /** Request only, never a samplesheet column. null: not stated; the processor records it per library. */
    chemistry: string | null
    species: string
    /** `<species>/<build>`, or null when the customer is not sure. */
    reference: string | null
    mt_prefix: string
    ribo_pattern: string
    /** A fraction, as the doublet caller takes it (8 % is 0.08); null when it is to be derived. */
    dbr: number | null
    /** Request only, never a samplesheet column. `derive`: per library, from the chemistry's
     *  multiplet rate and the aligner's cell count. */
    dbr_method: 'stated' | 'derive'
  }
  /** Who gave each answer: the customer, or the file names. */
  answered_by: Record<'assay' | 'platform' | 'chemistry' | 'species' | 'reference' | 'mt_prefix' | 'ribo_pattern' | 'dbr',
    'user' | 'detected'>
  question: string
}

/**
 * The request JSON. Refuses (throws, with the reason) whatever the questionnaire would block,
 * so a request without an assay cannot be written by any route.
 * `inferred` is the pre-filled answers still in force, the ones the customer has not touched.
 */
export function buildScRequest(
  id: string, scan: ScScan, libraries: (ScLibrary & { name: string })[], a: ScAnswers,
  inferred: ScInferences, c: Contact, createdISO: string,
): ScRequest {
  const refusal = deliveryBlocker(scan.kind, libraries, scan.unsupported)
    ?? libraryNameBlocker(libraries.map(l => l.name))
    ?? scQuestionBlocker(a, libraries)
  if (refusal) throw new Error(refusal)

  // "detected" only while EVERY key of the answer is still the file names': a retyped build, or
  // "Not sure" over a detected one, is the customer's answer.
  const by = (...keys: (keyof ScInferences)[]) => (keys.every(k => inferred[k]) ? 'detected' as const : 'user' as const)
  const species = speciesKey(a)
  const dbr = a.dbr === 'stated' ? Number((percent(a.dbrPercent)! / 100).toFixed(6)) : null
  return {
    kind: 'single-cell',
    request_id: id,
    created: createdISO,
    contact: {
      name: c.name, email: c.email, org: c.org,
      project: c.project, turnaround: c.turnaround, notes: c.notes,
    },
    data: {
      delivery: scan.kind,
      n_files: scan.n_files,
      total_bytes: scan.bytes,
      libraries: libraries.map(l => ({
        sample: l.name,
        folder: l.folder,
        raw: { ...l.raw },
        filtered: { ...l.filtered },
        summary: [...l.summary],
        bytes: l.bytes,
      })),
    },
    protocol: {
      assay: a.assay as Assay,
      platform: a.platform as Platform,
      chemistry: a.chemistry === 'named' ? a.chemistryName.trim() : null,
      species,
      reference: a.reference === 'named' ? `${species}/${a.referenceName.trim()}` : null,
      mt_prefix: a.mtPrefix.trim(),
      ribo_pattern: a.riboPattern.trim(),
      dbr,
      dbr_method: a.dbr === 'stated' ? 'stated' : 'derive',
    },
    answered_by: {
      assay: 'user',
      platform: by('platform'),
      chemistry: by('chemistry', 'chemistryName'),
      species: by('species'),
      reference: by('reference', 'referenceName'),
      mt_prefix: by('mtPrefix'),
      ribo_pattern: by('riboPattern'),
      dbr: by('dbr', 'dbrPercent'),
    },
    question: a.question,
  }
}

export const scRequestFilename = (id: string) => `scrnaseq-request-${id}.json`
