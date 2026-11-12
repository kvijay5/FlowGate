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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/75 backdrop-blur-xs animate-fade-in">
      <div className="fixed inset-0 -z-10" onClick={() => setModalOpen(false)} aria-hidden="true" />

      <div className="w-full max-w-xl bg-surface border border-line rounded-none shadow-none overflow-hidden transition-colors">
        <Command className="w-full" loop>
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line bg-canvas">
            <Search className="w-4 h-4 text-accent shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Type a command, route, persona, or action..."
              className="w-full bg-transparent text-xs text-fg-primary placeholder:text-fg-tertiary outline-none font-mono uppercase tracking-wider"
            />
            <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-bold rounded-none bg-canvas border border-line text-fg-secondary">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[340px] overflow-y-auto p-2 space-y-1 text-xs font-mono">
            <Command.Empty className="py-8 text-center text-xs text-fg-tertiary font-mono">
              [ NO MATCHING COMMANDS FOUND ]
            </Command.Empty>

            {/* Navigation Group */}
            <Command.Group
              heading="[ NAVIGATION ]"
              className="px-2 py-1.5 text-[10px] font-mono font-bold text-fg-tertiary uppercase tracking-widest"
            >
              <Command.Item
                onSelect={() => handleNavigate('/')}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Inbox className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Approval Requests Inbox
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary">/</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/workflows/templates')}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Industry Workflow Templates
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary">
                  /workflows/templates
                </span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/workflows')}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Workflow className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Workflow Definitions & Builder
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary">/workflows</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('/insights')}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <BarChart3 className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Executive SLA & Integrity Insights
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary">/insights</span>
              </Command.Item>

              <Command.Item
                onSelect={() => handleNavigate('http://localhost:4000/api/docs')}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileCode2 className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    OpenAPI Swagger Documentation
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary">/api/docs</span>
              </Command.Item>
            </Command.Group>

            {/* Switch Demo Persona */}
            <Command.Group
              heading="[ SWITCH DEMO PERSONA ]"
              className="px-2 py-1.5 text-[10px] font-mono font-bold text-fg-tertiary uppercase tracking-widest"
            >
              {DEMO_PERSONAS.map((p) => (
                <Command.Item
                  key={p.id}
                  onSelect={() => handlePersonaClick(p)}
                  className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-5 h-5 rounded-none border border-accent bg-accent text-white text-[9px] font-bold flex items-center justify-center font-mono">
                      {p.initials}
                    </div>
                    <div>
                      <span className="font-serif font-bold text-xs uppercase">{p.name}</span>
                      <span className="ml-2 font-mono text-[10px] text-accent uppercase">
                        [{p.roleLabel}]
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-fg-secondary uppercase">
                    {p.tenantName}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            {/* Actions & Utilities */}
            <Command.Group
              heading="[ ACTIONS & SYSTEM ]"
              className="px-2 py-1.5 text-[10px] font-mono font-bold text-fg-tertiary uppercase tracking-widest"
            >
              <Command.Item
                onSelect={handleVerifyLedger}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Verify SHA-256 Audit Chain Ledger
                  </span>
                </div>
                <span className="text-[10px] font-mono text-fg-secondary uppercase">
                  [ CRYPTO VERIFY ]
                </span>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('light');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Sun className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Set Theme: Stark White
                  </span>
                </div>
                {theme === 'light' && (
                  <span className="text-[10px] font-mono text-accent uppercase">[ ACTIVE ]</span>
                )}
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('dark');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Moon className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Set Theme: Pitch Black HUD
                  </span>
                </div>
                {theme === 'dark' && (
                  <span className="text-[10px] font-mono text-accent uppercase">[ ACTIVE ]</span>
                )}
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme('system');
                  setModalOpen(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-none border border-transparent text-fg-primary cursor-pointer hover:bg-raised hover:border-line aria-selected:bg-raised aria-selected:border-accent transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Laptop className="w-4 h-4 text-accent" />
                  <span className="font-serif font-bold text-xs uppercase">
                    Set Theme: System Preference
                  </span>
                </div>
                {theme === 'system' && (
                  <span className="text-[10px] font-mono text-accent uppercase">[ ACTIVE ]</span>
                )}
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
