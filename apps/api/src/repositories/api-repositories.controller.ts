import { Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';

@Controller('apis/:apiId/repositories')
export class ApiRepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}
  @Post(':repositoryId') link(@Param('apiId') apiId: string, @Param('repositoryId') repositoryId: string) { return this.repositories.link(apiId, repositoryId); }
  @Delete(':repositoryId') @HttpCode(204) unlink(@Param('apiId') apiId: string, @Param('repositoryId') repositoryId: string) { return this.repositories.unlink(apiId, repositoryId); }
}
