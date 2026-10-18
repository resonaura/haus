import { Fragment, type ReactNode } from 'react';

/** Render server documentation as text and semantic blocks, without executing HTML. */
export function ServerMarkdown({ text }: { text: string }) {
  const references = new Map<string, string>();
  const lines = text.split('\n').filter((line) => {
    const reference = line.match(/^\s*\[([^\]]+)\]:\s*(\S+)/);
    if (reference) {
      references.set(reference[1].toLowerCase(), reference[2]);
      return false;
    }
    return !/^\s*!\[/.test(line);
  });
  const inline = (value: string): ReactNode[] =>
    value
      .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\[[^\]]+\])/g)
      .filter(Boolean)
      .map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={index}>{part.slice(1, -1)}</code>;
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\](?:\(([^)]+)\)|\[([^\]]+)\])$/);
        if (link) {
          const url = link[2] ?? references.get(link[3]?.toLowerCase());
          if (url && /^https:\/\/(?:www\.)?(?:home-assistant\.io|github\.com)\//.test(url))
            return (
              <a
                key={index}
                href={url}
                onClick={(event) => {
                  event.preventDefault();
                  void window.hausNative?.openExternal(url).catch(() => {});
                }}
              >
                {link[1]}
              </a>
            );
          return <span key={index}>{link[1]}</span>;
        }
        return <Fragment key={index}>{part}</Fragment>;
      });
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.startsWith('```')) {
      const content: string[] = [];
      while (++i < lines.length && !lines[i].startsWith('```')) content.push(lines[i]);
      blocks.push(
        <pre key={i}>
          <code>{content.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      blocks.push(
        heading[1].length <= 2 ? (
          <h3 key={i}>{inline(heading[2])}</h3>
        ) : (
          <h4 key={i}>{inline(heading[2])}</h4>
        ),
      );
      continue;
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: string[] = [line.replace(/^\s*[-*]\s/, '')];
      while (i + 1 < lines.length && /^\s*[-*]\s/.test(lines[i + 1]))
        items.push(lines[++i].replace(/^\s*[-*]\s/, ''));
      blocks.push(
        <ul key={i}>
          {items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const paragraph = [line];
    while (
      i + 1 < lines.length &&
      lines[i + 1].trim() &&
      !/^(?:#|```|\s*[-*]\s)/.test(lines[i + 1])
    )
      paragraph.push(lines[++i]);
    blocks.push(<p key={i}>{inline(paragraph.join(' '))}</p>);
  }
  return <div className="server-markdown">{blocks}</div>;
}
