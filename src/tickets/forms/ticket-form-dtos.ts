import {
  AccessRequestFormDto,
  ApplyAccessRequestFormDto,
} from './dto/access-request-form.dto';
import {
  ApplyStudyCreateFormDto,
  ApplyStudyUpdateFormDto,
} from './dto/apply-study-form.dto';
import { ClientCreateFormDto } from './dto/client-create-form.dto';
import { SoftwareRemoteFormDto } from './dto/software-remote-form.dto';
import { StudyCreateFormDto } from './dto/study-create-form.dto';
import { StudyUpdateFormDto } from './dto/study-update-form.dto';

/** Form payloads, validated at runtime: registered as Swagger extra models. */
export const TICKET_FORM_DTOS = [
  SoftwareRemoteFormDto,
  AccessRequestFormDto,
  StudyCreateFormDto,
  StudyUpdateFormDto,
  ClientCreateFormDto,
];

export const TICKET_FORM_APPLY_DTOS = [
  ApplyAccessRequestFormDto,
  ApplyStudyCreateFormDto,
  ApplyStudyUpdateFormDto,
];
