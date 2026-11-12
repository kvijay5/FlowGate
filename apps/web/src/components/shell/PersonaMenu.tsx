'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DEMO_PERSONAS, DemoPersona } from '@/lib/personas';
import { api } from '@/lib/api';
import { useTheme } from '@/components/theme/ThemeProvider';
import { ChevronDown, Check, Laptop } from 'lucide-react';

interface PersonaMenuProps {
  currentEmail?: string;
  onPersonaSwitched?: (persona: DemoPersona) => void;
}

export function PersonaMenu({ currentEmail, onPersonaSwitched }: PersonaMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme } = useTheme();

  // Find active persona
  const activePersona =
    DEMO_PERSONAS.find((p) => p.email.toLowerCase() === currentEmail?.toLowerCase()) ||
    DEMO_PERSONAS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (persona: DemoPersona) => {
    setSwitching(true);
    setIsOpen(false);
    try {
      await api.login(persona.tenantSlug, persona.email, persona.password || 'FlowGatePass123!');
      if (onPersonaSwitched) {
        onPersonaSwitched(persona);
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error('Failed to switch persona:', err);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={switching}
        className="flex items-center gap-2 h-8 px-2.5 rounded-none border border-line bg-surface hover:border-accent text-fg-primary font-mono text-xs font-medium transition-colors"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-none border border-accent bg-accent text-[9px] font-bold text-white">
          {activePersona.initials}
        </span>
        <span className="hidden sm:inline-block max-w-[120px] truncate uppercase">
          {activePersona.name}
        </span>
        <ChevronDown className="h-3 w-3 text-fg-tertiary" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-72 rounded-none border border-line bg-surface shadow-none p-1.5 z-50 text-xs">
          <div className="px-3 py-2 border-b border-line mb-1 font-mono">
            <span className="text-[9px] uppercase font-bold tracking-widest text-fg-tertiary block">
              [ ACTIVE SESSION ]
            </span>
            <div className="font-serif font-bold text-sm text-fg-primary">{activePersona.name}</div>
            <div className="text-[10px] text-accent uppercase font-bold">
              {activePersona.roleLabel} · {activePersona.tenantName}
            </div>
          </div>

          <div className="px-1 py-1 font-mono">
            <span className="text-[9px] uppercase font-bold tracking-widest text-fg-tertiary px-2 block mb-1">
              [ SWITCH PERSONA ]
            </span>
            <div className="space-y-0.5">
              {DEMO_PERSONAS.map((persona) => {
                const isSelected =
                  persona.email.toLowerCase() === activePersona.email.toLowerCase();
                return (
                  <button
                    key={persona.id}
                    onClick={() => handleSelect(persona)}
                    className={`w-full flex items-center justify-between p-2 rounded-none border text-left transition-colors ${
                      isSelected
                        ? 'border-accent bg-accent/10 text-accent font-bold'
                        : 'border-transparent text-fg-secondary hover:bg-raised hover:text-fg-primary hover:border-line'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-none border border-line bg-raised text-[9px] font-bold text-fg-primary">
                        {persona.initials}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-xs text-fg-primary truncate uppercase">
                          {persona.name}
                        </div>
                        <div className="text-[9px] text-fg-tertiary truncate uppercase">
                          {persona.roleLabel} · {persona.tenantSlug}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-line mt-1 pt-1.5 px-1 font-mono">
            <button
              onClick={() => setTheme('system')}
              className={`w-full flex items-center gap-2 p-1.5 rounded-none text-left text-[10px] uppercase text-fg-secondary hover:bg-raised hover:text-fg-primary ${
                theme === 'system' ? 'font-bold text-accent' : ''
              }`}
            >
              <Laptop className="h-3 w-3" />
              <span>[ SYSTEM APPEARANCE ]</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
