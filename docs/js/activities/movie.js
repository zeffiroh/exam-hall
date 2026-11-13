import { el, toast } from '../core.js';
import {
  parseMedia, validSrc, srcKey, srcTitle, fmtTime, clampRate, errMsg, channel, createPlayer, follower, conductor,
  feed, floater, joinOverlay, volumeControl, fullscreenButton, liveStatus, every, toggle
} from '../livesync.js';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const defaults = () => ({ url: '', title: '', allowChat: true });

function srcHint(value) {
  const v = value.trim();
  if (!v) return '';
  const src = parseMedia(v);
  if (!src) return 'Not a recognised YouTube link/ID or http(s) video URL.';
  return src.type === 'yt' ? 'YouTube video · ' + src.id : 'Direct video file (.mp4 or .webm works best)';
}

function cleanSrc(src, title) {
  const out = src.type === 'yt' ? { type: 'yt', id: src.id } : { type: 'file', url: src.url };
  const t = String(title || '').trim().slice(0, 120);
  if (t) out.title = t;
  return out;
}

function buildStage(waiting) {
  const stage = el('div', { class: 'lv-stage', tabindex: '-1' });
  const msg = el('div', { class: 'lv-msg', text: waiting });
  return { stage, msg };
}

export default {
  kind: 'movie',
  label: 'Movie night',
  blurb: 'Watch a video together in sync',
  defaults,

  editor(host, settings, onChange) {
    const s = { ...defaults(), ...(settings || {}) };
    const url = el('input', { type: 'text', inputmode: 'url', value: s.url || '', placeholder: 'https://youtu.be/… or https://…/film.mp4', autocomplete: 'off' });
    const title = el('input', { type: 'text', value: s.title || '', maxlength: '120', placeholder: 'Shown to students while it plays' });
    const hint = el('span', { class: 'hint', 'aria-live': 'polite', text: srcHint(s.url || '') });
    const chat = toggle('Allow chat', s.allowChat !== false, () => emit());
    function emit() {
      hint.textContent = srcHint(url.value);
      onChange({ ...s, url: url.value.trim(), title: title.value.trim(), allowChat: chat.input.checked });
    }
    url.addEventListener('input', emit);
    title.addEventListener('input', emit);
    host.replaceChildren(
      el('label', { class: 'field' }, 'Default video (YouTube link or ID, or a direct .mp4/.webm URL)', url, hint),
      el('label', { class: 'field' }, 'Title (optional)', title),
      chat.el);
  },

  join(host, ctx) {
    const set = { ...defaults(), ...(ctx.activity.settings || {}) };
    const chan = channel(ctx);
    const { stage, msg } = buildStage('Waiting for your teacher to start a video…');
    let cur = null;
    const player = createPlayer(stage, { onError: m => { toast(m); msg.textContent = m; msg.hidden = false; } });
    stage.append(msg, el('div', { class: 'lv-shield', 'aria-hidden': 'true' }));
    const float = floater(stage);
    const overlay = joinOverlay(stage, () => { overlay.hide(); follow.unlock(cur); });
    const follow = follower(player, chan.clock, { onLock: () => { if (follow.unlocked) overlay.show('Click to resume playback'); } });
    const status = liveStatus();
    const title = el('h2', { class: 'lv-title', text: 'Nothing playing yet' });
    const info = el('span', { class: 'mut lv-time', text: '' });
    const fd = feed({
      canChat: set.allowChat !== false,
      onSend: text => chan.post({ type: 'chat', text }).then(() => loop.now()),
      onReact: emoji => chan.post({ type: 'react', emoji }).then(() => loop.now()),
      onFloat: float
    });
    host.replaceChildren(el('div', { class: 'lv' },
      el('div', { class: 'lv-main' }, title, stage,
        el('div', { class: 'lv-ctl' }, status.el, info, el('span', { class: 'sp' }), volumeControl(player, 'lv-vol-movie'), fullscreenButton(stage))),
      fd.el));

    let since = 0, first = true, lastTitle = '';
    const loop = every(2000, async () => {
      try {
        const [r, evs] = await Promise.all([chan.read(), chan.events(since)]);
        status.ok();
        const st = r.state || {};
        const src = validSrc(st.src) ? st.src : null;
        cur = { key: srcKey(src), src, playing: !!(src && st.playing), pos: +st.pos || 0, rate: clampRate(st.rate), rev: st.rev, at: r.at };
        const t = src ? srcTitle(src) : 'Nothing playing yet';
        if (t !== lastTitle) { lastTitle = t; title.textContent = t; }
        if (!src) { msg.textContent = 'Waiting for your teacher to start a video…'; msg.hidden = false; }
        else if (player.key() === cur.key || !player.key()) msg.hidden = true;
        info.textContent = src ? (cur.playing ? 'Playing' : 'Paused') + (cur.rate !== 1 ? ' · ' + cur.rate + '×' : '') : '';
        fd.setCanChat(typeof st.chat === 'boolean' ? st.chat : set.allowChat !== false);
        await follow.apply(cur);
        if (evs.length) { since = Math.max(since, ...evs.map(e => e.id)); fd.push(evs, !first); }
        first = false;
      } catch (e) { status.fail(e); }
    });
    return { stop: loop.stop };
  },

  async host(host, ctx) {
    const set = { ...defaults(), ...(ctx.activity.settings || {}) };
    const chan = channel(ctx);
    const st = { v: 1, src: null, playing: false, pos: 0, rate: 1, rev: 0, chat: set.allowChat !== false };
    const { stage, msg } = buildStage('Load a video to begin.');
    const player = createPlayer(stage, {
      controls: true,
      onEnded: () => cond.publish({ playing: false }),
      onError: m => toast(m)
    });
    stage.append(msg);
    const float = floater(stage);
    const cond = conductor(player, chan, st);
    const overlay = joinOverlay(stage, resume, { text: 'Click to resume hosting', sub: 'The room is still following the current video' });
    overlay.hide();

    const urlIn = el('input', { type: 'text', inputmode: 'url', placeholder: 'YouTube link or ID, or https://…/video.mp4', 'aria-label': 'Video URL', autocomplete: 'off', value: set.url || '' });
    const titleIn = el('input', { type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title', maxlength: '120', value: set.title || '' });
    const loadForm = el('form', { class: 'lv-load' }, urlIn, titleIn, el('button', { class: 'pri', type: 'submit', text: 'Load' }));
    loadForm.addEventListener('submit', e => { e.preventDefault(); loadFrom(urlIn.value, titleIn.value); });

    const playBtn = el('button', { class: 'pri', type: 'button', text: 'Play', 'aria-pressed': 'false' });
    playBtn.addEventListener('click', togglePlay);
    const seek = el('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', class: 'lv-seek', 'aria-label': 'Seek' });
    const timeLbl = el('span', { class: 'lv-time', text: '0:00 / 0:00' });
    let dragging = false;
    seek.addEventListener('input', () => { dragging = true; timeLbl.textContent = fmtTime(seek.value) + ' / ' + fmtTime(seek.max); });
    seek.addEventListener('change', () => {
      dragging = false;
      const p = player.impl();
      if (!p) return;
      overlay.hide();
      p.seek(+seek.value);
      cond.publish({ jump: true, pos: +seek.value, playing: st.playing });
    });
    const rateSel = el('select', { 'aria-label': 'Playback speed' }, RATES.map(r => el('option', { value: String(r), text: r + '×', selected: r === 1 })));
    rateSel.addEventListener('change', () => {
      const p = player.impl();
      const r = +rateSel.value;
      if (!p) return;
      p.setRate(r);
      setTimeout(() => cond.publish({ rate: p.rate(), playing: st.playing }), 150);
    });
    const syncBtn = el('button', { type: 'button', text: 'Sync everyone now' });
    syncBtn.addEventListener('click', async () => {
      if (!player.impl()) { toast('Load a video first.'); return; }
      overlay.hide();
      await cond.publish({ jump: true });
      toast('Everyone has been re-synced.', 2500);
    });
    const chatToggle = toggle('Allow chat', st.chat, v => { st.chat = v; cond.touch(); });
    const status = liveStatus();
    const fd = feed({
      canChat: true, reactions: false,
      onSend: text => chan.post({ type: 'chat', text }).then(() => events.now()),
      onFloat: float
    });

    host.replaceChildren(el('div', { class: 'lv' },
      el('div', { class: 'lv-main' },
        el('section', { class: 'card', 'aria-label': 'Choose a video' }, el('h2', { text: 'Video' }), loadForm, el('p', { class: 'hint', text: 'Paste a YouTube link (or 11-character ID) or a direct link to an .mp4/.webm file.' })),
        stage,
        el('div', { class: 'lv-ctl', role: 'group', 'aria-label': 'Playback controls' }, playBtn, seek, timeLbl),
        el('div', { class: 'lv-ctl' }, el('label', { class: 'lv-volw' }, el('span', { class: 'mut', text: 'Speed' }), rateSel), syncBtn, chatToggle.el, el('span', { class: 'sp' }), status.el, volumeControl(player, 'lv-vol-movie-host'))),
      fd.el));

    async function loadFrom(raw, title) {
      const src = parseMedia(raw);
      if (!src) { toast('Enter a YouTube link/ID or a direct http(s) video URL.'); urlIn.focus(); return; }
      const start = src.start || 0;
      const clean = cleanSrc(src, title);
      overlay.hide();
      try {
        const p = await player.load(clean, srcKey(clean), start);
        if (!p) return;
        st.src = clean;
        msg.hidden = true;
        p.seek(start);
        p.pause();
        await cond.publish({ jump: true, playing: false, pos: start, rate: 1 });
        rateSel.value = '1';
        p.setRate(1);
      } catch (e) { toast(errMsg(e)); }
    }

    async function togglePlay() {
      const p = player.impl();
      if (!p) { toast('Load a video first.'); return; }
      overlay.hide();
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
      p.seek(cond.expected());
      let playing = st.playing;
      if (playing) playing = await p.play();
      await cond.publish({ jump: true, playing });
    }

    every(500, () => {
      const p = player.impl();
      const dur = p ? p.duration() : 0, t = p ? p.time() : 0;
      if (!dragging) {
        seek.max = String(Math.max(0, Math.floor(dur)));
        seek.value = String(Math.floor(t));
        seek.setAttribute('aria-valuetext', fmtTime(t) + ' of ' + fmtTime(dur));
        timeLbl.textContent = fmtTime(t) + ' / ' + fmtTime(dur);
      }
      seek.disabled = !p;
      const label = st.playing ? 'Pause' : 'Play';
      if (playBtn.textContent !== label) { playBtn.textContent = label; playBtn.setAttribute('aria-pressed', String(st.playing)); }
      if (p && document.activeElement !== rateSel) {
        const r = String(p.rate());
        if (RATES.map(String).includes(r) && rateSel.value !== r) rateSel.value = r;
      }
      if (p && st.src && st.src.type === 'yt' && !st.src.title && cond.armed) {
        const t2 = p.title();
        if (t2) { st.src = { ...st.src, title: t2.slice(0, 120) }; cond.touch(); }
      }
      cond.check();
    });

    let since = 0, first = true;
    const events = every(2000, async () => {
      try {
        const evs = await chan.events(since);
        status.ok();
        if (evs.length) { since = Math.max(since, ...evs.map(e => e.id)); fd.push(evs, !first); }
        first = false;
      } catch (e) { status.fail(e); }
    });

    try {
      const r = await chan.read();
      const prev = r.state || {};
      if (validSrc(prev.src)) {
        Object.assign(st, { src: cleanSrc(prev.src, prev.src.title), playing: !!prev.playing, pos: +prev.pos || 0, rate: clampRate(prev.rate), rev: +prev.rev || 0 });
        if (typeof prev.chat === 'boolean') { st.chat = prev.chat; chatToggle.input.checked = prev.chat; }
        cond.adopt(st, r.at);
        urlIn.value = prev.src.type === 'yt' ? 'https://youtu.be/' + prev.src.id : prev.src.url;
        titleIn.value = prev.src.title || '';
        await player.load(st.src, srcKey(st.src), cond.expected());
        msg.hidden = true;
        if (st.playing) overlay.show();
      } else if (set.url && parseMedia(set.url)) {
        await loadFrom(set.url, set.title);
      }
    } catch (e) { toast('Could not restore the room: ' + errMsg(e)); }
  }
};
