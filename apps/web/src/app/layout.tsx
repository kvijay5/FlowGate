import type { Metadata } from 'next';
import { Playfair_Display, JetBrains_Mono, Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './globals.css';

const serifFont = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const monoFont = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const sansFont = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FlowGate | Technical HUD Approval Platform',
  description:
    'High-assurance multi-tenant approval workflow platform with transactional DAG state machines, out-of-office delegations, and cryptographic SHA-256 audit ledgers.',
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
      className={`${serifFont.variable} ${monoFont.variable} ${sansFont.variable}`}
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
        {/* Technical HUD Grid Background */}
        <div className="fixed inset-0 pointer-events-none z-0 bg-grid-hud opacity-60" />
        <ThemeProvider>
          <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
