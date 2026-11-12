'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          className="relative w-full max-w-md rounded-none bg-surface border border-line shadow-none p-6 space-y-4"
        >
          <div className="flex items-start justify-between border-b border-line pb-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-1.5 rounded-none border ${isDestructive ? 'border-danger text-danger bg-danger/10' : 'border-accent text-accent bg-accent/10'}`}
              >
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h3 className="font-serif font-bold text-lg text-fg-primary tracking-tight">
                {title}
              </h3>
            </div>
            <button
              onClick={onCancel}
              className="p-1 rounded-none text-fg-secondary hover:text-fg-primary hover:bg-raised border border-transparent hover:border-line"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="font-sans text-xs text-fg-secondary leading-relaxed">{description}</p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button variant={isDestructive ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
