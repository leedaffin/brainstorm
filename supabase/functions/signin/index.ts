// BrainStorm sign-in: sends 6-digit codes from brainstorm@hungrymoose.co.uk / brainstorm@monkeymoos.co.uk
// via Microsoft Graph, and lets one person sign in with any of their work addresses.
// Public endpoint (no JWT): it only ever acts on addresses already on the members list.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false } });

type Sender = { key: string; tenant: string; client: string; secretEnv: string; from: string };
const SENDERS: Record<string, Sender> = {
  hm: { key: 'hm', tenant: '43495a68-ba7c-4afb-a98b-a714b77e94a9', client: 'cbc124c3-1512-4de0-aa81-6380847f89a8', secretEnv: 'MS_HM_SECRET', from: 'brainstorm@hungrymoose.co.uk' },
  mm: { key: 'mm', tenant: 'b6d87541-9fd1-476b-818e-cfcfc5896225', client: 'feea30fd-396a-4ddc-b533-965cfb1642ab', secretEnv: 'MS_MM_SECRET', from: 'brainstorm@monkeymoos.co.uk' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Typed address -> the account it belongs to (main auth email). Null when no access.
async function resolve(email: string): Promise<{ authEmail: string; memberId: string; name: string } | null> {
  let memberId: string | null = null;
  const { data: alias } = await admin.from('member_emails').select('member_id').eq('email', email).is('removed_at', null).maybeSingle();
  if (alias) memberId = alias.member_id;
  const q = admin.from('members').select('id, auth_user_id, status, email, full_name');
  const { data: m } = memberId ? await q.eq('id', memberId).maybeSingle() : await q.ilike('email', email).maybeSingle();
  if (!m || m.status !== 'active') return null;
  if (!m.auth_user_id) {
    // Approved but no sign-in yet (e.g. added directly): create it now.
    const { data: c, error } = await admin.auth.admin.createUser({ email: m.email, email_confirm: true, user_metadata: { full_name: m.full_name } });
    if (error || !c?.user) return null;
    await admin.from('members').update({ auth_user_id: c.user.id }).eq('id', m.id);
    return { authEmail: c.user.email!, memberId: m.id, name: m.full_name };
  }
  const { data: u } = await admin.auth.admin.getUserById(m.auth_user_id);
  if (!u?.user?.email) return null;
  return { authEmail: u.user.email, memberId: m.id, name: m.full_name };
}

const tokenCache: Record<string, { t: string; exp: number }> = {};
async function graphToken(s: Sender): Promise<string> {
  const c = tokenCache[s.key];
  if (c && c.exp > Date.now() + 60_000) return c.t;
  const secret = Deno.env.get(s.secretEnv) ?? Deno.env.get(s.secretEnv.replace('_SECRET', '_Secret')) ?? Deno.env.get(s.secretEnv.toLowerCase());
  if (!secret) throw new Error(`${s.key}: no secret set`);
  const r = await fetch(`https://login.microsoftonline.com/${s.tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: s.client, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${s.key}: token ${r.status} ${j.error_description?.slice(0, 160) ?? j.error}`);
  tokenCache[s.key] = { t: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

const SITE = 'https://brainstorm.braincandystudio.co.uk';
const h = (x: string) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// Branded email shell (Storm look). Table layout + inline styles so it renders in Outlook, Gmail and iPhone Mail.
function emailShell(preheader: string, inner: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>BrainStorm</title></head>
<body style="margin:0;padding:0;background:#05061C;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#05061C">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#05061C" style="background:#05061C">
<tr><td align="center" style="padding:24px 12px 32px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#0A0C33;border:1px solid #232A6E;border-radius:20px;overflow:hidden">
<tr><td style="padding:0;line-height:0"><img src="${SITE}/email/header-storm.jpg" width="600" alt="BrainStorm" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
<tr><td style="padding:8px 32px 8px;font-family:Arial,Helvetica,sans-serif;color:#EEF2FF">${inner}</td></tr>
<tr><td style="padding:0 32px"><div style="height:2px;line-height:2px;font-size:0;background:#2FF4FB;background-image:linear-gradient(90deg,#2FF4FB,#A750F7 55%,#FC70FC)">&nbsp;</div></td></tr>
<tr><td style="padding:18px 32px 26px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
  <td width="40" valign="middle"><img src="${SITE}/email/icon-96.png" width="36" height="36" alt="" style="display:block;border-radius:9px;border:0"></td>
  <td valign="middle" style="padding-left:12px;font-size:12px;line-height:1.5;color:#8E95CC">
    <span style="color:#EEF2FF;font-weight:bold">BrainStorm</span> &middot; the team chat for MonkeyMoos and HungryMoose<br>
    <a href="${SITE}" style="color:#2FF4FB;text-decoration:none">brainstorm.braincandystudio.co.uk</a></td>
  </tr></table></td></tr>
</table>
<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#4B5170">Sent automatically by BrainStorm. Please don&rsquo;t reply to this email.</p>
</td></tr></table></body></html>`;
}

function emailHtml(code: string) {
  const digits = code.split('').map((d) => `<td align="center" valign="middle" width="46" height="58" bgcolor="#11154A" style="width:46px;height:58px;background:#11154A;border:2px solid #2FF4FB;border-radius:12px;font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;color:#FFFFFF;box-shadow:0 0 14px rgba(47,244,251,.55)">${d}</td><td width="8" style="width:8px;font-size:0">&nbsp;</td>`).join('');
  return emailShell(`Your BrainStorm code is ${code}`, `
  <h1 style="margin:8px 0 6px;font-size:24px;line-height:1.25;color:#FFFFFF">Your sign-in code</h1>
  <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#C9CFF5">Type this code into BrainStorm to sign in.</p>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 22px"><tr>${digits}</tr></table>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 22px"><tr>
    <td bgcolor="#11154A" style="background:#11154A;border-left:4px solid #FC70FC;border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.5;color:#C9CFF5">
      <b style="color:#FC70FC">Works once &middot; expires in 1 hour.</b><br>If you didn&rsquo;t ask for this code, you can ignore this email &mdash; nobody can sign in without it.</td>
  </tr></table>`);
}


function welcomeHtml(first: string, email: string, inviter: string) {
  const btn = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 22px"><tr>
    <td align="center" bgcolor="#2FF4FB" style="border-radius:14px;background:#2FF4FB;background-image:linear-gradient(90deg,#2FF4FB,#A750F7 55%,#FC70FC);box-shadow:0 0 18px rgba(167,80,247,.55)">
    <a href="${SITE}" style="display:inline-block;padding:15px 34px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:bold;color:#05061C;text-decoration:none;border-radius:14px">Open BrainStorm</a></td></tr></table>`;
  const step = (n: string, t: string) => `<tr><td width="34" valign="top" style="padding:0 0 12px"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:#11154A;border:1px solid #2FF4FB;color:#2FF4FB;font-weight:bold;font-size:13px;text-align:center">${n}</div></td>
    <td valign="top" style="padding:3px 0 12px 6px;font-size:14px;line-height:1.5;color:#C9CFF5">${t}</td></tr>`;
  return emailShell(`${inviter} has invited you to BrainStorm`, `
  <h1 style="margin:8px 0 6px;font-size:26px;line-height:1.25;color:#FFFFFF">Welcome to BrainStorm, ${first}! <span style="color:#FC70FC">&#9889;</span></h1>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#C9CFF5">${inviter} has added you to <b style="color:#FFFFFF">BrainStorm</b>, our team chat for MonkeyMoos and HungryMoose. It&rsquo;s where announcements, your team groups and messages all live.</p>
  ${btn}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px">
    ${step('1', `Open <a href="${SITE}" style="color:#2FF4FB;text-decoration:none">brainstorm.braincandystudio.co.uk</a> on your phone.`)}
    ${step('2', `Type <b style="color:#FFFFFF">${email}</b> and we&rsquo;ll email you a 6-digit code.`)}
    ${step('3', `On iPhone tap <b style="color:#FFFFFF">Share &rsaquo; Add to Home Screen</b> (on Android: menu &rsaquo; <b style="color:#FFFFFF">Install app</b>) so it sits on your phone like an app.`)}
  </table>`);
}

async function sendMail(to: string, subject: string, html: string) {
  const order = to.endsWith('@hungrymoose.co.uk') ? ['hm', 'mm'] : ['mm', 'hm'];
  const errors: string[] = [];
  for (const k of order) {
    const s = SENDERS[k];
    try {
      const tok = await graphToken(s);
      const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(s.from)}/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: 'HTML', content: html },
            from: { emailAddress: { address: s.from, name: 'BrainStorm' } },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          saveToSentItems: false,
        }),
      });
      if (r.status === 202) return s.from;
      errors.push(`${k}: send ${r.status} ${(await r.text()).slice(0, 200)}`);
    } catch (e) {
      errors.push(String((e as Error).message ?? e));
    }
  }
  throw new Error(errors.join(' | '));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body: { action?: string; email?: string; code?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (body.action === 'drain') {
    // Sends welcome invites that approvers have queued. Safe to call publicly: it only sends what is already queued.
    const { data: rows } = await admin.from('invite_queue').select('id, member_id, email, queued_by').eq('status', 'pending').order('id').limit(25);
    let sent = 0, failed = 0;
    for (const r of rows ?? []) {
      const { data: m } = await admin.from('members').select('full_name, status').eq('id', r.member_id).maybeSingle();
      const { data: by } = r.queued_by ? await admin.from('members').select('full_name').eq('id', r.queued_by).maybeSingle() : { data: null };
      if (!m || m.status !== 'active') { await admin.from('invite_queue').update({ status: 'failed', note: 'not active' }).eq('id', r.id); failed++; continue; }
      await resolve(r.email); // makes sure their sign-in exists
      const inviter = (by?.full_name ?? 'Your manager').split(' ')[0];
      const first = (m.full_name ?? '').split(' ')[0] || 'there';
      try {
        const from = await sendMail(r.email, `${inviter} has invited you to BrainStorm`, welcomeHtml(h(first), h(r.email), h(inviter)));
        await admin.from('invite_queue').update({ status: 'sent', sent_at: new Date().toISOString(), note: from }).eq('id', r.id); sent++;
      } catch (e) {
        await admin.from('invite_queue').update({ status: 'failed', note: String((e as Error).message).slice(0, 480) }).eq('id', r.id); failed++;
      }
    }
    return json({ ok: true, sent, failed });
  }
  if (!EMAIL_RE.test(email) || email.length > 200) return json({ error: 'bad_email' }, 400);

  if (body.action === 'start') {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin.from('signin_sends').select('id', { count: 'exact', head: true }).eq('email', email).gte('at', since);
    if ((count ?? 0) >= 5) return json({ error: 'rate_limited' }, 429);

    const who = await resolve(email);
    if (!who) {
      await admin.from('signin_sends').insert({ email, ok: false, note: 'no_access' });
      return json({ error: 'no_access' }, 403);
    }
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: who.authEmail });
    const code = data?.properties?.email_otp;
    if (error || !code) {
      await admin.from('signin_sends').insert({ email, ok: false, note: 'generate: ' + (error?.message ?? 'no code') });
      return json({ error: 'server' }, 500);
    }
    try {
      const from = await sendMail(email, `Your BrainStorm sign-in code: ${code}`, emailHtml(code));
      await admin.from('signin_sends').insert({ email, ok: true, note: from });
      return json({ ok: true });
    } catch (e) {
      await admin.from('signin_sends').insert({ email, ok: false, note: String((e as Error).message).slice(0, 500) });
      return json({ error: 'send_failed' }, 502);
    }
  }

  if (body.action === 'verify') {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (code.length < 6 || code.length > 8) return json({ error: 'bad_code' }, 400);
    const who = await resolve(email);
    if (!who) return json({ error: 'no_access' }, 403);
    const pub = createClient(SB_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    let res = await pub.auth.verifyOtp({ email: who.authEmail, token: code, type: 'email' });
    if (res.error) res = await pub.auth.verifyOtp({ email: who.authEmail, token: code, type: 'magiclink' });
    if (res.error || !res.data.session) return json({ error: 'bad_code' }, 401);
    const s = res.data.session;
    return json({ access_token: s.access_token, refresh_token: s.refresh_token });
  }

  if (body.action === 'invite') {
    // Only approvers, signed in, can send invites.
    const auth = req.headers.get('Authorization') ?? '';
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: ok } = await asUser.rpc('am_i_approver');
    if (ok !== true) return json({ error: 'not_allowed' }, 403);
    const who = await resolve(email);
    if (!who) return json({ error: 'no_access' }, 403);
    const { data: meU } = await asUser.auth.getUser(auth.replace(/^Bearer /i, ''));
    const { data: me } = await admin.from('members').select('full_name').eq('auth_user_id', meU?.user?.id ?? '').maybeSingle();
    const inviter = (me?.full_name ?? 'Your manager').split(' ')[0];
    const first = (who.name ?? '').split(' ')[0] || 'there';
    try {
      const from = await sendMail(email, `${inviter} has invited you to BrainStorm`, welcomeHtml(h(first), h(email), h(inviter)));
      await admin.from('signin_sends').insert({ email, ok: true, note: 'invite via ' + from });
      return json({ ok: true });
    } catch (e) {
      await admin.from('signin_sends').insert({ email, ok: false, note: 'invite: ' + String((e as Error).message).slice(0, 480) });
      return json({ error: 'send_failed' }, 502);
    }
  }

  return json({ error: 'bad_action' }, 400);
});
