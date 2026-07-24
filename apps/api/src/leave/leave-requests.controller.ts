import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { QueryLeaveRequestDto } from './dto/query-leave-request.dto';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('leave-requests')
@ApiBearerAuth()
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}

  // Deliberately NOT permission-gated: any authenticated user may apply for
  // their own leave. The service enforces "for yourself unless leave.manage".
  @Post()
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() user: AuthUser) {
    return this.requests.create(dto, user);
  }

  // Declared before ':id' so '/leave-requests/inbox' isn't captured as an id.
  // Identity-based (what's awaiting MY approval) — not permission-gated.
  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.requests.inbox(user);
  }

  /** Approver picker options — any authenticated user may read it (see the service doc comment). Also before ':id'. */
  @Get('approvers')
  approvers() {
    return this.requests.approvers();
  }

  /** Who WILL approve this employee's leave, under the org's policy. Not gated — the apply screen needs it for any applicant. */
  @Get('approvers-for')
  approversFor(@Query('employeeId') employeeId: string, @CurrentUser() user: AuthUser) {
    return this.requests.approversFor(employeeId, user.organizationId);
  }

  // The org-wide/department admin queue — a plain self-service caller uses
  // /me/leave instead (which calls this service directly, in-process,
  // bypassing this route entirely).
  @Get()
  @AnyPermission('leave.view', 'leave.approve', 'leave.manage')
  list(@Query() query: QueryLeaveRequestDto, @CurrentUser() user: AuthUser) {
    return this.requests.list(user, query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.requests.get(id);
  }

  @Post(':id/approve')
  @Permissions('leave.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.approve(id, user);
  }

  @Post(':id/reject')
  @Permissions('leave.approve')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.reject(id, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.cancel(id, user);
  }
}
