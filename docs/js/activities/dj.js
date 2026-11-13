import { el, toast, css } from '../core.js';
import {
  parseMedia, validSrc, isAudioUrl, srcUrl, srcTitle, fmtTime, errMsg, uid, store, target, channel, createPlayer, follower,
  conductor, feed, joinOverlay, volumeControl, liveStatus, every, toggle
} from '../livesync.js';

const defaults = () => ({ allowRequests: true, maxRequests: 3 });
const clampMax = n => Math.max(0, Math.min(50, Math.round(+n) || 0));
const httpsUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };
const CORS_HOSTS = /(^|\.)archive\.org$/i;
const MOODS = [['Lo-fi', 'lofi'], ['Piano', 'piano'], ['Classical', 'classical'], ['Jazz', 'jazz'], ['Ambient', 'ambient'], ['Chillhop', 'chillhop'], ['Synthwave', 'synthwave'], ['Rain', 'rain']];

function cleanSrc(s) {
  if (!validSrc(s)) return null;
  if (s.type === 'yt') return { type: 'yt', id: s.id };
  const out = { type: 'file', url: s.url };
  try { if (s.cors && CORS_HOSTS.test(new URL(s.url).hostname)) out.cors = true; } catch {}
  if (s.live) out.live = true;
  return out;
}

function cleanTrack(t) {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string') return null;
  const src = cleanSrc(t.src);
  if (!src) return null;
  return {
    id: t.id.slice(0, 40), src, title: srcTitle(src, t.title), by: String(t.by || '').slice(0, 60),
    artist: String(t.artist || '').slice(0, 80), art: httpsUrl(t.art), from: String(t.from || '').slice(0, 30),
    votes: Math.max(0, +t.votes || 0), req: t.req != null ? +t.req : null
  };
}

function requestSrc(m) {
  const src = parseMedia(m.url);
  if (!src) return null;
  if (src.type === 'yt') return { type: 'yt', id: src.id };
  if (!isAudioUrl(src.url) && !m.from) return null;
  return cleanSrc({ type: 'file', url: src.url, cors: m.cors, live: m.live });
}

/* ------------------------------------------------------------ search */

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Search failed (' + r.status + ')');
  return r.json();
}

