import { Viewer, pieceIcon, COLOR_HEX } from './viewer.js';
import { plannerMode, photoLimit, makePlan, makeSwap, applySwap } from './planner.js';

const $ = (id) => document.getElementById(id);
const screens = ['home', 'loading', 'parts', 'build'];
const show = (name) => {
  for (const s of screens) $(s).hidden = s !== name;
  scrollTo(0, 0);
};

const COLOR_NAMES = { darkgray: 'dark gray', lightblue: 'light blue' };
const state = { photos: [], maxPhotos: 6, plan: null, step: 0, viewer: null, loadingTimer: 0, swapGroup: null };

// ---------- Photos ----------

// Phone photos are huge; shrink before upload so the request stays small.
async function shrink(file, max = 1568) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.85));
  return { url: canvas.toDataURL('image/jpeg', 0.85), blob };
}

function renderPhotos() {
  $('photos').replaceChildren(...state.photos.map((photo, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = `Brick photo ${i + 1}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove photo ${i + 1}`);
    remove.addEventListener('click', () => {
      state.photos.splice(i, 1);
      renderPhotos();
    });
    li.append(img, remove);
    return li;
  }));
  $('photos').hidden = state.photos.length === 0;
  const full = state.photos.length >= state.maxPhotos;
  $('camera-btn').classList.toggle('off', full);
  $('gallery-btn').classList.toggle('off', full);
  $('camera-btn').lastChild.textContent = state.photos.length ? ' 📷 Add another photo ' : ' 📷 Take a photo ';
}

async function onPhotos(event) {
  const files = [...(event.target.files ?? [])];
  event.target.value = '';
  setError('');
  for (const file of files) {
    if (state.photos.length >= state.maxPhotos) {
      setError(`That’s plenty! I can look at ${state.maxPhotos} photos at a time.`);
      break;
    }
    try {
      state.photos.push(await shrink(file));
    } catch {
      setError('One photo did not work. Try another one.');
    }
  }
  renderPhotos();
}
$('camera').addEventListener('change', onPhotos);
$('gallery').addEventListener('change', onPhotos);

// ---------- Wish and size ----------

function setError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

$('ideas').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  $('wish').value = e.target.textContent.replace(/^\S+\s/, '');
});

function markSize() {
  for (const chip of $('sizes').children) {
    chip.classList.toggle('on', chip.dataset.min === $('min-pieces').value && chip.dataset.max === $('max-pieces').value);
  }
}
$('sizes').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const on = e.target.classList.contains('on');
  $('min-pieces').value = on ? '' : e.target.dataset.min;
  $('max-pieces').value = on ? '' : e.target.dataset.max;
  markSize();
});
$('min-pieces').addEventListener('input', markSize);
$('max-pieces').addEventListener('input', markSize);

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
    state.plan = await makePlan({
      wish,
      photos: state.photos,
      minPieces: $('min-pieces').value,
      maxPieces: $('max-pieces').value,
    });
    showParts();
  } catch (err) {
    show('home');
    setError(err.message);
  } finally {
    clearInterval(state.loadingTimer);
  }
});

// ---------- Parts ----------

const pieceName = ({ kind, color, sizeA, sizeB }) => `${COLOR_NAMES[color] ?? color} ${sizeA}×${sizeB} ${kind}`;
const iconFor = ({ kind, color, sizeA, sizeB }) =>
  pieceIcon({ kind, color: color in COLOR_HEX ? color : 'gray', sizeA, sizeB });

// A tile for one kind of piece. With onPick it becomes a button.
function pieceItem(group, onPick) {
  const li = document.createElement('li');
  const img = document.createElement('img');
  img.src = iconFor(group);
  img.alt = '';
  const label = document.createElement('span');
  label.textContent = pieceName(group);
  if (onPick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'piece-btn';
    button.setAttribute('aria-label', `${pieceName(group)}. Tap if you don’t have it.`);
    button.append(img, label);
    button.addEventListener('click', () => onPick(group));
    li.append(button);
  } else {
    li.append(img, label);
  }
  if (group.count > 1) {
    const badge = document.createElement('b');
    badge.className = 'count';
    badge.textContent = `×${group.count}`;
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
  const total = plan.steps.reduce((n, s) => n + s.pieces.length, 0);
  $('plan-title').textContent = buildable ? plan.title : 'Hmm, let’s try again';
  $('plan-intro').textContent = buildable ? plan.intro : '';
  $('plan-count').textContent = buildable ? `This build uses ${total} pieces in ${plan.steps.length} steps.` : '';
  $('plan-note').textContent = plan.note || (buildable ? '' : 'I couldn’t find any bricks. Try a brighter photo with the bricks spread out.');
  $('plan-note').hidden = !$('plan-note').textContent;
  $('inventory').replaceChildren(...plan.inventory.map((g) => pieceItem(g)));
  $('inventory').parentElement.hidden = plan.inventory.length === 0;
  $('inventory-title').textContent = state.photos.length ? 'Bricks I found' : 'Bricks for this build';
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
  $('next').textContent = done ? 'Build something new' : state.step === total - 1 ? 'Done! 🎉' : 'Next ▶';
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
  $('step-pieces').replaceChildren(...groupPieces(current.pieces).map((g) => pieceItem(g, openSwap)));
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

// ---------- Swap a piece ----------

function setSwapBusy(busy) {
  $('swap-go').disabled = busy;
  $('swap-hint').disabled = busy;
  $('swap-go').textContent = busy ? 'Looking…' : 'Find another piece';
}

function openSwap(group) {
  state.swapGroup = group;
  $('swap-img').src = iconFor(group);
  $('swap-name').textContent = pieceName(group);
  $('swap-hint').value = '';
  $('swap-error').hidden = true;
  setSwapBusy(false);
  $('swap').showModal();
}

$('swap-cancel').addEventListener('click', () => $('swap').close());

$('swap-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const group = state.swapGroup;
  const stepIndex = state.step;
  $('swap-error').hidden = true;
  setSwapBusy(true);
  try {
    const swap = await makeSwap({ plan: state.plan, stepIndex, group, hint: $('swap-hint').value.trim() });
    if (!$('swap').open || state.step !== stepIndex) return; // they gave up waiting
    state.plan = applySwap(state.plan, stepIndex, group, swap);
    state.viewer.load(state.plan, { keepView: true });
    goTo(stepIndex);
    $('swap').close();
  } catch (err) {
    $('swap-error').textContent = err.message;
    $('swap-error').hidden = false;
  } finally {
    setSwapBusy(false);
  }
});

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

plannerMode().then((mode) => {
  $('demo-banner').hidden = mode !== 'demo';
});
photoLimit().then((max) => {
  state.maxPhotos = max;
  renderPhotos();
});
