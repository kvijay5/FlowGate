import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateApprovalRequestDto {
  @IsUUID('4', { message: 'workflowDefinitionId must be a valid UUID' })
  @IsNotEmpty()
  workflowDefinitionId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  requestData?: Record<string, unknown>;

  @IsOptional()
  payload?: Record<string, unknown>;
}
