import { useState, type ReactNode } from 'react';

export interface TabDef {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly badge?: string | number;
}

interface TabsProps {
  readonly tabs: readonly TabDef[];
  readonly initial?: string;
  /** Extra controls rendered at the right end of the tab bar. */
  readonly trailing?: ReactNode;
}

export function Tabs({ tabs, initial, trailing }: TabsProps) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="tabs">
      <div className="tabs-bar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current.id}
            className={`tab ${t.id === current.id ? 'is-active' : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
            {t.badge !== undefined && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
        {trailing && <div className="tabs-trailing">{trailing}</div>}
      </div>
      <div className="tabs-body">{current.content}</div>
    </div>
  );
}
