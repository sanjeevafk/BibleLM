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

type StructuredRouteResponse = {
  analysis?: {
    summary: string;
  };
  sections: unknown[];
};

function assertHasKey(payload: StructuredRouteResponse, key: keyof StructuredRouteResponse): void {
  if (!(key in payload)) {
    throw new Error(`Route contract regression: missing key "${String(key)}"`);
  }
}

async function main(): Promise<void> {
  registerAliasResolver();
  const mod = require('../../app/api/chat/lib/response-normalizer') as {
    buildStructuredResponsePayload: BuildStructuredResponsePayload;
  };

  const fixtureVerses = [
    {
      reference: 'John 3:16',
      translation: 'BSB',
      text: 'For God so loved the world that He gave His one and only Son.',
      original: [],
    },
  ];

  const result = await Promise.resolve(
    mod.buildStructuredResponsePayload('God loves the world.', fixtureVerses, 'BSB')
  );

  if (!result || typeof result !== 'object') {
    throw new Error('Route contract regression: expected structured response object');
  }

  const payload = result as StructuredRouteResponse;

  assertHasKey(payload, 'sections');

  console.log(JSON.stringify({ ok: true, keys: Object.keys(payload) }, null, 2));
}

void main();
