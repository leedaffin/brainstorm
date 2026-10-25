/* BrainStorm demo: made-up people and chats, kept on this device only. The app runs in "no signal"
   mode from this saved copy, so nothing is fetched from or sent to the real BrainStorm. */
(function () {
  Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false });
  const now = Date.now(), t = (m) => new Date(now - m * 60000).toISOString();
  const HM = 'b-hm', MM = 'b-mm';
  const people = {
    u1: { id: 'u1', full_name: 'Lee Daffin', role_code: 'owner', business_id: null, status: 'active' },
    u2: { id: 'u2', full_name: 'Gemma Gregory', role_code: 'regional', business_id: MM, status: 'active' },
    u3: { id: 'u3', full_name: 'Ciaran Rutt', role_code: 'manager', business_id: HM, status: 'active' },
    u4: { id: 'u4', full_name: 'Shanice Wells', role_code: 'regional', business_id: MM, status: 'active' },
    u5: { id: 'u5', full_name: 'Ashley Booth', role_code: 'driver', business_id: HM, status: 'active' }
  };
  const ch = (id, name, biz, last, m, unread, extra) => Object.assign({ id, kind: 'channel', name, business_id: biz, site_id: null, last, lastAt: t(m), unread, urgent: false, mentioned: false, other: null }, extra || {});
  const channels = [
    ch('c1', 'Management', HM, 'Gemma: Thanks, that works for Monday', 4, 3, { mentioned: true }),
    ch('c2', 'Technical_Support', HM, 'Ciaran: Printer is back on', 30, 0),
    ch('c3', 'Huntley_Wharf_Management', MM, 'Shanice: Rota for next week is up', 70, 2),
    ch('c4', 'Regional_Management', null, 'You: Expansion plan attached', 200, 0),
    { id: 'c5', kind: 'announcement', name: 'Public', business_id: HM, last: 'You: Halloween menu is live', lastAt: t(900), unread: 0, urgent: false, mentioned: false, other: null },
    { id: 'd1', kind: 'dm', name: 'Ciaran Rutt', other: 'u3', business_id: null, last: 'Ciaran: See you at 9', lastAt: t(15), unread: 1, urgent: false, mentioned: false }
  ];
  const msg = (id, c, a, b, m, extra) => Object.assign({ id, channel_id: c, author_id: a, body: b, created_at: t(m), mentions: [] }, extra || {});
  const msgs = {
    c1: [msg(1, 'c1', 'u2', 'Morning all, quick update on the allergen sheets for next week.', 60), msg(2, 'c1', 'u1', 'Thanks Gemma 👍 can we make sure Craig signs them off by Friday?', 55),
      msg(3, 'c1', 'u3', 'Will do. I have also moved the van check to 8am so it does not clash.', 40), msg(4, 'c1', 'u2', '@Lee the new starter pack is ready to send', 10, { mentions: ['u1'] }),
      msg(5, 'c1', 'u1', 'Brilliant, send it over and I will approve it tonight.', 4)],
    c2: [msg(11, 'c2', 'u3', 'Printer is back on 🎉', 30)],
    c3: [msg(21, 'c3', 'u4', 'Rota for next week is up, shout if anything looks wrong.', 70)],
    c4: [msg(31, 'c4', 'u1', 'Expansion plan attached, have a read before Thursday.', 200)],
    c5: [msg(41, 'c5', 'u1', 'Halloween menu is live 🎃', 900)],
    d1: [msg(51, 'd1', 'u3', 'Morning Lee, are we still on for the site visit?', 25), msg(52, 'd1', 'u1', 'Yes, 9am at the kitchen.', 20), msg(53, 'd1', 'u3', 'See you at 9', 15)]
  };
  const msgAt = {}; Object.keys(msgs).forEach((k) => { msgAt[k] = (channels.find((c) => c.id === k) || {}).lastAt; });
  const cache = { at: now, me: Object.assign({}, people.u1, { auth_user_id: 'u1', is_admin: true, theme: 'matrix', quiet_from: '00:00', quiet_to: '00:00' }),
    roles: { owner: { code: 'owner', rank: 90, label: 'Owner' }, regional: { code: 'regional', rank: 60, label: 'Regional / director' }, manager: { code: 'manager', rank: 50, label: 'Manager' }, driver: { code: 'driver', rank: 10, label: 'Driver' } },
    rules: { private_chat_min_rank: 50, room_creator_min_rank: 50, urgent_min_rank: 60, must_read_min_rank: 40, access_approver_min_rank: 60 }, sites: {},
    businesses: { [HM]: { id: HM, name: 'HungryMoose', slug: 'hungrymoose' }, [MM]: { id: MM, name: 'MonkeyMoos', slug: 'monkeymoos' } },
    stickers: {}, people, dir: {}, channels, msgs, msgAt, bots: {}, saved: [], todos: [{ id: 1, body: 'Ring the van garage about the MOT', created_at: t(120) }] };
  try {
    localStorage.setItem('bs-last-user', 'u1');
    localStorage.setItem('bs-cache-u1', JSON.stringify(cache));
    if (!localStorage.getItem('bs-theme-demo-set')) { localStorage.setItem('bs-theme', 'matrix'); localStorage.setItem('bs-theme-demo-set', '1'); }
    localStorage.setItem('sb-demo-auth-token', JSON.stringify({ access_token: 'demo', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'demo', user: { id: 'u1', aud: 'authenticated', role: 'authenticated' } }));
  } catch (_) {}
})();
