'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
  duration?: number;
}

export type ToastInput = string | ToastOptions;

interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

function normalizeToastInput(input: ToastInput): Omit<ToastItem, 'id'> {
  if (typeof input === 'string') {
    const isError = /失败|异常|未允许|无法|不能|错误|冲突/.test(input);
    const tone: ToastTone = isError ? 'error' : 'success';
    return {
      message: input,
      tone,
      duration: tone === 'error' ? 0 : 3000,
    };
  }
  const tone: ToastTone = input.tone ?? 'info';
  const defaultDuration =
    tone === 'error' ? 0 : input.action ? 6000 : 3000;
  return {
    message: input.message,
    tone,
    action: input.action,
    duration: input.duration ?? defaultDuration,
  };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());
  const seqRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const normalized = normalizeToastInput(input);
      if (!normalized.message.trim()) return;
      seqRef.current += 1;
      const id = `toast-${Date.now()}-${seqRef.current}`;
      const newItem: ToastItem = { ...normalized, id };

      setItems((prev) => {
        const next = [...prev, newItem];
        if (next.length > 3) {
          const removed = next.slice(0, next.length - 3);
          for (const rem of removed) {
            const t = timersRef.current.get(rem.id);
            if (t !== undefined) {
              window.clearTimeout(t);
              timersRef.current.delete(rem.id);
            }
          }
          return next.slice(next.length - 3);
        }
        return next;
      });

      if (newItem.duration > 0 && typeof window !== 'undefined') {
        const handle = window.setTimeout(() => {
          timersRef.current.delete(id);
          setItems((prev) => prev.filter((item) => item.id !== id));
        }, newItem.duration);
        timersRef.current.set(id, handle);
      }
    },
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {items.length > 0 && (
        <output aria-live="polite" className="toast-stack">
          {items.map((item) => (
            <div key={item.id} className={`toast is-${item.tone}`}>
              <span className="toast-message">{item.message}</span>
              <div className="toast-actions">
                {item.action && (
                  <button
                    type="button"
                    className="toast-action-btn"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                )}
                <button
                  type="button"
                  className="toast-close-btn"
                  aria-label="关闭提示"
                  onClick={() => dismiss(item.id)}
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          ))}
        </output>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: () => {},
      dismiss: () => {},
    };
  }
  return ctx;
}
