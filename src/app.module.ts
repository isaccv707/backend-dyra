import { Module } from '@nestjs/common';
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { QuotationsModule } from './quotations/quotations.module';
import { StudiesModule } from './studies/studies.module';

@Module({
  imports: [PrismaModule, QuotationsModule, StudiesModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
