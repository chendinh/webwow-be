import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GithubController } from './github.controller';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubService } from './github.service';
import { OctokitProvider } from './octokit.provider';

@Module({
  imports: [PrismaModule],
  providers: [GithubService, OctokitProvider],
  controllers: [GithubController, GithubWebhookController],
  exports: [GithubService],
})
export class GithubModule {}
