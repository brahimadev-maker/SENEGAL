import type { ReactNode } from 'react';

/** Grand titre aligné à gauche (écrans principaux). */
export function LargeTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="large-title">
      <div className="large-title-text">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** Barre de navigation centrée (écrans secondaires : discussion, assistant). */
export function NavBar({ title, subtitle, left, right }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="nav-bar">
      <div style={{ minWidth: 72, display: 'flex' }}>{left}</div>
      <div className="nav-title">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <div style={{ minWidth: 72, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </header>
  );
}
