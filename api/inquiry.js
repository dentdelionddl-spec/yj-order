// 오더문의 → 노션 저장 (Vercel Serverless Function)
// 환경변수: NOTION_TOKEN (필수), NOTION_DB_ID (선택, 미설정 시 아래 기본값)

const DB_ID = process.env.NOTION_DB_ID || 'b400cf41ae804765b1b15e3a4b004ba1';
const NOTION_VERSION = '2022-06-28';
const NOTION = 'https://api.notion.com/v1';
const MIN_PER_UNIT = 100; // 컬러·사이즈당 최소 수량

const ITEMS = ['잠옷·파자마', '잠옷원피스', '셔츠·남방', '밴딩슬랙스', '반팔티', '기타'];
const FABRIC = ['확정', '미확정', '공장 소싱 요청'];
const ASSET = ['실물 샘플', '도식화·작업지시서', '사진·이미지만', '없음'];
const SOURCE = ['스레드', '인스타', '직접입력', '기타'];
const GRADE = ['A', 'B', 'C'];
const QCWAY = ['자체검사', '외부검사', '공장 기준 위임'];

const txt = (v, max = 300) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const clamp = (v, lo, hi) => Math.min(Math.max(num(v) || lo, lo), hi);
const pick = (v, list) => (list.includes(v) ? v : null);
const rt = (s) => ({ rich_text: [{ text: { content: s } }] });

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

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

// 이미지 1장을 노션에 업로드하고 file_upload id 반환
async function uploadOne(img) {
  const name = txt(img.name, 80) || 'image.jpg';
  const mime = txt(img.mime, 40) || 'image/jpeg';
  const bytes = Buffer.from(String(img.data || ''), 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) return null;

  const cr = await fetch(NOTION + '/file_uploads', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ filename: name, content_type: mime }),
  });
  const cd = await cr.json();
  if (!cr.ok || !cd.upload_url) { console.error('file_upload create failed', cd); return null; }

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), name);
  const ur = await fetch(cd.upload_url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
      'Notion-Version': NOTION_VERSION,
    },
    body: form,
  });
  if (!ur.ok) { console.error('file_upload send failed', await ur.text()); return null; }
  return { id: cd.id, name: name };
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
  const qcWays = Array.isArray(b.qcWays) ? b.qcWays.filter((i) => QCWAY.includes(i)).slice(0, 3) : [];

  // 발주 구성 — 스타일 수 × 컬러 수 × 사이즈 수 × (컬러·사이즈당 수량)
  const styles = clamp(b.styles, 1, 99);
  const colors = clamp(b.colors, 1, 99);
  const sizes = clamp(b.sizes, 1, 99);
  const perUnit = clamp(b.perUnit, MIN_PER_UNIT, 100000);
  const qty = styles * colors * sizes * perUnit;
  const moqOk = perUnit >= MIN_PER_UNIT;
  const rowsText = styles + '스타일 × ' + colors + '컬러 × ' + sizes + '사이즈 × ' + perUnit.toLocaleString() + '장 = 총 ' + qty.toLocaleString() + '장';

  const email = txt(b.email, 60);
  const dueRaw = txt(b.due, 10);
  const due = (dueRaw.length === 10 && dueRaw[4] === '-' && dueRaw[7] === '-' && !isNaN(Date.parse(dueRaw))) ? dueRaw : null;

  const P = {
    '브랜드·회사명': { title: [{ text: { content: brand } }] },
    '담당자': rt(manager),
    '연락처': { phone_number: phone },
    '진행 상태': { select: { name: '신규' } },
    '등급': { select: { name: pick(b.grade, GRADE) || 'B' } },
    '품목': { multi_select: items.map((n) => ({ name: n })) },
    '스타일 수': { number: styles },
    '컬러 수': { number: colors },
    '사이즈 수': { number: sizes },
    '총 수량': { number: qty },
    'MOQ 충족': { checkbox: !!moqOk },
    '발주 구성': rt(rowsText),
    '유입 경로': { select: { name: pick(txt(b.source), SOURCE) || '스레드' } },
  };
  if (qcWays.length) P['검사 방식'] = { multi_select: qcWays.map((n) => ({ name: n })) };
  if (email) P['이메일'] = { email };
  if (txt(b.kakao, 40)) P['카톡ID'] = rt(txt(b.kakao, 40));
  if (due) P['최종 납기일'] = { date: { start: due } };
  if (pick(txt(b.fabric), FABRIC)) P['원단·부자재'] = { select: { name: txt(b.fabric) } };
  if (pick(txt(b.asset), ASSET)) P['보유 자료'] = { select: { name: txt(b.asset) } };
  if (txt(b.price, 40)) P['희망 단가'] = rt(txt(b.price, 40));
  if (txt(b.channel, 60)) P['판매 채널·현황'] = rt(txt(b.channel, 60));
  if (txt(b.material, 1900)) P['소재 구성'] = rt(txt(b.material, 1900));
  if (txt(b.detailSpec, 1900)) P['디테일 내용'] = rt(txt(b.detailSpec, 1900));
  if (txt(b.sizeSpec, 1900)) P['사이즈 스펙'] = rt(txt(b.sizeSpec, 1900));
  if (txt(b.sewing, 1900)) P['봉제·가공 방식'] = rt(txt(b.sewing, 1900));
  if (txt(b.packing, 1900)) P['포장 명세'] = rt(txt(b.packing, 1900));
  if (txt(b.qc, 1900)) P['QC 기준'] = rt(txt(b.qc, 1900));
  if (txt(b.detail, 1900)) P['상세 내용'] = rt(txt(b.detail, 1900));

  // 상품 이미지 업로드 (실패해도 문의 접수는 진행)
  try {
    const imgs = Array.isArray(b.images) ? b.images.slice(0, 5) : [];
    if (imgs.length) {
      const ups = (await Promise.all(imgs.map((i) => uploadOne(i).catch(() => null)))).filter(Boolean);
      if (ups.length) {
        P['상품 이미지'] = { files: ups.map((u) => ({ type: 'file_upload', file_upload: { id: u.id }, name: u.name })) };
      }
    }
  } catch (e) { console.error('image upload skipped', e); }

  try {
    const r = await fetch(NOTION + '/pages', {
      method: 'POST',
      headers: headers(),
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
