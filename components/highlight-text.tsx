'use client';

export function HighlightText({
  text,
  query,
}: {
  text: string | null | undefined;
  query: string;
}) {
  if (!text) return null;
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return <>{text}</>;
  const escaped = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        tokens.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} className="search-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
