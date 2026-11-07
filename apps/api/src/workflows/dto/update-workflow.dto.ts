import {
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
  ArrayMinSize,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkflowStepConfigDto } from './workflow-step.dto';

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Workflow must define at least one approval step if steps are provided',
  })
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepConfigDto)
  steps?: WorkflowStepConfigDto[];

  @IsOptional()
  @IsNumber()
  approvalThresholdUsd?: number;
}
