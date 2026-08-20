# YJ ORDER — 용저우 Y&J 공장 오더문의 랜딩

스레드(mising.man) 트래픽 → 랜딩 → 기준 필터링 폼 → 노션 DB 자동 저장.
구조는 ddl-brand와 동일: 깃허브 저장소 → Vercel 자동 배포 → /api 서버리스 함수가 노션 프록시.

## 파일

- index.html : 랜딩 + 최소수량 계산기 + 문의 폼 (단일 파일, 빌드 없음)
- api/inquiry.js : 폼 → 노션 페이지 생성. 필수값 검증, 허니팟, IP당 1분 5회 제한
- package.json : type module (ESM 서버리스 함수용)

## 배포 순서

1. Vercel 팀 ddl2026 → New Project → yj-order import → Framework Preset: Other → Deploy
2. 환경변수 (Settings → Environment Variables)
   - NOTION_TOKEN = "DDL 브랜드 관리" 인테그레이션 토큰
   - NOTION_DB_ID = b400cf41ae804765b1b15e3a4b004ba1 (코드 기본값이라 생략 가능)
   - 입력 후 Redeploy 해야 반영됨
3. 노션 DB "오더문의 (용저우 Y&J)" 우상단 ... → 연결 → "DDL 브랜드 관리" 추가
4. 테스트: 사이트에서 문의 1건 제출 → 노션에 YJ-1로 들어오는지 확인

## 노션 DB

- 위치: 프로젝트 DDL > 브랜드 관리 > 오더문의 (용저우 Y&J)
- database_id b400cf41ae804765b1b15e3a4b004ba1
- data source b7f19713-4182-40aa-849a-2306d9219615
- 자동 입력: 문의번호(YJ-N), MOQ 충족, 등급(A/B/C), 진행 상태(신규), 유입 경로, 접수일시

### 등급 자동 판정

- A : MOQ 충족 + (실물 샘플 또는 도식화 보유) + 총 수량 500장 이상
- C : MOQ 미달 이거나 보유 자료 없음
- B : 나머지

## 유입 경로 구분

링크 뒤에 ?src= 를 붙이면 노션 "유입 경로"에 그대로 기록됨.

- 스레드 링크인바이오 : /?src=스레드
- 인스타 프로필 : /?src=인스타
- 파라미터 없으면 기본값 스레드
