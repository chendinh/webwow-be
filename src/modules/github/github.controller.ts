import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GitHubRepo, GithubService } from './github.service';

@ApiTags('GitHub')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  // ── GET /github/install-url ────────────────────────────────────────────

  @Get('install-url')
  @ApiOperation({ summary: 'Get GitHub App installation URL' })
  @ApiResponse({
    status: 200,
    description: 'Returns the URL to install the GitHub App on an organisation.',
    schema: { example: { installUrl: 'https://github.com/apps/my-app/installations/new' } },
  })
  getInstallUrl(): { installUrl: string } {
    return { installUrl: this.githubService.getInstallUrl() };
  }

  // ── GET /github/callback ───────────────────────────────────────────────

  @Get('callback')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Handle GitHub App installation OAuth callback' })
  @ApiQuery({ name: 'installation_id', required: true, description: 'GitHub installation ID' })
  @ApiQuery({ name: 'organization_id', required: true, description: 'Internal organisation UUID' })
  @ApiResponse({ status: 201, description: 'Installation stored successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorised.' })
  async handleCallback(
    @Query('installation_id') installationId: string,
    @Query('organization_id') organizationId: string,
  ): Promise<void> {
    await this.githubService.handleInstallationCallback(
      Number(installationId),
      organizationId,
    );
  }

  // ── GET /github/repos ──────────────────────────────────────────────────

  @Get('repos')
  @ApiOperation({ summary: 'List repositories accessible by the organisation GitHub installation' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'Internal organisation UUID' })
  @ApiResponse({
    status: 200,
    description: 'Array of GitHub repositories.',
  })
  @ApiResponse({ status: 401, description: 'Unauthorised.' })
  @ApiResponse({ status: 404, description: 'GitHub installation not found for organisation.' })
  async getRepositories(
    @Query('organizationId') organizationId: string,
  ): Promise<GitHubRepo[]> {
    return this.githubService.getRepositories(organizationId);
  }

  // ── GET /github/repos/:owner/:repo/branches ────────────────────────────

  @Get('repos/:owner/:repo/branches')
  @ApiOperation({ summary: 'List branches for a specific repository' })
  @ApiQuery({ name: 'organizationId', required: true, description: 'Internal organisation UUID' })
  @ApiResponse({
    status: 200,
    description: 'Array of branch names.',
    schema: { example: ['main', 'develop', 'feature/new-ui'] },
  })
  @ApiResponse({ status: 401, description: 'Unauthorised.' })
  @ApiResponse({ status: 404, description: 'GitHub installation not found for organisation.' })
  async getBranches(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('organizationId') organizationId: string,
  ): Promise<string[]> {
    return this.githubService.getBranches(organizationId, owner, repo);
  }
}
