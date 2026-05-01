import fs from 'fs';
import path from 'path';
import { DATASET_VERSION } from '../lib/retrieval/types';

export type DatasetMetadata = {
  dataset_version: string;
  generated_at: string;
  generator: string;
};

type DatasetCarrier = {
  dataset_version?: unknown;
};

export function buildDatasetMetadata(generator: string): DatasetMetadata {
  return {
    dataset_version: DATASET_VERSION,
    generated_at: new Date().toISOString(),
    generator,
  };
}

export function validateDatasetVersion(data: unknown): void {
  const candidate = data as DatasetCarrier | null;
  const datasetVersion = candidate?.dataset_version;
  if (typeof datasetVersion !== 'string') {
    throw new Error('Dataset metadata missing required "dataset_version".');
  }
  if (datasetVersion !== DATASET_VERSION) {
    throw new Error(
      `Dataset version mismatch: expected "${DATASET_VERSION}", got "${datasetVersion}".`
    );
  }
}

export function isDatasetAvailable(filePath: string): boolean {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.warn(`[dataset] Missing dataset file: ${absolutePath}`);
    return false;
  }

  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    validateDatasetVersion(parsed);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dataset] Invalid dataset file: ${absolutePath} (${message})`);
    return false;
  }
}