async function searchMusic(term) {
  const t = term.replace(/[()":\\]/g, ' ').trim() || 'lofi';
  const q = `(title:(${t}) OR subject:(${t}) OR creator:(${t})) AND mediatype:audio AND (collection:netlabels OR collection:opensource_audio OR licenseurl:*creativecommons*) AND -collection:librivoxaudio AND -subject:(audiobook OR speech OR podcast OR spoken)`;
  const p = new URLSearchParams([['q', q], ['fl[]', 'identifier'], ['fl[]', 'title'], ['fl[]', 'creator'], ['sort[]', 'downloads desc'], ['rows', '24'], ['output', 'json']]);
  const d = await getJson('https://archive.org/advancedsearch.php?' + p);
  return (d.response?.docs || []).map(x => ({
    kind: 'album', id: x.identifier, title: String(x.title || x.identifier).slice(0, 120),
    artist: String(Array.isArray(x.creator) ? x.creator[0] : x.creator || '').slice(0, 80),
    art: 'https://archive.org/services/img/' + encodeURIComponent(x.identifier)
  }));
}

const lenSec = v => { if (v == null) return 0; if (/^\d+(\.\d+)?$/.test(v)) return +v; const p = String(v).split(':').map(Number); return p.reduce((s, x) => s * 60 + (x || 0), 0); };

async function albumTracks(album) {
  const d = await getJson('https://archive.org/metadata/' + encodeURIComponent(album.id));
  const files = (d.files || []).filter(f => /mp3$/i.test(f.name) && /mp3/i.test(f.format || 'mp3'));
  const best = new Map();
  for (const f of files) {
    const base = f.name.replace(/(_vbr|_64kb|_128kb)?\.mp3$/i, '');
    const rank = /VBR/i.test(f.format) ? 0 : /128/.test(f.format) ? 1 : 2;
    if (!best.has(base) || best.get(base).rank > rank) best.set(base, { f, rank });
  }
  return [...best.values()].map(({ f }) => ({
    src: { type: 'file', url: 'https://archive.org/download/' + encodeURIComponent(album.id) + '/' + f.name.split('/').map(encodeURIComponent).join('/'), cors: true },
    title: String(f.title || f.name.split('/').pop().replace(/\.mp3$/i, '').replace(/[_]+/g, ' ')).slice(0, 120),
    artist: String(f.artist || f.creator || album.artist || '').slice(0, 80),
    art: album.art, from: 'Internet Archive', len: lenSec(f.length)
  })).slice(0, 60);
}

async function searchRadio(term) {
  const hosts = ['de1', 'de2', 'fi1', 'at1'];
  const base = '/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true&limit=20&';
  let last;
  for (const h of hosts) {
    try {
      const [byTag, byName] = await Promise.all([
        getJson(`https://${h}.api.radio-browser.info${base}tag=${encodeURIComponent(term.toLowerCase())}`),
        getJson(`https://${h}.api.radio-browser.info${base}name=${encodeURIComponent(term)}`)]);
      const seen = new Set();
      return [...byTag, ...byName].filter(s => {
        const u = httpsUrl(s.url_resolved || s.url);
        if (!u || seen.has(s.stationuuid)) return false;
        seen.add(s.stationuuid);
        return true;
      }).slice(0, 24).map(s => ({
        kind: 'radio', src: { type: 'file', url: httpsUrl(s.url_resolved || s.url), live: true },
        title: String(s.name || 'Radio').trim().slice(0, 120),
        artist: [s.country, (s.tags || '').split(',').slice(0, 3).join(', ')].filter(Boolean).join(' · ').slice(0, 80),
        art: httpsUrl(s.favicon), from: 'Live radio'
      }));
    } catch (e) { last = e; }
  }
  throw last || new Error('Radio search is unavailable');
}

function thumb(src, cls = 'dj-th') {
  const box = el('span', { class: cls, 'aria-hidden': 'true' }, el('span', { text: '♪' }));
  if (src) {
    const img = el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.onerror = () => img.remove();
    box.append(img);
  }
  return box;
}

function searchPanel({ verb, onPick, canPick = () => true }) {
  let source = 'music', token = 0;
  const input = el('input', { type: 'search', placeholder: 'Search artists, albums, moods…', autocomplete: 'off', 'aria-label': 'Search music' });
  const tabs = el('div', { class: 'dj-src', role: 'tablist' });
  const tabBtn = (id, text) => {
    const b = el('button', { type: 'button', role: 'tab', text, class: id === source ? 'on' : '', 'aria-selected': String(id === source) });
    b.addEventListener('click', () => { source = id; [...tabs.children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); }); run(); });
    return b;
  };
  tabs.append(tabBtn('music', 'Music library'), tabBtn('radio', 'Live radio'));
  const chips = el('div', { class: 'dj-moods' }, MOODS.map(([label, q]) => {
    const b = el('button', { type: 'button', class: 'chip', text: label });
    b.addEventListener('click', () => { input.value = q; run(); });
    return b;
  }));
  const list = el('ul', { class: 'dj-res', 'aria-live': 'polite' });
  const note = el('p', { class: 'hint', text: 'Free, Creative Commons music from the Internet Archive and live stations from radio-browser.info.' });
  const form = el('form', { class: 'dj-search', role: 'search' }, input, el('button', { class: 'pri', type: 'submit', text: 'Search' }));
  form.addEventListener('submit', e => { e.preventDefault(); run(); });

  const pickBtn = (item, label) => {
    const b = el('button', { type: 'button', class: 'pri', text: label || verb, disabled: !canPick() });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await onPick({ src: item.src, title: item.title, artist: item.artist, art: item.art, from: item.from }); b.textContent = '✓'; }
      catch (x) { b.disabled = false; toast(errMsg(x)); }
    });
    return b;
  };

  function row(item) {
    const li = el('li', null, thumb(item.art),
      el('span', { class: 't' }, el('b', { text: item.title }), el('span', { class: 'mut', text: item.artist || '' })));
    if (item.kind === 'radio') { li.append(el('span', { class: 'chip live', text: 'LIVE' }), pickBtn(item)); return li; }
    const more = el('button', { type: 'button', text: 'Tracks ▾', 'aria-expanded': 'false' });
    const sub = el('ol', { class: 'dj-tracks', hidden: true });
    more.addEventListener('click', async () => {
      const open = sub.hidden;
      sub.hidden = !open;
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Tracks ▴' : 'Tracks ▾';
      if (!open || sub.childElementCount) return;
      sub.append(el('li', { class: 'mut', text: 'Loading tracks…' }));
      try {
        const tracks = await albumTracks(item);
        sub.replaceChildren(...(tracks.length ? tracks.map(t => el('li', null,
          el('span', { class: 't' }, el('span', { text: t.title }), t.len ? el('span', { class: 'mut', text: ' · ' + fmtTime(t.len) }) : null),
          pickBtn(t))) : [el('li', { class: 'mut', text: 'No playable tracks in this album.' })]));
      } catch (x) { sub.replaceChildren(el('li', { class: 'bad', text: errMsg(x) })); }
    });
    li.append(more);
    return [li, sub];
  }

  async function run() {
    const term = input.value.trim() || 'lofi';
    const my = ++token;
    list.replaceChildren(el('li', { class: 'mut', text: 'Searching…' }));
    try {
      const items = source === 'radio' ? await searchRadio(term) : await searchMusic(term);
      if (my !== token) return;
      list.replaceChildren(...(items.length ? items.flatMap(i => [row(i)].flat()) : [el('li', { class: 'mut', text: 'No results. Try another word or a mood above.' })]));
    } catch (x) { if (my === token) list.replaceChildren(el('li', { class: 'bad', text: errMsg(x) })); }
  }

  return {
    el: el('div', { class: 'dj-find' }, tabs, form, chips, list, note),
    refresh() { list.querySelectorAll('button.pri').forEach(b => { if (b.textContent !== '✓') b.disabled = !canPick(); }); },
    run
  };
}

