// Step U: the single-cell design. Factors, their levels and the reference level of each, covariates,
// and a value of each for every library. Nothing is pre-filled; src/lib/scDesign.ts says why.
import type { ScLibrary } from '../lib/scDelivery'
import type { ScDesignAnswers } from '../lib/scDesign'
import { arms, designFor, nextKey, parseLevels } from '../lib/scDesign'
import { Field, Mcq, SectionHead, StepHead } from './Ui'

type Library = ScLibrary & { name: string }
type Factor = ScDesignAnswers['factors'][number]

interface Props {
  design: ScDesignAnswers
  libraries: Library[]
  onChange: (d: ScDesignAnswers) => void
}

const cellStyle = { borderBottom: '1px solid var(--line)' }

export default function ScStepFactors({ design: d, libraries, onChange }: Props) {
  const factors = d.compare === 'yes' ? d.factors : []
  const columns = [
    ...factors.map((f, i) => ({ key: f.key, label: f.name.trim() || `factor ${i + 1}`, levels: parseLevels(f.levels) })),
    ...d.covariates.map((c, i) => ({ key: c.key, label: c.name.trim() || `covariate ${i + 1}`, levels: null })),
  ]
  const summary = arms(designFor(d, libraries))

  const set = (patch: Partial<ScDesignAnswers>) => onChange({ ...d, ...patch })
  const setFactor = (key: string, patch: Partial<Factor>) =>
    set({ factors: d.factors.map(f => (f.key === key ? { ...f, ...patch } : f)) })
  const setValue = (lib: string, key: string, value: string) =>
    set({ values: { ...d.values, [lib]: { ...d.values[lib], [key]: value } } })
  // A removed column takes its values with it, so a column added later starts empty.
  const remove = (key: string) => set({
    factors: d.factors.filter(f => f.key !== key),
    covariates: d.covariates.filter(c => c.key !== key),
    values: Object.fromEntries(Object.entries(d.values).map(([lib, v]) =>
      [lib, Object.fromEntries(Object.entries(v).filter(([k]) => k !== key))])),
  })

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step U · Design"
        title="How do the libraries differ?"
        lede="Name each factor your libraries differ by, its levels, and the reference level that every comparison of it is measured against. Nothing here is read from your file names or filled in for you: the design is yours."
      />

      <div>
        <SectionHead
          title="1 · Are the libraries compared?"
          sub="Compared libraries differ by something you set or chose: a treatment, a genotype, a time point, or two of them crossed."
          required
        />
        <Mcq
          name="compare" value={d.compare} onPick={v => set({ compare: v === 'yes' ? 'yes' : 'no' })}
          choices={[
            { value: 'yes', title: 'Yes, by one or more factors', desc: 'Each library gets one level of every factor' },
            { value: 'no', title: 'No, they are one group', desc: 'An atlas or a reference: nothing is compared' },
          ]}
        />
      </div>

      {d.compare === 'yes' && (
        <div>
          <SectionHead
            title="2 · Factors"
            sub="Give each factor's levels, separated by commas, then choose its reference level. Every comparison of the factor is measured against that level, so the sign of every change depends on it: it is never chosen for you."
            required
          />
          <div className="space-y-3">
            {d.factors.map((f, i) => {
              const levels = parseLevels(f.levels)
              return (
                <div key={f.key} className="rounded-xl border p-3.5" style={{ borderColor: 'var(--line)' }}>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label={`Factor ${i + 1}`} value={f.name} placeholder="e.g. treatment" required
                      onChange={v => setFactor(f.key, { name: v })} />
                    <Field label="Its levels, separated by commas" value={f.levels} placeholder="e.g. vehicle, drug" required
                      onChange={v => setFactor(f.key, { levels: v })} />
                  </div>
                  {levels.length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[12.5px] font-medium">
                        Reference level
                        <span className="ml-1 font-mono text-xs" style={{ color: 'var(--crit)' }}>required</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {levels.map(l => (
                          <label key={l} className="chip inline-flex items-center gap-1.5">
                            <input type="radio" name={`reference-${f.key}`} checked={f.reference === l}
                              onChange={() => setFactor(f.key, { reference: l })} />
                            <code className="font-mono">{l}</code>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <button className="chip mt-3" onClick={() => remove(f.key)}>Remove this factor</button>
                </div>
              )
            })}
          </div>
          <button
            className="chip mt-3"
            onClick={() => set({ factors: [...d.factors, { key: nextKey(d), name: '', levels: '', reference: '' }] })}
          >+ Add a factor</button>
        </div>
      )}

      {d.compare && (
        <div>
          <SectionHead
            title={`${d.compare === 'yes' ? 3 : 2} · Covariates`}
            sub="Optional. Recorded for every library and kept beside the factors, but not compared: a batch, a sequencing run, sex, age. A comparison can be confounded with one, and the analysis then says so."
          />
          <div className="grid max-w-xl gap-3">
            {d.covariates.map((c, i) => (
              <div key={c.key} className="flex items-end gap-2.5">
                <div className="flex-1">
                  <Field label={`Covariate ${i + 1}`} value={c.name} placeholder="e.g. batch" required
                    onChange={v => set({ covariates: d.covariates.map(x => (x.key === c.key ? { ...x, name: v } : x)) })} />
                </div>
                <button className="chip mb-1" onClick={() => remove(c.key)}>Remove</button>
              </div>
            ))}
          </div>
          <button
            className="chip mt-3"
            onClick={() => set({ covariates: [...d.covariates, { key: nextKey(d), name: '' }] })}
          >+ Add a covariate</button>
        </div>
      )}

      {d.compare && columns.length > 0 && (
        <div>
          <SectionHead title="Each library" sub="One level of every factor, and a value of every covariate." required />
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  {['#', 'Library', ...columns.map(c => c.label)].map((h, i) => (
                    <th
                      key={`${i}-${h}`}
                      className="px-3 py-2 text-left font-mono text-[10.5px] uppercase tracking-[0.1em]"
                      style={{ color: 'var(--ink-3)', background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}
                    >{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {libraries.map((l, i) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 text-right font-mono text-[13px] tabular-nums" style={{ ...cellStyle, color: 'var(--ink-3)' }}>{i + 1}</td>
                    <td className="px-3 py-1.5 font-mono text-[13px]" style={cellStyle}>{l.name}</td>
                    {columns.map(c => {
                      const v = d.values[l.id]?.[c.key] ?? ''
                      return (
                        <td key={c.key} className="min-w-[130px] px-3 py-1.5" style={cellStyle}>
                          {c.levels ? (
                            <select className="input font-mono" value={c.levels.includes(v) ? v : ''}
                              onChange={e => setValue(l.id, c.key, e.target.value)}>
                              <option value="">—</option>
                              {c.levels.map(x => <option key={x} value={x}>{x}</option>)}
                            </select>
                          ) : (
                            <input className="input font-mono" value={v} onChange={e => setValue(l.id, c.key, e.target.value)} />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.length > 0 && (
        <div>
          <SectionHead title="Libraries per arm" sub="An arm is one level of every factor. An arm with one library has no replicate." />
          <div className="flex flex-wrap gap-2">
            {summary.map(([arm, n]) => (
              <span key={arm} className="chip font-mono">{arm}: {n}</span>
            ))}
          </div>
        </div>
      )}

      <div className="note">
        <b>No comparisons are listed.</b> The analysis enumerates them from this table, and measures each
        factor against the reference level you chose.
      </div>
    </div>
  )
}
