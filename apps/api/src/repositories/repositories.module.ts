import { Module } from '@nestjs/common';
import { ApiRepositoriesController } from './api-repositories.controller';
import { InternalRepositoryScansController } from './internal-repository-scans.controller';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

@Module({ controllers: [RepositoriesController, InternalRepositoryScansController, ApiRepositoriesController], providers: [RepositoriesService], exports: [RepositoriesService] })
export class RepositoriesModule {}
