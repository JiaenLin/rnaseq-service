// The experimental design of a single-cell request: the factors its libraries differ by, each
// factor's levels and reference level, the covariates, and a value of each for every library.
//
// All of it is the customer's. Nothing is read from a file name, nothing is pre-filled, and no
// reference level is ever chosen by default: it is a sign convention (every comparison of a factor
// is measured against it), and the customer owns it.
//
// What it becomes:
//   the request's `design` block: the factors with their levels and reference, the covariates, and
//   the sample × factor table;
//   design.csv (scSheets.ts), keyed on `sample`, for the profiling step's `--design`, read with a
//   `--factor` for each factor and a `--control <factor>=<reference>` for each reference level.
//   The covariates are the table's other columns, which that step keeps beside the factors for the
//   panels that state what a comparison is confounded with;
//   the factor and covariate columns of the QC samplesheet, the design its differential checks run across.
// No contrast is written: the profiling step enumerates them from the table.

import type { Contact } from '../types'
import type { ScLibrary, ScScan } from './scDelivery.ts'
import type { ScAnswers, ScInferences, ScRequest } from './scRequest.ts'
import { buildScRequest } from './scRequest.ts'
import { REQUEST_ONLY, RESERVED_COLUMNS } from './scColumns.ts'

type Library = ScLibrary & { name: string }

/** The design step's answers. Libraries and columns are keyed by stable ids, so a rename keeps the values. */
export interface ScDesignAnswers {
  /** `yes`: the libraries are compared, by the factors below; `no`: they are one group. Never pre-filled. */
  compare: '' | 'yes' | 'no'
  /** `levels` as typed, separated by commas; `reference` one of them, chosen by the customer. */
  factors: { key: string; name: string; levels: string; reference: string }[]
  covariates: { key: string; name: string }[]
  /** library id → column key → value */
  values: Record<string, Record<string, string>>
}

export const EMPTY_SC_DESIGN: ScDesignAnswers = { compare: '', factors: [], covariates: [], values: {} }

/** The design as the request carries it. */
export interface ScDesign {
  factors: { name: string; levels: string[]; reference: string }[]
  covariates: string[]
  /** One row per library, in delivery order: `sample`, each factor's level, each covariate's value. */
  table: Record<string, string>[]
}

export type ScDesignedRequest = ScRequest & { design: ScDesign }

/** Levels as typed: separated by commas. */
export const parseLevels = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)

/** A column key used by no column and by no value left behind by a removed one. */
export function nextKey(d: ScDesignAnswers): string {
  const used = new Set([
    ...d.factors.map(f => f.key), ...d.covariates.map(c => c.key),
    ...Object.values(d.values).flatMap(v => Object.keys(v)),
  ])
  let i = 1
  while (used.has(`k${i}`)) i++
  return `k${i}`
}

/** The design the answers describe, as the request carries it. A `no` keeps the covariates only. */
export function designFor(d: ScDesignAnswers, libraries: Library[]): ScDesign {
  const factors = d.compare === 'yes' ? d.factors : []
  return {
    factors: factors.map(f => ({ name: f.name.trim(), levels: parseLevels(f.levels), reference: f.reference })),
    covariates: d.covariates.map(c => c.name.trim()),
    table: libraries.map(l => {
      const v = d.values[l.id] ?? {}
      const row: Record<string, string> = { sample: l.name }
      for (const c of [...factors, ...d.covariates]) row[c.name.trim()] = (v[c.key] ?? '').trim()
      return row
    }),
  }
}

// Factor and covariate names become column names in two tables and terms in a model formula, so they
// start with a letter and hold letters, digits and "_". Levels and values become table cells, and
// labels in file names downstream.
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const LEVEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VALUE = /^[A-Za-z0-9._+-]+$/

const quoted = (xs: string[]) => xs.map(x => `“${x}”`).join(', ')

/** A row's own string value for a column, or '' (a table read from JSON is not trusted to have one). */
export const cell = (row: Record<string, unknown>, key: string): string =>
  Object.hasOwn(row, key) && typeof row[key] === 'string' ? row[key] as string : ''

/**
 * Why this design cannot be written, or null: the first problem, in the order the step asks.
 * `samples` are the request's library names, in delivery order.
 */
