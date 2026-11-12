import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { WorkflowSimulatorService } from './workflow-simulator.service';
import { WORKFLOW_TEMPLATES } from '@flowgate/shared-types';

describe('Workflow Industry Templates & Simulation Validation', () => {
  let validator: WorkflowGraphValidatorService;
  let astEvaluator: AstConditionEvaluatorService;
  let simulator: WorkflowSimulatorService;

  beforeEach(() => {
    astEvaluator = new AstConditionEvaluatorService();
    validator = new WorkflowGraphValidatorService(astEvaluator);
    // simulator does not need prisma for pure in-memory simulateGraph calls
    simulator = new WorkflowSimulatorService(null as any, astEvaluator, validator);
  });

  it('contains all 4 expected industry templates', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(4);
    const templateIds = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(templateIds).toContain('template-fintech-capex');
    expect(templateIds).toContain('template-hr-onboarding');
    expect(templateIds).toContain('template-agency-deliverable');
    expect(templateIds).toContain('template-healthcare-vendor');
  });

  describe.each(WORKFLOW_TEMPLATES)('Template: %s ($name)', (template) => {
    it('passes static DAG validation without errors', () => {
      const validated = validator.validateDAG(template);
      expect(validated.triggerNode).toBeDefined();
      expect(validated.triggerNode.type).toBe('TRIGGER');
      expect(validated.endNodes.length).toBeGreaterThan(0);
      expect(validated.topologicalOrder.length).toBe(template.nodes.length);
    });

    it('simulates successfully using its sample payload', () => {
      const result = simulator.simulateGraph(
        template.name,
        template,
        template.samplePayload,
        template.id,
      );

      expect(result.success).toBe(true);
      expect(result.validationErrors).toBeUndefined();
      expect(result.activatedNodeIds.length).toBeGreaterThan(0);
      expect(result.finalOutcome).toBe('APPROVED');
      expect(result.executionPath[0]).toBe('node_trigger');
      expect(result.steps.length).toBeGreaterThan(0);
    });
  });

  describe('Simulation Branching & Pruning Verification', () => {
    const capexTemplate = WORKFLOW_TEMPLATES.find((t) => t.id === 'template-fintech-capex')!;

    it('routes to quorum committee when amount > $50,000', () => {
      const res = simulator.simulateGraph(
        capexTemplate.name,
        capexTemplate,
        { amount: 80000, department: 'ENGINEERING', vendorRisk: 'HIGH' },
        capexTemplate.id,
      );

      expect(res.success).toBe(true);
      expect(res.activatedNodeIds).toContain('node_parallel_committee');
      expect(res.prunedNodeIds).toContain('node_manager_approval');
      expect(res.activatedNodeIds).toContain('node_join');
      expect(res.activatedNodeIds).toContain('node_end');
    });

    it('routes to department manager when amount <= $50,000', () => {
      const res = simulator.simulateGraph(
        capexTemplate.name,
        capexTemplate,
        { amount: 25000, department: 'FINANCE', vendorRisk: 'LOW' },
        capexTemplate.id,
      );

      expect(res.success).toBe(true);
      expect(res.activatedNodeIds).toContain('node_manager_approval');
      expect(res.prunedNodeIds).toContain('node_parallel_committee');
      expect(res.activatedNodeIds).toContain('node_join');
      expect(res.activatedNodeIds).toContain('node_end');
    });

    it('fails simulation gracefully if required fields are missing', () => {
      const res = simulator.simulateGraph(
        capexTemplate.name,
        capexTemplate,
        { department: 'ENGINEERING' }, // missing amount and vendorRisk
        capexTemplate.id,
      );

      expect(res.success).toBe(false);
      expect(res.validationErrors).toBeDefined();
      expect(res.validationErrors?.length).toBeGreaterThanOrEqual(2);
      expect(res.finalOutcome).toBe('INVALID');
    });

    it('fails simulation if numeric value violates minimum boundary', () => {
      const res = simulator.simulateGraph(
        capexTemplate.name,
        capexTemplate,
        { amount: -50, department: 'ENGINEERING', vendorRisk: 'LOW' },
        capexTemplate.id,
      );

      expect(res.success).toBe(false);
      expect(res.validationErrors?.some((e) => e.includes('>= 1'))).toBe(true);
    });

    it('fails simulation if string value is not in allowedValues', () => {
      const res = simulator.simulateGraph(
        capexTemplate.name,
        capexTemplate,
        { amount: 5000, department: 'UNKNOWN_DEPT', vendorRisk: 'LOW' },
        capexTemplate.id,
      );

      expect(res.success).toBe(false);
      expect(res.validationErrors?.some((e) => e.includes('must be one of'))).toBe(true);
    });
  });
});
