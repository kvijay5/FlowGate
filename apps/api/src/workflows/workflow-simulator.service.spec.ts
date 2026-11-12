import { NotFoundException } from '@nestjs/common';
import { WorkflowSimulatorService } from './workflow-simulator.service';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { PrismaService } from '../prisma/prisma.service';

describe('WorkflowSimulatorService', () => {
  let simulator: WorkflowSimulatorService;
  let prismaMock: { workflowDefinition: { findUnique: jest.Mock } };
  let validator: WorkflowGraphValidatorService;
  let astEvaluator: AstConditionEvaluatorService;

  beforeEach(() => {
    astEvaluator = new AstConditionEvaluatorService();
    validator = new WorkflowGraphValidatorService(astEvaluator);
    prismaMock = {
      workflowDefinition: {
        findUnique: jest.fn(),
      },
    };

    simulator = new WorkflowSimulatorService(
      prismaMock as unknown as PrismaService,
      astEvaluator,
      validator,
    );
  });

  describe('simulateWorkflow (Database Integrated)', () => {
    const tenantId = 'tenant-test-123';
    const workflowId = 'wf-test-456';

    it('throws NotFoundException when workflow is not found in tenant', async () => {
      prismaMock.workflowDefinition.findUnique.mockResolvedValue(null);

      await expect(
        simulator.simulateWorkflow(tenantId, workflowId, { foo: 'bar' }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaMock.workflowDefinition.findUnique).toHaveBeenCalledWith({
        where: {
          tenant_workflow_id_unique: {
            tenantId,
            id: workflowId,
          },
        },
      });
    });

    it('successfully simulates a persisted workflow', async () => {
      const persistedWf = {
        id: workflowId,
        name: 'Simple Linear Workflow',
        configuration: {
          nodes: [
            { id: 'n_trig', type: 'TRIGGER', name: 'Submit', config: {} },
            {
              id: 'n_app',
              type: 'APPROVAL_STEP',
              name: 'Approve',
              config: { assigneeType: 'ROLE', role: 'APPROVER' },
            },
            { id: 'n_end', type: 'END', name: 'Finished', config: { outcome: 'APPROVED' } },
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'n_trig', targetNodeId: 'n_app' },
            { id: 'e2', sourceNodeId: 'n_app', targetNodeId: 'n_end' },
          ],
        },
      };

      prismaMock.workflowDefinition.findUnique.mockResolvedValue(persistedWf);

      const result = await simulator.simulateWorkflow(tenantId, workflowId, {});
      expect(result.success).toBe(true);
      expect(result.workflowId).toBe(workflowId);
      expect(result.workflowName).toBe('Simple Linear Workflow');
      expect(result.activatedNodeIds).toEqual(['n_trig', 'n_app', 'n_end']);
      expect(result.prunedNodeIds).toEqual([]);
      expect(result.finalOutcome).toBe('APPROVED');
    });
  });

  describe('Edge Case Handling', () => {
    it('returns error result if payload exceeds 32 KB byte limit', () => {
      const largePayload = {
        data: 'a'.repeat(35 * 1024),
      };

      const result = simulator.simulateGraph(
        'Large Payload Test',
        {
          nodes: [
            { id: 'trig', type: 'TRIGGER', name: 'Trig', config: {} },
            { id: 'end', type: 'END', name: 'End', config: {} },
          ],
          edges: [{ id: 'e1', sourceNodeId: 'trig', targetNodeId: 'end' }],
        },
        largePayload,
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0]).toContain(
        'exceeds maximum allowed limit of 32768 bytes',
      );
    });

    it('returns error result if DAG has cycles', () => {
      const cyclicalConfig = {
        nodes: [
          { id: 'trig', type: 'TRIGGER', name: 'Trig', config: {} },
          { id: 'n1', type: 'APPROVAL_STEP', name: 'Step 1', config: {} },
          { id: 'n2', type: 'APPROVAL_STEP', name: 'Step 2', config: {} },
          { id: 'end', type: 'END', name: 'End', config: {} },
        ],
        edges: [
          { id: 'e1', sourceNodeId: 'trig', targetNodeId: 'n1' },
          { id: 'e2', sourceNodeId: 'n1', targetNodeId: 'n2' },
          { id: 'e3', sourceNodeId: 'n2', targetNodeId: 'n1' }, // cycle!
          { id: 'e4', sourceNodeId: 'n2', targetNodeId: 'end' },
        ],
      };

      const result = simulator.simulateGraph('Cyclic Test', cyclicalConfig as any, {});
      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0]).toContain('contains cycles');
    });
  });
});
