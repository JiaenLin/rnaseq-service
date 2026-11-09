import { useEffect, useRef, useState } from 'react'
import type { FastqFile } from '../types'
import { filesFromDataTransfer, filesFromInput, fmtSize } from '../lib/scan'
import type { ScLibrary, ScMatrix, ScScan } from '../lib/scDelivery'
import { SectionHead, Stat, StepHead } from './Ui'

type Library = ScLibrary & { name: string }

interface Props {
  scan: ScScan
  libraries: Library[]
  files: number
  onIngest: (files: FastqFile[]) => void
  onReset: () => void
}

const ALIGNER: Record<string, string> = { cellranger: 'Cell Ranger', celescope: 'CeleScope' }
const leaf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A matrix as the table shows it: what is there, or that it is missing. */
function MatrixCell({ m }: { m: ScMatrix }) {
  if (!m.matrix_dir && !m.h5) return <span className="pill" style={{ background: 'var(--crit-bg)', color: 'var(--crit)' }}>missing</span>
  return (
    <div className="font-mono text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
      {m.matrix_dir && <div>{leaf(m.matrix_dir)}/</div>}
      {m.h5 && <div>{leaf(m.h5)}</div>}
    </div>
  )
}

export default function ScStepFiles(p: Props) {
  const [hot, setHot] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirRef = useRef<HTMLInputElement>(null)

  // `webkitdirectory` has no JSX attribute — set it on the element itself.
  useEffect(() => { if (dirRef.current) dirRef.current.webkitdirectory = true }, [])

  const aligner = ALIGNER[p.scan.kind] ?? p.scan.kind
  const withProblems = p.libraries.filter(l => l.problems.length)
  const sideFiles = p.libraries.reduce((n, l) => n + l.other.length, 0)

  return (
    <div className="space-y-5">
      <StepHead
        eyebrow="Step A · Delivery"
        title={`A single-cell delivery: ${aligner} output`}
        lede="These are count matrices, not reads, so this becomes a single-cell request. For each library we found its raw matrix (every droplet, including the empty ones, which is where quality control starts) and its filtered matrix (the aligner's own cell call). Nothing is uploaded: only names and sizes are read."
      />

      <div
        className="flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed px-4 py-3 text-[13px] transition"
        style={{
          borderColor: hot ? 'var(--accent)' : 'var(--line-2)',
          background: hot ? 'var(--accent-soft)' : 'var(--panel-2)',
          color: 'var(--ink-2)',
        }}
        onDragEnter={e => { e.preventDefault(); setHot(true) }}
        onDragOver={e => { e.preventDefault(); setHot(true) }}
        onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setHot(false) }}
        onDrop={async e => {
          e.preventDefault(); setHot(false); setBusy(true)
          try { p.onIngest(await filesFromDataTransfer(e.dataTransfer)) } finally { setBusy(false) }
        }}
      >
        <span className="flex-1">{busy ? 'Scanning…' : 'Libraries in another folder? Drop it here to add them.'}</span>
        <button className="btn" onClick={() => dirRef.current?.click()}>Add folder…</button>
        <button className="btn" onClick={p.onReset}>Start over</button>
        <input
          ref={dirRef} type="file" multiple hidden
          onChange={e => e.target.files && p.onIngest(filesFromInput(e.target.files))}
        />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat k="Libraries" v={p.libraries.length} />
        <Stat k="Aligner" v={aligner} sub={p.scan.kind === 'cellranger' ? '10x' : 'Singleron'} />
        <Stat k="Files" v={p.files} />
        <Stat k="Total size" v={fmtSize(p.scan.bytes)} />
      </div>

      <div>
        <SectionHead
          title="Libraries"
          sub="One library per folder holding the matrices. You can rename them on the next step."
        />
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr>
                {['Library', 'Raw (every droplet)', 'Filtered (cell call)', 'Summary', 'Size'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] ${i === 4 ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--ink-3)', background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.libraries.map(l => (
                <tr key={l.id}>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="font-mono text-[13px] font-semibold">{l.name}</div>
                    <div className="font-mono text-[11px]" style={{ color: 'var(--ink-3)' }}>
                      {l.folder || '(top of the folder)'}{l.layout === 'outs' ? '/outs' : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}><MatrixCell m={l.raw} /></td>
                  <td className="px-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}><MatrixCell m={l.filtered} /></td>
                  <td className="px-3 py-2 font-mono text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                    {l.summary.length ? l.summary.map(s => <div key={s}>{leaf(s)}</div>) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums" style={{ color: 'var(--ink-2)', borderBottom: '1px solid var(--line)' }}>
                    {fmtSize(l.bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {withProblems.map(l => (
          <div key={l.id} className="warnbox mt-2.5">
            <b>{l.name}:</b> {l.problems.join('; ')}.
          </div>
        ))}

        {(sideFiles > 0 || p.scan.other.length > 0) && (
          <p className="mt-2.5 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
            Also in the delivery, and not part of the request: {sideFiles} other file{sideFiles === 1 ? '' : 's'} inside
            the libraries (BAM, molecule_info.h5 and the like)
            {p.scan.other.length > 0 && <>, and {p.scan.other.length} outside them
              ({p.scan.other.slice(0, 3).map(leaf).join(', ')}{p.scan.other.length > 3 ? ', …' : ''})</>}.
          </p>
        )}

        {!!p.scan.skipped && (
          <p className="mt-1 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
            Skipped {p.scan.skipped} operating-system file{p.scan.skipped > 1 ? 's' : ''}{' '}
            (macOS <code>._</code> sidecars, <code>.DS_Store</code>, <code>__MACOSX</code>).
          </p>
        )}
      </div>
    </div>
  )
}
