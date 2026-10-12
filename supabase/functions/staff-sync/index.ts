// BrainStorm staff link: pulls staff + today's whereabouts (and staff photos) from Mothership (MonkeyMoos)
// and the HungryMoose Hub, and applies them to BrainStorm. Safe to call publicly: no input, returns only counts.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SOURCES = [
  { name: 'mothership', url: 'https://rmnkzmpxnzzzlruxobyh.supabase.co', keys: ['MOTHERSHIP_KEY', 'Mothership_Key', 'mothership_key'], photos: true },
  { name: 'hub', url: 'https://zxaxwreeogcowhtfldwo.supabase.co', keys: ['HUB_KEY', 'MOOSEHUB_KEY', 'MooseHUB_Key', 'MooseHub_Key', 'moosehub_key', 'hub_key'], photos: false },
];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
function keyFor(names: string[]) {
  for (const n of names) { const v = Deno.env.get(n); if (v) return v.trim(); }
  const want = names.map((n) => n.toLowerCase());
  for (const [k, v] of Object.entries(Deno.env.toObject())) if (want.includes(k.toLowerCase()) && v) return v.trim();
  return null;
}
async function rpc(url: string, key: string, fn: string, body: unknown = {}) {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

// Copies new or changed photos into BrainStorm's avatars store and points each person's avatar at it.
// Anyone who has uploaded their own picture in BrainStorm keeps it: the Mothership photo never overwrites it.
async function syncPhotos(src: { name: string; url: string }, key: string) {
  const times: Record<string, string> = await rpc(src.url, key, 'brainstorm_photo_times');
  const refs = Object.keys(times);
  if (!refs.length) return 0;
  const { data: mem } = await admin.from('members').select('id, source_ref, photo_at, own_avatar_at').in('source_ref', refs.map((r) => `${src.name}:${r}`));
  const need = (mem ?? []).filter((m) => { if (m.own_avatar_at) return false; const t = times[m.source_ref.split(':')[1]]; return t && (!m.photo_at || new Date(t) > new Date(m.photo_at)); });
  if (!need.length) return 0;
  const rows: { ref: string; image: string; updated_at: string }[] = await rpc(src.url, key, 'brainstorm_photos', { p_ids: need.map((m) => m.source_ref.split(':')[1]) });
  let done = 0;
  for (const row of rows) {
    const m = need.find((x) => x.source_ref === `${src.name}:${row.ref}`); if (!m) continue;
    const match = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(row.image); if (!match) continue;
    const bytes = Uint8Array.from(atob(match[3]), (c) => c.charCodeAt(0));
    const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
    const path = `${m.id}.${ext}`;
    const up = await admin.storage.from('avatars').upload(path, bytes, { contentType: match[1], upsert: true, cacheControl: '86400' });
    if (up.error) continue;
    const { data: pub } = admin.storage.from('avatars').getPublicUrl(path);
    const v = new Date(row.updated_at).getTime();
    await admin.from('members').update({ avatar_url: `${pub.publicUrl}?v=${v}`, photo_at: row.updated_at }).eq('id', m.id).is('own_avatar_at', null);
    done++;
  }
  return done;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const force = new URL(req.url).searchParams.get('check') === '1';
  const { data: last } = await admin.from('staff_sync_log').select('at').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!force && last && Date.now() - new Date(last.at).getTime() < 120_000) return json({ ok: true, skipped: 'ran recently' });
  const out: Record<string, unknown> = {};
  for (const s of SOURCES) {
    const key = keyFor(s.keys);
    if (!key) { out[s.name] = 'no key yet'; continue; }
    try {
      const feed = await rpc(s.url, key, 'brainstorm_feed');
      const { data, error } = await admin.rpc('apply_staff_feed', { feed });
      const res: Record<string, unknown> = error ? { error: `apply failed: ${error.message}` } : { ...data };
      if (!error && s.photos) {
        try { res.photos = await syncPhotos(s, key); } catch (e) { res.photos = `error: ${String((e as Error).message).slice(0, 120)}`; }
      }
      out[s.name] = res;
    } catch (e) {
      out[s.name] = `error: ${String((e as Error).message ?? e).slice(0, 160)}`;
    }
  }
  return json({ ok: true, ...out });
});
