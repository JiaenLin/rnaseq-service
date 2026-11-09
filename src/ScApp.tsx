// The single-cell request: the bulk one's four steps and a design step (U), for a delivery of aligner output
// (Cell Ranger or CeleScope) rather than reads. App.tsx hands over here when `detectDelivery` finds
// one. The page frame below repeats App.tsx's on purpose: the bulk app is left as it was.
import { useMemo, useState } from 'react'
import type { Contact, FastqFile } from './types'
import { isJunk } from './lib/scan'
import { makeRequestId } from './lib/request'
import { deliveryBlocker, scanSingleCell } from './lib/scDelivery'
import { EMPTY_SC_ANSWERS, inferScAnswers, libraryNameBlocker, scQuestionBlocker } from './lib/scRequest'
import type { ScAnswerKey, ScAnswers, ScInferences } from './lib/scRequest'
import { EMPTY_SC_DESIGN, designBlocker } from './lib/scDesign'
import type { ScDesignAnswers } from './lib/scDesign'
import ScStepFiles from './components/ScStepFiles'
import ScStepSamples from './components/ScStepSamples'
import ScStepDesign from './components/ScStepDesign'
import ScStepFactors from './components/ScStepFactors'
import ScStepRequest from './components/ScStepRequest'

const STEPS = [
  { base: 'A', label: 'Delivery', sub: 'scan' },
  { base: 'C', label: 'Name libraries', sub: 'label' },
  { base: 'G', label: 'Single-cell questions', sub: 'answer' },
  { base: 'U', label: 'Design', sub: 'factors' },
  { base: 'T', label: 'Review & send', sub: 'submit' },
] as const

const EMPTY_CONTACT: Contact = {
  name: '', email: '', org: '', project: '', turnaround: '', notes: '', agree: false,
}

