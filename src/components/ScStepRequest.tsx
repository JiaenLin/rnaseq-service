import { useState } from 'react'
import type { Contact } from '../types'
import { download } from '../lib/request'
import { fmtSize } from '../lib/scan'
import type { ScLibrary, ScScan } from '../lib/scDelivery'
import type { ScAnswers, ScInferences } from '../lib/scRequest'
import { SC_LABELS, scRequestFilename, speciesKey } from '../lib/scRequest'
import type { ScDesignAnswers } from '../lib/scDesign'
import { buildScRequestWithDesign, designFor } from '../lib/scDesign'
import { buildDesignCsv, buildRegistryTsv, buildScSamplesheet, stage1Refusals } from '../lib/scSheets'
import { Field, Mcq, SectionHead, StepHead } from './Ui'

interface Props {
  requestId: string
  scan: ScScan
  libraries: (ScLibrary & { name: string })[]
  answers: ScAnswers
  inferred: ScInferences
  design: ScDesignAnswers
  contact: Contact
  onContact: (k: keyof Contact, v: string | boolean) => void
}

export default function ScStepRequest(p: Props) {
  const { answers: a, contact: c } = p
  const [copied, setCopied] = useState(false)
  const design = designFor(p.design, p.libraries)
  const factors = design.factors
    .map(f => `${f.name}: ${f.levels.map(l => (l === f.reference ? `${l} (reference)` : l)).join(', ')}`)
    .join('  ×  ')

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
    ['design', p.design.compare === 'no' ? 'one group: nothing is compared' : factors || '—'],
    ['covariates', design.covariates.join(', ') || 'none'],
    ['question', a.question || '—'],
  ]

  const request = (createdISO: string) =>
    buildScRequestWithDesign(p.requestId, p.scan, p.libraries, a, p.inferred, c, createdISO, p.design)
  const json = () => JSON.stringify(request(new Date().toISOString()), null, 2)

  // The analysis files are written from the same request. Every earlier step has let Continue, so it
  // builds; what can still stop a file is an answer it needs, such as a reference left "not sure".
  const built = (() => { try { return request('') } catch { return null } })()
  const refusals = built ? stage1Refusals(built) : null
  const files: [string, string, keyof NonNullable<typeof refusals>, () => string, string][] = [
    ['QC samplesheet (.tsv)', `scrnaseq-samplesheet-${p.requestId}.tsv`, 'samplesheet',
      () => buildScSamplesheet(request('')), 'text/tab-separated-values'],
    ['Reference registry row (.tsv)', `scrnaseq-registry-${p.requestId}.tsv`, 'registry',
      () => buildRegistryTsv(request('')), 'text/tab-separated-values'],
    ['Design table (design.csv)', `scrnaseq-design-${p.requestId}.csv`, 'design',
      () => buildDesignCsv(request('')), 'text/csv'],
  ]
  const stopped = refusals && (refusals.samplesheet ?? refusals.registry ?? refusals.design)

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
          <Field label="Email" type="email" value={c.email} placeholder="jane@example.test" required onChange={v => p.onContact('email', v)} />
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

      <div>
        <SectionHead
          title="The analysis files"
          sub="Written from this request for the first analysis step: the quality-control samplesheet, its reference registry row, and the design table. Their paths are relative to the folder you dropped; we place them where your data lands."
        />
        <div className="flex flex-wrap gap-2.5">
          {files.map(([title, name, key, text, type]) => (
            <button
              key={key} className="btn" disabled={!refusals || !!refusals[key]}
              onClick={() => download(name, text(), type)}
            >{title}</button>
          ))}
        </div>
        {stopped && <div className="warnbox mt-3">{stopped}</div>}
      </div>

      <div className="note">
        <b>What happens next.</b> Send the request file with your data. We confirm scope, quote, the
        experimental design and turnaround before anything runs. The request records which answers you
        gave and which were read from your file names.
      </div>
    </div>
  )
}
