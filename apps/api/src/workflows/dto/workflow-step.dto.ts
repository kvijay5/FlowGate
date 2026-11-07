import { IsInt, IsNotEmpty, IsOptional, IsString, Min, IsIn } from 'class-validator';
import { AssigneeType, UserRole } from '@flowgate/shared-types';

export class WorkflowStepConfigDto {
  @IsInt()
  @Min(1)
  stepOrder: number;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(['ROLE', 'USER'])
  assigneeType: AssigneeType;

  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'REQUESTER', 'APPROVER'])
  role?: UserRole;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
