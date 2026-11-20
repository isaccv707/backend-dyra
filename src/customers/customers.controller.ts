import type { Express, Response } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { assertExcelFile } from 'src/common/utils/excel-file.util';
import { generateSlug } from 'src/common/utils/slugger.util';
import { Permissions } from 'src/auth/decorators/permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { BranchScopedUser } from 'src/common/utils/branch-access.util';
import { CustomersService } from './customers.service';
import {
  CUSTOMER_IMPORT_MAX_ROWS,
  CustomerExcelService,
} from './services/customer-excel.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { FindCustomersDto } from './dto/find-customers.dto';
import {
  CustomerResponseDto,
  CustomerImportResultDto,
  PaginatedCustomersResponseDto,
} from './dto/customer-response.dto';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

const BRANCH_QUERY = {
  name: 'branchId',
  required: true,
  description: 'Sucursal (UUID).',
} as const;

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly service: CustomersService,
    private readonly excel: CustomerExcelService,
  ) {}

  // Static routes go before ':id' (it only accepts UUIDs).

  @ApiOperation({
    summary: 'Descargar plantilla de importación de clientes',
    description:
      'Excel con la hoja "Clientes" (columnas name, email, accountsReceivable, liquidate, priceSheet, contractAmount, patientAmount, ' +
      'startDate, endDate, isActive y una fila de ejemplo) y una segunda hoja con los tarifarios de la sucursal (nombre, id y estado) ' +
      'para llenar la columna priceSheet.',
  })
  @ApiQuery(BRANCH_QUERY)
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'Archivo Excel de plantilla.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @Permissions('customers:create')
  @Get('import-template')
  async downloadImportTemplate(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const { buffer, branchName } = await this.excel.generateTemplate(
      branchId,
      user,
    );
    sendXlsx(
      res,
      buffer,
      `plantilla-clientes-${generateSlug(branchName)}.xlsx`,
    );
  }

  @ApiOperation({
    summary: 'Exportar clientes de una sucursal',
    description:
      'Excel con todos los clientes de la sucursal (activos e inactivos) en las mismas columnas que la plantilla, para editarlo ' +
      'y volver a importarlo, más la hoja de tarifarios de la sucursal.',
  })
  @ApiQuery(BRANCH_QUERY)
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'Archivo Excel de clientes.' })
  @ApiResponse({ status: 404, description: 'Sucursal no encontrada.' })
  @Permissions('customers:read')
  @Get('export')
  async exportByBranch(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: BranchScopedUser,
    @Res() res: Response,
  ) {
    const { buffer, branchName } = await this.excel.exportByBranch(
      branchId,
      user,
    );
    sendXlsx(res, buffer, `clientes-${generateSlug(branchName)}.xlsx`);
  }

  @ApiOperation({
    summary: 'Importar clientes (alta y actualización masiva)',
    description:
      `Procesa la hoja "Clientes" (o la primera) de un .xlsx/.xls, máximo ${CUSTOMER_IMPORT_MAX_ROWS} filas. Cada fila se busca por name ` +
      '(sin distinguir mayúsculas) en la sucursal: si existe se actualiza, si no se crea. Mismas reglas que el alta: name y email ' +
      'obligatorios; accountsReceivable/liquidate excluyentes (Sí/No; si solo se llena uno, el otro se infiere; vacíos = se conserva ' +
      'la modalidad actual o, al crear, liquida); priceSheet = nombre o id de un tarifario activo de la sucursal; montos ≥ 0; ' +
      'fechas AAAA-MM-DD, DD/MM/AAAA o fecha de Excel. priceSheet, montos y fechas vacíos quedan sin valor; isActive vacío conserva ' +
      'el estado (al crear: activo). Las filas inválidas se reportan en invalid y las válidas se guardan juntas.',
  })
  @ApiQuery(BRANCH_QUERY)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'Archivo Excel (.xlsx o .xls) con el formato de la plantilla.',
        },
      },
    },
  })
  @ApiResponse({ status: 201, type: CustomerImportResultDto })
  @ApiResponse({
    status: 400,
    description:
      'Archivo faltante, de tipo inválido, sin filas, con demasiadas filas o sin las columnas name/email.',
  })
  @Permissions('customers:create', 'customers:update')
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  importFromExcel(
    @Query('branchId', ParseUUIDPipe) branchId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: BranchScopedUser,
  ) {
    assertExcelFile(file);
    return this.excel.importFromExcel(branchId, file.buffer, user);
  }

  @ApiOperation({
    summary: 'Crear cliente',
    description:
      'Crea un cliente en una sucursal. Nombre único por sucursal (sin distinguir mayúsculas). ' +
      'accountsReceivable (genera CxC) y liquidate (liquida al instante) son excluyentes; si solo se envía uno, el otro se infiere. ' +
      'La hoja de precios debe ser activa y de la misma sucursal.',
  })
  @ApiResponse({ status: 201, type: CustomerResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Modalidad de pago, fechas u hoja de precios inválidas.',
  })
  @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
  @Permissions('customers:create')
  @Post()
  create(
    @Body() dto: CreateCustomerDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.create(dto, user);
  }

  @ApiOperation({
    summary: 'Listar clientes',
    description:
      'Listado paginado con alcance según las sucursales del usuario. search busca en nombre y correo.',
  })
  @ApiResponse({ status: 200, type: PaginatedCustomersResponseDto })
  @Permissions('customers:read')
  @Get()
  findAll(
    @Query() dto: FindCustomersDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.findAll(dto, user);
  }

  @ApiOperation({ summary: 'Obtener cliente' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, type: CustomerResponseDto })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Permissions('customers:read')
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.findOne(id, user);
  }

  @ApiOperation({
    summary: 'Actualizar cliente',
    description:
      'Actualización parcial. La sucursal no se puede cambiar. priceSheetId/fechas/montos aceptan null para limpiarlos.',
  })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, type: CustomerResponseDto })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @ApiResponse({ status: 409, description: 'El nombre ya existe.' })
  @Permissions('customers:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @ApiOperation({ summary: 'Eliminar cliente' })
  @ApiParam({ name: 'id', description: 'Identificador (UUID).' })
  @ApiResponse({ status: 200, type: CustomerResponseDto })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado.' })
  @Permissions('customers:delete')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: BranchScopedUser,
  ) {
    return this.service.remove(id, user);
  }
}
