'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WORKFLOW_TEMPLATES, WorkflowTemplateDefinition } from '@flowgate/shared-types';
import { TopBar } from '@/components/shell/TopBar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { CommandPalette } from '@/components/command/CommandPalette';
import { api } from '@/lib/api';
import {
  Sparkles,
  Clock,
  Layers,
  ArrowRight,
  Code,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Play,
} from 'lucide-react';

export default function WorkflowTemplatesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [expandedPayloadId, setExpandedPayloadId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const categories = [
    { id: 'ALL', label: 'All Templates' },
    { id: 'FINANCE', label: 'Finance & CapEx' },
    { id: 'HR', label: 'People & HR' },
    { id: 'OPERATIONS', label: 'Client Services' },
    { id: 'SECURITY', label: 'Security & HIPAA' },
  ];

  const filteredTemplates =
    selectedCategory === 'ALL'
      ? WORKFLOW_TEMPLATES
      : WORKFLOW_TEMPLATES.filter((t) => t.category === selectedCategory);

  const handleUseTemplate = async (template: WorkflowTemplateDefinition) => {
    setLoadingTemplateId(template.id);
    try {
      const created = await api.createWorkflow({
        name: `${template.name} (Draft)`,
        description: template.description,
        nodes: template.nodes,
        edges: template.edges,
        inputSchema: template.inputSchema,
        status: 'DRAFT',
      });

      showToast({
        title: 'Template Cloned Successfully',
        description: `Created draft workflow "${created.name}". Opening builder...`,
        type: 'success',
      });

      router.push(`/workflows/${created.id}/builder`);
    } catch (err: any) {
      showToast({
        title: 'Failed to Instantiate Template',
        description: err.message || 'Error communicating with API',
        type: 'error',
      });
    } finally {
      setLoadingTemplateId(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-fg font-sans transition-colors duration-200">
      <TopBar
        breadcrumbs={[{ label: 'Workflows', href: '/workflows' }, { label: 'Industry Templates' }]}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      />

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in font-sans">
        {/* Header Hero */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-border-subtle">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-mono font-medium bg-surface text-accent border border-border-subtle">
                <Sparkles className="w-3.5 h-3.5" />[ PRODUCTION-READY BLUEPRINTS ]
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-serif font-bold tracking-tight text-ink">
              Industry Workflow Templates
            </h1>
            <p className="mt-2 text-sm sm:text-base text-fg-muted max-w-2xl font-mono">
              Battle-tested DAG workflows featuring JSON schema validation, parallel approval
              quorums, and AST conditional branching designed for high-compliance enterprise
              operations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push('/workflows')}>
              Browse Active Workflows
            </Button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none font-mono">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-none text-xs font-semibold uppercase tracking-wider transition-all whitespace-nowrap ${
                selectedCategory === cat.id
                  ? 'bg-accent text-white border border-accent'
                  : 'bg-surface border border-border-subtle text-fg-muted hover:text-ink hover:border-accent/40'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Templates Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {filteredTemplates.map((template) => {
            const isExpanding = expandedPayloadId === template.id;
            const isLoading = loadingTemplateId === template.id;

            return (
              <Card
                key={template.id}
                className="flex flex-col justify-between p-6 hover:shadow-none transition-all border-border-subtle hover:border-accent/50 group rounded-none"
              >
                <div className="space-y-4">
                  {/* Card Header Meta */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Chip variant="default" size="sm">
                        {template.categoryLabel}
                      </Chip>
                      <span className="flex items-center gap-1 text-[11px] font-mono text-fg-muted">
                        <Clock className="w-3.5 h-3.5" />
                        SLA: {template.estimatedTime}
                      </span>
                    </div>

                    <span className="text-[11px] font-mono text-fg-subtle">
                      {template.nodes.length} Nodes · {template.edges.length} Edges
                    </span>
                  </div>

                  {/* Title & Description */}
                  <div>
                    <h3 className="text-xl font-serif font-bold text-ink group-hover:text-accent transition-colors">
                      {template.name}
                    </h3>
                    <p className="mt-1.5 text-xs sm:text-sm text-fg-muted leading-relaxed">
                      {template.description}
                    </p>
                  </div>

                  {/* Visual Node Chain Strip */}
                  <div className="p-3 bg-canvas rounded-none border border-border-subtle font-mono">
                    <span className="block text-[10px] uppercase text-fg-subtle mb-2">
                      [ DAG Execution Pipeline ]
                    </span>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-none">
                      {template.nodes.map((node, i) => (
                        <React.Fragment key={node.id}>
                          <span
                            className={`px-2 py-1 rounded-none text-[11px] shrink-0 border ${
                              node.type === 'TRIGGER'
                                ? 'bg-surface text-ink border-border-subtle font-bold'
                                : node.type === 'CONDITION'
                                  ? 'bg-amber-950/20 text-amber-300 border-amber-800'
                                  : node.type === 'PARALLEL_APPROVAL'
                                    ? 'bg-accent/15 text-accent-foreground border-accent/40'
                                    : node.type === 'JOIN'
                                      ? 'bg-surface text-ink border-border-subtle'
                                      : node.type === 'END'
                                        ? 'bg-emerald-950/20 text-emerald-300 border-emerald-800'
                                        : 'bg-surface text-ink border-border-subtle'
                            }`}
                          >
                            {node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name}
                          </span>
                          {i < template.nodes.length - 1 && (
                            <ChevronRight className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  {/* Input Schema Preview */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-mono uppercase text-fg-subtle">
                      Input Payload Contract ({template.inputSchema.fields.length} Fields)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {template.inputSchema.fields.map((f) => (
                        <span
                          key={f.name}
                          className="px-2 py-0.5 rounded-none text-[11px] font-mono bg-canvas border border-border-subtle text-ink"
                        >
                          <span className="font-semibold text-ink">{f.name}</span>
                          <span className="text-fg-subtle ml-1">({f.type.toLowerCase()})</span>
                          {f.required && <span className="text-rose-500 ml-0.5">*</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Sample Payload Accordion */}
                  <div>
                    <button
                      onClick={() => setExpandedPayloadId(isExpanding ? null : template.id)}
                      className="text-xs font-mono text-accent hover:underline flex items-center gap-1 uppercase tracking-wider"
                    >
                      <Code className="w-3.5 h-3.5" />
                      {isExpanding ? '[ Hide Sample Payload ]' : '[ View Sample JSON Payload ]'}
                    </button>

                    {isExpanding && (
                      <pre className="mt-2 p-3 bg-canvas rounded-none border border-border-subtle text-[11px] font-mono text-fg-muted overflow-x-auto">
                        {JSON.stringify(template.samplePayload, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="mt-6 pt-4 border-t border-line flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Cryptographically Audited</span>
                  </div>

                  <Button
                    variant="primary"
                    size="sm"
                    loading={isLoading}
                    onClick={() => handleUseTemplate(template)}
                    className="gap-1.5 shadow-sm"
                  >
                    <span>Use Template</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
