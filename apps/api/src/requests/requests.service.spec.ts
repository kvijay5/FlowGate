import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EscalationsService } from '../escalations/escalations.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

describe('RequestsService', () => {
  let service: RequestsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockNotifications: any;
  let mockEscalations: any;
  let mockWebhooks: any;

  beforeEach(async () => {
    mockNotifications = {
      dispatchWorkflowNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getStats: jest.fn().mockResolvedValue({ sent: 0, pending: 0, failed: 0, total: 0 }),
    };

    mockEscalations = {
      scheduleStepJobs: jest.fn().mockResolvedValue(undefined),
      cancelStepJobs: jest.fn().mockResolvedValue(undefined),
    };

    mockWebhooks = {
      triggerEvent: jest.fn().mockResolvedValue([]),
    };

    mockPrisma = {
      $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
      workflowDefinition: {
        findUnique: jest.fn(),
      },
      approvalRequest: {
        create: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            id: 'req-1',
            ...args.data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      approvalStep: {
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'step-1', ...args.data })),
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    mockAudit = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      getEntityAuditTrail: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: EscalationsService, useValue: mockEscalations },
        { provide: WebhooksService, useValue: mockWebhooks },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  describe('create', () => {
    it('should throw BadRequestException if workflow is not ACTIVE', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-1',
        status: 'ARCHIVED',
      });

      await expect(
        service.create('tenant-1', 'user-1', {
          workflowDefinitionId: 'wf-1',
          title: 'Purchase Request',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should instantiate steps from active workflow configuration', async () => {
      mockPrisma.workflowDefinition.findUnique.mockResolvedValue({
        id: 'wf-1',
        status: 'ACTIVE',
        configuration: {
          steps: [
            { stepOrder: 1, name: 'Manager Review', assigneeType: 'ROLE', role: 'MANAGER' },
            { stepOrder: 2, name: 'Finance Review', assigneeType: 'ROLE', role: 'APPROVER' },
          ],
        },
      });

      // Mock findOne response
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'req-1',
        title: 'Purchase Request',
        status: 'IN_PROGRESS',
      } as any);

      const result = await service.create('tenant-1', 'user-1', {
        workflowDefinitionId: 'wf-1',
        title: 'Purchase Request',
      });

      expect(mockPrisma.approvalStep.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.approvalStep.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            stepOrder: 1,
            status: 'IN_REVIEW',
          }),
        }),
      );
      expect(mockPrisma.approvalStep.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({
            stepOrder: 2,
            status: 'PENDING',
          }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REQUEST_CREATED' }),
        expect.anything(),
      );
      expect(result.id).toBe('req-1');
    });
  });

  describe('submitAction', () => {
    const baseRequest = {
      id: 'req-1',
      tenantId: 'tenant-1',
      requestedById: 'user-requester',
      status: 'IN_PROGRESS',
      steps: [
        {
          id: 'step-1',
          stepOrder: 1,
          stepName: 'Manager Review',
          status: 'IN_REVIEW',
          assignedRole: 'MANAGER',
          assignedToId: null,
        },
        {
          id: 'step-2',
          stepOrder: 2,
          stepName: 'Finance Review',
          status: 'PENDING',
          assignedRole: 'APPROVER',
          assignedToId: null,
        },
      ],
    };

    it('should throw ConflictException if request is not in IN_PROGRESS', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue({
        ...baseRequest,
        status: 'APPROVED',
      });

      await expect(
        service.submitAction('tenant-1', 'user-manager', 'MANAGER', 'req-1', {
          action: 'APPROVE',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ForbiddenException if user role does not match assigned role', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(baseRequest);

      await expect(
        service.submitAction('tenant-1', 'user-random', 'REQUESTER', 'req-1', {
          action: 'APPROVE',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should advance from Step 1 to Step 2 when approved', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(baseRequest);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'req-1' } as any);

      await service.submitAction('tenant-1', 'user-manager', 'MANAGER', 'req-1', {
        action: 'APPROVE',
        comments: 'Looks good',
      });

      // Step 1 approved via atomic conditional update
      expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'step-1', status: 'IN_REVIEW' }),
          data: expect.objectContaining({ status: 'APPROVED', comments: 'Looks good' }),
        }),
      );

      // Step 2 moved to IN_REVIEW
      expect(mockPrisma.approvalStep.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'step-2' },
          data: expect.objectContaining({ status: 'IN_REVIEW' }),
        }),
      );

      // Audit logged
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'STEP_APPROVED' }),
        expect.anything(),
      );
    });

    it('should mark request APPROVED when final step is approved', async () => {
      const finalStepRequest = {
        ...baseRequest,
        steps: [
          {
            id: 'step-1',
            stepOrder: 1,
            stepName: 'Manager Review',
            status: 'APPROVED',
            assignedRole: 'MANAGER',
          },
          {
            id: 'step-2',
            stepOrder: 2,
            stepName: 'Finance Review',
            status: 'IN_REVIEW',
            assignedRole: 'APPROVER',
          },
        ],
      };
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(finalStepRequest);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'req-1' } as any);

      await service.submitAction('tenant-1', 'user-finance', 'APPROVER', 'req-1', {
        action: 'APPROVE',
        comments: 'Finance approved',
      });

      expect(mockPrisma.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'req-1', status: 'IN_PROGRESS' }),
          data: { status: 'APPROVED' },
        }),
      );

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REQUEST_APPROVED' }),
        expect.anything(),
      );
    });

    it('should mark request REJECTED and remaining steps SKIPPED on rejection', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(baseRequest);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'req-1' } as any);

      await service.submitAction('tenant-1', 'user-manager', 'MANAGER', 'req-1', {
        action: 'REJECT',
        comments: 'Budget exceeded',
      });

      expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'step-1', status: 'IN_REVIEW' }),
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );

      expect(mockPrisma.approvalStep.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { approvalRequestId: 'req-1', stepOrder: { gt: 1 } },
          data: { status: 'SKIPPED' },
        }),
      );

      expect(mockPrisma.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'req-1', status: 'IN_PROGRESS' }),
          data: { status: 'REJECTED' },
        }),
      );
    });

    it('should transition to CHANGES_REQUESTED when reviewer requests changes', async () => {
      mockPrisma.approvalRequest.findUnique.mockResolvedValue(baseRequest);
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'req-1' } as any);

      await service.submitAction('tenant-1', 'user-manager', 'MANAGER', 'req-1', {
        action: 'REQUEST_CHANGES',
        comments: 'Please attach quote',
      });

      expect(mockPrisma.approvalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'req-1', status: 'IN_PROGRESS' }),
          data: { status: 'CHANGES_REQUESTED' },
        }),
      );

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REQUEST_CHANGES_REQUESTED' }),
        expect.anything(),
      );
    });
  });
});
