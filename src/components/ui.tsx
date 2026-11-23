import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { fmtMoney } from '../lib/format';

export function Card({ title, children, className = '', action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' }) {
  return <button className={`btn btn-${variant} ${className}`} {...props} />;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function MoneyInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (v: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      type="number"
      min={0}
      step={0.01}
      value={Number.isFinite(value) ? value : ''}
      onChange={e => onChange(Number(e.target.value))}
      {...props}
    />
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'green' | 'amber' | 'red' | 'neutral' | 'blue'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`money ${className}`}>{fmtMoney(value)}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <div className="error-banner">{message}</div>;
}

export function StatCard({
  label,
  value,
  tone = 'default',
  sub
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue';
  sub?: ReactNode;
}) {
  return (
    <div className={`stat stat-tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="kind-toggle segmented" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, tone = 'default' }: { value: number; max: number; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill progress-${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
