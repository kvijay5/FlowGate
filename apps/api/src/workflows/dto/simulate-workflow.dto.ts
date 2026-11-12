import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SimulateWorkflowDto {
  @ApiProperty({
    description: 'Input payload data to simulate against the workflow definition',
    example: {
      amount: 75000,
      department: 'ENGINEERING',
      vendorRisk: 'MEDIUM',
    },
  })
  @IsObject()
  requestData: Record<string, unknown>;
}
