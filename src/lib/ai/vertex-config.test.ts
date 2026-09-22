import { describe, it, expect } from 'vitest';
import {
  buildVertexModelUrl,
  DEFAULT_VERTEX_EMBEDDING_LOCATION,
  DEFAULT_VERTEX_GENERATION_LOCATION,
  DEFAULT_VERTEX_GENERATION_MODEL,
  resolveVertexEmbeddingLocation,
  resolveVertexGenerationTarget,
  VertexConfigError,
  vertexAcceptsCustomTemperature,
  vertexApiHost,
  vertexLocationKind,
  vertexThinkingLevelFor,
} from './vertex-config';

describe('vertexLocationKind', () => {
  it.each([
    ['us-central1', 'regional'],
    ['europe-west4', 'regional'],
    ['northamerica-northeast1', 'regional'],
    ['global', 'global'],
    ['us', 'multi-region'],
    ['eu', 'multi-region'],
  ])('classifies %s as %s', (location, kind) => {
    expect(vertexLocationKind(location)).toBe(kind);
  });

  it.each([
    '',
    'US',
    'asia',
    'us-central',
    'us-central1 ',
    'US-CENTRAL1',
    'us-central1.evil.example',
    'us-central1/../x',
    'global-1',
  ])('rejects %j', (location) => {
    expect(() => vertexLocationKind(location)).toThrow(VertexConfigError);
  });
});

describe('vertexApiHost', () => {
  it('uses the {region}-aiplatform host for a region', () => {
    expect(vertexApiHost('us-central1')).toBe('us-central1-aiplatform.googleapis.com');
  });

  it('uses the bare host for global', () => {
    expect(vertexApiHost('global')).toBe('aiplatform.googleapis.com');
  });

  it('uses the .rep. hostnames for the multi-regions', () => {
    expect(vertexApiHost('us')).toBe('aiplatform.us.rep.googleapis.com');
    expect(vertexApiHost('eu')).toBe('aiplatform.eu.rep.googleapis.com');
  });

  it('throws for an unknown location', () => {
    expect(() => vertexApiHost('mars-north1x')).toThrow(VertexConfigError);
  });
});

describe('buildVertexModelUrl', () => {
  it('builds the multi-region generateContent URL', () => {
    expect(
      buildVertexModelUrl({
        projectId: 'theraptly-lms-staging',
        location: 'us',
        model: 'gemini-3.1-flash-lite',
        method: 'generateContent',
      }),
    ).toBe(
      'https://aiplatform.us.rep.googleapis.com/v1/projects/theraptly-lms-staging/locations/us/publishers/google/models/gemini-3.1-flash-lite:generateContent',
    );
  });

  it('builds the regional predict URL', () => {
    expect(
      buildVertexModelUrl({
        projectId: 'p',
        location: 'us-central1',
        model: 'text-embedding-004',
        method: 'predict',
      }),
    ).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/text-embedding-004:predict',
    );
  });

  it('builds the global URL', () => {
    expect(
      buildVertexModelUrl({
        projectId: 'p',
        location: 'global',
        model: 'gemini-3.1-flash-lite',
        method: 'generateContent',
      }),
    ).toBe(
      'https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/google/models/gemini-3.1-flash-lite:generateContent',
    );
  });

  it('encodes the project id rather than letting it alter the path', () => {
    const url = buildVertexModelUrl({
      projectId: 'a/b',
      location: 'us',
      model: 'gemini-3.1-flash-lite',
      method: 'generateContent',
    });
    expect(url).toContain('/projects/a%2Fb/locations/us/');
  });

  it.each(['', 'gemini/../x', 'gemini-3.1-flash-lite:predict', 'Gemini-3', 'gemini 3', 'gemini-'])(
    'rejects model id %j',
    (model) => {
      expect(() =>
        buildVertexModelUrl({ projectId: 'p', location: 'us', model, method: 'generateContent' }),
      ).toThrow(VertexConfigError);
    },
  );

  it('rejects an invalid location', () => {
    expect(() =>
      buildVertexModelUrl({
        projectId: 'p',
        location: 'nowhere',
        model: 'gemini-3.1-flash-lite',
        method: 'generateContent',
      }),
    ).toThrow(VertexConfigError);
  });
});

