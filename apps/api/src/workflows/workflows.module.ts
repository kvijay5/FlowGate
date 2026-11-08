import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, AstConditionEvaluatorService],
  exports: [WorkflowsService, AstConditionEvaluatorService],
})
export class WorkflowsModule {}
