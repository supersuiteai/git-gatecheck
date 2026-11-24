import { Viewer, pieceIcon, COLOR_HEX } from './viewer.js';

const $ = (id) => document.getElementById(id);
const screens = ['home', 'loading', 'parts', 'build'];
const show = (name) => {
  for (const s of screens) $(s).hidden = s !== name;
  scrollTo(0, 0);
};

const COLOR_NAMES = { darkgray: 'dark gray', lightblue: 'light blue' };
const state = { image: null, plan: null, step: 0, viewer: null, loadingTimer: 0 };

// ---------- Photo ----------

// Phone photos are huge; shrink before upload so the request stays small.
async function shrink(file, max = 1568) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function onPhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    state.image = await shrink(file);
    $('preview').src = state.image;
    $('photo-empty').hidden = true;
    $('photo-full').hidden = false;
    setError('');
  } catch {
    setError('That photo did not work. Try another one.');
  }
}
$('camera').addEventListener('change', onPhoto);
$('gallery').addEventListener('change', onPhoto);
$('retake').addEventListener('click', () => {
  state.image = null;
  $('photo-empty').hidden = false;
  $('photo-full').hidden = true;
});

// ---------- Wish ----------

function setError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

$('ideas').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $('wish').value = e.target.textContent.replace(/^\S+\s/, '');
});

const LOADING_LINES = [
  'Looking at your bricks…',
  'Counting all the studs…',
  'Dreaming up your build…',
  'Sorting the colours…',
  'Drawing the instructions…',
];

$('wish-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const wish = $('wish').value.trim();
  if (!wish) return setError('Type what you want to build first!');
  setError('');
  $('wish').blur();

  let line = 0;
  $('loading-text').textContent = LOADING_LINES[0];
  state.loadingTimer = setInterval(() => {
    line = (line + 1) % LOADING_LINES.length;
    $('loading-text').textContent = LOADING_LINES[line];
  }, 2800);
  show('loading');

  try {
    const res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish, image: state.image }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    state.plan = data.plan;
    showParts();
  } catch (err) {
    show('home');
    setError(err instanceof TypeError ? 'I can’t reach the builder. Check the internet and try again.' : err.message);
  } finally {
    clearInterval(state.loadingTimer);
  }
});

// ---------- Parts ----------

function pieceItem({ kind, color, sizeA, sizeB, count }) {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.src = pieceIcon({ kind, color: color in COLOR_HEX ? color : 'gray', sizeA, sizeB });
  img.alt = '';
  const label = document.createElement('span');
  label.textContent = `${COLOR_NAMES[color] ?? color} ${sizeA}×${sizeB} ${kind}`;
  li.append(img, label);
  if (count > 1) {
    const badge = document.createElement('b');
    badge.className = 'count';
    badge.textContent = `×${count}`;
    li.append(badge);
  }
  return li;
}

function groupPieces(pieces) {
  const groups = new Map();
  for (const p of pieces) {
    const sizeA = Math.min(p.sizeX, p.sizeZ);
    const sizeB = Math.max(p.sizeX, p.sizeZ);
    const id = [p.kind, p.color, sizeA, sizeB].join('|');
    const g = groups.get(id) ?? { kind: p.kind, color: p.color, sizeA, sizeB, count: 0 };
    g.count += 1;
    groups.set(id, g);
  }
  return [...groups.values()];
}

function showParts() {
  const { plan } = state;
  const buildable = plan.steps.length > 0;
  $('plan-title').textContent = buildable ? plan.title : 'Hmm, let’s try again';
  $('plan-intro').textContent = buildable ? plan.intro : '';
  $('plan-note').textContent = plan.note || (buildable ? '' : 'I couldn’t find any bricks. Try a brighter photo with the bricks spread out.');
  $('plan-note').hidden = !$('plan-note').textContent;
  $('inventory').replaceChildren(...plan.inventory.map(pieceItem));
  $('inventory').parentElement.hidden = plan.inventory.length === 0;
  $('inventory-title').textContent = state.image ? 'Bricks I found' : 'Bricks for this build';
  $('start').hidden = !buildable;
  show('parts');
}

// ---------- Builder ----------

$('start').addEventListener('click', () => {
  show('build');
  state.viewer ??= new Viewer($('canvas'));
  state.viewer.resize();
  state.viewer.load(state.plan);
  $('spin-hint').classList.remove('gone');
  goTo(0);
});

function goTo(step) {
  const total = state.plan.steps.length;
  state.step = Math.max(0, Math.min(total, step));
  const done = state.step === total;

  $('step-body').hidden = done;
  $('done-body').hidden = !done;
  $('prev').disabled = state.step === 0;
  $('replay').hidden = done;
  $('next').textContent = done ? 'Build something new' : state.step === total - 1 ? 'Finished! 🎉' : 'Next ▶';
  $('progress').firstElementChild.style.width = `${(Math.min(state.step + 1, total) / total) * 100}%`;
  $('progress').setAttribute('aria-valuemax', total);
  $('progress').setAttribute('aria-valuenow', Math.min(state.step + 1, total));
  state.viewer.controls.autoRotate = done;

  if (done) {
    state.viewer.showAll();
    confetti();
    return;
  }
  const current = state.plan.steps[state.step];
  $('step-num').textContent = state.step + 1;
  $('step-of').textContent = `of ${total}`;
  $('instruction').textContent = current.instruction;
  $('step-pieces').replaceChildren(...groupPieces(current.pieces).map(pieceItem));
  state.viewer.showStep(state.step);
}

$('prev').addEventListener('click', () => goTo(state.step - 1));
$('replay').addEventListener('click', () => state.viewer.showStep(state.step));
$('next').addEventListener('click', () => {
  if (state.step === state.plan.steps.length) return startOver();
  goTo(state.step + 1);
});
$('reset-view').addEventListener('click', () => state.viewer.resetView());
$('canvas').addEventListener('pointerdown', () => $('spin-hint').classList.add('gone'));

function startOver() {
  if (state.viewer) state.viewer.controls.autoRotate = false;
  $('wish').value = '';
  show('home');
}
$('home-btn').addEventListener('click', startOver);
$('restart-a').addEventListener('click', startOver);

function confetti() {
  const box = $('confetti');
  const colors = Object.values(COLOR_HEX).slice(0, 6);
  const bits = Array.from({ length: 60 }, () => {
    const bit = document.createElement('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = `#${colors[Math.floor(Math.random() * colors.length)].toString(16).padStart(6, '0')}`;
    bit.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
    bit.style.animationDelay = `${Math.random() * 0.6}s`;
    return bit;
  });
  box.replaceChildren(...bits);
  setTimeout(() => box.replaceChildren(), 4500);
}

fetch('/api/health')
  .then((r) => r.json())
  .then(({ mode }) => { $('demo-banner').hidden = mode !== 'demo'; })
  .catch(() => {});
