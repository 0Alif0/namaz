import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  tone?: 'quiet' | 'alert';
  action?: { label: string; onClick: () => void; disabled?: boolean };
}

export default function Notice({ children, tone = 'quiet', action }: Props) {
  return (
    <div className={tone === 'alert' ? 'notice notice--alert' : 'notice'} role="status">
      <p>{children}</p>
      {action && (
        <button type="button" className="button" onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>
      )}
    </div>
  );
}
