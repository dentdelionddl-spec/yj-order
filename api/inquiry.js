// 오더문의 → 노션 저장 (Vercel Serverless Function)
// 환경변수: NOTION_TOKEN (필수), NOTION_DB_ID (선택, 미설정 시 아래 기본값)

const DB_ID = process.env.NOTION_DB_ID || 'b400cf41ae804765b1b15e3a4b004ba1';
const NOTION_VERSION = '2022-06-28';

const ITEMS = ['잠옷·파자마', '잠옷원피스', '셔츠·남방', '밴딩슬랙스', '반팔티', '기타'];
const FABRIC = ['확정', '미확정', '공장 소싱 요청'];
const ASSET = ['실물 샘플', '도식화·작업지시서', '사진·이미지만', '없음'];
const SOURCE = ['스레드', '인스타', '직접입력', '기타'];
const GRADE = ['A', 'B', 'C'];

const txt = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const pick = (v, list) => (list.includes(v) ? v : null);

// 아주 단순한 인스턴스 단위 레이트리밋 (같은 IP 1분 5회)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < 60000);
  rec.push(now);
  hits.set(ip, rec);
  if (hits.size > 500) hits.clear();
  return rec.length > 5;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not set' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: 'too many requests' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  if (!b || typeof b !== 'object') return res.status(400).json({ error: 'bad body' });

  if (txt(b.company_addr)) return res.status(200).json({ ok: true, no: null }); // 봇 허니팟

  const brand = txt(b.brand, 60);
  const manager = txt(b.manager, 30);
  const phone = txt(b.phone, 30);
  if (!brand || !manager || !phone) return res.status(400).json({ error: 'required fields missing' });

  const items = Array.isArray(b.items) ? b.items.filter((i) => ITEMS.includes(i)).slice(0, 6) : [];
  const styles = num(b.styles) || 1;
  const colors = num(b.colors) || 1;
  const sizes = num(b.sizes) || 1;
  const qty = num(b.qty) || 0;
  const moqOk = qty >= styles * colors * sizes * 100;
  const email = txt(b.email, 60);
  const dueRaw = txt(b.due, 10);
  const due = (dueRaw.length === 10 && dueRaw[4] === '-' && dueRaw[7] === '-' && !isNaN(Date.parse(dueRaw))) ? dueRaw : null;

  const P = {
    '브랜드·회사명': { title: [{ text: { content: brand } }] },
    '담당자': { rich_text: [{ text: { content: manager } }] },
    '연락처': { phone_number: phone },
    '진행 상태': { select: { name: '신규' } },
    '등급': { select: { name: pick(b.grade, GRADE) || (moqOk ? 'B' : 'C') } },
    '품목': { multi_select: items.map((n) => ({ name: n })) },
    '스타일 수': { number: styles },
    '컬러 수': { number: colors },
    '사이즈 수': { number: sizes },
    '총 수량': { number: qty },
    'MOQ 충족': { checkbox: !!moqOk },
    '유입 경로': { select: { name: pick(txt(b.source), SOURCE) || '스레드' } },
  };
  if (email) P['이메일'] = { email };
  if (txt(b.kakao, 40)) P['카톡ID'] = { rich_text: [{ text: { content: txt(b.kakao, 40) } }] };
  if (due) P['희망 납기'] = { date: { start: due } };
  if (pick(txt(b.fabric), FABRIC)) P['원단·부자재'] = { select: { name: txt(b.fabric) } };
  if (pick(txt(b.asset), ASSET)) P['보유 자료'] = { select: { name: txt(b.asset) } };
  if (txt(b.price, 40)) P['희망 단가'] = { rich_text: [{ text: { content: txt(b.price, 40) } }] };
  if (txt(b.channel, 60)) P['판매 채널·현황'] = { rich_text: [{ text: { content: txt(b.channel, 60) } }] };
  if (txt(b.detail, 1900)) P['상세 내용'] = { rich_text: [{ text: { content: txt(b.detail, 1900) } }] };

  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: DB_ID }, properties: P }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('notion error', data);
      return res.status(502).json({ error: data.message || 'notion error' });
    }
    const no = data.properties?.['문의번호']?.unique_id?.number ?? null;
    return res.status(200).json({ ok: true, no });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
