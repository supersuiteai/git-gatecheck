// Gets a build plan from whichever brain is available:
//  - published as a Claude artifact: asks Claude directly from the page
//  - served by server.js: posts to /api/build
// Falls back to the built-in sample builds when neither can plan.
import { PLAN_SCHEMA, SYSTEM, normalizePlan } from '../lib/plan.js';
import { demoPlan } from '../lib/demo.js';

const inArtifact = typeof window.claude?.use === 'function';
const samplePromise = inArtifact ? window.claude.use('sample').catch(() => null) : null;

export async function plannerMode() {
  if (inArtifact) return (await samplePromise) ? 'ai' : 'demo';
  try {
    return (await (await fetch('/api/health')).json()).mode;
  } catch {
    return 'ai';
  }
}

const SAMPLE_ERRORS = {
  not_granted: 'A grown-up needs to allow Claude for this page first.',
  sampling_disabled: 'Claude isn’t available for this account.',
  rate_limited: 'Too many builds right now! Wait a little and try again.',
  session_expired: 'A grown-up needs to sign in to Claude again.',
  image_rejected: 'That photo did not work. Try taking it again.',
  refused: 'I can’t build that one. Try asking for something else!',
  invalid_json: 'My plan got jumbled. Tap Build it! to try again.',
};

async function planWithSample(sample, { wish, blob }) {
  const limits = await sample.limits().catch(() => null);
  const sendPhoto = Boolean(blob && limits?.images);
  const prompt = `${SYSTEM}

Reply with only one JSON object that matches this JSON Schema, with no other text:
${JSON.stringify(PLAN_SCHEMA)}

The child says: ${sendPhoto ? 'The attached image is a photo of my bricks.' : 'I have no photo of my bricks.'} I want to build: ${wish}`;
  try {
    const raw = await sample.json(prompt, {
      modelTier: 'complex',
      ...(sendPhoto ? { images: blob } : {}),
    });
    return normalizePlan(raw);
  } catch (err) {
    throw new Error(SAMPLE_ERRORS[err?.code] ?? 'Something went wrong. Please try again.');
  }
}

export async function makePlan({ wish, image, blob }) {
  if (inArtifact) {
    const sample = await samplePromise;
    return sample ? planWithSample(sample, { wish, blob }) : normalizePlan(demoPlan(wish));
  }
  let res;
  try {
    res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish, image }),
    });
  } catch {
    throw new Error('I can’t reach the builder. Check the internet and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data.plan;
}