/* ------------------------------------------------------------ visualizer */

let actx = null;
const graphs = new WeakMap();
const audioReady = () => (navigator.userActivation ? navigator.userActivation.hasBeenActive : true);
document.addEventListener('pointerdown', () => { if (actx && actx.state === 'suspended') actx.resume(); }, true);

function analyserFor(media) {
  if (!media || !media.crossOrigin || !audioReady()) return null;
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (!graphs.has(media)) {
      const node = actx.createMediaElementSource(media), an = actx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.82;
      node.connect(an);
      an.connect(actx.destination);
      graphs.set(media, an);
    }
    if (actx.state === 'suspended') actx.resume();
    return graphs.get(media);
  } catch { return null; }
}

const MODES = [['bars', 'Bars'], ['wave', 'Wave'], ['orb', 'Orb']];

function visualizer(stage, player, keyName) {
  const canvas = el('canvas', { class: 'dj-viz', 'aria-hidden': 'true' });
  const g = canvas.getContext('2d');
  const pref = store(keyName, 'bars');
  let mode = MODES.some(m => m[0] === pref.get()) ? pref.get() : 'bars';
  const modeBar = el('div', { class: 'dj-modes', role: 'group', 'aria-label': 'Visualizer style' });
  MODES.forEach(([id, label]) => {
    const b = el('button', { type: 'button', text: label, class: id === mode ? 'on' : '', 'aria-pressed': String(id === mode) });
    b.addEventListener('click', () => { mode = id; pref.set(id); [...modeBar.children].forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); });
    modeBar.append(b);
  });
  stage.prepend(canvas);
  stage.append(modeBar);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const N = 64, freq = new Uint8Array(512), wave = new Uint8Array(1024), levels = new Float32Array(N);
  let energy = 0, w = 0, h = 0, live = false, alive = true, ink = '#8c1c2b', glow = '#ffe36e';
  const theme = () => { ink = css('--mar') || ink; glow = css('--hl') || glow; };
  theme();
  document.addEventListener('themechange', theme);
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
    g.setTransform(d, 0, 0, d, 0, 0);
  }).observe(canvas);

  function sample(t) {
    const p = player.impl();
    const playing = !!p && p.state() === 'playing';
    energy += ((playing ? 1 : 0.06) - energy) * 0.05;
    const an = playing ? analyserFor(player.media()) : null;
    live = false;
    if (an) {
      an.getByteFrequencyData(freq);
      an.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < 160; i++) sum += freq[i];
      live = sum > 0;
    }
    for (let i = 0; i < N; i++) {
      let v;
      if (live) {
        const a = Math.floor(Math.pow(i / N, 1.7) * 220), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / N, 1.7) * 220));
        let s = 0;
        for (let j = a; j < b; j++) s += freq[j];
        v = s / (b - a) / 255;
      } else {
        const beat = Math.pow(Math.max(0, Math.sin(t * 0.0042)), 8);
        v = (0.25 + 0.35 * Math.abs(Math.sin(i * 0.37 + t * 0.0021)) * Math.abs(Math.cos(i * 0.11 - t * 0.0013)) + beat * 0.3 * (1 - i / N)) * energy;
      }
      levels[i] += (v - levels[i]) * (live ? 0.6 : 0.15);
    }
  }

  function draw(t) {
    g.clearRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, ink);
    grad.addColorStop(1, glow);
    g.fillStyle = grad;
    g.strokeStyle = grad;
    if (mode === 'bars') {
      const gap = 2, bw = Math.max(2, (w - gap * (N - 1)) / N);
      for (let i = 0; i < N; i++) {
        const bh = Math.max(3, levels[i] * h * 0.86);
        const x = i * (bw + gap), r = Math.min(4, bw / 2);
        g.beginPath();
        g.roundRect ? g.roundRect(x, h - bh, bw, bh, [r, r, 0, 0]) : g.rect(x, h - bh, bw, bh);
        g.fill();
      }
    } else if (mode === 'wave') {
      g.lineWidth = 2.5;
      g.lineJoin = 'round';
      for (let layer = 0; layer < 3; layer++) {
        g.globalAlpha = 1 - layer * 0.3;
        g.beginPath();
        const pts = 160;
        for (let i = 0; i <= pts; i++) {
          const x = i / pts * w;
          let y;
          if (live) y = h / 2 + ((wave[Math.floor(i / pts * 1023)] - 128) / 128) * h * 0.42 * (1 - layer * 0.25);
          else {
            const lv = levels[Math.floor(i / pts * (N - 1))];
            y = h / 2 + Math.sin(i * 0.12 + t * 0.003 * (layer + 1)) * lv * h * 0.38 * (1 - layer * 0.25);
          }
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    } else {
      const cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.2;
      let avg = 0;
      for (let i = 0; i < N; i++) avg += levels[i];
      avg /= N;
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let i = 0; i < N * 2; i++) {
        const lv = levels[i % N], a = (i / (N * 2)) * Math.PI * 2 + t * 0.0002;
        const r1 = base * (1 + avg * 0.35), r2 = r1 + lv * Math.min(w, h) * 0.28 + 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
        g.stroke();
      }
      g.globalAlpha = 0.18 + avg * 0.4;
      g.beginPath();
      g.arc(cx, cy, base * (0.92 + avg * 0.3), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  function frame(t) {
    if (!alive) return;
    if (!canvas.isConnected) { if (t > 15000) { alive = false; return; } }
    else {
      sample(reduce.matches ? 0 : t);
      draw(reduce.matches ? 0 : t);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { stop() { alive = false; } };
}

function buildStage(player, keyName) {
  const stage = el('div', { class: 'lv-stage dj-stage', tabindex: '-1' });
  const art = thumb('', 'dj-cover');
  const title = el('b', { class: 'dj-now', text: 'Nothing playing' });
  const sub = el('span', { class: 'dj-by', text: 'Search below to start the music' });
  const badge = el('span', { class: 'chip', hidden: true });
  stage.append(el('div', { class: 'dj-meta' }, art, el('div', { class: 'dj-txt' }, title, sub, badge)));
  return {
    stage,
    attach() { return visualizer(stage, player, keyName); },
    show(track) {
      stage.classList.toggle('yt', !!(track && track.src.type === 'yt'));
      title.textContent = track ? track.title : 'Nothing playing';
      sub.textContent = track ? [track.artist, track.by ? 'requested by ' + track.by : ''].filter(Boolean).join(' · ') : 'Search below to start the music';
      badge.hidden = !track || !(track.from || track.src.live);
      badge.textContent = track && track.src.live ? 'LIVE · ' + (track.from || 'Radio') : track ? track.from : '';
      badge.classList.toggle('live', !!(track && track.src.live));
      art.querySelector('img')?.remove();
      if (track && track.art) {
        const img = el('img', { src: track.art, alt: '', referrerpolicy: 'no-referrer' });
        img.onerror = () => img.remove();
        art.append(img);
      }
    }
  };
}

function progressBar() {
  const fill = el('i');
  const bar = el('div', { class: 'lv-prog', role: 'progressbar', 'aria-label': 'Track progress', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, fill);
  const lbl = el('span', { class: 'lv-time', text: '0:00 / 0:00' });
  return {
    bar, lbl,
    set(t, d, live) {
      if (live) { fill.style.width = '100%'; bar.classList.add('live'); lbl.textContent = 'LIVE · ' + fmtTime(t); return; }
      bar.classList.remove('live');
      const pct = d ? Math.min(100, Math.max(0, t / d * 100)) : 0;
      fill.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(pct)));
      bar.setAttribute('aria-valuetext', fmtTime(t) + ' of ' + fmtTime(d));
      lbl.textContent = fmtTime(t) + ' / ' + fmtTime(d);
    }
  };
}

const describe = m => (m.type === 'request' && typeof m.title === 'string' ? 'requested “' + (m.title.trim().slice(0, 80) || 'a song') + '”' : null);

function queueRow(t, i, extra) {
  return el('li', null,
    el('span', { class: 'lv-n', text: String(i + 1) }), thumb(t.art),
    el('span', { class: 't' }, el('b', { text: t.title }), el('span', { class: 'mut', text: [t.artist, t.by && 'for ' + t.by].filter(Boolean).join(' · ') })),
    extra);
}

export default {
  kind: 'dj',
  label: 'Study DJ',
  blurb: 'Shared study music with search, a live visualizer and song requests',
  defaults,

  editor(host, settings, onChange) {
    const s = { ...defaults(), ...(settings || {}) };
    const max = el('input', { type: 'number', min: '0', max: '50', step: '1', value: String(clampMax(s.maxRequests)), inputmode: 'numeric' });
    const allow = toggle('Allow song requests from students', s.allowRequests !== false, () => emit());
    function emit() {
      max.disabled = !allow.input.checked;
      onChange({ ...s, allowRequests: allow.input.checked, maxRequests: clampMax(max.value) });
    }
    max.addEventListener('input', emit);
    max.disabled = s.allowRequests === false;
    host.replaceChildren(allow.el, el('label', { class: 'field' }, 'Maximum requests per student', max));
  },

  join(host, ctx) {
    const set = { ...defaults(), ...(ctx.activity.settings || {}) };
    const chan = channel(ctx);
    const slug = ctx.activity.slug;
    const voted = store('dj-votes:' + slug, []);
    const reqCount = store('dj-req:' + slug + ':' + (ctx.user.email || ctx.user.name || ''), 0);
    const player = createPlayer(el('div'), { audio: true, onError: m => toast(m) });
    const view = buildStage(player, 'dj-viz');
    const { stage } = view;
    stage.prepend(player.el);
    const viz = view.attach();
    let cur = null, now = null, queue = [], st = {};
    const overlay = joinOverlay(stage, () => { overlay.hide(); follow.unlock(cur); }, { text: 'Tap to tune in', sub: 'Listen along with the class' });
    const follow = follower(player, chan.clock, { onLock: () => { if (follow.unlocked) overlay.show('Tap to resume'); } });
    const status = liveStatus();
    const prog = progressBar();
    const qList = el('ol', { class: 'lv-q', 'aria-label': 'Up next' });
    const qEmpty = el('p', { class: 'mut', text: 'The queue is empty.' });

    const maxReq = () => clampMax(typeof st.max === 'number' ? st.max : set.maxRequests);
    const reqOpen = () => set.allowRequests !== false && st.requests !== false;
    const left = () => Math.max(0, maxReq() - (+reqCount.get() || 0));

    async function request(t) {
      if (!reqOpen() || left() <= 0) { renderReq(); throw new Error('You have no requests left.'); }
      await chan.post({ type: 'request', url: srcUrl(t.src), title: t.title, artist: t.artist || '', art: t.art || '', from: t.from || '', cors: !!t.src.cors, live: !!t.src.live });
      reqCount.set((+reqCount.get() || 0) + 1);
      toast('Request sent to your teacher.', 2500);
      renderReq();
      loop.now();
    }
    const finder = searchPanel({ verb: 'Request', onPick: request, canPick: () => reqOpen() && left() > 0 });

    const urlIn = el('input', { type: 'text', inputmode: 'url', placeholder: 'YouTube link or https://…/song.mp3', autocomplete: 'off' });
    const titleIn = el('input', { type: 'text', maxlength: '100', placeholder: 'Song title and artist', autocomplete: 'off' });
    const reqForm = el('form', { class: 'lv-reqform' },
      el('label', { class: 'field' }, 'Song link', urlIn), el('label', { class: 'field' }, 'Title', titleIn),
      el('div', { class: 'row' }, el('button', { class: 'pri', type: 'submit', text: 'Request' })));
    reqForm.addEventListener('submit', async e => {
      e.preventDefault();
      const src = requestSrc({ url: urlIn.value });
      if (!src) { toast('Use a YouTube link or a direct audio file link (.mp3, .m4a, .ogg…).'); urlIn.focus(); return; }
      const title = titleIn.value.trim().slice(0, 100);
      if (!title && src.type === 'file') { toast('Add a title for the song.'); titleIn.focus(); return; }
      try { await request({ src, title }); urlIn.value = ''; titleIn.value = ''; } catch (x) { toast(errMsg(x)); }
    });
    const reqLeft = el('p', { class: 'hint', 'aria-live': 'polite' });
    const reqOff = el('p', { class: 'mut', text: 'Song requests are closed right now.' });
    const reqBody = el('div', null, reqLeft, finder.el, el('details', { class: 'lv-add' }, el('summary', { text: 'Paste a link instead' }), reqForm));
    function renderReq() {
      const open = reqOpen();
      reqBody.hidden = !open;
      reqOff.hidden = open;
      reqLeft.textContent = left() > 0 ? left() + ' of ' + maxReq() + ' requests left' : 'You have used all your requests.';
      finder.refresh();
    }

    const fd = feed({ onSend: text => chan.post({ type: 'chat', text }).then(() => loop.now()), reactions: false, describe });

    let qSig = '';
    function renderQueue() {
      const mine = new Set(voted.get());
      const sig = JSON.stringify(queue.map(t => [t.id, t.title, t.votes, mine.has(t.id)]));
      if (sig === qSig) return;
      qSig = sig;
      qEmpty.hidden = queue.length > 0;
      qList.replaceChildren(...queue.map((t, i) => {
        const has = mine.has(t.id);
        const b = el('button', { type: 'button', class: has ? 'on' : '', 'aria-pressed': String(has), disabled: has, 'aria-label': (has ? 'You voted for ' : 'Vote for ') + t.title + ', ' + t.votes + ' votes', text: '👍 ' + t.votes });
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            await chan.post({ type: 'vote', id: t.id });
            voted.set([...new Set([...voted.get(), t.id])].slice(-200));
            qSig = '';
            renderQueue();
            loop.now();
          } catch (x) { b.disabled = false; toast('Vote not sent: ' + errMsg(x)); }
        });
        return queueRow(t, i, b);
      }));
    }

    host.replaceChildren(el('div', { class: 'lv' },
      el('div', { class: 'lv-main' },
        el('section', { class: 'card dj-card', 'aria-label': 'Now playing' }, stage,
          el('div', { class: 'lv-ctl' }, prog.bar, prog.lbl),
          el('div', { class: 'lv-ctl' }, status.el, el('span', { class: 'sp' }), volumeControl(player, 'lv-vol-dj'))),
        el('section', { class: 'card', 'aria-label': 'Up next' }, el('h2', { text: 'Up next' }), qList, qEmpty),
        el('section', { class: 'card', 'aria-label': 'Request a song' }, el('h2', { text: 'Request a song' }), reqBody, reqOff)),
      fd.el));
    renderReq();

    let since = 0, first = true, nowSig = '';
    const loop = every(2000, async () => {
      try {
        const [r, evs] = await Promise.all([chan.read(), chan.events(since)]);
        status.ok();
        st = r.state || {};
        now = cleanTrack(st.now);
        queue = (Array.isArray(st.queue) ? st.queue : []).map(cleanTrack).filter(Boolean);
        cur = { key: now ? now.id : '', src: now ? now.src : null, playing: !!(now && st.playing), pos: +st.pos || 0, rate: 1, rev: st.rev, at: r.at };
        const sig = now ? now.id + now.title : '';
        if (sig !== nowSig) { nowSig = sig; view.show(now); }
        renderQueue();
        renderReq();
        fd.setCanChat(st.chat !== false);
        await follow.apply(cur);
        if (evs.length) { since = Math.max(since, ...evs.map(e => e.id)); fd.push(evs, !first); }
        first = false;
      } catch (e) { status.fail(e); }
    });
    const ui = every(500, () => {
      const p = player.impl();
      const d = p ? p.duration() : 0;
      if (p && p.live) prog.set(p.time(), 0, true);
      else prog.set(cur && cur.src ? Math.min(d || Infinity, target(cur, chan.clock)) : 0, cur && cur.src ? d : 0);
    });
    return { stop() { loop.stop(); ui.stop(); viz.stop(); } };
  },

  async host(host, ctx) {
    const set = { ...defaults(), ...(ctx.activity.settings || {}) };
    const chan = channel(ctx);
    const st = { v: 1, now: null, queue: [], playing: false, pos: 0, rate: 1, rev: 0, requests: set.allowRequests !== false, max: clampMax(set.maxRequests), handled: [] };
    const player = createPlayer(el('div'), { audio: true, controls: true, onEnded: () => skip(), onError: m => toast(m) });
    const view = buildStage(player, 'dj-viz');
    const { stage } = view;
    stage.prepend(player.el);
    view.attach();
    const cond = conductor(player, chan, st);
    const overlay = joinOverlay(stage, resume, { text: 'Tap to resume hosting', sub: 'The room is still listening to the current track' });
    overlay.hide();
    const votes = new Map();
    const requests = new Map();
    const perName = new Map();
    let handled = new Set();

    const status = liveStatus();
    const prog = progressBar();
    const playBtn = el('button', { class: 'pri', type: 'button', text: 'Play', 'aria-pressed': 'false' });
    playBtn.addEventListener('click', togglePlay);
    const skipBtn = el('button', { type: 'button', text: 'Skip ⏭' });
    skipBtn.addEventListener('click', () => { overlay.hide(); skip(); });
    const reqToggle = toggle('Accept requests', st.requests, v => { st.requests = v; renderRequests(); cond.touch(); });

    const finder = searchPanel({ verb: 'Add', onPick: async t => addTrack(t.src, t.title, '', null, t) });

    const urlIn = el('input', { type: 'text', inputmode: 'url', placeholder: 'YouTube link or https://…/song.mp3', autocomplete: 'off' });
    const titleIn = el('input', { type: 'text', maxlength: '100', placeholder: 'Title (optional for YouTube)', autocomplete: 'off' });
    const addForm = el('form', { class: 'lv-reqform' },
      el('label', { class: 'field' }, 'Track link', urlIn), el('label', { class: 'field' }, 'Title', titleIn),
      el('div', { class: 'row' }, el('button', { class: 'pri', type: 'submit', text: 'Add to queue' })));
    addForm.addEventListener('submit', e => {
      e.preventDefault();
      const src = parseMedia(urlIn.value);
      if (!src) { toast('Enter a YouTube link/ID or a direct http(s) audio URL.'); urlIn.focus(); return; }
      addTrack(src.type === 'yt' ? { type: 'yt', id: src.id } : { type: 'file', url: src.url }, titleIn.value, '', null);
      urlIn.value = '';
      titleIn.value = '';
      urlIn.focus();
    });

    const qList = el('ol', { class: 'lv-q', 'aria-label': 'Queue' });
    const qEmpty = el('p', { class: 'mut', text: 'The queue is empty. Search for music or approve a request.' });
    const sortBtn = el('button', { type: 'button', text: 'Sort by votes' });
    sortBtn.addEventListener('click', () => {
      st.queue = st.queue.map((t, i) => [t, i]).sort((a, b) => b[0].votes - a[0].votes || a[1] - b[1]).map(x => x[0]);
      changed();
    });
    const rList = el('ul', { class: 'lv-q', 'aria-label': 'Pending requests' });
    const rEmpty = el('p', { class: 'mut', text: 'No pending requests.' });
    const rHead = el('h2', { text: 'Requests' });

    const fd = feed({ reactions: false, describe, onSend: text => chan.post({ type: 'chat', text }).then(() => events.now()) });

    host.replaceChildren(el('div', { class: 'lv' },
      el('div', { class: 'lv-main' },
        el('section', { class: 'card dj-card', 'aria-label': 'Now playing' }, stage,
          el('div', { class: 'lv-ctl' }, prog.bar, prog.lbl),
          el('div', { class: 'lv-ctl', role: 'group', 'aria-label': 'Playback controls' }, playBtn, skipBtn, el('span', { class: 'sp' }), status.el, volumeControl(player, 'lv-vol-dj-host'))),
        el('section', { class: 'card', 'aria-label': 'Find music' }, el('h2', { text: 'Find music' }), finder.el,
          el('details', { class: 'lv-add' }, el('summary', { text: 'Paste a link instead' }), addForm)),
        el('section', { class: 'card', 'aria-label': 'Queue' },
          el('div', { class: 'row' }, el('h2', { text: 'Queue', style: 'margin:0' }), el('span', { class: 'sp' }), sortBtn), qList, qEmpty),
        el('section', { class: 'card', 'aria-label': 'Requests' },
          el('div', { class: 'row' }, rHead, el('span', { class: 'sp' }), reqToggle.el),
          el('p', { class: 'hint', text: 'Up to ' + st.max + ' requests per student.' }), rList, rEmpty)),
      fd.el));

    function changed() { renderQueue(); renderNow(); cond.touch(); }

    function renderNow() {
      view.show(st.now);
      skipBtn.disabled = !st.now && !st.queue.length;
    }

    function renderQueue() {
      qEmpty.hidden = st.queue.length > 0;
      sortBtn.disabled = st.queue.length < 2;
      const n = st.queue.length;
      qList.replaceChildren(...st.queue.map((t, i) => {
        const btn = (text, label, fn, dis) => {
          const b = el('button', { type: 'button', text, 'aria-label': label + ': ' + t.title, title: label, disabled: !!dis });
          b.addEventListener('click', fn);
          return b;
        };
        return queueRow({ ...t, artist: [t.artist, '👍 ' + t.votes].filter(Boolean).join(' · ') }, i, el('span', { class: 'lv-acts' },
          btn('▶', 'Play now', () => { overlay.hide(); playTrack(st.queue.splice(i, 1)[0], true); }),
          btn('↑', 'Move up', () => move(i, -1), i === 0),
          btn('↓', 'Move down', () => move(i, 1), i === n - 1),
          btn('✕', 'Remove', () => { st.queue.splice(i, 1); changed(); })));
      }));
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= st.queue.length) return;
      [st.queue[i], st.queue[j]] = [st.queue[j], st.queue[i]];
      changed();
      const b = qList.children[j] && qList.children[j].querySelectorAll('button')[d < 0 ? 1 : 2];
      if (b && !b.disabled) b.focus();
    }

    function renderRequests() {
      const pending = [...requests.values()].filter(r => !handled.has(r.id));
      rHead.textContent = 'Requests' + (pending.length ? ' (' + pending.length + ')' : '');
      rEmpty.hidden = pending.length > 0;
      rEmpty.textContent = st.requests ? 'No pending requests.' : 'Requests are closed.';
      rList.replaceChildren(...pending.map(r => {
        const ok = el('button', { type: 'button', class: 'pri', text: 'Approve', 'aria-label': 'Approve ' + r.title });
        ok.addEventListener('click', () => { handle(r.id); addTrack(r.src, r.title, r.name, r.id, r.meta); });
        const no = el('button', { type: 'button', text: 'Dismiss', 'aria-label': 'Dismiss ' + r.title });
        no.addEventListener('click', () => { handle(r.id); renderRequests(); cond.touch(); });
        return el('li', null, thumb(r.meta.art),
          el('span', { class: 't' }, el('b', { text: r.title }), el('span', { class: 'mut', text: ' · ' + r.name }),
            r.over ? el('span', { class: 'chip bad', text: 'over limit' }) : null,
            el('br'), el('a', { href: srcUrl(r.src), target: '_blank', rel: 'noopener noreferrer', class: 'mut', text: r.src.type === 'yt' ? 'Preview on YouTube' : r.src.live ? 'Open stream' : 'Open audio file' })),
          el('span', { class: 'lv-acts' }, ok, no));
      }));
    }

    function handle(id) {
      handled.add(id);
      st.handled = [...handled].slice(-300);
      handled = new Set(st.handled);
    }

    function retally() {
      let diff = false;
      for (const t of [st.now, ...st.queue]) {
        if (!t) continue;
        const v = votes.has(t.id) ? votes.get(t.id).size : 0;
        if (v !== t.votes) { t.votes = v; diff = true; }
      }
      return diff;
    }

    function addTrack(src, title, by, req, meta = {}) {
      const track = cleanTrack({ id: uid(), src, title, by, req, votes: 0, artist: meta.artist, art: meta.art, from: meta.from });
      if (!track) { toast('That track link is not valid.'); return; }
      if (!st.now) playTrack(track, true);
      else { st.queue.push(track); changed(); }
      renderRequests();
      toast('Added “' + track.title + '”', 2000);
    }

    async function playTrack(track, autoplay) {
      st.now = track;
      renderNow();
      renderQueue();
      if (!track) { player.clear(); await cond.publish({ jump: true, playing: false, pos: 0, rate: 1 }); return; }
      try {
        const p = await player.load(track.src, track.id, 0);
        if (!p || st.now !== track) return;
        p.setRate(1);
        let playing = false;
        if (autoplay) playing = await p.play();
        else p.pause();
        await cond.publish({ jump: true, playing, pos: 0, rate: 1 });
      } catch (e) {
        toast('Could not load “' + track.title + '”: ' + errMsg(e));
        if (st.now === track) skip();
      }
    }

    function skip() { playTrack(st.queue.shift() || null, true); }

    async function togglePlay() {
      overlay.hide();
      const p = player.impl();
      if (!st.now || !p) {
        if (st.queue.length) { skip(); return; }
        toast('Search for music and add a track first.');
        return;
      }
      if (st.playing) { p.pause(); await cond.publish({ playing: false }); return; }
      if (p.state() === 'ended') p.seek(0);
      const ok = await p.play();
      if (!ok) { toast('Your browser blocked playback. Press Play again.'); return; }
      await cond.publish({ playing: true });
    }

    async function resume() {
      overlay.hide();
      const p = player.impl();
      if (!p) return;
      if (!p.live) p.seek(cond.expected());
      let playing = st.playing;
      if (playing) playing = await p.play();
      await cond.publish({ jump: true, playing });
    }

    function ingest(evs) {
      let reqDiff = false;
      for (const ev of evs) {
        const m = ev.msg || {};
        if (m.type === 'vote' && typeof m.id === 'string') {
          if (!votes.has(m.id)) votes.set(m.id, new Set());
          votes.get(m.id).add(ev.name || '?');
        } else if (m.type === 'request' && ev.name !== 'Teacher' && !requests.has(ev.id)) {
          const src = requestSrc(m);
          if (!src) continue;
          const name = String(ev.name || 'Someone').slice(0, 60);
          const count = (perName.get(name) || 0) + 1;
          perName.set(name, count);
          requests.set(ev.id, {
            id: ev.id, name, src, title: srcTitle(src, typeof m.title === 'string' ? m.title.slice(0, 100) : ''), over: count > st.max,
            meta: { artist: String(m.artist || '').slice(0, 80), art: httpsUrl(m.art), from: String(m.from || '').slice(0, 30) }
          });
          reqDiff = true;
        }
      }
      if (reqDiff) renderRequests();
      if (retally()) changed();
    }

    every(500, () => {
      const p = player.impl();
      if (p && p.live) prog.set(p.time(), 0, true);
      else prog.set(p ? p.time() : 0, p ? p.duration() : 0);
      const label = st.playing ? 'Pause' : 'Play';
      if (playBtn.textContent !== label) { playBtn.textContent = label; playBtn.setAttribute('aria-pressed', String(st.playing)); }
      if (p && st.now && st.now.src.type === 'yt' && st.now.title === 'YouTube video' && cond.armed) {
        const t = p.title();
        if (t) { st.now.title = t.slice(0, 120); renderNow(); cond.touch(); }
      }
      if (!(p && p.live)) cond.check();
    });

    try {
      const r = await chan.read();
      const prev = r.state || {};
      st.queue = (Array.isArray(prev.queue) ? prev.queue : []).map(cleanTrack).filter(Boolean);
      st.handled = (Array.isArray(prev.handled) ? prev.handled : []).map(Number).filter(isFinite).slice(-300);
      handled = new Set(st.handled);
      if (typeof prev.requests === 'boolean') { st.requests = prev.requests && set.allowRequests !== false; reqToggle.input.checked = st.requests; }
      const now = cleanTrack(prev.now);
      if (now) {
        Object.assign(st, { now, playing: !!prev.playing, pos: +prev.pos || 0, rate: 1, rev: +prev.rev || 0 });
        cond.adopt(st, r.at);
        await player.load(now.src, now.id, cond.expected());
        if (st.playing) overlay.show();
      }
    } catch (e) { toast('Could not restore the queue: ' + errMsg(e)); }
    renderNow();
    renderQueue();
    renderRequests();
    finder.run();

    let since = 0, first = true;
    const events = every(2000, async () => {
      try {
        const evs = await chan.events(since);
        status.ok();
        if (evs.length) {
          since = Math.max(since, ...evs.map(e => e.id));
          ingest(evs);
          fd.push(evs, !first);
        }
        first = false;
      } catch (e) { status.fail(e); }
    });
  }
};
