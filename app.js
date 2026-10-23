/* BrainStorm app v0.2.0 — Brain Candy Studio
   Plain JavaScript on purpose: no build step, quick to load on nursery tablets.
   Every permission rule is enforced in the database; this file only shows or hides buttons. */
(function () {
  'use strict';
  const cfg = window.BRAINSTORM_CONFIG;
  // Every call to the server gives up quickly when there is no signal, so the app never freezes waiting.
  // With no connection at all it fails straight away; on a weak connection it waits up to 10 seconds.
  let netHooks = { fail: () => {}, ok: () => {} };
  // Tap feedback: the last button tapped shows a spinner while the server is working on it
  let tapped = null, tappedAt = 0, inflight = 0;
  const busyStart = () => { inflight++; if (tapped && Date.now() - tappedAt < 120 && tapped.isConnected && tapped.matches('button.btn, button.iconbtn')) tapped.classList.add('busy'); };
  const busyEnd = () => { inflight = Math.max(0, inflight - 1); if (!inflight) document.querySelectorAll('.busy').forEach((b) => b.classList.remove('busy')); };
  function timedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    if (navigator.onLine === false) { netHooks.fail(); return Promise.reject(new TypeError('offline')); }
    const upload = url.includes('/storage/v1/object/') && method !== 'GET';
    if (upload) return fetch(input, init); // picture uploads can take a while: no time limit
    const ctl = new AbortController();
    if (init.signal) init.signal.addEventListener('abort', () => ctl.abort());
    const t = setTimeout(() => ctl.abort(), url.includes('/auth/v1/') ? 15000 : 10000);
    busyStart();
    return fetch(input, { ...init, signal: ctl.signal })
      .then((r) => { clearTimeout(t); busyEnd(); netHooks.ok(); return r; })
      .catch((e) => { clearTimeout(t); busyEnd(); if (!(init.signal && init.signal.aborted)) netHooks.fail(); throw e; });
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    global: { fetch: timedFetch }
  });
  const mainEl = document.getElementById('app');
  let app = mainEl;
  // Tablet / desktop: chat list on the left, the open chat on the right
  const side = document.createElement('aside'); side.id = 'side'; side.setAttribute('aria-label', 'Chats');
  const layout = document.createElement('div'); layout.id = 'layout';
  mainEl.before(layout); layout.append(side, mainEl);
  const isWide = () => !!(S && S.me) && window.matchMedia('(min-width: 900px)').matches;
  const COLORS = ['#2FF4FB', '#57A9FA', '#A750F7', '#FC70FC', '#FBDD63', '#7FF7D8'];

  const S = {
    session: null, me: null, roles: {}, rules: {}, people: {}, sites: {}, businesses: {}, stickers: {},
    tab: 'chats', channels: [], current: null, messages: [], pendingRequests: 0,
    listSub: null, roomSub: null, emailForCode: '', dir: {}
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const THEMES = [
    { id: 'storm-dark', label: 'Storm', sw: ['#080C17', '#45E9FF', '#A66CFF'] },
    { id: 'storm-light', label: 'Neon white', sw: ['#FDFDFC', '#5EB2C2', '#03303A'] },
    { id: 'jungle', label: 'Jungle', sw: ['#F4EADB', '#2E7D32', '#C9A27A'] },
    { id: 'nursery', label: 'Nursery', sw: ['#FFF8EE', '#1E88E5', '#E53935', '#FDD835', '#43A047', '#8E24AA'] }
  ];
  function getTheme() { try { return localStorage.getItem('bs-theme') || 'storm-dark'; } catch (_) { return 'storm-dark'; } }
  function applyTheme(t) {
    if (!THEMES.some((x) => x.id === t)) t = 'storm-dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('bs-theme', t); } catch (_) {}
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = t === 'jungle' ? '#1F3D2B' : t === 'nursery' ? '#3B2A7A' : t === 'storm-light' ? '#F4F8F9' : '#05061C';
  }
  const heroSrc = () => (getTheme() === 'nursery' ? '/icons/nursery-hero.webp?v=3' : getTheme() === 'jungle' ? '/icons/jungle-hero.webp?v=2' : getTheme() === 'storm-light' ? '/icons/neonwhite-hero.webp?v=3' : '/icons/storm-hero.webp');
  const nw = () => getTheme() === 'storm-light';
  const wmSrc = (small) => nw() ? (small ? '/icons/wordmark-light-600.webp?v=4' : '/icons/wordmark-light.webp?v=4') : (small ? '/icons/wordmark-600.webp' : '/icons/wordmark.webp');
  const logoSrc = () => nw() ? '/icons/logo-neon-white-128.webp' : getTheme() === 'jungle' ? '/icons/logo-jungle-128.webp' : getTheme() === 'nursery' ? '/icons/logo-nursery-128.webp?v=1' : '/icons/logo-storm-128.webp';
  // Keep the header pictures decoded in memory so re-drawing the list never blinks.
  const KEEP = [];
  ['/icons/logo-storm-128.webp', '/icons/logo-neon-white-128.webp', '/icons/logo-jungle-128.webp', '/icons/logo-nursery-128.webp?v=1', '/icons/wordmark-600.webp', '/icons/wordmark-light-600.webp?v=4']
    .forEach((u) => { const i = new Image(); i.decoding = 'async'; i.src = u; KEEP.push(i); });
  applyTheme(getTheme());
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const colorFor = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const rank = (m) => (m && S.roles[m.role_code] ? S.roles[m.role_code].rank : 0);
  const myRank = () => rank(S.me);
  const can = (ruleKey) => myRank() >= (S.rules[ruleKey] ?? 999);
  // managers can message anyone; everyone can start a private chat with a manager (deputy and above)
  const canStartDm = (id) => can('private_chat_min_rank') || (((S.roles[(S.people[id] || {}).role_code] || {}).rank || 0) >= (S.rules.message_managers_min_rank ?? 40))
    || !!(S.me && S.me.dm_whole_business && S.me.business_id && S.people[id] && S.people[id].business_id === S.me.business_id);
  // Picture rings (chosen on the Me page). A coloured band, plus little decorations for the fun ones.
  const solid = (c) => c;
  const stripes = (c) => `repeating-conic-gradient(${c} 0 12deg, #fff 12deg 24deg)`;
  const RINGS = [
    { id: 'rainbow', label: 'Rainbow', band: 'conic-gradient(#ff3b30,#ff9500,#ffcc00,#34c759,#2fa8ff,#5856d6,#af52de,#ff3b30)' },
    { id: 'neon', label: 'Neon', band: 'conic-gradient(#2FF4FB,#A750F7,#FC70FC,#2FF4FB)', glow: '0 0 10px rgba(47,244,251,.8)' },
    { id: 'monkeymoos', label: 'MonkeyMoos colours', band: 'conic-gradient(#E53935,#FDD835,#43A047,#1E88E5,#E53935)' },
    { id: 'sunset', label: 'Sunset', band: 'linear-gradient(160deg,#FFB347,#FF5E62,#6A3093)' },
    { id: 'hearts', label: 'Hearts', band: solid('#FF6FB5'), deco: ['💖', '💗', '💕', '💞'] },
    { id: 'stars', label: 'Stars', band: solid('#FFD54F'), deco: ['⭐', '✨', '🌟', '⭐'] },
    { id: 'fairy', label: 'Fairy dust', band: 'linear-gradient(135deg,#F8E1FF,#C9B6FF)', deco: ['✨', '✨', '✨', '✨'] },
    { id: 'flowers', label: 'Flowers', band: solid('#81C784'), deco: ['🌸', '🌼', '🌺', '🌷'] },
    { id: 'butterflies', label: 'Butterflies', band: solid('#81D4FA'), deco: ['🦋', '🦋', '🦋', '🦋'] },
    { id: 'snow', label: 'Snow', band: 'linear-gradient(135deg,#FFFFFF,#BFE6FF)', deco: ['❄️', '❄️', '❄️', '❄️'] },
    { id: 'christmas', label: 'Christmas', band: 'conic-gradient(#C62828 0 25%,#2E7D32 0 50%,#C62828 0 75%,#2E7D32 0)', deco: ['🎄', '🎁', '🔔', '⭐'] },
    { id: 'halloween', label: 'Halloween', band: 'conic-gradient(#FB8C00 0 25%,#4A148C 0 50%,#FB8C00 0 75%,#4A148C 0)', deco: ['🎃', '👻', '🦇', '🕸️'] },
    { id: 'fire', label: 'Fire', band: 'conic-gradient(#FF3D00,#FFAB00,#FF3D00)', deco: ['🔥', '🔥', '🔥', '🔥'] },
    { id: 'water', label: 'Water', band: solid('#29B6F6'), deco: ['💧', '💧', '💧', '💧'] },
    { id: 'galaxy', label: 'Galaxy', band: 'conic-gradient(#1A0B3D,#4527A0,#1A0B3D)', deco: ['🪐', '✨', '⭐', '🌙'] },
    { id: 'earth', label: 'Earth', band: solid('#43A047'), deco: ['🌍', '🍀', '🌿', '🍀'] },
    { id: 'shooting', label: 'Shooting star', band: solid('#1A237E'), deco: ['🌠'] },
    { id: 'gold-rosette', label: 'Gold rosette', band: stripes('#E6B800'), deco: ['🎀'] },
    { id: 'blue-rosette', label: 'Blue rosette', band: stripes('#1E88E5'), deco: ['🎀'] },
    { id: 'red-rosette', label: 'Red rosette', band: stripes('#E53935'), deco: ['🎀'] },
    { id: 'gold', label: 'Gold', band: 'linear-gradient(135deg,#B8860B,#FFE57F,#B8860B)' },
    { id: 'berry', label: 'Berry pink', band: solid('#E91E8C') },
    { id: 'sky', label: 'Sky blue', band: solid('#29B6F6') },
    { id: 'lime', label: 'Lime green', band: solid('#7CB342') },
    { id: 'sunshine', label: 'Sunshine yellow', band: solid('#FDD835') },
    { id: 'grape', label: 'Grape purple', band: solid('#8E24AA') },
    { id: 'orange', label: 'Orange', band: solid('#FB8C00') },
    { id: 'navy', label: 'Navy', band: solid('#1A237E') }
  ];
  const RING = {}; RINGS.forEach((r) => { RING[r.id] = r; });
  const decoCache = {};
  function decoUrl(r) {
    if (!r.deco) return '';
    if (decoCache[r.id]) return decoCache[r.id];
    // Spread the decorations round the circle (one = bottom centre, like a rosette ribbon)
    const angles = r.deco.length === 1 ? [90] : [-45, -135, 180, 120]; // keep the bottom-right free for the green status dot
    const t = r.deco.map((e, i) => { const a = angles[i % angles.length] * Math.PI / 180; const x = 72 + 58 * Math.cos(a), y = 72 + 58 * Math.sin(a);
      return `<text x='${x.toFixed(1)}' y='${y.toFixed(1)}' font-size='${r.deco.length === 1 ? 34 : 26}' text-anchor='middle' dominant-baseline='central'>${e}</text>`; }).join('');
    return (decoCache[r.id] = `url(&quot;data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 144 144'>${t}</svg>`)}&quot;)`);
  }
  function ringWrap(ringId, html) {
    const r = RING[ringId]; if (!r) return html;
    return `<span class="avr${r.deco ? ' deco' : ''}" style="--rb:${r.band};${r.glow ? `--rg:${r.glow};` : ''}${r.deco ? `--rd:${decoUrl(r)}` : ''}">${html}</span>`;
  }
  function avatar(id, extraClass, ringOverride) {
    const p = S.people[id] || (S.me && S.me.id === id ? S.me : null);
    const inner = p && p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(p ? (p.display_name || p.full_name) : '?'));
    const ring = ringOverride !== undefined ? ringOverride : p && p.avatar_ring;
    return ringWrap(ring, `<div class="av ${extraClass || ''}" data-ini="${esc(initials(p ? (p.display_name || p.full_name) : '?'))}" style="background:${colorFor(id)}">${inner}</div>`);
  }
  const nameOf = (id) => { const p = S.people[id]; return p ? (p.display_name || p.full_name) : (S.bots && S.bots[id]) || 'Someone'; };
  const BOT_ICON = { Mothership: '/icons/mothership-96.webp', MooseHub: '/icons/moosehub-96.webp', Vote: '/icons/icon-96.png', BrainStorm: '/icons/icon-96.png' };
  function when(ts) {
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const diff = (now - d) / 86400000;
    if (diff < 6) return d.toLocaleDateString('en-GB', { weekday: 'short' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function toast(msg, alert) {
    const t = document.getElementById('toast');
    t.classList.toggle('alert', !!alert || /rule:|not allowed|cannot|only /i.test(String(msg)));
    t.textContent = String(msg).replace(/^BrainStorm rule: /, '');
    t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 4200);
  }
  function renderBody(body, mentions) {
    let html = esc(body);
    (mentions || []).forEach((id) => {
      const p = S.people[id]; if (!p) return;
      [p.full_name, p.full_name.split(' ')[0]].forEach((n) => {
        const re = new RegExp('@' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        html = html.replace(re, (m) => `<span class="mention${id === S.me.id ? ' me' : ''}">${m}</span>`);
      });
    });
    // Web addresses become tappable links (open in a new tab)
    html = html.replace(/(^|[\s(>])((?:https?:\/\/|www\.)[^\s<]+)/gi, (all, pre, url) => {
      let tail = ''; const m = url.match(/[.,!?;:)\]'"]+$/); if (m) { tail = m[0]; url = url.slice(0, -tail.length); }
      const href = /^www\./i.test(url) ? 'https://' + url : url;
      return `${pre}<a class="msglink" href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
    });
    return html.replace(/:sticker:([a-z-]+):/g, (_, code) =>
      `<span class="sticker" title="Swear word swapped for a sticker"><img src="${nw() ? '/icons/icon-nw-64.webp?v=3' : '/icons/icon-64.webp'}" alt="">${esc(S.stickers[code] || 'Bleep!')}</span>`);
  }
  const icon = {
    vote: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>',
    mark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    people: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    chats: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    inbox: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>',
    me: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    clip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>',
    reply: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    pencil: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    leave: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
    eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    megaphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>'
  };

  // ---------- sign in ----------
  // Codes are sent by our own 'signin' function (from brainstorm@ mailboxes) so any of a person's work addresses works.
  async function signinCall(body) {
    try {
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey },
        body: JSON.stringify(body)
      });
      let data = {}; try { data = await res.json(); } catch (_) {}
      return { ok: res.ok, data };
    } catch (_) { return { ok: false, data: { error: 'network' } }; }
  }
  function viewSignIn(step) {
    const codeStep = step === 'code';
    app.innerHTML = `
      <section class="signin">
        <div class="hero"><img class="storm" src="${heroSrc()}" alt="The BrainStorm brain in a lightning storm">
        <img class="wordmark" src="${wmSrc()}" alt="BrainStorm"></div>
        <div class="signin-panel">
        <p class="tagline">Where your team’s ideas strike.</p>
        <form class="form" id="f">
          ${codeStep ? `
            <label class="field">Enter the code we emailed to ${esc(S.emailForCode)}
              <input class="input code" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]{6,8}" required>
            </label>
            <button class="btn" type="submit">Sign in</button>
            <button class="btn ghost" type="button" id="restart">Use a different email</button>`
          : `
            <label class="field">Your work email
              <input class="input" id="email" type="email" autocomplete="email" required placeholder="name@monkeymoos.co.uk">
            </label>
            <button class="btn" type="submit">Email me a 6-digit code</button>
            <button class="btn ghost" type="button" id="havecode">I already have a code</button>
            <p class="note">The team chat for MonkeyMoos and HungryMoose</p>`}
        </form>
        <p class="note">No access yet? Ask your manager to request it in the Mothership or the Hub.</p>
        </div>
      </section>`;
    const f = document.getElementById('f');
    if (codeStep) {
      document.getElementById('restart').onclick = () => viewSignIn('email');
      document.getElementById('code').focus();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
        const r = await signinCall({ action: 'verify', email: S.emailForCode, code: document.getElementById('code').value.trim() });
        if (r.ok && r.data.access_token) {
          const { error } = await sb.auth.setSession({ access_token: r.data.access_token, refresh_token: r.data.refresh_token });
          btn.disabled = false;
          if (error) toast('Could not sign you in: ' + error.message);
          return;
        }
        btn.disabled = false;
        toast(r.data.error === 'no_access' ? 'That email does not have BrainStorm access yet. Ask your manager.'
          : r.data.error === 'bad_code' ? 'That code did not work or has expired. Ask for a new one.'
          : 'Could not sign you in. Please try again.');
      };
    } else {
      document.getElementById('havecode').onclick = () => {
        const email = document.getElementById('email').value.trim().toLowerCase();
        if (!email || !email.includes('@')) { toast('Type your email first, then tap this.'); return; }
        S.emailForCode = email; viewSignIn('code');
      };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim().toLowerCase();
        const btn = f.querySelector('button'); btn.disabled = true;
        const r = await signinCall({ action: 'start', email });
        btn.disabled = false;
        if (!r.ok) {
          const e = r.data.error;
          if (e === 'rate_limited') toast('Too many codes asked for. Wait 15 minutes, then try again.');
          else if (e === 'no_access') toast('That email does not have BrainStorm access yet. Ask your manager.');
          else if (e === 'bad_email') toast('That does not look like an email address.');
          else toast('Could not send your code right now. Please try again in a minute.');
          return;
        }
        S.emailForCode = email; viewSignIn('code');
      };
    }
  }

  // ---------- saved copy on this device (so chats can be read with no signal) ----------
  const cacheKey = () => 'bs-cache-' + ((S.session && S.session.user && S.session.user.id) || 'x');
  function readCache() { try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch (_) { return null; } }
  let cacheTimer = null;
  function saveCache() {
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => {
      try {
        const people = {}; Object.values(S.people || {}).forEach((p) => { people[p.id] = { id: p.id, full_name: p.full_name, display_name: p.display_name, role_code: p.role_code, site_id: p.site_id, business_id: p.business_id, phone: p.phone, avatar_url: p.avatar_url, avatar_ring: p.avatar_ring }; });
        if (S.session && S.session.user) localStorage.setItem('bs-last-user', S.session.user.id);
        localStorage.setItem(cacheKey(), JSON.stringify({ at: Date.now(), me: S.me, roles: S.roles, rules: S.rules, sites: S.sites, businesses: S.businesses, stickers: S.stickers, people, dir: S.dir, channels: S.channels, msgs: S.cacheMsgs || {}, msgAt: S.cacheAt || {}, bots: S.bots || {}, saved: S.savedList || [], todos: S.todos || [] }));
      } catch (_) { /* storage full or blocked: carry on without a saved copy */ }
    }, 400);
  }
  function clearCaches() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('bs-cache-') || k.startsWith('bs-drafts-')).forEach((k) => localStorage.removeItem(k)); } catch (_) {}
    try { if ('caches' in window) caches.keys().then((ks) => ks.filter((k) => k.startsWith('bs-avatars-')).forEach((k) => caches.delete(k))); } catch (_) {}
  }
  function useCache() {
    const c = readCache(); if (!c || !c.me) return false;
    Object.assign(S, { me: c.me, roles: c.roles || {}, rules: c.rules || {}, sites: c.sites || {}, businesses: c.businesses || {}, stickers: c.stickers || {}, people: c.people || {}, dir: c.dir || {}, channels: c.channels || [], cacheMsgs: c.msgs || {}, cacheAt: c.msgAt || {}, bots: c.bots || {}, savedList: c.saved || [], todos: c.todos || [] }); S.saved = new Set(S.savedList.map((x) => x.message_id));
    S.offline = true;
    return true;
  }
  const isOffline = () => S.offline || navigator.onLine === false;
  function drawOffline() {
    // A red lightning bolt in the top bar while there is no connection. Tap it for what it means.
    const off = isOffline();
    document.querySelectorAll('header.top, header.conv').forEach((h) => {
      let b = h.querySelector('.offbolt');
      if (!off) { if (b) b.remove(); return; }
      if (b) return;
      b = document.createElement('button'); b.type = 'button'; b.className = 'offbolt';
      b.setAttribute('aria-label', 'No connection'); b.title = 'No connection';
      b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>';
      b.onclick = () => toast('No connection. You can still read your saved chats. Messages send again once you’re back online.');
      const who = h.querySelector('#who');
      if (who) h.insertBefore(b, who); else h.appendChild(b);
    });
    const bar = document.getElementById('offbar'); if (bar) bar.remove();
  }
  // Tapping a notification: open the chat it was about (the note is left by the service worker)
  function clearPendingOpen() { try { if ('caches' in window) caches.open('bs-nav').then((c) => c.delete('/__open')).catch(() => {}); } catch (_) {} }
  async function pendingOpen() {
    if (!S.me || !('caches' in window)) return false;
    try {
      const c = await caches.open('bs-nav'); const hit = await c.match('/__open'); if (!hit) return false;
      const { id, at } = await hit.json();
      if (!id || Date.now() - at > 3 * 60 * 1000) { c.delete('/__open'); return false; }
      if (!S.channels.find((x) => x.id === id)) { if (isOffline()) return false; await loadChannels(); }
      if (!S.channels.find((x) => x.id === id)) return false; // not in this list (yet): try again next time
      await c.delete('/__open');
      if (!(S.tab === 'chat' && S.current && S.current.id === id)) openChannel(id);
      return true;
    } catch (_) { return false; }
  }
  // Back in the app after a while: catch up straight away (the phone pauses live updates in the background)
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !S.me) return;
    if (await pendingOpen()) return;
    if (isOffline() || S.tab === 'chat') return;
    await loadChannels(); refreshHome(); drawUnread();
  });
  window.addEventListener('focus', () => { if (S.me) pendingOpen(); });
  // Keep long-open windows (e.g. a desktop tab left open all day) fresh: the live connection can drop silently,
  // so re-check the chat list every minute while the window is in view, and pick up new versions of BrainStorm.
  setInterval(() => {
    if (!S.me || document.visibilityState !== 'visible' || isOffline()) return;
    loadChannels().then(() => { if (S.tab !== 'chat' || isWide()) refreshHome(); drawUnread(); }).catch(() => {});
  }, 60 * 1000);
  let updShown = false;
  async function checkForUpdate() {
    if (updShown || isOffline() || document.visibilityState !== 'visible') return;
    try {
      const t = await (await fetch('/config.js?latest', { cache: 'no-store' })).text();
      const v = (t.match(/version:\s*'([^']+)'/) || [])[1];
      if (!v || v === cfg.version) return;
      const typing = document.activeElement && /TEXTAREA|INPUT/.test(document.activeElement.tagName) && document.activeElement.value;
      if (!typing && !document.querySelector('.sheet-back, .ebc') && !(S.tab === 'chat' && !isWide())) { location.reload(); return; }
      updShown = true;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'updbar';
      b.textContent = 'A new version of BrainStorm is ready. Tap to update.';
      b.onclick = () => location.reload();
      document.body.appendChild(b);
    } catch (_) {}
  }
  setInterval(checkForUpdate, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(checkForUpdate, 3000); });
  window.addEventListener('hashchange', () => {
    const h = location.hash.match(/^#c=([0-9a-f-]{36})$/);
    if (h && S.me && S.channels.find((x) => x.id === h[1])) { history.replaceState(null, '', location.pathname); clearPendingOpen(); openChannel(h[1]); }
  });
  // Coming back to the app with a chat open: count it as read now
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || S.tab !== 'chat' || !S.current || isOffline()) return;
    const id = S.current.id;
    sb.rpc('mark_read', { p_channel: id }).then(() => loadChannels()).then(() => { if (isWide()) drawSide(); });
  });
  window.addEventListener('offline', () => { S.offline = true; drawOffline(); });
  let backBusy = false;
  async function backOnline() {
    if (backBusy || navigator.onLine === false) return;
    backBusy = true;
    try {
      S.offline = false; drawOffline();
      if (!S.session || !S.session.access_token) { const { data } = await sb.auth.getSession(); if (data && data.session) S.session = data.session; }
      if (!S.me || S.quick) { if (S.session && S.session.access_token) { S.quick = false; await start(S.session, true); } return; }
      await loadChannels();
      if (S.tab === 'chat' && S.current) openChannel(S.current.id);
      else if ((S.tab === 'chats' || isWide()) && !document.querySelector('.sheet-back')) { const q = document.getElementById('q'); viewHome(q ? q.value : ''); }
      prefetchChats();
    } finally { backBusy = false; }
  }
  window.addEventListener('online', backOnline);
  // A failed call means no signal: switch to the saved copy. The next call that works brings everything back.
  netHooks = {
    fail: () => { if (!S.offline && S.me) { S.offline = true; drawOffline(); } },
    ok: () => { if (S.offline && S.me) setTimeout(backOnline, 0); }
  };

  // While online, quietly save the latest messages of every chat, so any chat can be opened with no signal
  let prefetching = false;
  async function prefetchChats() {
    if (prefetching || isOffline() || !S.channels) return;
    prefetching = true;
    try {
      S.cacheMsgs = S.cacheMsgs || {}; S.cacheAt = S.cacheAt || {};
      for (const c of S.channels.slice()) {
        if (isOffline()) break;
        if (!c.lastAt || (S.cacheAt[c.id] && S.cacheAt[c.id] >= c.lastAt && S.cacheMsgs[c.id])) continue;
        const { data, error } = await sb.from('messages').select('id,author_id,body,created_at,edited_at,removed_at,urgent,mentions,parent_id,via,celebrate,shoutout_to,must_read')
          .eq('channel_id', c.id).order('created_at', { ascending: false }).limit(40);
        if (error || !data) break;
        S.cacheMsgs[c.id] = data.reverse(); S.cacheAt[c.id] = c.lastAt;
      }
      saveCache();
    } finally { prefetching = false; }
  }

  // ---------- unread: app icon number, tab count, window title ----------
  function drawUnread() {
    const total = (S.channels || []).reduce((n, c) => n + (c.unread || 0), 0);
    try { if ('setAppBadge' in navigator) { if (total) navigator.setAppBadge(total); else navigator.clearAppBadge(); } } catch (_) {}
    document.title = total ? `(${total}) BrainStorm` : 'BrainStorm';
    const tab = document.querySelector('nav.tabs [data-tab="chats"]');
    if (tab) { let b = tab.querySelector('.tabcount'); if (total) { if (!b) { b = document.createElement('span'); b.className = 'tabcount'; tab.appendChild(b); } b.textContent = total > 99 ? '99+' : total; } else if (b) b.remove(); }
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ badge: total });
  }

  // ---------- load ----------
  async function loadBasics() {
    const uid = S.session.user.id;
    const [roles, rules, me, sites, biz, stickers, people] = await Promise.all([
      sb.from('roles').select('code,label,rank'),
      sb.from('system_rules').select('key,value'),
      sb.from('members').select('id,auth_user_id,full_name,display_name,business_id,site_id,role_code,is_admin,status,left_on,quiet_from,quiet_to,alerts_off,skip_other_devices,created_at,updated_at,avatar_url,avatar_ring,own_avatar_at,can_approve,theme,job_title,department,last_seen_at,hide_birthday,hide_anniversary,dm_whole_business').eq('auth_user_id', uid).eq('status', 'active').maybeSingle(),
      sb.from('sites').select('id,name,business_id'),
      sb.from('businesses').select('id,name,slug'),
      sb.from('lookup_lists').select('code,label').eq('list', 'sticker'),
      sb.from('members').select('id,full_name,display_name,role_code,site_id,business_id,status,avatar_url,avatar_ring').eq('status', 'active')
    ]);
    if (me.error && useCache()) return true; // no connection: carry on with the saved copy
    if (!me.data) {
      app.innerHTML = `<section class="signin"><div class="hero"><img class="storm" src="${heroSrc()}" alt=""><img class="wordmark" src="${wmSrc()}" alt="BrainStorm"></div>
        <p class="tagline">You are signed in, but your BrainStorm access is not active. Ask your manager.</p>
        <button class="btn ghost" id="out">Sign out</button></section>`;
      document.getElementById('out').onclick = () => sb.auth.signOut();
      return false;
    }
    S.me = me.data;
    if (S.me.theme) applyTheme(S.me.theme);
    (roles.data || []).forEach((r) => { S.roles[r.code] = r; });
    (rules.data || []).forEach((r) => { S.rules[r.key] = r.value && r.value.rank !== undefined ? r.value.rank : r.value; });
    (sites.data || []).forEach((s) => { S.sites[s.id] = s; });
    (biz.data || []).forEach((b) => { S.businesses[b.id] = b; });
    (stickers.data || []).forEach((s) => { S.stickers[s.code] = s.label; });
    const oldPhotos = {}; Object.values(S.people || {}).forEach((p) => { if (p.photo) oldPhotos[p.id] = p.photo; });
    (people.data || []).forEach((p) => { if (oldPhotos[p.id]) p.photo = oldPhotos[p.id]; S.people[p.id] = p; });
    await loadPhones();
    S.photoOk = ((S.roles[S.me.role_code] || {}).rank || 0) >= 40;
    sb.rpc('can_send_photos').then(({ data }) => { if (data === true) S.photoOk = true; });
    signAvatars().then(() => { refreshHome(); if (S.tab === 'chat' && S.current && document.getElementById('msgs')) drawMessages(false); }); // pictures fill in a moment later; nothing waits for them
    S.offline = false;
    return true;
  }

  // Profile pictures live in private storage. The database only signs links for deputies and above,
  // or for your own picture; everyone else shows as initials.
  function refreshHome() {
    if (document.querySelector('.sheet-back') && !isWide()) return; // on a computer the list sits beside any open box, so keep it fresh
    const q = document.getElementById('q');
    if ((S.tab === 'chats' && !S.current) || isWide()) { if (q !== document.activeElement) viewHome(q ? q.value : ''); }
  }
  // Pictures are kept on this device (keyed by each person's picture address, which changes whenever their
  // picture does), so they appear instantly — even on a slow connection or none — and are only downloaded once.
  const AV_STORE = () => 'bs-avatars-' + ((S.session && S.session.user && S.session.user.id) || 'x');
  S.avBlob = S.avBlob || {};
  async function avStore() { try { return 'caches' in window ? await caches.open(AV_STORE()) : null; } catch (_) { return null; } }
  async function savedAvatars() { // fill in pictures from this device straight away, before anything is downloaded
    const store = await avStore(); if (!store) return 0;
    let n = 0;
    await Promise.all(Object.values(S.people || {}).filter((p) => p.avatar_url).map(async (p) => {
      if (S.avBlob[p.avatar_url]) { p.photo = S.avBlob[p.avatar_url]; return; }
      try {
        const hit = await store.match(p.avatar_url); if (!hit) return;
        const url = URL.createObjectURL(await hit.blob());
        S.avBlob[p.avatar_url] = url; p.photo = url; n++;
      } catch (_) {}
    }));
    return n;
  }
  async function keepAvatar(key, signedUrl) { // download once in the background and keep it on this device
    const store = await avStore(); if (!store) return;
    try {
      const res = await fetch(signedUrl); if (!res.ok) return;
      const blob = await res.blob(); if (!blob.size || !/^image\//.test(blob.type)) return;
      await store.put(key, new Response(blob, { headers: { 'Content-Type': blob.type } }));
      if (!S.avBlob[key]) S.avBlob[key] = URL.createObjectURL(blob);
    } catch (_) {}
  }
  async function signAvatars() {
    const pathOf = (u) => { try { return decodeURIComponent(String(u).split('/avatars/')[1].split('?')[0]); } catch (_) { return null; } };
    await savedAvatars();
    const list = Object.values(S.people).filter((p) => p.avatar_url && pathOf(p.avatar_url));
    if (!list.length) return;
    const paths = [...new Set(list.map((p) => pathOf(p.avatar_url)))];
    const { data, error } = await sb.storage.from('avatars').createSignedUrls(paths, 12 * 3600);
    if (error || !data) return; // no signal: keep what we have and try again later
    const signed = {}, denied = new Set();
    data.forEach((r) => { if (r && r.signedUrl && !r.error) signed[r.path] = r.signedUrl; else if (r && r.path && r.error) denied.add(r.path); });
    if (!Object.keys(signed).length) return; // nothing came back at all: a hiccup, so keep every picture we already have
    const store = await avStore();
    list.forEach((p) => {
      const su = signed[pathOf(p.avatar_url)];
      if (!su && !denied.has(pathOf(p.avatar_url))) return; // not answered this time: keep what we have
      if (!su) { // no longer allowed to see this picture: forget the saved copy too
        p.photo = null; if (S.avBlob[p.avatar_url]) delete S.avBlob[p.avatar_url];
        if (store) store.delete(p.avatar_url).catch(() => {});
        return;
      }
      if (S.avBlob[p.avatar_url]) { p.photo = S.avBlob[p.avatar_url]; return; } // already on this device
      p.photo = su; keepAvatar(p.avatar_url, su);
    });
    S.avatarsAt = Date.now();
  }
  // Picture links only last a few hours, and people change their pictures and rings during the day:
  // re-check everyone's picture every hour, when you come back to the app after a while, and whenever one fails to load.
  let peopleBusy = false;
  // Phone numbers: only managers and above see the team's numbers; everyone sees their own (the database decides)
  const seePhones = () => !!(S.me && (S.me.is_admin || ((S.roles[S.me.role_code] || {}).rank || 0) >= 50));
  async function loadPhones() {
    const { data, error } = await sb.rpc('visible_phones');
    if (error || !Array.isArray(data)) return;
    const got = {}; data.forEach((r) => { got[r.id] = r.phone; });
    Object.values(S.people || {}).forEach((p) => { p.phone = got[p.id] || null; });
    if (S.me) S.me.phone = got[S.me.id] || null;
  }
  async function refreshPeople() {
    if (peopleBusy || !S.me || isOffline()) return;
    peopleBusy = true;
    try {
      const { data } = await sb.from('members').select('id,full_name,display_name,role_code,site_id,business_id,status,avatar_url,avatar_ring').eq('status', 'active');
      if (data) data.forEach((p) => {
        const old = S.people[p.id];
        if (old && old.avatar_url === p.avatar_url && old.photo) p.photo = old.photo;
        S.people[p.id] = p;
      });
      await Promise.all([signAvatars(), loadPhones()]);
      saveCache(); refreshHome();
      if (S.tab === 'chat' && S.current && document.getElementById('msgs')) drawMessages(false);
      if (S.tab === 'me' && !document.querySelector('.sheet-back') && document.querySelector('.me-page') && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('.me-page input'))) viewMe(); // your own picture comes back on the Me page too
    } finally { peopleBusy = false; }
  }
  setInterval(() => { if (document.visibilityState === 'visible') refreshPeople(); }, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.me && (!S.avatarsAt || Date.now() - S.avatarsAt > 30 * 60 * 1000)) refreshPeople();
  });
  let brokenAt = 0;
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.closest('.av, .pav')) return;
    const bad = img.getAttribute('src');
    // that link has died (expired, or a saved copy that no longer opens): forget it so a fresh one is fetched
    Object.values(S.people || {}).forEach((p) => { if (p.photo === bad) p.photo = null; });
    Object.keys(S.avBlob || {}).forEach((k) => { if (S.avBlob[k] === bad) delete S.avBlob[k]; });
    const box = img.closest('.av, .pav'); img.remove(); // show the coloured initials circle instead of a broken picture
    if (box && box.dataset.ini && !box.querySelector('img')) box.insertAdjacentText('afterbegin', box.dataset.ini);
    if (Date.now() - brokenAt > 15000) { brokenAt = Date.now(); S.avatarsAt = 0; refreshPeople(); }
  }, true);

  async function loadChannels() {
    // The whole chat list (names, last message, unread counts, who each direct chat is with) in one call,
    // alongside the "other groups" list
    const [listRes] = await Promise.all([sb.rpc('my_chat_list2'), loadOtherRooms()]);
    if (listRes.error || !Array.isArray(listRes.data)) {
      if (!S.channels || !S.channels.length) { const c = readCache(); if (c && c.channels) S.channels = c.channels; }
      if (isOffline() || (S.channels && S.channels.length)) { S.offline = true; drawOffline(); drawUnread(); return; }
      toast('Could not load your chats'); return;
    }
    listRes.data.forEach((x) => { if (x.last_via && x.last_via !== 'Vote' && x.last_via !== 'BrainStorm' && x.last_via !== 'Enquiries' && x.last_author) (S.bots = S.bots || {})[x.last_author] = x.last_via; });
    S.channels = listRes.data.map((x) => ({
      id: x.id, kind: x.kind, description: x.description, site_id: x.site_id, business_id: x.business_id,
      name: x.kind === 'dm' ? nameOf(x.other) : x.name,
      other: x.other || null,
      last: x.last_at ? `${x.last_author === S.me.id ? 'You' : nameOf(x.last_author).split(' ')[0]}: ${x.last_body}` : 'No messages yet',
      lastAt: x.last_at || null,
      unread: x.unread || 0,
      urgent: !!x.urgent,
      mentioned: !!x.mentioned,
      firstUnreadId: x.first_unread_id || null, firstUnreadAt: x.first_unread_at || null,
      observer: !!x.observer, observeUntil: x.observe_until || null
    }));
    // The chat you are looking at right now is read by definition (the server may not have caught up yet)
    if (S.tab === 'chat' && S.current && document.visibilityState === 'visible') {
      const open = S.channels.find((x) => x.id === S.current.id);
      if (open) Object.assign(open, { unread: 0, urgent: false, mentioned: false, firstUnreadId: null, firstUnreadAt: null });
    }
    S.channels.sort((a, b) => (a.unread ? 0 : 1) - (b.unread ? 0 : 1)
      || (a.unread ? (a.firstUnreadAt || '').localeCompare(b.firstUnreadAt || '') : 0)
      || (b.lastAt || '').localeCompare(a.lastAt || ''));
    drawUnread(); saveCache();
  }

  async function countRequests() {
    if (!can('access_approver_min_rank')) { S.pendingRequests = 0; return; }
    const [{ count }, rr] = await Promise.all([
      sb.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb.rpc('room_requests_pending')
    ]);
    S.roomRequests = rr.data || [];
    S.pendingRequests = (count || 0) + S.roomRequests.length;
  }
  // Group rooms I'm not in, so managers and above can ask to join
  async function loadOtherRooms() {
    const { data } = await sb.rpc('other_rooms'); // the database decides who may ask to join which groups
    S.otherRooms = data || [];
  }


  // Launch buttons for the business apps: Mothership (MonkeyMoos) and MooseHub (HungryMoose), shown to staff of each business.
  const APPS = {
    monkeymoos: { url: 'https://mothership.monkeymoos.co.uk/', icon: '/icons/mothership-96.webp', name: 'Mothership' },
    hungrymoose: { url: 'https://hub.hungrymoose.co.uk/', icon: '/icons/moosehub-96.webp', name: 'MooseHub' }
  };
  function appLinks() {
    let orgs = (S.dir[S.me.id] && S.dir[S.me.id].orgs) || [];
    if (!orgs.length) { const b = S.businesses[S.me.business_id]; orgs = b ? [b.slug] : Object.keys(APPS); }
    return ['monkeymoos', 'hungrymoose'].filter((k) => orgs.includes(k) && APPS[k]).map((k) => `<a class="applink" href="${APPS[k].url}" target="_blank" rel="noopener" title="Open ${APPS[k].name}" aria-label="Open ${APPS[k].name} in a new window"><img src="${APPS[k].icon}" alt="" width="44" height="44"></a>`).join('');
  }

  // ---------- unsent drafts: what you were typing stays in each chat's box until you send it ----------
  const DRAFT_KEY = () => 'bs-drafts-' + ((S.session && S.session.user && S.session.user.id) || 'x');
  function readDrafts() { if (!S.drafts) { try { S.drafts = JSON.parse(localStorage.getItem(DRAFT_KEY()) || '{}') || {}; } catch (_) { S.drafts = {}; } } return S.drafts; }
  function draftFor(id) { return readDrafts()[id] || ''; }
  let draftTimer = null;
  function setDraft(id, text) {
    const d = readDrafts(); const had = !!d[id];
    if (text && text.trim()) d[id] = text; else delete d[id];
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY(), JSON.stringify(d)); } catch (_) {} }, 250);
    if (had !== !!d[id] && isWide()) { const r = document.querySelector(`#side [data-open="${id}"] .last`); if (r) r.outerHTML = lastLine(S.channels.find((c) => c.id === id) || {}); }
  }
  function lastLine(c) {
    const d = c.id && draftFor(c.id);
    if (d && !(S.current && S.current.id === c.id && S.tab === 'chat')) return `<div class="last"><span class="drafttag">✎ Draft:</span> ${esc(d.replace(/\s+/g, ' ').slice(0, 80))}</div>`;
    return `<div class="last">${esc(c.last).replace(/:sticker:[a-z-]+:/g, '[sticker]')}</div>`;
  }

  // ---------- home ----------
  // HM / MM tags for a room: its business, or both when it spans the two.
  const bizClass = (c) => { const b = S.businesses[c.business_id]; return b ? ' biz-' + b.slug : ''; };
  function roomChips(c) {
    const b = S.businesses[c.business_id];
    const slugs = b ? [b.slug] : ['hungrymoose', 'monkeymoos'];
    const ORGS = { hungrymoose: ['HM', 'HungryMoose'], monkeymoos: ['MM', 'MonkeyMoos'], braincandy: ['BC', 'Brain Candy'] };
    return slugs.filter((x) => ORGS[x]).map((x) => `<span class="org org-${x}" title="${ORGS[x][1]}">${ORGS[x][0]}</span>`).join('');
  }
  const isTickets = (c) => c.name === 'BrainCandy_Tickets' || c.name === 'BrainStorm_Tickets';
  function rowHtml(c) {
    const av = c.kind === 'announcement' ? `<div class="av ann">${icon.megaphone}</div>`
      : isTickets(c) ? '<div class="av sq neonav">🎫</div>'
      : c.kind === 'channel' ? '<div class="av sq">#</div>'
      : avatar(c.other);
    const neon = isTickets(c) ? ' neon' : '';
    const tags = c.kind === 'dm' ? '' : roomChips(c);
    return `<button class="row${neon}${c.urgent ? ' urgent' : c.unread ? ' unread' : ''}" data-open="${c.id}">${av}
      <div class="mid"><div class="name"><span class="nm"><span class="tx${c.kind === 'dm' ? '' : bizClass(c)}">${esc(c.name)}</span>${tags}${c.observer ? `<span class="obs" title="Viewing only">${icon.eye}</span>` : ''}</span><small>${c.lastAt ? when(c.lastAt) : ''}</small></div>
      ${lastLine(c)}</div>
      ${c.urgent ? '<div class="pill-urgent">URGENT</div>' : ''}${c.unread ? `<div class="badge${c.mentioned ? ' mention' : ''}">${c.mentioned ? '@ ' : ''}${c.unread > 99 ? '99+' : c.unread}</div>` : c.mentioned ? '<div class="badge mention">@</div>' : ''}</button>`;
  }

  function shell(inner) {
    const approver = can('access_approver_min_rank');
    const canNew = can('private_chat_min_rank') || can('room_creator_min_rank') || can('access_approver_min_rank') || S.me.can_approve;
    const nSaved = (S.savedList || []).length + (S.todos || []).length;
    const html = `${inner}
      <nav class="tabs" aria-label="Main">
        <button data-tab="chats" ${S.tab === 'chats' ? 'aria-current="page"' : ''}>${icon.chats}Chats</button>
        <button type="button" id="savedbtn" class="savedhd${nSaved ? ' has' : ''}" aria-label="To Do: saved messages and your reminders">${icon.mark}To Do${nSaved ? `<span class="tabcount sv">${nSaved}</span>` : ''}</button>
        ${canNew ? `<button type="button" id="new" class="newtab" aria-label="New chat, room or starter">${icon.plus}New</button>` : ''}
        ${approver ? `<button data-tab="requests" ${S.tab === 'requests' ? 'aria-current="page"' : ''}>${icon.inbox}Requests${S.pendingRequests ? '<span class="dot"></span>' : ''}</button>` : ''}
        <button data-tab="me" ${S.tab === 'me' ? 'aria-current="page"' : ''}>${icon.me}Me</button>
      </nav>`;
    // an unchanged screen is not rebuilt (only when it is still exactly what this function last drew)
    if (app._shellHtml !== html || !app._shellFirst || app.firstElementChild !== app._shellFirst || !app.querySelector('nav.tabs')) { app.innerHTML = html; app._shellHtml = html; app._shellFirst = app.firstElementChild; }
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; route(); }; });
    const nb = app.querySelector('#new'); if (nb) nb.onclick = sheetNew;
    const svb = app.querySelector('#savedbtn'); if (svb) svb.onclick = sheetSaved;
    drawUnread(); drawOffline();
  }

  // ---------- people: org badges, live status, profile ----------
  const ORG = { hungrymoose: 'HM', monkeymoos: 'MM' };
  const ORG_NAME = { hungrymoose: 'HungryMoose', monkeymoos: 'MonkeyMoos' };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  async function loadDirectory() {
    const [{ data }, nj, ra] = await Promise.all([sb.rpc('people_directory'), sb.rpc('people_not_joined'), sb.rpc('am_i_room_approver')]);
    if (!data && S.dir && Object.keys(S.dir).length) return; // offline: keep what we have
    S.roomApprover = ra.data === true;
    S.dir = {}; (data || []).forEach((d) => { S.dir[d.member_id] = d; });
    S.notJoined = new Set((nj.data || []).map((r) => (typeof r === 'string' ? r : r.people_not_joined)));
  }
  function orgChips(id) {
    const o = (S.dir[id] && S.dir[id].orgs) || [];
    return o.map((s) => `<span class="org org-${s}" title="${ORG_NAME[s]}">${ORG[s]}</span>`).join('');
  }
  // Status: active in the last 10 minutes, otherwise worked out from today's rota.
  function statusOf(id) {
    if (id === S.me.id) return { k: 'active', label: 'Active' };
    const d = S.dir[id] || {}, now = Date.now();
    const seen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0;
    if (now - seen < 10 * 60000) return { k: 'active', label: 'Active' };
    const rota = d.rota || [];
    const leave = rota.find((r) => r.kind === 'leave');
    if (leave) {
      const until = leave.leave_until ? ' until ' + new Date(leave.leave_until).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      return { k: 'holiday', label: (leave.leave_type || 'Holiday') + until };
    }
    const shifts = rota.filter((r) => r.kind === 'shift' && r.starts_at && r.ends_at);
    if (shifts.length) {
      const t = (x) => new Date(x).getTime();
      if (shifts.some((s) => t(s.starts_at) <= now && now <= t(s.ends_at))) return { k: 'away', label: 'Away from desk' };
      const next = shifts.find((s) => t(s.starts_at) > now);
      if (next) return { k: 'later', label: 'In from ' + hhmm(next.starts_at) };
      return { k: 'ooo', label: 'Out of office' };
    }
    if (rota.some((r) => r.kind === 'off')) return { k: 'off', label: 'Not working today' };
    if (seen && new Date(seen).toDateString() === new Date().toDateString()) return { k: 'away', label: 'Away' };
    return { k: 'off', label: 'Offline' };
  }
  const posOf = (id) => { const p = S.people[id] || {}, d = S.dir[id] || {}; return d.job_title || (S.roles[p.role_code] ? S.roles[p.role_code].label : ''); };
  function personAv(id) { const st = statusOf(id); return `<span class="avwrap">${avatar(id)}<i class="st st-${st.k}" title="${esc(st.label)}"></i></span>`; }
  const notJoined = (id) => !!(S.notJoined && S.notJoined.has(id));
  function personHomeRow(p, dm) {
    const st = statusOf(p.id), pos = posOf(p.id);
    return `<button class="row person${dm && dm.unread ? ' unread' : ''}" data-person="${p.id}">${personAv(p.id)}
      <div class="mid"><div class="name"><span class="nm"><span class="tx${notJoined(p.id) ? ' nj' : ''}">${esc(p.display_name || p.full_name)}</span>${orgChips(p.id)}</span></div>
      <div class="last">${notJoined(p.id) ? '<span class="njt">Not joined yet</span> · ' : ''}<span class="stx stx-${st.k}">${esc(st.label)}</span>${pos ? ' · ' + esc(pos) : ''}</div></div>
      ${dm && dm.mentioned ? '<div class="badge mention">@</div>' : dm && dm.unread ? `<div class="badge">${dm.unread > 99 ? '99+' : dm.unread}</div>` : ''}</button>`;
  }
  // Today's shift in plain words: "08:00–17:30 at Huntley Wharf", "Off today", "Not working today"
  function shiftToday(id) {
    const d = S.dir[id] || {}, rota = d.rota || [], st = statusOf(id);
    const shifts = rota.filter((r) => r.kind === 'shift' && r.starts_at);
    if (rota.find((r) => r.kind === 'leave')) return st.label; // never says why someone is off
    if (shifts.length) return shifts.map((x) => `${hhmm(x.starts_at)}–${x.ends_at ? hhmm(x.ends_at) : '?'}${x.location ? ' at ' + x.location : ''}`).join(', ');
    return rota.length ? 'Not working today' : '';
  }
  // Profile block (photo, HM/MM tags, status and details) used by profile cards and the Me page.
  function profileBlock(id) {
    const p = S.people[id] || S.me;
    const d = S.dir[id] || {}, st = statusOf(id);
    const site = S.sites[p.site_id] ? S.sites[p.site_id].name : '';
    const rota = d.rota || [];
    const shifts = rota.filter((r) => r.kind === 'shift' && r.starts_at);
    const leave = rota.find((r) => r.kind === 'leave');
    const today = shiftToday(id);
    const loc = (shifts.find((s) => s.location) || {}).location || site;
    const company = (d.orgs || []).map((s) => ORG_NAME[s]).join(' & ') || (S.businesses[p.business_id] ? S.businesses[p.business_id].name : '');
    const rowsHtml = [
      ['Position', posOf(id)], ['Department', d.department], ['Company', company], ['Location', loc],
      ['Shift today', today], ['Last active', id === S.me.id ? 'Now' : d.last_seen_at ? when(d.last_seen_at) : '']
    ].filter((r) => r[1]).map((r) => `<div class="kv"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')
      + (p.phone && seePhones() ? `<div class="kv"><span>Phone</span><b><a class="tel" href="tel:${esc(p.phone.replace(/[^0-9+]/g, ''))}">${esc(p.phone)}</a></b></div>` : '');
    const big = p.photo ? `<img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">` : esc(initials(p.display_name || p.full_name));
    const photoNote = p.avatar_url && !p.photo && id !== S.me.id ? `<p class="note hidden-why">Photos are only shown to deputy managers and above, to keep children&#39;s and staff information safe.</p>` : '';
    return `<div class="profile">
        ${ringWrap(p.avatar_ring, `<div class="pav" data-ini="${esc(initials(p.display_name || p.full_name))}" style="background:${colorFor(id)}">${big}<i class="st st-${st.k}"></i></div>`)}
        <h2>${esc(p.full_name)}</h2>
        <div class="orgs">${orgChips(id)}</div>
        <div class="stpill st-bg-${st.k}">${esc(st.label)}</div>
        ${photoNote}
      </div>
      <div class="kvs">${rowsHtml || '<p class="note">More details appear once the rota is linked.</p>'}</div>`;
  }



  // Phone "Save" buttons only light up when the number has actually been changed.
  function watchSave(form, input, saved) {
    const btn = form.querySelector('button[type=submit]');
    const sync = () => { const dirty = input.value.trim() !== (saved() || ''); btn.disabled = !dirty; btn.classList.toggle('ghost', !dirty); };
    input.addEventListener('input', sync); sync();
    return sync;
  }

  // Quick view from a chat: status, location, phone, and one-tap message / call.
  function quickView(id) {
    const p = S.people[id]; if (!p) return;
    const d = S.dir[id] || {}, st = statusOf(id);
    const shifts = (d.rota || []).filter((r) => r.kind === 'shift');
    const loc = (shifts.find((x) => x.location) || {}).location || (S.sites[p.site_id] ? S.sites[p.site_id].name : '');
    const dm = S.channels.find((c) => c.kind === 'dm' && c.other === id);
    const canMsg = id !== S.me.id && (dm || canStartDm(id));
    const tel = p.phone ? p.phone.replace(/[^0-9+]/g, '') : '';
    const s = sheet(`<div class="qv">${personAv(id)}
        <div class="qvt"><div class="qvn">${esc(p.display_name || p.full_name)}${orgChips(id)}</div>
        <div class="meta"><span class="stx stx-${st.k}">${esc(st.label)}</span>${posOf(id) ? ' · ' + esc(posOf(id)) : ''}</div></div></div>
      <div class="kvs"><div class="kv"><span>Shift today</span><b>${shiftToday(id) ? esc(shiftToday(id)) : '<span style="color:var(--dim);font-weight:400">No rota linked</span>'}</b></div>
        ${loc ? `<div class="kv"><span>Location</span><b>${esc(loc)}</b></div>` : ''}
        ${seePhones() ? `<div class="kv"><span>Phone</span><b>${p.phone ? `<a class="tel" href="tel:${esc(tel)}">${esc(p.phone)}</a>` : '<span style="color:var(--dim);font-weight:400">Not added yet</span>'}</b></div>` : ''}</div>
      <div class="actions qva">
        ${canMsg && id !== S.me.id ? '<button class="btn" id="qm">Message</button>' : ''}
        ${tel ? `<a class="btn ghost" href="tel:${esc(tel)}">Call</a>` : ''}
        <button class="btn ghost" id="qp">Full profile</button></div>`);
    const qm = s.querySelector('#qm');
    if (qm) qm.onclick = async () => {
      if (dm) { s.remove(); return openChannel(dm.id); }
      const { data, error } = await sb.rpc('start_direct_message', { p_other: id });
      if (error) return toast(error.message);
      s.remove(); await loadChannels(); openChannel(data);
    };
    s.querySelector('#qp').onclick = () => { s.remove(); sheetPerson(id); };
  }

  // Group rooms a manager can move people in and out of (rooms they are in themselves).
  function groupRooms(exceptId) {
    return S.channels.filter((c) => c.kind === 'channel' && c.id !== exceptId).sort((a, b) => a.name.localeCompare(b.name));
  }
  function roomLabel(c) { return `<span class="nm"><span class="tx${bizClass(c)}">${esc(c.name)}</span>${roomChips(c)}</span>`; }
  async function drawPersonRooms(id, box) {
    const rooms = groupRooms();
    const [{ data }, el] = await Promise.all([
      sb.from('channel_members').select('channel_id').eq('member_id', id).is('removed_at', null).in('channel_id', rooms.map((c) => c.id)),
      sb.rpc('person_room_eligibility', { p_member: id })
    ]);
    const inIds = new Set((data || []).map((r) => r.channel_id));
    const why = {}; (el.data || []).forEach((r) => { why[r.channel_id] = r.reason; });
    box.innerHTML = rooms.map((c) => {
      const w = why[c.id], off = w && !inIds.has(c.id);
      return `<label class="pick${w ? ' blocked' : ''}"${w ? ` title="${esc(w)}"` : ''}><input type="checkbox" data-room="${c.id}"${inIds.has(c.id) ? ' checked' : ''}${off ? ' disabled' : ''}><div>${roomLabel(c)}${w ? `<div class="meta why">${esc(w)}</div>` : ''}</div></label>`;
    }).join('');
    box.querySelectorAll('[data-room]').forEach((cb) => {
      cb.onchange = async () => {
        cb.disabled = true;
        const on = cb.checked;
        const { error } = await sb.rpc(on ? 'add_to_room' : 'remove_from_room', { p_channel: cb.dataset.room, p_member: id });
        cb.disabled = false;
        if (error) { cb.checked = !on; return toast(error.message.replace(/^BrainStorm rule: /, '')); }
        const c = S.channels.find((x) => x.id === cb.dataset.room);
        toast(`${nameOf(id).split(' ')[0]} ${on ? 'added to' : 'taken out of'} ${c ? c.name : 'the room'}`);
      };
    });
  }
  async function sheetMove(c, id, done) {
    const rooms = groupRooms(c.id);
    const { data: el } = await sb.rpc('person_room_eligibility', { p_member: id });
    const why = {}; (el || []).forEach((r) => { why[r.channel_id] = r.reason; });
    const s = sheet(`<h2>Move ${esc(nameOf(id))}</h2><p class="note">Out of <b>${esc(c.name)}</b> and into:</p>
      ${rooms.map((r) => `<button class="pick${why[r.id] ? ' blocked' : ''}" data-to="${r.id}" style="width:100%;text-align:left"${why[r.id] ? ' disabled' : ''}><div>${roomLabel(r)}${why[r.id] ? `<div class="meta why">${esc(why[r.id])}</div>` : ''}</div></button>`).join('') || '<p class="note">You are not in any other rooms.</p>'}
      <div class="actions"><button class="btn ghost" id="x">Cancel</button></div>`);
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelectorAll('[data-to]').forEach((b) => {
      b.onclick = async () => {
        const { error } = await sb.rpc('move_between_rooms', { p_from: c.id, p_to: b.dataset.to, p_member: id });
        if (error) return toast(error.message.replace(/^BrainStorm rule: /, ''));
        const to = S.channels.find((x) => x.id === b.dataset.to);
        toast(`${nameOf(id).split(' ')[0]} moved to ${to ? to.name : 'the new room'}`);
        s.remove(); done();
      };
    });
  }

  async function sheetPerson(id) {
    const p = S.people[id]; if (!p) return;
    const dm = S.channels.find((c) => c.kind === 'dm' && c.other === id);
    const canMsg = id !== S.me.id && (dm || canStartDm(id));
    const canInvite = id !== S.me.id && (S.me.can_approve || can('access_approver_min_rank'));
    const canRooms = id !== S.me.id && can('room_creator_min_rank') && groupRooms().length > 0;
    const s = sheet(`${profileBlock(id)}
      ${canInvite ? `<form id="aph" class="phrow"><input class="input" id="aphv" type="tel" inputmode="tel" maxlength="20" placeholder="Phone number" value="${esc(p.phone || '')}"><button class="btn small ghost" type="submit" disabled>Save phone</button></form>` : ''}
      ${canInvite ? '<details id="sie" class="fold"><summary class="section s-room"><svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>Sign-in emails <small style="letter-spacing:0;text-transform:none;font-weight:400;color:var(--dim)">· only approvers see this</small></summary><div class="kvs" id="sielist"><p class="note">Loading…</p></div></details>' : ''}
      ${canRooms ? '<details id="rms" class="fold"><summary class="section s-room"><svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>Rooms <small style="letter-spacing:0;text-transform:none;font-weight:400;color:var(--dim)">· tick the rooms they should be in</small></summary><div id="rmslist"><p class="note">Loading…</p></div></details>' : ''}
      <div class="actions">${canMsg ? '<button class="btn" id="msg">Message</button>' : ''}<button class="btn ghost" id="x">Close</button></div>`);
    if (canRooms) {
      const fold = s.querySelector('#rms'); let drawn = false;
      fold.addEventListener('toggle', () => { if (fold.open && !drawn) { drawn = true; drawPersonRooms(id, s.querySelector('#rmslist')); } });
    }
    if (canInvite) {
      const aphSync = watchSave(s.querySelector('#aph'), s.querySelector('#aphv'), () => p.phone);
      s.querySelector('#aph').onsubmit = async (e) => {
        e.preventDefault();
        const v = s.querySelector('#aphv').value.trim();
        const { error } = await sb.rpc('set_phone', { p_member: id, p_phone: v });
        if (error) return toast(error.message);
        p.phone = v || null; aphSync(); toast(v ? 'Phone number saved' : 'Phone number removed');
      };
      const box = s.querySelector('#sielist');
      const draw = async () => {
        const { data: list } = await sb.rpc('sign_in_emails', { p_member: id });
        box.innerHTML = (list || []).map((e) => `<div class="kv" style="align-items:center"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--frost)">${esc(e.email)}<br><small style="color:var(--dim)">${e.main ? 'Main' : e.kind === 'personal' ? 'Personal' : 'Work'}</small></span>
            <button class="btn ghost small" data-inv="${esc(e.email)}">Invite</button></div>`).join('')
          + `<form id="addem" style="display:flex;gap:6px;padding:10px 0;flex-wrap:wrap"><input class="input" id="ne" type="email" placeholder="Add another email" style="flex:1 1 180px" required>
              <select class="input" id="nk" style="flex:0 0 auto;width:auto"><option value="personal">Personal</option><option value="work">Work</option></select>
              <button class="btn small" type="submit">Add</button></form>`;
        box.querySelectorAll('[data-inv]').forEach((b) => {
          b.onclick = async () => {
            b.disabled = true; b.textContent = 'Sending…';
            const { error } = await sb.rpc('queue_invite', { p_member: id, p_email: b.dataset.inv });
            if (error) { b.disabled = false; b.textContent = 'Invite'; return toast(error.message); }
            const r = await signinCall({ action: 'drain' });
            const ok = r.ok && r.data.sent > 0;
            b.textContent = ok ? 'Sent ✓' : 'Queued'; toast(ok ? `Invite sent to ${b.dataset.inv}` : 'Invite saved — it will send as soon as email sending is working.');
          };
        });
        box.querySelector('#addem').onsubmit = async (e) => {
          e.preventDefault();
          let em = box.querySelector('#ne').value.trim().toLowerCase();
          const kind = box.querySelector('#nk').value;
          if (kind === 'work') { em = await confirmEmail(p.full_name, em); if (!em) return; }
          else { const t = emailTypo('', em); if (t && t.suggest) { em = await confirmEmail('', em); if (!em) return; } }
          const { error } = await sb.rpc('add_sign_in_email', { p_member: id, p_email: em, p_kind: kind });
          if (error) return toast(error.message);
          toast('Added. They can now sign in with ' + em); draw();
        };
      };
      const fold = s.querySelector('#sie'); let drawn = false;
      fold.addEventListener('toggle', () => { if (fold.open && !drawn) { drawn = true; draw(); } });
    }
    s.querySelector('#x').onclick = () => s.remove();
    const mb = s.querySelector('#msg');
    if (mb) mb.onclick = async () => {
      if (dm) { s.remove(); return openChannel(dm.id); }
      const { data, error } = await sb.rpc('start_direct_message', { p_other: id });
      if (error) return toast(error.message);
      s.remove(); await loadChannels(); openChannel(data);
    };
  }

  function collapsed() { try { return JSON.parse(localStorage.getItem('bs-collapsed') || '{}'); } catch (_) { return {}; } }
  function section(key, title, cls, count, body, searching, fresh) {
    const shut = !searching && collapsed()[key];
    return `<section class="grp${shut ? ' shut' : ''}" data-grp="${key}">
      <button class="section ${cls} toggle" type="button" data-toggle="${key}" aria-expanded="${!shut}">
        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        <span>${title}</span>${fresh ? `<span class="cnt new">${fresh} new</span>` : `<span class="cnt">${count}</span>`}</button>
      <div class="grp-body">${body}</div></section>`;
  }

  function viewHome(filter = '') {
    // never rebuild the list under a finger or mouse that is pressing it: the press would be lost (first tap "does nothing")
    if (S.ptrDown) { S.homeLater = { v: filter }; return; }
    document.body.classList.toggle('wide', isWide());
    if (!isWide()) { side.innerHTML = ''; return viewHomeInner(filter); }
    app = side;
    try { viewHomeInner(filter); } finally { app = mainEl; }
    if (S.current) side.querySelectorAll('[data-open]').forEach((b) => b.classList.toggle('current', b.dataset.open === S.current.id));
    if (S.tab === 'chats' && !S.current) drawPickChat();
  }
  function drawPickChat() {
    mainEl.innerHTML = `${rainGlass()}<section class="pickchat"><img src="${logoSrc()}" alt="" width="96" height="96"><h2>Pick a chat</h2><p>Choose a group or a person on the left. Your chat opens here with plenty of room.</p></section>`;
  }
  function drawSide() { const q = side.querySelector('#q'); viewHome(q ? q.value : ''); }
  let wasWide = null;
  window.addEventListener('resize', () => {
    const w = isWide(); if (w === wasWide || !S.me) return; wasWide = w;
    document.body.classList.toggle('wide', w);
    if (S.tab === 'chat' && S.current) { viewConversation(); if (w) drawSide(); else side.innerHTML = ''; }
    else route();
  });
  // ---------- business switcher: HungryMoose / MonkeyMoos / Regional, each with its own unread count ----------
  const SPACE_LABEL = { hungrymoose: 'HungryMoose', monkeymoos: 'MonkeyMoos', braincandy: 'Brain Candy', regional: 'Regional' };
  const bizSlug = (bid) => { const b = S.businesses[bid]; if (!b) return null; return b.slug || (/hungry/i.test(b.name) ? 'hungrymoose' : /monkey/i.test(b.name) ? 'monkeymoos' : /brain/i.test(b.name) ? 'braincandy' : null); };
  function personSpaces(id) {
    const p = S.people[id] || {}; const out = new Set();
    const own = bizSlug(p.business_id); if (own) out.add(own);
    ((S.dir[id] && S.dir[id].orgs) || []).forEach((o) => out.add(o));
    if (((S.roles[p.role_code] || {}).rank || 0) >= 60) out.add('regional');
    return out;
  }
  function chatSpaces(c) {
    if (c.kind === 'dm') return c.other ? personSpaces(c.other) : new Set();
    const slug = bizSlug(c.business_id);
    return new Set([slug && SPACE_LABEL[slug] ? slug : 'regional']);
  }
  function spacesAvailable() {
    const have = new Set(); (S.channels || []).filter((c) => c.kind !== 'dm').forEach((c) => chatSpaces(c).forEach((x) => have.add(x)));
    return ['hungrymoose', 'monkeymoos', 'braincandy', 'regional'].filter((x) => have.has(x));
  }
  function currentSpace() { // the colour filter next to Groups: null = show every business
    const av = spacesAvailable(); if (av.length < 2) return null;
    let sp = S.space; if (sp === undefined) { try { sp = localStorage.getItem('bs-space') || null; } catch (_) { sp = null; } }
    if (sp && !av.includes(sp)) sp = null;
    return (S.space = sp);
  }
  function spaceUnread(sp) { return (S.channels || []).filter((c) => c.kind !== 'dm' && chatSpaces(c).has(sp)).reduce((n, c) => n + (c.unread || 0), 0); }
  function spaceChips(sp) {
    const av = spacesAvailable(); if (av.length < 2) return '';
    const SHORT = { hungrymoose: 'HM', monkeymoos: 'MM', braincandy: 'BC', regional: 'R' };
    const cnt = (n) => (n ? `<span class="spn">${n > 99 ? '99+' : n}</span>` : '');
    const all = (S.channels || []).filter((c) => c.kind !== 'dm').reduce((n, c) => n + (c.unread || 0), 0);
    return `<div class="spchips" role="group" aria-label="Show groups for">`
      + `<button type="button" class="spchip sp-all" data-space="" aria-pressed="${!sp}" title="Show every group">ALL${cnt(all)}</button>`
      + av.map((x) => `<button type="button" class="spchip sp-${x}" data-space="${x}" aria-pressed="${x === sp}" title="Only show ${SPACE_LABEL[x]} groups">${SHORT[x]}${cnt(spaceUnread(x))}</button>`).join('')
      + '</div>';
  }

  function viewHomeInner(filter = '') {
    const f = filter.toLowerCase();
    const sp = currentSpace();
    const inSpace = (c) => c.kind === 'dm' || !sp || !!f || chatSpaces(c).has(sp); // searching looks across every business
    const list = S.channels.filter(inSpace).filter((c) => !f || c.name.toLowerCase().includes(f) || c.last.toLowerCase().includes(f));
    const urgent = list.filter((c) => c.urgent);
    // UNREAD: every group, announcement and private chat with something new, from every business (ignores the HM/MM/R filter).
    // While a chat is in here it is not repeated below; once read it goes back to its usual place.
    const isNew = (c) => !c.urgent && (c.unread || c.mentioned);
    const unread = f ? [] : S.channels.filter(isNew).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
    const inUnread = new Set(unread.map((c) => c.id));
    const groups = list.filter((c) => c.kind === 'channel' && !c.urgent && !inUnread.has(c.id));
    const others = (S.otherRooms || []).filter((c) => !sp || f || chatSpaces({ kind: 'channel', business_id: c.business_id }).has(sp)).filter((c) => !f || c.name.toLowerCase().includes(f));
    const ann = list.filter((c) => c.kind === 'announcement' && !c.urgent && !inUnread.has(c.id));
    const dmBy = {}; S.channels.filter((c) => c.kind === 'dm').forEach((c) => { dmBy[c.other] = c; });

    const order = { active: 0, away: 1, later: 2, ooo: 3, holiday: 4, off: 5 };
    const people = Object.values(S.people).filter((p) => p.id !== S.me.id)
      .filter((p) => !f || (p.display_name || p.full_name).toLowerCase().includes(f) || posOf(p.id).toLowerCase().includes(f)
        || (dmBy[p.id] && dmBy[p.id].last.toLowerCase().includes(f)))
      .sort((a, b) => ((dmBy[b.id] || {}).unread ? 1 : 0) - ((dmBy[a.id] || {}).unread ? 1 : 0)
        || order[statusOf(a.id).k] - order[statusOf(b.id).k]
        || (a.display_name || a.full_name).localeCompare(b.display_name || b.full_name));
    const none = !unread.length && !urgent.length && !groups.length && !ann.length && !people.length;
    shell(`
      <header class="top"><img class="logo" src="${logoSrc()}" alt="" width="60" height="60" decoding="sync"><img class="wm" src="${wmSrc(true)}" alt="BrainStorm"><div class="grow"></div>
        ${appLinks()}
</header>
      <label class="search">${icon.search}<input id="q" placeholder="Search messages and people" aria-label="Search messages and people" value="${esc(filter)}"></label>

      <main class="list">
        <div id="mrbanner">${mustReadBanner()}</div>
        ${urgent.length ? section('urgent', 'Urgent announcements', 's-urg', urgent.length, urgent.map(rowHtml).join(''), !!f) : ''}
        ${unread.length ? section('unread', 'Unread', 's-unread', unread.length, unread.map(rowHtml).join(''), false, unread.reduce((n, c) => n + (c.unread || 0), 0)) : ''}
        ${groups.length || others.length || sp ? section('groups', 'Groups', 's-room', groups.length, (f ? '' : spaceChips(sp)) + (groups.length ? groups.map(rowHtml).join('') : `<div class="empty small">No ${SPACE_LABEL[sp] || ''} groups.</div>`) + othersHtml(others), !!f, groups.reduce((n, c) => n + (c.unread || 0), 0)) : ''}
        ${ann.length ? section('ann', 'Announcements', 's-ann', ann.length, ann.map(rowHtml).join(''), !!f, ann.reduce((n, c) => n + (c.unread || 0), 0)) : ''}
        ${people.length ? section('people', 'People', 's-dm', people.length, people.map((p) => personHomeRow(p, dmBy[p.id])).join(''), !!f, people.reduce((n, p) => n + ((dmBy[p.id] || {}).unread || 0), 0)) : ''}
        ${none ? `<div class="empty">${f ? 'Nothing matches that search.' : 'No chats yet. Your manager will add you to your site room.'}</div>` : ''}
      </main>`);
    app.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openChannel(b.dataset.open); });
    wireMustReadBanner();
    app.querySelectorAll('[data-person]').forEach((b) => { b.onclick = () => sheetPerson(b.dataset.person); });
    app.querySelectorAll('[data-space]').forEach((b) => { b.onclick = () => {
      S.space = !b.dataset.space || S.space === b.dataset.space ? null : b.dataset.space; // ALL, or tap again, shows everything
      try { localStorage.setItem('bs-space', S.space || ''); } catch (_) {}
      viewHome('');
    }; });
    app.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.toggle, c = collapsed(); c[k] = !c[k];
        try { localStorage.setItem('bs-collapsed', JSON.stringify(c)); } catch (_) {}
        const g = b.closest('.grp'); g.classList.toggle('shut', !!c[k]); b.setAttribute('aria-expanded', String(!c[k]));
      };
    });
    const q = document.getElementById('q');
    q.oninput = () => { const pos = q.selectionStart; viewHome(q.value); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
    const of = document.getElementById('others');
    if (of) of.addEventListener('toggle', () => { const c = collapsed(); c.others = !of.open; try { localStorage.setItem('bs-collapsed', JSON.stringify(c)); } catch (_) {} });
    app.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = () => askToJoin(b.dataset.ask); });
  }

  function othersHtml(others) {
    if (!others.length || S.roomApprover) return '';
    const open = collapsed().others === false;
    return `<details class="others" id="others"${open ? ' open' : ''}><summary><svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>Other groups <span class="cnt">${others.length}</span><small>you're not in</small></summary>
      ${others.map((c) => `<div class="row other"><div class="av sq">#</div>
        <div class="mid"><div class="name"><span class="nm"><span class="tx${bizClass(c)}">${esc(c.name)}</span>${roomChips(c)}</span></div>
        <div class="last">${c.members} ${c.members === 1 ? 'person' : 'people'}</div></div>
        ${c.requested ? '<span class="asked">Requested</span>' : `<button class="btn ghost small" data-ask="${c.id}">Ask to join</button>`}</div>`).join('')}</details>`;
  }
  function askToJoin(id) {
    const c = (S.otherRooms || []).find((x) => x.id === id); if (!c) return;
    const s = sheet(`<h2>Ask to join ${esc(c.name)}</h2><p class="note">Lee will see your request and decide. You'll appear in the group once it's approved.</p>
      <form id="ask"><textarea class="input" id="why" rows="3" maxlength="300" placeholder="Why do you need to be in this group? (optional)"></textarea>
      <div class="actions"><button class="btn ghost" type="button" id="x">Cancel</button><button class="btn" type="submit">Send request</button></div></form>`);
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelector('#ask').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc('request_room', { p_channel: id, p_note: s.querySelector('#why').value });
      if (error) return toast(error.message.replace(/^BrainStorm rule: /, ''));
      c.requested = true; s.remove(); toast('Request sent to Lee'); route();
    };
  }

  // Presence heartbeat + refresh statuses every minute
  function startPresence() {
    const beat = async () => {
      if (document.visibilityState !== 'visible' || !S.me) return;
      await sb.rpc('touch_presence'); touchDevice();
      await loadDirectory();
      const q = document.getElementById('q');
      if (q && (!S.current || isWide()) && !document.querySelector('.sheet-back') && q !== document.activeElement) viewHome(q.value);
    };
    clearInterval(startPresence._t); startPresence._t = setInterval(beat, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
    sb.rpc('touch_presence').then(() => {}); // (calls only go out once something waits for them)
    touchDevice();
  }
  // "Only alert the device I'm using": this device tells the server it is open and on screen
  async function touchDevice() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || document.visibilityState !== 'visible') return;
    const sub = await mySub(); if (sub && sub.endpoint) sb.rpc('touch_device', { p_endpoint: sub.endpoint }).then(() => {});
  }

  // ---------- conversation ----------
  async function openChannel(id) {
    // the same chat is already on screen (back online, or a background refresh): refresh it in place
    const inPlace = S.tab === 'chat' && S.current && S.current.id === id && !!document.getElementById('msgs') && (S.messages || []).length > 0 && !S.loadingChat;
    S.current = S.channels.find((c) => c.id === id);
    if (!S.current) return;
    S.tab = 'chat';
    if (inPlace && !isOffline()) return refreshOpenChat(id);
    S.unreadFrom = S.current.unread ? S.current.firstUnreadId : null;
    S.jumpUnread = !!S.unreadFrom;
    S.cacheMsgs = S.cacheMsgs || {};
    if (isOffline()) { // no signal: open straight from the saved copy, nothing to wait for
      if (S.roomSub) { sb.removeChannel(S.roomSub); S.roomSub = null; }
      S.messages = (S.cacheMsgs[id] || []).slice(); S.replyTo = null; S.quoted = {}; S.files = {}; S.reacts = {}; S.typing = {};
      S.unreadFrom = null; S.jumpUnread = false;
      viewConversation(); if (isWide()) drawSide();
      if (!S.messages.length) toast('This chat is not saved on this device yet. It will load when you have signal.');
      return;
    }
    // Show the saved copy straight away (if there is one), then swap in the fresh messages from one server call
    const token = (S.openToken = (S.openToken || 0) + 1);
    const cached = S.cacheMsgs[id];
    let drawn = false;
    // switch to the new chat straight away: the saved copy if there is one, otherwise "Loading…"
    S.messages = cached && cached.length ? cached.slice() : []; S.loadingChat = !S.messages.length;
    S.replyTo = null; S.quoted = {}; S.files = {}; S.reacts = {};
    S.roomPeople = (S.roomPeopleBy || {})[id] || [];
    viewConversation(); drawn = true; if (isWide()) drawSide();
    const { data, error } = await sb.rpc('open_chat', { p_channel: id, p_limit: Math.min(500, Math.max(80, (S.current.unread || 0) + 15)) });
    if (token !== S.openToken || !S.current || S.current.id !== id) return; // they have moved on to another chat
    if (error || !data) { // lost signal while loading: carry on with whatever is saved on this device
      S.loadingChat = false; S.offline = true; drawOffline();
      if (!S.messages.length) { drawMessages(false); toast('This chat is not saved on this device yet. It will load when you have signal.'); }
      return;
    }
    S.messages = data.messages || []; S.loadingChat = false;
    S.cacheMsgs[id] = S.messages.slice(-60); S.cacheAt = S.cacheAt || {}; S.cacheAt[id] = S.current.lastAt; saveCache();
    S.roomPeople = data.members || []; (S.roomPeopleBy = S.roomPeopleBy || {})[id] = S.roomPeople;
    S.quoted = {}; (data.quoted || []).forEach((q) => { S.quoted[q.id] = q; });
    S.reacts = {}; S.messages.forEach((m) => { S.reacts[m.id] = []; });
    (data.reactions || []).forEach((r) => { (S.reacts[r.message_id] = S.reacts[r.message_id] || []).push(r); });
    S.files = {}; await Promise.all([attachFiles(data.files || [], S.messages.map((m) => m.id)), loadPolls(S.messages), loadMustRead(S.messages)]);
    if (token !== S.openToken || !S.current || S.current.id !== id) return;
    if (drawn && document.getElementById('msgs')) { S.jumpUnread = !!S.unreadFrom; drawMessages(true); }
    else { S.replyTo = null; viewConversation(); }
    sb.rpc('mark_read', { p_channel: id }).then(() => {});
    Object.assign(S.current, { unread: 0, urgent: false, mentioned: false }); drawUnread();
    if (isWide()) drawSide();
    if (S.roomSub) sb.removeChannel(S.roomSub);
    subscribeRoom(id);
  }
  function subscribeRoom(id) {
    S.typing = {};
    S.roomSub = sb.channel('room-' + id, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'files' }, async ({ payload }) => {
        if (!S.current || S.current.id !== id || !payload) return;
        await loadFiles([payload.mid]); drawMessages(S.stick === 'bottom' || isNearBottom());
      })
      .on('broadcast', { event: 'poll' }, async ({ payload }) => {
        if (!S.current || S.current.id !== id || !payload) return;
        await loadPolls([{ id: Number(payload.mid), body: '📊 VOTE: ' }]); drawMessages(false);
      })
      .on('broadcast', { event: 'removed' }, ({ payload }) => {
        if (!S.current || S.current.id !== id || !payload) return;
        dropMessage(Number(payload.mid));
      })
      .on('broadcast', { event: 'react' }, async ({ payload }) => {
        if (!S.current || S.current.id !== id || !payload) return;
        await loadReactions([payload.mid]); drawMessages(false);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!S.current || S.current.id !== id || !payload || payload.m === S.me.id) return;
        S.typing[payload.m] = Date.now(); drawTyping(); setTimeout(drawTyping, 4300);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + id }, (p) => {
        if (!S.current || S.current.id !== id) return;
        const m = p.new;
        if (m && S.typing) { delete S.typing[m.author_id]; drawTyping(); }
        if (m && m.removed_at && !amAdmin()) { dropMessage(m.id); return; }
        // only follow new messages down if you are already at the bottom, or you sent it
        const follow = (p.eventType === 'INSERT' && m.author_id === S.me.id) || S.stick === 'bottom' || isNearBottom();
        const i = S.messages.findIndex((x) => x.id === m.id);
        if (i >= 0) S.messages[i] = m; else S.messages.push(m);
        if (p.eventType === 'INSERT') watchForFiles(m.id);
        setTimeout(async () => { await Promise.all([loadFiles([m.id]), loadQuoted([m]), loadPolls(m.via === 'Vote' && m.parent_id ? [{ id: m.parent_id, body: '📊 VOTE: ' }, m] : [m]), loadMustRead([m])]); drawMessages(follow && (S.stick === 'bottom' || isNearBottom())); }, 700);
        drawMessages(follow);
        if (document.visibilityState === 'visible') sb.rpc('mark_read', { p_channel: id }).then(() => {});
      }).subscribe();
  }

  // Emoji reactions
  const QUICK = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
  async function loadReactions(ids) {
    if (!ids.length) return;
    S.reacts = S.reacts || {};
    ids.forEach((i) => { S.reacts[i] = []; });
    const { data } = await sb.from('reactions').select('message_id,member_id,emoji').in('message_id', ids).is('removed_at', null).order('created_at');
    (data || []).forEach((r) => { (S.reacts[r.message_id] = S.reacts[r.message_id] || []).push(r); });
  }
  function repliedHtml(m) {
    const rs = (S.replyMap || {})[m.id]; if (!rs || !rs.length || m.removed_at) return '';
    const mine = rs.some((r) => r.author_id === S.me.id);
    const names = [...new Set(rs.map((r) => (r.author_id === S.me.id ? 'You' : nameOf(r.author_id).split(' ')[0])))];
    const who = names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(' and ');
    const last = rs[rs.length - 1];
    return `<button type="button" class="replied${mine ? ' mine' : ''}" data-jump="${last.id}" title="Go to the reply">${mine ? '✓ ' : ''}↩ ${esc(who)} replied${rs.length > 1 ? ` (${rs.length})` : ''} · ${when(last.created_at)}</button>`;
  }
  function reactsHtml(m) {
    const list = (S.reacts || {})[m.id] || [];
    if (!list.length) return '';
    const by = {}; list.forEach((r) => { (by[r.emoji] = by[r.emoji] || []).push(r.member_id); });
    return `<div class="reacts">${Object.entries(by).map(([e, ids]) => `<button type="button" class="rchip${ids.includes(S.me.id) ? ' mine' : ''}" data-react="${m.id}" data-emoji="${esc(e)}" data-who="${esc(ids.map((i) => (i === S.me.id ? 'You' : nameOf(i))).join('|'))}" aria-label="${esc(e)} from ${esc(ids.map((i) => (i === S.me.id ? 'you' : nameOf(i))).join(', '))}">${e} <span>${ids.length}</span></button>`).join('')}</div>`;
  }
  function hideReactors() { const o = document.getElementById('rpop'); if (o) o.remove(); }
  function showReactors(chip) {
    hideReactors();
    const names = (chip.dataset.who || '').split('|').filter(Boolean);
    if (!names.length) return;
    const pop = document.createElement('div'); pop.id = 'rpop'; pop.className = 'rpop'; pop.setAttribute('role', 'tooltip');
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    pop.innerHTML = `<div class="rpe">${esc(chip.dataset.emoji)}</div><div><b>${esc(list)}</b><br><small>reacted with ${esc(chip.dataset.emoji)}</small></div>`;
    document.body.appendChild(pop);
    const r = chip.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    const away = (e) => { if (!pop.contains(e.target) && e.target !== chip) { hideReactors(); document.removeEventListener('pointerdown', away, true); } };
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    const msgs = document.getElementById('msgs'); if (msgs) msgs.addEventListener('scroll', hideReactors, { once: true, passive: true });
  }
  async function toggleReact(mid, emoji) {
    const { error } = await sb.rpc('toggle_reaction', { p_message: Number(mid), p_emoji: emoji });
    if (error) return toast(error.message);
    await loadReactions([Number(mid)]); drawMessages(false);
    if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'react', payload: { mid: Number(mid) } });
  }
  // Emojis for writing messages (on computers there is no emoji key, so offer a picker)
  const EMOJI = ['😀','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳','😉','🙂','🙃','😅','😬','🤔','🤭','🙄','😴','😢','😭','😤','😡','🤯','😱','🤗','😇','🤞','👍','👎','👏','🙌','🙏','💪','👋','🤝','✌️','👌','❤️','🧡','💛','💚','💙','💜','🖤','💯','✅','❌','⚠️','❗','❓','⭐','🌟','✨','🔥','🎉','🎊','🎂','🎁','🎈','☕','🍕','🍰','🍎','🥕','🚗','🚚','🏠','🏫','👶','🧸','📅','⏰','📌','📎','📞','📧','💷','🌞','🌧️','❄️','🎃','🎄'];
  function emojiPicker(anchor, ta) {
    document.querySelectorAll('.rpick, .epick').forEach((x) => x.remove());
    const pk = document.createElement('div');
    pk.className = 'epick'; pk.setAttribute('role', 'menu');
    pk.innerHTML = EMOJI.map((e) => `<button type="button" role="menuitem" data-e="${e}" aria-label="${e}">${e}</button>`).join('');
    document.body.appendChild(pk);
    const r = anchor.getBoundingClientRect();
    pk.style.top = Math.max(8, r.top - pk.offsetHeight - 8) + 'px';
    pk.style.left = Math.max(8, Math.min(window.innerWidth - pk.offsetWidth - 8, r.left)) + 'px';
    pk.querySelectorAll('[data-e]').forEach((b) => { b.onmousedown = (ev) => ev.preventDefault(); b.onclick = () => {
      const a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? a;
      ta.value = ta.value.slice(0, a) + b.dataset.e + ta.value.slice(z);
      const at = a + b.dataset.e.length; ta.focus(); ta.setSelectionRange(at, at);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }; });
    const off = (ev) => { if (!pk.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); document.removeEventListener('keydown', esc1); } };
    const esc1 = (ev) => { if (ev.key === 'Escape') { pk.remove(); document.removeEventListener('click', off); document.removeEventListener('keydown', esc1); } };
    setTimeout(() => { document.addEventListener('click', off); document.addEventListener('keydown', esc1); }, 0);
  }
  function reactPicker(mid, anchor) {
    document.querySelectorAll('.rpick').forEach((x) => x.remove());
    const pk = document.createElement('div');
    pk.className = 'rpick'; pk.setAttribute('role', 'menu');
    pk.innerHTML = QUICK.map((e) => `<button type="button" role="menuitem" data-e="${e}" aria-label="React ${e}">${e}</button>`).join('');
    document.body.appendChild(pk);
    const r = anchor.getBoundingClientRect();
    pk.style.top = Math.max(8, r.top - 52) + 'px';
    pk.style.left = Math.max(8, Math.min(window.innerWidth - pk.offsetWidth - 8, r.right - pk.offsetWidth)) + 'px';
    pk.querySelectorAll('[data-e]').forEach((b) => { b.onclick = () => { pk.remove(); toggleReact(mid, b.dataset.e); }; });
    setTimeout(() => document.addEventListener('click', function off(ev) { if (!pk.contains(ev.target)) { pk.remove(); document.removeEventListener('click', off); } }), 0);
  }

  // Photos are shrunk to phone-screen size before sending (about a tenth of the size, no visible difference)
  async function shrinkImage(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
      if (!blob || blob.size >= file.size) return file;
      const out = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      out._w = cv.width; out._h = cv.height;
      return out;
    } catch (_) { return file; }
  }

  // A picture finishes uploading a few seconds after its message arrives: keep checking briefly
  function watchForFiles(mid) {
    [2000, 5000, 10000, 20000].forEach((ms) => setTimeout(async () => {
      if (!S.current || (S.files[mid] && S.files[mid].length)) return;
      if (!S.messages.find((x) => x.id === mid)) return;
      await loadFiles([mid]);
      if (S.files[mid] && S.files[mid].length) drawMessages(isNearBottom());
    }, ms));
  }
  // Bring the open chat up to date without moving you: older messages you scrolled up to stay, and so does your place.
  async function refreshOpenChat(id) {
    const token = (S.openToken = (S.openToken || 0) + 1);
    const { data, error } = await sb.rpc('open_chat', { p_channel: id, p_limit: Math.min(500, Math.max(80, (S.current.unread || 0) + 15)) });
    if (token !== S.openToken || !S.current || S.current.id !== id || error || !data) return;
    const fresh = data.messages || [];
    const freshIds = new Set(fresh.map((m) => m.id));
    const firstFresh = fresh.length ? new Date(fresh[0].created_at) : null;
    const older = (S.messages || []).filter((m) => !freshIds.has(m.id) && firstFresh && new Date(m.created_at) < firstFresh);
    S.roomPeople = data.members || S.roomPeople; (S.roomPeopleBy = S.roomPeopleBy || {})[id] = S.roomPeople;
    (data.quoted || []).forEach((q) => { S.quoted[q.id] = q; });
    S.reacts = S.reacts || {}; fresh.forEach((m) => { S.reacts[m.id] = []; });
    (data.reactions || []).forEach((r) => { (S.reacts[r.message_id] = S.reacts[r.message_id] || []).push(r); });
    await Promise.all([attachFiles(data.files || [], fresh.map((m) => m.id)), loadPolls(fresh), loadMustRead(fresh)]);
    if (token !== S.openToken || !S.current || S.current.id !== id) return;
    const atBottom = isNearBottom();
    S.messages = older.concat(fresh);
    S.cacheMsgs[id] = fresh.slice(-60); S.cacheAt = S.cacheAt || {}; S.cacheAt[id] = S.current.lastAt; saveCache();
    drawMessages(atBottom);
    sb.rpc('mark_read', { p_channel: id }).then(() => {});
    Object.assign(S.current, { unread: 0, urgent: false, mentioned: false }); drawUnread();
    if (isWide()) drawSide();
    if (!S.roomSub || S.roomSub.state !== 'joined') { S.openToken++; S.roomSub && sb.removeChannel(S.roomSub); S.roomSub = null; subscribeRoom(id); }
  }
  function isNearBottom() { const b = document.getElementById('msgs'); return !!b && b.scrollHeight - b.scrollTop - b.clientHeight < 160; }

  async function loadFiles(ids) {
    if (!ids.length) return;
    const { data } = await sb.from('attachments').select('message_id,storage_path,file_name,mime_type,bytes,expired_at,width,height').in('message_id', ids);
    await attachFiles(data || [], ids);
  }
  // Signs all picture/file links in one request instead of one request per file
  async function attachFiles(rows, ids) {
    const live = rows.filter((f) => !f.expired_at);
    const signed = {};
    if (live.length) {
      const { data: urls } = await sb.storage.from('attachments').createSignedUrls(live.map((f) => f.storage_path), 3600);
      (urls || []).forEach((u) => { if (u && u.signedUrl && !u.error) signed[u.path] = u.signedUrl; });
    }
    // build the new lists first, then swap them in: two loads running at once (e.g. a paste and the live update)
    // must never add the same picture twice
    const fresh = {}; ids.forEach((i) => { fresh[i] = []; });
    rows.forEach((f) => {
      if (!f.expired_at) f.url = signed[f.storage_path] || null;
      const list = (fresh[f.message_id] = fresh[f.message_id] || []);
      if (!list.some((x) => x.storage_path === f.storage_path)) list.push(f);
    });
    Object.assign(S.files, fresh);
  }
  // Documents that can be shared (macro-enabled Office files are deliberately not on the list)
  const DOCS = {
    pdf: ['application/pdf', 'PDF'],
    doc: ['application/msword', 'WORD'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'WORD'],
    xls: ['application/vnd.ms-excel', 'EXCEL'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'EXCEL'],
    ppt: ['application/vnd.ms-powerpoint', 'PPT'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PPT'],
    odt: ['application/vnd.oasis.opendocument.text', 'DOC'], ods: ['application/vnd.oasis.opendocument.spreadsheet', 'SHEET'], odp: ['application/vnd.oasis.opendocument.presentation', 'SLIDES'],
    csv: ['text/csv', 'CSV'], txt: ['text/plain', 'TXT'], rtf: ['application/rtf', 'RTF'],
    pages: ['application/vnd.apple.pages', 'PAGES'], numbers: ['application/vnd.apple.numbers', 'NUMBERS'], key: ['application/vnd.apple.keynote', 'KEYNOTE'],
  };
  const DOC_ACCEPT = Object.keys(DOCS).map((x) => '.' + x).join(',') + ',' + [...new Set(Object.values(DOCS).map((x) => x[0]))].join(',');
  const extOf = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  // a document we accept, with its proper type filled in (some phones send Word files with no type)
  function asDoc(f) {
    const d = DOCS[extOf(f.name)]; if (!d) return null;
    return f.type === d[0] ? f : new File([f], f.name, { type: d[0] });
  }
  const docLabel = (f) => (DOCS[extOf(f.file_name || f.name)] || [0, 'FILE'])[1];
  function fileHtml(f) {
    if (f.expired_at) return `<div class="photo-hidden"><b>${f.mime_type.startsWith('image/') ? 'Photo removed after 30 days' : 'File removed after a year'}</b><span>Older pictures and files are cleared automatically to keep everyone's information safe.</span></div>`;
    if (!f.url && f.mime_type.startsWith('image/')) return `<div class="photo-hidden"><b>Photo hidden</b><span>Photos are only shown to deputy managers and above, to keep children&#39;s and staff information safe.</span></div>`;
    if (!f.url) return '';
    if (f.mime_type.startsWith('image/')) return `<img class="photo" role="button" tabindex="0" src="${esc(f.url)}" alt="${esc(f.file_name)}"${f.width && f.height ? ` width="${f.width}" height="${f.height}"` : ''}>`;
    return `<a class="filecard" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="ft">${docLabel(f)}</span><span><b>${esc(f.file_name)}</b><small>${Math.max(1, Math.round(f.bytes / 1024))} KB</small></span></a>`;
  }
  // Replies: the quoted message may be older than what is loaded, so fetch any missing ones.
  async function loadQuoted(list) {
    S.quoted = S.quoted || {};
    const have = new Set(S.messages.map((x) => x.id));
    const need = [...new Set(list.map((x) => x.parent_id).filter((p) => p && !have.has(p) && !S.quoted[p]))];
    if (!need.length) return;
    const { data } = await sb.from('messages').select('id,author_id,body,removed_at').in('id', need);
    (data || []).forEach((q) => { S.quoted[q.id] = q; });
  }
  const findMsg = (id) => S.messages.find((x) => x.id === id) || (S.quoted || {})[id];
  const snippet = (q) => !q ? 'Earlier message' : q.removed_at ? 'Message removed' : String(q.body || '').replace(/:sticker:[a-z-]+:/g, '[sticker]').slice(0, 120);
  function quoteHtml(m) {
    if (!m.parent_id) return '';
    const q = findMsg(m.parent_id);
    return `<button class="quote" type="button" data-jump="${m.parent_id}"><b>${esc(q ? nameOf(q.author_id) : 'Reply')}</b><span>${esc(snippet(q))}</span></button>`;
  }
  const amAdmin = () => !!(S.me && (S.me.is_admin || ((S.roles[S.me.role_code] || {}).rank || 0) >= 90));
  function dropMessage(id) {
    S.messages = (S.messages || []).filter((x) => x.id !== id);
    if (S.current && S.cacheMsgs && S.cacheMsgs[S.current.id]) { S.cacheMsgs[S.current.id] = S.cacheMsgs[S.current.id].filter((x) => x.id !== id); saveCache(); }
    if (S.editing === id) setEdit(null);
    drawMessages(false);
  }
  // ---------- birthday: asked once (day and month only), so BrainStorm can wish people happy birthday ----------
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function bdayText(md) { const [mm, dd] = String(md).split('-').map(Number); return dd + ' ' + MONTHS[mm - 1]; }
  async function askBirthday() {
    if (S.bdayAsked || !S.me || isOffline() || document.querySelector('.sheet-back, .ebc')) return;
    S.bdayAsked = true; // once per app start
    const { data } = await sb.rpc('my_birthday');
    if (document.querySelector('.sheet-back')) { S.bdayAsked = false; return; }
    if (!data || data.md || data.hidden) return;
    if (data.asked_at && Date.now() - new Date(data.asked_at).getTime() < 7 * 24 * 3600 * 1000) return; // "Not now": ask again in a week
    sheetBirthday(data, null, true);
  }
  function sheetBirthday(cur, after, first) {
    const [cm, cd] = cur.md ? cur.md.split('-').map(Number) : [0, 0];
    const s = sheet(`<h2>🎂 When's your birthday?</h2>
      <p class="note" style="text-align:left">So the team can wish you happy birthday with fireworks on the day. Just the day and month: we never ask the year or your age.</p>
      <div class="bdpick"><select class="input" id="bdd" aria-label="Day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}"${cd === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select>
        <select class="input" id="bdm" aria-label="Month"><option value="">Month</option>${MONTHS.map((n, i) => `<option value="${i + 1}"${cm === i + 1 ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <label class="vchk bdchk"><input type="checkbox" id="bdshow"${cur.hidden ? '' : ' checked'}> Wish me happy birthday in BrainStorm</label>
      <div class="actions"><button class="btn ghost" id="bdno">${first ? 'Not now' : 'Cancel'}</button><button class="btn" id="bdok">Save</button></div>
      ${first ? '<p class="note"><button type="button" class="linkbtn" id="bdnever">I’d rather not say</button></p>' : ''}`);
    const done = () => { s.remove(); if (after) after(); };
    s.querySelector('#bdno').onclick = () => { if (first) sb.rpc('birthday_not_now').then(() => {}); done(); };
    const nv = s.querySelector('#bdnever'); if (nv) nv.onclick = async () => { await sb.rpc('set_my_birthday', { p_md: null, p_show: false }); toast('No problem, we won’t ask again'); done(); };
    s.querySelector('#bdok').onclick = async () => {
      const d = Number(s.querySelector('#bdd').value), m = Number(s.querySelector('#bdm').value);
      if (!d || !m) return toast('Pick the day and the month');
      const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
      if (d > max) return toast(`${MONTHS[m - 1]} only has ${max} days`);
      const md = String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const { error } = await sb.rpc('set_my_birthday', { p_md: md, p_show: s.querySelector('#bdshow').checked });
      if (error) return toast(error.message);
      toast('Birthday saved 🎉'); done();
    };
  }

  // ---------- full-screen moments: emergency broadcasts (urgent) and fireworks (celebrations, birthdays) ----------
  const FX_KEY = () => 'bs-fx-seen-' + ((S.me && S.me.id) || 'x');
  function fxSeen() { try { return JSON.parse(localStorage.getItem(FX_KEY()) || '[]'); } catch (_) { return []; } }
  function markFxSeen(id) { try { const a = fxSeen().filter((x) => x !== id); a.push(id); localStorage.setItem(FX_KEY(), JSON.stringify(a.slice(-300))); } catch (_) {} }
  const fxQueue = []; let fxBusy = false;
  function playAlert(m) {
    if (!m || fxSeen().includes(m.id) || fxQueue.some((x) => x.id === m.id)) return;
    if (m.kind === 'urgent') fxQueue.unshift(m); else fxQueue.push(m);
    nextFx();
  }
  function nextFx() {
    if (fxBusy || !fxQueue.length || document.visibilityState !== 'visible') return;
    const m = fxQueue.shift(); fxBusy = true; markFxSeen(m.id);
    const done = () => { fxBusy = false; setTimeout(nextFx, 400); };
    const open = () => { if (S.channels.find((c) => c.id === m.channel_id)) jumpToMessage(m.channel_id, m.id); };
    if (m.kind === 'urgent') fxEmergency(m, open, done); else if (m.kind === 'shoutout') fxTrophy(m, open, done); else fxFireworks(m, open, done);
  }
  async function checkAlerts() {
    if (!S.me || isOffline()) return;
    const { data } = await sb.rpc('my_alerts');
    if (Array.isArray(data)) data.forEach(playAlert);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.me) { nextFx(); checkAlerts(); loadMyMustReads(); } });
  const calm = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fxWho(m) { return m.via && m.via !== 'Vote' ? m.via : nameOf(m.author_id); }
  function fxWhere(m) { const c = S.channels.find((x) => x.id === m.channel_id); return c ? (c.kind === 'dm' ? 'Private chat' : (c.kind === 'channel' ? '#' : '') + c.name) : ''; }
  function fxEmergency(m, open, done) {
    const el = document.createElement('div');
    el.className = 'ebc' + (calm() ? ' calm' : '');
    el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Urgent message');
    el.innerHTML = `<div class="ebars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="ebstrip" aria-hidden="true"></div>
      <div class="esiren" aria-hidden="true"></div>
      <div class="ebox"><div class="elight" aria-hidden="true">🚨</div><div class="etitle">EMERGENCY<br>BROADCAST</div>
        <div class="efrom">${m.mine ? 'Sent · this is what everyone in ' + esc(fxWhere(m)) + ' sees' : esc(fxWho(m)) + ' · ' + esc(fxWhere(m))}</div>
        <div class="ebody">${esc(String(m.body || '').slice(0, 400))}</div>
        <div class="eacts">${m.mine ? '' : '<button type="button" class="btn" id="eopen">Open message</button>'}<button type="button" class="btn ghost" id="eok">${m.mine ? 'Close' : 'Got it'}</button></div></div>`;
    document.body.appendChild(el);
    try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (_) {}
    const close = () => { el.classList.add('out'); setTimeout(() => { el.remove(); done && done(); }, 250); };
    el.querySelector('#eok').onclick = close;
    const eo = el.querySelector('#eopen'); if (eo) eo.onclick = () => { close(); open(); };
    el.querySelector('#eok').focus();
  }
  const isBday = (m) => !!m && /^🎂\s*Happy birthday/.test(String(m.body || ''));
  // birthdays: balloons drift up the screen (~8 seconds), then the canvas is removed
  function fxBalloons(done) {
    const cv = document.createElement('canvas'); cv.className = 'fxcanvas'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const COLS = ['#FF4A6E', '#2FF4FB', '#FFD84D', '#3DFF8B', '#FC70FC', '#A750F7', '#FF8A3D'];
    const n = Math.max(14, Math.min(34, Math.round(W / 34)));
    const bs = Array.from({ length: n }, (_, i) => {
      const r = 20 + Math.random() * 16;
      return { x: (W / n) * (i + 0.5) + (Math.random() - 0.5) * 30, y: H + r * 1.2 + Math.random() * H * 0.45, r, vy: 2.2 + Math.random() * 1.8,
        sw: 0.6 + Math.random() * 1.2, ph: Math.random() * 6.28, col: COLS[(Math.random() * COLS.length) | 0] };
    });
    const t0 = performance.now();
    const draw = (b, t) => {
      const x = b.x + Math.sin(t / 900 + b.ph) * 14 * b.sw, y = b.y;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + b.r * 1.18);
      g.quadraticCurveTo(x + Math.sin(t / 400 + b.ph) * 8, y + b.r * 2.2, x, y + b.r * 3.2); g.stroke();
      g.fillStyle = b.col; g.beginPath(); g.moveTo(x - 4, y + b.r * 1.28); g.lineTo(x + 4, y + b.r * 1.28); g.lineTo(x, y + b.r * 1.1); g.fill();
      g.beginPath(); g.ellipse(x, y, b.r * 0.86, b.r * 1.15, 0, 0, 6.283); g.fill();
      g.fillStyle = 'rgba(255,255,255,.38)'; g.beginPath(); g.ellipse(x - b.r * 0.3, y - b.r * 0.42, b.r * 0.17, b.r * 0.3, -0.5, 0, 6.283); g.fill();
    };
    const frame = (t) => {
      const el = t - t0;
      g.clearRect(0, 0, W, H);
      g.globalAlpha = el > 7000 ? Math.max(0, 1 - (el - 7000) / 1000) : 1;
      bs.forEach((b) => { b.y -= b.vy * (el < 600 ? el / 600 : 1); draw(b, t); });
      if (el < 8000) requestAnimationFrame(frame); else { cv.remove(); done && done(); }
    };
    requestAnimationFrame(frame);
  }
  function fxFireworks(m, open, done) {
    let card = null;
    if (m) {
      card = document.createElement('div'); card.className = 'fxcard';
      card.innerHTML = `<div class="fxt">${isBday(m) ? '🎈' : '🎉'} ${m.mine ? 'Sent with fireworks' : esc(fxWho(m))} <small>${esc(fxWhere(m))}</small></div><div class="fxb">${esc(String(m.body || '').slice(0, 200))}</div><div class="fxa">${m.mine ? '' : '<button type="button" class="btn small" id="fxo">Open</button>'}<button type="button" class="btn small ghost" id="fxx">Close</button></div>`;
      document.body.appendChild(card);
      const shut = () => { if (card) { card.remove(); card = null; } };
      card.querySelector('#fxx').onclick = shut;
      const fo = card.querySelector('#fxo'); if (fo) fo.onclick = () => { shut(); open && open(); };
      setTimeout(shut, 12000);
    }
    if (calm()) { setTimeout(() => done && done(), 1500); return; }
    if (isBday(m)) return fxBalloons(done);
    // one light canvas over everything for ~6 seconds, then it is removed
    const cv = document.createElement('canvas'); cv.className = 'fxcanvas'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const COLS = ['#2FF4FB', '#FC70FC', '#FFD84D', '#3DFF8B', '#FF4A1C', '#A750F7', '#FFFFFF'];
    const parts = [], conf = [];
    const burst = (x, y) => {
      const col = COLS[(Math.random() * COLS.length) | 0], n = 46 + ((Math.random() * 20) | 0);
      for (let i = 0; i < n; i++) { const a = (Math.PI * 2 * i) / n, sp = 2.2 + Math.random() * 3.2; parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: Math.random() < 0.25 ? '#FFFFFF' : col }); }
    };
    for (let i = 0; i < Math.min(160, Math.round(W / 4)); i++) conf.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.8, vy: 1.6 + Math.random() * 2.4, vx: -0.8 + Math.random() * 1.6, r: Math.random() * 6.28, vr: -0.15 + Math.random() * 0.3, w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, col: COLS[(Math.random() * COLS.length) | 0] });
    const t0 = performance.now(); let lastBurst = 0;
    const frame = (t) => {
      const el = t - t0;
      if (el < 3600 && t - lastBurst > 380) { lastBurst = t; burst(W * (0.15 + Math.random() * 0.7), H * (0.12 + Math.random() * 0.38)); }
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.vy += 0.05; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        g.globalAlpha = p.life; g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, 2.2, 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      const fade = el > 5000 ? Math.max(0, 1 - (el - 5000) / 1000) : 1;
      conf.forEach((c) => { c.y += c.vy; c.x += c.vx + Math.sin((c.y + c.r * 40) / 40) * 0.6; c.r += c.vr; g.save(); g.globalAlpha = fade; g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.col; g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); g.restore(); });
      if (el < 6000) requestAnimationFrame(frame); else { cv.remove(); done && done(); }
    };
    requestAnimationFrame(frame);
  }

  // ---------- scrolling back: fetch earlier messages when you reach the top of what's loaded ----------
  async function loadOlder() {
    const c = S.current; if (!c || S.olderBusy || isOffline() || !S.messages.length) return;
    S.reachedStart = S.reachedStart || {};
    if (S.reachedStart[c.id]) return;
    const first = S.messages[0];
    S.olderBusy = true;
    const box = document.getElementById('msgs');
    let tip = null;
    if (box) { tip = document.createElement('div'); tip.className = 'empty small olderload'; tip.textContent = 'Loading earlier messages…'; box.prepend(tip); }
    try {
      const { data, error } = await sb.rpc('messages_around', { p_channel: c.id, p_message: first.id, p_before: 60, p_after: 0 });
      if (error || !Array.isArray(data) || !S.current || S.current.id !== c.id) return;
      const have = new Set(S.messages.map((m) => m.id));
      const older = data.filter((m) => !have.has(m.id));
      if (!older.length) { S.reachedStart[c.id] = true; return; }
      const ids = older.map((m) => m.id);
      S.reacts = S.reacts || {};
      await Promise.all([attachFiles(await sb.from('attachments').select('message_id,storage_path,file_name,mime_type,bytes,expired_at,width,height').in('message_id', ids).then((r) => r.data || []), ids),
        loadQuoted(older), loadReactions(ids), loadPolls(older), loadMustRead(older)]);
      if (!S.current || S.current.id !== c.id) return;
      const b = document.getElementById('msgs'); if (!b) return;
      const fromBottom = b.scrollHeight - b.scrollTop; // keep what you're looking at in the same place
      S.messages = older.concat(S.messages).sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
      S.stick = null; drawMessages(false);
      b.scrollTop = b.scrollHeight - fromBottom;
      if (older.length < 60) S.reachedStart[c.id] = true;
    } finally {
      if (tip) tip.remove();
      S.olderBusy = false;
    }
  }

  // ---------- votes: a question with 2–6 answers; results stay hidden until it closes ----------
  const isPollMsg = (m) => m && !m.via && /^📊 VOTE: /.test(m.body || '');
  const pollTimers = {};
  // ---------- shout-outs: anyone can thank a colleague; the person thanked gets a trophy moment ----------
  const shoutReason = (m) => String(m.body || '').replace(/^⭐\s*Shout-out to [^:]*:\s*/, '');
  function shoutHtml(m) {
    return `<div class="shoutcard"><div class="sh1"><span class="shstar" aria-hidden="true">⭐</span> Shout-out to <button type="button" class="namebtn" data-quick="${m.shoutout_to}">${esc(m.shoutout_to === S.me.id ? 'you' : nameOf(m.shoutout_to))}</button></div><div class="sh2">${renderBody(shoutReason(m), [])}</div></div>`;
  }
  const SHOUT_IDEAS = ['Thanks for covering for me', 'Brilliant teamwork today', 'You went the extra mile', 'You made my day', 'Thanks for the help'];
  function sheetShout(c) {
    if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
    const ppl = (S.roomPeople || []).filter((id) => id !== S.me.id && S.people[id] && S.people[id].status !== 'left' && !(S.bots || {})[id])
      .map((id) => S.people[id]).sort((a, b) => (a.display_name || a.full_name).localeCompare(b.display_name || b.full_name));
    if (!ppl.length) return toast('There’s nobody else in this chat to give a shout-out to');
    let pick = ppl.length === 1 ? ppl[0].id : null;
    const s = sheet(`<h2>⭐ Give a shout-out</h2>
      <p class="note" style="text-align:left">Say thank you or well done. It posts in this chat and they get a trophy on their screen.</p>
      ${ppl.length > 6 ? '<input class="input" id="shq" placeholder="Find someone" aria-label="Find someone">' : ''}
      <div class="shpeople" id="shp" role="group" aria-label="Who is it for?"></div>
      <textarea class="input" id="shwhy" rows="3" maxlength="300" placeholder="What’s it for?" aria-label="What’s it for?"></textarea>
      <div class="shideas">${SHOUT_IDEAS.map((t) => `<button type="button" class="tplbtn" data-idea="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="actions"><button class="btn ghost" id="shno">Cancel</button><button class="btn" id="shok">⭐ Send shout-out</button></div>`);
    const drawP = (q = '') => {
      const box = s.querySelector('#shp'); const f = q.toLowerCase();
      box.innerHTML = ppl.filter((p) => !f || (p.display_name || p.full_name).toLowerCase().includes(f) || p.id === pick)
        .map((p) => `<button type="button" class="shperson" data-pick="${p.id}" aria-pressed="${p.id === pick}">${avatar(p.id)}<span>${esc(p.display_name || p.full_name)}</span></button>`).join('') || '<div class="note">Nobody by that name in this chat</div>';
      box.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => { pick = b.dataset.pick; drawP(q); }; });
    };
    drawP();
    const sq = s.querySelector('#shq'); if (sq) sq.oninput = () => drawP(sq.value);
    const why = s.querySelector('#shwhy');
    s.querySelectorAll('[data-idea]').forEach((b) => { b.onclick = () => { why.value = b.dataset.idea; why.focus(); }; });
    s.querySelector('#shno').onclick = () => s.remove();
    const ok = s.querySelector('#shok');
    ok.onclick = async () => {
      if (!pick) return toast('Pick who the shout-out is for');
      const reason = why.value.trim(); if (reason.length < 3) return toast('Say what the shout-out is for');
      ok.disabled = true;
      const { data, error } = await sb.from('messages').insert({ channel_id: c.id, author_id: S.me.id, body: reason, shoutout_to: pick }).select('id').single();
      ok.disabled = false;
      if (error) return toast((error.message || 'Shout-out not sent').replace(/^BrainStorm rule: /, ''));
      s.remove();
      markFxSeen(data.id);
      fxTrophy({ id: data.id, channel_id: c.id, author_id: S.me.id, shoutout_to: pick, body: reason, mine: true }, null, null);
    };
    if (pick) why.focus();
  }
  function fxTrophy(m, open, done) {
    const el = document.createElement('div');
    el.className = 'trophy' + (calm() ? ' calm' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Shout-out');
    const stars = calm() ? '' : Array.from({ length: 14 }, (_, i) => `<i style="--a:${(i * 360) / 14}deg;--d:${(i % 3) * 0.12}s">★</i>`).join('');
    el.innerHTML = `<div class="trbox"><div class="trstars" aria-hidden="true">${stars}</div><div class="trcup" aria-hidden="true">🏆</div>
      <div class="trt">${m.mine ? 'Shout-out sent to ' + esc(nameOf(m.shoutout_to)) : esc(fxWho(m)) + ' gave you a shout-out!'}</div>
      <div class="trb">${esc(shoutReason(m).slice(0, 300))}</div>
      <div class="tra">${m.mine ? '' : '<button type="button" class="btn small" id="tro">Open</button>'}<button type="button" class="btn small ghost" id="trx">${m.mine ? 'Close' : 'Thanks!'}</button></div></div>`;
    document.body.appendChild(el);
    try { if (!m.mine && navigator.vibrate) navigator.vibrate([60, 60, 120]); } catch (_) {}
    let shut = false;
    const close = () => { if (shut) return; shut = true; el.classList.add('out'); setTimeout(() => { el.remove(); done && done(); }, 250); };
    el.querySelector('#trx').onclick = close;
    el.onclick = (e) => { if (e.target === el) close(); };
    const to = el.querySelector('#tro'); if (to) to.onclick = () => { close(); open && open(); };
    setTimeout(close, m.mine ? 4000 : 12000);
  }

  // ---------- must-read notices (management): stay on everyone's screen until they tap "I've read it" ----------
  async function loadMustRead(list) {
    const ids = (list || []).filter((m) => m.must_read && !m.removed_at).map((m) => m.id);
    if (!ids.length || isOffline()) return;
    const { data, error } = await sb.rpc('must_read_info', { p_ids: ids });
    if (error || !Array.isArray(data)) return;
    S.mr = S.mr || {};
    data.forEach((r) => { S.mr[r.message_id] = r; });
  }
  function mustReadHtml(m) {
    const r = (S.mr || {})[m.id]; if (!r) return '';
    let h = '';
    if (r.for_me && !r.read_by_me) h += `<button type="button" class="btn small mrack" data-mrack="${m.id}">✓ I’ve read it</button>`;
    else if (r.for_me) h += '<span class="mrdone">✓ You’ve read this</span>';
    if (r.total != null) h += `<button type="button" class="mrstat" data-mrstat="${m.id}">${r.total && r.read >= r.total ? '✓ Everyone has read it' : `Read by ${r.read} of ${r.total}`} · See who</button>`;
    return h ? `<div class="mrrow">${h}</div>` : '';
  }
  async function ackMustRead(id) {
    if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
    const { error } = await sb.rpc('ack_must_read', { p_message: id });
    if (error) return toast(error.message);
    S.mr = S.mr || {}; if (S.mr[id]) S.mr[id].read_by_me = true;
    S.mustReads = (S.mustReads || []).filter((x) => x.id !== id);
    paintMustReadBanner();
    if (S.current && document.getElementById('msgs')) drawMessages(false);
    toast('Thanks, marked as read');
  }
  async function sheetMustReadStatus(id) {
    const { data, error } = await sb.rpc('must_read_status', { p_message: id });
    if (error || !data) return toast((error && error.message) || 'Couldn’t load that');
    const nm = (x) => esc(nameOf(x));
    const s = sheet(`<h2>📌 Who has read it</h2>
      <div class="section s-urg" style="padding-left:0">Still to read (${data.waiting.length})</div>
      <div class="mrlist">${data.waiting.length ? data.waiting.map((x) => `<div class="mrp">${avatar(x)}<span>${nm(x)}</span></div>`).join('') : '<div class="note">Nobody. Everyone has read it 🎉</div>'}</div>
      <div class="section s-room" style="padding-left:0">Read (${data.read.length})</div>
      <div class="mrlist">${data.read.map((x) => `<div class="mrp">${avatar(x.id)}<span>${nm(x.id)}</span><small>${when(x.at)}</small></div>`).join('') || '<div class="note">Nobody yet</div>'}</div>
      <div class="actions"><button class="btn" id="mrsx">Close</button></div>`);
    s.querySelector('#mrsx').onclick = () => s.remove();
  }
  async function loadMyMustReads() {
    if (!S.me || isOffline()) return;
    const { data, error } = await sb.rpc('my_must_reads');
    if (error || !Array.isArray(data)) return;
    const before = (S.mustReads || []).map((x) => x.id).join(',');
    S.mustReads = data;
    if (before !== data.map((x) => x.id).join(',')) paintMustReadBanner();
  }
  function mustReadBanner() {
    const l = S.mustReads || []; if (!l.length) return '';
    const last = l[l.length - 1];
    return `<button type="button" class="mrbanner" id="mrbtn"><span class="mrpin" aria-hidden="true">📌</span><span class="mrtx"><b>${l.length === 1 ? 'You have a must-read notice' : `You have ${l.length} must-read notices`}</b><small>From ${esc(nameOf(last.author_id))}${fxWhere(last) ? ' · ' + esc(fxWhere(last)) : ''} · tap to read</small></span></button>`;
  }
  function wireMustReadBanner() { document.querySelectorAll('#mrbtn').forEach((b) => { b.onclick = sheetMyMustReads; }); }
  function paintMustReadBanner() { document.querySelectorAll('#mrbanner').forEach((el) => { el.innerHTML = mustReadBanner(); }); wireMustReadBanner(); }
  function sheetMyMustReads() {
    const l = (S.mustReads || []).slice(); if (!l.length) return;
    const s = sheet(`<h2>📌 Must read</h2><p class="note" style="text-align:left">Please read ${l.length === 1 ? 'this' : 'these'} and tap “I’ve read it”. Your manager can see who has.</p>
      <div class="mritems">${l.map((m) => `<div class="mritem" data-mri="${m.id}"><div class="mrwho">${avatar(m.author_id)}<span><b>${esc(nameOf(m.author_id))}</b><small>${esc(fxWhere(m))} · ${when(m.created_at)}</small></span></div>
        <div class="mrbody">${renderBody(m.body, [])}</div>
        <div class="mrrow"><button type="button" class="btn small mrack" data-ack="${m.id}">✓ I’ve read it</button><button type="button" class="btn small ghost" data-go="${m.id}" data-ch="${m.channel_id}">Open in chat</button></div></div>`).join('')}</div>
      <div class="actions"><button class="btn ghost" id="mrlater">Later</button></div>`);
    s.querySelector('#mrlater').onclick = () => s.remove();
    s.querySelectorAll('[data-ack]').forEach((b) => { b.onclick = async () => {
      b.disabled = true; await ackMustRead(Number(b.dataset.ack));
      const it = s.querySelector(`[data-mri="${b.dataset.ack}"]`); if (it) it.remove();
      if (!s.querySelector('[data-mri]')) s.remove();
    }; });
    s.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { s.remove(); jumpToMessage(b.dataset.ch, Number(b.dataset.go)); }; });
  }

  async function loadPolls(list) {
    const ids = (list || []).filter(isPollMsg).map((m) => m.id);
    if (!ids.length || isOffline()) return;
    const { data, error } = await sb.rpc('polls_for', { p_messages: ids });
    if (error || !Array.isArray(data)) return;
    S.polls = S.polls || {};
    data.forEach((p) => {
      S.polls[p.message_id] = p;
      // when it is due to close, fetch the result (the server closes votes every minute)
      clearTimeout(pollTimers[p.message_id]);
      const wait = new Date(p.closes_at).getTime() - Date.now() + 65000;
      if (!p.closed && wait < 24 * 3600 * 1000) pollTimers[p.message_id] = setTimeout(async () => {
        if (!document.querySelector(`[data-mid="${p.message_id}"]`)) return;
        await loadPolls([{ id: p.message_id, body: '📊 VOTE: ' }]); drawMessages(false);
      }, Math.max(1000, wait));
    });
  }
  function closeText(ts) {
    const d = new Date(ts), now = new Date();
    const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'today at ' + t;
    const tm = new Date(now); tm.setDate(now.getDate() + 1);
    if (d.toDateString() === tm.toDateString()) return 'tomorrow at ' + t;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' at ' + t;
  }
  function pollHtml(p) {
    const opts = p.options || [];
    const mine = p.created_by === S.me.id;
    if (p.closed) {
      const counts = p.counts || opts.map(() => 0);
      const total = counts.reduce((a, b) => a + b, 0), best = Math.max(0, ...counts);
      const rows = opts.map((o, i) => {
        const n = counts[i] || 0, pct = total ? Math.round((n * 100) / total) : 0, win = total && n === best;
        const names = p.names && p.names[i] && p.names[i].length ? `<div class="pnames">${p.names[i].map((id) => esc(nameOf(id).split(' ')[0])).join(', ')}</div>` : '';
        return `<div class="popt res${win ? ' win' : ''}${p.my_choice === i ? ' mine' : ''}"><div class="pbar" style="width:${pct}%"></div><span class="pl">${win ? '🏆 ' : ''}${esc(o)}${p.my_choice === i ? ' <small>(your vote)</small>' : ''}</span><span class="pc">${n} · ${pct}%</span></div>${names}`;
      }).join('');
      return `<div class="poll closed"><div class="ph">📊 VOTE · CLOSED</div><div class="pq">${esc(p.question)}</div>${rows}
        <div class="pf">${total} ${total === 1 ? 'vote' : 'votes'}${p.anonymous ? ' · votes were private' : ''}</div></div>`;
    }
    const rows = opts.map((o, i) => `<button type="button" class="popt${p.my_choice === i ? ' mine' : ''}" data-poll="${p.poll_id}" data-pm="${p.message_id}" data-vote="${i}"${p.can_vote ? '' : ' disabled'}><span class="pr" aria-hidden="true"></span><span class="pl">${esc(o)}</span>${p.my_choice === i ? '<span class="pc">✓ Your vote</span>' : ''}</button>`).join('');
    const due = new Date(p.closes_at).getTime() <= Date.now();
    return `<div class="poll"><div class="ph">📊 VOTE</div><div class="pq">${esc(p.question)}</div>${rows}
      <div class="pf">${p.voters} ${p.voters === 1 ? 'person has' : 'people have'} voted · ${due ? 'closing now…' : 'closes ' + closeText(p.closes_at)}<br>
      Results show when it closes${p.anonymous ? '. Votes are private' : '. Everyone will see who voted for what'}${p.can_vote ? '. Tap again to change your vote' : ''}.</div>
      ${mine || amAdmin() ? `<button type="button" class="btn small ghost pclose" data-closevote="${p.poll_id}" data-pm="${p.message_id}">Close vote now and show result</button>` : ''}</div>`;
  }
  async function castVote(pollId, choice, mid) {
    if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
    const p = S.polls[mid]; if (!p || p.closed) return;
    const same = p.my_choice === choice;
    const before = { my_choice: p.my_choice, voters: p.voters };
    // show it straight away
    if (same) { p.my_choice = null; p.voters = Math.max(0, p.voters - 1); }
    else { if (p.my_choice == null) p.voters += 1; p.my_choice = choice; }
    drawMessages(false);
    const { error } = await sb.rpc('cast_vote', { p_poll: pollId, p_choice: same ? null : choice });
    if (error) { Object.assign(p, before); drawMessages(false); return toast(error.message); }
    if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'poll', payload: { mid } });
    toast(same ? 'Vote taken back' : 'Vote counted');
  }
  function closeVote(pollId, mid) {
    const c = sheet(`<h2>Close this vote now?</h2><p class="note" style="text-align:left">Voting stops and everyone in the chat sees the result straight away.</p>
      <div class="actions"><button class="btn ghost" id="no">Keep it open</button><button class="btn" id="yes">Close and show result</button></div>`);
    c.querySelector('#no').onclick = () => c.remove();
    c.querySelector('#yes').onclick = async () => {
      if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
      const { error } = await sb.rpc('close_poll', { p_poll: pollId });
      c.remove();
      if (error) return toast(error.message);
      await loadPolls([{ id: mid, body: '📊 VOTE: ' }]); drawMessages(false);
      if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'poll', payload: { mid } });
    };
  }
  function sheetVote(c) {
    if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
    const now = new Date();
    const at = (h, m, addDays) => { const d = new Date(now); d.setDate(d.getDate() + (addDays || 0)); d.setHours(h, m || 0, 0, 0); return d; };
    const choices = [
      ['1h', '1 hour', new Date(now.getTime() + 3600e3)],
      ['4h', '4 hours', new Date(now.getTime() + 4 * 3600e3)],
      ...(now.getHours() < 17 ? [['eod', 'End of today (5pm)', at(17, 0)]] : []),
      ['tom', 'Tomorrow at 9am', at(9, 0, 1)],
      ['1d', '24 hours', new Date(now.getTime() + 24 * 3600e3)],
      ['3d', '3 days', new Date(now.getTime() + 3 * 24 * 3600e3)],
      ['1w', '1 week', new Date(now.getTime() + 7 * 24 * 3600e3)]
    ];
    const s = sheet(`<h2>${icon.vote} Start a vote</h2>
      <form id="vf" class="votef">
        <label class="vlab" for="vq">Question</label>
        <textarea class="input vq" id="vq" maxlength="300" rows="2" placeholder="e.g. Is blue better than green?" required></textarea>
        <div class="vlab">Answers</div>
        <div id="vopts"></div>
        <button type="button" class="linkbtn" id="vadd">+ Add another answer</button>
        <label class="vlab" for="vclose">Close the vote and show the result</label>
        <select class="input" id="vclose">${choices.map(([k, l], i) => `<option value="${k}"${k === '1d' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label class="vchk"><input type="checkbox" id="vnames"> Show who voted for what when it closes</label>
        <p class="note" style="text-align:left">Nobody sees the results until the vote closes. You can close it early.</p>
        <div class="actions"><button class="btn ghost" type="button" id="vno">Cancel</button><button class="btn" type="submit" id="vgo">Start vote</button></div>
      </form>`);
    let opts = ['Yes', 'No'];
    const box = s.querySelector('#vopts');
    const draw = () => {
      box.innerHTML = opts.map((o, i) => `<div class="vrow"><input class="input" data-oi="${i}" maxlength="80" value="${esc(o)}" placeholder="Answer ${i + 1}" required>${opts.length > 2 ? `<button type="button" class="iconbtn" data-rm="${i}" aria-label="Remove this answer">✕</button>` : ''}</div>`).join('');
      box.querySelectorAll('[data-oi]').forEach((inp) => { inp.oninput = () => { opts[Number(inp.dataset.oi)] = inp.value; }; });
      box.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { opts.splice(Number(b.dataset.rm), 1); draw(); }; });
      s.querySelector('#vadd').hidden = opts.length >= 6;
    };
    draw();
    s.querySelector('#vadd').onclick = () => { opts.push(''); draw(); const l = box.querySelector(`[data-oi="${opts.length - 1}"]`); if (l) l.focus(); };
    s.querySelector('#vno').onclick = () => s.remove();
    s.querySelector('#vq').focus();
    s.querySelector('#vf').onsubmit = async (e) => {
      e.preventDefault();
      const q = s.querySelector('#vq').value.trim();
      const answers = opts.map((o) => o.trim()).filter(Boolean);
      if (!q) return toast('Type the question first');
      if (answers.length < 2) return toast('A vote needs at least 2 answers');
      const pick = choices.find(([k]) => k === s.querySelector('#vclose').value) || choices[0];
      const go = s.querySelector('#vgo'); go.disabled = true;
      const { data: msg, error } = await sb.from('messages').insert({ channel_id: c.id, author_id: S.me.id, body: '📊 VOTE: ' + q }).select('id').single();
      if (error) { go.disabled = false; return toast(error.message || 'The vote could not be started'); }
      const r = await sb.rpc('create_poll', { p_message: msg.id, p_question: q, p_options: answers, p_closes_at: pick[2].toISOString(), p_anonymous: !s.querySelector('#vnames').checked });
      if (r.error) { sb.rpc('remove_message', { p_message: msg.id }).then(() => {}); go.disabled = false; return toast(r.error.message); }
      s.remove();
      await loadPolls([{ id: msg.id, body: '📊 VOTE: ' }]);
      if (S.current && S.current.id === c.id) {
        if (!S.messages.find((m) => m.id === msg.id)) S.messages.push({ id: msg.id, channel_id: c.id, author_id: S.me.id, body: '📊 VOTE: ' + q, created_at: new Date().toISOString(), mentions: [] });
        drawMessages(true);
      }
      if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'poll', payload: { mid: msg.id } });
      toast('Vote started');
    };
  }

  // ---------- saved messages: bookmark a message to come back to (private to you) ----------
  function isSavedMsg(id) { return !!(S.saved && S.saved.has(Number(id))); }
  async function loadSaved() {
    const { data, error } = await sb.rpc('my_saved');
    if (error || !Array.isArray(data)) return;
    S.savedList = data; S.saved = new Set(data.map((x) => x.message_id)); saveCache();
    const b = document.getElementById('savedbtn'); if (b) drawSavedBtn(b);
  }
  // personal reminders on the To Do list (only you can see them)
  async function loadTodos() {
    const { data, error } = await sb.from('my_todos').select('id, body, created_at').order('created_at', { ascending: false });
    if (error || !Array.isArray(data)) return;
    S.todos = data; saveCache();
    document.querySelectorAll('#savedbtn').forEach(drawSavedBtn);
  }
  async function addTodo(body) {
    body = String(body || '').trim().slice(0, 500); if (!body) return false;
    if (isOffline()) { toast('No connection right now. Try again when you’re back online.'); return false; }
    const { data, error } = await sb.from('my_todos').insert({ body }).select('id, body, created_at').single();
    if (error) { toast(error.message); return false; }
    S.todos = [data, ...(S.todos || [])]; saveCache();
    document.querySelectorAll('#savedbtn').forEach(drawSavedBtn);
    return true;
  }
  async function doneTodo(id) {
    if (isOffline()) { toast('No connection right now. Try again when you’re back online.'); return false; }
    const keep = S.todos || [];
    S.todos = keep.filter((t) => t.id !== id); document.querySelectorAll('#savedbtn').forEach(drawSavedBtn);
    const { error } = await sb.from('my_todos').delete().eq('id', id);
    if (error) { S.todos = keep; document.querySelectorAll('#savedbtn').forEach(drawSavedBtn); toast(error.message); return false; }
    saveCache(); return true;
  }
  function drawSavedBtn(b) {
    const n = (S.savedList || []).length + (S.todos || []).length;
    b.classList.toggle('has', !!n); b.innerHTML = icon.mark + 'To Do' + (n ? `<span class="tabcount sv">${n}</span>` : '');
  }
  function paintSaved(id) {
    const on = isSavedMsg(id);
    document.querySelectorAll(`[data-mid="${id}"]`).forEach((el) => el.classList.toggle('saved', on));
    document.querySelectorAll(`[data-save="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.title = on ? 'Saved' : 'Save'; b.setAttribute('aria-label', on ? 'Remove from saved' : 'Save this message to come back to'); });
    document.querySelectorAll('#savedbtn').forEach(drawSavedBtn);
  }
  async function toggleSave(id) {
    if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
    S.saved = S.saved || new Set(); S.savedList = S.savedList || [];
    const was = S.saved.has(id);
    const m = (S.messages || []).find((x) => x.id === id);
    // show it straight away, then confirm with the server
    if (was) { S.saved.delete(id); S.savedList = S.savedList.filter((x) => x.message_id !== id); }
    else { S.saved.add(id); if (m) S.savedList.unshift({ message_id: id, channel_id: S.current && S.current.id, author_id: m.author_id, body: m.body, created_at: m.created_at, saved_at: new Date().toISOString(), via: m.via }); }
    paintSaved(id);
    const { data, error } = await sb.rpc('toggle_saved', { p_message: id });
    if (error) { toast(error.message); loadSaved().then(() => paintSaved(id)); return; }
    if (!!data === was) loadSaved().then(() => paintSaved(id)); // out of step with the server: take its answer
    else { saveCache(); toast(data ? 'Added to your To Do list.' : 'Removed from your To Do list'); }
  }
  function sheetSaved() {
    const saved = (S.savedList || []).map((x) => ({ t: 'msg', at: x.saved_at || x.created_at, x }));
    const todos = (S.todos || []).map((x) => ({ t: 'todo', at: x.created_at, x }));
    const list = saved.concat(todos).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const rows = list.map(({ t, x }) => {
      if (t === 'todo') return `<div class="svrow todo"><div class="svopen" data-edit="${x.id}">
          <div class="svtop"><b>Reminder</b><small>${when(x.created_at)}</small></div>
          <div class="svtxt">${esc(x.body)}</div></div>
        <button class="iconbtn svx tdx" type="button" data-done="${x.id}" aria-label="Done: remove this reminder" title="Done">✓</button></div>`;
      const c = S.channels.find((ch) => ch.id === x.channel_id);
      const where = c ? (c.kind === 'channel' ? '# ' : '') + c.name : 'Chat';
      const who = x.via || nameOf(x.author_id);
      const txt = /^:sticker:/.test(x.body || '') ? 'Sticker' : String(x.body || '(picture or file)').replace(/\s+/g, ' ').slice(0, 140);
      return `<div class="svrow"><button class="svopen" type="button" data-go="${x.message_id}" data-ch="${x.channel_id}">
        <div class="svtop"><b>${esc(who)}</b><span>${esc(where)}</span><small>${when(x.created_at)}</small></div>
        <div class="svtxt">${esc(txt)}</div></button>
        <button class="iconbtn svx" type="button" data-unsave="${x.message_id}" aria-label="Remove from your To Do list" title="Remove">✕</button></div>`;
    }).join('');
    const s = sheet(`<div class="tdhead"><h2>${icon.mark} To Do</h2><button class="iconbtn tdadd" type="button" id="tdadd" aria-label="Add a reminder" title="Add a reminder">${icon.plus}</button></div>
      <form id="tdform" class="tdform" hidden><textarea class="input" id="tdtext" rows="2" maxlength="500" placeholder="What do you need to do?"></textarea>
        <div class="tdbtns"><button class="btn ghost small" type="button" id="tdcancel">Cancel</button><button class="btn small tdsave" type="submit">Add</button></div></form>
      ${list.length ? `<p class="note">Only you can see this list. Green ones are your reminders: tap ✓ when done. Tap a saved message to jump back to it.</p><div class="svlist">${rows}</div>` : `<p class="note" id="tdempty">Nothing here yet. Tap + to add a reminder, or tap the bookmark on any message to keep it here.</p>`}
      <div class="actions"><button class="btn ghost" id="svclose">Close</button></div>`);
    const form = s.querySelector('#tdform'), ta = s.querySelector('#tdtext');
    s.querySelector('#svclose').onclick = () => s.remove();
    s.querySelector('#tdadd').onclick = () => { form.hidden = !form.hidden; if (!form.hidden) ta.focus(); };
    s.querySelector('#tdcancel').onclick = () => { ta.value = ''; form.hidden = true; };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = async (e) => {
      e.preventDefault(); const btn = form.querySelector('.tdsave'); if (btn.disabled) return;
      btn.disabled = true; const ok = await addTodo(ta.value); btn.disabled = false;
      if (ok) { s.remove(); sheetSaved(); toast('Reminder added'); }
    };
    s.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { s.remove(); jumpToMessage(b.dataset.ch, Number(b.dataset.go)); }; });
    s.querySelectorAll('[data-unsave]').forEach((b) => { b.onclick = async () => { await toggleSave(Number(b.dataset.unsave)); b.closest('.svrow').remove(); if (!(S.savedList || []).length && !(S.todos || []).length) { s.remove(); sheetSaved(); } }; });
    s.querySelectorAll('[data-done]').forEach((b) => { b.onclick = async () => { const row = b.closest('.svrow'); row.classList.add('gone'); if (await doneTodo(Number(b.dataset.done))) { row.remove(); if (!(S.savedList || []).length && !(S.todos || []).length) { s.remove(); sheetSaved(); } } else row.classList.remove('gone'); }; });
    loadSaved(); loadTodos(); // freshen in the background
  }
  async function jumpToMessage(channelId, id) {
    if (!S.channels.find((c) => c.id === channelId)) return toast('You are no longer in that chat.');
    if (!S.current || S.current.id !== channelId || S.tab !== 'chat') await openChannel(channelId);
    if (!S.current || S.current.id !== channelId) return;
    if (!S.messages.find((m) => m.id === id) && !isOffline()) { // older than what's loaded: fetch the messages around it
      const { data } = await sb.rpc('messages_around', { p_channel: channelId, p_message: id });
      if (!S.current || S.current.id !== channelId) return;
      if (Array.isArray(data) && data.length) {
        const byId = {}; [...data, ...S.messages].forEach((m) => { byId[m.id] = m; });
        S.messages = Object.values(byId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const ids = data.map((m) => m.id);
        await Promise.all([loadFiles(ids), loadQuoted(data), loadReactions(ids), loadPolls(data)]);
        S.unreadFrom = null; drawMessages(false);
      }
    }
    const box = document.getElementById('msgs'); const t = box && box.querySelector(`[data-mid="${id}"]`);
    if (!t) return toast('That message is no longer available.');
    S.stick = null; clearTimeout(S.stickTimer);
    t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  }
  function confirmDelete(id) {
    const m = (S.messages || []).find((x) => x.id === id); if (!m) return;
    const mine = m.author_id === S.me.id;
    if (!mine) return;
    const c = sheet(`<h2>Delete this message?</h2><p class="note" style="text-align:left">It will disappear for everyone in this chat.</p>
      <div class="msgprev">${esc(String(m.body || '').slice(0, 200))}</div>
      <div class="actions"><button class="btn ghost" id="no">Keep it</button><button class="btn danger" id="yes">Delete</button></div>`);
    c.querySelector('#no').onclick = () => c.remove();
    c.querySelector('#yes').onclick = async () => {
      if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
      const { error } = await sb.rpc('remove_message', { p_message: id });
      c.remove();
      if (error) return toast(error.message);
      dropMessage(id); toast('Message deleted');
      if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'removed', payload: { mid: id } });
      loadChannels().then(() => { if (isWide()) drawSide(); drawUnread(); });
    };
  }
  function msgHtml(m) {
    const files = m.removed_at ? '' : (S.files[m.id] || []).map(fileHtml).join(''); // a deleted message never shows its pictures
    const body = m.removed_at ? 'Message removed' : m.shoutout_to ? shoutHtml(m) : (S.polls && S.polls[m.id]) ? pollHtml(S.polls[m.id]).replace(/>\s*\n\s*/g, '>').replace(/\n\s*/g, ' ') : renderBody(m.body, m.mentions);
    const mrTop = m.must_read && !m.removed_at ? '<div class="mrtag">📌 Must read</div>' : '';
    const mrEnd = m.must_read && !m.removed_at ? mustReadHtml(m) : '';
    const xc = (m.shoutout_to && !m.removed_at ? ' shout' : '') + (m.must_read && !m.removed_at ? ' mustread' : '');
    const canReply = !m.removed_at && document.getElementById('send');
    const canReact = !m.removed_at && !(S.current && S.current.observer);
    const isSaved = isSavedMsg(m.id);
    const sv = m.removed_at ? '' : `<button class="replybtn savebtn${isSaved ? ' on' : ''}" type="button" data-save="${m.id}" aria-label="${isSaved ? 'Remove from saved' : 'Save this message to come back to'}" title="${isSaved ? 'Saved' : 'Save'}">${icon.mark}</button>`;
    const rb = sv + (canReact ? `<button class="replybtn reactbtn" type="button" data-addreact="${m.id}" aria-label="React with an emoji">☺︎</button>` : '')
      + (canReply && m.author_id === S.me.id && !isPollMsg(m) && !m.shoutout_to && !/^:sticker:[a-z-]+:$/.test(m.body || '') ? `<button class="replybtn" type="button" data-edit="${m.id}" aria-label="Edit your message">✎</button>` : '')
      + (!m.removed_at && m.author_id === S.me.id ? `<button class="replybtn delbtn" type="button" data-del="${m.id}" aria-label="Delete this message" title="Delete">🗑</button>` : '')
      + (canReply ? `<button class="replybtn" type="button" data-reply="${m.id}" aria-label="Reply to this message">${icon.reply}</button>` : '');
    if (m.urgent && !m.removed_at) {
      return `<div class="urgent${isSaved ? ' saved' : ''}${xc}" data-mid="${m.id}"><div class="ul">URGENT · <button class="namebtn u" type="button" data-quick="${m.author_id}">${esc(nameOf(m.author_id).toUpperCase())}</button> · ${when(m.created_at)}${rb}</div>${mrTop}${quoteHtml(m)}<div class="body">${body}</div>${files}${mrEnd}${reactsHtml(m)}${repliedHtml(m)}</div>`;
    }
    if (m.via) { // automatic post from Mothership / MooseHub
      if (m.via !== 'Vote' && m.via !== 'BrainStorm' && m.via !== 'Enquiries') (S.bots = S.bots || {})[m.author_id] = m.via;
      const botIcon = m.via === 'Enquiries' ? BOT_ICON[(S.current && bizSlug(S.current.business_id)) === 'hungrymoose' ? 'MooseHub' : 'Mothership'] : BOT_ICON[m.via];
      return `<div class="msg bot ${m.removed_at ? 'removed' : ''}${isSaved ? ' saved' : ''}${m.celebrate ? ' cele' : ''}${xc}" data-mid="${m.id}"><span class="avbtn"><div class="av botav"><img src="${botIcon || '/icons/icon-96.png'}" alt=""></div></span>
      <div style="flex:1;min-width:0"><div class="who"><b class="namebtn">${esc(m.via)}</b><span class="autotag">Automatic</span><small>${when(m.created_at)}</small>${rb.replace(/<button[^>]*data-edit[^>]*>.*?<\/button>/, '')}</div>
      ${mrTop}${quoteHtml(m)}<div class="body">${body}</div>${files}${mrEnd}${reactsHtml(m)}${repliedHtml(m)}</div></div>`;
    }
    return `<div class="msg ${m.removed_at ? 'removed' : ''}${isSaved ? ' saved' : ''}${m.celebrate ? ' cele' : ''}${xc}" data-mid="${m.id}"><button class="avbtn" type="button" data-quick="${m.author_id}" aria-label="About ${esc(nameOf(m.author_id))}">${avatar(m.author_id)}</button>
      <div style="flex:1;min-width:0"><div class="who"><button class="namebtn" type="button" data-quick="${m.author_id}">${esc(nameOf(m.author_id))}</button><small>${when(m.created_at)}${m.edited_at ? ' · edited' : ''}</small>${rb}</div>
      ${mrTop}${quoteHtml(m)}<div class="body">${body}</div>${files}${mrEnd}${reactsHtml(m)}${repliedHtml(m)}</div></div>`;
  }
  // "Gemma is typing…" — live only, never saved.
  function drawTyping() {
    const el = document.getElementById('typing'); if (!el) return;
    const now = Date.now();
    const who = Object.keys(S.typing || {}).filter((k) => now - S.typing[k] < 4000).map((k) => nameOf(k).split(' ')[0]);
    if (!who.length) { el.hidden = true; el.innerHTML = ''; return; }
    const txt = who.length === 1 ? `${who[0]} is typing` : who.length === 2 ? `${who[0]} and ${who[1]} are typing` : `${who.length} people are typing`;
    el.hidden = false; el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${esc(txt)}`;
  }
  function setEdit(id) {
    const ta = document.getElementById('text'); const bar = document.getElementById('replybar');
    if (!ta || !bar) return;
    S.replyTo = null; S.editing = id || null;
    if (!id) { if (S.setMr) S.setMr(false); bar.hidden = true; bar.innerHTML = ''; ta.value = (S.current && draftFor(S.current.id)) || ''; ta.style.height = 'auto'; if (ta.value) ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; return; }
    const m = S.messages.find((x) => x.id === id); if (!m) return;
    if (S.setMr) S.setMr(!!m.must_read);
    bar.hidden = false;
    bar.innerHTML = `<div class="rq"><b>Editing your message</b><span>${esc(snippet(m))}</span></div><button class="iconbtn" type="button" id="rx" aria-label="Cancel editing">✕</button>`;
    bar.querySelector('#rx').onclick = () => setEdit(null);
    ta.value = m.body || ''; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function setReply(id) {
    S.editing = null;
    S.replyTo = id;
    const bar = document.getElementById('replybar'); if (!bar) return;
    if (!id) { bar.hidden = true; bar.innerHTML = ''; return; }
    const q = findMsg(id);
    bar.hidden = false;
    bar.innerHTML = `<div class="rq"><b>Replying to ${esc(q ? nameOf(q.author_id) : '')}</b><span>${esc(snippet(q))}</span></div><button class="iconbtn" type="button" id="rx" aria-label="Cancel reply">✕</button>`;
    bar.querySelector('#rx').onclick = () => setReply(null);
    const ta = document.getElementById('text'); if (ta) ta.focus();
  }
  function drawMessages(scroll) {
    const box = document.getElementById('msgs'); if (!box) return;
    // remember which message is at the top of the screen, so a redraw does not move you
    let anchor = null;
    if (!scroll && !S.stick && box.scrollTop > 0) {
      const top = box.getBoundingClientRect().top;
      const el = [...box.querySelectorAll('[data-mid]')].find((x) => x.getBoundingClientRect().bottom > top + 1);
      if (el) anchor = { mid: el.dataset.mid, off: el.getBoundingClientRect().top - top, at: Date.now() };
    }
    // who has replied to each message (so you can see at a glance what's already been answered)
    S.replyMap = {};
    S.messages.forEach((x) => { if (x.parent_id && !x.removed_at) (S.replyMap[x.parent_id] = S.replyMap[x.parent_id] || []).push(x); });
    box.innerHTML = S.messages.length ? S.messages.map((m) => (m.id === S.unreadFrom ? '<div class="newline" id="newline"><span>New messages</span></div>' : '') + msgHtml(m)).join('') : (S.loadingChat ? '<div class="empty">Loading…</div>' : '<div class="empty">No messages yet. Say hello.</div>');
    const nl = S.jumpUnread && scroll && document.getElementById('newline');
    if (nl) { S.jumpUnread = false; S.stick = 'newline'; }
    else if (scroll) S.stick = 'bottom';
    const settle = () => {
      if (S.stick === 'bottom') box.scrollTop = box.scrollHeight;
      else if (S.stick === 'newline') { const n = document.getElementById('newline'); if (n) box.scrollTop = Math.max(0, n.offsetTop - 8); }
    };
    if (scroll) {
      settle();
      // stop pinning as soon as the person scrolls themselves
      const letGo = () => { S.stick = null; };
      ['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => box.addEventListener(ev, letGo, { once: true, passive: true }));
      clearTimeout(S.stickTimer); S.stickTimer = setTimeout(letGo, 8000);
    }
    const hold = () => {
      if (!anchor || S.stick || Date.now() - anchor.at > 4000) return;
      const el = box.querySelector(`[data-mid="${anchor.mid}"]`); if (!el) return;
      box.scrollTop += (el.getBoundingClientRect().top - box.getBoundingClientRect().top) - anchor.off;
    };
    if (anchor) {
      hold(); S.anchor = anchor;
      const drop = () => { if (S.anchor === anchor) anchor = null; };
      ['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => box.addEventListener(ev, drop, { once: true, passive: true }));
    }
    box.querySelectorAll('img').forEach((im) => { if (!im.complete) im.addEventListener('load', () => { if (S.stick) settle(); else hold(); }, { once: true }); });
    box.querySelectorAll('[data-reply]').forEach((b) => { b.onclick = () => setReply(Number(b.dataset.reply)); });
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => setEdit(Number(b.dataset.edit)); });
    if (!box._older) { box._older = true; box.addEventListener('scroll', () => { if (box.scrollTop < 300) loadOlder(); }, { passive: true }); }
    box.querySelectorAll('[data-vote]').forEach((b) => { b.onclick = () => castVote(Number(b.dataset.poll), Number(b.dataset.vote), Number(b.dataset.pm)); });
    box.querySelectorAll('[data-closevote]').forEach((b) => { b.onclick = () => closeVote(Number(b.dataset.closevote), Number(b.dataset.pm)); });
    box.querySelectorAll('[data-save]').forEach((b) => { b.onclick = () => toggleSave(Number(b.dataset.save)); });
    box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => confirmDelete(Number(b.dataset.del)); });
    box.querySelectorAll('[data-mrack]').forEach((b) => { b.onclick = () => ackMustRead(Number(b.dataset.mrack)); });
    box.querySelectorAll('[data-mrstat]').forEach((b) => { b.onclick = () => sheetMustReadStatus(Number(b.dataset.mrstat)); });
    box.querySelectorAll('[data-addreact]').forEach((b) => { b.onclick = (ev) => { ev.stopPropagation(); reactPicker(b.dataset.addreact, b); }; });
    box.querySelectorAll('[data-react]').forEach((b) => {
      b.onclick = () => { if (b._held) { b._held = false; return; } hideReactors(); toggleReact(b.dataset.react, b.dataset.emoji); };
      // who reacted: hover on a computer, press and hold on a phone
      b.onmouseenter = () => { clearTimeout(b._ht); b._ht = setTimeout(() => showReactors(b), 220); };
      b.onmouseleave = () => { clearTimeout(b._ht); hideReactors(); };
      b.addEventListener('touchstart', () => { b._held = false; clearTimeout(b._lp); b._lp = setTimeout(() => { b._held = true; showReactors(b); try { navigator.vibrate && navigator.vibrate(15); } catch (_) {} }, 420); }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(b._lp), { passive: true }));
      b.oncontextmenu = (e) => e.preventDefault();
    });
    box.querySelectorAll('[data-quick]').forEach((b) => { b.onclick = () => quickView(b.dataset.quick); });
    box.querySelectorAll('[data-jump]').forEach((b) => { b.onclick = () => {
      const t = box.querySelector(`[data-mid="${b.dataset.jump}"]`);
      if (!t) return toast('That message is further back in the chat');
      t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
    }; });
  }

  function viewConversation() {
    const c = S.current;
    const readOnly = c.observer || (c.kind === 'announcement' && !can('room_creator_min_rank'));
    const roText = c.observer
      ? `Viewing only${c.observeUntil ? ' until ' + new Date(c.observeUntil).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''} · staff can't see you here`
      : 'Announcements are read-only';
    const sub = c.kind === 'dm' ? 'Private chat' : c.kind === 'announcement' ? 'Announcements' : (c.description || (S.sites[c.site_id] ? S.sites[c.site_id].name : 'Room'));
    const manage = c.kind !== 'dm' && can('room_creator_min_rank');
    app.innerHTML = `
      <header class="conv"><button class="iconbtn back" id="back" aria-label="Back to chats">${icon.back}</button>
        <div class="t"><div class="n nm"><span class="tx${c.kind === 'dm' ? '' : bizClass(c)}">${c.kind === 'channel' ? '<span class="hash">#</span> ' : ''}${esc(c.name)}</span>${c.kind !== 'dm' ? roomChips(c) : ''}</div><div class="s">${esc(sub)}</div></div>
        ${manage ? `<button class="iconbtn" id="edit" aria-label="Rename or edit this room">${icon.pencil}</button>` : ''}
        <button class="iconbtn" id="who" aria-label="People in this chat">${icon.people}</button>
        ${S.roomApprover && c.kind !== 'dm' && !c.observer ? `<button class="iconbtn" id="leavegrp" aria-label="Leave this group" title="Leave this group">${icon.leave}</button>` : ''}</header>
      <div class="msgs" id="msgs"></div>
      ${readOnly ? `<div class="readonly">${icon.eye || ''}${esc(roText)}</div>` : `
      <div class="typing" id="typing" hidden aria-live="polite"></div>
      <div class="replybar" id="replybar" hidden></div>
      ${c.name === 'Contract_Requests' ? `<div class="tplrow" role="group" aria-label="Templates"><span>Templates:</span><button type="button" class="tplbtn" data-tpl="staff">+ New staff</button><button type="button" class="tplbtn" data-tpl="customer">+ New customer</button></div>` : ''}
      <form class="composer" id="send">
        <div class="ctools"><button class="iconbtn" type="button" id="attach" aria-label="${S.photoOk ? 'Add a photo or document' : 'Add a document'}">${icon.clip}</button>
        <input type="file" id="file" accept="${S.photoOk ? 'image/*,' : ''}${DOC_ACCEPT}" hidden>
        ${window.matchMedia('(pointer:fine)').matches ? `<button class="iconbtn" type="button" id="emo" aria-label="Add an emoji" title="Emoji"><span class="emox" aria-hidden="true">🙂</span></button>` : ''}
        <button class="iconbtn" type="button" id="mkvote" aria-label="Start a vote" title="Start a vote">${icon.vote}</button>
        <button class="iconbtn" type="button" id="mkshout" aria-label="Give someone a shout-out" title="Shout-out"><span class="shoutx" aria-hidden="true">⭐</span></button>
        ${can('must_read_min_rank') ? `<button class="iconbtn" type="button" id="mread" aria-pressed="false" aria-label="Must read: everyone has to tap I've read it" title="Must read"><span class="mreadx" aria-hidden="true">📌</span></button>` : ''}
        ${can('urgent_min_rank') ? `<button class="iconbtn" type="button" id="urg" aria-pressed="false" aria-label="Mark as urgent" title="Mark as urgent"><span class="urgx" aria-hidden="true">!</span></button><button class="iconbtn" type="button" id="cele" aria-pressed="false" aria-label="Celebrate: fireworks for everyone in this chat" title="Celebrate (fireworks)"><span class="celex" aria-hidden="true">🎉</span></button>` : ''}</div>
        <textarea id="text" rows="1" placeholder="${esc((() => { const t = 'Message ' + (c.kind === 'dm' ? c.name.split(' ')[0] : '#' + c.name); return t.length > 22 ? 'Message' : t; })())}" aria-label="Write a message" maxlength="8000"></textarea>
        <button class="iconbtn primary" type="submit" aria-label="Send">${icon.send}</button>
      </form>`}`;
    drawMessages(true); setReply(S.replyTo); drawOffline();
    document.getElementById('back').onclick = () => {
      const cur = S.channels.find((x) => x.id === c.id); if (cur) { cur.unread = 0; cur.urgent = false; cur.mentioned = false; cur.firstUnreadId = null; }
      S.tab = 'chats'; S.current = null; if (S.roomSub) { sb.removeChannel(S.roomSub); S.roomSub = null; }
      route(); drawUnread(); // instant: draw the home screen from what we already have
      if (isOffline()) return;
      sb.rpc('mark_read', { p_channel: c.id }).then(() => loadChannels()).then(() => { if ((S.tab === 'chats' || isWide()) && (!S.current || isWide()) && !document.querySelector('.sheet-back')) { const q = document.getElementById('q'); viewHome(q ? q.value : ''); } });
    };
    document.getElementById('who').onclick = () => sheetPeople(c, manage);
    const lg = document.getElementById('leavegrp'); if (lg) lg.onclick = () => sheetLeave(c);
    const eb = document.getElementById('edit'); if (eb) eb.onclick = () => sheetRoomSettings(c);
    app.querySelectorAll('[data-tpl]').forEach((b) => { b.onclick = () => {
      const ta = document.getElementById('text'); if (!ta) return;
      const hm = (S.businesses[c.business_id] || {}).slug === 'hungrymoose' || /hungry/i.test((S.businesses[c.business_id] || {}).name || '');
      ta.value = b.dataset.tpl === 'staff'
        ? 'NEW STAFF: \nSTART DATE: \nSITENAME: \nJOB TITLE: '
        : `NEW CUSTOMER: \n${hm ? 'BUSINESS NAME' : 'PARENT NAME'}: \nSTART DATE: \nSITENAME: `;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.focus(); const end = ta.value.indexOf('\n'); ta.setSelectionRange(end, end); // cursor ready after the first label
    }; });
    const form = document.getElementById('send');
    if (form) {
      const ta = document.getElementById('text');
      let lastTyping = 0;
      const saved = draftFor(c.id);
      if (saved && !ta.value) { ta.value = saved; requestAnimationFrame(() => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }); }
      ta.oninput = () => {
        ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
        if (!S.editing) setDraft(c.id, ta.value); // keep it if they wander off to another chat
        const now = Date.now();
        if (ta.value.trim() && now - lastTyping > 2500 && S.roomSub) { lastTyping = now; S.roomSub.send({ type: 'broadcast', event: 'typing', payload: { m: S.me.id } }); }
      };
      // @ tagging: type @ and pick someone in this chat; they get an alert and the message is highlighted for them
      const mbox = document.createElement('div'); mbox.className = 'mentionbox'; mbox.hidden = true; mbox.setAttribute('role', 'listbox');
      form.style.position = 'relative'; form.appendChild(mbox);
      let mList = [], mIdx = 0, mStart = -1;
      const firstName = (p) => p.full_name.split(' ')[0]; // same rule the server uses to spot a tag
      const tagFor = (p) => { // first name, unless two people in the chat share it
        const fn = firstName(p);
        const clash = (S.roomPeople || []).filter((id) => S.people[id] && id !== p.id && firstName(S.people[id]).toLowerCase() === fn.toLowerCase()).length;
        return clash ? p.full_name : fn;
      };
      const closeM = () => { mbox.hidden = true; mList = []; mStart = -1; };
      const drawM = () => {
        mbox.innerHTML = mList.map((p, i) => `<button type="button" class="mopt${i === mIdx ? ' on' : ''}" data-mi="${i}" role="option">${avatar(p.id)}<span><b>${esc(p.display_name || p.full_name)}</b><small>${esc(posOf(p.id))}</small></span></button>`).join('');
        mbox.hidden = !mList.length;
        mbox.querySelectorAll('[data-mi]').forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); pickM(Number(b.dataset.mi)); }; });
      };
      const pickM = (i) => {
        const p = mList[i]; if (!p) return;
        const pos = ta.selectionStart, ins = '@' + tagFor(p) + ' ';
        ta.value = ta.value.slice(0, mStart) + ins + ta.value.slice(pos);
        const c = mStart + ins.length; ta.setSelectionRange(c, c); closeM(); ta.focus();
        ta.dispatchEvent(new Event('input'));
      };
      ta.addEventListener('input', () => {
        const pos = ta.selectionStart, before = ta.value.slice(0, pos);
        const m = before.match(/(^|\s)@([A-Za-z'\-]{0,20})$/);
        if (!m) return closeM();
        mStart = pos - m[2].length - 1;
        const q = m[2].toLowerCase();
        mList = (S.roomPeople || []).filter((id) => id !== S.me.id && S.people[id]).map((id) => S.people[id])
          .filter((p) => !q || (p.display_name || p.full_name).toLowerCase().split(' ').some((w) => w.startsWith(q)) || p.full_name.toLowerCase().startsWith(q))
          .sort((a, b) => (a.display_name || a.full_name).localeCompare(b.display_name || b.full_name)).slice(0, 8);
        mIdx = 0; drawM();
      });
      ta.addEventListener('blur', () => setTimeout(closeM, 150));
      ta.onkeydown = (e) => {
        if (!mbox.hidden && mList.length) {
          if (e.key === 'ArrowDown') { e.preventDefault(); mIdx = (mIdx + 1) % mList.length; return drawM(); }
          if (e.key === 'ArrowUp') { e.preventDefault(); mIdx = (mIdx - 1 + mList.length) % mList.length; return drawM(); }
          if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickM(mIdx); }
          if (e.key === 'Escape') { e.preventDefault(); return closeM(); }
        }
        if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); form.requestSubmit(); }
      };
      const vb = document.getElementById('mkvote'); if (vb) vb.onclick = () => sheetVote(c);
      const sob = document.getElementById('mkshout'); if (sob) sob.onclick = () => sheetShout(c);
      let mustRead = false;
      const mrb = document.getElementById('mread');
      const setMr = (v) => { mustRead = v; if (mrb) { mrb.setAttribute('aria-pressed', String(v)); mrb.classList.toggle('on', v); } };
      S.setMr = setMr; S.getMr = () => (mrb ? mustRead : null);
      if (mrb) mrb.onclick = () => { setMr(!mustRead); if (mustRead) toast('Must read: it stays on everyone’s screen until they tap “I’ve read it”. You can see who has.'); };
      requestAnimationFrame(() => { const t = form.querySelector('.ctools'); if (t && t.offsetWidth) document.getElementById('app').style.setProperty('--ctw', t.offsetWidth + 'px'); });
      let urgent = false;
      const ub = document.getElementById('urg');
      let celebrate = false;
      const cb = document.getElementById('cele');
      const setUrg = (v) => { urgent = v; if (ub) { ub.setAttribute('aria-pressed', String(v)); ub.classList.toggle('on', v); } };
      const setCele = (v) => { celebrate = v; if (cb) { cb.setAttribute('aria-pressed', String(v)); cb.classList.toggle('on', v); } };
      if (ub) ub.onclick = () => { setUrg(!urgent); if (urgent) { setCele(false); toast('Urgent: everyone in this chat gets a full-screen emergency alert'); } };
      if (cb) cb.onclick = () => { setCele(!celebrate); if (celebrate) { setUrg(false); toast('Celebrate: fireworks and confetti for everyone in this chat'); } };
      const mentionsIn = (text) => (S.roomPeople || []).filter((id) => {
        const p = S.people[id]; if (!p || id === S.me.id) return false;
        const t = text.toLowerCase();
        return t.includes('@' + p.full_name.toLowerCase()) || t.includes('@' + p.full_name.split(' ')[0].toLowerCase());
      });
      async function send(body, file) {
        if (file && file.type.startsWith('image/') && !S.photoOk) { toast('At MonkeyMoos, photos can only be shared by deputy managers and above. You can still send documents.'); return false; }
        const row = { channel_id: c.id, author_id: S.me.id, body, mentions: mentionsIn(body) };
        if (urgent) row.urgent = true;
        if (celebrate) row.celebrate = true;
        if (mustRead) row.must_read = true;
        if (S.replyTo) row.parent_id = S.replyTo;
        const { data, error } = await sb.from('messages').insert(row).select('id').single();
        if (error) { toast(error.message || 'Message not sent'); return false; }
        if (file) {
          file = await shrinkImage(file);
          const path = `${c.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`;
          const up = await sb.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
          if (up.error) { toast('The file could not be uploaded (photos, PDFs and office documents up to 15 MB)', true); return false; }
          const ins = await sb.from('attachments').insert({ message_id: data.id, storage_path: path, file_name: file.name, mime_type: file.type, bytes: file.size, width: file._w || null, height: file._h || null });
          if (ins.error) toast('The picture uploaded but could not be attached: ' + ins.error.message);
          else if (S.roomSub) S.roomSub.send({ type: 'broadcast', event: 'files', payload: { mid: data.id } });
          await loadFiles([data.id]); drawMessages(true);
        }
        // show the sender what everyone else in the chat now sees
        if (celebrate) { markFxSeen(data.id); fxFireworks({ id: data.id, channel_id: c.id, author_id: S.me.id, body, mine: true }, null, null); }
        if (urgent) { markFxSeen(data.id); fxEmergency({ id: data.id, channel_id: c.id, author_id: S.me.id, body, mine: true }, () => {}, null); }
        if (urgent) setUrg(false);
        if (celebrate) setCele(false);
        if (mustRead) { setMr(false); toast('Must-read sent. Tap “Read by” under it to see who has read it.'); }
        setReply(null);
        return true;
      }
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        if (navigator.onLine === false) return toast('No connection right now. Your message is still in the box: send it when you’re back online.');
        if (S.editing) {
          const id = S.editing;
          const mr = S.getMr ? S.getMr() : null;
          const m = S.messages.find((x) => x.id === id);
          const { error } = await sb.rpc('edit_message', { p_message: id, p_body: body, p_must_read: mr });
          if (error) return toast(error.message.replace(/^BrainStorm rule: /, ''));
          const madeMr = m && mr && !m.must_read;
          if (m) { m.body = body; m.edited_at = new Date().toISOString(); m.must_read = !!mr; }
          setEdit(null);
          if (m && m.must_read) await loadMustRead([m]);
          drawMessages(false);
          if (madeMr) toast('Now a must-read. Tap “Read by” under it to see who has read it.');
          return;
        }
        ta.value = ''; ta.style.height = 'auto'; setDraft(c.id, '');
        if (!(await send(body))) { ta.value = body; setDraft(c.id, body); }
      };
      const fi = document.getElementById('file');
      document.getElementById('attach').onclick = () => fi.click();
      const emo = document.getElementById('emo');
      if (emo) { emo.onmousedown = (ev) => ev.preventDefault(); emo.onclick = () => { if (document.querySelector('.epick')) { document.querySelectorAll('.epick').forEach((x) => x.remove()); return; } emojiPicker(emo, ta); }; }
      fi.onchange = async () => {
        let f = fi.files[0]; fi.value = ''; if (!f) return;
        if (f.size > 15728640) return toast('That file is over 15 MB', true);
        if (!f.type.startsWith('image/')) { f = asDoc(f); if (!f) return toast('That type of file can’t be sent. Try a PDF, Word, Excel, PowerPoint, Pages, Numbers or Keynote file.', true); }
        const caption = ta.value.trim() || f.name; ta.value = ''; setDraft(c.id, '');
        toast('Uploading…');
        await send(caption, f);
      };
      // Pasting a picture copied from another app (Photos, a screenshot, WhatsApp, a web page…)
      const pastedFile = (blob) => {
        const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        return new File([blob], `pasted-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`, { type: blob.type });
      };
      const confirmPaste = (f) => {
        if (f.type.startsWith('image/') && !S.photoOk) return toast('At MonkeyMoos, photos can only be shared by deputy managers and above.');
        if (f.size > 15728640) return toast('That picture is over 15 MB', true);
        const isImg = f.type.startsWith('image/');
        const url = URL.createObjectURL(f);
        const sh = sheet(`<h2>Send this ${isImg ? 'picture' : 'file'}?</h2>${isImg ? `<img src="${url}" alt="Picture to send" style="display:block;max-width:100%;max-height:50vh;margin:8px auto 12px;border-radius:12px">` : `<p class="filecard" style="margin:8px 0 12px"><span class="ft">${docLabel(f)}</span><span><b>${esc(f.name)}</b><small>${Math.max(1, Math.round(f.size / 1024))} KB</small></span></p>`}
          <label class="field">Caption (optional)<input class="input" id="pcap" value="${esc(ta.value.trim())}" maxlength="500"></label>
          <div class="actions"><button class="btn ghost" id="pno">Cancel</button><button class="btn" id="pyes">Send ${isImg ? 'picture' : 'file'}</button></div>`);
        const close = () => { URL.revokeObjectURL(url); sh.remove(); };
        sh.querySelector('#pno').onclick = close;
        sh.querySelector('#pyes').onclick = async () => {
          if (navigator.onLine === false) return toast('No connection right now. Try again when you’re back online.');
          const cap = sh.querySelector('#pcap').value.trim() || (isImg ? 'Picture' : f.name);
          close(); ta.value = ''; setDraft(c.id, ''); toast('Uploading…');
          await send(cap, f);
        };
      };
      // Dragging a screenshot, photo or PDF onto the chat (computers and tablets)
      const dropOk = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
      mainEl.ondragover = (e) => { if (!dropOk(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; mainEl.classList.add('dropping'); };
      mainEl.ondragleave = (e) => { if (!mainEl.contains(e.relatedTarget)) mainEl.classList.remove('dropping'); };
      mainEl.ondrop = (e) => {
        mainEl.classList.remove('dropping');
        if (!dropOk(e)) return; e.preventDefault();
        const raw = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/') || asDoc(x));
        if (!raw) return toast('Only pictures, PDFs and Word, Excel, PowerPoint, Pages, Numbers or Keynote files can be sent.');
        const f = raw.type.startsWith('image/') ? raw : asDoc(raw);
        if (!S.current || S.current.id !== c.id || !document.getElementById('text')) return;
        confirmPaste(f.type.startsWith('image/') ? pastedFile(f) : f);
      };
      ta.addEventListener('paste', async (e) => {
        const cd = e.clipboardData;
        let img = null;
        if (cd) {
          for (const it of cd.items || []) { if (it.kind === 'file' && it.type.startsWith('image/')) { img = it.getAsFile(); break; } }
          if (!img) for (const f of cd.files || []) { if (f.type.startsWith('image/')) { img = f; break; } }
        }
        if (img) { e.preventDefault(); return confirmPaste(pastedFile(img)); }
        // Some phones hand over the picture only through the clipboard reader, not the paste itself
        const hasText = cd && cd.getData && cd.getData('text/plain');
        if (!hasText && navigator.clipboard && navigator.clipboard.read) {
          try {
            for (const ci of await navigator.clipboard.read()) {
              const t = ci.types.find((x) => x.startsWith('image/'));
              if (t) { e.preventDefault(); return confirmPaste(pastedFile(await ci.getType(t))); }
            }
          } catch (_) { /* no permission or nothing there */ }
        }
      });
    }
  }

  // ---------- sheets ----------
  function sheet(html) {
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    back.onclick = (e) => { if (e.target === back) back.remove(); };
    document.body.appendChild(back);
    return back;
  }
  function personRow(p, type, why) {
    const site = S.sites[p.site_id] ? S.sites[p.site_id].name : (S.businesses[p.business_id] ? S.businesses[p.business_id].name : 'All businesses');
    const off = !!why;
    return `<label class="pick${why ? ' blocked' : ''}"${why ? ` title="${esc(why)}"` : ''}><input type="${type}" name="p" value="${p.id}"${off ? ' disabled' : ''}>${avatar(p.id)}
      <div><div style="font-weight:700" class="${notJoined(p.id) ? 'nj' : ''}">${esc(p.display_name || p.full_name)}</div><div class="meta">${esc(S.roles[p.role_code] ? S.roles[p.role_code].label : '')} · ${esc(site)}${notJoined(p.id) ? ' · <span class="njt">Not joined yet</span>' : ''}${why ? `<br><span class="why">${esc(why)}</span>` : ''}</div></div></label>`;
  }
  function peopleOptions(type, exclude = [], blocked = {}) {
    return Object.values(S.people).filter((p) => p.id !== S.me.id && !exclude.includes(p.id))
      .sort((a, b) => (blocked[a.id] ? 1 : 0) - (blocked[b.id] ? 1 : 0) || a.full_name.localeCompare(b.full_name)).map((p) => personRow(p, type, blocked[p.id])).join('');
  }

  function sheetNew() {
    const dm = can('private_chat_min_rank'), room = can('room_creator_min_rank'), add = can('access_approver_min_rank') || S.me.can_approve;
    const s = sheet(`<h2>Start something</h2>
      ${dm ? '<button class="btn" id="nDm" style="width:100%;margin-bottom:10px">New private chat</button>' : ''}
      ${room ? '<button class="btn ghost" id="nRoom" style="width:100%;margin-bottom:10px">New room</button>' : ''}
      ${add ? '<button class="btn ghost" id="nPerson" style="width:100%">Add a new starter</button>' : ''}`);
    if (dm) s.querySelector('#nDm').onclick = () => { s.remove(); sheetDm(); };
    if (room) s.querySelector('#nRoom').onclick = () => { s.remove(); sheetRoom(); };
    if (add) s.querySelector('#nPerson').onclick = () => { s.remove(); sheetAddPerson(); };
  }


  // ---- email typo guard: compares the address with the person's name and our domains ----
  const OUR_DOMAINS = ['monkeymoos.co.uk', 'hungrymoose.co.uk'];
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // Returns { suggest, reason } when the address looks mistyped, otherwise null.
  function emailTypo(name, email, preferredDomain) {
    const m = /^([^@\s]+)@([^@\s]+\.[^@\s]+)$/.exec(email); if (!m) return { suggest: null, reason: 'That does not look like an email address.' };
    let [, local, domain] = m; let reasons = [];
    const COMMON = ['gmail.com', 'icloud.com', 'me.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'yahoo.com', 'yahoo.co.uk', 'live.co.uk', 'btinternet.com', 'googlemail.com'];
    if (!OUR_DOMAINS.includes(domain) && !COMMON.includes(domain)) {
      const near = [...OUR_DOMAINS, ...COMMON].map((d) => [d, lev(d, domain)]).sort((a, b) => a[1] - b[1])[0];
      const limit = OUR_DOMAINS.includes(near[0]) ? 4 : 2;
      if (near[1] <= limit) { reasons.push(`the ending "@${domain}" looks like a typo of "@${near[0]}"`); domain = near[0]; }
      else if (name) reasons.push(`"@${domain}" is not a MonkeyMoos or HungryMoose address`);
    } else if (COMMON.includes(domain) && name) reasons.push(`"@${domain}" is a personal address, not a MonkeyMoos or HungryMoose one`);
    const parts = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z\s-]/g, '').split(/[\s-]+/).filter(Boolean);
    if (parts.length) {
      const f = parts[0], l = parts[parts.length - 1];
      const cands = [...new Set([f, `${f}.${l}`, `${f}${l}`, `${f[0]}${l}`, `${f[0]}.${l}`, `${f}_${l}`, `${f}${l[0]}`, `${f}.${l[0]}`, l])];
      if (!cands.includes(local)) {
        const best = cands.map((c) => [c, lev(c, local)]).sort((a, b) => a[1] - b[1])[0];
        if (best[1] > 0 && best[1] <= 2) { reasons.push(`"${local}" looks like a typo of "${best[0]}"`); local = best[0]; }
      }
    }
    if (!reasons.length) return null;
    const suggest = `${local}@${domain}`;
    return { suggest: suggest !== email ? suggest : null, reason: reasons.join(' and ') };
  }
  function confirmEmail(name, email) {
    const t = emailTypo(name, email);
    if (!t) return Promise.resolve(email);
    return new Promise((resolve) => {
      const c = sheet(`<h2>Check that email</h2>
        <p class="note" style="text-align:left">${esc(t.reason.charAt(0).toUpperCase() + t.reason.slice(1))}.</p>
        <div class="kvs" style="padding:12px 14px"><div class="kv"><span>You typed</span><b>${esc(email)}</b></div>${t.suggest ? `<div class="kv"><span>Did you mean</span><b style="color:var(--cyan)">${esc(t.suggest)}</b></div>` : ''}</div>
        <div class="actions">${t.suggest ? `<button class="btn" id="use">Use ${esc(t.suggest)}</button>` : ''}<button class="btn ghost" id="keep">Keep what I typed</button><button class="btn ghost" id="back">Go back</button></div>`);
      if (t.suggest) c.querySelector('#use').onclick = () => { c.remove(); resolve(t.suggest); };
      c.querySelector('#keep').onclick = () => { c.remove(); resolve(email); };
      c.querySelector('#back').onclick = () => { c.remove(); resolve(null); };
    });
  }

  async function sendInvite(email) {
    try {
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + S.session.access_token },
        body: JSON.stringify({ action: 'invite', email })
      });
      return res.ok;
    } catch (_) { return false; }
  }
  // Approvers add a new starter: creates their access and sign-in in one go.
  function sheetAddPerson() {
    const biz = Object.values(S.businesses).filter((b) => b.slug === 'hungrymoose' || b.slug === 'monkeymoos');
    const bySlug = (sl) => biz.find((b) => b.slug === sl);
    const roles = Object.values(S.roles).filter((r) => r.rank <= myRank()).sort((a, b) => a.rank - b.rank);
    const defRole = (roles.find((r) => r.code === 'staff') || roles[0] || {}).code;
    const s = sheet(`<h2>Add a new starter</h2><form id="f">
      <label class="field">Full name<input class="input" id="pn" required maxlength="80" autocomplete="off"></label>
      <label class="field" style="margin-top:10px">Work email<input class="input" id="pe" type="email" required maxlength="200" autocomplete="off" placeholder="name@monkeymoos.co.uk"></label>
      <div class="section s-room" style="padding-left:0">Works for</div>
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="org" value="monkeymoos" checked><span>MonkeyMoos</span></label>
        <label><input type="radio" name="org" value="hungrymoose"><span>HungryMoose</span></label>
        <label><input type="radio" name="org" value="both"><span>Both</span></label>
      </div>
      <label class="field" style="margin-top:10px">Site<select class="input" id="ps"></select></label>
      <label class="field" style="margin-top:10px">Access level<select class="input" id="pr">${roles.map((r) => `<option value="${esc(r.code)}"${r.code === defRole ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
      <label class="field" style="margin-top:10px">Job title (optional)<input class="input" id="pj" maxlength="80" placeholder="e.g. Nursery Practitioner"></label>
      <label class="field" style="margin-top:10px">Department (optional)<input class="input" id="pd" maxlength="80"></label>
      <div class="actions"><button type="button" class="btn ghost" id="x">Cancel</button><button class="btn" type="submit">Add and give access</button></div></form>`);
    const siteSel = s.querySelector('#ps');
    const fillSites = () => {
      const org = s.querySelector('input[name=org]:checked').value;
      const ids = org === 'both' ? biz.map((b) => b.id) : [bySlug(org) && bySlug(org).id];
      siteSel.innerHTML = '<option value="">No particular site</option>' + Object.values(S.sites).filter((x) => ids.includes(x.business_id))
        .sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
      const pe = s.querySelector('#pe'); pe.placeholder = 'name@' + (org === 'hungrymoose' ? 'hungrymoose' : 'monkeymoos') + '.co.uk';
    };
    s.querySelectorAll('input[name=org]').forEach((r) => { r.onchange = fillSites; }); fillSites();
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const btn = s.querySelector('button[type=submit]'); btn.disabled = true;
      const org = s.querySelector('input[name=org]:checked').value;
      const site = siteSel.value || null;
      let main = org === 'both' ? 'monkeymoos' : org;
      if (org === 'both' && site && S.sites[site] && bySlug('hungrymoose') && S.sites[site].business_id === bySlug('hungrymoose').id) main = 'hungrymoose';
      const other = org === 'both' ? (main === 'monkeymoos' ? 'hungrymoose' : 'monkeymoos') : null;
      const name = s.querySelector('#pn').value.trim();
      const email = await confirmEmail(name, s.querySelector('#pe').value.trim().toLowerCase());
      if (!email) { btn.disabled = false; s.querySelector('#pe').focus(); return; }
      s.querySelector('#pe').value = email;
      const { data: reqId, error } = await sb.rpc('add_person', {
        p_full_name: name, p_email: email, p_business: bySlug(main).id, p_role: s.querySelector('#pr').value,
        p_site: site, p_job_title: s.querySelector('#pj').value, p_department: s.querySelector('#pd').value,
        p_also_business: other ? bySlug(other).id : null
      });
      if (error) { btn.disabled = false; return toast(error.message); }
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/decide-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + S.session.access_token },
        body: JSON.stringify({ request_id: reqId, approve: true })
      });
      const out = await res.json().catch(() => ({}));
      btn.disabled = false;
      if (!res.ok) return toast(out.error || 'Saved as a request, but approval did not finish. Check Requests.');
      s.remove();
      const people = await sb.from('members').select('id,full_name,display_name,role_code,site_id,business_id,status,avatar_url,avatar_ring').eq('status', 'active');
      (people.data || []).forEach((p) => { S.people[p.id] = p; });
      await Promise.all([signAvatars(), loadPhones()]);
      await loadDirectory();
      let sent = false;
      const mem = out.member_id ? { id: out.member_id } : null;
      if (mem) { const q = await sb.rpc('queue_invite', { p_member: mem.id, p_email: email }); if (!q.error) { const r = await signinCall({ action: 'drain' }); sent = r.ok && r.data.sent > 0; } }
      const done = sheet(`<h2>${esc(name.split(' ')[0])} is in</h2>
        <p class="note" style="text-align:left">${sent ? `A welcome email is on its way to <b>${esc(email)}</b>. You can also send them this:` : 'The welcome email could not be sent right now, so send them this instead:'}</p>
        <div class="kvs" style="padding:12px 14px;font-size:14px;line-height:1.5" id="msgtxt">Hi ${esc(name.split(' ')[0])}, welcome! Our team chat is BrainStorm. Open https://brainstorm.braincandystudio.co.uk on your phone, type ${esc(email)} and you'll get a 6-digit code by email. Then tap Share › Add to Home Screen to keep it as an app.</div>
        <div class="actions"><button class="btn ghost" id="cp">Copy message</button><button class="btn" id="ok">Done</button></div>`);
      done.querySelector('#ok').onclick = () => { done.remove(); route(); };
      done.querySelector('#cp').onclick = async () => {
        try { await navigator.clipboard.writeText(done.querySelector('#msgtxt').textContent); toast('Copied'); } catch (_) { toast('Press and hold the text to copy it'); }
      };
    };
  }

  function sheetDm() {
    const s = sheet(`<h2>Private chat with…</h2><form id="f">${peopleOptions('radio')}
      <div class="actions"><button type="button" class="btn ghost" id="x">Cancel</button><button class="btn" type="submit">Start</button></div></form>`);
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const picked = s.querySelector('input[name=p]:checked'); if (!picked) return toast('Pick a person');
      const { data, error } = await sb.rpc('start_direct_message', { p_other: picked.value });
      if (error) return toast(error.message);
      s.remove(); await loadChannels(); openChannel(data);
    };
  }

  function sheetRoom() {
    const s = sheet(`<h2>New room</h2><form id="f">
      <label class="field">Room name<input class="input" id="rn" required maxlength="60" placeholder="e.g. Winklebury_Team"></label>
      <div class="section s-room" style="padding-left:0">For</div>
      <div class="seg" role="radiogroup">
        <label><input type="radio" name="rb" value="monkeymoos"${(S.businesses[S.me.business_id] || {}).slug !== 'hungrymoose' ? ' checked' : ''}><span>MonkeyMoos</span></label>
        <label><input type="radio" name="rb" value="hungrymoose"${(S.businesses[S.me.business_id] || {}).slug === 'hungrymoose' ? ' checked' : ''}><span>HungryMoose</span></label>
        <label><input type="radio" name="rb" value="both"><span>Both</span></label>
      </div>
      <label class="field" style="margin-top:10px">What it's for (optional)<input class="input" id="rd" maxlength="140"></label>
      <label class="pick" style="margin-top:6px"><input type="checkbox" id="ann"><div><div style="font-weight:700">Announcements only</div><div class="meta">Only managers and above can post</div></div></label>
      <div class="section s-room">Add people</div>
      <label class="pick" style="cursor:default"><input type="checkbox" checked disabled aria-label="You are always in rooms you create">${avatar(S.me.id)}
        <div><div style="font-weight:700">${esc(S.me.display_name || S.me.full_name)} <span class="meta">(you)</span></div><div class="meta">${esc(S.roles[S.me.role_code] ? S.roles[S.me.role_code].label : '')} · always in rooms you create, as room admin</div></div></label>
      ${peopleOptions('checkbox')}
      ${myRank() < ((S.rules.owner_rank) ?? 90) ? '<p class="note" style="text-align:left">⏳ Groups you create close automatically if nobody posts in them for 30 days. Everyone gets a reminder 3 days before.</p>' : ''}
      <div class="actions"><button type="button" class="btn ghost" id="x">Cancel</button><button class="btn" type="submit">Create room</button></div></form>`);
    const roomBiz = () => { const v = s.querySelector('input[name=rb]:checked').value; const b = Object.values(S.businesses).find((x) => x.slug === v); return b ? b.id : null; };
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const ids = [...s.querySelectorAll('input[name=p]:checked')].map((i) => i.value);
      const { data, error } = await sb.rpc('create_room', {
        p_name: s.querySelector('#rn').value.trim().replace(/\s+/g, '_'),
        p_description: s.querySelector('#rd').value.trim() || null,
        p_business: roomBiz(), p_site: (S.sites[S.me.site_id] && S.sites[S.me.site_id].business_id === roomBiz()) ? S.me.site_id : null, p_members: ids,
        p_announcement: s.querySelector('#ann').checked
      });
      if (error) return toast(error.message);
      s.remove(); await loadChannels(); openChannel(data);
    };
  }


  // Rename a room, change what it is for, or which business it belongs to (room admin or senior management).
  function sheetRoomSettings(c) {
    const cur = (S.businesses[c.business_id] || {}).slug || 'both';
    const opt = (v, l) => `<label><input type="radio" name="eb" value="${v}"${cur === v ? ' checked' : ''}><span>${l}</span></label>`;
    const s = sheet(`<h2>Edit room</h2><form id="f">
      <label class="field">Room name<input class="input" id="en" required maxlength="60" value="${esc(c.name)}"></label>
      <label class="field" style="margin-top:10px">What it's for (optional)<input class="input" id="ed" maxlength="140" value="${esc(c.description || '')}"></label>
      <div class="section s-room" style="padding-left:0">For</div>
      <div class="seg" role="radiogroup">${opt('monkeymoos', 'MonkeyMoos')}${opt('hungrymoose', 'HungryMoose')}${opt('both', 'Both')}</div>
      <div id="keepbox"></div>
      <div class="actions"><button type="button" class="btn ghost" id="x">Cancel</button><button class="btn" type="submit">Save</button></div></form>`);
    s.querySelector('#x').onclick = () => s.remove();
    // groups made by managers close after 30 days unused; the owner can keep one for good
    sb.from('channels').select('auto_close').eq('id', c.id).maybeSingle().then(({ data }) => {
      const kb = s.querySelector('#keepbox'); if (!kb || !data) return;
      const owner = amAdmin() || myRank() >= ((S.rules.owner_rank) ?? 90);
      if (owner) {
        kb.innerHTML = `<label class="pick" style="margin-top:8px"><input type="checkbox" id="keep"${data.auto_close ? '' : ' checked'}><div><div style="font-weight:700">Keep this group for good</div><div class="meta">Untick to close it automatically after 30 days with no messages</div></div></label>`;
        const k = kb.querySelector('#keep');
        k.onchange = async () => { const { error } = await sb.rpc('keep_room', { p_channel: c.id, p_keep: k.checked }); if (error) { k.checked = !k.checked; return toast(error.message); } toast(k.checked ? 'This group will be kept for good' : 'This group will close after 30 days unused'); };
      } else if (data.auto_close) kb.innerHTML = '<p class="note" style="text-align:left">⏳ This group closes automatically after 30 days with no messages.</p>';
    });
    s.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const v = s.querySelector('input[name=eb]:checked').value;
      const b = Object.values(S.businesses).find((x) => x.slug === v);
      const name = s.querySelector('#en').value.trim().replace(/\s+/g, '_');
      const { error } = await sb.rpc('update_room', { p_channel: c.id, p_name: name, p_description: s.querySelector('#ed').value, p_business: b ? b.id : null, p_set_business: true });
      if (error) return toast(error.message);
      s.remove(); toast('Room updated');
      await loadChannels(); const fresh = S.channels.find((x) => x.id === c.id); if (fresh) { S.current = fresh; viewConversation(); }
    };
  }

  // Leave a group quietly (no message to the group); rejoin from Requests > All groups.
  async function leaveGroup(c) {
    const { error } = await sb.rpc('remove_from_room', { p_channel: c.id, p_member: S.me.id });
    if (error) { toast(error.message); return false; }
    toast(`You left ${c.name}`);
    S.tab = 'chats'; S.current = null; if (S.roomSub) { sb.removeChannel(S.roomSub); S.roomSub = null; }
    await loadChannels(); route();
    return true;
  }
  function sheetLeave(c) {
    const s = sheet(`<h2>Leave ${c.kind === 'channel' ? '#' : ''}${esc(c.name)}?</h2>
      <p class="note" style="text-align:left">You'll stop getting its messages and alerts, and it disappears from your chat list. Nobody in the group is told. You can join it again any time from Requests › All groups and who is in them.</p>
      <div class="actions"><button class="btn ghost" id="x">Stay</button><button class="btn danger" id="go">Leave group</button></div>`);
    s.querySelector('#x').onclick = () => s.remove();
    const go = s.querySelector('#go');
    go.onclick = async () => { go.disabled = true; if (await leaveGroup(c)) s.remove(); else go.disabled = false; };
  }

  async function sheetPeople(c, manage, onClose) {
    const [{ data }, el] = await Promise.all([
      sb.from('channel_members').select('member_id').eq('channel_id', c.id).is('removed_at', null),
      manage ? sb.rpc('room_eligibility', { p_channel: c.id }) : Promise.resolve({ data: [] })
    ]);
    const ids = (data || []).map((r) => r.member_id);
    const blocked = {}; (el.data || []).forEach((r) => { blocked[r.member_id] = r.reason; });
    const nj = ids.filter(notJoined).length;
    const s = sheet(`<h2>People here (${ids.length})</h2>${nj ? `<p class="note">${nj} of ${ids.length} <span class="njt">not joined yet</span></p>` : ''}
      ${ids.map((id) => S.people[id] ? `<div class="pick" style="cursor:default">${avatar(id)}<div style="flex:1"><b class="${notJoined(id) ? 'nj' : ''}">${esc(nameOf(id))}</b><div class="meta">${esc(S.roles[S.people[id].role_code] ? S.roles[S.people[id].role_code].label : '')}${notJoined(id) ? ' · <span class="njt">Not joined yet</span>' : ''}</div></div>
        ${manage && id !== S.me.id ? `${c.kind === 'channel' ? `<button class="btn ghost small" data-mv="${id}" title="Take them out of this group and put them in another one">Move to…</button>` : ''}<button class="btn ghost small" data-rm="${id}">Remove</button>` : ''}</div>` : '').join('')}
      ${manage ? `<div class="section s-room">Add people</div>${Object.values(S.people).some((p) => p.id !== S.me.id && !ids.includes(p.id) && !blocked[p.id]) ? '' : '<p class="note">Everyone who is allowed in this group is already in it.</p>'}<form id="add">${peopleOptions('checkbox', ids, blocked)}<div class="actions"><button class="btn" type="submit">Add selected</button></div></form>` : ''}
      <div class="actions">${S.roomApprover && c.kind !== 'dm' && ids.includes(S.me.id) ? '<button class="btn danger" id="leave">Leave this group</button>' : ''}${S.roomApprover && c.kind !== 'dm' && !ids.includes(S.me.id) ? '<button class="btn" id="rejoin">Join this group</button>' : ''}<button class="btn ghost" id="x">Close</button></div>`);
    s.querySelector('#x').onclick = () => { s.remove(); if (onClose) onClose(); };
    const lv = s.querySelector('#leave');
    if (lv) lv.onclick = async () => {
      if (lv.dataset.sure !== '1') { lv.dataset.sure = '1'; lv.textContent = 'Tap again to leave'; return; }
      if (await leaveGroup(c)) s.remove();
    };
    const rj = s.querySelector('#rejoin');
    if (rj) rj.onclick = async () => {
      const { error } = await sb.rpc('add_to_room', { p_channel: c.id, p_member: S.me.id });
      if (error) return toast(error.message.replace(/^BrainStorm rule: /, ''));
      s.remove(); toast(`You're back in ${c.name}`);
      await loadChannels(); if (onClose) onClose(); else route();
    };
    s.querySelectorAll('[data-mv]').forEach((b) => {
      b.onclick = () => sheetMove(c, b.dataset.mv, () => { s.remove(); sheetPeople(c, manage, onClose); });
    });
    s.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const { error } = await sb.rpc('remove_from_room', { p_channel: c.id, p_member: b.dataset.rm });
        if (error) return toast(error.message);
        s.remove(); sheetPeople(c, manage, onClose);
      };
    });
    const add = s.querySelector('#add');
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      for (const i of add.querySelectorAll('input[name=p]:checked')) {
        const { error } = await sb.rpc('add_to_room', { p_channel: c.id, p_member: i.value });
        if (error) toast(`${nameOf(i.value)}: ${error.message.replace(/^BrainStorm rule: /, '')}`);
      }
      s.remove(); sheetPeople(c, manage, onClose);
    };
  }

  // ---------- requests (senior management) ----------
  async function viewRequests() {
    const { data } = await sb.from('access_requests').select('*').eq('status', 'pending').order('created_at');
    const reqs = data || [];
    const { data: ra } = await sb.rpc('am_i_room_approver');
    const roomApprover = ra === true;
    let rreqs = [];
    if (roomApprover) { const { data: rr } = await sb.rpc('room_requests_pending'); rreqs = rr || []; }
    shell(`<header class="top"><img class="logo" src="${logoSrc()}" alt="" width="60" height="60" decoding="sync"><h1>Access <span style="color:var(--yellow)">requests</span></h1><div class="grow"></div><button class="btn small" id="addp">Add a new starter</button></header>
      <main class="list">${reqs.length ? reqs.map((r) => `
        <div class="req"><b>${esc(r.full_name)}</b>
          <div class="meta">${esc(r.email)}<br>${esc(S.businesses[r.business_id] ? S.businesses[r.business_id].name : '')} · ${esc(S.sites[r.site_id] ? S.sites[r.site_id].name : 'No site given')} · ${esc(S.roles[r.role_code] ? S.roles[r.role_code].label : r.role_code)}<br>
          Requested from the ${r.source === 'hub' ? 'Hub' : r.source === 'mothership' ? 'Mothership' : 'app'}${r.requested_by_name ? ' by ' + esc(r.requested_by_name) : ''} · ${when(r.created_at)}</div>
          <div class="actions"><button class="btn danger small" data-dec="${r.id}">Decline</button><button class="btn small" data-ok="${r.id}">Approve</button></div></div>`).join('')
        : '<div class="empty">No requests waiting.</div>'}
        ${roomApprover ? `<section class="grp" data-grp="roomreqs"><div class="section s-room">Group requests${rreqs.length ? ` <span class="cnt">${rreqs.length}</span>` : ''}</div>
          ${rreqs.length ? rreqs.map((r) => `<div class="req"><b>${esc(r.member_name)}</b> wants to join <span class="nm" style="display:inline-flex"><span class="tx${bizClass(r)}">${esc(r.channel_name)}</span>${roomChips(r)}</span>
            <div class="meta">${r.note ? '“' + esc(r.note) + '”<br>' : ''}${when(r.created_at)}</div>
            <div class="actions"><button class="btn danger small" data-rdec="${r.id}">Decline</button><button class="btn small" data-rok="${r.id}">Approve</button></div></div>`).join('')
          : '<p class="note">No group requests waiting.</p>'}</section>
        <details class="fold" id="allrooms"><summary class="section s-room"><svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>All groups and who is in them <small style="letter-spacing:0;text-transform:none;font-weight:400;color:var(--dim)">· names only, no messages</small></summary><div id="alllist"><p class="note">Loading…</p></div></details>` : ''}
        <section class="grp" data-grp="invites"><div class="section s-room">Invites sent</div><div id="invlist"><p class="note">Loading…</p></div></section></main>`);
    drawInvites();
    const decide = async (id, approve) => {
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/decide-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseKey, Authorization: 'Bearer ' + S.session.access_token },
        body: JSON.stringify({ request_id: id, approve })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) return toast(out.error || 'That did not work');
      toast(approve ? 'Approved. They can now sign in with their email.' : 'Declined.');
      await countRequests(); viewRequests();
    };
    document.getElementById('addp').onclick = sheetAddPerson;
    app.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => decide(b.dataset.ok, true); });
    app.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => decide(b.dataset.dec, false); });
    const decideRoom = async (id, approve) => {
      const { error } = await sb.rpc('decide_room_request', { p_id: Number(id), p_approve: approve });
      if (error) return toast(error.message.replace(/^BrainStorm rule: /, ''));
      toast(approve ? 'Approved. They are now in the group.' : 'Declined.');
      await countRequests(); viewRequests();
    };
    app.querySelectorAll('[data-rok]').forEach((b) => { b.onclick = () => decideRoom(b.dataset.rok, true); });
    app.querySelectorAll('[data-rdec]').forEach((b) => { b.onclick = () => decideRoom(b.dataset.rdec, false); });
    const all = document.getElementById('allrooms');
    if (all) {
      let drawn = false;
      const drawAll = async () => {
        const box = document.getElementById('alllist'); if (!box) return;
        const openIds = [...box.querySelectorAll('details.roomov[open]')].map((d) => d.dataset.room);
        const { data: rooms } = await sb.rpc('rooms_overview');
        box.innerHTML = (rooms || []).map((r) => `<details class="fold roomov" data-room="${r.id}"${openIds.includes(r.id) ? ' open' : ''}><summary><span class="nm"><span class="tx${bizClass(r)}">${r.kind === 'announcement' ? '📣 ' : '# '}${esc(r.name)}</span>${roomChips(r)}</span><span class="cnt">${r.people.length}</span></summary>
          <div class="ovact"><button class="btn small ghost" type="button" data-manage="${r.id}">Add or remove people</button></div>
          <div class="ppl">${r.people.map((p) => `<span>${esc(p.name)}${p.joined ? '' : ' <small class="njt">not joined yet</small>'}${S.roles[p.role] && S.roles[p.role].rank >= 40 ? ` <small>${esc(S.roles[p.role].label)}</small>` : ''}</span>`).join('') || '<span class="note">Nobody yet</span>'}</div></details>`).join('');
        const byId = {}; (rooms || []).forEach((r) => { byId[r.id] = r; });
        box.querySelectorAll('[data-manage]').forEach((b) => {
          b.onclick = () => { const r = byId[b.dataset.manage]; sheetPeople({ id: r.id, name: r.name, kind: r.kind, business_id: r.business_id, site_id: r.site_id }, true, drawAll); };
        });
      };
      all.addEventListener('toggle', () => { if (all.open && !drawn) { drawn = true; drawAll(); } });
    }
  }


  // Invite history: spot typos, resend, fix the address or remove it.
  async function drawInvites() {
    const box = document.getElementById('invlist'); if (!box) return;
    const [{ data, error }, sumRes] = await Promise.all([sb.rpc('invite_people'), sb.rpc('invite_summary')]);
    if (error) { box.innerHTML = `<p class="note">${esc(error.message)}</p>`; return; }
    const rows = (data || []).filter((r) => !r.joined); // anyone who has signed in drops off this list
    const sum = (sumRes.data || [])[0] || null;
    const rowHtml = (r) => {
      const t = r.kind === 'personal' ? emailTypo('', r.email) : emailTypo(r.full_name, r.email);
      const warn = t && (t.suggest || r.kind !== 'personal') && !/personal address/.test(t.reason) ? t : null;
      const st = r.status === 'sent' ? `<span class="stx stx-active">Sent ${when(r.sent_at)}</span>`
        : r.status === 'pending' ? '<span class="stx stx-away">Waiting to send</span>'
        : `<span style="color:var(--red)">Not sent</span>`;
      const kind = r.kind === 'main' ? 'Main' : r.kind === 'personal' ? 'Personal' : r.kind === 'work' ? 'Work' : 'No longer a sign-in';
      return `<div class="req inv${warn ? ' warn' : ''}" data-row="${r.id}">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.full_name)}</b><small class="meta">${st}</small></div>
        <div class="meta" style="word-break:break-all"><span class="invem">${esc(r.email)}</span> · ${kind}${r.sent_by ? ' · by ' + esc(r.sent_by.split(' ')[0]) : ''}</div>
        ${warn ? `<div class="typo">⚠ ${esc(warn.reason)}${warn.suggest ? ` — did you mean <b>${esc(warn.suggest)}</b>?` : ''}</div>` : ''}
        ${r.note && r.note !== 'cancelled' ? `<div class="meta" style="color:var(--red)">Problem: ${esc(r.note.slice(0, 120))}</div>` : ''}
        <div class="actions">
          ${r.still_active ? `<button class="btn ghost small" data-fix="${r.id}">Fix email</button><button class="btn ghost small" data-resend="${r.id}">Resend</button>` : ''}
          ${r.still_active && r.kind !== 'main' ? `<button class="btn danger small" data-rmem="${r.id}">Remove email</button>` : ''}
          <button class="btn ghost small" data-hide="${r.id}" title="Remove from this list">${r.status === 'pending' ? 'Cancel' : 'Clear'}</button>
        </div></div>`;
    };
    // One line per person (tap to open their emails and the Fix / Resend / Clear buttons)
    const people = []; const seen = {};
    rows.forEach((r) => { if (!seen[r.member_id]) { seen[r.member_id] = { id: r.member_id, name: r.full_name, rows: [] }; people.push(seen[r.member_id]); } seen[r.member_id].rows.push(r); });
    people.sort((x, y) => x.name.localeCompare(y.name));
    const openSet = S.invOpen = S.invOpen || {};
    const waiting = sum ? sum.total - sum.joined : people.length;
    box.innerHTML = `${sum ? `<div class="invsum"><div><b>${sum.joined} of ${sum.total}</b> staff have joined · <b>${waiting}</b> not yet</div>
        ${waiting ? `<button class="btn small" id="resall">Resend to everyone not joined</button>` : ''}</div>` : ''}
      ${people.length ? people.map((pp) => {
        const latest = pp.rows.slice().sort((x, y) => String(y.sent_at || y.queued_at).localeCompare(String(x.sent_at || x.queued_at)))[0];
        const problem = pp.rows.some((r) => r.status === 'failed');
        const chip = problem ? '<span style="color:var(--red)">Problem</span>' : latest.status === 'pending' ? '<span class="stx stx-away">Waiting to send</span>' : `<span class="stx stx-active">Sent ${when(latest.sent_at)}</span>`;
        return `<div class="invp${openSet[pp.id] ? ' open' : ''}" data-invp="${pp.id}">
          <button type="button" class="invhead" aria-expanded="${openSet[pp.id] ? 'true' : 'false'}">${avatar(pp.id)}<span class="invname"><b>${esc(pp.name)}</b><small class="meta">Not joined yet · ${pp.rows.length} invite${pp.rows.length > 1 ? 's' : ''}</small></span><small class="meta">${chip}</small><span class="chev">›</span></button>
          <div class="invbody">${pp.rows.map(rowHtml).join('')}</div></div>`;
      }).join('') : '<div class="empty">Everyone invited has joined.</div>'}`;
    box.querySelectorAll('.invhead').forEach((h) => { h.onclick = () => {
      const w = h.closest('.invp'); const on = !w.classList.contains('open');
      w.classList.toggle('open', on); h.setAttribute('aria-expanded', String(on)); openSet[w.dataset.invp] = on;
    }; });
    const ra = document.getElementById('resall');
    if (ra) ra.onclick = () => {
      const c = sheet(`<h2>Resend invites?</h2><p class="note" style="text-align:left">A fresh invite goes to every sign-in email of the <b>${waiting}</b> staff who haven't joined yet (work and personal addresses).</p>
        <div class="actions"><button class="btn ghost" id="no">Cancel</button><button class="btn" id="yes">Send invites</button></div>`);
      c.querySelector('#no').onclick = () => c.remove();
      c.querySelector('#yes').onclick = async () => {
        const { data: n, error: qe } = await sb.rpc('resend_unjoined');
        c.remove(); if (qe) return toast(qe.message);
        toast(`${n} invites queued — sending now`);
        await signinCall({ action: 'drain' }); drawInvites();
      };
    };
    const byId = (id) => rows.find((x) => String(x.id) === String(id));
    box.querySelectorAll('[data-resend]').forEach((b) => { b.onclick = async () => {
      const r = byId(b.dataset.resend); b.disabled = true;
      const q = await sb.rpc('queue_invite', { p_member: r.member_id, p_email: r.email });
      if (q.error) { b.disabled = false; return toast(q.error.message); }
      const d = await signinCall({ action: 'drain' }); toast(d.ok && d.data.sent ? 'Invite sent again' : 'Saved — it will send shortly'); drawInvites();
    }; });
    box.querySelectorAll('[data-fix]').forEach((b) => { b.onclick = () => {
      const r = byId(b.dataset.fix); const t = emailTypo(r.kind === 'personal' ? '' : r.full_name, r.email);
      const sh = sheet(`<h2>Fix ${esc(r.full_name.split(' ')[0])}'s email</h2><form id="ff">
        <label class="field">Was<input class="input" value="${esc(r.email)}" disabled></label>
        <label class="field" style="margin-top:10px">Should be<input class="input" id="nv" type="email" required value="${esc((t && t.suggest) || r.email)}"></label>
        <p class="note" style="text-align:left">${r.kind === 'main' ? 'This is their main sign-in, so it changes everywhere.' : 'The old address stops working.'} A new invite goes to the corrected address.</p>
        <div class="actions"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn" type="submit">Fix and re-invite</button></div></form>`);
      sh.querySelector('#cx').onclick = () => sh.remove();
      sh.querySelector('#ff').onsubmit = async (e) => {
        e.preventDefault();
        let nv = sh.querySelector('#nv').value.trim().toLowerCase();
        nv = await confirmEmail(r.kind === 'personal' ? '' : r.full_name, nv); if (!nv) return;
        const { error: fe } = await sb.rpc('fix_sign_in_email', { p_member: r.member_id, p_old: r.email, p_new: nv, p_reinvite: true });
        if (fe) return toast(fe.message);
        sh.remove(); const d = await signinCall({ action: 'drain' });
        toast(d.ok && d.data.sent ? `Fixed — invite sent to ${nv}` : `Fixed — invite to ${nv} will send shortly`); drawInvites();
      };
    }; });
    box.querySelectorAll('[data-rmem]').forEach((b) => { b.onclick = async () => {
      const r = byId(b.dataset.rmem);
      const c = sheet(`<h2>Remove this email?</h2><p class="note" style="text-align:left"><b>${esc(r.email)}</b> will no longer sign in to ${esc(r.full_name)}'s account. Their other addresses keep working.</p>
        <div class="actions"><button class="btn ghost" id="no">Keep it</button><button class="btn danger" id="yes">Remove</button></div>`);
      c.querySelector('#no').onclick = () => c.remove();
      c.querySelector('#yes').onclick = async () => {
        const { error: re } = await sb.rpc('remove_sign_in_email', { p_member: r.member_id, p_email: r.email });
        c.remove(); if (re) return toast(re.message); toast('Email removed'); drawInvites();
      };
    }; });
    box.querySelectorAll('[data-hide]').forEach((b) => { b.onclick = async () => {
      const { error: he } = await sb.rpc('hide_invite', { p_id: Number(b.dataset.hide) });
      if (he) return toast(he.message); drawInvites();
    }; });
  }

  // ---------- me ----------
  // Me page backdrop: the theme's brain picture seen through a fogged, rain-streaked window.
  function rainGlass() {
    const r = (a, b) => a + Math.random() * (b - a);
    const drops = Array.from({ length: 16 }, () => `<i class="rg-drop" style="left:${r(2, 98).toFixed(1)}%;--s:${r(.6, 1.4).toFixed(2)};animation-duration:${r(5, 13).toFixed(1)}s;animation-delay:-${r(0, 13).toFixed(1)}s"></i>`).join('');
    const beads = Array.from({ length: 46 }, () => `<i class="rg-bead" style="left:${r(0, 100).toFixed(1)}%;top:${r(0, 100).toFixed(1)}%;--s:${r(.3, 1).toFixed(2)}"></i>`).join('');
    return `<div class="rainglass" aria-hidden="true"><div class="rg-img" style="background-image:url('${heroSrc()}')"></div><div class="rg-fog"></div>${beads}${drops}</div>`;
  }
  function viewMe() {
    const m = S.me;
    shell(`<header class="top"><img class="logo" src="${logoSrc()}" alt="" width="60" height="60" decoding="sync"><h1>Me</h1></header>
      ${rainGlass()}
      <main class="list me-page" style="padding:8px 16px">
        ${profileBlock(m.id)}
        <div class="section s-room" style="padding-left:0">My picture</div>
        <div class="picbox">
          <div class="picbtns">
            <button type="button" class="btn small" id="picup">${m.own_avatar_at ? 'Change my photo' : 'Upload my own photo'}</button>
            ${m.own_avatar_at ? '<button type="button" class="btn ghost small" id="picrm">Remove my photo</button>' : ''}
            <input type="file" id="picfile" accept="image/*" hidden>
          </div>
        </div>
        <p class="note" style="text-align:left;margin:4px 2px 8px">${m.own_avatar_at ? 'You are using your own photo.' : 'You are using your Mothership photo (or initials) until you upload your own.'} Pick a ring below. It shows round your picture everywhere.</p>
        <div class="ringgrid" role="group" aria-label="Choose a ring">
          <button type="button" class="ringopt" data-ring="" aria-pressed="${!(S.people[m.id] || m).avatar_ring}">${avatar(m.id, '', null)}<span>No ring</span></button>
          ${RINGS.map((r) => `<button type="button" class="ringopt" data-ring="${r.id}" aria-pressed="${(S.people[m.id] || m).avatar_ring === r.id}">${avatar(m.id, '', r.id)}<span>${esc(r.label)}</span></button>`).join('')}
        </div>
        ${seePhones() ? `<form id="phf" class="phrow"><input class="input" id="ph" type="tel" inputmode="tel" maxlength="20" placeholder="Your phone number (only managers and above can see it)" value="${esc((S.people[m.id] || m).phone || '')}"><button class="btn small ghost" type="submit" disabled>Save</button></form>` : ''}
        <p class="note" style="margin:6px 4px 0">Signed in as ${esc((S.session && S.session.user && S.session.user.email) || '')}. Your status is worked out automatically: Active while you use the app, then from your rota.</p>
        <div class="bdrow"><span>🎂 My birthday: <b id="bdval">…</b></span><button type="button" class="btn small ghost" id="bdedit">Change</button></div>
        <label class="vchk bdchk anvchk"><input type="checkbox" id="anvshow"${m.hide_anniversary ? '' : ' checked'}> 🏆 Celebrate my work anniversary in BrainStorm</label>
        <section class="appbox" id="appbox" aria-label="App and alerts"></section>
        <div class="section s-room" style="padding-left:0">Look</div>
        <div class="themes" role="group" aria-label="Choose a look">${THEMES.filter((t) => !t.hidden || getTheme() === t.id).map((t) => `<button type="button" data-theme-pick="${t.id}" aria-pressed="${getTheme() === t.id}"><div class="sw">${t.sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div>${t.label}</button>`).join('')}</div>
        <div class="actions" style="margin-top:24px"><button class="btn ghost" id="out">Sign out</button></div>
        <p class="note" style="margin-top:24px">BrainStorm ${esc(cfg.version)} · by Brain Candy Studio</p>
      </main>`);
    document.getElementById('out').onclick = () => sb.auth.signOut();
    const phf = document.getElementById('phf');
    if (phf) watchSave(phf, document.getElementById('ph'), () => (S.people[m.id] || m).phone);
    if (phf) phf.onsubmit = async (e) => {
      e.preventDefault();
      const v = document.getElementById('ph').value.trim();
      const { error } = await sb.rpc('set_phone', { p_member: m.id, p_phone: v });
      if (error) return toast(error.message);
      if (S.people[m.id]) S.people[m.id].phone = v || null; S.me.phone = v || null;
      toast(v ? 'Phone number saved' : 'Phone number removed'); viewMe();
    };
    sb.rpc('my_birthday').then(({ data }) => {
      const v = document.getElementById('bdval'); if (!v) return;
      v.textContent = data && data.md ? bdayText(data.md) + (data.hidden ? ' (no wishes)' : '') : 'not given';
      document.getElementById('bdedit').onclick = () => sheetBirthday(data || {}, () => viewMe());
    });
    const anv = document.getElementById('anvshow');
    if (anv) anv.onchange = async () => {
      const { error } = await sb.rpc('set_anniversary_visible', { p_show: anv.checked });
      if (error) { anv.checked = !anv.checked; return toast(error.message); }
      S.me.hide_anniversary = !anv.checked; toast(anv.checked ? 'We’ll celebrate your work anniversary 🏆' : 'No problem, we won’t post your work anniversary');
    };
    drawAppBox();
    drawPicture();
    app.querySelectorAll('[data-theme-pick]').forEach((b) => {
      b.onclick = async () => {
        applyTheme(b.dataset.themePick); S.me.theme = b.dataset.themePick; viewMe();
        await sb.from('members').update({ theme: S.me.theme }).eq('id', S.me.id);
      };
    });
  }

  // ---------- My picture: upload your own photo, crop it, choose a ring ----------
  function drawPicture() {
    const me = S.me; const mine = S.people[me.id] || me;
    app.querySelectorAll('[data-ring]').forEach((b) => { b.onclick = async () => {
      const ring = b.dataset.ring || null;
      const { error } = await sb.rpc('set_my_ring', { p_ring: ring });
      if (error) return toast(error.message);
      me.avatar_ring = ring; mine.avatar_ring = ring; saveCache();
      toast(ring ? `${RING[ring].label} ring saved` : 'Ring removed'); viewMe();
    }; });
    const fi = document.getElementById('picfile');
    const up = document.getElementById('picup'); if (up) up.onclick = () => fi.click();
    if (fi) fi.onchange = () => { const f = fi.files[0]; fi.value = ''; if (f) cropPhoto(f); };
    const rm = document.getElementById('picrm');
    if (rm) rm.onclick = () => {
      const c = sheet(`<h2>Remove your photo?</h2><p class="note" style="text-align:left">You'll go back to your Mothership photo, or your initials if there isn't one. Your ring stays.</p>
        <div class="actions"><button class="btn ghost" id="no">Keep it</button><button class="btn danger" id="yes">Remove</button></div>`);
      c.querySelector('#no').onclick = () => c.remove();
      c.querySelector('#yes').onclick = async () => {
        const { error } = await sb.rpc('clear_my_avatar'); c.remove();
        if (error) return toast(error.message);
        me.own_avatar_at = null; me.avatar_url = null; mine.avatar_url = null; mine.photo = null;
        fetch(cfg.supabaseUrl + '/functions/v1/staff-sync?check=1', { method: 'POST', headers: { apikey: cfg.supabaseKey } }).catch(() => {});
        toast('Photo removed'); viewMe();
      };
    };
  }
  async function cropPhoto(file) {
    if (!/^image\//.test(file.type)) return toast('Please choose a photo');
    let img;
    try { img = await createImageBitmap(file); } catch (_) { return toast('That photo could not be opened. Try a different one.'); }
    const SIZE = 280, OUT = 512;
    const sh = sheet(`<h2>Position your photo</h2>
      <p class="note" style="margin:0 0 8px">Drag to move, use the slider to zoom.</p>
      <div class="cropwrap"><canvas id="crop" width="${SIZE * 2}" height="${SIZE * 2}" style="width:${SIZE}px;height:${SIZE}px"></canvas></div>
      <label class="field" style="margin-top:10px">Zoom<input type="range" id="zoom" min="1" max="4" step="0.01" value="1"></label>
      <div class="actions"><button class="btn ghost" id="cx">Cancel</button><button class="btn" id="ok">Use this photo</button></div>`);
    const cv = sh.querySelector('#crop'), ctx = cv.getContext('2d'), zoom = sh.querySelector('#zoom');
    const base = Math.max(SIZE / img.width, SIZE / img.height); // smallest zoom that still fills the circle
    let z = 1, ox = 0, oy = 0;
    const clamp = () => { const s = base * z, w = img.width * s, h = img.height * s; ox = Math.min(0, Math.max(SIZE - w, ox)); oy = Math.min(0, Math.max(SIZE - h, oy)); };
    const centre = () => { const s = base * z; ox = (SIZE - img.width * s) / 2; oy = (SIZE - img.height * s) / 2; };
    const draw = () => {
      clamp(); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, SIZE, SIZE);
      const s = base * z; ctx.drawImage(img, ox, oy, img.width * s, img.height * s);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.rect(0, 0, SIZE, SIZE); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, Math.PI * 2, true); ctx.fill('evenodd');
    };
    centre(); draw();
    zoom.oninput = () => { const cx = SIZE / 2 - ox, cy = SIZE / 2 - oy, old = z; z = Number(zoom.value); ox = SIZE / 2 - cx * z / old; oy = SIZE / 2 - cy * z / old; draw(); };
    let drag = null;
    cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => { if (!drag) return; ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); draw(); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    sh.querySelector('#cx').onclick = () => sh.remove();
    sh.querySelector('#ok').onclick = async () => {
      if (isOffline()) return toast('No connection right now. Try again when you’re back online.');
      const out = document.createElement('canvas'); out.width = out.height = OUT;
      const k = OUT / SIZE, s = base * z;
      out.getContext('2d').drawImage(img, ox * k, oy * k, img.width * s * k, img.height * s * k);
      const blob = await new Promise((r) => out.toBlob(r, 'image/jpeg', 0.86));
      const path = `${S.me.id}.own-${Date.now()}.jpg`;
      const upr = await sb.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (upr.error) return toast('Your photo could not be uploaded. Please try again.');
      const { data: url, error } = await sb.rpc('set_my_avatar', { p_path: path });
      if (error) return toast(error.message);
      sh.remove();
      S.me.avatar_url = url; S.me.own_avatar_at = new Date().toISOString();
      const mine = S.people[S.me.id] || (S.people[S.me.id] = { ...S.me });
      mine.avatar_url = url;
      const { data: su } = await sb.storage.from('avatars').createSignedUrl(path, 6 * 3600);
      mine.photo = su ? su.signedUrl : null; saveCache();
      toast('Photo saved'); viewMe();
    };
  }

  // ---------- App & alerts: install steps for this exact device, then phone/computer alerts ----------
  const DEV = (() => {
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const android = /android/i.test(ua);
    const mac = !ios && /Macintosh/.test(ua);
    const win = /Windows/.test(ua);
    const edge = /Edg\//.test(ua), chrome = /Chrome\//.test(ua) && !edge, firefox = /Firefox\//.test(ua);
    const safari = /Safari\//.test(ua) && !chrome && !edge && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const label = ios ? (/ipad/i.test(ua) || navigator.maxTouchPoints > 1 && /Macintosh/.test(ua) ? 'iPad' : 'iPhone')
      : android ? 'Android phone' : mac ? `Mac (${safari ? 'Safari' : edge ? 'Edge' : chrome ? 'Chrome' : 'browser'})`
      : win ? `Windows PC (${edge ? 'Edge' : chrome ? 'Chrome' : 'browser'})` : 'Computer';
    return { ios, android, mac, win, edge, chrome, firefox, safari, standalone, label };
  })();
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; const b = document.getElementById('appbox'); if (b) drawAppBox(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; const b = document.getElementById('appbox'); if (b) drawAppBox(); });

  function installSteps() {
    const b = (t) => `<b>${t}</b>`;
    if (DEV.ios && !DEV.safari) return [`Open ${b('brainstorm.braincandystudio.co.uk')} in ${b('Safari')} (iPhone only installs apps from Safari).`, `Then come back to this page for the steps.`];
    if (DEV.ios) return [`Tap ${b('Share')} at the bottom of Safari (the square with an arrow pointing up).`, `Scroll down and tap ${b('Add to Home Screen')}, then ${b('Add')}.`, `Open BrainStorm from the new ${b('BS')} icon on your home screen. You may need to sign in once more.`];
    if (DEV.android) return [`Tap ${b('Install')} below, or Chrome's ${b('⋮')} menu › ${b('Install app')}.`, `Open BrainStorm from the new ${b('BS')} icon.`];
    if (DEV.mac && DEV.safari) return [`In the menu bar at the top of the screen: ${b('File › Add to Dock…')}, then ${b('Add')}.`, `BrainStorm now opens from the Dock in its own window. Right-click the icon › ${b('Options › Keep in Dock')} if it isn't kept.`];
    if (DEV.mac || DEV.win) return [`Click ${b('Install')} below, or the install icon at the right of the address bar (a screen with a down arrow).`, DEV.mac ? `Right-click BrainStorm in the Dock › ${b('Options › Keep in Dock')}.` : `Right-click BrainStorm in the taskbar › ${b('Pin to taskbar')}.`];
    return [`Use your browser's menu and choose ${b('Install app')} or ${b('Add to Home Screen')}.`];
  }
  const b64u8 = (b64) => { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function mySub() { try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (_) { return null; } }

  const QUIET = [
    { v: '19:00-07:00', l: '7pm to 7am' }, { v: '20:00-07:00', l: '8pm to 7am' }, { v: '21:00-07:00', l: '9pm to 7am' },
    { v: '22:00-06:00', l: '10pm to 6am' }, { v: 'off', l: 'Off: alert me any time' }
  ];
  function quietNow() {
    const f = String(S.me.quiet_from || '19:00').slice(0, 5), t = String(S.me.quiet_to || '07:00').slice(0, 5);
    return f === t ? 'off' : f + '-' + t;
  }
  async function drawAppBox() {
    const box = document.getElementById('appbox'); if (!box) return;
    const pushable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const sub = pushable ? await mySub() : null;
    const { data: devs } = await sb.from('push_subscriptions').select('id,endpoint,device_label,created_at').eq('member_id', S.me.id).is('disabled_at', null).order('created_at');
    const here = sub && (devs || []).find((d) => d.endpoint === sub.endpoint);
    let alertsHtml;
    if (!pushable && DEV.ios && !DEV.standalone) alertsHtml = `<p class="note">On ${DEV.label}, alerts work once BrainStorm is on your home screen. Do step 1, open BrainStorm from its icon, then come back here.</p>`;
    else if (!pushable) alertsHtml = `<p class="note">This browser can't show alerts. Try Chrome, Edge or Safari, or install BrainStorm (step 1).</p>`;
    else if (Notification.permission === 'denied') alertsHtml = `<p class="note">Alerts are blocked for BrainStorm on this device. Turn them on in ${DEV.ios ? 'Settings › Notifications › BS' : DEV.android ? 'Settings › Apps › BS › Notifications' : 'your browser’s site settings for brainstorm.braincandystudio.co.uk'}, then come back.</p>`;
    else if (here) alertsHtml = `<p class="ok-line">✓ Alerts are on for this ${esc(DEV.label)}</p><div class="actions" style="justify-content:flex-start"><button class="btn small ghost" id="ptest">Send a test alert</button><button class="btn small ghost" id="poff" data-sub="${here.id}">Turn off here</button></div>`;
    else alertsHtml = `<div class="actions" style="justify-content:flex-start"><button class="btn small" id="pon">Turn on alerts on this ${esc(DEV.label)}</button></div>`;
    const others = (devs || []).filter((d) => !here || d.id !== here.id);
    const qf0 = String(S.me.quiet_from || '00:00').slice(0, 5), qt0 = String(S.me.quiet_to || '00:00').slice(0, 5);
    const qOn = qf0 !== qt0, qf = qOn ? qf0 : '19:00', qt = qOn ? qt0 : '07:00';
    box.innerHTML = `<div class="section s-room" style="padding-left:0">App &amp; alerts</div>
      <div class="appstep"><h3><span class="num">1</span>Put BrainStorm on this ${esc(DEV.label)}</h3>
        ${DEV.standalone ? '<p class="ok-line">✓ Installed: you’re using the BrainStorm app.</p>' : `<ol>${installSteps().map((t) => `<li>${t}</li>`).join('')}</ol>${installPrompt ? '<button class="btn small" id="pinstall">Install BrainStorm</button>' : ''}`}</div>
      <div class="appstep"><h3><span class="num">2</span>Get alerts</h3>${alertsHtml}
        ${others.length ? `<p class="note" style="margin-top:8px">Also getting alerts: ${others.map((d) => `${esc(d.device_label || 'Another device')} <button class="linkbtn" data-off="${d.id}">turn off</button>`).join(' · ')}</p>` : ''}
        
        <p class="note" style="margin-top:8px">Alerts never show the message itself, just who it's from and where, so nothing private appears on a locked screen.</p></div>
      <div class="appstep"><h3><span class="num">3</span>Quiet time</h3>
        <label class="qrow"><input type="checkbox" id="aoff"${S.me.alerts_off ? ' checked' : ''}><span><b>Pause all alerts</b><small>Off until you come back and turn them on again</small></span></label>
        <label class="qrow"><input type="checkbox" id="qon"${qOn ? ' checked' : ''}><span><b>No alerts every day from</b>
          <span class="qtimes"><input class="input" type="time" id="qf" value="${qf}"> to <input class="input" type="time" id="qt" value="${qt}"></span>
          <small>Alerts switch off and back on by themselves at these times</small></span></label>
        <label class="qrow"><input type="checkbox" id="onedev"${S.me.skip_other_devices ? ' checked' : ''}><span><b>Only alert the device I'm using</b><small>While BrainStorm is open on one device (say your laptop), your other devices stay quiet</small></span></label>
        <p class="note" style="margin-top:6px">${S.me.alerts_off ? '<b class="qnow">Alerts are paused.</b> ' : ''}Messages still arrive in BrainStorm while alerts are off, you just won't be pinged. Urgent messages from senior management always come through.</p></div>`;
    const aoff = document.getElementById('aoff');
    if (aoff) aoff.onchange = async () => {
      const v = aoff.checked;
      const { error } = await sb.from('members').update({ alerts_off: v }).eq('id', S.me.id);
      if (error) { aoff.checked = !v; return toast(error.message); }
      S.me.alerts_off = v; saveCache(); drawAppBox();
      toast(v ? 'Alerts paused. Turn them back on here any time.' : 'Alerts are back on');
    };
    const od = document.getElementById('onedev');
    if (od) od.onchange = async () => {
      const v = od.checked;
      const { error } = await sb.from('members').update({ skip_other_devices: v }).eq('id', S.me.id);
      if (error) { od.checked = !v; return toast(error.message); }
      S.me.skip_other_devices = v; saveCache();
      toast(v ? 'Only the device you’re using will alert you' : 'All your devices will alert you');
    };
    const qon = document.getElementById('qon'), qfI = document.getElementById('qf'), qtI = document.getElementById('qt');
    const saveQuiet = async () => {
      const on = qon.checked && qfI.value && qtI.value && qfI.value !== qtI.value;
      const [f, t] = on ? [qfI.value, qtI.value] : ['00:00', '00:00'];
      const { error } = await sb.from('members').update({ quiet_from: f, quiet_to: t }).eq('id', S.me.id);
      if (error) return toast(error.message);
      S.me.quiet_from = f; S.me.quiet_to = t; saveCache();
      toast(on ? `No alerts from ${f} to ${t} every day` : 'Daily quiet time off');
    };
    if (qon) { qon.onchange = saveQuiet; qfI.onchange = () => { if (qon.checked) saveQuiet(); }; qtI.onchange = () => { if (qon.checked) saveQuiet(); }; }
    const ib = document.getElementById('pinstall'); if (ib) ib.onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; drawAppBox(); };
    const on = document.getElementById('pon'); if (on) on.onclick = async () => {
      on.disabled = true; on.textContent = 'Turning on…';
      try {
        if ((await Notification.requestPermission()) !== 'granted') { toast('Alerts were not allowed. You can change this in your device settings.'); return drawAppBox(); }
        const { data: key } = await sb.rpc('push_public_key');
        const reg = await navigator.serviceWorker.ready;
        const s2 = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(key) });
        const j = s2.toJSON();
        const { data: ex } = await sb.from('push_subscriptions').select('id').eq('member_id', S.me.id).eq('endpoint', j.endpoint).maybeSingle();
        const row = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth_key: j.keys.auth, device_label: DEV.label, user_agent: navigator.userAgent.slice(0, 300), disabled_at: null };
        const { error } = ex ? await sb.from('push_subscriptions').update(row).eq('id', ex.id) : await sb.from('push_subscriptions').insert({ ...row, member_id: S.me.id });
        if (error) throw error;
        toast('Alerts are on. Sending a test…'); await sb.rpc('push_test');
      } catch (e) { toast('Could not turn on alerts: ' + (e.message || e)); }
      drawAppBox();
    };
    const t = document.getElementById('ptest'); if (t) t.onclick = async () => { const { data } = await sb.rpc('push_test'); toast(data ? 'Test alert sent' : 'No devices to send to'); };
    const off = async (id, local) => { await sb.rpc('push_turn_off', { p_sub: id }); if (local) { const s3 = await mySub(); if (s3) await s3.unsubscribe().catch(() => {}); } toast('Alerts turned off'); drawAppBox(); };
    const po = document.getElementById('poff'); if (po) po.onclick = () => off(po.dataset.sub, true);
    box.querySelectorAll('[data-off]').forEach((x) => { x.onclick = () => off(x.dataset.off, false); });
  }

  // ---------- routing + live list ----------
  function route() {
    mainEl.ondragover = mainEl.ondrop = mainEl.ondragleave = null; mainEl.classList.remove('dropping');
    wasWide = isWide(); document.body.classList.toggle('wide', wasWide);
    if (wasWide && S.tab !== 'chats') drawSide();
    if (S.tab === 'requests') return viewRequests();
    if (S.tab === 'me') return viewMe();
    S.tab = 'chats'; return viewHome();
  }

  function watchEverything() {
    if (S.listSub) sb.removeChannel(S.listSub);
    S.listSub = sb.channel('everything')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        const m = p && p.new;
        if (m && (m.urgent || m.celebrate) && m.author_id !== S.me.id && !m.removed_at) playAlert({ ...m, kind: m.urgent ? 'urgent' : 'celebrate' });
        if (m && m.shoutout_to === S.me.id && m.author_id !== S.me.id && !m.removed_at) playAlert({ ...m, kind: 'shoutout' });
        if (m && m.must_read && m.author_id !== S.me.id) setTimeout(loadMyMustReads, 800);
        clearTimeout(watchEverything._t); // a burst of messages refreshes the list once, not once per message
        watchEverything._t = setTimeout(async () => {
          if (S.tab === 'chats' || isWide()) { await loadChannels(); const q = document.getElementById('q'); if (q && (!S.current || isWide()) && q !== document.activeElement) viewHome(q.value); }
          else { await loadChannels(); drawUnread(); }
        }, 350);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, async () => {
        if (S.tab === 'chats' || isWide()) { await loadChannels(); const q = document.getElementById('q'); if (q && (!S.current || isWide()) && q !== document.activeElement) viewHome(q.value); }
      }).subscribe();
  }

  async function start(session, quiet) {
    S.session = session;
    if (!session) { S.me = null; viewSignIn('email'); return; }
    if (!quiet && !S.me) {
      const c = readCache();
      if (c && c.me && c.me.auth_user_id === session.user.id && useCache()) { // instant start from this device's saved copy
        S.offline = navigator.onLine === false;
        S.photoOk = ((S.roles[S.me.role_code] || {}).rank || 0) >= 40;
        if (S.me.theme) applyTheme(S.me.theme);
        route(); drawOffline(); drawUnread();
        { // opened from a notification: go straight to that chat (fresh messages follow once connected)
          const dq = location.hash.match(/^#c=([0-9a-f-]{36})$/);
          if (dq && S.channels.find((x) => x.id === dq[1])) { history.replaceState(null, '', location.pathname); clearPendingOpen(); openChannel(dq[1]); }
        }
        savedAvatars().then((n) => { if (n) { refreshHome(); if (S.tab === 'chat' && S.current && document.getElementById('msgs')) drawMessages(false); } });
        quiet = true;
      }
    }
    if (!quiet) app.innerHTML = `<section class="signin"><div class="hero"><img class="storm" src="${heroSrc()}" alt=""><img class="wordmark" src="${wmSrc()}" alt="BrainStorm"></div><div class="signin-panel"><p class="tagline">Loading your chats…</p></div></section>`;
    if (!(await loadBasics())) return;
    await Promise.all([loadChannels(), countRequests(), loadDirectory()]);
    if (!quiet || (S.tab === 'chats' && !S.current && !document.querySelector('.sheet-back'))) route();
    else if (quiet && S.tab === 'chat' && S.current) openChannel(S.current.id);
    if (S.offline) return; // no signal: the saved copy is showing; everything else starts when signal returns
    setTimeout(prefetchChats, 3000);
    const dl = location.hash.match(/^#c=([0-9a-f-]{36})$/);
    if (dl) { history.replaceState(null, '', location.pathname); clearPendingOpen(); if (S.channels.find((c) => c.id === dl[1])) openChannel(dl[1]); }
    else pendingOpen();
    watchEverything();
    startPresence();
    loadSaved(); loadTodos();
    checkAlerts();
    loadMyMustReads();
    setTimeout(askBirthday, 2500);
    if (S.me.can_approve || can('access_approver_min_rank')) signinCall({ action: 'drain' }); // send any waiting invites
    // refresh staff details + today's whereabouts from Mothership / the Hub (the service skips it if it ran recently)
    fetch(cfg.supabaseUrl + '/functions/v1/staff-sync', { method: 'POST', headers: { apikey: cfg.supabaseKey } })
      .then((r) => r.json()).then(async (r) => { if (r && (r.mothership || r.hub)) { await loadDirectory(); const q = document.getElementById('q'); if (q && (!S.current || isWide()) && !document.querySelector('.sheet-back')) viewHome(q.value); } }).catch(() => {});
  }

  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') { S.session = session; return; }
    if (event === 'SIGNED_OUT') { clearCaches(); try { if ('clearAppBadge' in navigator) navigator.clearAppBadge(); } catch (_) {} }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      if (event === 'SIGNED_IN' && started && S.me) { S.session = session; return; }
      if (S.quick && session && event !== 'SIGNED_OUT') { // already showing the saved copy
        S.session = session; started = true;
        if (!isOffline()) { S.quick = false; start(session, true); }
        return;
      }
      S.quick = false; started = true; start(session);
    }
  });

  // Opening the app with no signal: show the saved chats straight away instead of waiting on sign-in checks
  function quickStart() {
    if (started || S.me) return;
    let uid = null; try { uid = localStorage.getItem('bs-last-user'); } catch (_) {}
    if (!uid) return;
    S.session = { user: { id: uid } };
    if (!useCache()) { S.session = null; return; }
    S.quick = true; S.photoOk = ((S.roles[S.me.role_code] || {}).rank || 0) >= 40;
    if (S.me.theme) applyTheme(S.me.theme);
    route(); drawOffline(); drawUnread();
  }
  if (navigator.onLine === false) setTimeout(quickStart, 0);
  setTimeout(() => { if (!started) quickStart(); }, 4000); // weak signal: sign-in check is taking too long

  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); });
  // Opening a chat from the list must never be missed, even if the list redraws between press and release
  // (busy chats redraw often). Match by which chat was pressed, not by the exact element on screen.
  let pressOpen = null, openedAt = 0;
  const ptrUp = () => { S.ptrDown = false; if (S.homeLater) { const h = S.homeLater; S.homeLater = null; setTimeout(() => viewHome(h.v), 0); } };
  document.addEventListener('pointercancel', ptrUp, true);
  document.addEventListener('pointerdown', (e) => {
    S.ptrDown = e.isPrimary !== false; setTimeout(() => { if (S.ptrDown && Date.now() - S.ptrAt > 4000) ptrUp(); }, 4100); S.ptrAt = Date.now();
    const r = e.target.closest && e.target.closest('[data-open]');
    pressOpen = r && e.button === 0 ? { id: r.dataset.open, x: e.clientX, y: e.clientY, t: Date.now() } : null;
    // A mouse can't be scrolling, so open on the press itself: the list can re-sort a moment later
    // (a new message moves a chat to the top) and the release would land on a different row.
    if (pressOpen && e.pointerType === 'mouse') { openedAt = Date.now(); const id = pressOpen.id; pressOpen = null; openChannel(id); }
  }, true);
  document.addEventListener('pointerup', (e) => {
    ptrUp();
    const p = pressOpen; pressOpen = null;
    // Touch: open the chat that was pressed (not whatever row is under the finger now), unless it was a scroll
    if (!p || Date.now() - p.t > 1500 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
    openedAt = Date.now(); openChannel(p.id);
  }, true);
  // the normal click still works for keyboards; skip it if the press above already opened the chat
  document.addEventListener('click', (e) => {
    // mouse/touch clicks are handled above (detail > 0); only keyboard "clicks" (detail 0) get through
    if (e.target.closest && e.target.closest('[data-open]') && (e.detail > 0 || Date.now() - openedAt < 700)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // Every tap gets an instant response: a press-in, a ripple and (on Android) a tiny buzz
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button, a, .row, [role="button"], label.pick');
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
    const w = document.createElement('span'); w.className = 'ripple';
    w.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.classList.add('rip'); b.appendChild(w); setTimeout(() => w.remove(), 550);
  }, { passive: true, capture: true });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, a, .row, [role="button"]');
    if (!b) return;
    tapped = b; tappedAt = Date.now();
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}
  }, true);

  // Tap a picture in a chat: open it full screen inside BrainStorm (zoom, scroll, open the original)
  function openViewer(src, name) {
    const v = document.createElement('div'); v.className = 'viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Picture');
    v.innerHTML = `<div class="vbar"><span class="vname">${esc(name || 'Picture')}</span>
        <button type="button" class="vbtn" data-z="-1" aria-label="Zoom out">−</button><button type="button" class="vbtn" data-z="1" aria-label="Zoom in">+</button>
        <button type="button" class="vbtn vclose" aria-label="Close">✕</button></div>
      <div class="vstage"><img src="${esc(src)}" alt="${esc(name || '')}"></div>`;
    document.body.appendChild(v);
    const stage = v.querySelector('.vstage'), img = v.querySelector('img');
    let z = 1;
    const fit = () => Math.min((stage.clientWidth - 16) / img.naturalWidth, (stage.clientHeight - 16) / img.naturalHeight, 1) || 1;
    const apply = (cx, cy) => {
      const before = { w: img.width || 1, h: img.height || 1, sl: stage.scrollLeft, st: stage.scrollTop };
      const k = fit() * z; img.style.width = Math.round(img.naturalWidth * k) + 'px'; img.style.height = Math.round(img.naturalHeight * k) + 'px';
      v.classList.toggle('zoomed', z > 1);
      if (cx !== undefined) { const r = img.width / before.w; stage.scrollLeft = (before.sl + cx) * r - cx; stage.scrollTop = (before.st + cy) * r - cy; }
    };
    const setZ = (nz, cx, cy) => { z = Math.max(1, Math.min(6, nz)); apply(cx, cy); };
    if (img.complete) apply(); else img.onload = () => apply();
    const close = () => { v.remove(); document.removeEventListener('keydown', key); window.removeEventListener('resize', onR); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === '+' || e.key === '=') setZ(z * 1.5); if (e.key === '-') setZ(z / 1.5); };
    const onR = () => apply();
    document.addEventListener('keydown', key); window.addEventListener('resize', onR);
    v.querySelector('.vclose').onclick = close;
    v.querySelectorAll('[data-z]').forEach((b) => { b.onclick = () => setZ(Number(b.dataset.z) > 0 ? z * 1.5 : z / 1.5); });
    // Tap/click the picture to zoom in on that spot, tap again to fit; tap the dark area to close
    stage.onclick = (e) => {
      if (e.target !== img) return close();
      const r = stage.getBoundingClientRect(); setZ(z > 1 ? 1 : 2.5, e.clientX - r.left, e.clientY - r.top);
    };
    stage.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = stage.getBoundingClientRect(); setZ(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    // Two-finger pinch on phones and tablets
    const pts = new Map(); let pinch = null;
    stage.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z }; } });
    stage.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e); if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); const r = stage.getBoundingClientRect(); setZ(pinch.z * d / pinch.d, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top); } });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('img.photo')) return;
    e.preventDefault(); openViewer(e.target.currentSrc || e.target.src, e.target.alt);
  });
  document.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img.photo');
    if (!img) return;
    e.preventDefault(); e.stopPropagation();
    openViewer(img.currentSrc || img.src, img.alt);
  }, true);

  // Phones: drag from the left edge of a chat to the right to go back to the home screen (like the iPhone back gesture)
  (() => {
    let g = null;
    const reset = (anim) => { app.style.transition = anim ? 'transform .2s ease' : ''; app.style.transform = ''; };
    document.addEventListener('touchstart', (e) => {
      if (isWide() || S.tab !== 'chat' || !document.getElementById('back') || document.querySelector('.sheet-back, .rpick')) return;
      const t = e.touches[0];
      if (e.touches.length !== 1 || t.clientX > 32) return;
      g = { x: t.clientX, y: t.clientY, dx: 0, lock: null };
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!g) return;
      const t = e.touches[0]; const dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.lock && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) g.lock = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (g.lock !== 'h') return;
      g.dx = Math.max(0, dx);
      app.style.transition = 'none'; app.style.transform = `translateX(${g.dx}px)`;
    }, { passive: true });
    const end = () => {
      if (!g) return;
      const done = g.lock === 'h' && g.dx > Math.min(120, window.innerWidth * 0.33);
      g = null;
      if (!done) return reset(true);
      app.style.transition = 'transform .16s ease-out'; app.style.transform = 'translateX(100%)';
      setTimeout(() => { const bb = document.getElementById('back'); reset(false); if (bb) bb.click(); }, 160);
    };
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  })();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    // an alert was tapped while BrainStorm was already open: jump to that chat
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.open && S.me && S.channels.find((c) => c.id === e.data.open)) { clearPendingOpen(); openChannel(e.data.open); } });
  }
})();
