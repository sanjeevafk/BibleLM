import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

const datasetCache = new Map<string, unknown>();
const datasetInflight = new Map<string, Promise<unknown | null>>();
const missingDatasets = new Set<string>();

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

export function resolveDatasetPath(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveDatasetFilePath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function readDatasetFile(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath);

  if (filePath.endsWith('.br')) {
    return (await brotliDecompress(raw)).toString('utf8');
  }

  if (filePath.endsWith('.gz')) {
    return (await gunzip(raw)).toString('utf8');
  }

  return raw.toString('utf8');
}

async function loadDatasetInternal<T>(
  datasetKey: string,
  candidatePaths: string[],
  parser: (raw: string) => T | Promise<T>
): Promise<T | null> {
  if (datasetCache.has(datasetKey)) {
    return datasetCache.get(datasetKey) as T | null;
  }

  if (missingDatasets.has(datasetKey)) {
    return null;
  }

  const inFlight = datasetInflight.get(datasetKey);
  if (inFlight) {
    return inFlight as Promise<T | null>;
  }

  const loader = (async () => {
    const filePath = await resolveDatasetFilePath(candidatePaths);
    if (!filePath) {
      missingDatasets.add(datasetKey);
      return null;
    }

    try {
      const raw = await readDatasetFile(filePath);
      const parsed = await parser(raw);
      datasetCache.set(datasetKey, parsed as unknown);
      return parsed;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        console.warn(`Dataset file not found for ${datasetKey}`, error);
        missingDatasets.add(datasetKey);
        return null;
      }

      console.error(`Dataset parse/load failed for ${datasetKey}`, error);
      return null;
    } finally {
      datasetInflight.delete(datasetKey);
    }
  })();

  datasetInflight.set(datasetKey, loader as Promise<unknown | null>);
  return loader;
}

export async function loadDataset<T>(
  datasetKey: string,
  candidatePaths: string[],
  parser: (raw: string) => T | Promise<T>
): Promise<T | null> {
  return loadDatasetInternal(datasetKey, candidatePaths, parser);
}

export async function loadJsonDataset<T>(
  datasetKey: string,
  candidatePaths: string[]
): Promise<T | null> {
  return loadDatasetInternal(datasetKey, candidatePaths, (raw) => JSON.parse(raw) as T);
}

export async function loadTextDataset(
  datasetKey: string,
  candidatePaths: string[]
): Promise<string | null> {
  return loadDatasetInternal(datasetKey, candidatePaths, (raw) => raw);
}

export function markDatasetMissing(datasetKey: string): void {
  missingDatasets.add(datasetKey);
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
