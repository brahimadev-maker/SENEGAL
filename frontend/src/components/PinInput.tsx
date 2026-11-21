'use client';

/** Champ du code à 4 chiffres (clavier numérique, chiffres masqués). */
export function PinInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      id={id}
      className="pin-input"
      type="password"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{4}"
      maxLength={4}
      placeholder="••••"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
      required
    />
  );
}
