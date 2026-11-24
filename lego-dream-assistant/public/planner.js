// Talks to whichever brain is available:
//  - published as a Claude artifact: asks Claude directly from the page
//  - served by server.js: posts to /api/build and /api/swap
// Falls back to built-in sample builds and simple swaps when neither can plan.
import {
  MAX_PHOTOS, PLAN_SCHEMA, SWAP_SCHEMA, SWAP_SYSTEM, SYSTEM,
  buildRequestText, localSwap, normalizePlan, pieceRange, sameGroup, swapRequestText,
} from '../lib/plan.js';
import { demoPlan } from '../lib/demo.js';

const inArtifact = typeof window.claude?.use === 'function';
const samplePromise = inArtifact ? window.claude.use('sample').catch(() => null) : null;

let modePromise;
export function plannerMode() {
  modePromise ??= (async () => {
    if (inArtifact) return (await samplePromise) ? 'ai' : 'demo';
    try {
      return (await (await fetch('/api/health')).json()).mode;
    } catch {
      return 'ai';
    }
  })();
  return modePromise;
}

// How many photos one build can take.
export async function photoLimit() {
  if (!inArtifact) return MAX_PHOTOS;
  const limits = await (await samplePromise)?.limits().catch(() => null);
  return Math.max(1, Math.min(MAX_PHOTOS, limits?.images?.maxCount ?? MAX_PHOTOS));
}

const SAMPLE_ERRORS = {
  not_granted: 'A grown-up needs to allow Claude for this page first.',
  sampling_disabled: 'Claude isn’t available for this account.',
  rate_limited: 'Too many builds right now! Wait a little and try again.',
  session_expired: 'A grown-up needs to sign in to Claude again.',
  image_rejected: 'One of the photos did not work. Try taking it again.',
  refused: 'I can’t build that one. Try asking for something else!',
  invalid_json: 'My plan got jumbled. Try again, or ask for a smaller build.',
};

async function askSample(system, schema, request, options) {
  const sample = await samplePromise;
  const prompt = `${system}

Reply with only one JSON object that matches this JSON Schema, with no other text:
${JSON.stringify(schema)}

The child says: ${request}`;
  try {
    return await sample.json(prompt, options);
  } catch (err) {
    throw new Error(SAMPLE_ERRORS[err?.code] ?? 'Something went wrong. Please try again.');
  }
}

async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('I can’t reach the builder. Check the internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// photos: [{url, blob}]; minPieces/maxPieces: whatever was typed, may be empty.
export async function makePlan({ wish, photos, minPieces, maxPieces }) {
  if ((await plannerMode()) === 'demo') return normalizePlan(demoPlan(wish));
  if (!inArtifact) {
    return (await post('/api/build', { wish, images: photos.map((p) => p.url), minPieces, maxPieces })).plan;
  }
  const blobs = photos.slice(0, await photoLimit()).map((p) => p.blob);
  const request = buildRequestText({ photoCount: blobs.length, wish, range: pieceRange(minPieces, maxPieces) });
  const raw = await askSample(SYSTEM, PLAN_SCHEMA, request, {
    modelTier: 'complex',
    ...(blobs.length ? { images: blobs } : {}),
  });
  return normalizePlan(raw);
}

// Replacement pieces for the given kind of piece in one step.
// Resolves with {instruction, pieces}.
export async function makeSwap({ plan, stepIndex, group, hint }) {
  let swap;
  if ((await plannerMode()) === 'demo') {
    swap = localSwap(plan.steps[stepIndex].pieces.filter((p) => sameGroup(p, group)));
  } else if (inArtifact) {
    swap = await askSample(SWAP_SYSTEM, SWAP_SCHEMA, swapRequestText({ plan, stepIndex, group, hint }), { cache: false });
  } else {
    swap = (await post('/api/swap', { plan, stepIndex, group, hint })).swap;
  }
  if (!swap?.pieces?.length) throw new Error('I couldn’t find another piece for that spot. Ask a grown-up for help!');
  return swap;
}

// The plan with that swap applied, made buildable again.
export function applySwap(plan, stepIndex, group, swap) {
  const steps = plan.steps.map((step, i) =>
    i !== stepIndex ? step : {
      instruction: swap.instruction || step.instruction,
      pieces: [...step.pieces.filter((p) => !sameGroup(p, group)), ...swap.pieces],
    });
  return normalizePlan({ ...plan, steps });
}
