import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Permissions('branches:create')
  @Post()
  create(@Body() createBranchDto: CreateBranchDto) {
    return this.branchesService.create(createBranchDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.branchesService.findAll();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.branchesService.findOne(id);
  }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateBranchDto: UpdateBranchDto) {
  //   return this.branchesService.update(id, updateBranchDto);
  // }

  @Permissions('branches:delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.branchesService.remove(id);
  }
}
