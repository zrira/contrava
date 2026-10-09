import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ClaimJobDto, CompleteJobDto, DeliveryClaimDto, FailJobDto, JobTokenDto } from './job.dto';
import { JobsService } from './jobs.service';

/** Internal runner protocol. These routes are intentionally unauthenticated only for local Phase 2. */
@Controller('internal/jobs')
export class InternalJobsController {
  constructor(private readonly jobs: JobsService) {}
  @Post('claim') @HttpCode(200) claim(@Body() body: ClaimJobDto) { return this.jobs.claim(body.runnerId, body.maxJobs); }
  @Post(':id/claim') @HttpCode(200) claimDelivery(@Param('id') id: string, @Body() body: DeliveryClaimDto) { return this.jobs.claimDelivery(id, body.runnerId); }
  @Post(':id/dead-letter') @HttpCode(200) deadLetter(@Param('id') id: string) { return this.jobs.markDeadLettered(id); }
  @Post(':id/start') @HttpCode(200) start(@Param('id') id: string, @Body() body: JobTokenDto) { return this.jobs.start(id, body.claimToken, body.runnerId); }
  @Post(':id/heartbeat') @HttpCode(200) heartbeat(@Param('id') id: string, @Body() body: JobTokenDto) { return this.jobs.heartbeat(id, body.claimToken, body.runnerId); }
  @Post(':id/complete') @HttpCode(200) complete(@Param('id') id: string, @Body() body: CompleteJobDto) { return this.jobs.complete(id, body); }
  @Post(':id/fail') @HttpCode(200) fail(@Param('id') id: string, @Body() body: FailJobDto) { return this.jobs.fail(id, body.claimToken, body.runnerId, body.error); }
}
