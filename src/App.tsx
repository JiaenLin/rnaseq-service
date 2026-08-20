import { useMemo, useState } from 'react'
import type { AnswerKey, Answers, Contact, FastqFile, Inferences, Pairing, Sample } from './types'
import { buildSamples, detectLayout, isFastq, isJunk, usedGroups } from './lib/scan'
import { inferFromScan } from './lib/infer'
import { detectGroups, isUsableDetection } from './lib/groups'
import { makeRequestId } from './lib/request'
import { demoCondition, demoFiles } from './lib/demo'
import StepFiles from './components/StepFiles'
import StepSamples from './components/StepSamples'
import StepDesign from './components/StepDesign'
import StepRequest from './components/StepRequest'

const STEPS = [
  { base: 'A', label: 'Sequencing files', sub: 'scan' },
  { base: 'C', label: 'Name samples', sub: 'label' },
  { base: 'G', label: 'Design & analysis', sub: 'answer' },
  { base: 'T', label: 'Review & send', sub: 'submit' },
] as const

const EMPTY_ANSWERS: Answers = {
  organism: '', organismOther: '', library: '', strand: '', layout: '',
  genome: '', genomeOther: '', control: '', paired: '',
  deliver: ['deg', 'enrich', 'bundle', 'qc'], question: '',
}

const EMPTY_CONTACT: Contact = {
  name: '', email: '', org: '', project: '', turnaround: '', notes: '', agree: false,
}

