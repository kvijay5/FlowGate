import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApprovalRequestStatus } from '@flowgate/shared-types';

export class QueryRequestsDto {
  @IsOptional()
  @IsIn(['mine', 'pending_approval', 'all'])
  filter?: 'mine' | 'pending_approval' | 'all';

  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'CHANGES_REQUESTED'])
  status?: ApprovalRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
