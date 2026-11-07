import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { WebhooksService } from './webhooks.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';

@Controller('api/v1/webhooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('TENANT_ADMIN', 'SUPER_ADMIN')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateWebhookDto) {
    return this.webhooksService.create(tenantId, dto);
  }

  @Get()
  async findAll(@CurrentTenant() tenantId: string) {
    return this.webhooksService.findAll(tenantId);
  }

  @Get('deliveries')
  async findAllDeliveries(
    @CurrentTenant() tenantId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.webhooksService.findDeliveries(tenantId, undefined, page, limit);
  }

  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.findOne(tenantId, id);
  }

  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.webhooksService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.webhooksService.remove(tenantId, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  async testPing(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.testPing(tenantId, id);
  }

  @Get(':id/deliveries')
  async findDeliveries(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.webhooksService.findDeliveries(tenantId, id, page, limit);
  }

  @Post('deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.OK)
  async retryDelivery(
    @CurrentTenant() tenantId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooksService.retryDelivery(tenantId, deliveryId);
  }

  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  async receiveInboundWebhook(
    @CurrentTenant() tenantId: string,
    @Body() payload: Record<string, unknown>,
  ) {
    const eventId =
      (payload?.eventId as string) || (payload?.id as string) || (payload?.event_id as string);
    const eventType =
      (payload?.event as string) || (payload?.eventType as string) || 'generic.event';

    if (!eventId) {
      throw new BadRequestException('Missing eventId in inbound webhook payload');
    }

    const result = await this.webhooksService.recordInboundEvent(
      tenantId,
      eventId,
      eventType,
      payload,
    );

    if (result.isDuplicate) {
      return {
        status: 'DUPLICATE',
        received: true,
        duplicate: true,
        eventId,
        message: 'Event was already processed within deduplication window',
        firstProcessedAt: result.firstProcessedAt,
      };
    }

    return {
      status: 'PROCESSED',
      received: true,
      duplicate: false,
      eventId,
      message: 'Event successfully received and recorded',
    };
  }
}
