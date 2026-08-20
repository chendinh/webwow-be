import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Database connected on attempt ${attempt}`);
        }
        return;
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          this.logger.error(`Failed to connect to database after ${MAX_RETRIES} attempts`);
          throw err;
        }
        this.logger.warn(
          `Database connection attempt ${attempt}/${MAX_RETRIES} failed — retrying in ${RETRY_DELAY_MS}ms...`,
        );
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
