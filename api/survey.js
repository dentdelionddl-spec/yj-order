// 문의 완료 화면 — '알게 된 경로' 한 번 탭 저장
// 환경변수: NOTION_TOKEN(필수) · SLACK_WEBHOOK_URL(선택)
import { createHmac, timingSafeEqual } from 'node:crypto';

const NOTION = 'https://api.notion.com/v1';
const OPTIONS = ['인스타그램', '스레드', '메타 광고', '네이버 검색', '구글 검색', '지인 소개', '기존 거래', '기타'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not set' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  const id = String((b && b.id) || '').replace(/[^0-9a-f-]/gi, '').slice(0, 40);
  const tk = String((b && b.tk) || '');
  const answer = String((b && b.answer) || '').trim();
  if (!id || !tk || OPTIONS.indexOf(answer) === -1) return res.status(400).json({ error: 'bad request' });
  const want = createHmac('sha256', process.env.NOTION_TOKEN).update('survey:' + id).digest('hex').slice(0, 32);
  if (want.length !== tk.length || !timingSafeEqual(Buffer.from(want), Buffer.from(tk))) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await fetch(NOTION + '/pages/' + id, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + process.env.NOTION_TOKEN, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: { '알게 된 경로': { select: { name: answer } } } }),
    });
    if (!r.ok) { console.error('survey patch failed', await r.text()); return res.status(502).json({ error: 'notion error' }); }
    return res.status(200).json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'server error' }); }
}
