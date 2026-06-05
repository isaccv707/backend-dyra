import type { Express } from 'express';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { StudiesService } from './studies.service';
import { CreateStudyDto } from './dto/create-study.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaginationDto } from './dto/pagination-study.dto';

@Controller('studies')
export class StudiesController {
  constructor(private readonly studiesService: StudiesService) {}

  @Post()
  create(@Body() createStudyDto: CreateStudyDto) {
    return this.studiesService.create(createStudyDto);
  }

  @Get()
  findAll(@Query() pagination: PaginationDto) {
    return this.studiesService.findAll(pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.studiesService.findOne(id);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required');

    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];

    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Solo se permite archivo Excel (.xlsx)');
    }
    return this.studiesService.importFromExcel(file.buffer);
  }
}
