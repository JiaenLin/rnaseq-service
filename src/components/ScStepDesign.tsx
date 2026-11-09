import type { DeliveryKind, ScLibrary } from '../lib/scDelivery'
import { hasMatrix } from '../lib/scDelivery'
import type { ScAnswerKey, ScAnswers, ScInferences } from '../lib/scRequest'
import { SC_LABELS, mtRiboSuggestion, speciesKey } from '../lib/scRequest'
import { listedSpecies, speciesWord } from '../lib/scReference'
import { Field, Mcq, SectionHead, StepHead } from './Ui'

interface Props {
  kind: DeliveryKind
  answers: ScAnswers
  inferences: ScInferences // only the ones still in force (untouched)
  libraries: (ScLibrary & { name: string })[]
  onAnswer: (k: ScAnswerKey, v: string) => void
  onQuestion: (v: string) => void
}

const LAYOUT_PLATFORM: Record<string, string> = { cellranger: '10x', celescope: 'singleron' }

export default function ScStepDesign(p: Props) {
  const { answers: a, inferences: inf } = p
  const auto = Object.values(inf).filter(Boolean).length
  const noFiltered = p.libraries.filter(l => !hasMatrix(l.filtered)).map(l => l.name)
  const suggestion = mtRiboSuggestion(a.species)
  const expected = LAYOUT_PLATFORM[p.kind]
  const dbr = Number(a.dbrPercent)
  const listed = a.species === 'other' ? listedSpecies(a.speciesOther) : null

  return (
    <div className="space-y-6">
      <StepHead
        eyebrow="Step G · Single-cell questions"
        title="A few questions about the experiment"
        lede="These decide which quality-control rules apply and how each library is read. Some can be read from your file names; the first one never is."
      />

      {auto > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-r-xl px-3.5 py-2.5 text-[13px]"
          style={{ background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderLeft: '2.5px solid var(--G)', color: 'var(--ink-2)' }}
        >
          <span className="base-mark base-g h-[22px] w-[22px] text-[11px]">?</span>
          <span className="flex-1">
            <b style={{ color: 'var(--ink)' }}>{auto} answer{auto > 1 ? 's' : ''} pre-filled</b> from your file names.
            Please check each one; every answer is editable.
          </span>
        </div>
      )}

      <div>
        <SectionHead
          title="1 · Single cells or single nuclei?"
          sub="A whole cell and an isolated nucleus get different quality-control rules: a different mitochondrial bound and a different ambient-RNA policy. So this is never guessed, not from your file names and not by default."
          required
        />
        <Mcq
          name="assay" value={a.assay} onPick={v => p.onAnswer('assay', v)}
          choices={[
            { value: 'scrna', title: SC_LABELS.assay.scrna, desc: 'Whole cells: dissociated tissue, organoids, blood, cell lines' },
            { value: 'snrna', title: SC_LABELS.assay.snrna, desc: 'Isolated nuclei: frozen or hard-to-dissociate tissue, Multiome' },
          ]}
        />
        {a.assay === 'scrna' && noFiltered.length > 0 && (
          <div className="warnbox mt-3">
            For single cells the aligner's filtered matrix is the cell call, and{' '}
            <b>{noFiltered.join(', ')}</b> {noFiltered.length > 1 ? 'have' : 'has'} none. Ask your provider for it.
          </div>
        )}
        {a.assay === 'snrna' && noFiltered.length > 0 && (
          <div className="warnbox mt-3">
            For single nuclei, quality control compares the aligner's cell call with the denoiser's, and{' '}
            <b>{noFiltered.join(', ')}</b> {noFiltered.length > 1 ? 'have' : 'has'} no filtered matrix to give it. The
            request can still be sent, but the analysis files wait until your provider sends it.
          </div>
        )}
      </div>

      <div>
        <SectionHead title="2 · Platform" sub="Read from the layout of your files: each aligner belongs to one platform." required />
        <Mcq
          name="platform" value={a.platform} inf={inf.platform} onPick={v => p.onAnswer('platform', v)}
          choices={[
            { value: '10x', title: SC_LABELS.platform['10x'], desc: 'Chromium; processed with Cell Ranger' },
            { value: 'singleron', title: SC_LABELS.platform.singleron, desc: 'GEXSCOPE; processed with CeleScope' },
          ]}
        />
        {a.platform && expected && a.platform !== expected && (
          <div className="warnbox mt-3">
            Your files are {p.kind === 'cellranger' ? 'Cell Ranger' : 'CeleScope'} output, which comes
            from {SC_LABELS.platform[expected]}. Check this answer.
          </div>
        )}
      </div>

      <div>
        <SectionHead
          title="3 · Chemistry"
          sub="The kit version. It sets the expected doublet rate, and it can differ between libraries of one delivery."
          required
        />
        <Mcq
          name="chemistry" value={a.chemistry} onPick={v => p.onAnswer('chemistry', v)}
          choices={[
            { value: 'named', title: 'I know it', desc: 'Name it below, as your run summary does' },
            { value: 'unsure', title: 'Not sure', desc: 'The aligner records it for every library; we read it there' },
          ]}
        />
        {a.chemistry === 'named' && (
          <div className="mt-3 max-w-sm">
            <Field
              label="Chemistry" value={a.chemistryName} required
              placeholder={a.platform === 'singleron' ? 'e.g. GEXSCOPE-V3' : 'e.g. Single Cell 3′ v3.1'}
              onChange={v => p.onAnswer('chemistryName', v)}
            />
          </div>
        )}
      </div>

      <div>
        <SectionHead title="4 · Which organism?" sub="Sets the gene names quality control reads, and the reference." required />
        <Mcq
          name="species" value={a.species} inf={inf.species} onPick={v => p.onAnswer('species', v)}
          choices={[
            { value: 'human', title: 'Human', desc: 'Homo sapiens' },
            { value: 'mouse', title: 'Mouse', desc: 'Mus musculus' },
            { value: 'rat', title: 'Rat', desc: 'Rattus norvegicus' },
            { value: 'other', title: 'Something else', desc: 'Tell us below' },
          ]}
        />
        {a.species === 'other' && (
          <div className="mt-3 max-w-sm">
            <Field label="Species name" value={a.speciesOther} placeholder="e.g. Danio rerio" required
              onChange={v => p.onAnswer('speciesOther', v)} />
            {listed ? (
              <p className="mt-1.5 text-xs" style={{ color: 'var(--ink-3)' }}>
                Read as {speciesWord(listed)} (<code className="font-mono">{listed}</code>): checked against the reference
                exactly as the {speciesWord(listed)} button is.
              </p>
            ) : a.speciesOther.trim() && (
              <p className="mt-1.5 text-xs" style={{ color: 'var(--ink-3)' }}>
                Written as <code className="font-mono">{speciesKey(a)}</code>, and not checked against the reference
                build: only human, mouse or rat named plainly (by name or binomial, with at most one strain) are. A
                mixture such as a xenograft stays in your words.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHead
          title="5 · Which reference were the counts made against?"
          sub="The genome and annotation the aligner used. Your provider's run summary names it."
          required
        />
        <Mcq
          name="reference" value={a.reference} inf={inf.reference} onPick={v => p.onAnswer('reference', v)}
          choices={[
            { value: 'named', title: 'This reference', desc: 'Name the build below' },
            { value: 'unsure', title: 'Not sure', desc: 'We read it from each library’s run summary' },
          ]}
        />
        {a.reference === 'named' && (
          <div className="mt-3 max-w-sm">
            <Field label="Reference build" value={a.referenceName} placeholder="e.g. GRCh38-2024-A" required
              onChange={v => p.onAnswer('referenceName', v)} />
          </div>
        )}
      </div>

      <div>
        <SectionHead
          title="6 · Mitochondrial and ribosomal genes"
          sub="Matched case-sensitively against your reference's gene names. A wrong prefix matches nothing, and every cell then looks like a clean library, so nothing fills these in for you."
          required
        />
        {suggestion && (a.mtPrefix !== suggestion.mt || a.riboPattern !== suggestion.ribo) && (
          <button
            className="chip mb-3"
            onClick={() => { p.onAnswer('mtPrefix', suggestion.mt); p.onAnswer('riboPattern', suggestion.ribo) }}
          >Use the usual {a.species} convention: <code className="ml-1 font-mono">{suggestion.mt}</code> and{' '}
            <code className="ml-1 font-mono">{suggestion.ribo}</code></button>
        )}
        <div className="grid max-w-xl gap-3.5 sm:grid-cols-2">
          <Field label="Mitochondrial gene prefix" value={a.mtPrefix} placeholder="e.g. MT-" required
            onChange={v => p.onAnswer('mtPrefix', v)} />
          <Field label="Ribosomal gene pattern (regular expression)" value={a.riboPattern} placeholder="e.g. ^RP[SL]" required
            onChange={v => p.onAnswer('riboPattern', v)} />
        </div>
      </div>

      <div>
        <SectionHead
          title="7 · Expected doublet rate"
          sub="Two cells in one droplet. The rate depends on the chemistry and on how many cells each library recovered."
          required
        />
        <Mcq
          name="dbr" value={a.dbr} onPick={v => p.onAnswer('dbr', v)}
          choices={[
            { value: 'derive', title: 'Work it out for each library', desc: 'From the chemistry’s multiplet rate and each library’s cell count; confirmed with you before anything runs' },
            { value: 'stated', title: 'One rate for every library', desc: 'Give it below, as a percentage' },
          ]}
        />
        {a.dbr === 'stated' && (
          <div className="mt-3 flex max-w-sm items-end gap-3">
            <div className="flex-1">
              <Field label="Doublet rate (%)" value={a.dbrPercent} placeholder="e.g. 8" required
                onChange={v => p.onAnswer('dbrPercent', v)} />
            </div>
            {dbr > 0 && dbr < 100 && (
              <span className="pb-2 font-mono text-xs" style={{ color: 'var(--ink-3)' }}>= {Number((dbr / 100).toFixed(6))} of droplets</span>
            )}
          </div>
        )}
      </div>

      <div>
        <SectionHead
          title="8 · What is the biological question?"
          sub="One or two sentences. The factors your libraries differ by, and their levels, are asked in the next step."
        />
        <textarea
          className="input min-h-[78px] resize-y leading-relaxed"
          placeholder="e.g. Which cell types change in proportion after stimulation, and which genes respond in each?"
          value={a.question}
          onChange={e => p.onQuestion(e.target.value)}
        />
      </div>
    </div>
  )
}
