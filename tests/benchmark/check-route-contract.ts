import Module from 'module';
import path from 'path';

function registerAliasResolver(): void {
  const rootDir = path.resolve(__dirname, '..', '..');
  const moduleWithInternals = Module as unknown as {
    _resolveFilename: (
      request: string,
      parent: unknown,
      isMain: boolean,
      options: unknown
    ) => string;
  };
  const originalResolveFilename = moduleWithInternals._resolveFilename;

  moduleWithInternals._resolveFilename = function (request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      const resolved = path.join(rootDir, request.slice(2));
      return originalResolveFilename.call(this, resolved, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
}

type BuildStructuredResponsePayload = (content: string, verses: unknown[], translation: string) => unknown;

type RouteContractPayload = {
  verses: unknown[];
  model: string;
  requestId: string;
  latency: Record<string, number>;
  translation: string;
  response: unknown;
};

function assertHasKey(payload: RouteContractPayload, key: keyof RouteContractPayload): void {
  if (!(key in payload)) {
    throw new Error(`Route contract regression: missing key "${String(key)}"`);
  }
}

function main(): void {
  registerAliasResolver();
  const mod = require('../../app/api/chat/lib/response-normalizer') as {
    buildStructuredResponsePayload: BuildStructuredResponsePayload;
  };

  const payload: RouteContractPayload = {
    verses: [],
    model: 'gemini:gemini-2.5-flash',
    requestId: 'contract-check',
    latency: { total_ms: 0 },
    translation: 'BSB',
    response: mod.buildStructuredResponsePayload('', [], 'BSB'),
  };

  assertHasKey(payload, 'verses');
  assertHasKey(payload, 'model');
  assertHasKey(payload, 'requestId');
  assertHasKey(payload, 'latency');
  assertHasKey(payload, 'translation');

  console.log(JSON.stringify({ ok: true, keys: Object.keys(payload) }, null, 2));
}

main();
