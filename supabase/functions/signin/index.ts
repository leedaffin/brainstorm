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
async function resolve(email: string): Promise<{ authEmail: string; memberId: string } | null> {
  let memberId: string | null = null;
  const { data: alias } = await admin.from('member_emails').select('member_id').eq('email', email).maybeSingle();
  if (alias) memberId = alias.member_id;
  const q = admin.from('members').select('id, auth_user_id, status');
  const { data: m } = memberId ? await q.eq('id', memberId).maybeSingle() : await q.ilike('email', email).maybeSingle();
  if (!m || m.status !== 'active' || !m.auth_user_id) return null;
  const { data: u } = await admin.auth.admin.getUserById(m.auth_user_id);
  if (!u?.user?.email) return null;
  return { authEmail: u.user.email, memberId: m.id };
}

const tokenCache: Record<string, { t: string; exp: number }> = {};
async function graphToken(s: Sender): Promise<string> {
  const c = tokenCache[s.key];
  if (c && c.exp > Date.now() + 60_000) return c.t;
  const secret = Deno.env.get(s.secretEnv);
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

function emailHtml(code: string) {
  return `<!doctype html><html><body style="margin:0;background:#05061C;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#05061C;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#0A0C33;border:1px solid #232A6E;border-radius:16px;padding:28px">
<tr><td style="color:#2FF4FB;font-size:22px;font-weight:bold;letter-spacing:.5px">Brain<span style="color:#FC70FC">Storm</span></td></tr>
<tr><td style="color:#EEF2FF;font-size:15px;padding-top:16px">Your sign-in code is:</td></tr>
<tr><td style="padding:14px 0"><div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#05061C;background:#2FF4FB;border-radius:12px;padding:14px 0;text-align:center">${code}</div></td></tr>
<tr><td style="color:#8E95CC;font-size:13px;line-height:1.5">Type it into BrainStorm to sign in. It works once and expires in 1 hour.<br>If you didn't ask for this, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendCode(to: string, code: string) {
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
            subject: `Your BrainStorm sign-in code: ${code}`,
            body: { contentType: 'HTML', content: emailHtml(code) },
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
      const from = await sendCode(email, code);
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

  return json({ error: 'bad_action' }, 400);
});
