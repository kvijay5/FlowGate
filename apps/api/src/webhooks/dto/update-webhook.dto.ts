import { IsString, IsOptional, IsUrl, IsArray, IsEnum } from 'class-validator';
import { WebhookStatus } from '@prisma/client';

export class UpdateWebhookDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  url?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  eventTypes?: string[];

  @IsEnum(WebhookStatus)
  @IsOptional()
  status?: WebhookStatus;
}
