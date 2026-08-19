import { Global, Module } from '@nestjs/common';
import { SandboxExecutorService } from './sandbox-executor.service';

@Global()
@Module({
  providers: [SandboxExecutorService],
  exports: [SandboxExecutorService],
})
export class SandboxModule {}
