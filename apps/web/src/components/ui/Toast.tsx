'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title?: string;
  message: string;
  description?: string;
  type: ToastType;
}

export type ShowToastOptions =
  | string
  | {
      title?: string;
      message?: string;
      description?: string;
      type?: ToastType;
    };

interface ToastContextValue {
  showToast: (options: ShowToastOptions, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((options: ShowToastOptions, legacyType: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    let item: ToastItem;

    if (typeof options === 'string') {
      item = {
        id,
        message: options,
        type: legacyType,
      };
    } else {
      item = {
        id,
        title: options.title,
        message: options.message || options.title || '',
        description: options.description,
        type: options.type || legacyType,
      };
    }

    setToasts((prev) => [...prev, item]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon =
              toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info;

            const borderColors = {
              success: 'border-emerald-500/30 text-emerald-500',
              error: 'border-rose-500/30 text-rose-500',
              info: 'border-blue-500/30 text-blue-500',
            }[toast.type];

            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className={`pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-none bg-surface border ${borderColors} shadow-none text-sm text-fg-primary`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <Icon className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 min-w-0">
                    {toast.title && (
                      <p className="font-semibold text-xs text-fg leading-tight">{toast.title}</p>
                    )}
                    {toast.description ? (
                      <p className="text-[11px] text-fg-muted leading-tight">{toast.description}</p>
                    ) : (
                      <p className="text-xs font-medium text-fg leading-tight truncate">
                        {toast.message}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="text-fg-subtle hover:text-fg transition-colors p-0.5"
                  aria-label="Dismiss toast"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: (options: ShowToastOptions) => {
        if (typeof options === 'string') {
          console.log(`[Toast] ${options}`);
        } else {
          console.log(`[Toast] ${options.title || options.message}: ${options.description || ''}`);
        }
      },
    };
  }
  return context;
}
