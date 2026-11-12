'use client';

import React, { useState, useRef, useEffect } from 'react';
import { DEMO_PERSONAS, DemoPersona } from '@/lib/personas';
import { api } from '@/lib/api';
import { useTheme } from '@/components/theme/ThemeProvider';
import { ChevronDown, Check, Shield, Laptop } from 'lucide-react';

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
        className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-line bg-surface/80 hover:bg-raised text-fg-primary text-xs font-medium backdrop-blur-md transition-colors"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 text-[10px] font-bold text-accent-text">
          {activePersona.initials}
        </span>
        <span className="hidden sm:inline-block max-w-[120px] truncate">{activePersona.name}</span>
        <ChevronDown className="h-3 w-3 text-fg-tertiary" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-72 rounded-sheet border border-line bg-surface/95 shadow-dialog backdrop-blur-xl p-1.5 z-50 text-xs">
          <div className="px-3 py-2 border-b border-line mb-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-fg-tertiary block">
              Active Session
            </span>
            <div className="font-semibold text-fg-primary">{activePersona.name}</div>
            <div className="text-[11px] text-fg-secondary">
              {activePersona.roleLabel} · {activePersona.tenantName}
            </div>
          </div>

          <div className="px-2 py-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-fg-tertiary px-2 block mb-1">
              Switch Demo Persona
            </span>
            <div className="space-y-0.5">
              {DEMO_PERSONAS.map((persona) => {
                const isSelected =
                  persona.email.toLowerCase() === activePersona.email.toLowerCase();
                return (
                  <button
                    key={persona.id}
                    onClick={() => handleSelect(persona)}
                    className={`w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors ${
                      isSelected
                        ? 'bg-accent/10 text-accent-text font-medium'
                        : 'text-fg-secondary hover:bg-raised hover:text-fg-primary'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-raised text-[10px] font-bold text-fg-primary">
                        {persona.initials}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-xs text-fg-primary truncate">
                          {persona.name}
                        </div>
                        <div className="text-[10px] text-fg-tertiary truncate">
                          {persona.roleLabel} · {persona.tenantSlug}
                        </div>
                      </div>
                    </div>
                    {isSelected && <Check className="h-3.5 w-3.5 text-accent-text shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-line mt-1 pt-1.5 px-2">
            <button
              onClick={() => setTheme('system')}
              className={`w-full flex items-center gap-2 p-1.5 rounded-lg text-left text-[11px] text-fg-secondary hover:bg-raised hover:text-fg-primary ${
                theme === 'system' ? 'font-semibold text-accent-text' : ''
              }`}
            >
              <Laptop className="h-3.5 w-3.5" />
              <span>Match System Appearance</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
