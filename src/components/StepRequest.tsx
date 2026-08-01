import { useState } from 'react'
import type { Answers, Contact, FastqFile, Sample } from '../types'
import { detectLayout, fmtSize, totalBytes, usedGroups } from '../lib/scan'
import { buildRequest, buildSampleSheet, deliverableName, download, label } from '../lib/request'
import { Field, Mcq, SectionHead, StepHead } from './Ui'

interface Props {
  requestId: string
  files: FastqFile[]
  samples: Sample[]
  answers: Answers
  contact: Contact
  onContact: (k: keyof Contact, v: string | boolean) => void
}

const EXPLORER = 'https://jiaenlin.github.io/rnaseq-studio/'

export default function StepRequest(p: Props) {
  const { answers: a, contact: c } = p
  const [copied, setCopied] = useState(false)
  const groups = usedGroups(p.samples)
  const layout = a.layout || detectLayout(p.samples)

  const rows: [string, string][] = [
    ['files', `${p.files.length} FASTQ · ${fmtSize(totalBytes(p.files))}`],
    ['samples', `${p.samples.length} · ${layout === 'paired' ? 'paired-end' : 'single-end'}`],
    ['groups', groups.map(g => `${g} (n=${p.samples.filter(s => s.condition === g).length})`).join('  ·  ') || '—'],
    ['control', a.control || '—'],
    ['comparisons', groups.filter(g => g !== a.control).map(g => `${g} vs ${a.control}`).join('  ·  ') || '—'],
    ['organism', a.organism === 'other' ? (a.organismOther || 'other') : (label('organism', a.organism) || '—')],
    ['library', label('library', a.library) || '—'],
    ['strandedness', label('strand', a.strand) || '—'],
    ['genome', a.genome === 'specific' ? (a.genomeOther || 'specific') : (label('genome', a.genome) || '—')],
    ['design', a.paired === 'yes' ? 'Paired / repeated measures' : 'Independent samples'],
    ['deliverables', a.deliver.map(deliverableName).join('  ·  ') || '—'],
    ['question', a.question || '—'],
  ]

  const json = () => JSON.stringify(
    buildRequest(p.requestId, p.files, p.samples, a, c, new Date().toISOString()), null, 2)

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step T · Review & send"
        title="Your service request"
        lede="Check the summary, add your contact details, then download the request. Send it to us with your data and we will confirm scope and turnaround before anything runs."
      />

      <div>
        <SectionHead title="Contact" sub="So we can reply and quote." />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Your name" value={c.name} placeholder="Jane Doe" required onChange={v => p.onContact('name', v)} />
          <Field label="Email" type="email" value={c.email} placeholder="jane@university.edu" required onChange={v => p.onContact('email', v)} />
          <Field label="Institution / company" value={c.org} placeholder="Duke-NUS Medical School" onChange={v => p.onContact('org', v)} />
          <Field label="Project title" value={c.project} placeholder="NR4A2 knockout in microglia" onChange={v => p.onContact('project', v)} />
        </div>
      </div>

      <div>
        <SectionHead title="Turnaround" required />
        <Mcq
          name="turnaround" value={c.turnaround} onPick={v => p.onContact('turnaround', v)}
          choices={[
            { value: 'standard', title: 'Standard', desc: '10 working days', tag: 'common' },
            { value: 'priority', title: 'Priority', desc: '4 working days' },
            { value: 'flexible', title: 'No rush', desc: 'Whenever you have capacity' },
          ]}
        />
      </div>

      <div>
        <SectionHead
          title="Anything else we should know?"
          sub="Batches, failed samples, known contamination, a prior analysis to match."
        />
        <textarea
          className="input min-h-[78px] resize-y leading-relaxed" placeholder="Optional"
          value={c.notes} onChange={e => p.onContact('notes', e.target.value)}
        />
      </div>

      <div>
        <SectionHead title="Request summary" />
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--line)' }}>
          {rows.map(([k, v], i) => (
            <div
              key={k}
              className="grid gap-3 px-3.5 py-2 text-[13.5px] sm:grid-cols-[186px_1fr]"
              style={{
                borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : undefined,
                background: i % 2 ? 'var(--panel-2)' : undefined,
              }}
            >
              <div className="pt-0.5 font-mono text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{k}</div>
              <div className="font-medium">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <label className="opt">
        <input type="checkbox" checked={c.agree} onChange={e => p.onContact('agree', e.target.checked)} />
        <span>
          <span className="text-sm font-medium leading-snug">I confirm these samples are correctly named</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>
            Sample names and group assignments carry through to every figure and table we return.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2.5">
        <button
          className="btn btn-primary"
          onClick={() => download(`rnaseq-request-${p.requestId}.json`, json(), 'application/json')}
        >Download request (.json)</button>
        <button
          className="btn"
          onClick={() => download(`samplesheet-${p.requestId}.csv`, buildSampleSheet(p.samples, layout), 'text/csv')}
        >Download sample sheet (.csv)</button>
        <button
          className="btn"
          onClick={async () => {
            try { await navigator.clipboard.writeText(json()); setCopied(true) } catch { setCopied(false) }
            setTimeout(() => setCopied(false), 1600)
          }}
        >{copied ? 'Copied' : 'Copy summary'}</button>
      </div>

      <div className="note">
        <b>What happens next.</b> Send the request file with your data — we confirm scope, quote, and
        turnaround before anything runs. You get the deliverables above, and if you asked for a{' '}
        <a href={EXPLORER} target="_blank" rel="noreferrer" className="underline">Studio bundle</a>{' '}
        you can explore every gene yourself in the browser.
      </div>
    </div>
  )
}
