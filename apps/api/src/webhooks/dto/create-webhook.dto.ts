import { IsString, IsNotEmpty, IsUrl, IsArray, ArrayNotEmpty } from 'class-validator';

export class CreateWebhookDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  url: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes: string[];
}
