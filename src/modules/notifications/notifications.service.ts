import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`Sending email to=${to} subject="${subject}"`);

    const resendApiKey = this.configService.get<string>('RESEND_API_KEY');
    const isDev =
      this.configService.get<string>('NODE_ENV') === 'development' ||
      !resendApiKey;

    if (isDev) {
      this.logger.debug(
        `[DEV] Email not sent (no RESEND_API_KEY or development mode). to=${to} subject="${subject}" body=${body}`,
      );
      return;
    }

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(resendApiKey);

      const from =
        this.configService.get<string>('EMAIL_FROM') ??
        'noreply@platform.com';

      const { error } = await resend.emails.send({
        from,
        to,
        subject,
        html: body,
      });

      if (error) {
        this.logger.error(
          `Failed to send email via Resend: ${JSON.stringify(error)}`,
        );
        return;
      }

      this.logger.log(`Email sent successfully to=${to}`);
    } catch (err: unknown) {
      // Never crash the application on email failure
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Exception while sending email: ${message}`);
    }
  }
}
