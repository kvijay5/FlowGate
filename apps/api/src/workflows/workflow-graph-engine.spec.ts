import { BadRequestException } from '@nestjs/common';
import { WorkflowGraphEngineService } from './workflow-graph-engine.service';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';

describe('WorkflowGraphEngineService (Unit)', () => {
  let engine: WorkflowGraphEngineService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockOutbox: any;
  let astEvaluator: AstConditionEvaluatorService;
  let graphValidator: WorkflowGraphValidatorService;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const workflowId = '33333333-3333-3333-3333-333333333333';
  const requestId = '44444444-4444-4444-4444-444444444444';

  beforeEach(() => {
    astEvaluator = new AstConditionEvaluatorService();
    graphValidator = new WorkflowGraphValidatorService(astEvaluator);

    mockAudit = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    mockOutbox = {
      createEvent: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };

    // Transaction mock that passes itself into callback
    mockPrisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'mock-lock-id' }]),
      workflowDefinition: {
        findUnique: jest.fn(),
      },
      approvalRequest: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      approvalStep: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      approvalStepAssignee: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      workflowNodeExecution: {
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      workflowBranchExecution: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      userDelegation: {
        findFirst: jest.fn(),
      },
    };

    engine = new WorkflowGraphEngineService(
      mockPrisma,
      mockAudit,
      mockOutbox,
      astEvaluator,
      graphValidator,
    );
  });

  // ===========================================================================
  // 1. GRAPH EXECUTION INITIALIZATION
  // ===========================================================================
  describe('1. initializeGraphExecution', () => {
    it('initializes a graph workflow and activates the first step', async () => {
      const graphConfig = {
        nodes: [
          { id: 'trig', type: 'TRIGGER', name: 'Start', config: {} },
          {
            id: 'step1',
            type: 'APPROVAL_STEP',
            name: 'Manager',
            config: { userId: 'u1', assigneeType: 'USER' },
          },
          { id: 'end', type: 'END', name: 'Finish', config: { outcome: 'APPROVED' } },
        ],
        edges: [
          { id: 'e1', sourceNodeId: 'trig', targetNodeId: 'step1' },
          { id: 'e2', sourceNodeId: 'step1', targetNodeId: 'end' },
        ],
      };

      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: workflowId,
        tenantId,
        status: 'ACTIVE',
        version: 1,
        configuration: graphConfig,
      });

      mockPrisma.approvalRequest.create.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
      });

      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', role: 'APPROVER' });
      mockPrisma.approvalStep.create.mockResolvedValue({ id: 'step-rec-1' });

      // First call to findMany for active branches returns e1
      mockPrisma.workflowBranchExecution.findMany
        .mockResolvedValueOnce([{ id: 'b1', branchKey: 'e1', targetNodeId: 'step1' }])
        .mockResolvedValue([]);

      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
      });

      const result = await engine.initializeGraphExecution(tenantId, userId, workflowId, {
        title: 'Project GPU Purchase',
        requestData: { amount: 5000 },
      });

      expect(mockPrisma.approvalRequest.create).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REQUEST_CREATED' }),
        expect.anything(),
      );
      expect(result).toBeDefined();
    });

    it('rejects initialization with oversized payload (> 32 KB)', async () => {
      const hugeString = 'A'.repeat(33000);

      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: workflowId,
        tenantId,
        status: 'ACTIVE',
        version: 1,
        configuration: {
          nodes: [
            { id: 't', type: 'TRIGGER', name: 'T', config: {} },
            { id: 'e', type: 'END', name: 'E', config: {} },
          ],
          edges: [{ id: 'e1', sourceNodeId: 't', targetNodeId: 'e' }],
        },
      });

      await expect(
        engine.initializeGraphExecution(tenantId, userId, workflowId, {
          title: 'Oversized',
          requestData: { payload: hugeString },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ===========================================================================
  // 2. PARALLEL VOTING & QUORUM-LOSS MATHEMATICS
  // ===========================================================================
  describe('2. Parallel Voting & Quorum-Loss Mathematics', () => {
    it('PARALLEL_AND: single rejection immediately terminates step and request with REJECTED', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
        workflowSnapshot: { nodes: [], edges: [] },
      });

      mockPrisma.approvalStep.findUnique.mockResolvedValue({
        id: 'step-1',
        approvalRequestId: requestId,
        reviewRound: 1,
        status: 'IN_REVIEW',
        policy: 'PARALLEL_AND',
        rejectionPolicy: 'SOFT_REJECTION',
        totalAssigned: 3,
        requiredApprovals: 3,
        approvedCount: 1,
        rejectedCount: 0,
        nodeId: 'par_node',
        assignees: [
          { id: 'a1', assignedToId: 'u1', status: 'APPROVED' },
          { id: 'a2', assignedToId: 'u2', status: 'PENDING' },
          { id: 'a3', assignedToId: 'u3', status: 'PENDING' },
        ],
      });

      // User 2 rejects
      const result = await engine.submitGraphAction(
        tenantId,
        'u2',
        'APPROVER',
        requestId,
        'step-1',
        {
          action: 'REJECT',
          comments: 'Security audit concerns',
        },
      );

      expect(result.stepStatus).toBe('REJECTED');
      expect(result.requestStatus).toBe('REJECTED');
      expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
      // Sibling assignees marked SKIPPED
      expect(mockPrisma.approvalStepAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { stepId: 'step-1', status: 'PENDING' },
          data: expect.objectContaining({ status: 'SKIPPED' }),
        }),
      );
    });

    it('PARALLEL_OR (SOFT_REJECTION): 1st rejection remains IN_REVIEW when quorum is still reachable', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
        workflowSnapshot: { nodes: [], edges: [] },
      });

      mockPrisma.approvalStep.findUnique.mockResolvedValue({
        id: 'step-1',
        approvalRequestId: requestId,
        reviewRound: 1,
        status: 'IN_REVIEW',
        policy: 'PARALLEL_OR',
        rejectionPolicy: 'SOFT_REJECTION',
        totalAssigned: 3,
        requiredApprovals: 2, // 2-of-3 required
        approvedCount: 0,
        rejectedCount: 0,
        nodeId: 'par_node',
        assignees: [
          { id: 'a1', assignedToId: 'u1', status: 'PENDING' },
          { id: 'a2', assignedToId: 'u2', status: 'PENDING' },
          { id: 'a3', assignedToId: 'u3', status: 'PENDING' },
        ],
      });

      // User 1 rejects: rejectedCount = 1, pending = 2, maxAchievable = 0 + 2 = 2 >= 2
      const result = await engine.submitGraphAction(
        tenantId,
        'u1',
        'APPROVER',
        requestId,
        'step-1',
        {
          action: 'REJECT',
        },
      );

      expect(result.stepStatus).toBe('IN_REVIEW');
      expect(result.requestStatus).toBe('IN_PROGRESS');
    });

    it('PARALLEL_OR: QUORUM_LOST triggers immediately when max achievable approvals < requiredApprovals', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
        workflowSnapshot: { nodes: [], edges: [] },
      });

      mockPrisma.approvalStep.findUnique.mockResolvedValue({
        id: 'step-1',
        approvalRequestId: requestId,
        reviewRound: 1,
        status: 'IN_REVIEW',
        policy: 'PARALLEL_OR',
        rejectionPolicy: 'SOFT_REJECTION',
        totalAssigned: 3,
        requiredApprovals: 2, // 2-of-3 required
        approvedCount: 0,
        rejectedCount: 1, // 1 already rejected
        nodeId: 'par_node',
        assignees: [
          { id: 'a1', assignedToId: 'u1', status: 'REJECTED' },
          { id: 'a2', assignedToId: 'u2', status: 'PENDING' },
          { id: 'a3', assignedToId: 'u3', status: 'PENDING' },
        ],
      });

      // User 2 rejects: new rejectedCount = 2, pending = 1, maxAchievable = 0 + 1 = 1 < 2!
      const result = await engine.submitGraphAction(
        tenantId,
        'u2',
        'APPROVER',
        requestId,
        'step-1',
        {
          action: 'REJECT',
        },
      );

      expect(result.stepStatus).toBe('REJECTED');
      expect(result.requestStatus).toBe('REJECTED');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_REJECTED_QUORUM_LOST' }),
        expect.anything(),
      );
    });

    it('PARALLEL_OR (STRICT_VETO): 1st rejection immediately terminates stage and request', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
        workflowSnapshot: { nodes: [], edges: [] },
      });

      mockPrisma.approvalStep.findUnique.mockResolvedValue({
        id: 'step-1',
        approvalRequestId: requestId,
        reviewRound: 1,
        status: 'IN_REVIEW',
        policy: 'PARALLEL_OR',
        rejectionPolicy: 'STRICT_VETO',
        totalAssigned: 3,
        requiredApprovals: 1,
        approvedCount: 0,
        rejectedCount: 0,
        nodeId: 'par_node',
        assignees: [
          { id: 'a1', assignedToId: 'u1', status: 'PENDING' },
          { id: 'a2', assignedToId: 'u2', status: 'PENDING' },
          { id: 'a3', assignedToId: 'u3', status: 'PENDING' },
        ],
      });

      const result = await engine.submitGraphAction(
        tenantId,
        'u1',
        'APPROVER',
        requestId,
        'step-1',
        {
          action: 'REJECT',
          comments: 'Immediate strict veto invoked',
        },
      );

      expect(result.stepStatus).toBe('REJECTED');
      expect(result.requestStatus).toBe('REJECTED');
    });

    it('rejects duplicate vote submission by the same user', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'IN_PROGRESS',
        currentReviewRound: 1,
        workflowSnapshot: { nodes: [], edges: [] },
      });

      mockPrisma.approvalStep.findUnique.mockResolvedValue({
        id: 'step-1',
        approvalRequestId: requestId,
        reviewRound: 1,
        status: 'IN_REVIEW',
        policy: 'PARALLEL_AND',
        rejectionPolicy: 'SOFT_REJECTION',
        totalAssigned: 2,
        requiredApprovals: 2,
        approvedCount: 1,
        rejectedCount: 0,
        nodeId: 'par_node',
        assignees: [
          { id: 'a1', assignedToId: 'u1', status: 'APPROVED' }, // Already approved!
          { id: 'a2', assignedToId: 'u2', status: 'PENDING' },
        ],
      });

      await expect(
        engine.submitGraphAction(tenantId, 'u1', 'APPROVER', requestId, 'step-1', {
          action: 'APPROVE',
        }),
      ).rejects.toThrow(/User has already submitted a decision/);
    });
  });

  // ===========================================================================
  // 3. MULTI-ROUND RESUBMISSION
  // ===========================================================================
  describe('3. Multi-Round Resubmission (resubmitGraphRequest)', () => {
    it('increments review round from 1 to 2, retains round 1 immutable, and starts round 2', async () => {
      const graph = {
        nodes: [
          { id: 'trig', type: 'TRIGGER', name: 'Start', config: {} },
          { id: 'step1', type: 'APPROVAL_STEP', name: 'Step 1', config: {} },
          { id: 'end', type: 'END', name: 'Done', config: { outcome: 'APPROVED' } },
        ],
        edges: [
          { id: 'e1', sourceNodeId: 'trig', targetNodeId: 'step1' },
          { id: 'e2', sourceNodeId: 'step1', targetNodeId: 'end' },
        ],
        triggerNode: { id: 'trig', type: 'TRIGGER', name: 'Start', config: {} },
        endNodes: [{ id: 'end', type: 'END', name: 'Done', config: {} }],
        topologicalOrder: ['trig', 'step1', 'end'],
      };

      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        id: requestId,
        tenantId,
        status: 'CHANGES_REQUESTED',
        currentReviewRound: 1,
        requestData: { amount: 5000 },
        workflowSnapshot: graph,
      });

      mockPrisma.workflowBranchExecution.findMany.mockResolvedValue([]);

      await engine.resubmitGraphRequest(tenantId, userId, requestId, {
        updatedData: { amount: 4500, comments: 'Reduced budget' },
      });

      expect(mockPrisma.approvalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentReviewRound: 2,
            status: 'IN_PROGRESS',
          }),
        }),
      );

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REQUEST_RESUBMITTED',
          metadata: expect.objectContaining({ fromRound: 1, toRound: 2 }),
        }),
        expect.anything(),
      );
    });
  });
});
