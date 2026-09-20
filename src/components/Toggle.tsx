interface Props {
  label: string;
  /** The time this reminder would arrive, shown under the name. */
  meta?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}

/**
 * A labelled switch. The state is written out as ON/OFF as well as shown by the
 * knob position, so it is never conveyed by colour or shape alone (spec §36).
 */
export default function Toggle({ label, meta = null, checked, disabled = false, onChange }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle"
      disabled={disabled}
      onClick={onChange}
    >
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {meta && <span className="toggle-meta">{meta}</span>}
      </span>
      <span className="toggle-state">{checked ? 'ON' : 'OFF'}</span>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
    </button>
  );
}
