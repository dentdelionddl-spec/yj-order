// 일별 방문 집계 — 노션 '방문 통계' DB에 날짜별로 누적
// 환경변수: NOTION_TOKEN(필수), VISIT_DB_ID(선택)

const DB_ID = process.env.VISIT_DB_ID || '22b96ecfb203408295a3f8755c6935b6';
const NOTION_VERSION = '2022-06-28';
const NOTION = 'https://api.notion.com/v1';

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// 한국 시간 기준 날짜
function todayKST() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

function bucket(ref) {
  const r = String(ref || '').toLowerCase();
  if (!r) return '직접';
  if (r.indexOf('threads') > -1) return '스레드';
  if (r.indexOf('instagram') > -1 || r.indexOf('cdninstagram') > -1) return '인스타';
  if (r.indexOf('yj-order') > -1) return null;
  return '기타';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const day = todayKST();
  const src = bucket(b.ref);
  if (src === null) return res.status(200).json({ ok: true, skipped: 'internal' });
  const isNew = b.first === true || b.first === 'true';

  try {
    // 오늘 행 찾기
    const q = await fetch(NOTION + '/databases/' + DB_ID + '/query', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        page_size: 1,
        filter: { property: '일자', date: { equals: day } },
      }),
    });
    const qd = await q.json();
    if (!q.ok) return res.status(502).json({ error: qd.message || 'notion error' });

    const num = (p) => (p && p.number != null ? p.number : 0);
    const row = (qd.results || [])[0];

    if (!row) {
      const props = {
        '날짜': { title: [{ text: { content: day } }] },
        '일자': { date: { start: day } },
        '방문': { number: 1 },
        '순방문': { number: isNew ? 1 : 0 },
        '스레드': { number: src === '스레드' ? 1 : 0 },
        '인스타': { number: src === '인스타' ? 1 : 0 },
        '직접': { number: src === '직접' ? 1 : 0 },
        '기타': { number: src === '기타' ? 1 : 0 },
      };
      const c = await fetch(NOTION + '/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
      });
      const cd = await c.json();
      if (!c.ok) return res.status(502).json({ error: cd.message || 'notion error' });
      return res.status(200).json({ ok: true, day, created: true });
    }

    const P = row.properties || {};
    const props = {
      '방문': { number: num(P['방문']) + 1 },
      '순방문': { number: num(P['순방문']) + (isNew ? 1 : 0) },
    };
    props[src] = { number: num(P[src]) + 1 };

    const u = await fetch(NOTION + '/pages/' + row.id, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ properties: props }),
    });
    const ud = await u.json();
    if (!u.ok) return res.status(502).json({ error: ud.message || 'notion error' });
    return res.status(200).json({ ok: true, day, updated: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
