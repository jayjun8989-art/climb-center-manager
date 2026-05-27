import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationBarProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-3 rounded-[1.2rem] border border-[var(--border)] bg-[var(--panel-strong)] px-4 py-3 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-[var(--muted)]">
        전체 {total.toLocaleString()}명 · {page}/{totalPages} 페이지
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input !w-auto"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {[25, 50, 100, 200].map((size) => (
            <option key={size} value={size}>
              {size}명씩
            </option>
          ))}
        </select>

        <button
          className="btn btn-secondary !px-3"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="btn btn-secondary !px-3"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
