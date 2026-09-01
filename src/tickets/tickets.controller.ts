import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { FindTicketsDto } from './dto/find-tickets.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(
    @Body() createTicketDto: CreateTicketDto,
    @CurrentUser() user: BranchScopedUser & { id: string },
  ) {
    return this.ticketsService.create(createTicketDto, user);
  }

  @Get()
  findAll(@Query() findTicketsDto: FindTicketsDto, @CurrentUser() user: BranchScopedUser) {
    return this.ticketsService.findAll(findTicketsDto, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: BranchScopedUser) {
    return this.ticketsService.findOne(id, user);
  }

  @Permissions('tickets:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.ticketsService.update(id, updateTicketDto, user);
  }
}
