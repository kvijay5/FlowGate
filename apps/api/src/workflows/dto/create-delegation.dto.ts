import { IsUUID, IsNotEmpty, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDelegationDto {
  @IsUUID('4', { message: 'delegateeId must be a valid UUID' })
  @IsNotEmpty({ message: 'delegateeId is required' })
  delegateeId!: string;

  @IsISO8601({}, { message: 'startDate must be a valid ISO 8601 timestamp' })
  @IsNotEmpty({ message: 'startDate is required' })
  startDate!: string;

  @IsISO8601({}, { message: 'endDate must be a valid ISO 8601 timestamp' })
  @IsNotEmpty({ message: 'endDate is required' })
  endDate!: string;

  @IsOptional()
  @IsUUID('4', { message: 'workflowDefinitionId must be a valid UUID' })
  workflowDefinitionId?: string | null;

  @IsOptional()
  delegateRoles?: boolean | string[];

  @IsOptional()
  @IsString({ message: 'reason must be a string' })
  @MaxLength(500, { message: 'reason cannot exceed 500 characters' })
  reason?: string | null;
}
