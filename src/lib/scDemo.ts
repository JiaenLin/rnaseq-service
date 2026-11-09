import type { FastqFile } from '../types'

// A synthetic single-cell delivery, Cell Ranger's own layout: one folder per library, its outs/
// inside. The folder name carries the organism and the reference build, which is what the
// single-cell questionnaire can read from it. It says nothing about cells or nuclei, and so the
// example, like every delivery, leaves that question to the customer.
const ROOT = '241105_10x_Human_PBMC_GRCh38-2024-A'
const LIBRARIES = ['Ctrl_1', 'Ctrl_2', 'Stim_1', 'Stim_2']

const OUTS: [string, number][] = [
  ['raw_feature_bc_matrix/barcodes.tsv.gz', 3.1e7],
  ['raw_feature_bc_matrix/features.tsv.gz', 3.3e5],
  ['raw_feature_bc_matrix/matrix.mtx.gz', 2.4e8],
  ['raw_feature_bc_matrix.h5', 1.2e8],
  ['filtered_feature_bc_matrix/barcodes.tsv.gz', 4.2e4],
  ['filtered_feature_bc_matrix/features.tsv.gz', 3.3e5],
  ['filtered_feature_bc_matrix/matrix.mtx.gz', 1.9e8],
  ['filtered_feature_bc_matrix.h5', 8.4e7],
  ['metrics_summary.csv', 1.2e3],
  ['web_summary.html', 4.6e6],
  ['molecule_info.h5', 3.5e8],
]

export function scDemoFiles(): FastqFile[] {
  return LIBRARIES.flatMap((lib, i) =>
    OUTS.map(([rel, size]) => ({
      name: rel.slice(rel.lastIndexOf('/') + 1),
      path: `${ROOT}/${lib}/outs/${rel}`,
      size: Math.round(size * (1 + i * 0.05)),
    })),
  )
}
