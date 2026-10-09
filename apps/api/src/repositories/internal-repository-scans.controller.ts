import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { CompleteRepositoryScanRequest } from '@contrava/shared';
import type { CorrelatedRequest } from '../common/correlation-id.middleware';
import { ClaimRepositoryScanDto, CompleteRepositoryScanDto, FailRepositoryScanDto, RepositoryScanTokenDto, ResolveRepositoryScanDto } from './repository.dto';
import { RepositoriesService } from './repositories.service';

@Controller('internal/repository-scans')
export class InternalRepositoryScansController {
  constructor(private readonly repositories: RepositoriesService) {}
  @Post(':id/claim') @HttpCode(200) claim(@Param('id') id: string, @Body() body: ClaimRepositoryScanDto) { return this.repositories.claim(id, body.runnerId); }
  @Post(':id/resolve') @HttpCode(200) resolve(@Param('id') id: string, @Body() body: ResolveRepositoryScanDto) { return this.repositories.resolve(id, body.claimToken, body.runnerId, body); }
  @Post(':id/heartbeat') @HttpCode(200) heartbeat(@Param('id') id: string, @Body() body: RepositoryScanTokenDto) { return this.repositories.heartbeat(id, body.claimToken, body.runnerId); }
  @Post(':id/complete') @HttpCode(200) complete(@Param('id') id: string, @Body() body: CompleteRepositoryScanDto) { return this.repositories.complete(id, body as unknown as CompleteRepositoryScanRequest); }
  @Post(':id/fail') @HttpCode(200) fail(@Param('id') id: string, @Body() body: FailRepositoryScanDto, @Req() request: CorrelatedRequest) { return this.repositories.fail(id, body.claimToken, body.runnerId, body, request.requestId); }
}
