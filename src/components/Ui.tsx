// Small presentational pieces shared across the four wizard steps.
import type { ReactNode } from 'react'
import type { Inference } from '../types'

export function StepHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="mt-1.5 text-[23px] font-semibold tracking-tight text-balance">{title}</h2>
      <p className="mt-2 max-w-[62ch] text-[14.5px]" style={{ color: 'var(--ink-2)' }}>{lede}</p>
    </div>
  )
}

export function SectionHead({ title, sub, required }: { title: string; sub?: string; required?: boolean }) {
  return (
    <>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {required && <span className="font-mono text-xs" style={{ color: 'var(--crit)' }}>required</span>}
      </h3>
      {sub && <p className="mb-3 mt-0.5 max-w-[66ch] text-[13px]" style={{ color: 'var(--ink-3)' }}>{sub}</p>}
    </>
  )
}

export function Stat({ k, v, sub }: { k: string; v: ReactNode; sub?: string }) {
  return (
    <div className="stat">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--ink-3)' }}>{k}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight">
        {v}{sub && <small className="ml-1 text-xs font-normal" style={{ color: 'var(--ink-3)' }}>{sub}</small>}
      </div>
    </div>
  )
}

/** Provenance line above an auto-filled question. */
export function WhyLine({ inf }: { inf: Inference }) {
  return (
    <p className="-mt-1 mb-3 text-xs leading-snug" style={{ color: 'var(--ink-3)' }}>
      <span
        className="mr-1.5 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--ink-2)', border: '1px solid var(--line-2)' }}
      >
        {inf.kind === 'detected' ? 'Detected' : 'Assumed'}
      </span>
      {inf.why}
    </p>
  )
}

export const AutoTag = ({ inf }: { inf: Inference }) => (
  <span className={`tag ${inf.kind === 'detected' ? 'tag-det' : 'tag-asm'}`}>
    {inf.kind === 'detected' ? 'from your files' : 'assumed'}
  </span>
)

export interface Choice {
  value: string
  title: string
  desc?: string
  tag?: 'common' | 'recommended'
}

export function Mcq({ name, value, choices, inf, onPick }: {
  name: string
  value: string
  choices: Choice[]
  inf?: Inference
  onPick: (v: string) => void
}) {
  return (
    <>
      {inf && <WhyLine inf={inf} />}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {choices.map(c => (
          <label key={c.value} className="opt">
            <input type="radio" name={name} checked={value === c.value} onChange={() => onPick(c.value)} />
            <span>
              <span className="text-sm font-medium leading-snug">
                {c.title}
                {inf?.value === c.value && <AutoTag inf={inf} />}
                {c.tag && <span className={`tag ${c.tag === 'recommended' ? 'tag-rec' : ''}`}>{c.tag}</span>}
              </span>
              {c.desc && <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>{c.desc}</span>}
            </span>
          </label>
        ))}
      </div>
    </>
  )
}

export function CheckCards({ options, selected, onToggle }: {
  options: [string, string, string][]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {options.map(([v, title, desc]) => (
        <label key={v} className="opt">
          <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
          <span>
            <span className="text-sm font-medium leading-snug">{title}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>{desc}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

export function Field({ label, value, onChange, placeholder, required, type = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  type?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-[12.5px] font-medium">
        {label}
        {required && <span className="ml-1 font-mono text-xs" style={{ color: 'var(--crit)' }}>required</span>}
      </label>
      <input
        className="input" type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
