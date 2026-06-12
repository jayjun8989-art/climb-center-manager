# ONCLE / GRABIT 출시 체크리스트

새 버전 배포 전 아래 항목을 PC에서 직접 확인하세요.

## 권한·로그인

- [ ] Supabase 프로젝트 연결 확인
- [ ] ONCLE owner 계정 (`oncle@oncle.local`): 양 센터 접근·설정·삭제 가능, **엑셀 생성/열기 불가**
- [ ] GRABIT staff 계정 (`grabit@oncle.local`): GRABIT 등록·수정·출석·동기화 가능, **엑셀 버튼 숨김**
- [ ] export 관리자 (`grabon@oncle.local`): ONCLE/GRABIT 조회·엑셀 생성·열기·자동 갱신 가능
- [ ] staff 계정: 담당 센터만 접근, 등록·수정·출석 가능, 삭제·엑셀 불가
- [ ] viewer 계정: 조회만 가능 (있는 경우), 엑셀 불가

## 회원·동기화

- [ ] 회원 등록 (ONCLE / GRABIT 각각)
- [ ] Supabase `members` 테이블에 반영 확인
- [ ] 회원 수정·메모 수정
- [ ] 회원 삭제는 owner/admin만 가능
- [ ] 동기화 대기 목록 오류 없이 업로드

## 출석·회원권

- [ ] 출석 체크 정상 동작
- [ ] 출석 취소 정상 동작
- [ ] 횟수권 차감·잔여 횟수 표시
- [ ] 잔여 0회 시 재등록/연장 안내
- [ ] 정지/재개 후 상태·잔여일 반영
- [ ] owner/admin 양 센터 출석·취소 가능

## 락카·백업

- [ ] 락카 등록/수정/만료 표시
- [ ] 수동 백업 JSON·DB 생성
- [ ] 백업 복원 후 회원 유지
- [ ] 앱 종료 시 WAL checkpoint (비정상 종료 대비)

## 데이터 보존 테스트

- [ ] 회원 3명 등록
- [ ] Supabase 동기화
- [ ] 앱 종료 후 재실행해도 회원 유지
- [ ] 새 설치파일로 업데이트해도 회원 유지
- [ ] 앱 제거 후 재설치해도 회원 유지
- [ ] 로컬 DB 삭제 후 로그인하면 Supabase pull로 회원 복구
- [ ] AppData DB 경로 `%APPDATA%\com.rabbg.climb-center-manager\climb-center-manager.db` 가 버전 변경에도 동일
- [ ] 백업 폴더 `%APPDATA%\com.rabbg.climb-center-manager\backups` 가 재설치 후에도 유지

## 초기화 테스트

- [ ] `supabase/manual/reset_test_data.sql` 실행 시 Supabase 회원/회원권/출석/락카 데이터만 삭제됨
- [ ] centers, profiles, user_center_roles, auth.users 는 유지됨
- [ ] `scripts/reset-local-data.ps1` 실행 시 로컬 AppData 데이터만 삭제됨
- [ ] `RESET` 입력 전에는 삭제되지 않음

## 설정 (owner)

- [ ] 설정 화면에 DB 경로·백업 폴더·Supabase 연결 상태 표시
- [ ] 마지막 push/pull 시간 표시
- [ ] 데이터 폴더 열기 / 백업 폴더 열기
- [ ] Supabase에서 불러오기 / Supabase로 동기화 버튼
- [ ] ONCLE / GRABIT 센터 전환
- [ ] 업데이트 확인

## 설정 · 업데이트 (v1.0.17+)

- [ ] grabon: 설정 전체(관리자 계정·백업·명부·엑셀 정보) + 업데이트 확인
- [ ] oncle/grabit/staff: 설정 메뉴 보임, 업데이트 확인 가능, pull/push/데이터 폴더
- [ ] oncle/grabit/staff: 관리자 계정·명부·백업·복원 항목 숨김
- [ ] viewer: 설정 메뉴 보임, 업데이트 확인·pull·데이터 폴더만, push 숨김
- [ ] 엑셀 버튼은 grabon에서만 (회원 명부 화면)

## 로컬 DB · Supabase 불러오기 (v1.0.18+)

- [ ] 새 PC 설치 후 AppData에 `climb-center-manager.db` 자동 생성
- [ ] 로컬 DB 테이블/컬럼 누락 시 앱 시작·불러오기 전 자동 마이그레이션
- [ ] Supabase에서 불러오기: 로컬 DB 준비 후 import, 회원/회원권/출석 반영
- [ ] 락카 Supabase 조회 실패 시에도 회원 불러오기 계속 (경고 메시지)
- [ ] 락카 로컬 데이터 없어도 앱·회원관리 정상 동작
- [ ] 회원 명부(Supabase)와 회원 현황(로컬) 동일 회원 표시
- [ ] 회원권 없는 회원: 회원 현황 **만료·소진** 탭에 「회원권 없음」, 종료일/잔여횟수 `-`
- [ ] 실패 시: 「로컬 DB 초기화에 실패했습니다」 등 구체 메시지 + 콘솔 원본 에러

