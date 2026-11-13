// 오더문의 조회 (내부용) — 노션 DB에서 목록/상세를 읽어온다
// 환경변수: NOTION_TOKEN (필수), ADMIN_KEY (필수), NOTION_DB_ID (선택)

const DB_ID = process.env.NOTION_DB_ID || 'b400cf41ae804765b1b15e3a4b004ba1';
const NOTION_VERSION = '2022-06-28';
const NOTION = 'https://api.notion.com/v1';
const STATUS = ['상담 전', '미팅 예정', '견적 발송', '샘플 진행', '양산 진행', '납품 완료', '보류', '실패'];
const VISIT_DB_ID = process.env.VISIT_DB_ID || '22b96ecfb203408295a3f8755c6935b6';
// 진행 상태 → 그 단계에 도달한 날짜를 기록할 칸 (앞 단계가 비어 있으면 같이 채움)
const STAGE_DATE = [['미팅 예정', '미팅일'], ['견적 발송', '견적일'], ['샘플 진행', '샘플일'], ['양산 진행', '수주일'], ['납품 완료', '수주일']];
const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 노션 DB 전체 조회 (100개씩 페이지 넘김, 최대 2,000행)
async function queryAll(dbId, body) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(NOTION + '/databases/' + dbId + '/query', {
      method: 'POST', headers: headers(),
      body: JSON.stringify(Object.assign({ page_size: 100 }, body || {}, cursor ? { start_cursor: cursor } : {})),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'notion error');
    out.push(...(d.results || []));
    if (!d.has_more) break;
    cursor = d.next_cursor;
  }
  return out;
}
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
  if (p.type === 'url') return p.url || '';
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
    brandUrl: txt(P['브랜드 URL']),
    utmSource: txt(P['UTM 소스']),
    utmMedium: txt(P['UTM 매체']),
    utmCampaign: txt(P['UTM 캠페인']),
    utmContent: txt(P['UTM 콘텐츠']),
    firstVisit: txt(P['첫 방문일']),
    meetDate: txt(P['미팅일']),
    quoteDate: txt(P['견적일']),
    sampleDate: txt(P['샘플일']),
    winDate: txt(P['수주일']),
    lossReason: txt(P['실패 사유']),
    heard: txt(P['알게 된 경로']),
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
        const hasF = b.fields && typeof b.fields === 'object' && Object.keys(b.fields).length > 0;
    if (!st && !gr && !hasMemo && !hasF) return res.status(400).json({ error: 'nothing to update' });
    if (st && STATUS.indexOf(st) === -1) return res.status(400).json({ error: 'invalid status' });
    if (gr && GRADE.indexOf(gr) === -1) return res.status(400).json({ error: 'invalid grade' });
    const props = {};
    if (st) {
      props['진행 상태'] = { select: { name: st } };
      const idx = STAGE_DATE.findIndex((x) => x[0] === st);
      if (idx > -1) {
        try {
          const pr = await fetch(NOTION + '/pages/' + pid, { headers: headers() });
          const pg = await pr.json();
          const PP = (pg && pg.properties) || {};
          const today = todayKST();
          for (let i = 0; i <= idx; i++) {
            const col = STAGE_DATE[i][1];
            if (!props[col] && !(PP[col] && PP[col].date)) props[col] = { date: { start: today } };
          }
        } catch (e) { console.error('stage date skipped', e); }
      }
    }
    if (gr) props['등급'] = { select: { name: gr } };
    if (hasMemo) {
      const memo = String(b.memo == null ? '' : b.memo).slice(0, 1900);
      props['메모'] = { rich_text: memo ? [{ text: { content: memo } }] : [] };
    }

    // 작업지시서 항목 편집
    const F = b.fields && typeof b.fields === 'object' ? b.fields : null;
    if (F) {
      const MAP = {
        brand: ['브랜드·회사명', 'title'],
        manager: ['담당자', 'rich_text'],
        phone: ['연락처', 'phone_number'],
        channel: ['판매 채널·현황', 'rich_text'],
        source: ['유입 경로', 'select'],
        items: ['품목', 'multi_select'],
        styles: ['스타일 수', 'number'],
        colors: ['컬러 수', 'number'],
        sizes: ['사이즈 수', 'number'],
        qty: ['총 수량', 'number'],
        compose: ['발주 구성', 'rich_text'],
        due: ['최종 납기일', 'date'],
        price: ['희망 단가', 'rich_text'],
        fabric: ['원단·부자재', 'select'],
        asset: ['보유 자료', 'select'],
        material: ['소재 구성', 'rich_text'],
        detailSpec: ['디테일 내용', 'rich_text'],
        sizeSpec: ['사이즈 스펙', 'rich_text'],
        sewing: ['봉제·가공 방식', 'rich_text'],
        packing: ['포장 명세', 'rich_text'],
        qc: ['QC 기준', 'rich_text'],
        qcWays: ['검사 방식', 'multi_select'],
        detail: ['상세 내용', 'rich_text'],
        brandUrl: ['브랜드 URL', 'url'],
        lossReason: ['실패 사유', 'select'],
        meetDate: ['미팅일', 'date'],
        heard: ['알게 된 경로', 'select'],
      };
      for (const k in F) {
        if (!MAP[k]) continue;
        const name = MAP[k][0], type = MAP[k][1];
        const raw = F[k];
        const v = raw == null ? '' : String(raw).trim();
        if (type === 'title') { if (!v) continue; props[name] = { title: [{ text: { content: v.slice(0, 200) } }] }; }
        else if (type === 'rich_text') props[name] = { rich_text: v ? [{ text: { content: v.slice(0, 1900) } }] : [] };
        else if (type === 'phone_number') props[name] = { phone_number: v || null };
        else if (type === 'url') props[name] = { url: v ? (/^https?:\/\//i.test(v) ? v : 'https://' + v).slice(0, 300) : null };
        else if (type === 'number') { const n = parseInt(v, 10); props[name] = { number: isNaN(n) ? null : n }; }
        else if (type === 'date') props[name] = { date: /^\d{4}-\d{2}-\d{2}$/.test(v) ? { start: v } : null };
        else if (type === 'select') props[name] = { select: v ? { name: v.slice(0, 90) } : null };
        else if (type === 'multi_select') {
          const arr = v ? v.split(',').map(function(x){ return x.trim().slice(0, 90); }).filter(Boolean).slice(0, 20) : [];
          props[name] = { multi_select: arr.map(function(n2){ return { name: n2 }; }) };
        }
      }
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

  // 대시보드용 집계 원자료 — 일별 방문 · 퍼널 행 + 문의별 날짜 · 유입 · 단계
  if (req.query && req.query.stats) {
    try {
      const [vis, inq] = await Promise.all([
        queryAll(VISIT_DB_ID, { sorts: [{ property: '일자', direction: 'ascending' }] }),
        queryAll(DB_ID, { sorts: [{ property: '접수일시', direction: 'ascending' }] }),
      ]);
      const n = (p) => (p && p.number != null ? p.number : 0);
      const visits = vis.map((pg) => {
        const P = pg.properties || {};
        const o = { d: txt(P['일자']) };
        ['방문', '순방문', '메타광고', '스레드', '인스타', '직접', '기타', '폼 시작'].forEach((k) => { o[k] = n(P[k]); });
        return o;
      }).filter((v) => v.d);
      const inquiries = inq.map((pg) => {
        const P = pg.properties || {};
        const kst = new Date(new Date(pg.created_time).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        return {
          d: kst, status: txt(P['진행 상태']), grade: txt(P['등급']), source: txt(P['유입 경로']),
          campaign: txt(P['UTM 캠페인']), content: txt(P['UTM 콘텐츠']), loss: txt(P['실패 사유']), heard: txt(P['알게 된 경로']),
          meet: txt(P['미팅일']), quote: txt(P['견적일']), sample: txt(P['샘플일']), win: txt(P['수주일']),
          qty: n(P['총 수량']),
        };
      });
      return res.status(200).json({ ok: true, visits, inquiries });
    } catch (e) {
      console.error(e);
      return res.status(502).json({ error: String(e.message || e) });
    }
  }

  try {
    if (id) {
      const r = await fetch(NOTION + '/pages/' + id, { headers: headers() });
      const d = await r.json();
      if (!r.ok) return res.status(502).json({ error: d.message || 'notion error' });
      return res.status(200).json({ ok: true, order: shape(d) });
    }
    const list = (await queryAll(DB_ID, { sorts: [{ property: '접수일시', direction: 'descending' }] })).map(shape);
    return res.status(200).json({ ok: true, count: list.length, orders: list });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
}