export default function App() {
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<FastqFile[]>([])
  const [other, setOther] = useState<string[]>([])
  const [skipped, setSkipped] = useState(0)
  const [scanned, setScanned] = useState(false)
  const [pairing, setPairing] = useState<Pairing>('auto')
  const [samples, setSamples] = useState<Sample[]>([])
  const [groups, setGroups] = useState<string[]>(['Control', 'Treated'])
  const [detectedGroups, setDetectedGroups] = useState(false)
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS)
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT)
  const [touched, setTouched] = useState<AnswerKey[]>([])
  const [autoCleared, setAutoCleared] = useState(false)
  const [requestId] = useState(() => makeRequestId())

  /* ---------- inference ----------
     Derived, never stored: the questionnaire shows the user's answer once they
     have touched a field, and the inferred one until then. That way a re-scan
     can never overwrite a deliberate choice, and no effect has to reconcile the
     two copies. */
  const inferred = useMemo<Inferences>(
    () => (autoCleared ? {} : inferFromScan(files, samples, detectLayout(samples), usedGroups(samples))),
    [autoCleared, files, samples],
  )
  const liveInf = useMemo<Inferences>(() => {
    const out: Inferences = {}
    for (const [k, v] of Object.entries(inferred))
      if (!touched.includes(k as AnswerKey)) out[k as AnswerKey] = v
    return out
  }, [inferred, touched])

  // The answers actually in force = user's where touched, inferred otherwise.
  const eff = useMemo<Answers>(() => {
    const merged = { ...answers }
    for (const [k, v] of Object.entries(liveInf)) {
      const key = k as AnswerKey
      if (v && !merged[key]) merged[key] = v.value
    }
    // A control group that no longer exists must not linger in the request.
    if (merged.control && !usedGroups(samples).includes(merged.control)) merged.control = ''
    return merged
  }, [answers, liveInf, samples])

  const setAnswer = (k: AnswerKey, v: string) => {
    setAnswers(a => ({ ...a, [k]: v }))
    setTouched(t => (t.includes(k) ? t : [...t, k]))
  }
  const toggleDeliver = (v: string) =>
    setAnswers(a => ({ ...a, deliver: a.deliver.includes(v) ? a.deliver.filter(d => d !== v) : [...a.deliver, v] }))
  const patchContact = (k: keyof Contact, v: string | boolean) =>
    setContact(c => ({ ...c, [k]: v }))

  const clearAuto = () => {
    setAnswers(a => {
      const next = { ...a }
      for (const k of Object.keys(liveInf)) next[k as AnswerKey] = ''
      return next
    })
    setAutoCleared(true)
  }

  /** Samples plus a design guessed from their names — 69 dropdowns is not a task. */
  const withDetectedGroups = (list: Sample[]) => {
    const detected = detectGroups(list.map(x => x.id))
    if (!isUsableDetection(detected, list.map(x => x.id))) return { samples: list, groups: null }
    const byId = new Map<string, string>()
    for (const g of detected) for (const id of g.samples) byId.set(id, g.name)
    return {
      samples: list.map(x => ({ ...x, condition: byId.get(x.id) ?? x.condition })),
      groups: detected.map(g => g.name),
    }
  }

  /* ---------- file intake ---------- */
  const ingest = (incoming: FastqFile[]) => {
    // Drop OS bookkeeping first. A macOS AppleDouble sidecar is named
    // `._Sample.R1.fastq.gz`, so it passes every FASTQ test we have and would
    // otherwise double the file count and halve the pairing.
    const real = incoming.filter(f => !isJunk(f.path))
    const fastq = real.filter(f => isFastq(f.name))
    const seen = new Set(files.map(f => f.path))
    const merged = [...files, ...fastq.filter(f => !seen.has(f.path))]
    merged.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

    setFiles(merged)
    setSamples(prev => {
      const built = buildSamples(merged, pairing, prev)
      // Only infer on a fresh scan; never overwrite conditions already assigned.
      if (prev.length) return built
      const { samples: withGroups, groups } = withDetectedGroups(built)
      if (groups) { setGroups(groups); setDetectedGroups(true) }
      return withGroups
    })
    setOther(real.filter(f => !isFastq(f.name)).map(f => f.name))
    setSkipped(incoming.length - real.length)
    setScanned(true)
    setAutoCleared(false)   // a changed corpus deserves a fresh look
  }

  const reset = () => {
    setFiles([]); setSamples([]); setOther([]); setSkipped(0); setScanned(false); setAutoCleared(false)
  }

  const loadDemo = () => {
    const list = demoFiles()
    const fastq = list.filter(f => isFastq(f.name))
    setFiles(fastq)
    setOther(list.filter(f => !isFastq(f.name)).map(f => f.name))
    setSkipped(0)
    setSamples(buildSamples(fastq, pairing).map(s => ({ ...s, condition: demoCondition(s.name) })))
    setGroups(['Control', 'Treated'])
    setScanned(true)
    setAutoCleared(false)
  }

  const repair = (p: Pairing) => { setPairing(p); setSamples(s => buildSamples(files, p, s)) }

  /* ---------- gating ---------- */
  const blockerAt = (i: number): string | null => {
    if (i === 0 && !files.length) return 'Add your sequencing folder to continue.'
    if (i === 1) {
      if (samples.some(s => !s.name.trim())) return 'Every sample needs a name.'
      const names = samples.map(s => s.name.trim())
      if (new Set(names).size !== names.length) return 'Sample names must be unique.'
      if (samples.some(s => !s.condition)) return 'Assign every sample to a group.'
      if (usedGroups(samples).length < 2) return 'You need at least two groups to compare.'
    }
    if (i === 2) {
      if (!eff.organism) return 'Pick an organism (question 1).'
      if (eff.organism === 'other' && !eff.organismOther.trim()) return 'Name the species (question 1).'
      if (!eff.library) return 'Pick a library prep (question 2).'
      if (!eff.strand) return 'Pick a strandedness (question 3).'
      if (!eff.layout) return 'Confirm the read layout (question 4).'
      if (!eff.genome) return 'Pick a reference genome (question 5).'
      if (eff.genome === 'specific' && !eff.genomeOther.trim()) return 'Name the genome build (question 5).'
      if (!eff.control) return 'Choose the control group (question 6).'
      if (!eff.paired) return 'Answer the paired-design question (question 7).'
      if (!eff.deliver.length) return 'Pick at least one deliverable (question 8).'
    }
    if (i === 3) {
      if (!contact.name.trim()) return 'Add your name.'
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) return 'Add a valid email address.'
      if (!contact.turnaround) return 'Choose a turnaround.'
      if (!contact.agree) return 'Confirm the sample names are correct.'
    }
    return null
  }

  const blocker = blockerAt(step)
  const last = step === STEPS.length - 1

  const go = (i: number) => { setStep(i); window.scrollTo({ top: 0 }) }

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
              Request builder
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
            Request · 4 steps
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
          {/* key={step} remounts on each step, which re-fires the @starting-style entrance */}
          <section className="panel step-enter" key={step}>
            {step === 0 && (
              <StepFiles
                files={files} other={other} skipped={skipped} scanned={scanned} pairing={pairing} samples={samples}
                onIngest={ingest} onPairing={repair} onDemo={loadDemo} onReset={reset}
              />
            )}
            {step === 1 && (
              <StepSamples
                samples={samples} groups={groups} detected={detectedGroups}
                onSamples={setSamples} onGroups={setGroups} />
            )}
            {step === 2 && (
              <StepDesign
                answers={eff} samples={samples} inferences={liveInf}
                onAnswer={setAnswer} onDeliver={toggleDeliver}
                onQuestion={v => setAnswers(a => ({ ...a, question: v }))}
                onClearAuto={clearAuto}
              />
            )}
            {step === 3 && (
              <StepRequest
                requestId={requestId} files={files} samples={samples}
                answers={{ ...eff, layout: eff.layout || detectLayout(samples) }}
                contact={contact} onContact={patchContact}
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
