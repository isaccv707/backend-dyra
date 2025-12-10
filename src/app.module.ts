import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; 
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { QuotationsModule } from './quotations/quotations.module';
import { StudiesModule } from './studies/studies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    QuotationsModule,
    StudiesModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
