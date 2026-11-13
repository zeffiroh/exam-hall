import { el, toast } from './core.js';

export const YT_ID = /^[\w-]{11}$/;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|weba|webm)$/i;
const EMOJI = [['👍', 'Thumbs up'], ['😂', 'Laughing'], ['😮', 'Surprised'], ['❤️', 'Love'], ['🎉', 'Celebrate'], ['👏', 'Applause']];
const EMOJI_SET = new Set(EMOJI.map(e => e[0]));

export const errMsg = e => (e && e.message) || String(e || 'Unknown error');
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clampRate = r => Math.min(2, Math.max(0.25, +r || 1));

function parseStart(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
}

export function parseMedia(input) {
  const s = String(input || '').trim();
  if (!s || s.length > 1000) return null;
  if (YT_ID.test(s)) return { type: 'yt', id: s };
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] || '';
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    id = u.searchParams.get('v') || (m ? m[1] : '');
  }
  if (id != null) {
    if (!YT_ID.test(id)) return null;
    const start = parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
    return start ? { type: 'yt', id, start } : { type: 'yt', id };
  }
  return { type: 'file', url: u.href };
}

export function isAudioUrl(url) {
  try { return AUDIO_EXT.test(new URL(url).pathname); } catch { return false; }
}

export function validSrc(src) {
  if (!src || typeof src !== 'object') return false;
  if (src.type === 'yt') return YT_ID.test(String(src.id || ''));
  if (src.type === 'file') {
    try { return /^https?:$/.test(new URL(src.url).protocol); } catch { return false; }
  }
  return false;
}

export const srcKey = src => (!src ? '' : src.type === 'yt' ? 'yt:' + src.id : 'file:' + src.url);
export const srcUrl = src => (src.type === 'yt' ? 'https://www.youtube.com/watch?v=' + src.id : src.url);

export function fileName(url) {
  try {
    const n = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return n.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').trim() || url;
  } catch { return url; }
}

export function srcTitle(src, title) {
  const t = String(title || (src && src.title) || '').trim();
  if (t) return t.slice(0, 120);
  if (!src) return '';
  return src.type === 'yt' ? 'YouTube video' : fileName(src.url);
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}

export function store(key, fallback) {
  return {
    get() { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} }
  };
}

let ytReady = null;
export function loadYT() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytReady) return ytReady;
  ytReady = new Promise((ok, no) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); ok(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { ytReady = null; s.remove(); no(new Error('Could not load the YouTube player. Check your connection or content filter.')); };
    document.head.append(s);
  });
  return ytReady;
}

const YT_ERR = {
  2: 'That YouTube video ID is not valid.',
  5: 'YouTube could not play this video in the browser.',
  100: 'That YouTube video was removed or is private.',
  101: 'The owner of that YouTube video does not allow embedding.',
  150: 'The owner of that YouTube video does not allow embedding.'
};

function fileImpl(media, url, start) {
  let blocked = false;
  if (media.getAttribute('src') !== url) { media.src = url; media.load(); }
  if (start) { try { media.currentTime = start; } catch {} }
  return {
    type: 'file',
    canNudge: true,
    time: () => media.currentTime || 0,
    duration: () => (isFinite(media.duration) ? media.duration : 0),
    state: () => (media.ended ? 'ended' : media.paused ? 'paused' : media.readyState < 3 ? 'buffering' : 'playing'),
    blocked: () => blocked,
    play() {
      let p;
      try { p = media.play(); } catch { return Promise.resolve(false); }
      if (!p || !p.then) return Promise.resolve(true);
      return p.then(() => { blocked = false; return true; }, e => { if (e && e.name === 'NotAllowedError') blocked = true; return false; });
    },
    pause: () => media.pause(),
    seek: t => { try { media.currentTime = Math.max(0, t); } catch {} },
    rate: () => media.playbackRate || 1,
    setRate: r => { media.playbackRate = r; },
    setVolume: v => { media.volume = v; media.muted = v <= 0; },
    title: () => '',
    destroy() { media.pause(); media.removeAttribute('src'); media.load(); }
  };
}

