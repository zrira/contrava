import { IsBoolean, IsIn, IsInt } from 'class-validator';
export const SCAN_INTERVALS = [5, 15, 30, 60, 360, 1440] as const;
export class UpdateScheduleDto {
  @IsBoolean() scanEnabled!: boolean;
  @IsInt() @IsIn(SCAN_INTERVALS) scanIntervalMinutes!: number;
}
