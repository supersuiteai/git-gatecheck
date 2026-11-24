import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { COLORS, PLAN_SCHEMA, normalizePlan } from './lib/plan.js';
import { demoPlan } from './lib/demo.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.LEGO_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.LEGO_EFFORT || 'high';
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const SYSTEM = `You design building instructions for a children's brick-building app. A child photographs the toy bricks they have and says what they want to build. You reply with the pieces you can see and a step-by-step build that uses only those pieces. The app renders your plan in 3D, so the geometry has to be exact.

Reading the photo
- List the loose bricks you can identify, grouped by kind, colour and size. Count studs carefully; when a piece is partly hidden, leave it out instead of guessing.
- Only three kinds exist in the app: "brick" (standard height), "plate" (one third of a brick tall) and "slope" (a roof piece, brick height). Map anything else to the closest of these, or leave it out if nothing is close.
- Colours must come from this list: ${COLORS.join(', ')}. Pick the nearest.
- Ignore people, faces, rooms and anything that is not a brick.
- If there is no photo, assume a small mixed tub: about ten 2x4 bricks, ten 2x2 bricks, six 1x2 bricks, four 2x4 plates and four 2x2 slopes in red, blue, yellow, green and white.

The grid
- x and z are stud positions on the table; y is height in plate units, with 0 on the table. A plate is 1 unit tall. A brick or slope is 3 units tall.
- A piece covers studs x to x+sizeX-1 and z to z+sizeZ-1. To turn a 2x4 brick, swap sizeX and sizeZ.
- A slope's "facing" is the direction its low edge points. Its high edge has one row of studs; nothing can sit on the sloped part. Use "+x" as the facing for bricks and plates.

Designing the build
- Build from the bottom up. Every piece must sit on the table (y = 0) or directly on top of a piece from an earlier step, sharing at least one stud with it, with its y equal to that piece's top. Pieces must never overlap in space.
- Overlap the seams between layers, like a brick wall, so the model holds together when a child picks it up.
- Never use more of a piece than the inventory has. If the bricks cannot make what was asked for, build a smaller or simpler version, or the closest thing they can make, and say so kindly in "note".
- Aim for something a child will recognise from its silhouette and colours. Usually 10 to 40 pieces.
- Each step adds 1 to 4 pieces that belong together. Use between 4 and 14 steps.
- Each instruction is one short, warm sentence a six-year-old can follow, naming the colour and where the piece goes. No measurements or coordinates.

Keep everything friendly and suitable for young children. If the request is not suitable for a child, build a friendly animal instead and mention the swap in "note". If the photo shows no bricks at all, return an empty inventory and no steps, and use "note" to ask for a clearer photo.`;

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use('/vendor/three', express.static(path.join(dir, 'node_modules/three')));
app.use(express.static(path.join(dir, 'public')));

app.get('/api/health', (_req, res) => res.json({ mode: hasKey ? 'ai' : 'demo' }));

app.post('/api/build', async (req, res) => {
  const wish = String(req.body?.wish ?? '').trim().slice(0, 200);
  if (!wish) return res.status(400).json({ error: 'Tell me what you want to build!' });

  let image = null;
  if (req.body?.image) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(req.body.image);
    if (!m) return res.status(400).json({ error: 'That photo did not work. Try taking it again.' });
    image = { type: 'base64', media_type: m[1], data: m[2] };
  }

  if (!client) return res.json({ mode: 'demo', plan: normalizePlan(demoPlan(wish)) });

  try {
    const content = [];
    if (image) content.push({ type: 'image', source: image });
    content.push({
      type: 'text',
      text: `${image ? 'Here is a photo of my bricks.' : 'I have no photo of my bricks.'} I want to build: ${wish}`,
    });

    const message = await client.beta.messages
      .stream({
        model: MODEL,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema: PLAN_SCHEMA } },
        messages: [{ role: 'user', content }],
      })
      .finalMessage();

    if (message.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'I can’t build that one. Try asking for something else!' });
    }
    const json = message.content.find((b) => b.type === 'text')?.text;
    if (message.stop_reason === 'max_tokens' || !json) {
      return res.status(502).json({ error: 'That build got too big. Try something a bit smaller!' });
    }
    res.json({ mode: 'ai', plan: normalizePlan(JSON.parse(json)) });
  } catch (err) {
    console.error('build failed:', err);
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      return res.status(500).json({ error: 'The app’s AI key is not working. Ask a grown-up to check it.' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'Lots of builders right now! Wait a moment and try again.' });
    }
    if (err instanceof Anthropic.BadRequestError) {
      return res.status(400).json({ error: 'I couldn’t read that photo. Try taking it again.' });
    }
    res.status(502).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => {
  console.log(`Lego Dream Assistant on http://localhost:${PORT} (${hasKey ? `AI mode, ${MODEL}` : 'demo mode: set ANTHROPIC_API_KEY for real builds'})`);
});
