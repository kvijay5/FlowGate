import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkflowStepConfigDto } from './workflow-step.dto';

export class CreateWorkflowDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Workflow must define at least one approval step' })
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepConfigDto)
  steps: WorkflowStepConfigDto[];

  @IsOptional()
  @IsNumber()
  approvalThresholdUsd?: number;
}
