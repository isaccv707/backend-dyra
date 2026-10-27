import { CreateStudyCatalogDto } from 'src/study-catalogs/dto/create-study-catalog.dto';

/** name (único por sucursal, sin distinguir mayúsculas), branchId e isActive. */
export class CreateStudyProviderDto extends CreateStudyCatalogDto {}
