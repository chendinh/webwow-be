import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SystemHealthService } from './system-health.service';
import { SystemHealthController } from './system-health.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SystemHealthController],
  providers: [SystemHealthService],
  exports: [SystemHealthService],
})
export class SystemHealthModule {}