function ytImpl(box, src, start, opts) {
  return loadYT().then(YT => new Promise((ok, no) => {
    const holder = el('div');
    box.append(holder);
    let playAsk = 0, cuedAt = start || 0, done = false, p;
    const call = (fn, fb, ...a) => { try { return p && typeof p[fn] === 'function' ? p[fn](...a) : fb; } catch { return fb; } };
    const ps = () => call('getPlayerState', -1);
    const timer = setTimeout(() => { if (!done) { done = true; api.destroy(); no(new Error('The YouTube player took too long to load.')); } }, 20000);
    const vars = { autoplay: 0, controls: opts.controls ? 1 : 0, disablekb: opts.controls ? 0 : 1, fs: opts.controls ? 1 : 0, playsinline: 1, rel: 0, iv_load_policy: 3, modestbranding: 1, start: Math.floor(start || 0) };
    if (location.origin && location.origin !== 'null') vars.origin = location.origin;
    const api = {
      type: 'yt',
      canNudge: false,
      time() { const s = ps(); return (s === -1 || s === 5) && cuedAt != null ? cuedAt : call('getCurrentTime', 0) || 0; },
      duration: () => call('getDuration', 0) || 0,
      state() { const s = ps(); return s === 1 ? 'playing' : s === 3 ? 'buffering' : s === 0 ? 'ended' : 'paused'; },
      blocked() { const s = ps(); return !!playAsk && Date.now() - playAsk > 3500 && (s === -1 || s === 2 || s === 5); },
      play() { if (!playAsk) playAsk = Date.now(); call('playVideo'); return Promise.resolve(true); },
      pause() { playAsk = 0; call('pauseVideo'); },
      seek(t) {
        t = Math.max(0, t);
        const s = ps();
        if ((s === -1 || s === 5) && !playAsk) { cuedAt = t; call('cueVideoById', null, { videoId: src.id, startSeconds: t }); }
        else { cuedAt = null; call('seekTo', null, t, true); }
      },
      rate: () => call('getPlaybackRate', 1) || 1,
      setRate: r => call('setPlaybackRate', null, r),
      setVolume(v) { if (v <= 0) call('mute'); else { call('unMute'); call('setVolume', null, Math.round(v * 100)); } },
      title() { const d = call('getVideoData', null); return (d && d.title) || ''; },
      destroy() {
        const f = call('getIframe', null);
        call('destroy');
        if (f && f.remove) f.remove();
        holder.remove();
      }
    };
    p = new YT.Player(holder, {
      width: '100%', height: '100%', videoId: src.id, playerVars: vars,
      events: {
        onReady: () => { if (done) return; done = true; clearTimeout(timer); ok(api); },
        onStateChange: e => { if (e.data === 1) { playAsk = 0; cuedAt = null; } if (e.data === 0 && opts.onEnded) opts.onEnded(); },
        onError: e => { if (opts.onError) opts.onError(YT_ERR[e.data] || 'YouTube could not play this video.'); }
      }
    });
  }));
}

export function createPlayer(stage, { audio = false, controls = false, onEnded, onError } = {}) {
  const box = el('div', { class: 'lv-media' });
  stage.prepend(box);
  let impl = null, key = '', token = 0, volume = 1, media = null;
  function fileEl(cors) {
    if (media && !!media.crossOrigin === !!cors) return media;
    if (media) { media.pause(); media.removeAttribute('src'); media.load(); media.remove(); }
    media = el(audio ? 'audio' : 'video', { preload: 'auto', playsinline: true });
    if (cors) media.crossOrigin = 'anonymous';
    if (controls && !audio) media.controls = true;
    media.addEventListener('ended', () => { if (onEnded && impl && impl.type === 'file') onEnded(); });
    media.addEventListener('error', () => { if (media.getAttribute('src') && onError) onError('This media file could not be played. Check that the link points directly to the file.'); });
    box.append(media);
    return media;
  }
  function drop() { if (impl) impl.destroy(); impl = null; if (media) media.hidden = true; }
  return {
    el: box,
    key: () => key,
    impl: () => impl,
    media: () => (impl && impl.type === 'file' ? media : null),
    type: () => (impl ? impl.type : ''),
    async load(src, k, start = 0) {
      k = k || srcKey(src);
      if (k === key && impl) return impl;
      const my = ++token;
      drop();
      key = k;
      try {
        let next;
        if (src.type === 'yt') next = await ytImpl(box, src, start, { controls, onEnded, onError });
        else { const m = fileEl(src.cors); m.hidden = false; next = fileImpl(m, src.url, src.live ? 0 : start); if (src.live) next.live = true; }
        if (my !== token) { if (next.type === 'yt') next.destroy(); return impl; }
        impl = next;
        impl.setVolume(volume);
        return impl;
      } catch (e) {
        if (my === token) key = '';
        throw e;
      }
    },
    clear() { token++; drop(); key = ''; },
    setVolume(v) { volume = v; if (impl) impl.setVolume(v); }
  };
}

