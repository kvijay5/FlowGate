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
    <header className="sticky top-0 z-40 h-12 w-full border-b border-line bg-surface/75 backdrop-blur-xl transition-colors">
      <div className="flex h-full items-center justify-between px-4 sm:px-6">
        {/* Brand & Main Navigation or Breadcrumbs */}
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-sm text-fg group shrink-0"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white shadow-xs group-hover:scale-105 transition-transform">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <span className="tracking-tight">FlowGate</span>
          </Link>

          {breadcrumbs && breadcrumbs.length > 0 ? (
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-fg-muted">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={idx}>
                  <ChevronRight className="w-3.5 h-3.5 text-fg-subtle" />
                  {crumb.href ? (
                    <Link href={crumb.href} className="hover:text-fg transition-colors">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-fg font-semibold">{crumb.label}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <nav className="hidden md:flex items-center gap-1 text-xs font-medium">
              {navLinks.map((link) => {
                const isActive =
                  pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href));
                return (
                  <Link
                    key={link.label}
                    href={link.href}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      isActive
                        ? 'bg-raised text-fg font-semibold shadow-2xs'
                        : 'text-fg-muted hover:text-fg hover:bg-raised/60'
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
        <div className="flex items-center gap-2.5">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="hidden sm:flex items-center gap-2 rounded-lg border border-line bg-raised px-2.5 py-1 text-xs text-fg-muted hover:border-fg-muted/40 hover:text-fg transition-all"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search...</span>
              <kbd className="rounded bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-fg-subtle border border-line">
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
