// The one signal the naming step names: a gap in a numbered series.
//
// Everything else about who a tube is cannot be checked from a file name, so
// nothing else is claimed. This is tested against the delivery that prompted it:
// R28DPCK, nineteen tubes numbered E1–E20 with E6 never shipped.

import { numberedAs, numberingGaps, prefixShape } from '../src/lib/identity.ts'

let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}`
    + (ok ? '' : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`))
}

const R28DPCK = [
  'L1MLG2101985-E1', 'L1MLG2101986-E2', 'L1MLG2101987-E3', 'L1MLG2101988-E4',
  'L1MLG2101989-E5', 'L1MLG2101991-E7', 'L1MLG2101992-E8', 'L1MLG2101993-E9',
  'L1MLG2101994-E10', 'L1MLG2101995-E11', 'L1MLG2101996-E12', 'L1MLG2101997-E13',
  'L1MLG2101998-E14', 'L1MLG2101999-E15', 'L1MLG2102000-E16', 'L1MLG2102001-E17',
  'L1MLG2102002-E18', 'L1MLG2102003-E19', 'L1MLG2102004-E20',
]

console.log('\nREADING A TRAILING NUMBER')
{
  check('found', numberedAs('L1MLG2101994-E10'), { prefix: 'L1MLG2101994-E', n: 10 })
  check('absent', numberedAs('SampleA'), null)
  // The shape is what makes these one series. Comparing raw prefixes made all
  // nineteen look separate, so the gap check never fired on the real delivery.
  check('digits blanked', prefixShape('L1MLG2101985-E'), 'L#MLG#-E')
  check('every tube shares one shape',
    new Set(R28DPCK.map(n => prefixShape(numberedAs(n).prefix))).size, 1)
}

console.log('\nTHE GAP')
{
  check('E6 is found in the real delivery', numberingGaps(R28DPCK), [6])
  check('a contiguous run is silent', numberingGaps(['E1', 'E2', 'E3', 'E4']), [])
  check('two gaps', numberingGaps(['E1', 'E2', 'E4', 'E6']), [3, 5])
}

console.log('\nWHEN IT SAYS NOTHING, WHICH IS MOST OF THE TIME')
{
  check('names with no number', numberingGaps(['WT_a', 'KO_b', 'X_c']), [])
  check('two numbering schemes', numberingGaps(['A1', 'A2', 'B7']), [])
  check('too few to be a series', numberingGaps(['E1', 'E9']), [])
  // Sparse numbers are not a series with holes; naming forty absent ones is noise.
  check('arbitrary numbers are not a series', numberingGaps(['E1', 'E50', 'E99']), [])
}

console.log(failed ? `\n${failed} test(s) failed\n` : '\nAll identity tests passed\n')
process.exit(failed ? 1 : 0)
