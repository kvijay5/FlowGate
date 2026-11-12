'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { PersonaMenu } from './PersonaMenu';
import { DemoPersona } from '@/lib/personas';
import { ShieldCheck, Search, ChevronRight } from 'lucide-react';

interface TopBarProps {
  currentEmail?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  onPersonaSwitched?: (persona: DemoPersona) => void;
  onOpenCommandPalette?: () => void;
}

export function TopBar({
  currentEmail,
  breadcrumbs,
  onPersonaSwitched,
  onOpenCommandPalette,
}: TopBarProps) {
  const pathname = usePathname();

  const navLinks = [
    { label: 'Requests', href: '/' },
    { label: 'Workflows', href: '/?tab=workflows' },
    { label: 'Templates', href: '/workflows/templates' },
    { label: 'Delegations', href: '/?tab=delegations' },
    { label: 'Webhooks', href: '/?tab=webhooks' },
    { label: 'Insights', href: '/insights' },
  ];

  return (
    <header className="sticky top-0 z-40 h-12 w-full border-b border-line bg-surface transition-colors">
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        {/* Brand & Main Navigation or Breadcrumbs */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 text-sm text-fg-primary group shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded-none border border-accent bg-accent text-white shadow-none">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="font-serif font-bold tracking-tight text-base">FlowGate</span>
          </Link>

          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="hidden sm:flex items-center gap-1.5 font-mono text-xs text-fg-secondary">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={idx}>
                  <ChevronRight className="w-3.5 h-3.5 text-fg-tertiary" />
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="hover:text-fg-primary transition-colors uppercase"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-fg-primary font-bold uppercase">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <nav className="hidden md:flex items-center gap-1 font-mono text-xs uppercase tracking-wider">
              {navLinks.map((link) => {
                const isActive =
                  pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`px-2.5 py-1 rounded-none border transition-colors ${
                      isActive
                        ? 'border-accent bg-accent text-white font-bold'
                        : 'border-transparent text-fg-secondary hover:text-fg-primary hover:border-line hover:bg-raised'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Global Search, Theme & Persona Context */}
        <div className="flex items-center gap-2">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="hidden sm:flex items-center gap-2 rounded-none border border-line bg-surface px-2.5 py-1 font-mono text-xs text-fg-secondary hover:border-accent hover:text-fg-primary transition-colors"
            >
              <Search className="h-3.5 w-3.5 text-accent" />
              <span>SEARCH...</span>
              <kbd className="rounded-none bg-canvas px-1 py-0.5 font-mono text-[9px] text-fg-secondary border border-line">
                ⌘K
              </kbd>
            </button>
          )}

          <ThemeToggle />

          <PersonaMenu currentEmail={currentEmail} onPersonaSwitched={onPersonaSwitched} />
        </div>
      </div>
    </header>
  );
}
