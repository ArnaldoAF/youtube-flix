import { Film, Tv } from 'lucide-react';
import type { TitleType } from '../types';

/** Decorative: the text next to it always says what it is. */
export function TitleTypeIcon({ type, size = 16, className = '' }: { type: TitleType; size?: number; className?: string }) {
  const Icon = type === 'series' ? Tv : Film;
  return <Icon aria-hidden size={size} className={`shrink-0 ${className}`} />;
}
