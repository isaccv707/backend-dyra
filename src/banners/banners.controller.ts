import { Controller, Get, Post, Body, Patch, Param, Delete, ParseEnumPipe, ParseUUIDPipe, Query } from '@nestjs/common';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';
import { BannerPlacement } from '@prisma/client';

@Controller('banners')
export class BannersController {
  constructor(private readonly bannersService: BannersService) { }

  @Get('active/:placement')
  findActiveBanners(
    @Param('placement', new ParseEnumPipe(BannerPlacement))
    placement: BannerPlacement,
    @Query('branchId') branchId?: string,
  ) {
    return this.bannersService.findActiveBanners(placement, branchId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.findOne(id);
  }

  @Get()
  findAll(@Query('branchId') branchId?: string) {
    return this.bannersService.findAll(branchId);
  }

  @Post()
  create(@Body() createBannerDto: CreateBannerDto) {
    return this.bannersService.create(createBannerDto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBannerDto: UpdateBannerDto,
  ) {
    return this.bannersService.update(id, updateBannerDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.bannersService.remove(id);
  }
}
