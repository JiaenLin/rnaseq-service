import type { AnswerKey, Answers, Inference, Inferences, Sample } from '../types'
import { detectLayout, usedGroups } from '../lib/scan'
import { DELIVERABLES } from '../lib/request'
import { AutoTag, CheckCards, Field, Mcq, SectionHead, StepHead, WhyLine } from './Ui'

interface Props {
  answers: Answers
  samples: Sample[]
  inferences: Inferences        // only the ones still in force (untouched)
  onAnswer: (k: AnswerKey, v: string) => void
  onDeliver: (v: string) => void
  onQuestion: (v: string) => void
  onClearAuto: () => void
}

export default function StepDesign(p: Props) {
  const { answers: a, inferences: inf } = p
  const groups = usedGroups(p.samples)
  const layout = detectLayout(p.samples)
  const auto = Object.values(inf).filter(Boolean) as Inference[]
  const nDetected = auto.filter(i => i.kind === 'detected').length

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step G · Design & analysis"
        title="A few questions about the experiment"
        lede="These determine how we quantify your reads and what we compare. Pick “Not sure” whenever you are — we will confirm before running anything."
      />

      {!!auto.length && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-r-xl px-3.5 py-2.5 text-[13px]"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderLeft: '2.5px solid var(--G)', color: 'var(--ink-2)' }}
        >
          <span className="base-mark base-g h-[22px] w-[22px] text-[11px]">?</span>
          <span className="flex-1">
            <b style={{ color: 'var(--ink)' }}>{auto.length} answer{auto.length > 1 ? 's' : ''} pre-filled</b>{' '}
            from your file names — {nDetected} detected, {auto.length - nDetected} assumed.
            Please check each one; every answer is editable.
          </span>
          <button className="chip" onClick={p.onClearAuto}>Clear pre-filled</button>
        </div>
      )}

      <div>
        <SectionHead title="1 · Which organism?" sub="Sets the reference genome and annotation." required />
        <Mcq
          name="organism" value={a.organism} inf={inf.organism} onPick={v => p.onAnswer('organism', v)}
          choices={[
            { value: 'human', title: 'Human', desc: 'Homo sapiens' },
            { value: 'mouse', title: 'Mouse', desc: 'Mus musculus' },
            { value: 'rat', title: 'Rat', desc: 'Rattus norvegicus' },
            { value: 'other', title: 'Something else', desc: 'Tell us below' },
          ]}
        />
        {a.organism === 'other' && (
          <div className="mt-3 max-w-sm">
            <Field label="Species name" value={a.organismOther} placeholder="e.g. Danio rerio" required
              onChange={v => p.onAnswer('organismOther', v)} />
          </div>
        )}
      </div>

      <div>
        <SectionHead title="2 · How was the library prepared?" sub="Determines which RNA we expect to see." required />
        <Mcq
          name="library" value={a.library} inf={inf.library} onPick={v => p.onAnswer('library', v)}
          choices={[
            { value: 'polya', title: 'Poly-A selected mRNA', desc: 'The default for most kits (TruSeq, NEBNext Ultra II)', tag: 'common' },
            { value: 'total', title: 'Total RNA / rRNA-depleted', desc: 'Ribo-Zero, RiboMinus — keeps non-coding RNA' },
            { value: 'threeprime', title: '3′-end counting', desc: 'QuantSeq, BRB-seq — one tag per transcript' },
            { value: 'unsure', title: 'Not sure', desc: 'We will infer it from the data' },
          ]}
        />
      </div>

      <div>
        <SectionHead
          title="3 · Was the library stranded?"
          sub="Getting this wrong can halve your counts, so we verify it against the data too."
          required
        />
        <Mcq
          name="strand" value={a.strand} inf={inf.strand} onPick={v => p.onAnswer('strand', v)}
          choices={[
            { value: 'reverse', title: 'Stranded, reverse', desc: 'dUTP protocols — the usual answer', tag: 'common' },
            { value: 'forward', title: 'Stranded, forward', desc: 'Ligation protocols' },
            { value: 'unstranded', title: 'Unstranded', desc: 'Older kits' },
            { value: 'unsure', title: 'Not sure', desc: 'We detect it automatically', tag: 'recommended' },
          ]}
        />
      </div>

      <div>
        <SectionHead
          title="4 · Read layout"
          sub={layout === 'mixed'
            ? 'Your files are mixed — some samples have R1 and R2, others only one. Tell us which is right.'
            : undefined}
          required
        />
        <Mcq
          name="layout" value={a.layout} inf={inf.layout} onPick={v => p.onAnswer('layout', v)}
          choices={[
            { value: 'paired', title: 'Paired-end', desc: 'Two files per sample (R1 and R2)' },
            { value: 'single', title: 'Single-end', desc: 'One file per sample' },
          ]}
        />
      </div>

      <div>
        <SectionHead title="5 · Reference genome" required />
        <Mcq
          name="genome" value={a.genome} inf={inf.genome} onPick={v => p.onAnswer('genome', v)}
          choices={[
            { value: 'latest', title: 'Latest standard build', desc: 'GRCh38 / GRCm39 with GENCODE annotation', tag: 'recommended' },
            { value: 'specific', title: 'A specific build', desc: 'Match an existing project' },
            { value: 'unsure', title: 'Not sure', desc: 'We use the latest standard build' },
          ]}
        />
        {a.genome === 'specific' && (
          <div className="mt-3 max-w-sm">
            <Field label="Which build & annotation?" value={a.genomeOther} placeholder="e.g. GRCh38 + GENCODE v44" required
              onChange={v => p.onAnswer('genomeOther', v)} />
          </div>
        )}
      </div>

      <div>
        <SectionHead
          title="6 · Which group is the control?"
          sub="Everything is compared against this reference — fold-changes are read as “other group vs control”."
          required
        />
        {!groups.length ? (
          <div className="warnbox">Assign samples to groups on the previous step first.</div>
        ) : (
          <>
            {inf.control && <WhyLine inf={inf.control} />}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {groups.map(g => {
                const n = p.samples.filter(s => s.condition === g).length
                return (
                  <label key={g} className="opt">
                    <input type="radio" name="control" checked={a.control === g} onChange={() => p.onAnswer('control', g)} />
                    <span>
                      <span className="text-sm font-medium leading-snug">
                        {g}{inf.control?.value === g && <AutoTag inf={inf.control} />}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-snug" style={{ color: 'var(--ink-2)' }}>
                        {n} sample{n > 1 ? 's' : ''} · everything else is compared to this
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </div>

      <div>
        <SectionHead
          title="7 · Are the groups from the same individuals?"
          sub="This decides whether we can pair samples up statistically — it matters a lot with few replicates."
          required
        />
        <Mcq
          name="paired" value={a.paired} inf={inf.paired} onPick={v => p.onAnswer('paired', v)}
          choices={[
            { value: 'no', title: 'No — different individuals', desc: 'Separate mice, donors, or cell-line batches per group', tag: 'common' },
            { value: 'yes', title: 'Yes — same individual in both groups', desc: 'e.g. before/after treatment in the same patient' },
          ]}
        />
      </div>

      <div>
        <SectionHead title="8 · What should we deliver?" sub="Pick everything you want back." required />
        <CheckCards options={DELIVERABLES} selected={a.deliver} onToggle={p.onDeliver} />
      </div>

      <div>
        <SectionHead
          title="9 · What is the biological question?"
          sub="One or two sentences. This is the single most useful thing you can tell us."
        />
        <textarea
          className="input min-h-[78px] resize-y leading-relaxed"
          placeholder="e.g. Does knocking out NR4A2 in microglia change the inflammatory response? We expect NF-κB targets to go up."
          value={a.question}
          onChange={e => p.onQuestion(e.target.value)}
        />
      </div>
    </div>
  )
}
