// Types for a service request. The request JSON produced here is the contract
// between a customer's raw FASTQ delivery and the analysis pipeline that runs it.

export interface FastqFile {
  name: string
  path: string
  size: number
}

export interface SampleFile extends FastqFile {
  read: 1 | 2 | null
  lane: string | null
}

export interface Sample {
  id: string          // stem the grouping was derived from (stable key)
  name: string        // what the customer wants it called in the results
  condition: string
  files: SampleFile[]
}

export type Pairing = 'auto' | 'one'
export type Layout = 'paired' | 'single' | 'mixed'

/** Keys of `Answers` that inference is allowed to fill in. */
export type AnswerKey =
  | 'organism' | 'organismOther'
  | 'library' | 'strand' | 'layout'
  | 'genome' | 'genomeOther'
  | 'control' | 'paired'

export interface Answers {
  organism: string
  organismOther: string
  library: string
  strand: string
  layout: string
  genome: string
  genomeOther: string
  control: string
  paired: string
  deliver: string[]
  question: string
}

export interface Contact {
  name: string
  email: string
  org: string
  project: string
  turnaround: string
  notes: string
  agree: boolean
}

/**
 * Why an answer was pre-filled. `detected` = a concrete token was found in the
 * file paths; `assumed` = a safe default we still want the customer to confirm.
 */
export interface Inference {
  value: string
  why: string
  kind: 'detected' | 'assumed'
}

export type Inferences = Partial<Record<AnswerKey, Inference>>

export interface ServiceRequest {
  request_id: string
  created: string
  contact: Omit<Contact, 'agree'>
  data: {
    n_fastq: number
    total_bytes: number
    layout: string
    samples: {
      sample: string
      condition: string
      files: { file: string; path: string; read: number | null; bytes: number }[]
    }[]
  }
  design: {
    groups: string[]
    control: string
    contrasts: { numerator: string; denominator: string }[]
    paired_design: boolean
  }
  protocol: {
    organism: string
    library: string
    strandedness: string
    genome: string
  }
  deliverables: string[]
  question: string
}
