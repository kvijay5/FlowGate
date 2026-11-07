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
}