export function makeClock() {
  const samples = [];
  let off = 0;
  return {
    sample(t0, t1, server) {
      if (!isFinite(server) || !server) return;
      samples.push({ rtt: t1 - t0, off: server - (t0 + t1) / 2000 });
      if (samples.length > 8) samples.shift();
      off = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
    },
    now: () => Date.now() / 1000 + off
  };
}

export function channel(ctx) {
  const slug = ctx.activity.slug;
  const clock = makeClock();
  if (!ctx.isHost) {
    const u = ctx.user;
    return {
      clock,
      async read() {
        const t0 = Date.now();
        const r = (await ctx.S.liveGet(u, slug)) || {};
        const t1 = Date.now();
        clock.sample(t0, t1, +r.now);
        return { state: r.state || {}, at: +r.at || 0 };
      },
      async events(since) {
        const r = await ctx.S.liveEvents(u, slug, since || 0);
        return (Array.isArray(r) ? r : []).map(x => ({ id: +x.id, at: +x.at, name: x.name || '', msg: x.msg || {} }));
      },
      post: msg => ctx.S.livePost(u, slug, msg)
    };
  }
  let lag = 0.08, inflight = null, pending = null;
  async function send(build) {
    const q = await ctx.teacherSql();
    const state = build(lag);
    const t0 = performance.now();
    await q`insert into exam.live(activity,state,updated_at) values(${slug}, ${JSON.stringify(state)}::jsonb, now()) on conflict(activity) do update set state=excluded.state, updated_at=now()`;
    lag = Math.min(1, lag * 0.7 + (performance.now() - t0) / 2000 * 0.3);
  }
  return {
    clock,
    write(build) {
      pending = build;
      if (!inflight) inflight = (async () => {
        while (pending) {
          const b = pending;
          pending = null;
          try { await send(b); } catch (e) { toast('Could not update the room: ' + errMsg(e)); }
        }
        inflight = null;
      })();
      return inflight;
    },
    async read() {
      const q = await ctx.teacherSql();
      const t0 = Date.now();
      const r = await q`select state, extract(epoch from updated_at)::float8 as at, extract(epoch from clock_timestamp())::float8 as now from exam.live where activity=${slug}`;
      const t1 = Date.now();
      if (!r.length) { const n = await q`select extract(epoch from clock_timestamp())::float8 as now`; clock.sample(t0, Date.now(), +n[0].now); return { state: {}, at: 0 }; }
      clock.sample(t0, t1, +r[0].now);
      return { state: r[0].state || {}, at: +r[0].at || 0 };
    },
    async events(since) {
      const q = await ctx.teacherSql();
      const r = await q`select id::float8 as id, extract(epoch from at)::float8 as at, name, msg from (select * from exam.live_events where activity=${slug} and id>${since || 0} order by id desc limit 200) e order by id`;
      return r.map(x => ({ id: +x.id, at: +x.at, name: x.name || '', msg: x.msg || {} }));
    },
    async post(msg) {
      const q = await ctx.teacherSql();
      await q`insert into exam.live_events(activity,name,msg) values(${slug}, 'Teacher', ${JSON.stringify(msg)}::jsonb)`;
    }
  };
}

export function every(ms, fn) {
  let timer = null, running = false, again = false, dead = false;
  async function tick() {
    if (dead) return;
    if (running) { again = true; return; }
    clearTimeout(timer);
    running = true;
    try { await fn(); } catch {} finally {
      running = false;
      if (!dead) {
        if (again) { again = false; tick(); } else timer = setTimeout(tick, ms);
      }
    }
  }
  tick();
  return { now: tick, stop() { dead = true; clearTimeout(timer); } };
}

export function liveStatus() {
  const chip = el('span', { class: 'chip lv-stat', role: 'status', text: 'Connecting…' });
  let bad = 0;
  const set = (t, cls) => { if (chip.textContent !== t) chip.textContent = t; chip.classList.toggle('ok', cls === 'ok'); chip.classList.toggle('bad', cls === 'bad'); };
  return {
    el: chip,
    ok(t = 'Live') { bad = 0; set(t, 'ok'); },
    fail(e) { bad++; if (bad === 2) toast('Connection problem: ' + errMsg(e)); set('Reconnecting…', 'bad'); }
  };
}

export function target(t, clock) {
  return (+t.pos || 0) + (t.playing ? Math.max(0, clock.now() - t.at) * (t.rate || 1) : 0);
}

