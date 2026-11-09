import { Test, TestingModule } from '@nestjs/testing';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

describe('AuditController', () => {
  let controller: AuditController;
  let mockAuditService: { verifyChain: jest.Mock };

  beforeEach(async () => {
    mockAuditService = {
      verifyChain: jest.fn().mockResolvedValue({
        valid: true,
        totalEntries: 5,
        details:
          'Audit chain integrity verified. Zero forks, gaps, reorderings, modifications, or deletions detected.',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should verify audit chain for current tenant', async () => {
    const result = await controller.verifyChain('tenant-123');
    expect(mockAuditService.verifyChain).toHaveBeenCalledWith('tenant-123');
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(5);
  });
});
