import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import type { ContractChange, OpenApiDocument } from '@contrava/shared';
import { ScanJobStatus } from '@prisma/client';

export class JobsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsEnum(ScanJobStatus) status?: ScanJobStatus;
}


export class DeliveryClaimDto {
  @IsString() @IsNotEmpty() runnerId!: string;
}

export class ClaimJobDto {
  @IsString() @IsNotEmpty() runnerId!: string;
  @IsInt() @Min(1) @Max(50) maxJobs!: number;
}

export class JobTokenDto {
  @IsString() @IsNotEmpty() claimToken!: string;
  @IsString() @IsNotEmpty() runnerId!: string;
}

export class CompleteJobDto extends JobTokenDto {
  @IsString() @IsNotEmpty() hash!: string;
  @IsObject() spec!: OpenApiDocument;
  @IsOptional() @IsString() previousSnapshotId!: string | null;
  @IsArray() changes!: ContractChange[];
}

export class FailJobDto extends JobTokenDto {
  @IsString() @IsNotEmpty() error!: string;
}