export function follower(player, clock, { onLock } = {}) {
  let unlocked = false, lastRev, busy = false, failedKey = '';
  async function apply(t) {
    if (!t || busy) return;
    busy = true;
    try {
      if (!t.src) { if (player.key()) player.clear(); return; }
      if (player.key() !== t.key) {
        if (t.key === failedKey) return;
        try { await player.load(t.src, t.key, Math.max(0, target(t, clock))); }
        catch (e) { failedKey = t.key; toast(errMsg(e)); return; }
        lastRev = undefined;
      }
      const p = player.impl();
      if (!p) return;
      if (p.live) {
        if (t.playing) { if (!unlocked) { if (onLock) onLock(); return; } if (p.state() === 'paused') await p.play(); if (p.blocked() && onLock) onLock(); }
        else if (p.state() !== 'paused') p.pause();
        return;
      }
      const rate = t.rate || 1, dur = p.duration();
      let goal = target(t, clock);
      if (dur && goal > dur) goal = dur;
      const st = p.state(), drift = goal - p.time(), jumped = t.rev !== lastRev;
      lastRev = t.rev;
      if (t.playing) {
        if (!unlocked) { if (onLock) onLock(); return; }
        if (dur && goal >= dur - 0.5) return;
        if (Math.abs(drift) > 1.5 || (jumped && Math.abs(drift) > 0.4)) { p.seek(goal); p.setRate(rate); }
        else if (p.canNudge && Math.abs(drift) > 0.2) p.setRate(rate * (1 + Math.max(-0.08, Math.min(0.08, drift * 0.1))));
        else if (Math.abs(p.rate() - rate) > 0.001) p.setRate(rate);
        if (st === 'paused' || st === 'ended') await p.play();
        if (p.blocked() && onLock) onLock();
      } else {
        if (st === 'playing' || st === 'buffering') p.pause();
        if (Math.abs(drift) > 0.5) p.seek(goal);
        if (Math.abs(p.rate() - rate) > 0.001) p.setRate(rate);
      }
    } finally { busy = false; }
  }
  return {
    apply,
    get unlocked() { return unlocked; },
    unlock(t) {
      unlocked = true;
      const p = player.impl();
      if (p && t && t.playing) {
        const goal = target(t, clock);
        if (Math.abs(goal - p.time()) > 0.4) p.seek(goal);
        p.play();
      } else if (p && p.type === 'file') {
        p.play().then(() => { if (!t || !t.playing) p.pause(); });
      }
      setTimeout(() => apply(t), 50);
    }
  };
}

export function conductor(player, chan, st) {
  let base = null, quietUntil = 0, armed = false;
  const now = () => performance.now() / 1000;
  const expected = () => (base ? base.pos + (base.playing ? (now() - base.t) * base.rate : 0) : +st.pos || 0);
  function write() {
    return chan.write(lag => ({ ...st, pos: Math.max(0, expected() + (base && base.playing ? lag * base.rate : 0)) }));
  }
  function publish({ jump = false, playing, pos, rate } = {}) {
    armed = true;
    const p = player.impl();
    const snap = {
      playing: playing != null ? playing : !!p && ['playing', 'buffering'].includes(p.state()),
      pos: pos != null ? pos : p ? p.time() : 0,
      rate: rate != null ? rate : p ? p.rate() : 1
    };
    base = { ...snap, t: now() };
    quietUntil = now() + 2.5;
    st.playing = snap.playing;
    st.rate = snap.rate;
    if (jump) st.rev = (+st.rev || 0) + 1;
    return write();
  }
  return {
    publish,
    expected,
    get armed() { return armed; },
    touch: write,
    adopt(remote, at) {
      const lead = remote.playing ? Math.max(0, chan.clock.now() - at) * (remote.rate || 1) : 0;
      base = { playing: !!remote.playing, pos: (+remote.pos || 0) + lead, rate: remote.rate || 1, t: now() };
    },
    check() {
      if (!armed || !base || now() < quietUntil) return;
      const p = player.impl();
      if (!p) return;
      const s = p.state();
      if (s === 'ended') return;
      const playing = s === 'playing' || s === 'buffering';
      const jump = Math.abs(p.time() - expected()) > 1;
      if (playing !== base.playing || Math.abs(p.rate() - base.rate) > 0.01 || jump) publish({ jump });
    }
  };
}

export function floater(stage) {
  const layer = el('div', { class: 'lv-float', 'aria-hidden': 'true' });
  stage.append(layer);
  return emoji => {
    if (!EMOJI_SET.has(emoji) || layer.childElementCount > 30) return;
    const s = el('span', { text: emoji });
    s.style.left = (6 + Math.random() * 82) + '%';
    layer.append(s);
    setTimeout(() => s.remove(), 2800);
  };
}

