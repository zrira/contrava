import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import type { ContractChange, OpenApiDocument } from '@contrava/shared';

export class ClaimJobDto {
  @IsString() @IsNotEmpty() runnerId!: string;
}

export class JobTokenDto {
  @IsString() @IsNotEmpty() claimToken!: string;
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
