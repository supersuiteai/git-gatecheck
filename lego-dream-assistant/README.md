# Lego Dream Assistant

A phone- and tablet-first web app for kids: take a photo of the bricks on the
table, type what you want to build, and get step-by-step instructions with an
animated 3D model you can drag to spin and look at from every angle.

## Run it

```bash
cd lego-dream-assistant
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open `http://localhost:3000`, or `http://<your-computer's-ip>:3000` from a
phone or tablet on the same Wi-Fi.

Without an API key the app starts in **demo mode** and serves three built-in
sample builds (robot, house, rocket) so you can try the whole flow.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | unset | Enables real builds from photos |
| `PORT` | `3000` | Port to listen on |
| `LEGO_MODEL` | `claude-opus-5-5` | Claude model that reads the photo and designs the build |
| `LEGO_EFFORT` | `high` | Thinking effort; `medium` is faster and cheaper |

## Publish as a Claude artifact

`npm run build:artifact` writes `dist/lego-dream-assistant.html` and
`dist/app.js` (the app with three.js bundled in). Published as a Claude
artifact with the `sample` capability (images enabled), the page asks Claude
directly on the viewer's own account, so no server or API key is needed.
`public/planner.js` picks the right path at run time.

## How it works

1. The browser shrinks the photo and posts it with the child's wish to
   `/api/build`.
2. `server.js` sends both to Claude, which returns the pieces it can see and
   a build plan as JSON on a stud grid (`lib/plan.js` holds the schema).
3. `normalizePlan` makes the plan physically buildable: any piece that floats
   or overlaps another is dropped onto whatever is beneath it.
4. `public/viewer.js` renders the plan with three.js. Each step drops its new
   pieces into place and makes them glow; dragging orbits the camera around
   the model, which stays put.

The app understands three kinds of piece: bricks, plates and roof slopes.
Anything else in the photo is mapped to the closest of those or left out.

Photos go to the Anthropic API to be read and are not stored by this app.
The API key stays on the server.

`npm test` runs the plan-validation tests.

Not affiliated with or endorsed by the LEGO Group.
