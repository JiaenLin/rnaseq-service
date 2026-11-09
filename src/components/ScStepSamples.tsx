import { useState } from 'react'
import type { ScLibrary } from '../lib/scDelivery'
import { hasMatrix } from '../lib/scDelivery'
import { SectionHead, StepHead } from './Ui'

type Library = ScLibrary & { name: string }

interface Props {
  libraries: Library[]
  onName: (id: string, name: string) => void
  onNames: (names: Record<string, string>) => void
}

export default function ScStepSamples({ libraries, onName, onNames }: Props) {
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')

  const mapNames = (fn: (l: Library) => string) =>
    onNames(Object.fromEntries(libraries.map(l => [l.id, fn(l)])))

  const dups = new Set(libraries.map(l => l.name).filter((n, i, all) => all.indexOf(n) !== i))

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step C · Name libraries"
        title="What should each library be called?"
        lede="Every table, figure and report is keyed by these names. They start as the folder names; change any that should read differently in your results."
      />

      <div>
        <SectionHead title="Name each library" sub="Letters, digits, “.”, “_” and “-”: each name becomes part of a file name." />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className="chip" onClick={() => mapNames(l => l.label)}>Reset to folder names</button>
          <input className="input w-28 font-mono" placeholder="find" value={find} onChange={e => setFind(e.target.value)} />
          <input className="input w-28 font-mono" placeholder="replace" value={repl} onChange={e => setRepl(e.target.value)} />
          <button
            className="chip"
            disabled={!find}
            onClick={() => mapNames(l => l.name.split(find).join(repl))}
          >Replace in all names</button>
        </div>

        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr>
                {['#', 'Library name', 'Folder', 'Matrices'].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em]"
                    style={{ color: 'var(--ink-3)', background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {libraries.map((l, i) => (
                <tr key={l.id}>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>{i + 1}</td>
                  <td className="min-w-[190px] px-3 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                    <input className="input font-mono" value={l.name} onChange={e => onName(l.id, e.target.value)} />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11.5px]" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    {l.folder || '(top of the folder)'}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11.5px]" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    {[hasMatrix(l.raw) && 'raw', hasMatrix(l.filtered) && 'filtered'].filter(Boolean).join(' + ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!!dups.size && (
        <div className="warnbox">
          <b>Duplicate library names:</b>{' '}
          <code className="font-mono">{[...dups].join(', ')}</code>. Names must be unique.
        </div>
      )}

      <div className="note">
        <b>Groups and factors are not asked here yet.</b> A single-cell design can have several
        factors, with a reference level for each, and this form does not record one yet. Describe the
        comparison you want in the last question of the next step, and we will confirm the design with
        you before anything runs.
      </div>
    </div>
  )
}
