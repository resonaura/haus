import { useEffect, useRef } from 'react';
import { House, LayoutGrid, Server } from 'lucide-react';
import { ScrollShadow } from '@heroui/react';
import { categoryIcons } from '../../components/icons/Icon';

export interface HomeCategoryItem {
  id: string;
  name: string;
  summary: string;
}

/** The same navigation surface on Home and every filtered Home view. */
export function HomeCategoryDock({
  categories,
  selected,
  onSelect,
}: {
  categories: HomeCategoryItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const container = rail.current;
    const button = activeButton.current;
    if (!container || !button) return;
    const keepVisible = () => {
      const left =
        button.getBoundingClientRect().left -
        container.getBoundingClientRect().left +
        container.scrollLeft;
      const right = left + button.offsetWidth;
      if (left < container.scrollLeft || right > container.scrollLeft + container.clientWidth) {
        container.scrollTo({
          left: left - (container.clientWidth - button.offsetWidth) / 2,
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        });
      }
    };
    keepVisible();
    const observer = new ResizeObserver(keepVisible);
    observer.observe(container);
    return () => observer.disconnect();
  }, [selected]);

  return (
    <div className="home-category-layer">
      <div className="home-category-progressive-blur" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <nav className="home-category-dock" aria-label="Home categories">
        <ScrollShadow
          className="home-category-rail"
          orientation="horizontal"
          hideScrollBar
          size={26}
          ref={rail}
        >
          <button
            className="home-category-filter home-category-all"
            aria-pressed={selected === null}
            onClick={() => onSelect(null)}
            ref={selected === null ? activeButton : undefined}
          >
            <House size={19} strokeWidth={1.8} />
            <span>
              <strong>All</strong>
              <small>Your home</small>
            </span>
          </button>
          <span className="home-category-divider" aria-hidden="true" />
          {categories.map((category) => {
            const Icon =
              category.id === 'servers' ? Server : (categoryIcons[category.id] ?? LayoutGrid);
            const active = selected === category.id;
            return (
              <button
                key={category.id}
                className="home-category-filter"
                data-category={category.id}
                aria-pressed={active}
                onClick={() => onSelect(active ? null : category.id)}
                ref={active ? activeButton : undefined}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>
                  <strong>{category.name}</strong>
                  <small>{category.summary}</small>
                </span>
              </button>
            );
          })}
        </ScrollShadow>
      </nav>
    </div>
  );
}
