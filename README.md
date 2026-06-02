# 클라이밍 센터 회원관리

ONCLE / GRABIT 두 센터의 회원을 관리하는 Tauri 설치형 데스크톱 앱입니다.

## 주요 기능

- ONCLE / GRABIT 센터별 회원 관리
- 회원 등록 / 수정 / 삭제
- 월권 / 횟수권 / 주니어권 지원
- 출석 체크 및 최근 출석 기록 조회
- 7일 이내 만료 예정 회원 표시
- SQLite 로컬 저장 (오프라인 우선)
- Supabase 클라우드 동기화 (선택)
- 데이터 변경 시 자동 JSON 백업 (최근 30개 유지)
- 이름·전화번호·메모 검색
- 다크모드
- 1000명 이상 회원 대응 (페이지네이션 + 가상 스크롤)

## 실행 방법

### 사전 준비

- Node.js 18+
- Rust (rustup)

### 개발 실행

```bash
cd climb-center-manager
npm install
npm run tauri dev
```

PowerShell에서 `npm` 실행 정책 오류가 나면 `npm.cmd`를 사용하세요.

### 설치 파일 빌드

```bash
npm run tauri build
```

빌드 결과는 `src-tauri/target/release/bundle/` 에 생성됩니다.

## 데이터 저장 위치

- SQLite DB: `%APPDATA%\com.rabbg.climb-center-manager\climb_center.db`
- JSON 백업: `%APPDATA%\com.rabbg.climb-center-manager\backups\`

## Supabase 클라우드 동기화 (선택)

로컬 SQLite가 기본 저장소입니다. Supabase를 연결하면 온라인일 때 변경분을 업로드하고, 다른 기기와 공유할 수 있습니다.

### 1. Supabase 프로젝트 생성

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 새 프로젝트 생성
2. **Project Settings → API**에서 URL과 `anon` key 복사

### 2. 로컬 환경 변수

```bash
cp .env.example .env
```

`.env` 파일에 값 입력:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> `.env`는 Git에 올리지 마세요. `.env.example`만 커밋됩니다.

### 3. DB 스키마 적용

Supabase CLI가 있으면:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

CLI 없이 Dashboard **SQL Editor**에서 `supabase/migrations/` 파일을 순서대로 실행해도 됩니다.

### 4. 관리자 계정 + 센터 권한

1. Dashboard **Authentication → Users**에서 관리자 계정 생성
2. `supabase/seed.sql`의 `YOUR_USER_UUID`를 해당 사용자 UUID로 바꿔 실행  
   (또는 `user_center_roles`에 ONCLE/GRABIT owner 역할 직접 INSERT)

### 5. 앱에서 사용

1. 앱 실행 후 상단 **Supabase 로그인** 클릭
2. 온라인 상태면 **동기화** 버튼 또는 60초 자동 동기화
3. 오프라인에서도 로컬 SQLite로 정상 동작

### 아키텍처 요약

| 구분 | 역할 |
|------|------|
| GitHub | 코드 |
| Supabase | 클라우드 회원 데이터 (RLS + 센터별 권한) |
| SQLite | 로컬 캐시 + 즉시 UI 반영 |
| sync_queue | 로컬 변경 → 온라인 시 업로드 대기열 |

센터 UUID (고정):

- ONCLE: `11111111-1111-1111-1111-111111111001`
- GRABIT: `11111111-1111-1111-1111-111111111002`

## 기술 스택

- Tauri 2
- React + TypeScript + Vite
- Tailwind CSS
- SQLite (rusqlite)
- Supabase (Auth + Postgres + RLS)
