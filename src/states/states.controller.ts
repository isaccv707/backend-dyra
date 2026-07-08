import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { StatesService } from './states.service';
import { CreateStateDto } from './dto/create-state.dto';
import { UpdateStateDto } from './dto/update-state.dto';
import { Public } from 'src/auth/decorators/public.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';

@Controller('states')
export class StatesController {
  constructor(private readonly statesService: StatesService) {}

  @Permissions('states:create')
  @Post()
  create(@Body() createStateDto: CreateStateDto) {
    return this.statesService.create(createStateDto);
  }

  @Public()
  @Get()
  findAll() {
    return this.statesService.findAll();
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.statesService.findOne(id);
  }

  @Permissions('states:update')
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateStateDto: UpdateStateDto) {
    return this.statesService.update(id, updateStateDto);
  }

  @Permissions('states:delete')
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.statesService.remove(id);
  }
}
