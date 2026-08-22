// A reminder to check who each tube is, and one cheap signal worth naming.
//
// A real delivery went out with two samples' conditions exchanged. Every piece
// of software in the chain carried the mapping perfectly — this app's request
// JSON, the samplesheet, nf-core's staging, the counts matrix. It was found
// weeks later from the expression data.
//
// There was nothing to fix in any of it. Which tube holds which animal is not
// knowable from a file name, so this app cannot check it and should not pretend
// to: no confirmation gate, nothing blocked, no extra field in the request. What
// it can do is say, once, where somebody is assigning groups, that this is the
// one thing nobody downstream can catch — and point at the one shape in the file
// names that makes a slip likely.

/**
 * A trailing integer in a name. `L1MLG2101985-E1` -> 1.
 *
 * The prefix comes back too, because a series only means something within one
 * numbering scheme.
 */
export function numberedAs(name: string): { prefix: string; n: number } | null {
  const m = name.match(/^(.*?)(\d+)$/)
  if (!m) return null
  return { prefix: m[1], n: Number(m[2]) }
}

/**
 * A prefix with its digit runs blanked: `L1MLG2101985-E` -> `L#MLG#-E`.
 *
 * Comparing raw prefixes was wrong, and wrong on exactly the delivery this file
 * exists for: a vendor names a tube `L1MLG2101985-E1`, where BOTH the accession
 * and the lab's own number increment, so all nineteen had different prefixes and
 * looked like nineteen separate series. What has to match between two names in
 * one series is their SHAPE, not their characters.
 */
export const prefixShape = (prefix: string) => prefix.replace(/\d+/g, '#')

/**
 * Missing numbers in an otherwise contiguous run of sample names.
 *
 * Worth naming because of what it does to an assignment made by counting rather
 * than by reading. Tubes numbered E1–E20 with E6 never shipped look like
 * nineteen tubes in a row; "the first two are thermoneutral, the next three are
 * cold" then slips by one from the gap onward, and every sample after it is in
 * the wrong group while every name still reads perfectly sensibly.
 *
 * Returns [] whenever the names are not one numbered series — which is most of
 * the time, and silence is the right output then.
 */
export function numberingGaps(names: string[]): number[] {
  if (names.length < 3) return []
  const parsed = names.map(numberedAs)
  if (parsed.some(p => !p)) return []
  const shapes = new Set(parsed.map(p => prefixShape(p!.prefix)))
  if (shapes.size > 1) return []

  const ns = [...new Set(parsed.map(p => p!.n))].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = ns[0]; i <= ns[ns.length - 1]; i++) if (!ns.includes(i)) gaps.push(i)
  // More holes than tubes is not a series with gaps, it is an arbitrary set of
  // numbers, and listing forty absent numbers helps nobody.
  return gaps.length > ns.length ? [] : gaps
}
