'use client';

import { useState } from 'react';
import { CalendarPlus, Check, Copy, ExternalLink, Rss } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FeedItem {
  id: string;
  title: string;
  desc: string;
  path: string;
  kind: 'ics' | 'rss';
}

const FEEDS: FeedItem[] = [
  {
    id: 'exams-ics',
    title: '山东考公考编 · 考务日历订阅 (.ics)',
    desc: '在 iPhone / 华为 / 小米 / Outlook 日历订阅后，自动同步报名截止、缴费与笔试日期',
    path: '/feeds/exams-shandong.ics',
    kind: 'ics',
  },
  {
    id: 'exams-rss',
    title: '山东考公考编 · 最新公告 RSS',
    desc: '适配 Feedly、Follow、飞书机器人或任意 RSS 阅读器，实时接收 16 地市新简章',
    path: '/feeds/exams-shandong.xml',
    kind: 'rss',
  },
  {
    id: 'jobs-rss',
    title: '企业校招社招 · 最新机会 RSS',
    desc: '国央企、名企与驻鲁高校就业网最新核验招聘流',
    path: '/feeds/jobs-latest.xml',
    kind: 'rss',
  },
];

export function FeedSubscribePopover() {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const getFullUrl = (path: string) => {
    if (typeof window === 'undefined') return path;
    return `${window.location.origin}${path}`;
  };

  const getWebcalUrl = (path: string) => {
    if (typeof window === 'undefined') return path;
    return `webcal://${window.location.host}${path}`;
  };

  const copyUrl = async (id: string, path: string) => {
    try {
      await navigator.clipboard.writeText(getFullUrl(path));
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="icon-btn"
        aria-label="RSS 与手机日历订阅"
        title="订阅更新（RSS / 手机日历自动同步）"
      >
        <Rss size={14} />
      </PopoverTrigger>
      {open && (
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="feed-sub-popover"
          aria-label="RSS 与日历订阅源"
        >
          <div className="feed-sub-head">
            <strong>免登录订阅更新</strong>
            <span>关闭网页也能在手机日历或阅读器收到新公告</span>
          </div>
          <div className="feed-sub-list">
            {FEEDS.map((item) => {
              const copied = copiedId === item.id;
              return (
                <div key={item.id} className="feed-sub-item">
                  <div className="feed-sub-item-info">
                    <span className="feed-sub-item-title">
                      {item.kind === 'ics' ? <CalendarPlus size={13} /> : <Rss size={13} />}
                      {item.title}
                    </span>
                    <small>{item.desc}</small>
                  </div>
                  <div className="feed-sub-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => void copyUrl(item.id, item.path)}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copied ? '已复制' : '复制地址'}</span>
                    </button>
                    {item.kind === 'ics' ? (
                      <a
                        href={getWebcalUrl(item.path)}
                        className="btn btn-tonal btn-xs"
                      >
                        <ExternalLink size={12} />
                        <span>唤起日历</span>
                      </a>
                    ) : (
                      <a
                        href={item.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-xs"
                      >
                        <ExternalLink size={12} />
                        <span>查看</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
}
