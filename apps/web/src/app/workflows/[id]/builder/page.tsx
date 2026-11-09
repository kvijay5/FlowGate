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
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm font-medium text-slate-600">Loading Workflow Builder...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-sm text-center">
          <h3 className="text-lg font-bold text-rose-950">Error Loading Workflow</h3>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 inline-flex items-center space-x-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-900"
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
