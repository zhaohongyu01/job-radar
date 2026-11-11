'use client';

import { HighlightText } from '@/components/highlight-text';
import type { StructuredSection } from '@/lib/job-detail-format';

export function StructuredJobProse({
  sections,
  highlightQuery = '',
  fallbackMetaCount = 0,
}: {
  sections: StructuredSection[];
  highlightQuery?: string;
  fallbackMetaCount?: number;
}) {
  const renderText = (text: string) =>
    highlightQuery ? <HighlightText text={text} query={highlightQuery} /> : text;

  if (sections.length === 0) {
    return (
      <p className="detail-prose-empty">
        {fallbackMetaCount > 0
          ? '该来源仅提供结构化岗位要素，详细职位说明请打开原公告核对。'
          : '完整公告尚未读取，请打开原公告核对。'}
      </p>
    );
  }

  return (
    <div className="announcement-sections">
      {sections.map((sec) => (
        <section key={sec.id} id={sec.id} className="announcement-sec">
          {sec.heading && <h4 className="announcement-sec-heading">{sec.heading}</h4>}
          <div className="detail-sec-blocks">
            {sec.blocks.map((block, bIdx) => {
              if (block.type === 'roles') {
                return (
                  <div key={bIdx} className="detail-role-pills" aria-label="包含岗位方向">
                    {block.items.map((role, rIdx) => (
                      <span key={rIdx} className="detail-role-pill">
                        {renderText(role)}
                      </span>
                    ))}
                  </div>
                );
              }
              if (block.type === 'list') {
                const ListTag = block.ordered ? 'ol' : 'ul';
                return (
                  <ListTag
                    key={bIdx}
                    className={`detail-prose-list${block.ordered ? '' : ' is-unordered'}`}
                  >
                    {block.items.map((item, iIdx) => (
                      <li key={iIdx}>
                        <span className="detail-prose-marker" aria-hidden="true">
                          {block.ordered ? `${iIdx + 1}.` : '•'}
                        </span>
                        <span className="detail-prose-item-text">{renderText(item)}</span>
                      </li>
                    ))}
                  </ListTag>
                );
              }
              return (
                <p key={bIdx} className="detail-prose-p">
                  {renderText(block.text)}
                </p>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