export function checkDesign(design: ScDesign, samples: string[]): string | null {
  // A design read back from a request file is checked for its shape first, so that a hand-edited one
  // is refused in words rather than by a TypeError.
  const shaped = Array.isArray(design?.factors) && Array.isArray(design.covariates) && Array.isArray(design.table) &&
    design.factors.every(f => typeof f?.name === 'string' && typeof f.reference === 'string' &&
      Array.isArray(f.levels) && f.levels.every(l => typeof l === 'string')) &&
    design.covariates.every(c => typeof c === 'string') &&
    design.table.every(r => !!r && typeof r === 'object')
  if (!shaped) return 'The design is not in the form this request writes: factors, covariates and a table.'
  const columns = [...design.factors.map(f => f.name), ...design.covariates]
  const nf = design.factors.length
  for (const [i, name] of columns.entries()) {
    if (!name) return `Name ${i < nf ? `factor ${i + 1}` : `covariate ${i - nf + 1}`}.`
    if (RESERVED_COLUMNS.includes(name.toLowerCase()))
      return `“${name}” cannot name a factor or covariate: it is ${REQUEST_ONLY.includes(name.toLowerCase())
        ? 'a field of this request' : 'one of the QC samplesheet’s own columns'}, which describes the run itself. ` +
        'Choose another name.'
    if (!NAME.test(name))
      return `“${name}”: a factor or covariate name starts with a letter and holds only letters, digits ` +
        'and “_”, so that a model formula can carry it.'
  }
  const seen = new Set<string>()
  for (const name of columns) {
    if (seen.has(name.toLowerCase())) return `“${name}” is used twice: every factor and covariate needs a name of its own.`
    seen.add(name.toLowerCase())
  }
  for (const f of design.factors) {
    const bad = f.levels.find(l => !LEVEL.test(l))
    if (bad !== undefined)
      return `${f.name}: “${bad}” cannot be a level. Use letters, digits, “.”, “_” and “-”, and separate levels with commas.`
    const twice = f.levels.find((l, i) => f.levels.indexOf(l) !== i)
    if (twice !== undefined) return `${f.name}: the level “${twice}” is listed twice.`
    if (f.levels.length < 2) return `${f.name} needs at least two levels, separated by commas: one level compares nothing.`
    if (!f.levels.includes(f.reference))
      return `Choose ${f.name}’s reference level. Every comparison of ${f.name} is measured against it, so it is ` +
        'never chosen for you.'
  }
  if (design.table.length !== samples.length || design.table.some((r, i) => cell(r, 'sample') !== samples[i]))
    return 'The design table does not list this request’s libraries, one row each, in delivery order.'
  for (const f of design.factors) {
    const none = design.table.filter(r => !f.levels.includes(cell(r, f.name))).map(r => r.sample)
    if (none.length) return `Give ${quoted(none)} a level of ${f.name}.`
    const unused = f.levels.find(l => !design.table.some(r => cell(r, f.name) === l))
    if (unused !== undefined) return `No library has ${f.name} = ${unused}: give one that level, or remove it.`
  }
  for (const c of design.covariates) {
    const none = design.table.filter(r => !cell(r, c).trim()).map(r => r.sample)
    if (none.length) return `Give ${quoted(none)} a value of ${c}.`
    const bad = design.table.find(r => !VALUE.test(cell(r, c)))
    if (bad) return `${c} for “${bad.sample}”: “${cell(bad, c)}” cannot be a value. Use letters, digits, “.”, “_”, “+” and “-”.`
  }
  return null
}

/** The first unanswered or invalid part of the design step, or null. */
export function designBlocker(d: ScDesignAnswers, libraries: Library[]): string | null {
  if (d.compare !== 'yes' && d.compare !== 'no')
    return 'Say whether the libraries are compared: yes, by one or more factors, or no, they are one group.'
  if (d.compare === 'yes' && !d.factors.length)
    return 'Add a factor: the libraries are compared, so at least one factor says how they differ.'
  return checkDesign(designFor(d, libraries), libraries.map(l => l.name))
}

/** Libraries per arm (one level of every factor), in the order the arms first appear. */
export function arms(design: ScDesign): [string, number][] {
  if (!design.factors.length) return []
  const n = new Map<string, number>()
  for (const r of design.table) {
    const arm = design.factors.map(f => cell(r, f.name) || '—').join(' × ')
    n.set(arm, (n.get(arm) ?? 0) + 1)
  }
  return [...n]
}

/**
 * The single-cell request with its design. The questionnaire's refusals come first (buildScRequest
 * throws them), then the design step's; a request is written only when both would let Continue.
 */
export function buildScRequestWithDesign(
  id: string, scan: ScScan, libraries: Library[], a: ScAnswers, inferred: ScInferences, c: Contact,
  createdISO: string, d: ScDesignAnswers,
): ScDesignedRequest {
  const req = buildScRequest(id, scan, libraries, a, inferred, c, createdISO)
  const refusal = designBlocker(d, libraries)
  if (refusal) throw new Error(refusal)
  return { ...req, design: designFor(d, libraries) }
}
