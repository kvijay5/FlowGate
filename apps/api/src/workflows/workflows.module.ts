import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { AstConditionEvaluatorService } from './ast-condition-evaluator.service';
import { WorkflowGraphValidatorService } from './workflow-graph-validator.service';
import { WorkflowGraphEngineService } from './workflow-graph-engine.service';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    AstConditionEvaluatorService,
    WorkflowGraphValidatorService,
    WorkflowGraphEngineService,
  ],
  exports: [
    WorkflowsService,
    AstConditionEvaluatorService,
    WorkflowGraphValidatorService,
    WorkflowGraphEngineService,
  ],
})
export class WorkflowsModule {}
