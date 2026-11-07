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
    <html lang="en">
      <body className="antialiased selection:bg-indigo-500 selection:text-white">{children}</body>
    </html>
  );
}
