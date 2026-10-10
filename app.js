/* BrainStorm app v0.2.0 — Brain Candy Studio
   Plain JavaScript on purpose: no build step, quick to load on nursery tablets.
   Every permission rule is enforced in the database; this file only shows or hides buttons. */
(function () {
  'use strict';
  const cfg = window.BRAINSTORM_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const app = document.getElementById('app');
  const COLORS = ['#2FF4FB', '#57A9FA', '#A750F7', '#FC70FC', '#FBDD63', '#7FF7D8'];

  const S = {
    session: null, me: null, roles: {}, rules: {}, people: {}, sites: {}, businesses: {}, stickers: {},
    tab: 'chats', channels: [], current: null, messages: [], pendingRequests: 0,
    listSub: null, roomSub: null, emailForCode: ''
  };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const THEMES = [
    { id: 'storm-dark', label: 'Storm', sw: ['#080C17', '#45E9FF', '#A66CFF'] },
    { id: 'storm-light', label: 'Neon white', sw: ['#FDFDFC', '#5EB2C2', '#03303A'] },
    { id: 'jungle', label: 'Jungle', sw: ['#F4EADB', '#2E7D32', '#C9A27A'] }
  ];
  function getTheme() { try { return localStorage.getItem('bs-theme') || 'storm-dark'; } catch (_) { return 'storm-dark'; } }
  function applyTheme(t) {
    if (!THEMES.some((x) => x.id === t)) t = 'storm-dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('bs-theme', t); } catch (_) {}
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = t === 'jungle' ? '#1F3D2B' : t === 'storm-light' ? '#F4F8F9' : '#05061C';
  }
  const heroSrc = () => (getTheme() === 'jungle' ? '/icons/jungle-hero.webp?v=2' : getTheme() === 'storm-light' ? '/icons/neonwhite-hero.webp?v=3' : '/icons/storm-hero.webp');
  const nw = () => getTheme() === 'storm-light';
  const wmSrc = (small) => nw() ? (small ? '/icons/wordmark-light-600.webp?v=4' : '/icons/wordmark-light.webp?v=4') : (small ? '/icons/wordmark-600.webp' : '/icons/wordmark.webp');
  const logoSrc = () => nw() ? '/icons/logo-neon-white-192.png' : getTheme() === 'jungle' ? '/icons/logo-jungle-192.png' : '/icons/logo-storm-192.png';
  applyTheme(getTheme());
  const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const colorFor = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
  const rank = (m) => (m && S.roles[m.role_code] ? S.roles[m.role_code].rank : 0);
  const myRank = () => rank(S.me);
  const can = (ruleKey) => myRank() >= (S.rules[ruleKey] ?? 999);
  function avatar(id, extraClass) {
    const p = S.people[id];
    const inner = p && p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(initials(p ? (p.display_name || p.full_name) : '?'));
    return `<div class="av ${extraClass || ''}" style="background:${colorFor(id)}">${inner}</div>`;
  }
  const nameOf = (id) => { const p = S.people[id]; return p ? (p.display_name || p.full_name) : 'Someone'; };
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
    return html.replace(/:sticker:([a-z-]+):/g, (_, code) =>
      `<span class="sticker" title="Swear word swapped for a sticker"><img src="${nw() ? '/icons/icon-nw-64.webp?v=3' : '/icons/icon-64.webp'}" alt="">${esc(S.stickers[code] || 'Bleep!')}</span>`);
  }
  const icon = {
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    send: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    people: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.6-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/></svg>',
    search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    chats: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    inbox: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>',
    me: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    clip: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>',
    bolt: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    megaphone: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M16 9a4 4 0 0 1 0 6"/></svg>'
  };

  // ---------- sign in ----------
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
        const { error } = await sb.auth.verifyOtp({ email: S.emailForCode, token: document.getElementById('code').value.trim(), type: 'email' });
        btn.disabled = false;
        if (error) toast(/expired|invalid/i.test(error.message || '') ? 'That code did not work or has expired. Ask for a new one.' : 'Could not sign you in: ' + error.message);
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
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
        btn.disabled = false;
        if (error) {
          const m = (error.message || '').toLowerCase();
          if (error.status === 429 || m.includes('rate') || m.includes('seconds')) toast('Too many codes asked for. Wait a minute, then try again.');
          else if (m.includes('signup') || m.includes('not found') || m.includes('not allowed')) toast('That email does not have BrainStorm access yet. Ask your manager.');
          else toast('Could not send your code: ' + (error.message || 'please try again.'));
          return;
        }
        S.emailForCode = email; viewSignIn('code');
      };
    }
  }

  // ---------- load ----------
  async function loadBasics() {
    const uid = S.session.user.id;
    const [roles, rules, me, sites, biz, stickers] = await Promise.all([
      sb.from('roles').select('code,label,rank'),
      sb.from('system_rules').select('key,value'),
      sb.from('members').select('*').eq('auth_user_id', uid).eq('status', 'active').maybeSingle(),
      sb.from('sites').select('id,name,business_id'),
      sb.from('businesses').select('id,name,slug'),
      sb.from('lookup_lists').select('code,label').eq('list', 'sticker')
    ]);
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
    const people = await sb.from('members').select('id,full_name,display_name,role_code,site_id,business_id,status,avatar_url').eq('status', 'active');
    (people.data || []).forEach((p) => { S.people[p.id] = p; });
    return true;
  }

  async function loadChannels() {
    const { data, error } = await sb.from('channel_members')
      .select('channel_id,last_read_at,channels(id,kind,name,description,business_id,site_id,archived_at)')
      .eq('member_id', S.me.id).is('removed_at', null);
    if (error) { toast('Could not load your chats'); return; }
    const rows = (data || []).filter((r) => r.channels && !r.channels.archived_at);
    const dmIds = rows.filter((r) => r.channels.kind === 'dm').map((r) => r.channel_id);
    const others = {};
    if (dmIds.length) {
      const { data: mem } = await sb.from('channel_members').select('channel_id,member_id').in('channel_id', dmIds).is('removed_at', null);
      (mem || []).forEach((m) => { if (m.member_id !== S.me.id) others[m.channel_id] = m.member_id; });
    }
    S.channels = await Promise.all(rows.map(async (r) => {
      const [last, unread, urgent, mentioned] = await Promise.all([
        sb.from('messages').select('body,author_id,created_at').eq('channel_id', r.channel_id).order('created_at', { ascending: false }).limit(1),
        sb.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', r.channel_id).gt('created_at', r.last_read_at).neq('author_id', S.me.id),
        sb.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', r.channel_id).gt('created_at', r.last_read_at).eq('urgent', true),
        sb.from('messages').select('id', { count: 'exact', head: true }).eq('channel_id', r.channel_id).gt('created_at', r.last_read_at).contains('mentions', [S.me.id])
      ]);
      const c = r.channels;
      const lastMsg = last.data && last.data[0];
      return {
        id: c.id, kind: c.kind, description: c.description, site_id: c.site_id,
        name: c.kind === 'dm' ? nameOf(others[c.id]) : c.name,
        other: others[c.id] || null,
        last: lastMsg ? `${lastMsg.author_id === S.me.id ? 'You' : nameOf(lastMsg.author_id).split(' ')[0]}: ${lastMsg.body}` : 'No messages yet',
        lastAt: lastMsg ? lastMsg.created_at : null,
        unread: unread.count || 0,
        urgent: (urgent.count || 0) > 0,
        mentioned: (mentioned.count || 0) > 0
      };
    }));
    S.channels.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  }

  async function countRequests() {
    if (!can('access_approver_min_rank')) { S.pendingRequests = 0; return; }
    const { count } = await sb.from('access_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    S.pendingRequests = count || 0;
  }

  // ---------- home ----------
  function rowHtml(c) {
    const av = c.kind === 'announcement' ? `<div class="av ann">${icon.megaphone}</div>`
      : c.kind === 'channel' ? '<div class="av sq">#</div>'
      : avatar(c.other);
    return `<button class="row${c.urgent ? ' urgent' : c.unread ? ' unread' : ''}" data-open="${c.id}">${av}
      <div class="mid"><div class="name"><span>${esc(c.name)}</span><small>${c.lastAt ? when(c.lastAt) : ''}</small></div>
      <div class="last">${esc(c.last).replace(/:sticker:[a-z-]+:/g, '[sticker]')}</div></div>
      ${c.urgent ? '<div class="pill-urgent">URGENT</div>' : c.mentioned ? '<div class="badge mention">@</div>' : c.unread ? `<div class="badge">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}</button>`;
  }

  function shell(inner) {
    const approver = can('access_approver_min_rank');
    app.innerHTML = `${inner}
      <nav class="tabs" aria-label="Main">
        <button data-tab="chats" ${S.tab === 'chats' ? 'aria-current="page"' : ''}>${icon.chats}Chats</button>
        ${approver ? `<button data-tab="requests" ${S.tab === 'requests' ? 'aria-current="page"' : ''}>${icon.inbox}Requests${S.pendingRequests ? '<span class="dot"></span>' : ''}</button>` : ''}
        <button data-tab="me" ${S.tab === 'me' ? 'aria-current="page"' : ''}>${icon.me}Me</button>
      </nav>`;
    app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; route(); }; });
  }

  function viewHome(filter = '') {
    const f = filter.toLowerCase();
    const list = S.channels.filter((c) => !f || c.name.toLowerCase().includes(f) || c.last.toLowerCase().includes(f));
    const ann = list.filter((c) => c.kind === 'announcement'), rooms = list.filter((c) => c.kind === 'channel'), dms = list.filter((c) => c.kind === 'dm');
    const canNew = can('private_chat_min_rank') || can('room_creator_min_rank');
    shell(`
      <header class="top"><img class="logo" src="${logoSrc()}" alt=""><img class="wm" src="${wmSrc(true)}" alt="BrainStorm"><div class="grow"></div>
        ${canNew ? `<button class="iconbtn primary" id="new" aria-label="New chat or room">${icon.plus}</button>` : ''}</header>
      <label class="search">${icon.search}<input id="q" placeholder="Search messages and people" aria-label="Search messages and people" value="${esc(filter)}"></label>
      <main class="list">
        ${ann.length ? `<div class="section s-ann">Announcements</div>${ann.map(rowHtml).join('')}` : ''}
        ${rooms.length ? `<div class="section s-room">Channels</div>${rooms.map(rowHtml).join('')}` : ''}
        ${dms.length ? `<div class="section s-dm">Direct messages</div>${dms.map(rowHtml).join('')}` : ''}
        ${!list.length ? `<div class="empty">${f ? 'Nothing matches that search.' : 'No chats yet. Your manager will add you to your site room.'}</div>` : ''}
      </main>`);
    app.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openChannel(b.dataset.open); });
    const q = document.getElementById('q');
    q.oninput = () => { const pos = q.selectionStart; viewHome(q.value); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
    const nb = document.getElementById('new'); if (nb) nb.onclick = sheetNew;
  }

  // ---------- conversation ----------
  async function openChannel(id) {
    S.current = S.channels.find((c) => c.id === id);
    if (!S.current) return;
    S.tab = 'chat';
    const [{ data }, mem] = await Promise.all([
      sb.from('messages').select('id,author_id,body,created_at,edited_at,removed_at,urgent,mentions')
        .eq('channel_id', id).order('created_at', { ascending: false }).limit(80),
      sb.from('channel_members').select('member_id').eq('channel_id', id).is('removed_at', null)
    ]);
    S.messages = (data || []).reverse();
    S.roomPeople = (mem.data || []).map((r) => r.member_id);
    S.files = {};
    await loadFiles(S.messages.map((m) => m.id));
    viewConversation();
    sb.rpc('mark_read', { p_channel: id });
    if (S.roomSub) sb.removeChannel(S.roomSub);
    S.roomSub = sb.channel('room-' + id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + id }, (p) => {
        if (!S.current || S.current.id !== id) return;
        const m = p.new;
        const i = S.messages.findIndex((x) => x.id === m.id);
        if (i >= 0) S.messages[i] = m; else S.messages.push(m);
        setTimeout(async () => { await loadFiles([m.id]); drawMessages(true); }, 700);
        drawMessages(true);
        sb.rpc('mark_read', { p_channel: id });
      }).subscribe();
  }

  async function loadFiles(ids) {
    if (!ids.length) return;
    const { data } = await sb.from('attachments').select('message_id,storage_path,file_name,mime_type,bytes').in('message_id', ids);
    for (const f of (data || [])) {
      const { data: u } = await sb.storage.from('attachments').createSignedUrl(f.storage_path, 3600);
      f.url = u ? u.signedUrl : null;
      (S.files[f.message_id] = S.files[f.message_id] || []).push(f);
    }
  }
  function fileHtml(f) {
    if (!f.url) return '';
    if (f.mime_type.startsWith('image/')) return `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img class="photo" src="${esc(f.url)}" alt="${esc(f.file_name)}" loading="lazy"></a>`;
    return `<a class="filecard" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="ft">PDF</span><span><b>${esc(f.file_name)}</b><small>${Math.max(1, Math.round(f.bytes / 1024))} KB</small></span></a>`;
  }
  function msgHtml(m) {
    const files = (S.files[m.id] || []).map(fileHtml).join('');
    const body = m.removed_at ? 'Message removed' : renderBody(m.body, m.mentions);
    if (m.urgent && !m.removed_at) {
      return `<div class="urgent"><div class="ul">URGENT · ${esc(nameOf(m.author_id).toUpperCase())} · ${when(m.created_at)}</div><div class="body">${body}</div>${files}</div>`;
    }
    return `<div class="msg ${m.removed_at ? 'removed' : ''}">${avatar(m.author_id)}
      <div style="flex:1;min-width:0"><div class="who"><b>${esc(nameOf(m.author_id))}</b><small>${when(m.created_at)}${m.edited_at ? ' · edited' : ''}</small></div>
      <div class="body">${body}</div>${files}</div></div>`;
  }
  function drawMessages(scroll) {
    const box = document.getElementById('msgs'); if (!box) return;
    box.innerHTML = S.messages.length ? S.messages.map(msgHtml).join('') : '<div class="empty">No messages yet. Say hello.</div>';
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  function viewConversation() {
    const c = S.current;
    const readOnly = c.kind === 'announcement' && !can('room_creator_min_rank');
    const sub = c.kind === 'dm' ? 'Private chat' : c.kind === 'announcement' ? 'Announcements' : (c.description || (S.sites[c.site_id] ? S.sites[c.site_id].name : 'Room'));
    const manage = c.kind !== 'dm' && can('room_creator_min_rank');
    app.innerHTML = `
      <header class="conv"><button class="iconbtn back" id="back" aria-label="Back to chats">${icon.back}</button>
        <div class="t"><div class="n">${c.kind === 'channel' ? '<span class="hash">#</span> ' : ''}${esc(c.name)}</div><div class="s">${esc(sub)}</div></div>
        <button class="iconbtn" id="who" aria-label="People in this chat">${icon.people}</button></header>
      <div class="msgs" id="msgs"></div>
      ${readOnly ? '<div class="readonly">Announcements are read-only</div>' : `
      <form class="composer" id="send">
        <button class="iconbtn" type="button" id="attach" aria-label="Add a photo or PDF">${icon.clip}</button>
        <input type="file" id="file" accept="image/*,application/pdf" hidden>
        ${can('urgent_min_rank') ? `<button class="iconbtn" type="button" id="urg" aria-pressed="false" aria-label="Mark as urgent">${icon.bolt}</button>` : ''}
        <textarea id="text" rows="1" placeholder="Message ${esc(c.kind === 'dm' ? c.name : '#' + c.name)}" aria-label="Write a message" maxlength="8000"></textarea>
        <button class="iconbtn primary" type="submit" aria-label="Send">${icon.send}</button>
      </form>`}`;
    drawMessages(true);
    document.getElementById('back').onclick = async () => { S.tab = 'chats'; S.current = null; if (S.roomSub) { sb.removeChannel(S.roomSub); S.roomSub = null; } await loadChannels(); route(); };
    document.getElementById('who').onclick = () => sheetPeople(c, manage);
    const form = document.getElementById('send');
    if (form) {
      const ta = document.getElementById('text');
      ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
      ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); form.requestSubmit(); } };
      let urgent = false;
      const ub = document.getElementById('urg');
      if (ub) ub.onclick = () => { urgent = !urgent; ub.setAttribute('aria-pressed', String(urgent)); ub.classList.toggle('on', urgent); };
      const mentionsIn = (text) => (S.roomPeople || []).filter((id) => {
        const p = S.people[id]; if (!p || id === S.me.id) return false;
        const t = text.toLowerCase();
        return t.includes('@' + p.full_name.toLowerCase()) || t.includes('@' + p.full_name.split(' ')[0].toLowerCase());
      });
      async function send(body, file) {
        const row = { channel_id: c.id, author_id: S.me.id, body, mentions: mentionsIn(body) };
        if (urgent) row.urgent = true;
        const { data, error } = await sb.from('messages').insert(row).select('id').single();
        if (error) { toast(error.message || 'Message not sent'); return false; }
        if (file) {
          const path = `${c.id}/${crypto.randomUUID()}/${file.name.replace(/[^\w.\-]+/g, '_').slice(-80)}`;
          const up = await sb.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
          if (up.error) { toast('The file could not be uploaded (photos and PDFs up to 15 MB)', true); return false; }
          await sb.from('attachments').insert({ message_id: data.id, storage_path: path, file_name: file.name, mime_type: file.type, bytes: file.size });
          await loadFiles([data.id]); drawMessages(true);
        }
        if (urgent && ub) ub.click();
        return true;
      }
      form.onsubmit = async (e) => {
        e.preventDefault();
        const body = ta.value.trim(); if (!body) return;
        ta.value = ''; ta.style.height = 'auto';
        if (!(await send(body))) ta.value = body;
      };
      const fi = document.getElementById('file');
      document.getElementById('attach').onclick = () => fi.click();
      fi.onchange = async () => {
        const f = fi.files[0]; fi.value = ''; if (!f) return;
        if (f.size > 15728640) return toast('That file is over 15 MB', true);
        const caption = ta.value.trim() || f.name; ta.value = '';
        toast('Uploading…');
        await send(caption, f);
      };
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
  function personRow(p, type) {
    const site = S.sites[p.site_id] ? S.sites[p.site_id].name : (S.businesses[p.business_id] ? S.businesses[p.business_id].name : 'All businesses');
    return `<label class="pick"><input type="${type}" name="p" value="${p.id}">${avatar(p.id)}
      <div><div style="font-weight:700">${esc(p.display_name || p.full_name)}</div><div class="meta">${esc(S.roles[p.role_code] ? S.roles[p.role_code].label : '')} · ${esc(site)}</div></div></label>`;
  }
  function peopleOptions(type, exclude = []) {
    return Object.values(S.people).filter((p) => p.id !== S.me.id && !exclude.includes(p.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name)).map((p) => personRow(p, type)).join('');
  }

  function sheetNew() {
    const dm = can('private_chat_min_rank'), room = can('room_creator_min_rank');
    const s = sheet(`<h2>Start something</h2>
      ${dm ? '<button class="btn" id="nDm" style="width:100%;margin-bottom:10px">New private chat</button>' : ''}
      ${room ? '<button class="btn ghost" id="nRoom" style="width:100%">New room</button>' : ''}`);
    if (dm) s.querySelector('#nDm').onclick = () => { s.remove(); sheetDm(); };
    if (room) s.querySelector('#nRoom').onclick = () => { s.remove(); sheetRoom(); };
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
      <label class="field">Room name<input class="input" id="rn" required maxlength="60" placeholder="e.g. little-monkeys-team"></label>
      <label class="field" style="margin-top:10px">What it's for (optional)<input class="input" id="rd" maxlength="140"></label>
      <label class="pick" style="margin-top:6px"><input type="checkbox" id="ann"><div><div style="font-weight:700">Announcements only</div><div class="meta">Only managers and above can post</div></div></label>
      <div class="section s-room">Add people</div>${peopleOptions('checkbox')}
      <div class="actions"><button type="button" class="btn ghost" id="x">Cancel</button><button class="btn" type="submit">Create room</button></div></form>`);
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const ids = [...s.querySelectorAll('input[name=p]:checked')].map((i) => i.value);
      const { data, error } = await sb.rpc('create_room', {
        p_name: s.querySelector('#rn').value.trim().toLowerCase().replace(/\s+/g, '-'),
        p_description: s.querySelector('#rd').value.trim() || null,
        p_business: S.me.business_id, p_site: S.me.site_id, p_members: ids,
        p_announcement: s.querySelector('#ann').checked
      });
      if (error) return toast(error.message);
      s.remove(); await loadChannels(); openChannel(data);
    };
  }

  async function sheetPeople(c, manage) {
    const { data } = await sb.from('channel_members').select('member_id').eq('channel_id', c.id).is('removed_at', null);
    const ids = (data || []).map((r) => r.member_id);
    const s = sheet(`<h2>People here (${ids.length})</h2>
      ${ids.map((id) => S.people[id] ? `<div class="pick" style="cursor:default">${avatar(id)}<div style="flex:1"><b>${esc(nameOf(id))}</b><div class="meta">${esc(S.roles[S.people[id].role_code] ? S.roles[S.people[id].role_code].label : '')}</div></div>
        ${manage && id !== S.me.id ? `<button class="btn ghost small" data-rm="${id}">Remove</button>` : ''}</div>` : '').join('')}
      ${manage ? `<div class="section s-room">Add people</div><form id="add">${peopleOptions('checkbox', ids)}<div class="actions"><button class="btn" type="submit">Add selected</button></div></form>` : ''}
      <div class="actions"><button class="btn ghost" id="x">Close</button></div>`);
    s.querySelector('#x').onclick = () => s.remove();
    s.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = async () => {
        const { error } = await sb.rpc('remove_from_room', { p_channel: c.id, p_member: b.dataset.rm });
        if (error) return toast(error.message);
        s.remove(); sheetPeople(c, manage);
      };
    });
    const add = s.querySelector('#add');
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      for (const i of add.querySelectorAll('input[name=p]:checked')) {
        const { error } = await sb.rpc('add_to_room', { p_channel: c.id, p_member: i.value });
        if (error) toast(`${nameOf(i.value)}: ${error.message.replace(/^BrainStorm rule: /, '')}`);
      }
      s.remove(); sheetPeople(c, manage);
    };
  }

  // ---------- requests (senior management) ----------
  async function viewRequests() {
    const { data } = await sb.from('access_requests').select('*').eq('status', 'pending').order('created_at');
    const reqs = data || [];
    shell(`<header class="top"><img class="logo" src="${logoSrc()}" alt=""><h1>Access <span style="color:var(--yellow)">requests</span></h1></header>
      <main class="list">${reqs.length ? reqs.map((r) => `
        <div class="req"><b>${esc(r.full_name)}</b>
          <div class="meta">${esc(r.email)}<br>${esc(S.businesses[r.business_id] ? S.businesses[r.business_id].name : '')} · ${esc(S.sites[r.site_id] ? S.sites[r.site_id].name : 'No site given')} · ${esc(S.roles[r.role_code] ? S.roles[r.role_code].label : r.role_code)}<br>
          Requested from the ${r.source === 'hub' ? 'Hub' : r.source === 'mothership' ? 'Mothership' : 'app'}${r.requested_by_name ? ' by ' + esc(r.requested_by_name) : ''} · ${when(r.created_at)}</div>
          <div class="actions"><button class="btn danger small" data-dec="${r.id}">Decline</button><button class="btn small" data-ok="${r.id}">Approve</button></div></div>`).join('')
        : '<div class="empty">No requests waiting.</div>'}</main>`);
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
    app.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => decide(b.dataset.ok, true); });
    app.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => decide(b.dataset.dec, false); });
  }

  // ---------- me ----------
  function viewMe() {
    const m = S.me;
    const ios = /iphone|ipad/i.test(navigator.userAgent) && !window.navigator.standalone;
    shell(`<header class="top"><img class="logo" src="${logoSrc()}" alt=""><h1>Me</h1></header>
      <main class="list" style="padding:8px 16px">
        <div class="pick" style="cursor:default">${avatar(m.id)}
          <div><b>${esc(m.full_name)}</b><div class="meta">${esc(S.roles[m.role_code] ? S.roles[m.role_code].label : '')} · ${esc(S.sites[m.site_id] ? S.sites[m.site_id].name : (S.businesses[m.business_id] ? S.businesses[m.business_id].name : 'All businesses'))}</div><div class="meta">${esc(m.email || '')}</div></div></div>
        ${ios ? '<p class="note" style="text-align:left;margin:18px 4px">Tip: tap Share, then “Add to Home Screen”. BrainStorm appears as <b>BS</b> on your home screen.</p>' : ''}
        <div class="section s-room" style="padding-left:0">Look</div>
        <div class="themes" role="group" aria-label="Choose a look">${THEMES.map((t) => `<button type="button" data-theme-pick="${t.id}" aria-pressed="${getTheme() === t.id}"><div class="sw">${t.sw.map((c) => `<span style="background:${c}"></span>`).join('')}</div>${t.label}</button>`).join('')}</div>
        <div class="actions" style="margin-top:24px"><button class="btn ghost" id="out">Sign out</button></div>
        <p class="note" style="margin-top:24px">BrainStorm ${esc(cfg.version)} · by Brain Candy Studio</p>
      </main>`);
    document.getElementById('out').onclick = () => sb.auth.signOut();
    app.querySelectorAll('[data-theme-pick]').forEach((b) => {
      b.onclick = async () => {
        applyTheme(b.dataset.themePick); S.me.theme = b.dataset.themePick; viewMe();
        await sb.from('members').update({ theme: S.me.theme }).eq('id', S.me.id);
      };
    });
  }

  // ---------- routing + live list ----------
  function route() {
    if (S.tab === 'requests') return viewRequests();
    if (S.tab === 'me') return viewMe();
    S.tab = 'chats'; return viewHome();
  }

  function watchEverything() {
    if (S.listSub) sb.removeChannel(S.listSub);
    S.listSub = sb.channel('everything')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async () => {
        if (S.tab === 'chats') { await loadChannels(); viewHome(document.getElementById('q') ? document.getElementById('q').value : ''); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, async () => {
        if (S.tab === 'chats') { await loadChannels(); viewHome(); }
      }).subscribe();
  }

  async function start(session) {
    S.session = session;
    if (!session) { S.me = null; viewSignIn('email'); return; }
    app.innerHTML = `<section class="signin"><div class="hero"><img class="storm" src="${heroSrc()}" alt=""><img class="wordmark" src="${wmSrc()}" alt="BrainStorm"></div><div class="signin-panel"><p class="tagline">Loading your chats…</p></div></section>`;
    if (!(await loadBasics())) return;
    await Promise.all([loadChannels(), countRequests()]);
    route();
    watchEverything();
  }

  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') { S.session = session; return; }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
      if (event === 'SIGNED_IN' && started && S.me) { S.session = session; return; }
      started = true; start(session);
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
