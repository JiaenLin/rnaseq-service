import { useState } from 'react'
import type { Contact } from '../types'
import { download } from '../lib/request'
import { fmtSize } from '../lib/scan'
import type { ScLibrary, ScScan } from '../lib/scDelivery'
import type { ScAnswers, ScInferences } from '../lib/scRequest'
import { SC_LABELS, buildScRequest, scRequestFilename, speciesKey } from '../lib/scRequest'
import { Field, Mcq, SectionHead, StepHead } from './Ui'

interface Props {
  requestId: string
  scan: ScScan
  libraries: (ScLibrary & { name: string })[]
  answers: ScAnswers
  inferred: ScInferences
  contact: Contact
  onContact: (k: keyof Contact, v: string | boolean) => void
}

export default function ScStepRequest(p: Props) {
  const { answers: a, contact: c } = p
  const [copied, setCopied] = useState(false)

  const rows: [string, string][] = [
    ['delivery', `${p.libraries.length} librar${p.libraries.length === 1 ? 'y' : 'ies'} · ${p.scan.kind === 'cellranger' ? 'Cell Ranger' : 'CeleScope'} output · ${fmtSize(p.scan.bytes)}`],
    ['libraries', p.libraries.map(l => l.name).join('  ·  ')],
    ['assay', SC_LABELS.assay[a.assay] ?? '—'],
    ['platform', SC_LABELS.platform[a.platform] ?? '—'],
    ['chemistry', a.chemistry === 'named' ? a.chemistryName.trim() : 'not sure: read per library'],
    ['organism', a.species === 'other' ? (a.speciesOther || 'other') : (SC_LABELS.species[a.species] ?? '—')],
    ['reference', a.reference === 'named' ? `${speciesKey(a)}/${a.referenceName.trim()}` : 'not sure: read from the run summary'],
    ['mitochondrial', a.mtPrefix.trim() || '—'],
    ['ribosomal', a.riboPattern.trim() || '—'],
    ['doublet rate', a.dbr === 'stated' ? `${a.dbrPercent.trim()} % for every library` : 'worked out per library'],
    ['design', 'not asked yet: see the question below'],
    ['question', a.question || '—'],
  ]

  const json = () => JSON.stringify(
    buildScRequest(p.requestId, p.scan, p.libraries, a, p.inferred, c, new Date().toISOString()), null, 2)

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step T · Review & send"
        title="Your single-cell request"
        lede="Check the summary, add your contact details, then download the request. Send it to us with your data and we will confirm scope and turnaround before anything runs."
      />

      <div>
        <SectionHead title="Contact" sub="So we can reply and quote." />
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Your name" value={c.name} placeholder="Jane Doe" required onChange={v => p.onContact('name', v)} />
          <Field label="Email" type="email" value={c.email} placeholder="jane@university.edu" required onChange={v => p.onContact('email', v)} />
          <Field label="Institution / company" value={c.org} placeholder="Your institute" onChange={v => p.onContact('org', v)} />
          <Field label="Project title" value={c.project} placeholder="Stimulated PBMC atlas" onChange={v => p.onContact('project', v)} />
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
          sub="Batches, failed libraries, hashing or multiplexing, a prior analysis to match."
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
          <span className="text-sm font-medium leading-snug">I confirm these libraries are correctly named</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>
            Library names carry through to every figure and table we return.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-2.5">
        <button
          className="btn btn-primary"
          onClick={() => download(scRequestFilename(p.requestId), json(), 'application/json')}
        >Download request (.json)</button>
        <button
          className="btn"
          onClick={async () => {
            try { await navigator.clipboard.writeText(json()); setCopied(true) } catch { setCopied(false) }
            setTimeout(() => setCopied(false), 1600)
          }}
        >{copied ? 'Copied' : 'Copy summary'}</button>
      </div>

      <div className="note">
        <b>What happens next.</b> Send the request file with your data. We confirm scope, quote, the
        experimental design and turnaround before anything runs. The request records which answers you
        gave and which were read from your file names.
      </div>
    </div>
  )
}
