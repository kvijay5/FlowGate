import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlowGate | Multi-Tenant Approval Workflow Platform',
  description:
    'A production-grade, multi-tenant approval workflow SaaS for modern businesses. Accelerate approvals, enforce compliance, and maintain complete auditability.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-violet-600 selection:text-white bg-obsidian-950 text-slate-100 min-h-screen relative overflow-x-hidden">
        {/* Ambient Floating Aurora Mesh Background */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute -top-[25%] -left-[10%] w-[55vw] h-[55vw] rounded-full bg-aurora-violet/10 blur-[130px] animate-pulse-slow" />
          <div className="absolute top-[20%] -right-[15%] w-[50vw] h-[50vw] rounded-full bg-aurora-cyan/10 blur-[140px] animate-pulse-slow" />
          <div className="absolute -bottom-[20%] left-[25%] w-[60vw] h-[60vw] rounded-full bg-aurora-emerald/8 blur-[160px]" />
          <div className="absolute inset-0 bg-grid-mesh opacity-60" />
        </div>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
