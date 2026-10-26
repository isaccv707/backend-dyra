import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { commentWithAuthor, ticketWithRelations } from '../tickets.shared';

/**
 * The response DTOs only document what the services return. These checks read
 * the exported openapi.json (CI keeps it current) so a new column or include
 * that isn't documented fails here instead of silently reaching the frontends
 * untyped.
 */
describe('DTOs de respuesta de tickets vs. Prisma', () => {
  const schemas = (
    JSON.parse(
      readFileSync(join(__dirname, '../../../openapi.json'), 'utf-8'),
    ) as {
      components: {
        schemas: Record<string, { properties: Record<string, unknown> }>;
      };
    }
  ).components.schemas;
  const propsOf = (name: string) =>
    Object.keys(schemas[name].properties).sort();

  it('TicketResponseDto = columnas de Ticket + ticketWithRelations', () => {
    expect(propsOf('TicketResponseDto')).toEqual(
      [
        ...Object.keys(Prisma.TicketScalarFieldEnum),
        ...Object.keys(ticketWithRelations.include),
      ].sort(),
    );
  });

  it('TicketCommentResponseDto = columnas de TicketComment + author', () => {
    expect(propsOf('TicketCommentResponseDto')).toEqual(
      [
        ...Object.keys(Prisma.TicketCommentScalarFieldEnum),
        ...Object.keys(commentWithAuthor.include),
      ].sort(),
    );
  });
});
