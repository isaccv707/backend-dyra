import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config'; 
import { PrismaModule } from 'prisma/prisma/prisma.module';
import { QuotationsModule } from './quotations/quotations.module';
import { StudiesModule } from './studies/studies.module';
import { BannersModule } from './banners/banners.module';
import { AuthorsModule } from './authors/authors.module';
import { PostsModule } from './posts/posts.module';
import { ServicesModule } from './services/services.module';
import { BranchesModule } from './branches/branches.module';
import { StatesModule } from './states/states.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    QuotationsModule,
    StudiesModule,
    BannersModule,
    AuthorsModule,
    PostsModule,
    ServicesModule,
    BranchesModule,
    StatesModule,
    ReviewsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule { }
