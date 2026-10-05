import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class SetTicketAssigneesDto {
  // Reemplaza la lista completa de asignados; [] deja el ticket sin
  // asignar. Solo los usuarios nuevos en la lista reciben el correo de
  // asignación.
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  userIds!: string[];
}
