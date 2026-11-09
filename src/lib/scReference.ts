// The species and the reference build, held together.
//
// A reference key is `<species>/<build>`, and the QC tool resolves it through the project's registry.
// Both halves can be answered separately, so they can disagree: the paths name a human build, the
// customer changes the organism to mouse, and the request says `mus_musculus/GRCh38-2024-A`, a
// reference that does not exist. A build's name usually says its organism, so the two are checked
// against each other, at question 5 and again by every writer of the stage-1 files.
//
// What the check does NOT claim:
//   a build whose name says no organism, or two (a barnyard reference such as
//   GRCh38_and_GRCm39), implies nothing, and passes;
//   a species the customer writes in their own words is theirs: a xenograft or a hybrid can be
//   aligned to one organism's build, and only the customer knows. A known species written out by
//   hand ("Mus musculus") is held to the build like the listed ones.

import { findToken } from './infer.ts'

// The organism each family of build names belongs to: [registry key, word, build tokens].
const BUILDS: [string, string, string][] = [
  ['homo_sapiens', 'human', 'grch3[78]|hg19|hg38'],
  ['mus_musculus', 'mouse', 'grcm3[89]|mm9|mm10|mm39'],
  ['rattus_norvegicus', 'rat', 'rnor[_.-]?\\d|mratbn\\d|rn[4-7]'],
]

/** The organism a build's name says, as a registry key; null when it says none, or more than one. */
export function buildSpecies(build: string): string | null {
  const hits = BUILDS.filter(([, , tokens]) => findToken(build, tokens))
  return hits.length === 1 ? hits[0][0] : null
}

const word = (species: string) => BUILDS.find(([key]) => key === species)?.[1]

/** Why `<species>/<build>` cannot be a reference, or null. `species` is the registry key. */
export function referenceSpeciesBlocker(species: string, build: string): string | null {
  const implied = buildSpecies(build)
  const said = word(species)
  if (!implied || !said || implied === species) return null
  return `“${build}” is a ${word(implied)} reference, and the organism is ${said} (question 4). Change ` +
    `one of them (question 5): ${species}/${build} names a reference that does not exist.`
}
