// 노션 첨부 이미지 중계 (내부용) — 캔버스에서 그릴 수 있도록 동일 출처로 프록시
// 환경변수: ADMIN_KEY (필수)

const ALLOW = /(^|\.)(amazonaws\.com|notion-static\.com|notion\.so|notion\.com)$/i;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY not set' });

  const key = (req.query && req.query.key) || '';
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });

  const url = (req.query && req.query.url) || '';
  let u;
  try { u = new URL(url); } catch (e) { return res.status(400).json({ error: 'bad url' }); }
  if (u.protocol !== 'https:' || !ALLOW.test(u.hostname)) {
    return res.status(400).json({ error: 'host not allowed' });
  }

  try {
    const r = await fetch(u.toString());
    if (!r.ok) return res.status(502).json({ error: 'fetch failed ' + r.status });
    const ct = r.headers.get('content-type') || 'image/jpeg';
    if (ct.indexOf('image/') !== 0) return res.status(415).json({ error: 'not an image' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'private, max-age=600');
    return res.status(200).send(buf);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
