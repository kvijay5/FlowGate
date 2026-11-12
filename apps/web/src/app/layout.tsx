import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './globals.css';

const sansFont = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlowGate | Multi-Tenant Approval Workflow Platform',
  description:
    'Production-grade multi-tenant approval workflow platform with transactional DAG state machines, out-of-office delegations, and cryptographic SHA-256 audit ledgers.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sansFont.variable} ${monoFont.variable}`}
    >
      <head>
        {/* Synchronous No-Flash Theme Initialization Script */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('flowgate-theme');if(t==='dark'||t==='light'){document.documentElement.dataset.theme=t;}else{var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=m?'dark':'light';}}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
      </head>
      <body className="antialiased font-sans selection:bg-accent selection:text-white bg-canvas text-fg-primary min-h-screen relative overflow-x-hidden">
        {/* Ambient Subtle Grid Pattern */}
        <div className="fixed inset-0 pointer-events-none z-0 bg-grid-mesh opacity-50" />
        <ThemeProvider>
          <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
