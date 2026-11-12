import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';

export interface SettingsTab<Id extends string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

export const tabId = (id: string) => `settings-tab-${id}`;
export const panelId = (id: string) => `settings-panel-${id}`;

/**
 * The tab bar: arrow keys, Home and End move between tabs, as screen-reader users expect from a
 * tablist. Only the selected tab is in the Tab order.
 */
export function SettingsTabs<Id extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: SettingsTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tabs.findIndex((t) => t.id === active);

  // On a phone the bar scrolls sideways: keep the selected tab visible, also when it came from a link.
  useEffect(() => {
    buttons.current[activeIndex]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    // Leave browser shortcuts alone, such as Alt+Left for Back.
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const last = tabs.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    onSelect(tabs[next].id);
    buttons.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-white/15 px-4">
      {tabs.map(({ id, label, icon: Icon }, index) => {
        const selected = id === active;
        return (
          <button
            key={id}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={panelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
              selected ? 'border-flix-red text-white' : 'border-transparent text-white/55 hover:text-white/85'
            }`}
          >
            <Icon aria-hidden size={18} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
