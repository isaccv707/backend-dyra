import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { UpdateTicketDto } from '../dto/update-ticket.dto';
import { CreateTicketDto } from '../dto/create-ticket.dto';
import { TicketsService } from '../tickets.service';
import { TicketFormWorkflowService } from '../forms/ticket-form-workflow.service';
import {
  createTicketsTestContext,
  branchId,
  globalUser,
  scopedStaffUser,
  createDto,
  TicketsTestContext,
} from '../testing/tickets-test-context';

describe('TicketFormWorkflowService', () => {
  let prisma: TicketsTestContext['prisma'];
  let gateway: TicketsTestContext['gateway'];
  let mailService: TicketsTestContext['mailService'];
  let ticketForms: TicketsTestContext['ticketForms'];
  let service: TicketsService;
  let formWorkflowService: TicketFormWorkflowService;

  beforeEach(async () => {
    ({
      prisma,
      gateway,
      mailService,
      ticketForms,
      ticketsService: service,
      formWorkflowService,
    } = await createTicketsTestContext());
  });

  afterEach(() => jest.clearAllMocks());

  describe('formularios por categoría', () => {
    const studyForm = { name: 'Glucosa', serviceId: 'svc-1' };

    it('HARDWARE no lleva formulario y exige title/description', async () => {
      await expect(
        service.create(
          { ...createDto, form: { foo: 1 } } as CreateTicketDto,
          globalUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.create(
          { ...createDto, description: undefined } as CreateTicketDto,
          globalUser,
        ),
      ).rejects.toMatchObject({
        response: { message: ['description es requerido'] },
      });
      expect(ticketForms.parse).not.toHaveBeenCalled();
      expect(prisma.ticket.create).not.toHaveBeenCalled();
    });

    it('SOFTWARE exige form (TeamViewer) además del título del usuario', async () => {
      await expect(
        service.create(
          { ...createDto, category: 'SOFTWARE' } as CreateTicketDto,
          globalUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      ticketForms.parse.mockResolvedValue({
        data: { teamViewerId: '123' },
        title: undefined,
      });
      prisma.ticket.create.mockResolvedValue({ id: 'ticket-1' });
      await service.create(
        {
          ...createDto,
          category: 'SOFTWARE',
          form: { teamViewerId: '123' },
        } as CreateTicketDto,
        globalUser,
      );

      expect(ticketForms.parse).toHaveBeenCalledWith(
        'SOFTWARE_REMOTE',
        { teamViewerId: '123' },
        { branchId, actor: globalUser, phase: 'request' },
      );
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: createDto.title,
            form: {
              create: {
                type: 'SOFTWARE_REMOTE',
                schemaVersion: 1,
                data: { teamViewerId: '123' },
              },
            },
          }),
        }),
      );
    });

    it('COGNITI exige subcategoría', async () => {
      await expect(
        service.create(
          { branchId, category: 'COGNITI', form: studyForm } as CreateTicketDto,
          globalUser,
        ),
      ).rejects.toThrow('subcategoryId es requerido');
    });

    it('COGNITI usa el formulario de la subcategoría y el título generado', async () => {
      prisma.ticketSubcategory.findUnique.mockResolvedValue({
        category: 'COGNITI',
        formType: 'STUDY_CREATE',
      });
      ticketForms.parse.mockResolvedValue({
        data: studyForm,
        title: 'Alta de parámetro: Glucosa',
      });
      prisma.ticket.create.mockResolvedValue({ id: 'ticket-1' });

      await service.create(
        {
          branchId,
          category: 'COGNITI',
          subcategoryId: 'sub-1',
          form: studyForm,
        } as CreateTicketDto,
        globalUser,
      );

      expect(ticketForms.parse.mock.calls[0][0]).toBe('STUDY_CREATE');
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'Alta de parámetro: Glucosa',
            form: {
              create: {
                type: 'STUDY_CREATE',
                schemaVersion: 1,
                data: studyForm,
              },
            },
          }),
        }),
      );
    });

    it('no permite reclasificar a una categoría con otro formulario', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket-1',
        branchId,
        status: 'OPEN',
        category: 'COGNITI',
        subcategoryId: 'sub-1',
        form: { type: 'STUDY_CREATE' },
      });

      await expect(
        service.update(
          'ticket-1',
          { category: 'HARDWARE', subcategoryId: null } as UpdateTicketDto,
          scopedStaffUser,
        ),
      ).rejects.toThrow('solo puede reclasificarse');
      expect(prisma.ticket.update).not.toHaveBeenCalled();
    });

    describe('applyForm', () => {
      const pendingTicket = {
        id: 'ticket-1',
        branchId,
        status: 'OPEN',
        createdById: 'user-1',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        reopenedCount: 0,
        resolvedAt: null,
        priority: 'MEDIUM',
        assignees: [],
        form: {
          type: 'STUDY_CREATE',
          data: studyForm,
          appliedAt: null,
        },
      };
      const approver: RequestUser = {
        ...scopedStaffUser,
        role: {
          ...scopedStaffUser.role,
          permissions: ['tickets:update', 'studies:create'],
        },
      };

      beforeEach(() => {
        prisma.$transaction.mockImplementation(
          (cb: (tx: typeof prisma) => unknown) => cb(prisma),
        );
        prisma.ticketForm.updateMany.mockResolvedValue({ count: 1 });
        // Dentro de la transacción se vuelve a leer lo guardado.
        prisma.ticketForm.findUniqueOrThrow.mockResolvedValue({
          data: studyForm,
        });
        prisma.ticket.findUniqueOrThrow.mockResolvedValue({ id: 'ticket-1' });
        prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });
      });

      it('ejecuta la acción, guarda el resultado y resuelve el ticket', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        const afterCommit = jest.fn().mockResolvedValue(undefined);
        ticketForms.apply.mockResolvedValue({
          result: { studyId: 'study-1' },
          summary: 'creó el parámetro GLU (Glucosa)',
          afterCommit,
        });

        await formWorkflowService.applyForm(
          'ticket-1',
          { code: 'GLU' },
          approver,
        );

        expect(ticketForms.apply).toHaveBeenCalledWith(
          'STUDY_CREATE',
          studyForm,
          { code: 'GLU' },
          { branchId, actor: approver, phase: 'apply' },
          prisma,
        );
        expect(prisma.ticketForm.update).toHaveBeenCalledWith({
          where: { ticketId: 'ticket-1' },
          data: { result: { studyId: 'study-1' } },
        });
        expect(prisma.ticket.update).toHaveBeenCalledWith({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedAt: expect.any(Date),
          }),
        });
        expect(afterCommit).toHaveBeenCalled();
        expect(prisma.ticketEvent.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({ type: 'FORM_APPLIED' }),
            expect.objectContaining({
              type: 'STATUS_CHANGED',
              toValue: 'RESOLVED',
            }),
          ],
        });
        expect(gateway.emitTicketUpdated).toHaveBeenCalled();
      });

      it('exige el permiso de la acción además de tickets:update', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);

        await expect(
          formWorkflowService.applyForm('ticket-1', {}, scopedStaffUser),
        ).rejects.toThrow('studies:create');
        expect(ticketForms.apply).not.toHaveBeenCalled();
      });

      it('un formulario ya aprobado responde 409', async () => {
        prisma.ticket.findUnique.mockResolvedValue({
          ...pendingTicket,
          form: { ...pendingTicket.form, appliedAt: new Date() },
        });

        await expect(
          formWorkflowService.applyForm('ticket-1', {}, approver),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('una aprobación concurrente pierde la carrera con 409', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        prisma.ticketForm.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          formWorkflowService.applyForm('ticket-1', {}, approver),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(ticketForms.apply).not.toHaveBeenCalled();
      });

      it('los formularios informativos no se aprueban', async () => {
        prisma.ticket.findUnique.mockResolvedValue({
          ...pendingTicket,
          form: { ...pendingTicket.form, type: 'CLIENT_CREATE' },
        });

        await expect(
          formWorkflowService.applyForm('ticket-1', {}, approver),
        ).rejects.toThrow('informativo');
      });

      it('no espera el correo ni falla si el historial no se pudo registrar', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        let releaseEmail: () => void = () => undefined;
        const afterCommit = jest.fn(
          () =>
            new Promise<undefined>((resolve) => {
              releaseEmail = () => resolve(undefined);
            }),
        );
        ticketForms.apply.mockResolvedValue({
          result: { userId: 'u-1' },
          summary: 'creó el usuario',
          afterCommit,
        });
        prisma.ticketComment.create.mockRejectedValue(new Error('db caída'));

        // Responde aunque el correo siga pendiente y el comentario haya fallado.
        await expect(
          formWorkflowService.applyForm('ticket-1', {}, approver),
        ).resolves.toEqual({ id: 'ticket-1' });
        expect(afterCommit).toHaveBeenCalled();
        releaseEmail();
      });

      it('validar sin aplicar ejecuta todo y revierte: no guarda resultado ni estado', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        const afterCommit = jest.fn();
        ticketForms.apply.mockResolvedValue({
          result: { studyId: 'study-1' },
          summary: 'creó el parámetro GLU (Glucosa)',
          afterCommit,
        });

        await expect(
          formWorkflowService.validateForm(
            'ticket-1',
            { code: 'GLU' },
            approver,
          ),
        ).resolves.toEqual({
          valid: true,
          summary: 'creó el parámetro GLU (Glucosa)',
        });
        expect(ticketForms.apply).toHaveBeenCalled();
        expect(prisma.ticketForm.update).not.toHaveBeenCalled();
        expect(prisma.ticket.update).not.toHaveBeenCalled();
        expect(afterCommit).not.toHaveBeenCalled();
        expect(prisma.ticketComment.create).not.toHaveBeenCalled();
      });

      it('rechazar cierra el formulario con motivo y cancela el ticket', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        prisma.ticketForm.updateMany.mockResolvedValue({ count: 1 });

        await formWorkflowService.rejectForm(
          'ticket-1',
          'Falta el tarifario',
          approver,
        );

        expect(prisma.ticketForm.updateMany).toHaveBeenCalledWith({
          where: { ticketId: 'ticket-1', appliedAt: null, rejectedAt: null },
          data: {
            rejectedAt: expect.any(Date),
            rejectedById: approver.id,
            rejectionReason: 'Falta el tarifario',
          },
        });
        expect(prisma.ticket.update).toHaveBeenCalledWith({
          where: { id: 'ticket-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        });
        expect(prisma.ticketEvent.createMany).toHaveBeenCalledWith({
          data: [
            expect.objectContaining({ type: 'FORM_REJECTED' }),
            expect.objectContaining({ toValue: 'CANCELLED' }),
          ],
        });
        expect(
          prisma.ticketComment.create.mock.calls[0][0].data.body,
        ).toContain('Falta el tarifario');
      });

      it('un formulario rechazado ya no se aprueba', async () => {
        prisma.ticket.findUnique.mockResolvedValue({
          ...pendingTicket,
          form: { ...pendingTicket.form, rejectedAt: new Date() },
        });

        await expect(
          formWorkflowService.applyForm('ticket-1', {}, approver),
        ).rejects.toThrow('rechazado');
      });

      it('reenvía el correo de una solicitud de acceso aprobada', async () => {
        const accessApprover: RequestUser = {
          ...approver,
          role: {
            ...approver.role,
            permissions: ['tickets:update', 'users:create'],
          },
        };
        prisma.ticket.findUnique.mockResolvedValue({
          ...pendingTicket,
          form: {
            type: 'ACCESS_REQUEST',
            data: { fullName: 'Ana López', email: 'ana@dyra.com' },
            result: { userId: 'u-1', emailSent: false },
            appliedAt: new Date(),
          },
        });

        await formWorkflowService.resendAccessEmail('ticket-1', accessApprover);

        expect(mailService.sendAccessGrantedEmail).toHaveBeenCalledWith(
          'ana@dyra.com',
          'Ana López',
        );
        expect(prisma.ticketForm.update).toHaveBeenCalledWith({
          where: { ticketId: 'ticket-1' },
          data: { result: { userId: 'u-1', emailSent: true } },
        });
      });

      it('si la acción falla no registra comentario ni evento', async () => {
        prisma.ticket.findUnique.mockResolvedValue(pendingTicket);
        ticketForms.apply.mockRejectedValue(
          new BadRequestException('catálogo inválido'),
        );

        await expect(
          formWorkflowService.applyForm('ticket-1', { code: 'GLU' }, approver),
        ).rejects.toThrow('catálogo inválido');
        expect(prisma.ticketComment.create).not.toHaveBeenCalled();
        expect(prisma.ticketEvent.createMany).not.toHaveBeenCalled();
      });
    });

    describe('updateForm', () => {
      const ticketWithForm = {
        id: 'ticket-1',
        branchId,
        status: 'OPEN',
        createdById: globalUser.id,
        assignees: [],
        form: { type: 'STUDY_CREATE', data: {}, appliedAt: null },
      };

      it('solo el creador o TI pueden editarlo', async () => {
        prisma.ticket.findUnique.mockResolvedValue({
          ...ticketWithForm,
          createdById: 'other-user',
        });

        await expect(
          formWorkflowService.updateForm('ticket-1', studyForm, globalUser),
        ).rejects.toBeInstanceOf(ForbiddenException);
      });

      beforeEach(() => {
        prisma.$transaction.mockImplementation(
          (cb: (tx: typeof prisma) => unknown) => cb(prisma),
        );
        prisma.ticketComment.create.mockResolvedValue({ id: 'comment-1' });
        prisma.ticket.findUniqueOrThrow.mockResolvedValue({ id: 'ticket-1' });
      });

      it('valida, reemplaza los datos y actualiza el título generado', async () => {
        prisma.ticket.findUnique.mockResolvedValue({
          ...ticketWithForm,
          title: 'Alta de parámetro: Glucosa',
        });
        ticketForms.parse.mockResolvedValue({
          data: studyForm,
          title: 'Alta de parámetro: Glucosa en ayuno',
        });
        prisma.ticketForm.updateMany.mockResolvedValue({ count: 1 });

        await formWorkflowService.updateForm('ticket-1', studyForm, globalUser);

        expect(prisma.ticketForm.updateMany).toHaveBeenCalledWith({
          where: { ticketId: 'ticket-1', appliedAt: null, rejectedAt: null },
          data: { data: studyForm, schemaVersion: 1 },
        });
        expect(prisma.ticket.update).toHaveBeenCalledWith({
          where: { id: 'ticket-1' },
          data: { title: 'Alta de parámetro: Glucosa en ayuno' },
        });
        // Quien edita no se notifica a sí mismo.
        expect(prisma.ticketNotification.createMany).not.toHaveBeenCalled();
        expect(prisma.ticketEvent.createMany).toHaveBeenCalledWith({
          data: [expect.objectContaining({ type: 'FORM_UPDATED' })],
        });
      });

      it('responde 409 si el formulario se aprobó mientras se editaba', async () => {
        prisma.ticket.findUnique.mockResolvedValue(ticketWithForm);
        ticketForms.parse.mockResolvedValue({ data: studyForm });
        prisma.ticketForm.updateMany.mockResolvedValue({ count: 0 });

        await expect(
          formWorkflowService.updateForm('ticket-1', studyForm, globalUser),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(prisma.ticketEvent.createMany).not.toHaveBeenCalled();
      });
    });
  });
});
