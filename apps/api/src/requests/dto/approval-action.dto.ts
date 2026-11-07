import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApprovalActionType } from '@flowgate/shared-types';

export class ApprovalActionDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_CHANGES'])
  action: ApprovalActionType;

  @IsOptional()
  @IsString()
  comments?: string;
}
