import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Center, MemberInput, MemberListItem, MembershipCategory } from "../types";
import {
  calcMonthlyEndDate,
  calcSessionEndDate,
  dbMembershipToLegacy,
  getJuniorCountFromItem,
  getMonthlyDuration,
  JUNIOR_COUNT_PRESETS,
  monthlyTypeFromDuration,
  normalizePhoneInput,
  resolveCategory,
  SESSION_TOTAL_COUNT,
  SESSION_VALIDITY_MONTHS,
  todayString,
  type MonthlyDuration,
} from "../utils/member";
import { logAppError } from "../utils/errors";

type MemberFormModalProps = {
  isOpen: boolean;
  center: Center;
  member?: MemberListItem | null;
  memoOnly?: boolean;
  onClose: () => void;
  onSubmit: (input: MemberInput) => Promise<void>;
};

const categoryOptions: { value: MembershipCategory; label: string }[] = [
  { value: "monthly", label: "월권" },
  { value: "session", label: "횟수권" },
  { value: "junior", label: "주니어" },
];

const monthlyDurations: MonthlyDuration[] = [1, 3, 6];

function resolveCategoryFromItem(type: MemberListItem["membership_type"]): MembershipCategory {
  return resolveCategory(type ?? undefined);
}

export function MemberFormModal({
  isOpen,
  center,
  member,
  memoOnly = false,
  onClose,
  onSubmit,
}: MemberFormModalProps) {

  const [name, setName] = useState("");

  const [phone, setPhone] = useState("");

  const [category, setCategory] = useState<MembershipCategory>("monthly");

  const [monthlyDuration, setMonthlyDuration] = useState<MonthlyDuration>(1);

  const [juniorTotal, setJuniorTotal] = useState<number>(8);

  const [juniorCustom, setJuniorCustom] = useState(false);

  const [juniorRemaining, setJuniorRemaining] = useState<number>(8);

  const [startDate, setStartDate] = useState(todayString());

  const [endDate, setEndDate] = useState("");

  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");

  const [lockerNumber, setLockerNumber] = useState("");

  const [lockerStartDate, setLockerStartDate] = useState("");

  const [lockerEndDate, setLockerEndDate] = useState("");

  const [lockerMemo, setLockerMemo] = useState("");

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");



  const autoMonthlyEndDate = useMemo(() => {

    if (category !== "monthly" || !startDate) return "";

    return calcMonthlyEndDate(startDate, monthlyDuration);

  }, [category, startDate, monthlyDuration]);



  const autoSessionEndDate = useMemo(() => {

    if (category !== "session" || !startDate) return "";

    return calcSessionEndDate(startDate);

  }, [category, startDate]);



  useEffect(() => {

    if (!isOpen) return;

    setError("");



    if (member) {
      const legacyType = dbMembershipToLegacy(member.membership_type);
      setName(member.name);
      setPhone(member.phone ?? "");
      setCategory(resolveCategoryFromItem(member.membership_type));
      setMonthlyDuration(getMonthlyDuration(legacyType) ?? 1);
      {
        const total = getJuniorCountFromItem(member);
        setJuniorTotal(total);
        setJuniorCustom(!JUNIOR_COUNT_PRESETS.includes(total));
        setJuniorRemaining(member.remaining_count ?? total);
      }
      setStartDate(member.start_date ?? todayString());
      setEndDate(member.end_date ?? "");
      setNotes(member.memo ?? "");
      setAddress("");
      setLockerNumber("");
      setLockerStartDate("");
      setLockerEndDate("");
      setLockerMemo("");
      api.getMemberDetail(member.id).then((detail) => {
        const m = detail.member;
        setAddress(m.address ?? "");
        setLockerNumber(m.locker_number ?? "");
        setLockerStartDate(m.locker_start_date?.slice(0, 10) ?? "");
        setLockerEndDate(m.locker_end_date?.slice(0, 10) ?? "");
        setLockerMemo(m.locker_memo ?? "");
      }).catch(() => undefined);
      return;
    }



    setName("");

    setPhone("");

    setCategory("monthly");

    setMonthlyDuration(1);

    setJuniorTotal(8);

    setJuniorCustom(false);

    setJuniorRemaining(8);

    setStartDate(todayString());

    setEndDate(calcMonthlyEndDate(todayString(), 1));

    setNotes("");
    setAddress("");

    setLockerNumber("");

    setLockerStartDate("");

    setLockerEndDate("");

    setLockerMemo("");

  }, [isOpen, member]);



  useEffect(() => {

    if (category === "monthly" && startDate) {

      setEndDate(calcMonthlyEndDate(startDate, monthlyDuration));

    }

    if (category === "session" && startDate) {

      setEndDate(calcSessionEndDate(startDate));

    }

  }, [category, startDate, monthlyDuration]);



  if (!isOpen) return null;



  async function handleSubmit(event: React.FormEvent) {

    event.preventDefault();

    setSaving(true);

    setError("");



    const trimmedName = name.trim();

    if (!trimmedName) {

      setError("이름을 입력해주세요.");

      setSaving(false);

      return;

    }



    if (memoOnly && member) {
      const legacyType = dbMembershipToLegacy(member.membership_type);
      const input: MemberInput = {
        center,
        name: member.name,
        phone: member.phone,
        membership_type: legacyType,
        start_date: member.start_date ?? startDate,
        end_date: member.end_date,
        total_sessions: member.total_count,
        remaining_sessions: member.remaining_count,
        notes: notes.trim() || null,
        address: address.trim() || null,
      };
      await onSubmit(input);
      onClose();
      return;
    }

    let membershipType: MemberInput["membership_type"];

    let resolvedEndDate: string | null = null;

    let totalSessions: number | null = null;

    let remainingSessions: number | null = null;



    if (category === "monthly") {

      membershipType = monthlyTypeFromDuration(monthlyDuration);

      resolvedEndDate = calcMonthlyEndDate(startDate, monthlyDuration);

    } else if (category === "session") {

      membershipType = "session";

      resolvedEndDate = calcSessionEndDate(startDate);

      totalSessions = SESSION_TOTAL_COUNT;

      remainingSessions = member?.remaining_count ?? SESSION_TOTAL_COUNT;

    } else {

      membershipType = "junior";

      if (juniorTotal < 1) {
        setError("수업 횟수는 1회 이상 입력해주세요.");
        setSaving(false);
        return;
      }

      if (juniorRemaining > juniorTotal || juniorRemaining < 0) {
        setError("잔여 수업 횟수는 총 수업 횟수보다 클 수 없습니다.");
        setSaving(false);
        return;
      }

      totalSessions = juniorTotal;

      remainingSessions = juniorRemaining;

      resolvedEndDate = endDate || null;

    }



    const input: MemberInput = {

      center,

      name: trimmedName,

      phone: normalizePhoneInput(phone),

      member_type: category === "junior" ? "junior" : "regular",

      membership_type: membershipType,

      start_date: startDate,

      end_date: resolvedEndDate,

      total_sessions: totalSessions,

      remaining_sessions: remainingSessions,

      notes: notes.trim() || null,
      address: address.trim() || null,

      locker_number: lockerNumber.trim() || null,

      locker_start_date: lockerStartDate || null,

      locker_end_date: lockerEndDate || null,

      locker_memo: lockerMemo.trim() || null,

    };



    try {

      await onSubmit(input);

      onClose();

    } catch (submitError) {

      setError(logAppError("회원 등록/수정", submitError));

    } finally {

      setSaving(false);

    }

  }



  const displayedEndDate =

    category === "monthly"

      ? autoMonthlyEndDate

      : category === "session"

        ? autoSessionEndDate

        : endDate;



  return (

    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="glass-panel flex max-h-[92vh] w-full max-w-xl flex-col rounded-[1.5rem]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] p-6 pb-4">

          <div>

            <h2 className="text-xl font-bold">{member ? "회원 수정" : "회원 등록"}</h2>

            <p className="text-sm text-[var(--muted)]">{center} 센터</p>
            {memoOnly && (
              <p className="mt-1 text-sm text-amber-600">메모만 수정할 수 있습니다.</p>
            )}

          </div>

          <button className="btn btn-secondary !px-3" onClick={onClose}>

            <X size={18} />

          </button>

        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 max-h-[min(62vh,560px)] flex-1 space-y-4 overflow-y-auto overscroll-y-contain px-6 py-4">

          <div>

            <label className="field-label">이름</label>

            <input

              className="input"

              value={name}

              disabled={memoOnly}

              onChange={(e) => setName(e.target.value)}

              required

            />

          </div>



          <div>

            <label className="field-label">전화번호</label>

            <input

              className="input"

              value={phone}

              disabled={memoOnly}

              onChange={(e) => setPhone(e.target.value)}

              placeholder="010-0000-0000"

            />

          </div>



          <div>

            <label className="field-label">주소 (선택)</label>

            <input

              className="input"

              value={address}

              disabled={memoOnly}

              onChange={(e) => setAddress(e.target.value)}

              placeholder="회원 주소"

            />

          </div>



          {!memoOnly && (
          <>
          <div>

            <label className="field-label">회원권 종류</label>

            <div className="grid grid-cols-3 gap-2">

              {categoryOptions.map((option) => (

                <button

                  key={option.value}

                  type="button"

                  className={`btn ${category === option.value ? "btn-primary" : "btn-secondary"}`}

                  onClick={() => setCategory(option.value)}

                >

                  {option.label}

                </button>

              ))}

            </div>

          </div>



          {category === "monthly" && (

            <div>

              <label className="field-label">월권 기간</label>

              <div className="grid grid-cols-3 gap-2">

                {monthlyDurations.map((duration) => (

                  <button

                    key={duration}

                    type="button"

                    className={`btn ${

                      monthlyDuration === duration ? "btn-primary" : "btn-secondary"

                    }`}

                    onClick={() => setMonthlyDuration(duration)}

                  >

                    {duration}개월

                  </button>

                ))}

              </div>

              <p className="mt-2 text-xs text-[var(--muted)]">

                기간 선택 시 시작일 기준 만료일이 자동 계산됩니다.

              </p>

            </div>

          )}



          {category === "session" && (

            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3">

              <p className="text-sm font-semibold">5회권 (등록일부터 {SESSION_VALIDITY_MONTHS}개월)</p>

              <p className="mt-1 text-xs text-[var(--muted)]">

                총 {SESSION_TOTAL_COUNT}회 이용 가능 · 시작일 기준 {SESSION_VALIDITY_MONTHS}개월 내 사용

              </p>

            </div>

          )}



          {category === "junior" && (

            <div>

              <label className="field-label">총 수업 횟수</label>

              <div className="grid grid-cols-3 gap-2">

                {JUNIOR_COUNT_PRESETS.map((count) => (

                  <button

                    key={count}

                    type="button"

                    className={`btn ${!juniorCustom && juniorTotal === count ? "btn-primary" : "btn-secondary"}`}

                    onClick={() => {
                      setJuniorCustom(false);
                      setJuniorTotal(count);
                      if (!member) setJuniorRemaining(count);
                    }}

                  >

                    {count}회

                  </button>

                ))}

                <button

                  type="button"

                  className={`btn ${juniorCustom ? "btn-primary" : "btn-secondary"}`}

                  onClick={() => setJuniorCustom(true)}

                >

                  직접입력

                </button>

              </div>

              {juniorCustom && (
                <input
                  className="input mt-2"
                  type="number"
                  min={1}
                  value={juniorTotal}
                  onChange={(e) => {
                    const value = Math.max(1, Number(e.target.value) || 0);
                    setJuniorTotal(value);
                    if (!member) setJuniorRemaining(value);
                  }}
                />
              )}

              <p className="mt-2 text-xs text-[var(--muted)]">

                출석 시 잔여 수업 횟수가 1회씩 차감됩니다.

              </p>

              {member && (
                <div className="mt-3">
                  <label className="field-label">잔여 수업 횟수</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={juniorTotal}
                    value={juniorRemaining}
                    onChange={(e) => setJuniorRemaining(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
              )}

            </div>

          )}



          <div className="grid gap-4 md:grid-cols-2">

            <div>

              <label className="field-label">

                {category === "session" || category === "junior" ? "등록일" : "시작일"}

              </label>

              <input

                className="input"

                type="date"

                value={startDate}

                onChange={(e) => setStartDate(e.target.value)}

                required

              />

            </div>



            <div>

              <label className="field-label">

                {category === "session" ? "만료일 (자동)" : "만료일"}

              </label>

              <input

                className="input"

                type="date"

                value={displayedEndDate}

                onChange={(e) => setEndDate(e.target.value)}

                readOnly={category === "monthly" || category === "session"}

                required={category !== "junior"}

              />

            </div>

          </div>
          </>
          )}



          {!memoOnly && (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="field-label">락카 번호</label>
              <input
                className="input"
                value={lockerNumber}
                onChange={(e) => setLockerNumber(e.target.value)}
                placeholder="예: A-12"
              />
            </div>
            <div>
              <label className="field-label">락카 시작일</label>
              <input
                className="input"
                type="date"
                value={lockerStartDate}
                onChange={(e) => setLockerStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">락카 만료일</label>
              <input
                className="input"
                type="date"
                value={lockerEndDate}
                onChange={(e) => setLockerEndDate(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="field-label">락카 메모</label>
              <input
                className="input"
                value={lockerMemo}
                onChange={(e) => setLockerMemo(e.target.value)}
                placeholder="락카 관련 메모"
              />
            </div>
          </div>
          )}

          <div>

            <label className="field-label">메모</label>

            <textarea

              className="input min-h-24 resize-none"

              value={notes}

              onChange={(e) => setNotes(e.target.value)}

              placeholder="특이사항, 보호자 연락처 등"

            />

          </div>



          {error && (

            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">

              {error}

            </p>

          )}

          </div>

          <div className="flex shrink-0 justify-end gap-3 border-t border-[var(--border)] px-6 py-4">

            <button type="button" className="btn btn-secondary" onClick={onClose}>

              취소

            </button>

            <button type="submit" className="btn btn-primary" disabled={saving}>

              {saving ? "저장 중..." : member ? "수정 저장" : "등록하기"}

            </button>

          </div>

        </form>

      </div>

    </div>

  );

}


