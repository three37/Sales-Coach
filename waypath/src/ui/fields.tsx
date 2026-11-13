import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { clamp } from '../domain/geo';
import { round } from '../domain/units';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  dp?: number;
  unit?: string;
  disabled?: boolean;
  /** Hide the visible label (it is still read out). */
  compact?: boolean;
  noStepper?: boolean;
}

/** A number box with large minus/plus buttons, usable with gloves or a mouse. */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  dp = 1,
  unit,
  disabled,
  compact,
  noStepper,
}: NumberFieldProps) {
  const id = useId();
  const fmt = (v: number) => String(round(v, dp));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value, dp]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (v: number) => {
    if (Number.isFinite(v)) onChange(round(clamp(v, min, max), Math.max(dp, 6)));
  };
  const bump = (dir: number) => {
    // Snap to the step grid so repeated taps give tidy values.
    const next = dir > 0 ? Math.floor(value / step + 1e-9) * step + step : Math.ceil(value / step - 1e-9) * step - step;
    commit(round(next, 6));
  };

  return (
    <div className={`field ${compact ? 'compact' : ''}`}>
      <label htmlFor={id} className={compact ? 'sr-only' : ''}>
        {label}
      </label>
      <div className="num">
        {!noStepper && (
          <button type="button" className="step" onClick={() => bump(-1)} disabled={disabled || value <= min} aria-label={`Decrease ${label}`}>
            −
          </button>
        )}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          disabled={disabled}
          onFocus={(e) => {
            focused.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            focused.current = false;
            setText(fmt(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value.replace(',', '.'));
            if (e.target.value.trim() !== '' && Number.isFinite(v)) commit(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              bump(1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              bump(-1);
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
        {!noStepper && (
          <button type="button" className="step" onClick={() => bump(1)} disabled={disabled || value >= max} aria-label={`Increase ${label}`}>
            +
          </button>
        )}
      </div>
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'on' : ''}
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
