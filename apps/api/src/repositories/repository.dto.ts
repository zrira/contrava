import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateRepositoryDto {
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,120}$/) owner!: string;
  @IsString() @Matches(/^[A-Za-z0-9_.-]{1,120}$/) name!: string;
  @IsOptional() @IsString() @IsNotEmpty() selectedBranch?: string;
}
export class ClaimRepositoryScanDto { @IsString() @IsNotEmpty() runnerId!: string; }
export class RepositoryScanTokenDto { @IsString() @IsNotEmpty() claimToken!: string; @IsString() @IsNotEmpty() runnerId!: string; }
export class ResolveRepositoryScanDto extends RepositoryScanTokenDto {
  @IsString() @Matches(/^[0-9a-f]{40}$/i) commitSha!: string;
  @IsString() @IsNotEmpty() defaultBranch!: string;
  @IsString() @IsNotEmpty() externalRepositoryId!: string;
}
export class CompleteRepositoryScanDto extends RepositoryScanTokenDto {
  @IsString() @Matches(/^[0-9a-f]{40}$/i) commitSha!: string;
  @IsString() @IsNotEmpty() defaultBranch!: string;
  @IsString() @IsNotEmpty() externalRepositoryId!: string;
  @IsBoolean() fullScan!: boolean;
  @IsArray() files!: unknown[];
  @IsArray() deletedPaths!: string[];
  @IsArray() indexedPaths!: string[];
  @IsInt() @Min(0) filesSkipped!: number;
}
export class FailRepositoryScanDto extends RepositoryScanTokenDto {
  @IsString() @IsNotEmpty() error!: string;
  @IsBoolean() retryable!: boolean;
  @IsOptional() @IsBoolean() rateLimited?: boolean;
  @IsOptional() @IsString() retryAt?: string;
}
export class UsageQueryDto {
  @IsOptional() @IsString() apiId?: string;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() path?: string;
  @IsOptional() @IsIn(['HIGH', 'MEDIUM', 'LOW']) confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  @IsOptional() @IsString() file?: string;
  @IsOptional() @IsInt() @Min(1) page = 1;
  @IsOptional() @IsInt() @Min(1) @Max(100) pageSize = 25;
}
