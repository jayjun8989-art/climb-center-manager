import { useState } from "react";
import { X } from "lucide-react";

interface LoginPanelProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  loading?: boolean;
}

export function LoginPanel({ open, onClose, onSubmit, loading }: LoginPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit(email.trim(), password);
      onClose();
      setPassword("");
    } catch (submitError) {
      setError(String(submitError));
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="glass-panel w-full max-w-md rounded-[1.5rem] p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Supabase ???</h2>
          <button className="btn btn-secondary" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm text-[var(--muted)]">
          ???? ???? ?? Supabase ???? ??????.
        </p>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <input
            className="input"
            type="email"
            placeholder="???"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="????"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "??? ?..." : "???"}
          </button>
        </form>
      </div>
    </div>
  );
}
