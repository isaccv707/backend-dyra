import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { QuotationsModule } from './quotations/quotations.module';

@Module({
  imports: [PrismaModule, QuotationsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
