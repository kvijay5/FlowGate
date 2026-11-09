import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowsService } from './workflows.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { WorkflowGraphEngineService } from './workflow-graph-engine.service';
import { BadRequestException } from '@nestjs/common';

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockGraphEngine: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      workflowDefinition: {
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'wf-1', ...args.data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest
          .fn()
          .mockImplementation((args) =>
            Promise.resolve({ id: args.where.tenant_workflow_id_unique.id, ...args.data }),
          ),
        count: jest.fn().mockResolvedValue(0),
      },
      approvalRequest: {
        count: jest.fn().mockResolvedValue(0),
      },
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    mockGraphEngine = {
      getExecutionGraph: jest.fn().mockResolvedValue({
        requestId: 'req-1',
        nodeExecutions: [],
        branchExecutions: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        AstConditionEvaluatorService,
        WorkflowGraphValidatorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: WorkflowGraphEngineService, useValue: mockGraphEngine },
      ],
    }).compile();

    service = module.get<WorkflowsService>(WorkflowsService);
  });

  describe('validateStepConfiguration', () => {
    it('should throw BadRequestException for empty steps', () => {
      expect(() => service.validateStepConfiguration([])).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if step orders are not sequential starting at 1', () => {
      expect(() =>
        service.validateStepConfiguration([
          { stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' },
          { stepOrder: 3, name: 'Step 3', assigneeType: 'ROLE', role: 'APPROVER' },
        ]),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if ROLE assigneeType has no role', () => {
      expect(() =>
        service.validateStepConfiguration([{ stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE' }]),
      ).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if USER assigneeType has no userId or userEmail', () => {
      expect(() =>
        service.validateStepConfiguration([{ stepOrder: 1, name: 'Step 1', assigneeType: 'USER' }]),
      ).toThrow(BadRequestException);
    });

    it('should succeed for valid sequential steps', () => {
      expect(() =>
        service.validateStepConfiguration([
          { stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' },
          { stepOrder: 2, name: 'Step 2', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
        ]),
      ).not.toThrow();
    });
  });

  describe('create', () => {
    it('should create workflow in ACTIVE state and write audit record', async () => {
      const result = await service.create('tenant-1', 'actor-1', {
        name: 'Standard Hardware Approval',
        description: 'For IT equipment',
        steps: [{ stepOrder: 1, name: 'Finance Review', assigneeType: 'ROLE', role: 'APPROVER' }],
      });

      expect(mockPrisma.workflowDefinition.create).toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WORKFLOW_CREATED',
          entityType: 'WorkflowDefinition',
        }),
        expect.anything(),
      );
      expect(result.name).toBe('Standard Hardware Approval');
    });
  });

  describe('update', () => {
    it('should bump version when structural steps change and active requests exist', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        name: 'Capex',
        version: 1,
        configuration: {
          steps: [{ stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' }],
        },
      });
      mockPrisma.approvalRequest.count.mockResolvedValue(2); // 2 active requests exist

      await service.update('tenant-1', 'actor-1', 'wf-1', {
        steps: [
          { stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' },
          { stepOrder: 2, name: 'Step 2', assigneeType: 'ROLE', role: 'TENANT_ADMIN' },
        ],
      });

      expect(mockPrisma.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 2,
          }),
        }),
      );
    });
  });

  describe('activate and deactivate', () => {
    it('should activate workflow with valid steps', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
        name: 'Capex',
        configuration: {
          steps: [{ stepOrder: 1, name: 'Step 1', assigneeType: 'ROLE', role: 'APPROVER' }],
        },
      });

      await service.activate('tenant-1', 'actor-1', 'wf-1');

      expect(mockPrisma.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'ACTIVE' },
        }),
      );
    });

    it('should archive workflow on deactivate', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-1',
        tenantId: 'tenant-1',
      });

      await service.deactivate('tenant-1', 'actor-1', 'wf-1');

      expect(mockPrisma.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'ARCHIVED' },
        }),
      );
    });
  });

  describe('publishWorkflow', () => {
    it('should publish a valid DAG workflow into ACTIVE status and record audit log', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-dag-1',
        tenantId: 'tenant-1',
        name: 'DAG Workflow',
        version: 1,
        status: 'DRAFT',
        configuration: {
          nodes: [
            { id: 'node-trigger', type: 'TRIGGER', name: 'Start' },
            { id: 'node-end', type: 'END', name: 'Finish' },
          ],
          edges: [{ id: 'edge-1', sourceNodeId: 'node-trigger', targetNodeId: 'node-end' }],
        },
      });

      const published = await service.publishWorkflow('tenant-1', 'wf-dag-1', 'actor-1');

      expect(mockPrisma.workflowDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_workflow_id_unique: {
              tenantId: 'tenant-1',
              id: 'wf-dag-1',
            },
          },
          data: { status: 'ACTIVE' },
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WORKFLOW_PUBLISHED',
          entityType: 'WorkflowDefinition',
          entityId: 'wf-dag-1',
        }),
        expect.anything(),
      );
      expect(published.status).toBe('ACTIVE');
    });

    it('should fail to publish if DAG is structurally invalid', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-invalid',
        tenantId: 'tenant-1',
        name: 'Invalid DAG',
        version: 1,
        status: 'DRAFT',
        configuration: {
          nodes: [
            { id: 'node-trigger', type: 'TRIGGER', name: 'Start' },
            // Missing END node!
          ],
          edges: [],
        },
      });

      await expect(service.publishWorkflow('tenant-1', 'wf-invalid', 'actor-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('cloneDraftVersion', () => {
    it('should clone existing active workflow to vN+1 in DRAFT status', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-v1',
        tenantId: 'tenant-1',
        name: 'PO Approval',
        description: 'Purchase Orders',
        version: 1,
        status: 'ACTIVE',
        configuration: {
          nodes: [
            { id: 't1', type: 'TRIGGER', name: 'Start' },
            { id: 'e1', type: 'END', name: 'Finish' },
          ],
          edges: [{ id: 'ed1', sourceNodeId: 't1', targetNodeId: 'e1' }],
        },
      });

      mockPrisma.workflowDefinition.findMany.mockResolvedValue([{ version: 1 }]);

      const cloned = await service.cloneDraftVersion('tenant-1', 'wf-v1', 'actor-1');

      expect(mockPrisma.workflowDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 'tenant-1',
            name: 'PO Approval',
            version: 2,
            status: 'DRAFT',
          }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WORKFLOW_DRAFT_CLONED',
          entityType: 'WorkflowDefinition',
          metadata: expect.objectContaining({
            sourceWorkflowId: 'wf-v1',
            sourceVersion: 1,
            newVersion: 2,
            status: 'DRAFT',
          }),
        }),
        expect.anything(),
      );
      expect(cloned.version).toBe(2);
      expect(cloned.status).toBe('DRAFT');
    });
  });

  describe('getExecutionGraph', () => {
    it('should delegate execution graph retrieval to graph engine', async () => {
      const graph = await service.getExecutionGraph('tenant-1', 'req-1');
      expect(mockGraphEngine.getExecutionGraph).toHaveBeenCalledWith('tenant-1', 'req-1');
      expect(graph.requestId).toBe('req-1');
    });
  });
});
