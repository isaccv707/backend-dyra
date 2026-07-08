import { Controller, Get, Post, Body, Patch, Param, Delete, ParseUUIDPipe, Query } from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { FindServicesDto } from './dto/find-services.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) { }

  @Permissions('services:create')
  @Post()
  create(@Body() createServiceDto: CreateServiceDto) {
    return this.servicesService.create(createServiceDto);
  }

  @Public()
  @Get()
  findAll(@Query() { branchId }: FindServicesDto) {
    return this.servicesService.findAll(branchId);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string, @Query() { branchId }: FindServicesDto) {
    return this.servicesService.findOne(id, branchId);
  }

  @Permissions('services:update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() updateServiceDto: UpdateServiceDto) {
    return this.servicesService.update(id, updateServiceDto);
  }

  @Permissions('services:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.remove(id);
  }
}
