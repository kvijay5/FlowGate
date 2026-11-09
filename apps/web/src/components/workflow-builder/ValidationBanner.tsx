'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react';
import { GraphValidationResult } from './types';

interface ValidationBannerProps {
  validation: GraphValidationResult;
  nodeCount: number;
  edgeCount: number;
}

export function ValidationBanner({ validation, nodeCount, edgeCount }: ValidationBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { isValid, errors, warnings } = validation;

  return (
    <div className="z-10 w-full transition-all duration-200">
      <div
        className={`flex items-center justify-between border-b px-6 py-2.5 shadow-xs transition-colors ${
          isValid
            ? 'border-emerald-200 bg-emerald-50/90 text-emerald-900'
            : 'border-rose-200 bg-rose-50/95 text-rose-950'
        }`}
      >
        <div className="flex items-center space-x-3">
          {isValid ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <AlertCircle className="h-4 w-4" />
            </div>
          )}

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold">
                {isValid
                  ? 'Workflow Graph is Valid'
                  : `Graph Validation Failed (${errors.length} ${
                      errors.length === 1 ? 'issue' : 'issues'
                    })`}
              </span>
              {warnings.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {isValid
                ? `Topology is strictly acyclic, fully connected, and ready to publish (${nodeCount} nodes, ${edgeCount} transitions).`
                : errors[0]?.message}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {(errors.length > 1 || warnings.length > 0) && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className={`flex items-center space-x-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                isValid
                  ? 'bg-emerald-100/60 text-emerald-800 hover:bg-emerald-100'
                  : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
              }`}
            >
              <span>{isExpanded ? 'Hide Details' : 'View All Issues'}</span>
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          <div className="hidden items-center space-x-2 text-xs text-slate-500 md:flex">
            <span className="rounded bg-white/80 px-2 py-0.5 font-mono font-medium shadow-2xs">
              {nodeCount} Nodes
            </span>
            <span className="rounded bg-white/80 px-2 py-0.5 font-mono font-medium shadow-2xs">
              {edgeCount} Edges
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Issues Drawer */}
      {isExpanded && (!isValid || warnings.length > 0) && (
        <div className="max-h-48 overflow-y-auto border-b border-slate-200 bg-white px-6 py-3 shadow-inner">
          <div className="space-y-2">
            {errors.map((err, idx) => (
              <div
                key={`err-${idx}`}
                className="flex items-start space-x-2 rounded-lg bg-rose-50/70 p-2 text-xs text-rose-900 ring-1 ring-inset ring-rose-600/10"
              >
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-600" />
                <span className="flex-1 font-medium">{err.message}</span>
              </div>
            ))}
            {warnings.map((warn, idx) => (
              <div
                key={`warn-${idx}`}
                className="flex items-start space-x-2 rounded-lg bg-amber-50/70 p-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/10"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <span className="flex-1 font-medium">{warn.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
