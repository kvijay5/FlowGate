import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsNumber,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkflowStepConfigDto } from './workflow-step.dto';
import { WorkflowStatus } from '@prisma/client';
import {
  WorkflowNode,
  WorkflowEdge,
  InputSchema,
  WorkflowGraphConfiguration,
} from '@flowgate/shared-types';

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(WorkflowStatus)
  status?: WorkflowStatus;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepConfigDto)
  steps?: WorkflowStepConfigDto[];

  @IsOptional()
  @IsArray()
  nodes?: WorkflowNode[];

  @IsOptional()
  @IsArray()
  edges?: WorkflowEdge[];

  @IsOptional()
  inputSchema?: InputSchema;

  @IsOptional()
  configuration?: WorkflowGraphConfiguration;

  @IsOptional()
  @IsNumber()
  approvalThresholdUsd?: number;
}
