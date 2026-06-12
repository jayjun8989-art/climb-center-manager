# GRABON Manager (mobile)

ONCLE / GRABIT 두 센터의 관리자(grabon@oncle.local)가 핸드폰에서 빠르게 회원/회원권/락카 현황을
조회하고 간단히 수정할 수 있는 전용 앱입니다. 기존 Supabase 데이터베이스(anon key + RLS)를 그대로 사용합니다.

이 폴더에는 기존 직원용 출석 앱(`app/(app)/...`, `rpc_record_attendance` 기반)도 함께 존재합니다.
GRABON Manager는 `app/(admin)/...` 경로에 새로 추가되었으며, `grabon@oncle.local` 계정으로 로그인하면
자동으로 이 화면으로 이동합니다.

## 설치

```bash
cd mobile
npm install
```

## 환경 변수

`mobile/.env` 파일에 다음 값을 설정하세요 (anon/publishable key만 사용, service_role 절대 금지):

```env
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## 개발 실행

```bash
npx expo start
```

## 로그인 / 권한

- `grabon@oncle.local` 계정으로 로그인하면 GRABON Manager(`(admin)`) 화면으로 이동합니다.
- 다른 계정으로는 GRABON Manager에 접근할 수 없으며, 진입 시 자동 로그아웃되고
  "모바일 앱은 관리자 계정만 사용할 수 있습니다." 메시지가 표시됩니다.
- 모든 쓰기 작업은 `rpc_mobile_update_member` / `rpc_mobile_update_membership` / `rpc_mobile_update_locker`
  security-definer 함수를 통해서만 수행되며, 서버에서 `grabon@oncle.local` 여부를 다시 검증합니다.

## GRABON Manager 기능

- **홈**: 센터 필터(전체/ONCLE/GRABIT) + 요약 카드 (전체 회원, 유효회원, 만료예정, 만료·소진, 정지회원, 오늘 출석, 주니어 회원, 락카 사용)
- **회원**: 엑셀형 카드/표 보기, 센터·구분·상태 필터, 이름/전화번호/메모 검색
- **회원 상세/수정**: 이름·연락처·메모·회원 구분·회원권 시작일/종료일·총/잔여 횟수(주니어 포함) 수정, 저장 전 확인창
- **현황**: 유효회원/만료예정/만료·소진/정지회원 (기간 필터 포함)
- **더보기 > 오늘 출석**: 조회 전용 (체크 기능 없음)
- **더보기 > 락카 현황**: 카드/표 보기, 사용자 정보·기간·상태·메모 수정
- **더보기 > 변경 내역**: `audit_logs` 테이블 기반 수정/삭제 내역 (센터/기간/대상/작업 필터)
- **더보기 > 설정**: 로그인 계정, 앱 버전(mobile v0.1), Supabase 연결 상태, 업데이트 확인, 로그아웃

## 하지 않는 기능

- 신규 회원/회원권 등록
- 출석 체크(차감)
- 엑셀 파일 생성/내보내기
- 회원 영구 삭제 (삭제는 PC 앱에서만, 변경 내역은 audit_logs에 기록)

## Android 빌드

```bash
eas build -p android --profile production
```

`app.json`의 `updates.url`은 `eas build:configure` 또는 `eas update:configure` 실행 시
실제 EAS 프로젝트 ID로 자동 채워집니다 (현재는 `REPLACE_WITH_EAS_PROJECT_ID` placeholder).

## EAS Update (OTA)

JS/UI/텍스트 변경은 새 빌드 없이 배포할 수 있습니다:

```bash
eas update --channel production --message "mobile update"
```

> 네이티브 모듈/권한/아이콘 등을 변경한 경우에는 OTA로 배포할 수 없으며,
> `eas build`로 새 빌드를 만들어 스토어/내부 배포로 재설치해야 합니다.

## 변경 내역(audit_logs)

새 마이그레이션(`supabase/migrations/20250101000019_mobile_admin_v1.sql`)에서 다음을 추가했습니다
(기존 테이블/데이터/RLS는 변경하지 않음):

- `member_roster_view`에 `member_status` 컬럼 추가 (정지회원 판별용)
- `audit_logs` 테이블: 회원/회원권/출석/락카의 수정·삭제 내역 (PC 앱에서도 동일 테이블 사용 가능)
- `is_grabon_admin()`, `log_audit(...)` 헬퍼 함수
- `rpc_mobile_update_member`, `rpc_mobile_update_membership`, `rpc_mobile_update_locker`
  security-definer RPC (grabon 계정만 호출 가능, 모든 변경은 audit_logs에 기록)

## PC 앱과의 관계

- PC 앱(Tauri) 코드와 자동 업데이트 구조는 전혀 건드리지 않았습니다.
- PC 앱 버전과 mobile 버전(`mobile v0.1`)은 독립적으로 관리됩니다.
