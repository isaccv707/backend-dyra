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
import { PriceSheetsModule } from './price-sheets/price-sheets.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesPermissionsModule } from './roles-permissions/roles-permissions.module';
import { EmployeesModule } from './employees/employees.module';
import { LocationsModule } from './locations/locations.module';
import { DevicesModule } from './devices/devices.module';
import { SafeguardsModule } from './safeguards/safeguards.module';

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
    PriceSheetsModule,
    AuthModule,
    UsersModule,
    RolesPermissionsModule,
    EmployeesModule,
    LocationsModule,
    DevicesModule,
    SafeguardsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
