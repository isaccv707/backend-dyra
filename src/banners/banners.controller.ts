import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseEnumPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerPlacement } from '@prisma/client';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) {}

  @Public()
  @Get('active/:placement')
  findActiveBanners(
    @Param('placement', new ParseEnumPipe(BannerPlacement))
    placement: BannerPlacement,
    @Query('branchId') branchId?: string,
  ) {
    return this.bannersService.findActiveBanners(placement, branchId);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findOne(id);
  }

  @Public()
  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.bannersService.findAll(branchId);
  }

  @Permissions('banners:create')
  @Post()
  create(@Body() createBannerDto: CreateBannerDto) {
    return this.bannersService.create(createBannerDto);
  }

  @Permissions('banners:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBannerDto: UpdateBannerDto,
  ) {
    return this.bannersService.update(id, updateBannerDto);
  }

  @Permissions('banners:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }
}
