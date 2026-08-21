// 오더문의 조회 (내부용) — 노션 DB에서 목록/상세를 읽어온다
// 환경변수: NOTION_TOKEN (필수), ADMIN_KEY (필수), NOTION_DB_ID (선택)

const DB_ID = process.env.NOTION_DB_ID || 'b400cf41ae804765b1b15e3a4b004ba1';
const NOTION_VERSION = '2022-06-28';
const NOTION = 'https://api.notion.com/v1';
const STATUS = ['상담 전', '보류', '거절', '샘플 진행', '미팅 예정', '진행', '완료'];
const GRADE = ['A', 'B', 'C'];

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

const txt = (p) => {
  if (!p) return '';
  if (p.type === 'title') return (p.title || []).map((t) => t.plain_text).join('');
  if (p.type === 'rich_text') return (p.rich_text || []).map((t) => t.plain_text).join('');
  if (p.type === 'select') return p.select ? p.select.name : '';
  if (p.type === 'multi_select') return (p.multi_select || []).map((s) => s.name).join(', ');
  if (p.type === 'number') return p.number == null ? '' : p.number;
  if (p.type === 'checkbox') return !!p.checkbox;
  if (p.type === 'date') return p.date ? p.date.start : '';
  if (p.type === 'email') return p.email || '';
  if (p.type === 'phone_number') return p.phone_number || '';
  if (p.type === 'created_time') return p.created_time || '';
  if (p.type === 'unique_id') return p.unique_id ? (p.unique_id.prefix ? p.unique_id.prefix + '-' : '') + p.unique_id.number : '';
  if (p.type === 'files') return (p.files || []).map(function(f){ return (f.file && f.file.url) || (f.external && f.external.url) || ''; }).filter(Boolean);
  return '';
};

function shape(page) {
  const P = page.properties || {};
  return {
    id: page.id,
    no: txt(P['문의번호']),
    brand: txt(P['브랜드·회사명']),
    manager: txt(P['담당자']),
    phone: txt(P['연락처']),
    status: txt(P['진행 상태']),
    grade: txt(P['등급']),
    items: txt(P['품목']),
    styles: txt(P['스타일 수']),
    colors: txt(P['컬러 수']),
    sizes: txt(P['사이즈 수']),
    qty: txt(P['총 수량']),
    moqOk: txt(P['MOQ 충족']),
    compose: txt(P['발주 구성']),
    due: txt(P['최종 납기일']),
    price: txt(P['희망 단가']),
    fabric: txt(P['원단·부자재']),
    asset: txt(P['보유 자료']),
    channel: txt(P['판매 채널·현황']),
    material: txt(P['소재 구성']),
    detailSpec: txt(P['디테일 내용']),
    sizeSpec: txt(P['사이즈 스펙']),
    sewing: txt(P['봉제·가공 방식']),
    packing: txt(P['포장 명세']),
    qc: txt(P['QC 기준']),
    qcWays: txt(P['검사 방식']),
    detail: txt(P['상세 내용']),
    source: txt(P['유입 경로']),
    created: txt(P['접수일시']),
    images: txt(P['상품 이미지']) || [],
    memo: txt(P['메모']),
  };
}

export default async function handler(req, res) {
      var OK_M = ['GET', 'DELETE', 'PATCH'];  if (OK_M.indexOf(req.method) === -1) return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not set' });
  if (!process.env.ADMIN_KEY) return res.status(500).json({ error: 'ADMIN_KEY not set' });

    const key = (req.headers && req.headers['x-admin-key']) || (req.query && req.query.key) || '';
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });

  // 삭제 (노션 휴지통으로 보관 — 복구 가능)
  if (req.method === 'DELETE') {
    const raw = (req.query && req.query.ids) || '';
    const ids = String(raw).split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    if (ids.length > 50) return res.status(400).json({ error: 'too many' });
    let done = 0;
    for (const pid of ids) {
      try {
        const r = await fetch(NOTION + '/pages/' + pid, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ archived: true }),
        });
        if (r.ok) done++;
      } catch (e) { console.error('archive failed', pid, e); }
    }
    return res.status(200).json({ ok: true, deleted: done, total: ids.length });
  }

  // 진행 현황 변경
    if (req.method === 'PATCH') {
    const b = (req.body && typeof req.body === 'object') ? req.body : {};
    const pid = (req.query && req.query.id) || b.id || '';
        const st = (req.query && req.query.status) || b.status || '';
    const gr = (req.query && req.query.grade) || b.grade || '';
    const hasMemo = Object.prototype.hasOwnProperty.call(b, 'memo');
    if (!pid) return res.status(400).json({ error: 'id required' });
    if (!st && !gr && !hasMemo) return res.status(400).json({ error: 'nothing to update' });
    if (st && STATUS.indexOf(st) === -1) return res.status(400).json({ error: 'invalid status' });
    if (gr && GRADE.indexOf(gr) === -1) return res.status(400).json({ error: 'invalid grade' });
    const props = {};
    if (st) props['진행 상태'] = { select: { name: st } };
    if (gr) props['등급'] = { select: { name: gr } };
    if (hasMemo) {
      const memo = String(b.memo == null ? '' : b.memo).slice(0, 1900);
      props['메모'] = { rich_text: memo ? [{ text: { content: memo } }] : [] };
    }
    try {
      const r = await fetch(NOTION + '/pages/' + pid, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ properties: props }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.message || 'notion error' });
      return res.status(200).json({ ok: true, status: st || null });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'server error' });
    }
  }
  
  const id = (req.query && req.query.id) || '';

  try {
    if (id) {
      const r = await fetch(NOTION + '/pages/' + id, { headers: headers() });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.message || 'notion error' });
      return res.status(200).json({ ok: true, order: shape(d) });
    }
    const r = await fetch(NOTION + '/databases/' + DB_ID + '/query', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        page_size: 100,
        sorts: [{ property: '접수일시', direction: 'descending' }],
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ error: d.message || 'notion error' });
    const list = (d.results || []).map(shape);
    return res.status(200).json({ ok: true, count: list.length, orders: list });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
