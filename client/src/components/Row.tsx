import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

export function Row({ title, children }: { title: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className="group/row relative my-6">
      <h2 className="mb-2 px-4 text-lg font-semibold text-white/90 md:px-12 md:text-xl">{title}</h2>
      <div className="relative">
        <button
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className="absolute inset-y-0 left-0 z-20 hidden w-12 items-center justify-center bg-black/50 opacity-0 transition group-hover/row:opacity-100 md:flex"
        >
          <ChevronLeft size={36} />
        </button>
        {/* Extra vertical padding (cancelled by negative margins) leaves room for the scaled hover card. */}
        <div
          ref={scroller}
          className="no-scrollbar -mb-20 -mt-6 flex gap-2 overflow-x-auto scroll-smooth px-4 pb-20 pt-6 md:px-12"
        >
          {children}
        </div>
        <button
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className="absolute inset-y-0 right-0 z-20 hidden w-12 items-center justify-center bg-black/50 opacity-0 transition group-hover/row:opacity-100 md:flex"
        >
          <ChevronRight size={36} />
        </button>
      </div>
    </section>
  );
}