## 자동 업데이트 (v1.0.17+)

- [ ] `tauri.conf.json` endpoint: `releases/latest/download/latest.json`
- [ ] `latest.json` **UTF-8 BOM 없음** (PowerShell `scripts/publish-latest-json.ps1` 사용)
- [ ] v1.0.16 설치본 → v1.0.17 Release 업로드 후 「업데이트 확인」 시 발견
- [ ] v1.0.17 설치본 → v1.0.18 Release 업로드 후 「업데이트 확인」 시 발견
- [ ] 설정 화면: 현재 버전·endpoint·진단 로그 표시
- [ ] 업데이트 있음: 「새 버전 vX.X.X을 찾았습니다」+ 「다운로드 및 설치」 버튼
- [ ] 업데이트 없음: 「현재 최신 버전입니다.」
- [ ] 실패 시: 「업데이트 확인 실패: {원본 메시지}」

## 회원 현황 (v1.0.16+)

기존 「만료 예정」 메뉴가 **회원 현황**으로 개편되었습니다. 날짜 범위 선택 없이 「오늘 기준 N일」 버튼만 사용합니다.

- [ ] grabon: 전체 / ONCLE / GRABIT 회원 현황 조회
- [ ] oncle: ONCLE 회원 현황만 조회
- [ ] grabit: GRABIT 회원 현황만 조회
- [ ] staff / viewer: 권한 센터만 조회
- [ ] 상단 요약: 유효회원 · 만료예정 · 만료/소진 · 정지회원 수 표시
- [ ] 만료예정 기본값 30일 내
- [ ] 만료예정: 오늘 / 7일 / 15일 / 30일 / 60일 필터
- [ ] 만료/소진: 지난 7일 / 30일 / 90일 / 전체 (기본 30일)
- [ ] 정지회원 목록·정지 시작일·남은 정지일 표시
- [ ] 횟수권 0회 → 만료/소진
- [ ] 횟수권 1~2회 → 소진 임박 배지
- [ ] 회원권 없음 → 만료·소진 탭, 필드 `-` 표시 (v1.0.18)
- [ ] 엑셀 버튼은 grabon에서만 (v1.0.15 정책 유지)

## 회원 명부 · 엑셀 리포트 (v1.0.15+)

엑셀 권한은 **역할과 무관**하게 `ADMIN_EXPORT_EMAILS`(`grabon@oncle.local`)만 허용됩니다.

### grabon@oncle.local

- [ ] 회원 명부 화면: 「오늘 기준으로 엑셀 갱신」·통합/센터별 열기·명부/archive 폴더 버튼 **표시**
- [ ] 설정 화면: 마지막 명부 갱신·통합 명부 열기·명부/archive 폴더 버튼 **표시**
- [ ] `reports/회원명부_통합.xlsx` 생성 확인
- [ ] `reports/ONCLE_회원명부.xlsx` · `reports/GRABIT_회원명부.xlsx` 생성 확인
- [ ] `reports/archive/YYYY-MM-DD/` 백업 생성 확인
- [ ] 앱 시작 시 하루 1회 자동 엑셀 갱신 (오늘 파일 없을 때만)
- [ ] Supabase pull 후 최신 데이터 기준으로 엑셀 생성

### oncle@oncle.local / grabit@oncle.local / staff / viewer

- [ ] 회원 등록·수정·출석 **정상 동작** (기능 차단 없음)
- [ ] Supabase 동기화 **정상 동작**
- [ ] 회원 명부 **조회** 가능 (권한 센터 범위)
- [ ] 회원 명부·설정 화면에서 엑셀/명부 폴더 관련 버튼 **숨김**
- [ ] 앱 시작·동기화 시 `reports/` 폴더·엑셀 파일 **자동 생성되지 않음**

### 공통

- [ ] owner/admin 역할이어도 grabon 이메일이 아니면 엑셀 생성 불가
- [ ] 앱 재설치 후 reports 폴더 유지 확인 (grabon PC)
- [ ] 자동 업데이트 endpoint 유지 확인
- [ ] 오늘 등록 회원 화면 확인
- [ ] 엑셀 등록일 최신순 정렬 확인
- [ ] 주소 컬럼 저장 확인

## 빌드

- [ ] `npm.cmd run build` 성공
- [ ] `npm.cmd run tauri dev` 실행 확인
- [ ] `npm.cmd run tauri build` 성공 (서명 키 없으면 경고만, 설치 파일 생성 확인)

## 보안

- [ ] 로그에 `service_role` 키 없음 (anon key만)
- [ ] `.env` / DB 파일이 git에 포함되지 않음
