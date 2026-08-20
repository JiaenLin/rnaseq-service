import { useEffect, useRef, useState } from 'react'
import type { FastqFile, Pairing, Sample } from '../types'
import { detectLayout, filesFromDataTransfer, filesFromInput, fmtSize, sampleLayout, totalBytes } from '../lib/scan'
import { SectionHead, Stat, StepHead } from './Ui'

interface Props {
  files: FastqFile[]
  other: string[]
  skipped: number
  scanned: boolean
  pairing: Pairing
  samples: Sample[]
  onIngest: (files: FastqFile[]) => void
  onPairing: (p: Pairing) => void
  onDemo: () => void
  onReset: () => void
}

export default function StepFiles(p: Props) {
  const [hot, setHot] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // `webkitdirectory` has no JSX attribute — set it on the element itself.
  useEffect(() => { if (dirRef.current) dirRef.current.webkitdirectory = true }, [])

  const layout = detectLayout(p.samples)

  return (
    <div className="space-y-5">
      <StepHead
        eyebrow="Step A · Sequencing files"
        title="Point us at your sequencing folder"
        lede="Drop the folder your sequencing provider delivered. We scan it in your browser, pick out every FASTQ, and group read pairs automatically. Nothing is uploaded at this stage."
      />

      <div
        className="rounded-2xl border border-dashed px-6 py-9 text-center transition"
        style={{
          borderColor: hot ? 'var(--accent)' : 'var(--line-2)',
          background: hot ? 'var(--accent-soft)' : 'var(--panel-2)',
        }}
        onDragEnter={e => { e.preventDefault(); setHot(true) }}
        onDragOver={e => { e.preventDefault(); setHot(true) }}
        onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setHot(false) }}
        onDrop={async e => {
          e.preventDefault(); setHot(false); setBusy(true)
          try { p.onIngest(await filesFromDataTransfer(e.dataTransfer)) } finally { setBusy(false) }
        }}
      >
        <h3 className="text-base font-semibold">{busy ? 'Scanning…' : 'Drop your sequencing folder here'}</h3>
        <p className="mt-1.5 text-[13.5px]" style={{ color: 'var(--ink-2)' }}>
          We look for <code className="font-mono">.fastq</code>, <code className="font-mono">.fq</code>,{' '}
          <code className="font-mono">.fastq.gz</code> and <code className="font-mono">.fq.gz</code>, including nested sub-folders.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2.5">
          <button className="btn btn-primary" onClick={() => dirRef.current?.click()}>Choose folder…</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Choose files…</button>
          {p.scanned
            ? <button className="btn" onClick={p.onReset}>Reset</button>
            : <button className="btn" onClick={p.onDemo}>Try example data</button>}
        </div>
        <p className="mt-3.5 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
          Your files never leave this computer — only names and sizes are read.
        </p>
        <input
          ref={dirRef} type="file" multiple hidden
          onChange={e => e.target.files && p.onIngest(filesFromInput(e.target.files))}
        />
        <input
          ref={fileRef} type="file" multiple hidden
          onChange={e => e.target.files && p.onIngest(filesFromInput(e.target.files))}
        />
      </div>

      {p.scanned && !p.files.length && (
        <div className="warnbox">
          <b>No FASTQ files found in that folder.</b> If your provider delivered a{' '}
          <code className="font-mono">.tar</code> or <code className="font-mono">.zip</code> archive,
          unpack it first, then drop the unpacked folder here.
          {!!p.skipped && (
            <> Everything in it looked like operating-system bookkeeping
            ({p.skipped} file{p.skipped > 1 ? 's' : ''} such as macOS{' '}
            <code className="font-mono">._</code> sidecars).</>
          )}
        </div>
      )}

      {!!p.files.length && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat k="FASTQ files" v={p.files.length} />
            <Stat k="Samples detected" v={p.samples.length} />
            <Stat
              k="Read layout"
              v={layout === 'paired' ? 'Paired' : layout === 'single' ? 'Single' : 'Mixed'}
              sub={layout === 'paired' ? 'R1 + R2' : layout === 'single' ? 'R1 only' : 'check below'}
            />
            <Stat k="Total size" v={fmtSize(totalBytes(p.files))} />
          </div>

          {layout === 'mixed' && (
            <div className="warnbox">
              <b>Mixed layout.</b> Some samples have both R1 and R2, others only one file.
              That is fine if it is real — just double-check the grouping below.
            </div>
          )}

          <div>
            <SectionHead
              title="Detected files"
              sub="Grouping is inferred from filename conventions. If it looks wrong, change how we split them."
            />
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[12.5px]" style={{ color: 'var(--ink-2)' }}>Group files into samples by:</span>
              <select
                className="input w-auto" value={p.pairing}
                onChange={e => p.onPairing(e.target.value as Pairing)}
              >
                <option value="auto">Filename convention (R1/R2, _1/_2, lanes)</option>
                <option value="one">One sample per file</option>
              </select>
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--line)' }}>
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr>
                    {['Sample stem', 'Files', 'Reads', 'Size'].map((h, i) => (
                      <th
                        key={h}
                        className={`px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.1em] ${i > 1 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--ink-3)', background: 'var(--sunk)', borderBottom: '1px solid var(--line)' }}
                      >{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.samples.map(s => (
                    <tr key={s.id}>
                      <td className="px-3 py-2 font-mono text-[13px] font-semibold" style={{ borderBottom: '1px solid var(--line)' }}>{s.id}</td>
                      <td className="px-3 py-2 font-mono text-[11.5px] leading-relaxed" style={{ color: 'var(--ink-3)', borderBottom: '1px solid var(--line)' }}>
                        {s.files.map(f => (
                          <div key={f.path}>
                            {f.read && <b style={{ color: 'var(--ink-2)' }}>R{f.read} </b>}{f.name}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right" style={{ borderBottom: '1px solid var(--line)' }}>
                        <span
                          className="pill"
                          style={sampleLayout(s) === 'paired'
                            ? { background: 'var(--C-bg)', color: 'var(--C)' }
                            : { background: 'var(--G-bg)', color: 'var(--G)' }}
                        >{sampleLayout(s) === 'paired' ? 'PE' : 'SE'}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums" style={{ color: 'var(--ink-2)', borderBottom: '1px solid var(--line)' }}>
                        {fmtSize(s.files.reduce((a, f) => a + f.size, 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!!p.other.length && (
              <p className="mt-2.5 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
                Ignored {p.other.length} non-FASTQ file{p.other.length > 1 ? 's' : ''}{' '}
                ({p.other.slice(0, 3).join(', ')}{p.other.length > 3 ? ', …' : ''})
              </p>
            )}

            {!!p.skipped && (
              <p className="mt-1 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>
                Skipped {p.skipped} operating-system file{p.skipped > 1 ? 's' : ''}{' '}
                (macOS <code>._</code> sidecars, <code>.DS_Store</code>, <code>__MACOSX</code>) —
                these are copies of your delivery&rsquo;s metadata, not sequencing data.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
