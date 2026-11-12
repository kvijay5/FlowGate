'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface DrawerProps {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}

export function Drawer({
  isOpen,
  open,
  onClose,
  title,
  description,
  children,
  width = 'max-w-md',
}: DrawerProps) {
  const visible = open !== undefined ? open : isOpen;
  if (!visible) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-xs">
        <div className="absolute inset-0" onClick={onClose} />
        <div className="fixed inset-y-0 right-0 flex pl-10">
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={`w-screen ${width} bg-surface border-l border-line shadow-2xl flex flex-col`}
          >
            {title && (
              <div className="flex items-start justify-between px-6 py-4 border-b border-line">
                <div>
                  <div className="font-semibold text-base text-fg">{title}</div>
                  {description && <div className="text-xs text-fg-muted mt-0.5">{description}</div>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-raised transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  );
}
