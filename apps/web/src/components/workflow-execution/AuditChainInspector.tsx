'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  ArrowRight,
  User,
  Clock,
  Copy,
  Check,
  Layers,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Hash,
  Shield,
  FileText,
} from 'lucide-react';
import { AuditLogSummary, AuditChainVerificationResult } from '@flowgate/shared-types';
import { api } from '@/lib/api';

interface AuditChainInspectorProps {
  auditLogs: AuditLogSummary[];
  entityId: string;
}

export const AuditChainInspector: React.FC<AuditChainInspectorProps> = ({
  auditLogs,
  entityId,
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<AuditChainVerificationResult | null>(
    null,
  );
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleVerifyChain = async () => {
    setIsVerifying(true);
    try {
      const result = await api.verifyAuditChain();
      setVerificationResult(result);
    } catch (err: any) {
      setVerificationResult({
        valid: false,
        totalEntries: auditLogs.length,
        details: err?.message || 'Failed to verify cryptographic chain',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const truncateHash = (h?: string | null) => {
    if (!h) return 'GENESIS';
    if (h.length <= 16) return h;
    return `${h.slice(0, 8)}...${h.slice(-8)}`;
  };

  return (
    <div className="bg-surface border border-border-subtle rounded-none p-6 space-y-6 font-mono">
      {/* Header & Verification Trigger */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Lock className="h-5 w-5 text-accent" />
            <h3 className="text-base font-serif font-bold text-ink">
              Cryptographic SHA-256 Audit Inspector
            </h3>
          </div>
          <p className="text-xs text-fg-muted font-mono">
            Immutable, cryptographically-chained merkle audit log with per-block SHA-256 hash
            verification.
          </p>
        </div>

        <button
          onClick={handleVerifyChain}
          disabled={isVerifying}
          className="px-4 py-2.5 rounded-none bg-accent hover:bg-accent/90 text-white text-xs font-mono font-semibold uppercase tracking-wider flex items-center space-x-2 transition-colors disabled:opacity-50 shrink-0"
        >
          {isVerifying ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          <span>{isVerifying ? 'Verifying Hashes...' : 'Verify Hash Chain'}</span>
        </button>
      </div>

      {/* Verification Status Banner */}
      {verificationResult && (
        <div
          className={`p-4 rounded-none border flex items-start space-x-3 transition-all ${
            verificationResult.valid
              ? 'bg-emerald-950/40 border-emerald-500/80 text-emerald-200'
              : 'bg-rose-950/40 border-rose-500/80 text-rose-200'
          }`}
        >
          {verificationResult.valid ? (
            <ShieldCheck className="h-6 w-6 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 text-xs font-mono">
            <span className="font-bold text-sm block">
              {verificationResult.valid
                ? `SHA-256 Tamper-Evident Chain Verified: All ${verificationResult.totalEntries} blocks continuous and uncompromised`
                : 'Cryptographic Hash Chain Broken / Verification Failed'}
            </span>
            <p className="text-[11px] opacity-90 leading-relaxed">{verificationResult.details}</p>
            {verificationResult.brokenAtId && (
              <span className="text-[10px] text-rose-300 block">
                Discrepancy detected at entry ID: {verificationResult.brokenAtId}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Audit Block Chain */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-fg-muted font-semibold uppercase tracking-wider px-1">
          <span>Audit Chain Sequence ({auditLogs.length} Blocks)</span>
          <span>Hash Verification</span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-center py-8 text-fg-muted text-xs font-mono">
            No audit records found for this request.
          </div>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((log, index) => {
              const seq = log.sequenceNumber ?? index + 1;
              const isExpanded = expandedLogId === log.id;
              const isDelegated =
                log.action.includes('DELEGATED') || Boolean((log.metadata as any)?.isDelegated);

              const metadata = log.metadata as Record<string, any>;
              const delegatorName =
                metadata?.delegatorName || metadata?.delegatorEmail || 'Delegator';
              const delegationId = metadata?.delegationId;

              return (
                <div
                  key={log.id}
                  className="rounded-none border border-border-subtle bg-canvas p-4 space-y-3 transition-colors hover:border-accent/40"
                >
                  {/* Top Row: Sequence, Action, Actor & Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <span className="px-2 py-0.5 rounded-none bg-surface text-accent font-mono text-[11px] font-bold border border-border-subtle">
                        #{seq}
                      </span>
                      <span className="px-2 py-0.5 rounded-none text-[10px] font-bold uppercase tracking-wider bg-surface text-ink border border-border-subtle">
                        {log.action}
                      </span>
                      <div className="flex items-center space-x-1.5 text-xs text-fg-muted">
                        <User className="h-3.5 w-3.5 text-fg-subtle" />
                        <span className="font-medium text-ink">
                          {log.actor?.name || 'System / FlowGate'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 text-[11px] text-fg-muted font-mono">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Dual-Actor Attribution Badge for Delegated Actions */}
                  {isDelegated && (
                    <div className="p-2.5 rounded-none bg-amber-950/30 border border-amber-800/60 text-xs text-amber-200 flex items-center space-x-2">
                      <Shield className="h-4 w-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="font-semibold">Delegated Action:</span>{' '}
                        <span>
                          Approved by <strong>{log.actor?.name || 'Delegatee'}</strong> on behalf of{' '}
                          <strong>{delegatorName}</strong>
                          {delegationId && ` (Delegation ID: ${delegationId.slice(0, 8)}...)`}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Cryptographic Hash Pair (previousHash -> currentHash) */}
                  <div className="p-2.5 rounded-none bg-surface border border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] font-mono">
                    <div className="flex items-center space-x-2 text-fg-muted">
                      <span className="text-[10px] uppercase font-bold text-fg-subtle">
                        Prev Hash:
                      </span>
                      <span className="text-ink select-all" title={log.previousHash || 'GENESIS'}>
                        {truncateHash(log.previousHash)}
                      </span>
                    </div>

                    <ArrowRight className="h-3.5 w-3.5 text-accent hidden md:block shrink-0" />

                    <div className="flex items-center justify-between md:justify-end space-x-2 text-fg-muted">
                      <span className="text-[10px] uppercase font-bold text-fg-subtle">
                        Block Hash:
                      </span>
                      <span
                        className="text-accent font-bold select-all"
                        title={log.hash || 'Computed on chain'}
                      >
                        {truncateHash(log.hash)}
                      </span>
                      {log.hash && (
                        <button
                          onClick={() => handleCopyHash(log.hash!)}
                          className="p-1 rounded-none hover:bg-canvas text-fg-muted hover:text-ink"
                          title="Copy Full SHA-256 Hash"
                        >
                          {copiedHash === log.hash ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Metadata Toggle */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      className="text-[11px] text-accent hover:underline flex items-center space-x-1 font-medium uppercase tracking-wider"
                    >
                      <span>
                        {isExpanded ? '[ Hide Payload Metadata ]' : '[ View Payload Metadata ]'}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                    <span className="text-[10px] text-fg-subtle font-mono">ID: {log.id}</span>
                  </div>

                  {/* Metadata JSON Drawer */}
                  {isExpanded && (
                    <pre className="p-3 rounded-none bg-surface border border-border-subtle text-[10px] font-mono text-ink overflow-x-auto max-h-48">
                      {JSON.stringify(log.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
