# 클라이밍 센터 회원관리

ONCLE / GRABIT 두 센터의 회원을 관리하는 Tauri 설치형 데스크톱 앱입니다.

## 주요 기능

- ONCLE / GRABIT 센터별 회원 관리
- 회원 등록 / 수정 / 삭제
- 월권 / 횟수권 / 주니어권 지원
- 출석 체크 및 최근 출석 기록 조회
- 7일 이내 만료 예정 회원 표시
- SQLite 로컬 저장
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

### 설치 파일 빌드

```bash
npm run tauri build
```

빌드 결과는 `src-tauri/target/release/bundle/` 에 생성됩니다.

## 데이터 저장 위치

- SQLite DB: `%APPDATA%\com.rabbg.climb-center-manager\climb_center.db`
- JSON 백업: `%APPDATA%\com.rabbg.climb-center-manager\backups\`

## 기술 스택

- Tauri 2
- React + TypeScript + Vite
- Tailwind CSS
- SQLite (rusqlite)
