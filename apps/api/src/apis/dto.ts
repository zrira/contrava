import { IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class CreateApiDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] }) specUrl!: string;
}

export class UpdateApiDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsUrl({ require_protocol: true, require_tld: false, protocols: ['http', 'https'] }) specUrl?: string;
}