export function joinOverlay(stage, onJoin, { text = 'Click to join playback', sub = 'Your teacher controls playback for everyone' } = {}) {
  const label = el('span', { text });
  const b = el('button', { type: 'button', class: 'lv-join' },
    el('span', { class: 'lv-play', 'aria-hidden': 'true', text: '▶' }), label, el('span', { class: 'lv-sub', text: sub }));
  b.addEventListener('click', onJoin);
  stage.append(b);
  return {
    el: b,
    show(t) { if (t) label.textContent = t; b.hidden = false; },
    hide() { const had = document.activeElement === b; b.hidden = true; if (had) stage.focus(); }
  };
}

export function volumeControl(player, key) {
  const saved = store(key, 1);
  let v = Math.min(1, Math.max(0, +saved.get()));
  if (!isFinite(v)) v = 1;
  player.setVolume(v);
  const range = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(v * 100)), class: 'lv-vol' });
  range.addEventListener('input', () => { v = range.value / 100; player.setVolume(v); saved.set(v); });
  return el('label', { class: 'lv-volw' }, el('span', { class: 'mut', text: 'Volume' }), range);
}

export function fullscreenButton(stage) {
  if (!document.fullscreenEnabled || !stage.requestFullscreen) return null;
  const b = el('button', { type: 'button', text: 'Full screen' });
  b.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else stage.requestFullscreen().catch(() => toast('Full screen is not available here.'));
  });
  document.addEventListener('fullscreenchange', () => { b.textContent = document.fullscreenElement === stage ? 'Exit full screen' : 'Full screen'; });
  return b;
}

export function feed({ canChat = true, reactions = true, onSend, onReact, onFloat, describe, label = 'Chat' } = {}) {
  const seen = new Set();
  const empty = el('li', { class: 'sys', text: 'No messages yet.' });
  const log = el('ol', { class: 'lv-log', 'aria-label': 'Messages', tabindex: '0' }, empty);
  const input = el('input', { type: 'text', maxlength: '300', placeholder: 'Say something…', 'aria-label': 'Chat message', autocomplete: 'off' });
  const send = el('button', { class: 'pri', type: 'submit', text: 'Send' });
  const form = el('form', { class: 'lv-say' }, input, send);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    try { await onSend(text); input.value = ''; }
    catch (x) { toast('Message not sent: ' + errMsg(x)); }
    finally { setTimeout(() => { send.disabled = false; }, 700); }
  });
  let lastReact = 0;
  const react = reactions && onReact ? el('div', { class: 'lv-react', role: 'group', 'aria-label': 'Send a reaction' },
    EMOJI.map(([e, name]) => el('button', {
      type: 'button', text: e, 'aria-label': name, title: name,
      onclick: async () => {
        if (Date.now() - lastReact < 700) return;
        lastReact = Date.now();
        try { await onReact(e); } catch (x) { toast('Reaction not sent: ' + errMsg(x)); }
      }
    }))) : null;
  const off = el('p', { class: 'hint', text: 'Chat is turned off for this activity.' });
  const box = el('section', { class: 'card lv-feed', 'aria-label': label }, el('h2', { text: label }), log, react, form, off);
  function setCanChat(v) { form.hidden = !v; off.hidden = !!v; }
  setCanChat(canChat);
  let primed = false;
  return {
    el: box,
    setCanChat,
    push(events, fresh) {
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
      let added = false;
      for (const ev of events) {
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        const m = ev.msg || {}, who = String(ev.name || 'Someone').slice(0, 60);
        let li = null;
        if (m.type === 'chat' && typeof m.text === 'string' && m.text.trim()) li = el('li', null, el('b', { text: who + ': ' }), m.text.slice(0, 300));
        else if (m.type === 'react' && EMOJI_SET.has(m.emoji)) {
          li = el('li', { class: 'sys' }, who + ' reacted ' + m.emoji);
          if (fresh && onFloat) onFloat(m.emoji);
        } else if (describe) {
          const d = describe(m, ev);
          if (d) li = el('li', { class: 'sys' }, who + ' ' + d);
        }
        if (li) {
          if (ev.at) li.title = new Date(ev.at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          empty.remove();
          log.append(li);
          added = true;
        }
      }
      while (log.children.length > 200) log.firstElementChild.remove();
      if (added && (near || !fresh)) log.scrollTop = log.scrollHeight;
      if (!primed) { primed = true; log.setAttribute('aria-live', 'polite'); }
    }
  };
}

export function toggle(labelText, checked, onChange) {
  const box = el('input', { type: 'checkbox', checked: !!checked });
  box.addEventListener('change', () => onChange(box.checked));
  return { el: el('label', { class: 'lv-check' }, box, el('span', { text: labelText })), input: box };
}
