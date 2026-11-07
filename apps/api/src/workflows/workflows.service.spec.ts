import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowsService } from './workflows.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException } from '@nestjs/common';

describe('WorkflowsService', () => {
  let service: WorkflowsService;
  let mockPrisma: any;
  let mockAudit: any;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
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
});
