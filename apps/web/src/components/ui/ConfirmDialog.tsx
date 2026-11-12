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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-md rounded-sheet bg-surface border border-line shadow-dialog p-6 space-y-4"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-xl ${isDestructive ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-base text-fg-primary">{title}</h3>
            </div>
            <button
              onClick={onCancel}
              className="p-1 rounded-lg text-fg-tertiary hover:text-fg-primary hover:bg-raised"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <p className="text-sm text-fg-secondary leading-relaxed">{description}</p>

          <div className="flex items-center justify-end gap-2.5 pt-2">
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
