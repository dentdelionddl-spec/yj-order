// 일별 방문 · 퍼널 집계 — 노션 '방문 통계' DB에 날짜별로 누적
// 환경변수: NOTION_TOKEN(필수), VISIT_DB_ID(선택), META_PIXEL_ID(선택 — 있으면 응답에 실어 픽셀을 켬)
//
// 요청 두 가지
//  - 방문: { ref, first, utm:{source,medium,...} }  → 방문 · 순방문 · 유입처 칸 +1
//  - 퍼널: { step: '폼 시작' } → 해당 칸 +1

const DB_ID = process.env.VISIT_DB_ID || '22b96ecfb203408295a3f8755c6935b6';
const NOTION_VERSION = '2022-06-28';
const NOTION = 'https://api.notion.com/v1';
const STEPS = ['폼 시작']; // 미싱맨은 한 페이지 폼 — 폼 시작만 집계
const SOURCES = ['메타광고', '스레드', '인스타', '직접', '기타'];

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// 한국 시간 기준 날짜
function todayKST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 유입처 분류 — UTM이 있으면 UTM 우선, 없으면 리퍼러
export function bucket(ref, host, utm) {
  const s = String((utm && utm.source) || '').toLowerCase();
  const m = String((utm && utm.medium) || '').toLowerCase();
  if (s) {
    if (/^(fb|facebook|meta|ig|instagram|an)$/.test(s) && /(paid|cpc|cpm|ad|ads|meta)/.test(m)) return '메타광고';
    if (/meta|facebook|^fb$/.test(s)) return '메타광고';
    if (s.indexOf('thread') > -1 || s.indexOf('스레드') > -1) return '스레드';
    if (s.indexOf('insta') > -1 || s === 'ig' || s.indexOf('인스타') > -1) return '인스타';
    if (s.indexOf('메타') > -1) return '메타광고';
    return '기타';
  }
  const r = String(ref || '').toLowerCase();
  if (!r) return '직접';
  if (host && r.indexOf(String(host).toLowerCase()) > -1) return null;
  if (r.indexOf('threads') > -1) return '스레드';
  if (r.indexOf('instagram') > -1 || r.indexOf('cdninstagram') > -1) return '인스타';
  if (r.indexOf('facebook') > -1 || r.indexOf('fb.') > -1) return '메타광고';
  return '기타';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.NOTION_TOKEN || !DB_ID) return res.status(500).json({ error: 'NOTION_TOKEN / VISIT_DB_ID not set' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') b = {};
  const day = todayKST();
  const pixel = process.env.META_PIXEL_ID || '';

  // 이번 요청에서 올릴 칸들
  const inc = {};
  if (b.step) {
    if (STEPS.indexOf(b.step) === -1) return res.status(400).json({ error: 'bad step' });
    inc[b.step] = 1;
  } else {
    const src = bucket(b.ref, req.headers && req.headers.host, b.utm);
    if (src === null) return res.status(200).json({ ok: true, skipped: 'internal', pixel });
    inc['방문'] = 1;
    if (b.first === true || b.first === 'true') inc['순방문'] = 1;
    inc[src] = 1;
  }

  try {
    const q = await fetch(NOTION + '/databases/' + DB_ID + '/query', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ page_size: 1, filter: { property: '일자', date: { equals: day } } }),
    });
    const qd = await q.json();
    if (!q.ok) return res.status(502).json({ error: qd.message || 'notion error' });

    const num = (p) => (p && p.number != null ? p.number : 0);
    const row = (qd.results || [])[0];

    if (!row) {
      const props = { '날짜': { title: [{ text: { content: day } }] }, '일자': { date: { start: day } } };
      ['방문', '순방문'].concat(SOURCES, STEPS).forEach((k) => { props[k] = { number: inc[k] || 0 }; });
      const c = await fetch(NOTION + '/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ parent: { database_id: DB_ID }, properties: props }),
      });
      const cd = await c.json();
      if (!c.ok) return res.status(502).json({ error: cd.message || 'notion error' });
      return res.status(200).json({ ok: true, day, created: true, pixel });
    }

    const P = row.properties || {};
    const props = {};
    Object.keys(inc).forEach((k) => { props[k] = { number: num(P[k]) + inc[k] }; });
    const u = await fetch(NOTION + '/pages/' + row.id, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ properties: props }),
    });
    const ud = await u.json();
    if (!u.ok) return res.status(502).json({ error: ud.message || 'notion error' });
    return res.status(200).json({ ok: true, day, updated: true, pixel });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
