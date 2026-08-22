import { useState } from 'react'
import type { Sample } from '../types'
import { usedGroups } from '../lib/scan'
import { SectionHead, StepHead } from './Ui'
import { numberingGaps } from '../lib/identity'

interface Props {
  samples: Sample[]
  groups: string[]
  /** True when the groups were inferred from the file names, not typed. */
  detected: boolean
  onSamples: (s: Sample[]) => void
  onGroups: (g: string[]) => void
}

export default function StepSamples({ samples, groups, detected, onSamples, onGroups }: Props) {
  const [groupText, setGroupText] = useState(groups.join(', '))
  const [find, setFind] = useState('')
  const [repl, setRepl] = useState('')

  const patch = (i: number, next: Partial<Sample>) =>
    onSamples(samples.map((s, j) => (j === i ? { ...s, ...next } : s)))

  const mapNames = (fn: (s: Sample) => string) =>
    onSamples(samples.map(s => ({ ...s, name: fn(s) })))

  const dups = new Set(
    samples.map(s => s.name).filter((n, i, arr) => arr.indexOf(n) !== i),
  )
  const assigned = usedGroups(samples)
  const gaps = numberingGaps(samples.map(s => s.name))

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step C · Name samples"
        title="Tell us what each file actually is"
        lede="File names from the sequencer are rarely meaningful. Give every sample the name you want to see in your results, then assign it to a group."
      />

      <div>
        <SectionHead
          title="1 · What are your groups?"
          sub="Name the conditions you are comparing — exactly as they should appear in figures."
        />
        <input
          className="input max-w-md font-mono" value={groupText} placeholder="Control, Treated"
          onChange={e => {
            setGroupText(e.target.value)
            onGroups(e.target.value.split(',').map(t => t.trim()).filter(Boolean))
          }}
        />
        <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
          Comma-separated. Two groups is the standard comparison; more is fine, we run each against the control.
        </p>
        {detected && (
          <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
            <b>{groups.length} groups</b> and every sample's assignment were read from your file
            names — check the table below and correct anything that is wrong.
          </p>
        )}
      </div>

      <div>
        <SectionHead title="2 · Name each sample" sub="Edit any name. Bulk edits below apply to every row at once." />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            className="chip"
            onClick={() => mapNames(s => {
              const parts = s.files[0].path.split('/')
              return parts.length > 1 ? parts[parts.length - 2] : s.name
            })}
          >Name from parent folder</button>
          <button className="chip" onClick={() => mapNames(s => s.id)}>Reset to file stem</button>
          <input className="input w-28 font-mono" placeholder="find" value={find} onChange={e => setFind(e.target.value)} />
          <input className="input w-28 font-mono" placeholder="replace" value={repl} onChange={e => setRepl(e.target.value)} />
          <button
            className="chip"
            disabled={!find}
            onClick={() => mapNames(s => s.name.split(find).join(repl))}
          >Replace in all names</button>
        </div>

        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                {['#', 'Sample name', 'Group', 'Files', ''].map(h => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em]"
                    style={{ color: 'var(--ink-3)', background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={s.id}>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>{i + 1}</td>
                  <td className="min-w-[190px] px-3 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                    <input
                      className="input font-mono" value={s.name}
                      onChange={e => patch(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="min-w-[150px] px-3 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                    <select
                      className="input" value={groups.includes(s.condition) ? s.condition : ''}
                      onChange={e => patch(i, { condition: e.target.value })}
                    >
                      <option value="">— choose —</option>
                      {groups.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    {s.files.map(f => (
                      <div key={f.path}>{f.read && <b style={{ color: 'var(--ink-2)' }}>R{f.read} </b>}{f.name}</div>
                    ))}
                  </td>
                  <td className="px-2 py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
                    <button
                      className="rounded px-1.5 py-0.5 text-[15px] transition"
                      style={{ color: 'var(--ink-3)' }}
                      title="Exclude this sample"
                      onClick={() => onSamples(samples.filter((_, j) => j !== i))}
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-2.5 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
          {assigned.length
            ? 'Assigned — ' + assigned.map(g => `${g}: ${samples.filter(s => s.condition === g).length}`).join('  ·  ')
            : 'No groups assigned yet.'}
        </p>
      </div>

      {/* A reminder, not a gate.
          Which tube holds which animal cannot be checked from a file name, so
          nothing here validates it and nothing is blocked. It is said once,
          where the assignment is actually made, because it is the one mistake
          no software downstream can catch — a real request went out with two
          conditions exchanged and every step after this one carried it
          faithfully to the end. */}
      {assigned.length > 0 && (
        <div className="warnbox">
          <b>Only you can check this.</b> Group assignment is taken on trust by everything
          downstream — the pipeline, the statistics and the figures all carry it without
          question, and a sample in the wrong group produces a result rather than an error.
          Worth a moment against your own tube record, or a note to your sequencing provider,
          before you send this.
          {gaps.length > 0 && (
            <>
              {' '}Your samples are numbered with{' '}
              {gaps.length === 1 ? 'a gap' : 'gaps'} at <b>{gaps.join(', ')}</b> — so if you
              assigned groups by counting down a list rather than reading each tube, everything
              after {gaps.length === 1 ? 'it' : 'them'} is off by {gaps.length}.
            </>
          )}
        </div>
      )}

      {!!dups.size && (
        <div className="warnbox">
          <b>Duplicate sample names:</b>{' '}
          <code className="font-mono">{[...dups].join(', ')}</code>. Names must be unique.
        </div>
      )}
    </div>
  )
}
