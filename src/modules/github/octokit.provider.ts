import { App } from '@octokit/app';
import { ConfigService } from '@nestjs/config';

export const OCTOKIT_APP = 'OCTOKIT_APP';

export const OctokitProvider = {
  provide: OCTOKIT_APP,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): App => {
    return new App({
      appId: configService.get<string>('github.appId') ?? '',
      privateKey: configService.get<string>('github.privateKey') ?? '',
      webhooks: {
        secret: configService.get<string>('github.webhookSecret') ?? '',
      },
    });
  },
};
