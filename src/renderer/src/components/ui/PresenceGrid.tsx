import { Children, Component, createRef, isValidElement, type ReactNode } from 'react';

type Entry = { key: string; node: ReactNode; leaving: boolean };
type Props = { children: ReactNode; className?: string };
type State = { entries: Entry[] };
type Position = { left: number; top: number; width: number; height: number; opacity: string };
type Snapshot = { height: number; positions: Map<string, Position>; focused?: string } | null;
const duration = 400;
const easing = 'cubic-bezier(.22,.8,.22,1)';
const shape = (entries: Entry[]) =>
  entries
    .filter((entry) => !entry.leaving)
    .map((entry) => entry.key)
    .toString();

/** Measure only structural changes. Leaving controls float while the real grid closes their space. */
export class PresenceGrid extends Component<Props, State, Snapshot> {
  state: State = { entries: [] };
  private root = createRef<HTMLDivElement>();
  private animations = new Map<string, Animation>();
  private heightAnimation?: Animation;

  static getDerivedStateFromProps(props: Props, state: State): State {
    const nodes = Children.toArray(props.children).filter(isValidElement);
    const entries = nodes.map((node) => ({ key: String(node.key), node, leaving: false }));
    const keys = new Set(entries.map((entry) => entry.key));
    return {
      entries: [
        ...entries,
        ...state.entries
          .filter((entry) => !keys.has(entry.key))
          .map((entry) => ({ ...entry, leaving: true })),
      ],
    };
  }
  getSnapshotBeforeUpdate(_props: Props, previous: State): Snapshot {
    const root = this.root.current;
    if (!root || shape(previous.entries) === shape(this.state.entries)) return null;
    const parent = root.getBoundingClientRect();
    return {
      height: parent.height,
      focused: (document.activeElement?.closest('[data-presence-key]') as HTMLElement | null)
        ?.dataset.presenceKey,
      positions: new Map(
        Array.from(root.children, (child) => {
          const element = child as HTMLElement;
          const box = element.getBoundingClientRect();
          return [
            element.dataset.presenceKey!,
            {
              left: box.left - parent.left,
              top: box.top - parent.top,
              width: box.width,
              height: box.height,
              opacity: getComputedStyle(element).opacity,
            },
          ];
        }),
      ),
    };
  }
  componentDidUpdate(_props: Props, _state: State, before: Snapshot) {
    const root = this.root.current;
    if (!root || !before) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      before.focused &&
      this.state.entries.some((entry) => entry.key === before.focused && entry.leaving)
    ) {
      const candidate = Array.from(root.children).find(
        (child) => !(child as HTMLElement).dataset.leaving,
      ) as HTMLElement | undefined;
      (candidate?.querySelector<HTMLElement>('button:not(:disabled)') ?? root).focus({
        preventScroll: true,
      });
    }
    this.heightAnimation?.cancel();
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    const parent = root.getBoundingClientRect();
    for (const child of root.children) {
      const element = child as HTMLElement;
      const key = element.dataset.presenceKey!;
      const entry = this.state.entries.find((entry) => entry.key === key)!;
      const old = before.positions.get(key);
      if (entry.leaving) {
        if (old)
          Object.assign(element.style, {
            left: `${old.left}px`,
            top: `${old.top}px`,
            width: `${old.width}px`,
            height: `${old.height}px`,
          });
        if (reduced || !old) {
          this.finish(key);
          continue;
        }
        const animation = element.animate(
          [
            { opacity: old.opacity, transform: 'scale(1)', filter: 'blur(0)' },
            { opacity: 0, transform: 'scale(.94)', filter: 'blur(5px)' },
          ],
          { duration: 300, easing, fill: 'forwards' },
        );
        this.animations.set(key, animation);
        animation.onfinish = () => {
          if (this.animations.get(key) === animation) this.finish(key);
        };
      } else {
        element.style.cssText = '';
        if (reduced) continue;
        const box = element.getBoundingClientRect();
        const from = old
          ? {
              transform: `translate(${old.left - (box.left - parent.left)}px,${old.top - (box.top - parent.top)}px) scale(${old.width / box.width},${old.height / box.height})`,
              opacity: old.opacity,
            }
          : { transform: 'scale(.97)', opacity: 0 };
        this.animations.set(
          key,
          element.animate([from, { transform: 'none', opacity: 1 }], { duration, easing }),
        );
      }
    }
    const height = root.getBoundingClientRect().height;
    if (!reduced && Math.abs(height - before.height) > 0.5)
      this.heightAnimation = root.animate(
        [{ height: `${before.height}px` }, { height: `${height}px` }],
        { duration, easing },
      );
  }
  private finish(key: string) {
    this.animations.get(key)?.cancel();
    this.animations.delete(key);
    this.setState((state) => ({
      entries: state.entries.filter((entry) => entry.key !== key || !entry.leaving),
    }));
  }
  componentWillUnmount() {
    this.heightAnimation?.cancel();
    for (const animation of this.animations.values()) animation.cancel();
  }
  render() {
    return (
      <div ref={this.root} tabIndex={-1} className={`${this.props.className ?? ''} presence-grid`}>
        {this.state.entries.map((entry) => (
          <div
            key={entry.key}
            data-presence-key={entry.key}
            data-leaving={entry.leaving || undefined}
            inert={entry.leaving}
            aria-hidden={entry.leaving || undefined}
            className="presence-grid-item"
          >
            {entry.node}
          </div>
        ))}
      </div>
    );
  }
}
