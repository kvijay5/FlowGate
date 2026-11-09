import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ResubmitRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  comments?: string;

  @IsOptional()
  requestData?: Record<string, unknown>;

  @IsOptional()
  updatedData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  resubmissionPolicy?: 'REOPEN_ALL' | 'SELECTIVE_FAST_FORWARD';
}
