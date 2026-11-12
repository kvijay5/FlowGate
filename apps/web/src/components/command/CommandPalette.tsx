'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import {
  Inbox,
  Workflow,
  Sparkles,
  ShieldCheck,
  BarChart3,
  FileCode2,
  Sun,
  Moon,
  Laptop,
  UserCheck,
  ArrowRight,
  Search,
} from 'lucide-react';
import { DEMO_PERSONAS, DemoPersona } from '@/lib/personas';
import { useTheme } from '@/components/theme/ThemeProvider';
import { useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPersonaSelect?: (persona: DemoPersona) => void;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  onPersonaSelect,
}: CommandPaletteProps) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : open;

  const setModalOpen = useCallback(
    (nextOpen: boolean) => {
      if (isControlled && onOpenChange) {
        onOpenChange(nextOpen);
      } else {
        setOpen(nextOpen);
      }
    },
    [isControlled, onOpenChange],
  );

  // Global Keyboard Shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setModalOpen(!isOpen);
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setModalOpen]);

  const handleNavigate = (path: string) => {
    setModalOpen(false);
    if (path.startsWith('http')) {
      window.open(path, '_blank');
    } else {
      router.push(path);
    }
  };

  const handlePersonaClick = (persona: DemoPersona) => {
    setModalOpen(false);
    if (onPersonaSelect) {
      onPersonaSelect(persona);
    } else {
      // Default fallback login
      api
        .login(persona.tenantSlug, persona.email, persona.password || 'FlowGatePass123!')
        .then(() => {
          showToast({
            title: `Switched to ${persona.name}`,
            description: `Active role: ${persona.roleLabel} (${persona.tenantName})`,
            type: 'success',
          });
          window.location.reload();
        })
        .catch((err) => {
          showToast({
            title: 'Authentication Error',
            description: err.message,
            type: 'error',
          });
        });
    }
  };

  const handleVerifyLedger = async () => {
    setModalOpen(false);
    try {
      showToast({
        title: 'Verifying Audit Ledger...',
        description: 'Recalculating SHA-256 cryptographic hashes from genesis block',
        type: 'info',
      });
      const res = await api.verifyAuditChain();
      const isVerified = Boolean(res.valid || res.verified);
      const totalCount = res.totalEntries ?? res.totalLogs ?? 0;
      const headSeq = res.verifiedHeadSequence ?? totalCount;

      if (isVerified) {
        showToast({
          title: 'Audit Ledger Verified',
          description: `All ${totalCount} logs validated with sequence #${headSeq} (SHA-256 intact)`,
          type: 'success',
        });
      } else {
        showToast({
          title: 'Integrity Violation Detected',
          description: res.error || res.details || 'Tampered block found',
          type: 'error',
        });
      }
    } catch (err: any) {
      showToast({
        title: 'Verification Failed',
        description: err.message || 'Unable to reach audit endpoint',
        type: 'error',
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="fixed inset-0 -z-10" onClick={() => setModalOpen(false)} aria-hidden="true" />

      <div className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden glass transition-all">
        <Command className="w-full" loop>
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-canvas/40">
            <Search className="w-5 h-5 text-fg-muted shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Type a command, route, persona, or action..."
              className="w-full bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none font-sans"
            />
            <kbd className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-canvas border border-line text-fg-muted shadow-sm">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[340px] overflow-y-auto p-2 space-y-1 text-sm font-sans">
            <Command.Empty className="py-8 text-center text-xs text-fg-muted">
              No matching commands or actions found.
            </Command.Empty>

            {/* Navigation Group */}
            <Command.Group
              heading="Navigation"
              className="px-2 py-1.5 text-[11px] font-mono font-medium text-fg-subtle uppercase tracking-wider"
            >
              <Command.Item
                onSelect={() => handleNavigate('/')}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Inbox className="w-4 h-4 text-accent" />
                  <span className="font-medium">Approval Requests Inbox</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">/</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/workflows/templates')}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span className="font-medium">Industry Workflow Templates</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">/workflows/templates</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/workflows')}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Workflow className="w-4 h-4 text-accent" />
                  <span className="font-medium">Workflow Definitions & Builder</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">/workflows</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/insights')}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4 text-emerald-500" />
                  <span className="font-medium">Executive SLA & Integrity Insights</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">/insights</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('http://localhost:4000/api/docs')}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileCode2 className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">Swagger API Documentation</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">/api/docs</span>
              </Command.Item>
            </Command.Group>

            {/* Switch Demo Persona */}
            <Command.Group
              heading="Switch Demo Persona"
              className="px-2 py-1.5 text-[11px] font-mono font-medium text-fg-subtle uppercase tracking-wider"
            >
              {DEMO_PERSONAS.map((p) => (
                <Command.Item
                  key={p.id}
                  onSelect={() => handlePersonaClick(p)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center font-mono">
                      {p.initials}
                    </div>
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-fg-muted">({p.roleLabel})</span>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-fg-muted">{p.tenantName}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Actions & Utilities */}
            <Command.Group
              heading="Actions & System"
              className="px-2 py-1.5 text-[11px] font-mono font-medium text-fg-subtle uppercase tracking-wider"
            >
              <Command.Item
                onSelect={handleVerifyLedger}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span className="font-medium">Verify SHA-256 Audit Chain Ledger</span>
                </div>
                <span className="text-[11px] font-mono text-fg-muted">Cryptographic Check</span>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('light');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sun className="w-4 h-4 text-amber-500" />
                  <span className="font-medium">Set Theme: Alabaster Light</span>
                </div>
                {theme === 'light' && <span className="text-xs text-accent">Active</span>}
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('dark');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  <span className="font-medium">Set Theme: Obsidian Dark</span>
                </div>
                {theme === 'dark' && <span className="text-xs text-accent">Active</span>}
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('system');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-fg cursor-pointer hover:bg-raised aria-selected:bg-raised transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Laptop className="w-4 h-4 text-fg-muted" />
                  <span className="font-medium">Set Theme: System Preference</span>
                </div>
                {theme === 'system' && <span className="text-xs text-accent">Active</span>}
              </Command.Item>
            </Command.Group>
          </Command.List>

          <div className="px-4 py-2 border-t border-line bg-canvas/30 flex items-center justify-between text-[11px] text-fg-muted font-mono">
            <div className="flex items-center gap-3">
              <span>↑↓ Navigate</span>
              <span>↵ Select</span>
              <span>ESC Close</span>
            </div>
            <span>⌘K Command Palette</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