export default function ScApp({ incoming, onExit }: { incoming: FastqFile[]; onExit: () => void }) {
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<FastqFile[]>(incoming)
  const [names, setNames] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<ScAnswers>(EMPTY_SC_ANSWERS)
  const [touched, setTouched] = useState<ScAnswerKey[]>([])
  const [design, setDesign] = useState<ScDesignAnswers>(EMPTY_SC_DESIGN)
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT)
  const [requestId] = useState(() => makeRequestId())

  const scan = useMemo(() => scanSingleCell(files), [files])
  const libraries = useMemo(
    () => scan.libraries.map(l => ({ ...l, name: names[l.id] ?? l.label })),
    [scan, names],
  )

  // As in the bulk app: pre-filled answers are derived, never stored, and a touched answer is the
  // customer's from then on. The assay is never among them.
  const inferred = useMemo(() => inferScAnswers(scan, files.filter(f => !isJunk(f.path))), [scan, files])
  const liveInf = useMemo<ScInferences>(() => {
    const out: ScInferences = {}
    for (const [k, v] of Object.entries(inferred) as [keyof ScInferences, ScInferences[keyof ScInferences]][])
      if (!touched.includes(k)) out[k] = v
    return out
  }, [inferred, touched])
  const eff = useMemo<ScAnswers>(() => {
    const merged = { ...answers }
    for (const [k, v] of Object.entries(liveInf) as [keyof ScInferences, ScInferences[keyof ScInferences]][])
      if (v && !merged[k]) merged[k] = v.value
    return merged
  }, [answers, liveInf])

  const setAnswer = (k: ScAnswerKey, v: string) => {
    setAnswers(a => ({ ...a, [k]: v }))
    setTouched(t => (t.includes(k) ? t : [...t, k]))
  }

  const ingest = (more: FastqFile[]) =>
    setFiles(prev => {
      const seen = new Set(prev.map(f => f.path))
      return [...prev, ...more.filter(f => !seen.has(f.path))]
    })

  /* ---------- gating ---------- */
  const blockerAt = (i: number): string | null => {
    if (i === 0) return deliveryBlocker(scan.kind, libraries, scan.unsupported)
    if (i === 1) return libraryNameBlocker(libraries.map(l => l.name))
    if (i === 2) return scQuestionBlocker(eff, libraries)
    if (i === 3) return designBlocker(design, libraries)
    if (i === 4) {
      if (!contact.name.trim()) return 'Add your name.'
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return 'Add a valid email address.'
      if (!contact.turnaround) return 'Choose a turnaround.'
      if (!contact.agree) return 'Confirm the library names are correct.'
    }
    return null
  }

  const blocker = blockerAt(step)
  const last = step === STEPS.length - 1
  const go = (i: number) => { setStep(i); window.scrollTo({ top: 0 }) }
  const live = files.filter(f => !isJunk(f.path)).length

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20" style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="mx-auto flex h-[60px] max-w-[1180px] items-center gap-3.5 px-5">
          <svg className="h-[26px] w-[26px] flex-none" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round">
            <path d="M7 2c0 5 10 5 10 10S7 17 7 22" stroke="var(--C)" />
            <path d="M17 2c0 5-10 5-10 10s10 5 10 10" stroke="var(--T)" />
            <path d="M8.4 6h7.2M8.4 18h7.2M7.2 9.6h9.6M7.2 14.4h9.6" stroke="var(--ink-3)" strokeWidth="1.1" />
          </svg>
          <div className="font-semibold tracking-tight">
            RNA-seq Service
            <small className="block font-mono text-[11px] font-normal uppercase tracking-[0.09em]" style={{ color: 'var(--ink-3)' }}>
              Single-cell request
            </small>
          </div>
          <div className="flex-1" />
          <span className="hidden font-mono text-xs sm:block" style={{ color: 'var(--ink-3)' }}>
            Files are read in your browser only
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1180px] gap-8 px-5 pb-24 pt-7 md:grid-cols-[236px_1fr]">
        <nav className="flex gap-2 self-start overflow-x-auto md:sticky md:top-[88px] md:flex-col md:gap-0.5">
          <div className="hidden px-2 pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] md:block" style={{ color: 'var(--ink-3)' }}>
            Single-cell · 5 steps
          </div>
          {STEPS.map((s, i) => {
            const done = i < step && !blockerAt(i)
            return (
              <button
                key={s.base}
                disabled={i > step}
                onClick={() => i <= step && go(i)}
                className="flex w-full items-center gap-3 whitespace-nowrap rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-45"
                style={i === step
                  ? { background: 'var(--panel)', borderColor: 'var(--line)', boxShadow: 'var(--shadow)' }
                  : { borderColor: 'transparent' }}
              >
                <span className={`base-mark base-${s.base.toLowerCase()}`}>{s.base}</span>
                <span>
                  <span className="block text-[13.5px] font-medium leading-tight">{s.label}</span>
                  <span className="block font-mono text-[11px]" style={{ color: done ? 'var(--ok)' : 'var(--ink-3)' }}>
                    {done ? 'done' : s.sub}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        <main>
          <section className="panel step-enter" key={step}>
            {step === 0 && (
              <ScStepFiles scan={scan} libraries={libraries} files={live} onIngest={ingest} onReset={onExit} />
            )}
            {step === 1 && (
              <ScStepSamples
                libraries={libraries}
                onName={(id, name) => setNames(n => ({ ...n, [id]: name }))}
                onNames={next => setNames(next)}
              />
            )}
            {step === 2 && (
              <ScStepDesign
                kind={scan.kind} answers={eff} inferences={liveInf} libraries={libraries}
                onAnswer={setAnswer} onQuestion={v => setAnswers(a => ({ ...a, question: v }))}
              />
            )}
            {step === 3 && <ScStepFactors design={design} libraries={libraries} onChange={setDesign} />}
            {step === 4 && (
              <ScStepRequest
                requestId={requestId} scan={scan} libraries={libraries} answers={eff} inferred={liveInf}
                design={design} contact={contact} onContact={(k, v) => setContact(c => ({ ...c, [k]: v }))}
              />
            )}
          </section>

          <div
            className="sticky bottom-0 z-10 mt-6 flex items-center gap-3.5 py-3.5 backdrop-blur"
            style={{ background: 'color-mix(in srgb, var(--panel) 92%, transparent)', borderTop: '1px solid var(--line)' }}
          >
            <button className="btn" disabled={step === 0} onClick={() => go(step - 1)}>← Back</button>
            <div className="flex items-center gap-1">
              {STEPS.map((s, i) => (
                <i key={s.base} className="block h-1 w-5 rounded-sm" style={{ background: i <= step ? 'var(--accent)' : 'var(--line-2)' }} />
              ))}
            </div>
            <div className="flex-1 text-[12.5px]" style={{ color: blocker ? 'var(--warn)' : 'var(--ink-3)' }}>
              {blocker ?? (last ? 'Everything checks out — download your request above.' : '')}
            </div>
            <button
              className="btn btn-primary" disabled={!!blocker || last}
              onClick={() => !blocker && go(step + 1)}
            >{last ? 'Request ready ✓' : 'Continue →'}</button>
          </div>
        </main>
      </div>
    </div>
  )
}
