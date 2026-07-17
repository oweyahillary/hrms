import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveRequestsService } from './leave-requests.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { QueryLeaveRequestDto } from './dto/query-leave-request.dto';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

@ApiTags('leave-requests')
@ApiBearerAuth()
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}

  @Post()
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() user: AuthUser) {
    return this.requests.create(dto, user);
  }

  // Declared before ':id' so '/leave-requests/inbox' isn't captured as an id.
  @Get('inbox')
  inbox(@CurrentUser() user: AuthUser) {
    return this.requests.inbox(user);
  }

  /** Approver picker options. Also before ':id' for the same reason. */
  @Get('approvers')
  approvers() {
    return this.requests.approvers();
  }

  /** Who WILL approve this employee's leave, under the org's policy. */
  @Get('approvers-for')
  approversFor(@Query('employeeId') employeeId: string) {
    return this.requests.approversFor(employeeId);
  }

  @Get()
  list(@Query() query: QueryLeaveRequestDto, @CurrentUser() user: AuthUser) {
    return this.requests.list(user, query);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.requests.get(id);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.approve(id, user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.reject(id, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.requests.cancel(id, user);
  }
}
