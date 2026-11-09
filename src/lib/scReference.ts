// The species and the reference build, held together.
//
// A reference key is `<species>/<build>`, and the QC tool resolves it through the project's registry.
// Both halves can be answered separately, so they can disagree: the paths name a human build, the
// customer changes the organism to mouse, and the request says `mus_musculus/GRCh38-2024-A`, a
// reference that does not exist. A build's name usually says its organism, so the two are checked
// against each other, at question 5 and again by every writer of the stage-1 files.
//
// A listed organism typed under "Something else" is held exactly as its button is, and written with
// its key (listedSpecies says which texts are read that way).
//
// What the check does NOT claim:
//   a build whose name says no organism, or two (a barnyard reference such as
//   GRCh38_and_GRCm39), implies nothing, and passes;
//   a species in the customer's own words that names no listed organism is theirs: another organism,
//   or a mixture such as a xenograft, which can be aligned to one organism's build, and only the
//   customer knows which. Such a text is never mapped to one organism's key.

import { findToken } from './infer.ts'

// The organism each family of build names belongs to: [registry key, word, build tokens].
const BUILDS: [string, string, string][] = [
  ['homo_sapiens', 'human', 'grch3[78]|hg19|hg38'],
  ['mus_musculus', 'mouse', 'grcm3[89]|mm9|mm10|mm39'],
  ['rattus_norvegicus', 'rat', 'rnor[_.-]?\\d|mratbn\\d|rn[4-7]'],
]

// The names a customer may type for each listed organism, as registry-key spellings.
const NAMES: [string, string[]][] = [
  ['homo_sapiens', ['human', 'humans', 'homo_sapiens']],
  ['mus_musculus', ['mouse', 'mice', 'mus_musculus']],
  ['rattus_norvegicus', ['rat', 'rats', 'rattus_norvegicus']],
]
// A strain designation holds a digit, "/" or "-" (C57BL/6J, BALB/c, Sprague-Dawley); a word naming an
// organism or a graft makes the text a mixture instead.
const STRAIN = /[0-9/-]/
const MIXTURE = /human|homo|sapien|mouse|mice|muscul|rattus|norveg|xeno|graft|chimer|hybrid|pdx/i

/**
 * The listed organism a species typed by hand names, as its registry key, or null. It is read as one
 * when it is that organism's common name or binomial, in any case or spacing ("Mouse", " MICE ",
 * "homo  sapiens", "mus_musculus"), or the binomial followed by ONE strain designation: a single word
 * holding a digit, "/" or "-" and no organism or graft word ("Mus musculus C57BL/6J"). Anything else
 * stays the customer's own words: another organism ("Danio rerio"), a common name with more words
 * ("C57BL/6 mouse"), or a mixture ("humanized mouse", "human xenograft in mouse"), which is never
 * mapped to one organism's key.
 */
export function listedSpecies(text: string): string | null {
  const key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const named = NAMES.find(([, names]) => names.includes(key))
  if (named) return named[0]
  const words = text.trim().split(/\s+/)
  if (words.length !== 3) return null
  const binomial = words.slice(0, 2).map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')).join('_')
  const listed = NAMES.find(([species]) => species === binomial)
  return listed && STRAIN.test(words[2]) && !MIXTURE.test(words[2]) ? listed[0] : null
}

/** The organism a build's name says, as a registry key; null when it says none, or more than one. */
export function buildSpecies(build: string): string | null {
  const hits = BUILDS.filter(([, , tokens]) => findToken(build, tokens))
  return hits.length === 1 ? hits[0][0] : null
}

/** The listed organism's word (human, mouse, rat) for its registry key. */
export const speciesWord = (species: string) => BUILDS.find(([key]) => key === species)?.[1]

/** Why `<species>/<build>` cannot be a reference, or null. `species` is the registry key, or a listed name. */
export function referenceSpeciesBlocker(species: string, build: string): string | null {
  const implied = buildSpecies(build)
  const held = listedSpecies(species) ?? species
  const said = speciesWord(held)
  if (!implied || !said || implied === held) return null
  return `“${build}” is a ${speciesWord(implied)} reference, and the organism is ${said} (question 4). Change ` +
    `one of them (question 5): ${species}/${build} names a reference that does not exist.`
}