describe('resolveVertexGenerationTarget', () => {
  it('defaults to the US multi-region and gemini-3.1-flash-lite', () => {
    expect(resolveVertexGenerationTarget({})).toEqual({
      location: 'us',
      model: 'gemini-3.1-flash-lite',
    });
    expect(DEFAULT_VERTEX_GENERATION_LOCATION).toBe('us');
    expect(DEFAULT_VERTEX_GENERATION_MODEL).toBe('gemini-3.1-flash-lite');
  });

  it('treats empty and whitespace-only values as unset', () => {
    expect(resolveVertexGenerationTarget({ VERTEX_LOCATION: '', VERTEX_MODEL: '   ' })).toEqual({
      location: 'us',
      model: 'gemini-3.1-flash-lite',
    });
  });

  it('uses the configured values, trimmed', () => {
    expect(
      resolveVertexGenerationTarget({
        VERTEX_LOCATION: ' us-central1 ',
        VERTEX_MODEL: 'gemini-2.5-flash-lite\n',
      }),
    ).toEqual({ location: 'us-central1', model: 'gemini-2.5-flash-lite' });
  });

  it('ignores GOOGLE_LOCATION, which belongs to embeddings', () => {
    expect(resolveVertexGenerationTarget({ GOOGLE_LOCATION: 'europe-west4' }).location).toBe('us');
  });

  it('throws on a malformed location instead of falling back', () => {
    expect(() => resolveVertexGenerationTarget({ VERTEX_LOCATION: 'us-east' })).toThrow(
      VertexConfigError,
    );
  });

  it('throws on a malformed model instead of falling back', () => {
    expect(() => resolveVertexGenerationTarget({ VERTEX_MODEL: 'models/gemini' })).toThrow(
      VertexConfigError,
    );
  });
});

describe('resolveVertexEmbeddingLocation', () => {
  it('defaults to us-central1', () => {
    expect(resolveVertexEmbeddingLocation({})).toBe('us-central1');
    expect(DEFAULT_VERTEX_EMBEDDING_LOCATION).toBe('us-central1');
  });

  it('uses GOOGLE_LOCATION and ignores VERTEX_LOCATION', () => {
    expect(
      resolveVertexEmbeddingLocation({ GOOGLE_LOCATION: 'europe-west4', VERTEX_LOCATION: 'us' }),
    ).toBe('europe-west4');
  });

  it.each(['us', 'eu', 'global'])('rejects the non-regional location %s', (location) => {
    expect(() => resolveVertexEmbeddingLocation({ GOOGLE_LOCATION: location })).toThrow(
      /must be a single region/,
    );
  });

  it('rejects a malformed location', () => {
    expect(() => resolveVertexEmbeddingLocation({ GOOGLE_LOCATION: 'central' })).toThrow(
      VertexConfigError,
    );
  });
});

describe('vertexThinkingLevelFor', () => {
  it('returns MINIMAL for the verified flash-lite models', () => {
    expect(vertexThinkingLevelFor('gemini-3.1-flash-lite')).toBe('MINIMAL');
    expect(vertexThinkingLevelFor('gemini-3.5-flash-lite')).toBe('MINIMAL');
  });

  it('returns undefined for pre-Gemini-3 and unlisted models', () => {
    expect(vertexThinkingLevelFor('gemini-2.5-flash-lite')).toBeUndefined();
    expect(vertexThinkingLevelFor('gemini-3.1-pro-preview')).toBeUndefined();
    expect(vertexThinkingLevelFor('custom-model')).toBeUndefined();
  });
});

describe('vertexAcceptsCustomTemperature', () => {
  it.each(['gemini-3.1-flash-lite', 'gemini-3-flash', 'gemini-3.5-flash-lite', 'gemini-10-pro'])(
    'is false for Gemini 3 and later (%s)',
    (model) => {
      expect(vertexAcceptsCustomTemperature(model)).toBe(false);
    },
  );

  it.each(['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-pro', 'custom-model-test'])(
    'is true for earlier or non-Gemini models (%s)',
    (model) => {
      expect(vertexAcceptsCustomTemperature(model)).toBe(true);
    },
  );
});
