'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { WorkflowBuilder } from '../../../../components/workflow-builder/WorkflowBuilder';
import { api, getStoredAuth } from '../../../../lib/api';
import { WorkflowDefinitionSummary } from '@flowgate/shared-types';
import { Loader2, ArrowLeft } from 'lucide-react';

export default function WorkflowBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [workflow, setWorkflow] = useState<WorkflowDefinitionSummary | null>(null);
  const [loading, setLoading] = useState(id !== 'new');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getStoredAuth();
    if (!auth) {
      router.push('/');
      return;
    }

    if (id && id !== 'new') {
      api
        .getWorkflow(id)
        .then((wf) => {
          setWorkflow(wf);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message || 'Failed to load workflow definition');
          setLoading(false);
        });
    }
  }, [id, router]);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas text-ink font-mono">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="text-xs uppercase tracking-wider text-fg-muted">
            [ LOADING WORKFLOW BUILDER HUD... ]
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas p-6 font-mono">
        <div className="max-w-md rounded-none border border-border-subtle bg-surface p-6 shadow-sm text-center space-y-4">
          <h3 className="text-lg font-serif font-bold text-rose-500">Error Loading Workflow</h3>
          <p className="text-xs text-fg-muted">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center space-x-2 rounded-none bg-surface hover:bg-canvas border border-border-subtle px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <WorkflowBuilder
      initialWorkflow={workflow}
      onBack={() => router.push('/')}
      onSaved={(updated) => {
        setWorkflow(updated);
        // If it was 'new', update route url
        if (id === 'new') {
          router.replace(`/workflows/${updated.id}/builder`);
        }
      }}
    />
  );
}
