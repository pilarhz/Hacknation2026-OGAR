import { useEffect, useRef, type ReactNode } from 'react';

// Okno potwierdzenia zamiast window.confirm. Esc / tło = Anuluj; fokus na „Anuluj”, by Enter niczego nie usunął.
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busyLabel = 'Usuwanie…',
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-bg" onClick={() => !busy && onCancel()}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-head">
          {danger && (
            <span className="confirm-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14a1 1 0 001 1h8a1 1 0 001-1l1-14M10 11v6M14 11v6" />
              </svg>
            </span>
          )}
          <h3 id="confirm-title">{title}</h3>
        </div>
        <div id="confirm-body" className="confirm-body">{children}</div>
        {error && <div className="callout red small">{error}</div>}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>
            Anuluj
          </button>
          <button type="button" className={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
